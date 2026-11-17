/* ========================================================
   AURIX — ADD SONG & EDIT METADATA CONTROLLER
   - Automatic ID3 tag & embedded cover extraction (jsmediatags)
   - Multi-file offline batch drop/selection
   - Full live metadata editor (Title, Artist, Album, Year, Genre, Reviews, Art)
   - Real-time 3D Disc texture re-rendering on edit
   - IndexedDB persistence for offline songs & metadata edits
   ======================================================== */

// IndexedDB Persistence Layer
const DB_NAME = 'AuriX_DB';
const DB_VERSION = 2; // Incremented for edits & custom songs
const STORE_CUSTOM = 'custom_songs';
const STORE_EDITS = 'metadata_edits';

function openAuriXDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_CUSTOM)) {
        db.createObjectStore(STORE_CUSTOM, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_EDITS)) {
        db.createObjectStore(STORE_EDITS, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function saveCustomSongToDB(songRecord) {
  try {
    const db = await openAuriXDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CUSTOM, 'readwrite');
      const store = tx.objectStore(STORE_CUSTOM);
      store.put(songRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.warn("Could not save custom song to IndexedDB:", err);
  }
}

async function saveMetadataEditToDB(songId, editedData) {
  try {
    const db = await openAuriXDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EDITS, 'readwrite');
      const store = tx.objectStore(STORE_EDITS);
      store.put({ id: songId, data: editedData, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.warn("Could not save edit to IndexedDB:", err);
  }
}

async function loadAllStoredData() {
  try {
    const db = await openAuriXDB();
    if (!db) return { customSongs: [], edits: [] };
    const getStoreData = (storeName) => new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    const [customSongs, edits] = await Promise.all([
      getStoreData(STORE_CUSTOM),
      getStoreData(STORE_EDITS)
    ]);
    return { customSongs, edits };
  } catch (err) {
    console.warn("Could not load stored data from IndexedDB:", err);
    return { customSongs: [], edits: [] };
  }
}

/* ========================================================
   METADATA & FILENAME SANITIZER
   Strips promotional bracketed/parenthesized website branding,
   quality labels, watermarks, and tags (e.g. [PagalWorld.com], (NaaSongs), [320kbps])
   ======================================================== */
function cleanSongMetadataString(rawStr) {
  if (!rawStr || typeof rawStr !== 'string') return '';

  let str = rawStr;

  // 1. Remove bracketed/parenthesized segments containing domains, URLs, or promotional website branding
  // Matches: [PagalWorld.com], (SongsPk.Net), [NaaSongs.co], [www.djpunjab.com], etc.
  str = str.replace(/[\[\(\{][^\]\)\}]*(?:\.com|\.in|\.co|\.net|\.org|\.pk|\.cc|\.me|\.info|\.vip|\.fm|\.club|\.site|\.app|\.live|\.mp3|\.pro|www\.|http|https|download|pagal|naasongs|masstamilan|sensongs|isaimini|raaga|gaana|wynk|jiosaavn|hungama|pendujatt|djmaza|mp3mad|wapking|ringtone)[^\]\)\}]*[\]\)\}]+/gi, '');

  // 2. Remove common bracketed audio quality/codec/rip tags: [320kbps], (128 Kbps), [FLAC], (HQ), [Audio], [Official Track], [Single]
  str = str.replace(/[\[\(\{][^\]\)\}]*(?:320\s*kbps|128\s*kbps|256\s*kbps|64\s*kbps|kbps|flac|hq|hd|cdrip|webrip|lossless|audio\s*song|full\s*song|official\s*audio|official\s*track|official\s*video|original\s*mix|original|bonus\s*track|single|album\s*version|remastered|remaster)[^\]\)\}]*[\]\)\}]+/gi, '');

  // 3. Remove standalone bitrate/quality suffix artifacts like _320, -320kbps, 128kbps, etc.
  str = str.replace(/(?:[-_ ]+)?(?:320|128|256|64)(?:\s*kbps)?\b/gi, '');

  // 4. Remove standalone domain/url patterns that might not be in brackets (e.g. "Song - PagalWorld.com")
  str = str.replace(/\b(?:https?:\/\/)?(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.(?:com|in|co|net|org|pk|cc|me|info|vip|fm|club|site|app|live)\b/gi, '');

  // 5. Remove leading/trailing site prefixes often separated by hyphens or underscores
  // e.g. "PagalWorld.com - Song Name" or "NaaSongs - Song Name"
  str = str.replace(/^(?:[a-zA-Z0-9_-]+\.(?:com|in|co|net|org|pk|cc|me))\s*[-–—_]\s*/gi, '');
  str = str.replace(/\s*[-–—_]\s*(?:[a-zA-Z0-9_-]+\.(?:com|in|co|net|org|pk|cc|me))$/gi, '');

  // 6. Clean up any leftover empty brackets () [] {}
  str = str.replace(/[\[\(\{]\s*[\]\)\}]/g, '');

  // 7. Clean up dangling dashes, underscores, and multi-spaces
  str = str.replace(/\s*[-–—_]\s*$/, '');
  str = str.replace(/^\s*[-–—_]\s*/, '');
  str = str.replace(/\s{2,}/g, ' ');

  return str.trim();
}
function extractID3Tags(file) {
  return new Promise((resolve) => {
    if (typeof jsmediatags === 'undefined' || !file) {
      resolve(null);
      return;
    }

    jsmediatags.read(file, {
      onSuccess: (tag) => {
        const tags = tag.tags || {};
        let coverBase64 = null;

        // Process embedded picture (APIC)
        if (tags.picture) {
          const { data, format } = tags.picture;
          let base64String = "";
          for (let i = 0; i < data.length; i++) {
            base64String += String.fromCharCode(data[i]);
          }
          coverBase64 = `data:${format};base64,${window.btoa(base64String)}`;
        }

        resolve({
          title: tags.title ? cleanSongMetadataString(tags.title) : null,
          artist: tags.artist ? cleanSongMetadataString(tags.artist) : null,
          album: tags.album ? cleanSongMetadataString(tags.album) : null,
          year: tags.year ? cleanSongMetadataString(tags.year.toString()) : null,
          genre: tags.genre ? cleanSongMetadataString(tags.genre) : null,
          coverArt: coverBase64
        });
      },
      onError: (error) => {
        console.log("No ID3 metadata found or error reading tags:", error);
        resolve(null);
      }
    });
  });
}

