/* ========================================================
   AURIX — AUDIO PLAYER DOCK, CONTROLLER & CHROME MEDIA SESSION
   ======================================================== */

const audio = document.getElementById('real-audio-player');
const playBtn = document.getElementById('audio-play-btn');
const playSvg = document.getElementById('play-svg');
const progressBar = document.getElementById('audio-progress-bar');
const progressFill = document.getElementById('audio-progress-fill');
const timeCurrent = document.getElementById('audio-time-current');
const timeTotal = document.getElementById('audio-time-total');

function formatTime(sec) {
  if (!sec || isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Resolves artwork path to an absolute URL or data URL
 * required by Chrome / Chromium Media Session API
 */
function resolveMediaArtwork(src) {
  if (!src) return '';
  if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  }
  try {
    return new URL(src, window.location.href).href;
  } catch (e) {
    return src;
  }
}

/**
 * Updates Chrome Media Player / Global Media Controls / OS Lock Screen
 * via standard W3C Media Session API
 */
function updateMediaSessionMetadata(song) {
  if (!song) return;

  // 1. Dynamic Page & Tab Title
  document.title = `${song.title} · ${song.artist} — AuriX`;

  // 2. Chrome / OS Media Session Notification & Toolbar Controls
  if ('mediaSession' in navigator) {
    const artworkList = [];
    const rawArt = song.artFile || song.artDataUrl || song.coverArt || '';
    const artSrc = resolveMediaArtwork(rawArt);

    if (artSrc) {
      const isPng = artSrc.startsWith('data:image/png') || artSrc.toLowerCase().endsWith('.png');
      const mimeType = isPng ? 'image/png' : 'image/jpeg';
      const sizes = ['96x96', '128x128', '192x192', '256x256', '384x384', '512x512'];
      sizes.forEach(sz => {
        artworkList.push({
          src: artSrc,
          sizes: sz,
          type: mimeType
        });
      });
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title || 'Unknown Track',
        artist: song.artist || 'Unknown Artist',
        album: song.album || 'AuriX Audiophile Master',
        artwork: artworkList
      });
    } catch (err) {
      console.warn('[AuriX] Failed to set mediaSession metadata:', err);
    }

    updateMediaSessionPositionState();
  }
}

function updateMediaSessionPositionState() {
  if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
    if (audio && audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate || 1,
          position: Math.min(Math.max(0, audio.currentTime), audio.duration)
        });
      } catch (e) {
        // Ignore InvalidStateError during metadata transition
      }
    }
  }
}

function initMediaSessionActionHandlers() {
  if (!('mediaSession' in navigator)) return;

  const actionHandlers = [
    ['play', () => {
      if (audio && audio.paused) {
        audio.play().then(() => setPlayState(true)).catch(console.error);
      }
    }],
    ['pause', () => {
      if (audio && !audio.paused) {
        audio.pause();
        setPlayState(false);
      }
    }],
    ['stop', () => {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
        setPlayState(false);
      }
    }],
    ['previoustrack', () => {
      if (typeof selectSong === 'function' && typeof SONGS !== 'undefined' && SONGS.length) {
        const prev = (activeIndex - 1 + SONGS.length) % SONGS.length;
        selectSong(prev, isAudioPlaying, { source: 'mediaSession' });
      }
    }],
    ['nexttrack', () => {
      if (typeof selectSong === 'function' && typeof SONGS !== 'undefined' && SONGS.length) {
        const next = (activeIndex + 1) % SONGS.length;
        selectSong(next, isAudioPlaying, { source: 'mediaSession' });
      }
    }],
    ['seekto', (details) => {
      if (audio && details.seekTime !== undefined) {
        if (details.fastSeek && 'fastSeek' in audio) {
          audio.fastSeek(details.seekTime);
        } else {
          audio.currentTime = details.seekTime;
        }
        updateMediaSessionPositionState();
      }
    }],
    ['seekbackward', (details) => {
      if (audio) {
        const skip = details.seekOffset || 10;
        audio.currentTime = Math.max(0, audio.currentTime - skip);
        updateMediaSessionPositionState();
      }
    }],
    ['seekforward', (details) => {
      if (audio) {
        const skip = details.seekOffset || 10;
        audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + skip);
        updateMediaSessionPositionState();
      }
    }]
  ];

  for (const [action, handler] of actionHandlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (e) {
      // Browser might not support all action handlers
    }
  }
}

