/* ========================================================
   AURIX — BETTERLYRICS & APPLE MUSIC FLUID KINETIC LYRICS ENGINE
   - Time-synchronized per-line progressive display
   - Optical depth-of-field blur on past/upcoming lines
   - Spring-scrolling physics with GSAP
   - 3D physical disc stacking animation on left
   - Dynamic ambient album color glow
   - Interactive click-to-seek
   - Offline bundled lyrics & LRCLIB on-demand fallback
   ======================================================== */

(function () {
  'use strict';

  let isLyricsMode = false;
  window.isLyricsMode = isLyricsMode;

  let currentLyricLines = [];
  let currentActiveLineIdx = -1;
  let lyricsCache = {};

  function getActiveIndex() {
    if (typeof activeIndex !== 'undefined') return activeIndex;
    if (typeof window !== 'undefined' && typeof window.activeIndex !== 'undefined') return window.activeIndex;
    return 0;
  }

  function getCarouselOffset() {
    if (typeof carouselOffset !== 'undefined') return carouselOffset;
    if (typeof window !== 'undefined' && typeof window.carouselOffset !== 'undefined') return window.carouselOffset;
    return getActiveIndex();
  }

  // Expose global references from cd-scene if not already exposed
  if (typeof galleryGroup !== 'undefined' && !window.galleryGroup) {
    window.galleryGroup = galleryGroup;
  }
  if (typeof discMeshes !== 'undefined' && !window.discMeshes) {
    window.discMeshes = discMeshes;
  }

  /* --------------------------------------------------------
     1. PARSE SYNCHRONIZED LRC FORMAT
     -------------------------------------------------------- */
  function parseLRC(lrcText) {
    if (!lrcText || typeof lrcText !== 'string') return [];
    const lines = lrcText.split('\n');
    const result = [];
    const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;

    for (const raw of lines) {
      const match = timeRegex.exec(raw);
      if (match) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const ms = match[3] ? parseFloat('0.' + match[3]) : 0;
        const time = min * 60 + sec + ms;
        const text = match[4].trim();
        if (text) {
          result.push({ time, text });
        }
      }
    }
    result.sort((a, b) => a.time - b.time);

    // Compute word-level timing for every line (Apple Music / BetterLyrics style)
    for (let i = 0; i < result.length; i++) {
      const line = result[i];
      const nextLine = result[i + 1];
      const lineDuration = nextLine ? Math.max(0.8, nextLine.time - line.time) : 4.5;

      const rawWords = line.text.split(/\s+/).filter(Boolean);
      if (!rawWords.length) {
        line.words = [];
        continue;
      }

      // Vocal delivery takes around 78% of line interval, with natural breathing pause before next line
      const vocalDuration = Math.max(0.6, Math.min(lineDuration * 0.78, rawWords.length * 0.75));

      // Weight each word by syllable/character count so syllables get realistic singing duration
      const weights = rawWords.map(w => Math.max(1, w.replace(/[^a-zA-Z0-9]/g, '').length));
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);

      let currentOffset = 0;
      line.words = rawWords.map((wordText, wIdx) => {
        const duration = (weights[wIdx] / totalWeight) * vocalDuration;
        const wordStart = line.time + currentOffset;
        const wordEnd = wordStart + duration;
        currentOffset += duration;
        return {
          text: wordText,
          time: Math.round(wordStart * 100) / 100,
          endTime: Math.round(wordEnd * 100) / 100
        };
      });
    }

    return result;
  }

  /* --------------------------------------------------------
     2. FETCH OR LOAD SYNCHRONIZED LYRICS
     -------------------------------------------------------- */
  async function getLyricsForSong(song) {
    if (!song) return [];

    // 1. Check in-memory cache
    if (lyricsCache[song.id]) {
      return lyricsCache[song.id];
    }

    // 2. Check pre-bundled AURIX_LYRICS database
    const db = (typeof AURIX_LYRICS !== 'undefined' ? AURIX_LYRICS : (window.AURIX_LYRICS || {}));
    const key = song.id || (song.title ? song.title.toLowerCase().replace(/[^a-z0-9]/g, '-') : '');
    
    let entry = db[song.id] || db[key];
    if (!entry && song.title) {
      const normTitle = song.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const [k, v] of Object.entries(db)) {
        const normKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normKey.includes(normTitle) || normTitle.includes(normKey)) {
          entry = v;
          break;
        }
      }
    }

    if (entry && entry.synced) {
      const parsed = parseLRC(entry.synced);
      lyricsCache[song.id] = parsed;
      return parsed;
    }

    // 3. Check song object's own lyrics
    if (song.syncedLyrics) {
      const parsed = parseLRC(song.syncedLyrics);
      lyricsCache[song.id] = parsed;
      return parsed;
    }

    // 4. Online on-demand fallback: LRCLIB public API (zero-config, free)
    try {
      const query = new URLSearchParams({
        artist_name: song.artist,
        track_name: song.title
      });
      const resp = await fetch(`https://lrclib.net/api/get?${query.toString()}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.syncedLyrics) {
          const parsed = parseLRC(data.syncedLyrics);
          lyricsCache[song.id] = parsed;
          return parsed;
        } else if (data && data.plainLyrics) {
          // If only plain lyrics available, format as spaced lines
          const plainLines = data.plainLyrics.split('\n').filter(t => t.trim());
          const dummy = plainLines.map((t, idx) => ({ time: idx * 5, text: t.trim() }));
          lyricsCache[song.id] = dummy;
          return dummy;
        }
      }
    } catch (err) {
      console.warn("Could not fetch online lyrics from LRCLIB:", err);
    }

    return [];
  }

  /* --------------------------------------------------------
     3. RENDER LYRICS DOM ELEMENTS
     -------------------------------------------------------- */
  async function loadAndRenderLyrics(songIdx) {
    const allSongs = (typeof SONGS !== 'undefined' ? SONGS : window.SONGS) || [];
    const song = allSongs[songIdx];
    if (!song) return;

    const scroller = document.getElementById('lyrics-scroller');
    const headerTitle = document.getElementById('lyrics-header-title');
    const headerArtist = document.getElementById('lyrics-header-artist');
    const headerAlbum = document.getElementById('lyrics-header-album') || document.querySelector('.lyrics-header-eyebrow');

    if (headerAlbum) headerAlbum.textContent = (song.album || '').toUpperCase();
    if (headerTitle) headerTitle.textContent = (song.title || '').toUpperCase();
    if (headerArtist) headerArtist.textContent = song.artist || '';

    if (!scroller) return;
    scroller.innerHTML = '<div class="lyrics-loading">Loading lyrics...</div>';
    currentActiveLineIdx = -1;

    currentLyricLines = await getLyricsForSong(song);

    if (!currentLyricLines || !currentLyricLines.length) {
      scroller.innerHTML = `
        <div class="lyrics-empty">
          <div class="lyrics-empty-icon">♪</div>
          <div class="lyrics-empty-title">Instrumental Track</div>
          <div class="lyrics-empty-sub">No vocal lyrics available for this recording</div>
        </div>
      `;
      return;
    }

    scroller.innerHTML = '';
    currentLyricLines.forEach((line, idx) => {
      const lineEl = document.createElement('div');
      lineEl.className = 'lyric-line';
      lineEl.setAttribute('data-idx', idx);
      lineEl.setAttribute('data-time', line.time);

      if (line.words && line.words.length) {
        line.words.forEach((word, wIdx) => {
          const wordEl = document.createElement('span');
          wordEl.className = 'lyric-word is-unsung';
          wordEl.setAttribute('data-line-idx', idx);
          wordEl.setAttribute('data-word-idx', wIdx);
          wordEl.setAttribute('data-time', word.time);
          wordEl.setAttribute('data-end', word.endTime);
          wordEl.textContent = word.text;

          // Click or touch on individual word jumps audio directly to this word
          const onWordClick = (e) => {
            if (e) {
              e.preventDefault();
              e.stopPropagation();
            }
            seekAudioToTime(word.time);
          };

          wordEl.addEventListener('click', onWordClick);
          wordEl.addEventListener('touchend', onWordClick);

          lineEl.appendChild(wordEl);
        });
      } else {
        lineEl.textContent = line.text;
      }

      // Clicking line background seeks to line start
      lineEl.addEventListener('click', (e) => {
        if (e.target !== lineEl) return;
        seekAudioToTime(line.time);
      });

      scroller.appendChild(lineEl);
    });

    // Reset scroller position
    if (typeof gsap !== 'undefined') {
      gsap.set(scroller, { y: 0 });
    } else {
      scroller.style.transform = 'translateY(0px)';
    }

    // Immediately trigger line highlight based on current playback time
    const audio = document.getElementById('real-audio-player');
    if (audio) {
      updateLyricsTime(audio.currentTime, true);
    }
  }
  window.loadAndRenderLyrics = loadAndRenderLyrics;
  window.loadLyricsForSong = loadAndRenderLyrics;

  /* --------------------------------------------------------
     4. DIRECT AUDIO SEEK CONTROLLER
     Jump to exact lyric/word timestamp with robust audio state handling
     -------------------------------------------------------- */
  function seekAudioToTime(targetTime) {
    const audio = document.getElementById('real-audio-player');
    if (!audio) return;

    const doSeek = () => {
      try {
        audio.currentTime = targetTime;
      } catch (err) {
        console.warn("Could not set currentTime immediately:", err);
      }
      updateLyricsTime(targetTime, true);
      if (audio.paused) {
        const p = audio.play();
        if (p !== undefined) {
          p.then(() => {
            if (typeof setPlayState === 'function') setPlayState(true);
          }).catch(err => {
            console.warn("Audio play prevented:", err);
          });
        }
      } else {
        if (typeof setPlayState === 'function') setPlayState(true);
      }
    };

    if (isNaN(audio.duration) || audio.readyState < 1) {
      const onReady = () => {
        audio.removeEventListener('loadedmetadata', onReady);
        audio.removeEventListener('canplay', onReady);
        doSeek();
      };
      audio.addEventListener('loadedmetadata', onReady);
      audio.addEventListener('canplay', onReady);
      audio.load();
      audio.play().catch(() => {});
    } else {
      doSeek();
    }
  }
  window.seekAudioToTime = seekAudioToTime;

  /* --------------------------------------------------------
     5. REAL-TIME WORD-BY-WORD PLAYHEAD SYNC & SPRING SCROLL
     (Apple Music / BetterLyrics style karaoke illumination)
     -------------------------------------------------------- */
  function updateLyricsTime(currentTime, instant = false) {
    if (!isLyricsMode || !currentLyricLines || !currentLyricLines.length) return;

    // Determine current active lyric line (with slight 0.08s anticipation)
    const playTime = currentTime + 0.08;
    let activeIdx = -1;

    for (let i = 0; i < currentLyricLines.length; i++) {
      if (currentLyricLines[i].time <= playTime) {
        activeIdx = i;
      } else {
        break;
      }
    }

    const lineChanged = (activeIdx !== currentActiveLineIdx);
    if (lineChanged || instant) {
      currentActiveLineIdx = activeIdx;

      const scroller = document.getElementById('lyrics-scroller');
      if (scroller) {
        const allLineEls = scroller.querySelectorAll('.lyric-line');
        allLineEls.forEach((el, idx) => {
          el.classList.remove('is-active', 'is-past', 'is-future');
          if (idx === activeIdx) {
            el.classList.add('is-active');
          } else if (idx < activeIdx) {
            el.classList.add('is-past');
            // Past line: all words are already sung
            el.querySelectorAll('.lyric-word').forEach(w => {
              w.classList.remove('is-current-word', 'is-unsung');
              w.classList.add('is-sung');
            });
          } else {
            el.classList.add('is-future');
            // Future line: all words are unsung
            el.querySelectorAll('.lyric-word').forEach(w => {
              w.classList.remove('is-current-word', 'is-sung');
              w.classList.add('is-unsung');
            });
          }
        });

        if (activeIdx >= 0 && allLineEls[activeIdx]) {
          const activeEl = allLineEls[activeIdx];
          const viewport = scroller.parentElement;
          const viewportHeight = viewport ? viewport.clientHeight : 500;
          const lineTop = activeEl.offsetTop;
          const lineHeight = activeEl.offsetHeight;

          // Apple Music focal position: roughly 38% from top of viewport
          const targetScroll = Math.max(0, lineTop - (viewportHeight * 0.38) + (lineHeight / 2));

          if (instant || typeof gsap === 'undefined') {
            scroller.style.transform = `translateY(${-targetScroll}px)`;
          } else {
            // Fluid spring-like ease for organic Apple Music feel
            gsap.to(scroller, {
              y: -targetScroll,
              duration: 0.68,
              ease: "power2.out",
              overwrite: "auto"
            });
          }
        }
      }
    }

    // Update word-by-word progression in the active line
    updateActiveLineWords(currentTime);
  }
  window.updateLyricsTime = updateLyricsTime;

  /* Real-time word illumination within the actively singing line */
  function updateActiveLineWords(currentTime) {
    if (currentActiveLineIdx < 0 || !currentLyricLines) return;
    const activeLine = currentLyricLines[currentActiveLineIdx];
    if (!activeLine || !activeLine.words || !activeLine.words.length) return;

    const scroller = document.getElementById('lyrics-scroller');
    if (!scroller) return;
    const activeLineEl = scroller.querySelector(`.lyric-line[data-idx="${currentActiveLineIdx}"]`);
    if (!activeLineEl) return;

    const wordEls = activeLineEl.querySelectorAll('.lyric-word');
    if (!wordEls.length) return;

    const playTime = currentTime + 0.04;

    for (let k = 0; k < activeLine.words.length; k++) {
      const word = activeLine.words[k];
      const wordEl = wordEls[k];
      if (!wordEl) continue;

      if (playTime >= word.time) {
        wordEl.classList.remove('is-unsung');
        wordEl.classList.add('is-sung');

        if (playTime < word.endTime) {
          // Actively singing this specific word right now!
          wordEl.classList.add('is-current-word');
        } else {
          wordEl.classList.remove('is-current-word');
        }
      } else {
        wordEl.classList.remove('is-sung', 'is-current-word');
        wordEl.classList.add('is-unsung');
      }
    }
  }

  /* 60 FPS Fluid Lyrics Animation Loop */
  let lyricsLoopId = null;
  function startLyricsLoop() {
    if (lyricsLoopId) return;
    function loop() {
      if (isLyricsMode) {
        const audio = document.getElementById('real-audio-player');
        if (audio && !audio.paused) {
          updateLyricsTime(audio.currentTime, false);
        }
      }
      lyricsLoopId = requestAnimationFrame(loop);
    }
    lyricsLoopId = requestAnimationFrame(loop);
  }

  function stopLyricsLoop() {
    if (lyricsLoopId) {
      cancelAnimationFrame(lyricsLoopId);
      lyricsLoopId = null;
    }
  }

  function getStackGalleryX() {
    const aspect = (window.innerWidth && window.innerHeight) ? (window.innerWidth / window.innerHeight) : 1.77;
    const halfWidth = 1.601 * aspect;
    if (window.innerWidth < 768) {
      return -(halfWidth * 0.32);
    }
    if (window.innerWidth < 1024) {
      return -(halfWidth * 0.35);
    }
    return -(halfWidth * 0.38);
  }
  window.getStackGalleryX = getStackGalleryX;

  function getOrigGalleryY() {
    if (window.innerWidth < 768) return 0.08;
    if (window.innerWidth < 1024) return 0.06;
    return 0.04;
  }
  window.getOrigGalleryY = getOrigGalleryY;

  function getOrigGalleryScale() {
    if (window.innerWidth < 768) return 0.85;
    if (window.innerWidth < 1024) return 0.96;
    return 1.08;
  }
  window.getOrigGalleryScale = getOrigGalleryScale;

  /* --------------------------------------------------------
     5. 3D DISC STACKING CONTROLLER (GSAP)
     Smoothly morphs horizontal carousel into a flat vertical stack on the left.
     All discs are flat with zero skew, and only the playing disc is visible on top.
     -------------------------------------------------------- */
  function animateDiscsToStack(animate = true) {
    const gallery = window.galleryGroup || (typeof galleryGroup !== 'undefined' ? galleryGroup : null);
    const meshes = window.discMeshes || (typeof discMeshes !== 'undefined' ? discMeshes : []);
    if (!gallery || !meshes.length) return;

    const N = meshes.length;
    const activeIdx = getActiveIndex();

    // 1. Shift galleryGroup to the left side using responsive focal center with exact matching Y & Scale
    const targetGalleryX = getStackGalleryX();
    const origY = getOrigGalleryY();
    const origScale = getOrigGalleryScale();

    if (animate && typeof gsap !== 'undefined') {
      gsap.killTweensOf(gallery.position);
      gsap.killTweensOf(gallery.scale);
      gsap.killTweensOf(gallery.rotation);

      gsap.to(gallery.position, {
        x: targetGalleryX,
        y: origY,
        z: 0,
        duration: 0.85,
        ease: "power3.out"
      });
      gsap.to(gallery.scale, {
        x: origScale,
        y: origScale,
        z: origScale,
        duration: 0.85,
        ease: "power3.out"
      });
      gsap.to(gallery.rotation, {
        x: 0,
        y: 0,
        z: 0,
        duration: 0.85,
        ease: "power3.out"
      });
    } else {
      gallery.position.set(targetGalleryX, origY, 0);
      gallery.scale.setScalar(origScale);
      gallery.rotation.set(0, 0, 0);
    }

    // 2. Animate discs into stack formation: flat discs, NO skew, only playing disc visible on top
    meshes.forEach((mesh, i) => {
      const ud = mesh.userData;

      if (i === activeIdx) {
        // Active Disc sits flat on TOP of the stack, completely visible, no skew
        mesh.visible = true;
        const targetX = 0;
        const targetY = 0;
        const targetZ = 0.5;
        const targetRotZ = 0;
        const targetScale = 1.0;

        ud.baseRotX = 0;
        ud.baseRotY = 0;
        ud.baseRotZ = 0;
        ud.basePosZ = targetZ;
        ud.baseScale = targetScale;
        ud.targetHover = 0;
        ud.targetTiltX = 0;
        ud.targetTiltY = 0;

        if (animate && typeof gsap !== 'undefined') {
          gsap.killTweensOf(mesh.position);
          gsap.killTweensOf(mesh.rotation);
          gsap.killTweensOf(mesh.scale);

          gsap.to(mesh.position, {
            x: targetX,
            y: targetY,
            z: targetZ,
            duration: 0.85,
            ease: "power3.out"
          });
          gsap.to(mesh.rotation, {
            x: 0,
            y: 0,
            z: 0,
            duration: 0.85,
            ease: "power3.out"
          });
          gsap.to(mesh.scale, {
            x: targetScale,
            y: targetScale,
            z: targetScale,
            duration: 0.85,
            ease: "power3.out"
          });
        } else {
          mesh.position.set(targetX, targetY, targetZ);
          mesh.rotation.set(0, 0, 0);
          mesh.scale.set(targetScale, targetScale, targetScale);
        }
      } else {
        // Inactive discs are tucked flat behind active disc with ZERO skew
        // and hidden immediately so ONLY the playing disc is visible on the top
        mesh.visible = false;
        const k = (i - activeIdx + N) % N;
        const targetZ = 0.5 - (k * 0.02);

        ud.baseRotX = 0;
        ud.baseRotY = 0;
        ud.baseRotZ = 0;
        ud.basePosZ = targetZ;
        ud.baseScale = 1.0;
        ud.targetHover = 0;
        ud.targetTiltX = 0;
        ud.targetTiltY = 0;

        if (typeof gsap !== 'undefined') {
          gsap.killTweensOf(mesh.position);
          gsap.killTweensOf(mesh.rotation);
          gsap.killTweensOf(mesh.scale);
        }
        mesh.position.set(0, 0, targetZ);
        mesh.rotation.set(0, 0, 0);
        mesh.scale.set(1.0, 1.0, 1.0);
      }
    });

    // Reposition scribble outline if active
    if (typeof snapScribbleToTarget === 'function' && meshes[activeIdx]) {
      snapScribbleToTarget(meshes[activeIdx], true);
    }
  }
  window.animateDiscsToStack = animateDiscsToStack;

  /* --------------------------------------------------------
     6. RESTORE HORIZONTAL CAROUSEL ARC (GSAP)
     Smoothly morphs stack back into authentic A24 ribbon arc with
     100% exact responsive position restoration (zero drift).
     -------------------------------------------------------- */
  function animateDiscsToCarousel(animate = true) {
    const gallery = window.galleryGroup || (typeof galleryGroup !== 'undefined' ? galleryGroup : null);
    const meshes = window.discMeshes || (typeof discMeshes !== 'undefined' ? discMeshes : []);
    if (!gallery || !meshes.length) return;

    const origY = getOrigGalleryY();
    const origScale = getOrigGalleryScale();
    const targetRot = (typeof THREE !== 'undefined' && THREE.MathUtils) 
      ? THREE.MathUtils.degToRad(-30) 
      : -0.5235987755982988;

    if (animate && typeof gsap !== 'undefined') {
      gsap.killTweensOf(gallery.position);
      gsap.killTweensOf(gallery.scale);
      gsap.killTweensOf(gallery.rotation);

      gsap.to(gallery.position, {
        x: 0,
        y: origY,
        z: 0,
        duration: 0.8,
        ease: "power3.out"
      });
      gsap.to(gallery.scale, {
        x: origScale,
        y: origScale,
        z: origScale,
        duration: 0.8,
        ease: "power3.out"
      });
      gsap.to(gallery.rotation, {
        x: targetRot,
        y: targetRot,
        z: 0,
        duration: 0.8,
        ease: "power3.out"
      });
    } else {
      gallery.position.set(0, origY, 0);
      gallery.scale.setScalar(origScale);
      gallery.rotation.set(targetRot, targetRot, 0);
    }

    const curOffset = getCarouselOffset();
    let completedCount = 0;

    meshes.forEach((mesh, i) => {
      // Make mesh visible so transition out is visible
      mesh.visible = true;

      const m = i - curOffset;
      const absDelta = Math.abs(m);

      const theta = m * 0.35;
      const x = Math.sin(theta) * 5.52;
      const y = Math.max(0, 0.06 * (1.0 - absDelta));
      const z = -Math.cos(theta) * 2.4 + 2.4;
      const s = Math.max(0.8, 1.0 - absDelta * 0.2);

      const ud = mesh.userData;
      ud.baseRotX = 0;
      ud.baseRotY = -theta;
      ud.baseRotZ = 0;
      ud.basePosZ = z;
      ud.baseScale = s;
      ud.hover = 0;
      ud.targetHover = 0;
      ud.tiltX = 0;
      ud.tiltY = 0;
      ud.targetTiltX = 0;
      ud.targetTiltY = 0;

      if (animate && typeof gsap !== 'undefined') {
        gsap.killTweensOf(mesh.position);
        gsap.killTweensOf(mesh.rotation);
        gsap.killTweensOf(mesh.scale);

        gsap.to(mesh.position, {
          x,
          y,
          z,
          duration: 0.8,
          ease: "power3.out"
        });
        gsap.to(mesh.rotation, {
          x: 0,
          y: -theta,
          z: 0,
          duration: 0.8,
          ease: "power3.out"
        });
        gsap.to(mesh.scale, {
          x: s,
          y: s,
          z: s,
          duration: 0.8,
          ease: "power3.out",
          onComplete: () => {
            completedCount++;
            if (completedCount === meshes.length) {
              if (typeof updateDiscArc === 'function' && !window.isLyricsMode) {
                updateDiscArc();
              }
            }
          }
        });
      } else {
        mesh.position.set(x, y, z);
        mesh.rotation.set(0, -theta, 0);
        mesh.scale.set(s, s, s);
        mesh.visible = absDelta < 4.0;
      }
    });

    if (!animate && typeof updateDiscArc === 'function' && !window.isLyricsMode) {
      updateDiscArc();
    }

    if (typeof snapScribbleToTarget === 'function' && meshes[getActiveIndex()]) {
      snapScribbleToTarget(meshes[getActiveIndex()], false);
    }
  }
  window.animateDiscsToCarousel = animateDiscsToCarousel;

  /* --------------------------------------------------------
     7. TOGGLE LYRICS MODE CONTROLLER
     -------------------------------------------------------- */
  function toggleLyricsMode() {
    isLyricsMode = !isLyricsMode;
    window.isLyricsMode = isLyricsMode;

    const lyricsBtn = document.getElementById('lyrics-toggle-btn');
    const lyricsView = document.getElementById('lyrics-view');
    const reviews = document.querySelector('.reviews-container');

    if (lyricsBtn) {
      lyricsBtn.classList.toggle('is-active', isLyricsMode);
    }

    if (isLyricsMode) {
      // 1. Enter Lyrics Mode: animate discs to stack & start 60FPS fluid sync loop
      startLyricsLoop();
      animateDiscsToStack(true);

      // 2. Animate Lyrics View into view
      if (lyricsView) {
        lyricsView.setAttribute('aria-hidden', 'false');
        lyricsView.classList.add('is-open');
        if (typeof gsap !== 'undefined') {
          gsap.fromTo(lyricsView, 
            { opacity: 0, x: 50 },
            { opacity: 1, x: 0, duration: 0.65, ease: "power3.out" }
          );
        }
      }

      // 3. Fade out top-left metadata and bottom reviews so left side is clean for 3D stack
      const heroInfo = document.querySelector('.hero-info-panel');
      if (heroInfo) {
        if (typeof gsap !== 'undefined') {
          gsap.to(heroInfo, { 
            opacity: 0, 
            y: -15, 
            duration: 0.35, 
            overwrite: 'all',
            onComplete: () => {
              if (isLyricsMode) heroInfo.style.visibility = 'hidden';
            }
          });
        } else {
          heroInfo.style.visibility = 'hidden';
        }
      }
      if (reviews) {
        if (typeof gsap !== 'undefined') {
          gsap.to(reviews, { 
            opacity: 0, 
            y: 15, 
            duration: 0.35, 
            overwrite: 'all',
            onComplete: () => {
              if (isLyricsMode) reviews.style.visibility = 'hidden';
            }
          });
        } else {
          reviews.style.visibility = 'hidden';
        }
      }

      // 4. Load lyrics for currently active song
      loadAndRenderLyrics(getActiveIndex());
    } else {
      // 1. Exit Lyrics Mode: stop loop & restore horizontal ribbon arc
      stopLyricsLoop();
      animateDiscsToCarousel(true);

      // 2. Animate Lyrics View out
      if (lyricsView) {
        lyricsView.setAttribute('aria-hidden', 'true');
        if (typeof gsap !== 'undefined') {
          gsap.to(lyricsView, {
            opacity: 0,
            x: 40,
            duration: 0.45,
            ease: "power2.in",
            onComplete: () => lyricsView.classList.remove('is-open')
          });
        } else {
          lyricsView.classList.remove('is-open');
        }
      }

      // 3. Fade top-left info and reviews back in
      const heroInfo = document.querySelector('.hero-info-panel');
      if (heroInfo) {
        heroInfo.style.visibility = 'visible';
        if (typeof gsap !== 'undefined') {
          gsap.to(heroInfo, { opacity: 1, y: 0, duration: 0.5, delay: 0.2, overwrite: 'all' });
        }
      }
      if (reviews) {
        reviews.style.visibility = 'visible';
        if (typeof gsap !== 'undefined') {
          gsap.to(reviews, { opacity: 1, y: 0, duration: 0.5, delay: 0.2, overwrite: 'all' });
        }
      }
    }
  }
  window.toggleLyricsMode = toggleLyricsMode;

  /* --------------------------------------------------------
     8. HOOK INTO SONG SELECTION & KEYBOARD SHORTCUTS
     -------------------------------------------------------- */
  // Listen for song changes
  window.addEventListener('aurix:songchange', (e) => {
    if (isLyricsMode) {
      const idx = e.detail?.index ?? getActiveIndex();
      animateDiscsToStack(true);
      loadAndRenderLyrics(idx);
    }
  });

  // Attach button and keyboard listeners
  function initLyricsEvents() {
    const toggleBtn = document.getElementById('lyrics-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleLyricsMode();
      });
    }

    // Keyboard shortcut: 'L' toggles lyrics mode
    window.addEventListener('keydown', (e) => {
      // Ignore if user is currently typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'l' || e.key === 'L') {
        toggleLyricsMode();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLyricsEvents);
  } else {
    initLyricsEvents();
  }

})();