// Global function to add a song dynamically into the active 3D carousel
async function addSongToCollection(songData, selectAfterAdding = true) {
  const newIndex = SONGS.length;
  SONGS.push(songData);

  if (typeof createCDMeshForSong === 'function') {
    await createCDMeshForSong(songData, newIndex);
  }

  if (typeof renderDropdownItems === 'function') {
    renderDropdownItems();
  }

  if (typeof updateDiscArc === 'function') {
    updateDiscArc();
  }

  if (selectAfterAdding && typeof selectSong === 'function') {
    selectSong(newIndex, true, { source: 'add-song' });
  }
}

/* ========================================================
   BATCH DRAG-AND-DROP CONTROLLER FOR AUDIO FILES
   Processes lists/batches of audio files dropped anywhere on window
   ======================================================== */
function showToast(message, isPersistent = false) {
  const toast = document.getElementById('batch-toast');
  const toastText = document.getElementById('batch-toast-text');
  const spinner = document.getElementById('batch-toast-spinner');
  if (!toast || !toastText) return;

  toastText.textContent = message;
  if (spinner) spinner.style.display = isPersistent ? 'block' : 'none';
  toast.classList.add('is-visible');

  if (!isPersistent) {
    setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 3800);
  }
}

function hideToast() {
  const toast = document.getElementById('batch-toast');
  if (toast) toast.classList.remove('is-visible');
}