function loadAudioTrack(idx, autoPlay = false) {
  if (!audio || !SONGS[idx]) return;
  const song = SONGS[idx];
  audio.src = song.audioSrc;
  audio.load();

  // Instantly broadcast track metadata to Chrome Media Player & OS Controls
  updateMediaSessionMetadata(song);

  if (autoPlay) {
    audio.play().then(() => setPlayState(true)).catch(() => setPlayState(false));
  } else {
    setPlayState(false);
  }
}

function setPlayState(playing) {
  isAudioPlaying = playing;
  if (playBtn) playBtn.classList.toggle('is-playing', playing);
  if (playSvg) {
    playSvg.innerHTML = playing
      ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>' // Pause icon
      : '<path d="M8 5v14l11-7z"/>';                  // Play icon
  }
  const lyricsPlaySvg = document.getElementById('lyrics-play-svg');
  const lyricsPlayBtn = document.getElementById('lyrics-btn-play');
  if (lyricsPlayBtn) lyricsPlayBtn.classList.toggle('is-playing', playing);
  if (lyricsPlaySvg) {
    lyricsPlaySvg.innerHTML = playing
      ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
      : '<path d="M8 5v14l11-7z"/>';
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    updateMediaSessionPositionState();
  }
}

if (playBtn) {
  playBtn.addEventListener('click', () => {
    if (!audio) return;
    if (audio.paused) {
      audio.play().then(() => setPlayState(true)).catch(console.error);
    } else {
      audio.pause();
      setPlayState(false);
    }
  });
}

if (audio) {
  audio.addEventListener('loadedmetadata', () => {
    if (timeTotal) timeTotal.textContent = formatTime(audio.duration);
    updateMediaSessionPositionState();
  });

  audio.addEventListener('timeupdate', () => {
    if (window.isLyricsMode && typeof window.updateLyricsTime === 'function') {
      window.updateLyricsTime(audio.currentTime);
    }
    if (!audio.duration) return;
    const progress = (audio.currentTime / audio.duration) * 100;
    if (progressFill) progressFill.style.width = `${progress}%`;
    if (timeCurrent) timeCurrent.textContent = formatTime(audio.currentTime);
    if (timeTotal) timeTotal.textContent = formatTime(audio.duration);
  });

  audio.addEventListener('seeked', () => {
    if (window.isLyricsMode && typeof window.updateLyricsTime === 'function') {
      window.updateLyricsTime(audio.currentTime, true);
    }
    updateMediaSessionPositionState();
  });

  audio.addEventListener('ended', () => {
    if (window.isLyricsMode && typeof window.playSongEndScrollAnimation === 'function') {
      window.playSongEndScrollAnimation(() => {
        if (typeof selectSong === 'function') {
          selectSong((activeIndex + 1) % SONGS.length, true);
        }
      });
    } else if (typeof selectSong === 'function') {
      selectSong((activeIndex + 1) % SONGS.length, true);
    }
  });
}

if (progressBar && audio) {
  progressBar.addEventListener('click', (e) => {
    const rect = progressBar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = clickX / rect.width;
    audio.currentTime = pct * audio.duration;
  });
}

// Initialize Media Session action handlers and initial song metadata
initMediaSessionActionHandlers();
if (typeof SONGS !== 'undefined' && SONGS[activeIndex || 0]) {
  updateMediaSessionMetadata(SONGS[activeIndex || 0]);
}

window.updateMediaSessionMetadata = updateMediaSessionMetadata;
window.updateMediaSessionPositionState = updateMediaSessionPositionState;
window.resolveMediaArtwork = resolveMediaArtwork;