// Convert a single File object into a complete AuriX Song record
async function processAudioFileToSong(file) {
  const audioBlob = file;
  const audioSrc = URL.createObjectURL(file);

  // 1. Try extracting ID3 metadata and embedded APIC cover art
  const tags = await extractID3Tags(file);

  let title = '';
  let artist = '';
  let album = '';
  let year = '';
  let genre = '';
  let coverArt = '';

  if (tags) {
    title = (tags.title || '').trim();
    artist = (tags.artist || '').trim();
    album = (tags.album || '').trim();
    year = (tags.year || '').toString().trim();
    genre = (tags.genre || '').trim();
    coverArt = tags.coverArt || '';
  }

  // 2. Intelligent fallback parsing from filename: "Artist - Title.mp3"
  if (!title || !artist) {
    const rawClean = file.name.replace(/\.[^/.]+$/, "");
    const cleanName = cleanSongMetadataString(rawClean);
    if (cleanName.includes('-')) {
      const parts = cleanName.split('-');
      if (!artist) artist = cleanSongMetadataString(parts[0]);
      if (!title) title = cleanSongMetadataString(parts.slice(1).join('-'));
    } else {
      if (!title) title = cleanSongMetadataString(cleanName);
      if (!artist) artist = 'Unknown Artist';
    }
  }

  title = cleanSongMetadataString(title);
  artist = cleanSongMetadataString(artist);
  album = cleanSongMetadataString(album);
  genre = cleanSongMetadataString(genre);

  if (!title) title = 'UNTITLED TRACK';
  if (!artist) artist = 'Unknown Artist';
  if (!album) album = 'Single';
  if (!year) year = new Date().getFullYear().toString();
  if (!genre) genre = 'Audiophile Master';

  const songId = 'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

  const songRecord = {
    id: songId,
    title: title.toUpperCase(),
    artist: artist,
    album: album,
    year: year,
    genre: genre,
    audioSrc: audioSrc,
    artFile: coverArt,
    artDataUrl: coverArt,
    accent: '#2a2a2a',
    textColor: '#ffffff',
    bgColor: '#121214',
    reviews: [
      { pub: 'AURIX DISCS', quote: 'AUTOMATICALLY CURATED AUDIOPHILE PRESSING' },
      { pub: 'MASTER TAPE', quote: 'RAW HIGH-FIDELITY MASTER AUDIO' }
    ],
    isCustom: true
  };

  // Persist to IndexedDB
  saveCustomSongToDB({
    ...songRecord,
    audioBlob: audioBlob
  });

  return songRecord;
}

// Batch import multiple files
async function handleBatchAudioFiles(files) {
  if (!files || !files.length) return;

  const audioFiles = Array.from(files).filter(file => {
    return file.type.startsWith('audio/') || /\.(mp3|wav|flac|m4a|aac|ogg|wma)$/i.test(file.name);
  });

  if (!audioFiles.length) {
    showToast('No valid audio files (MP3/WAV/FLAC/AAC) found in dropped items.');
    return;
  }

  showToast(`Creating 3D CDs for ${audioFiles.length} track(s)...`, true);

  const startIndex = SONGS.length;
  let addedCount = 0;

  for (let i = 0; i < audioFiles.length; i++) {
    const file = audioFiles[i];
    try {
      showToast(`Generating CD ${i + 1} of ${audioFiles.length}: ${file.name}...`, true);
      const songRecord = await processAudioFileToSong(file);
      // Add each disc into 3D scene (don't select immediately for all, only last or first)
      await addSongToCollection(songRecord, false);
      addedCount++;
    } catch (err) {
      console.warn(`Failed to process audio file "${file.name}":`, err);
    }
  }

  // Update carousel positioning and jump to the newly added CDs
  if (typeof updateDiscArc === 'function') {
    updateDiscArc();
  }

  if (addedCount > 0 && typeof selectSong === 'function') {
    selectSong(startIndex, true, { source: 'batch-drop' });
  }

  showToast(`✓ Created ${addedCount} 3D CD(s)! Hover on dropdown or click "Edit Info" to adjust metadata.`);
}

function initGlobalDragAndDrop() {
  const overlay = document.getElementById('global-drag-overlay');
  let dragCounter = 0;

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    // Only trigger for file drags
    if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      dragCounter++;
      if (overlay) overlay.classList.add('is-active');
    }
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      if (overlay) overlay.classList.remove('is-active');
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    if (overlay) overlay.classList.remove('is-active');

    // If modal is currently open and drop is on specific dropzones, let them handle it
    const modal = document.getElementById('add-song-modal');
    if (modal && modal.classList.contains('is-open')) {
      const artZone = document.getElementById('art-dropzone');
      const audioZone = document.getElementById('audio-dropzone');
      if (artZone && artZone.contains(e.target)) return;
      if (audioZone && audioZone.contains(e.target)) return;
    }

    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      handleBatchAudioFiles(e.dataTransfer.files);
    }
  });
}

// Global function to update an existing song's metadata and refresh 3D CD texture
async function updateSongMetadata(songIndex, updatedData) {
  if (songIndex < 0 || songIndex >= SONGS.length) return;
  const song = SONGS[songIndex];

  // Merge updated fields
  Object.assign(song, updatedData);

  // If artwork changed or title/artist changed, regenerate the 3D CD front face texture
  if (discMeshes[songIndex]) {
    const meshGroup = discMeshes[songIndex];
    meshGroup.userData.song = song;

    if (typeof createCDTextureForSong === 'function') {
      const newTex = await createCDTextureForSong(song);
      // Front mesh is the first child in spinGroup
      if (meshGroup.userData.spinGroup && meshGroup.userData.spinGroup.children[0]) {
        const frontMesh = meshGroup.userData.spinGroup.children[0];
        if (frontMesh.material) {
          frontMesh.material.map = newTex;
          frontMesh.material.needsUpdate = true;
        }
      }
    }
  }

  // Refresh HUD panel if this is currently the active song
  if (songIndex === activeIndex) {
    const titleEl = document.getElementById('song-title');
    const artistEl = document.getElementById('song-artist');
    const yearEl = document.getElementById('song-year');
    const albumEl = document.getElementById('song-album');
    const r1Pub = document.getElementById('rev1-pub');
    const r1Quote = document.getElementById('rev1-quote');
    const r2Pub = document.getElementById('rev2-pub');
    const r2Quote = document.getElementById('rev2-quote');

    if (titleEl) titleEl.textContent = song.title;
    if (artistEl) artistEl.textContent = song.artist;
    if (yearEl) yearEl.textContent = song.year;
    if (albumEl) albumEl.textContent = song.album;

    if (r1Pub && song.reviews && song.reviews[0]) r1Pub.textContent = song.reviews[0].pub;
    if (r1Quote && song.reviews && song.reviews[0]) r1Quote.textContent = `“${song.reviews[0].quote}”`;
    if (r2Pub && song.reviews && song.reviews[1]) r2Pub.textContent = song.reviews[1].pub;
    if (r2Quote && song.reviews && song.reviews[1]) r2Quote.textContent = `“${song.reviews[1].quote}”`;
  }

  // Refresh Dropdown list
  if (typeof renderDropdownItems === 'function') {
    renderDropdownItems();
  }

  // Persist edit
  saveMetadataEditToDB(song.id, {
    title: song.title,
    artist: song.artist,
    album: song.album,
    year: song.year,
    genre: song.genre,
    artFile: song.artFile,
    artDataUrl: song.artDataUrl,
    reviews: song.reviews
  });
}

/* ========================================================
   MODAL CONTROLLER: ADD & EDIT SONG MODES
   ======================================================== */
let currentModalMode = 'add'; // 'add' or 'edit'
let editingSongIndex = -1;

function initSongModalController() {
  const addSongBtn = document.getElementById('nav-add-song-btn');
  const editCurrentBtn = document.getElementById('edit-current-song-btn');
  const modal = document.getElementById('add-song-modal');
  const modalOverlay = document.getElementById('add-song-modal-overlay');
  const modalCloseBtn = document.getElementById('add-song-modal-close');
  const modalTitle = document.getElementById('modal-heading');
  const submitBtn = document.getElementById('add-song-submit-btn');
  const submitBtnText = document.getElementById('submit-btn-text');
  const form = document.getElementById('add-song-form');

  const audioSection = document.getElementById('form-audio-section');
  const audioFileInput = document.getElementById('song-audio-file');
  const audioUrlInput = document.getElementById('song-audio-url');
  const audioFilenameDisplay = document.getElementById('audio-filename-display');
  const audioDropzone = document.getElementById('audio-dropzone');
  const tagStatusNotice = document.getElementById('tag-status-notice');

  const artFileInput = document.getElementById('song-art-file');
  const artUrlInput = document.getElementById('song-art-url');
  const artPreview = document.getElementById('art-preview-img');
  const artPlaceholder = document.getElementById('art-preview-placeholder');
  const artDropzone = document.getElementById('art-dropzone');

  const titleInput = document.getElementById('song-input-title');
  const artistInput = document.getElementById('song-input-artist');
  const albumInput = document.getElementById('song-input-album');
  const yearInput = document.getElementById('song-input-year');
  const genreInput = document.getElementById('song-input-genre');
  const rev1Pub = document.getElementById('song-input-rev1-pub');
  const rev1Quote = document.getElementById('song-input-rev1-quote');
  const rev2Pub = document.getElementById('song-input-rev2-pub');
  const rev2Quote = document.getElementById('song-input-rev2-quote');

  let currentArtworkData = '';

  function updateArtPreview(src) {
    currentArtworkData = src || '';
    if (src) {
      artPreview.src = src;
      artPreview.style.display = 'block';
      if (artPlaceholder) artPlaceholder.style.display = 'none';
    } else {
      artPreview.src = '';
      artPreview.style.display = 'none';
      if (artPlaceholder) artPlaceholder.style.display = 'flex';
    }
  }

  function openAddMode() {
    currentModalMode = 'add';
    editingSongIndex = -1;
    if (modalTitle) modalTitle.textContent = 'Add to Disc Collection';
    if (submitBtnText) submitBtnText.textContent = 'Add Song to Disc Collection';
    if (audioSection) audioSection.style.display = 'block';
    if (tagStatusNotice) tagStatusNotice.style.display = 'none';

    form.reset();
    updateArtPreview('');
    if (audioFilenameDisplay) audioFilenameDisplay.style.display = 'none';
    if (yearInput) yearInput.value = new Date().getFullYear().toString();

    modal.classList.add('is-open');
    if (typeof closeDropdown === 'function') closeDropdown();
  }

  function openEditMode(songIndex) {
    if (songIndex < 0 || songIndex >= SONGS.length) return;
    currentModalMode = 'edit';
    editingSongIndex = songIndex;
    const song = SONGS[songIndex];

    if (modalTitle) modalTitle.textContent = `Edit Disc — ${song.title}`;
    if (submitBtnText) submitBtnText.textContent = 'Save Metadata & Update Disc';
    if (audioSection) audioSection.style.display = 'none'; // Audio is already attached
    if (tagStatusNotice) tagStatusNotice.style.display = 'none';

    // Populate existing values
    if (titleInput) titleInput.value = song.title || '';
    if (artistInput) artistInput.value = song.artist || '';
    if (albumInput) albumInput.value = song.album || '';
    if (yearInput) yearInput.value = song.year || '';
    if (genreInput) genreInput.value = song.genre || '';

    if (rev1Pub) rev1Pub.value = (song.reviews && song.reviews[0]) ? song.reviews[0].pub : '';
    if (rev1Quote) rev1Quote.value = (song.reviews && song.reviews[0]) ? song.reviews[0].quote : '';
    if (rev2Pub) rev2Pub.value = (song.reviews && song.reviews[1]) ? song.reviews[1].pub : '';
    if (rev2Quote) rev2Quote.value = (song.reviews && song.reviews[1]) ? song.reviews[1].quote : '';

    updateArtPreview(song.artDataUrl || song.artFile || '');

    modal.classList.add('is-open');
    if (typeof closeDropdown === 'function') closeDropdown();
  }

  // Expose openEditMode globally so Index roster or buttons can trigger edit
  window.openEditSongModal = openEditMode;

  function closeModal() {
    modal.classList.remove('is-open');
  }

  if (addSongBtn) addSongBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openAddMode();
  });

  if (editCurrentBtn) editCurrentBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openEditMode(activeIndex);
  });

  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
  if (modalOverlay) modalOverlay.addEventListener('click', closeModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) {
      closeModal();
    }
  });

  /* ========================================================
     AUTOMATIC ID3 TAG & ARTWORK PARSING ON AUDIO SELECTION
     ======================================================== */
  async function handleAudioFileSelect(file) {
    if (!file) return;

    if (audioFilenameDisplay) {
      audioFilenameDisplay.textContent = file.name;
      audioFilenameDisplay.style.display = 'block';
    }

    if (tagStatusNotice) {
      tagStatusNotice.style.display = 'block';
      tagStatusNotice.textContent = 'Reading ID3 audio metadata...';
      tagStatusNotice.className = 'tag-status is-reading';
    }

    // 1. Try reading real ID3 embedded tags with jsmediatags
    const tags = await extractID3Tags(file);

    if (tags && (tags.title || tags.artist || tags.album || tags.coverArt)) {
      if (tags.title && (!titleInput.value || currentModalMode === 'add')) {
        titleInput.value = cleanSongMetadataString(tags.title);
      }
      if (tags.artist && (!artistInput.value || currentModalMode === 'add')) {
        artistInput.value = cleanSongMetadataString(tags.artist);
      }
      if (tags.album && (!albumInput.value || currentModalMode === 'add')) {
        albumInput.value = cleanSongMetadataString(tags.album);
      }
      if (tags.year && (!yearInput.value || currentModalMode === 'add')) {
        yearInput.value = cleanSongMetadataString(tags.year);
      }
      if (tags.genre && (!genreInput.value || currentModalMode === 'add')) {
        genreInput.value = cleanSongMetadataString(tags.genre);
      }
      if (tags.coverArt) {
        updateArtPreview(tags.coverArt);
      }

      if (tagStatusNotice) {
        tagStatusNotice.textContent = `✓ Auto-extracted clean metadata & album art from ID3 tags`;
        tagStatusNotice.className = 'tag-status is-success';
      }
    } else {
      // 2. Intelligent filename fallback parser: "Artist - Title.mp3"
      const rawClean = file.name.replace(/\.[^/.]+$/, "");
      const cleanName = cleanSongMetadataString(rawClean);
      if (cleanName.includes('-')) {
        const parts = cleanName.split('-');
        if (!artistInput.value) artistInput.value = cleanSongMetadataString(parts[0]);
        if (!titleInput.value) titleInput.value = cleanSongMetadataString(parts.slice(1).join('-'));
      } else {
        if (!titleInput.value) titleInput.value = cleanSongMetadataString(cleanName);
      }

      if (tagStatusNotice) {
        tagStatusNotice.textContent = `Parsed title from filename. You can edit any details below.`;
        tagStatusNotice.className = 'tag-status is-info';
      }
    }
  }

  if (audioFileInput) {
    audioFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      handleAudioFileSelect(file);
    });
  }

  // Cover Artwork picker
  if (artFileInput) {
    artFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => updateArtPreview(ev.target.result);
        reader.readAsDataURL(file);
      }
    });
  }

  if (artUrlInput) {
    artUrlInput.addEventListener('input', () => {
      if (artUrlInput.value.trim() && (!artFileInput.files || !artFileInput.files.length)) {
        updateArtPreview(artUrlInput.value.trim());
      }
    });
  }

  // Drag-and-drop support for Audio Dropzone
  if (audioDropzone) {
    ['dragenter', 'dragover'].forEach(name => {
      audioDropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        audioDropzone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(name => {
      audioDropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        audioDropzone.classList.remove('is-dragover');
      });
    });
    audioDropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt.files && dt.files[0]) {
        audioFileInput.files = dt.files;
        handleAudioFileSelect(dt.files[0]);
      }
    });
  }

  // Drag-and-drop support for Art Dropzone
  if (artDropzone) {
    ['dragenter', 'dragover'].forEach(name => {
      artDropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        artDropzone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(name => {
      artDropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        artDropzone.classList.remove('is-dragover');
      });
    });
    artDropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt.files && dt.files[0]) {
        artFileInput.files = dt.files;
        const reader = new FileReader();
        reader.onload = (ev) => updateArtPreview(ev.target.result);
        reader.readAsDataURL(dt.files[0]);
      }
    });
  }

  // Form Submit (Handles both ADD and EDIT modes)
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const title = (titleInput.value || '').trim() || 'UNTITLED TRACK';
      const artist = (artistInput.value || '').trim() || 'UNKNOWN ARTIST';
      const album = (albumInput.value || '').trim() || 'SINGLE';
      const year = (yearInput.value || '').trim() || new Date().getFullYear().toString();
      const genre = (genreInput.value || '').trim() || 'Audiophile Master';
      const r1P = (rev1Pub.value || '').trim() || 'AURIX SELECTION';
      const r1Q = (rev1Quote.value || '').trim() || 'CAPTIVATING AND IMMERSIVE AUDIO PRODUCTION';
      const r2P = (rev2Pub.value || '').trim() || 'MASTER TAPE';
      const r2Q = (rev2Quote.value || '').trim() || 'PRISTINE SONIC CLARITY AND RICH FREQUENCY RESPONSE';

      const origSubmitText = submitBtnText ? submitBtnText.textContent : 'Save';
      if (submitBtn) {
        submitBtn.disabled = true;
        if (submitBtnText) submitBtnText.textContent = 'Processing Disc...';
      }

      try {
        if (currentModalMode === 'edit') {
          // --- EDIT MODE ---
          const updatedData = {
            title: title.toUpperCase(),
            artist: artist,
            album: album,
            year: year,
            genre: genre,
            reviews: [
              { pub: r1P.toUpperCase(), quote: r1Q.toUpperCase() },
              { pub: r2P.toUpperCase(), quote: r2Q.toUpperCase() }
            ]
          };

          if (currentArtworkData) {
            updatedData.artDataUrl = currentArtworkData;
            updatedData.artFile = currentArtworkData;
          }

          await updateSongMetadata(editingSongIndex, updatedData);
          closeModal();

        } else {
          // --- ADD MODE ---
          let audioSrc = '';
          let audioBlob = null;
          if (audioFileInput.files && audioFileInput.files[0]) {
            const file = audioFileInput.files[0];
            audioBlob = file;
            audioSrc = URL.createObjectURL(file);
          } else if (audioUrlInput.value.trim()) {
            audioSrc = audioUrlInput.value.trim();
          } else {
            alert('Please select an audio file (MP3/WAV/AAC) or provide an audio URL.');
            if (submitBtn) {
              submitBtn.disabled = false;
              if (submitBtnText) submitBtnText.textContent = origSubmitText;
            }
            return;
          }

          const songId = 'custom-' + Date.now();
          const newSong = {
            id: songId,
            title: title.toUpperCase(),
            artist: artist,
            album: album,
            year: year,
            genre: genre,
            audioSrc: audioSrc,
            artFile: currentArtworkData || '',
            artDataUrl: currentArtworkData || '',
            accent: '#3c3c3c',
            textColor: '#ffffff',
            bgColor: '#101010',
            reviews: [
              { pub: r1P.toUpperCase(), quote: r1Q.toUpperCase() },
              { pub: r2P.toUpperCase(), quote: r2Q.toUpperCase() }
            ],
            isCustom: true
          };

          // Save to IndexedDB
          saveCustomSongToDB({
            ...newSong,
            audioBlob: audioBlob
          });

          // Add to 3D carousel
          await addSongToCollection(newSong, true);
          closeModal();
        }
      } catch (err) {
        console.error('Error in song modal:', err);
        alert('An error occurred: ' + err.message);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          if (submitBtnText) submitBtnText.textContent = origSubmitText;
        }
      }
    });
  }
}

// Restore saved custom songs and saved metadata edits on page load
async function restoreSavedData() {
  const { customSongs, edits } = await loadAllStoredData();

  // Apply edits to built-in songs if any
  if (edits && edits.length > 0) {
    edits.forEach(edit => {
      const match = SONGS.find(s => s.id === edit.id);
      if (match) {
        Object.assign(match, edit.data);
      }
    });
  }

  // Restore custom songs
  if (customSongs && customSongs.length > 0) {
    for (const item of customSongs) {
      let audioSrc = item.audioSrc;
      if (item.audioBlob) {
        audioSrc = URL.createObjectURL(item.audioBlob);
      }
      const songData = {
        ...item,
        audioSrc: audioSrc
      };

      // Also apply edits to custom songs if saved
      const customEdit = edits.find(e => e.id === songData.id);
      if (customEdit) {
        Object.assign(songData, customEdit.data);
      }

      await addSongToCollection(songData, false);
    }
  }

  // Re-render dropdown with all songs restored
  if (typeof renderDropdownItems === 'function') {
    renderDropdownItems();
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initSongModalController();
    initGlobalDragAndDrop();
    restoreSavedData();
  });
} else {
  initSongModalController();
  initGlobalDragAndDrop();
  restoreSavedData();
}
