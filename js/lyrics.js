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

    isSongEndAnimating = false;
    if (typeof anime !== 'undefined') {
      anime.remove(scroller);
    }

    // Reset scroller position
    if (typeof gsap !== 'undefined') {
      gsap.killTweensOf(scroller);
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
    if (!isLyricsMode || !currentLyricLines || !currentLyricLines.length || isSongEndAnimating) return;

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

          if (instant || typeof anime === 'undefined') {
            if (typeof gsap !== 'undefined') {
              gsap.killTweensOf(scroller);
            }
            scroller.style.transform = `translateY(${-targetScroll}px)`;
          } else {
            // Silky smooth Anime.js spring/cubic bezier interpolation
            anime.remove(scroller);
            anime({
              targets: scroller,
              translateY: -targetScroll,
              duration: 900,
              easing: 'cubicBezier(0.16, 1, 0.3, 1)'
            });
          }
        }
      }
    }

    // Update word-by-word progression in the active line
    updateActiveLineWords(currentTime);
  }
  window.updateLyricsTime = updateLyricsTime;

  /* Real-time word illumination within the actively singing line (Apple Music / BetterLyrics style) */
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
  let isSongEndAnimating = false;
  let activeTransitionTimeline = null;

  function playSongEndScrollAnimation(direction = 1, callback) {
    if (typeof direction === 'function') {
      callback = direction;
      direction = 1;
    }

    if (!isLyricsMode) {
      if (typeof callback === 'function') callback();
      return;
    }

    // If an animation is already in progress, swiftly finish or reset to prevent getting stuck
    if (isSongEndAnimating && activeTransitionTimeline) {
      try {
        if (typeof anime !== 'undefined') anime.remove('#lyrics-scroller');
        activeTransitionTimeline.pause();
        activeTransitionTimeline = null;
      } catch (e) {}
      isSongEndAnimating = false;
    }

    isSongEndAnimating = true;

    const meshes = window.discMeshes || (typeof discMeshes !== 'undefined' ? discMeshes : []);
    const N = meshes.length;
    const activeIdx = getActiveIndex();
    const targetIdx = (direction >= 0) ? ((activeIdx + 1) % N) : ((activeIdx - 1 + N) % N);
    const activeMesh = meshes[activeIdx];
    const nextMesh = meshes[targetIdx];

    const scroller = document.getElementById('lyrics-scroller');
    const allLineEls = scroller ? Array.from(scroller.querySelectorAll('.lyric-line')) : [];
    const viewport = scroller ? scroller.parentElement : null;
    const viewportH = viewport ? viewport.clientHeight : 500;
    const currentY = scroller ? (gsap.getProperty(scroller, "y") || 0) : 0;
    const endTargetY = (direction >= 0)
      ? currentY - (scroller ? scroller.scrollHeight * 0.45 : 250)
      : Math.min(0, currentY + (scroller ? scroller.scrollHeight * 0.45 : 250));

    // Clean sequential animation without physical collision/overlapping:
    // Outgoing CD swipes up (or down if prev) out of view, then incoming CD seamlessly rises into place
    const animDuration = 0.50;
    const outY = direction >= 0 ? 3.5 : -3.5;
    const inStartY = direction >= 0 ? -3.2 : 3.2;

    if (activeMesh && typeof gsap !== 'undefined') {
      gsap.killTweensOf(activeMesh.position);
      gsap.killTweensOf(activeMesh.rotation);
      gsap.killTweensOf(activeMesh.scale);

      gsap.to(activeMesh.position, {
        y: outY,
        z: 0.7,
        duration: animDuration,
        ease: "power2.in",
        onComplete: () => {
          activeMesh.visible = false;
        }
      });
      gsap.to(activeMesh.rotation, {
        x: direction >= 0 ? 0.35 : -0.35,
        duration: animDuration,
        ease: "power2.in"
      });
      gsap.to(activeMesh.scale, {
        x: 0.9,
        y: 0.9,
        z: 0.9,
        duration: animDuration,
        ease: "power2.in"
      });
    }

    if (nextMesh && N > 1 && typeof gsap !== 'undefined') {
      gsap.killTweensOf(nextMesh.position);
      gsap.killTweensOf(nextMesh.rotation);
      gsap.killTweensOf(nextMesh.scale);

      // Start cleanly outside the viewport border
      nextMesh.position.set(0, inStartY, 0.5);
      nextMesh.rotation.set(direction >= 0 ? -0.25 : 0.25, 0, 0);
      nextMesh.scale.set(0.92, 0.92, 0.92);

      // Trigger entrance once outgoing CD has cleared the stack area (no overlap)
      gsap.to(nextMesh.position, {
        x: 0,
        y: 0,
        z: 0.5,
        duration: animDuration,
        ease: "power3.out",
        delay: animDuration * 0.68,
        onStart: () => {
          nextMesh.visible = true;
        }
      });
      gsap.to(nextMesh.rotation, {
        x: 0,
        y: 0,
        z: 0,
        duration: animDuration,
        ease: "power3.out",
        delay: animDuration * 0.68
      });
      gsap.to(nextMesh.scale, {
        x: 1.0,
        y: 1.0,
        z: 1.0,
        duration: animDuration,
        ease: "power3.out",
        delay: animDuration * 0.68
      });
    }

    const onTransitionEnd = () => {
      isSongEndAnimating = false;
      activeTransitionTimeline = null;
      if (typeof callback === 'function') callback();
    };

    if (typeof anime !== 'undefined' && scroller) {
      // Use anime.js for a silky seamless scroll cascade
      anime.remove(scroller);
      if (allLineEls.length) {
        anime.remove(allLineEls);
      }

      const timeline = anime.timeline({
        easing: 'cubicBezier(0.16, 1, 0.3, 1)',
        complete: onTransitionEnd
      });
      activeTransitionTimeline = timeline;

      // 1. Smoothly scroll lyrics container
      timeline.add({
        targets: scroller,
        translateY: [currentY, endTargetY],
        duration: 780
      }, 0);

      // 2. Cascade lines with soft blur & gentle opacity fade
      if (allLineEls.length) {
        timeline.add({
          targets: allLineEls,
          opacity: [
            { value: (el) => parseFloat(window.getComputedStyle(el).opacity) || 0.4, duration: 0 },
            { value: 0.08, duration: 550, delay: anime.stagger(12) }
          ],
          translateY: [
            { value: 0, duration: 0 },
            { value: direction >= 0 ? 20 : -20, duration: 650, delay: anime.stagger(15) }
          ],
          filter: [
            { value: 'blur(4px)', duration: 650, delay: anime.stagger(12) }
          ]
        }, 50);
      }
    } else if (typeof gsap !== 'undefined') {
      if (scroller) {
        gsap.killTweensOf(scroller);
        gsap.to(scroller, {
          y: endTargetY,
          duration: 0.78,
          ease: 'power3.inOut',
          onComplete: onTransitionEnd
        });
      } else {
        setTimeout(onTransitionEnd, 780);
      }
    } else {
      onTransitionEnd();
    }
  }
  window.playSongEndScrollAnimation = playSongEndScrollAnimation;

  function startLyricsLoop() {
    if (lyricsLoopId) return;
    function loop() {
      if (isLyricsMode && !isSongEndAnimating) {
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
    const lyricsControls = document.getElementById('lyrics-controls');
    const audioDock = document.querySelector('.audio-player-dock');
    const lyricsDock = document.getElementById('lyrics-dock');
    const lyricsView = document.getElementById('lyrics-view');
    const reviews = document.querySelector('.reviews-container');

    if (isLyricsMode) {
      // 1. Enter Lyrics Mode: animate discs to stack & start 60FPS fluid sync loop
      startLyricsLoop();
      animateDiscsToStack(true);

      // Smooth slide from left player dock across to right lyrics dock, converting into control menu
      if (audioDock && lyricsDock && typeof gsap !== 'undefined') {
        const audioRect = audioDock.getBoundingClientRect();
        const lyricsRect = lyricsDock.getBoundingClientRect();
        const deltaX = (lyricsRect.left + lyricsRect.width / 2) - (audioRect.left + audioRect.width / 2);

        gsap.killTweensOf(audioDock);
        gsap.to(audioDock, {
          x: deltaX,
          opacity: 0,
          scale: 0.95,
          duration: 0.55,
          ease: "power3.inOut",
          onComplete: () => {
            audioDock.style.visibility = 'hidden';
          }
        });

        if (lyricsBtn) lyricsBtn.classList.add('is-active');
        if (lyricsControls) {
          lyricsControls.classList.add('is-visible');
          gsap.fromTo(lyricsControls,
            { x: -40, opacity: 0, scale: 0.92 },
            { x: 0, opacity: 1, scale: 1, duration: 0.55, ease: "power3.out", delay: 0.15 }
          );
        }
      } else {
        if (audioDock) audioDock.style.visibility = 'hidden';
        if (lyricsBtn) lyricsBtn.classList.add('is-active');
        if (lyricsControls) lyricsControls.classList.add('is-visible');
      }

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

      // Show Rotary Dial Selector in top-left region
      showRotaryDial();

      // 4. Load lyrics for currently active song
      loadAndRenderLyrics(getActiveIndex());
    } else {
      // 1. Exit Lyrics Mode: stop loop & restore horizontal ribbon arc
      stopLyricsLoop();
      animateDiscsToCarousel(true);
      hideRotaryDial();

      // Smooth slide control menu back to left and restore bottom-left audio player dock
      if (audioDock && lyricsDock && typeof gsap !== 'undefined') {
        if (lyricsControls) {
          gsap.to(lyricsControls, {
            opacity: 0,
            scale: 0.92,
            duration: 0.3,
            ease: "power2.in",
            onComplete: () => {
              lyricsControls.classList.remove('is-visible');
              if (lyricsBtn) lyricsBtn.classList.remove('is-active');
            }
          });
        }

        audioDock.style.visibility = 'visible';
        gsap.killTweensOf(audioDock);
        gsap.to(audioDock, {
          x: 0,
          opacity: 1,
          scale: 1,
          duration: 0.6,
          ease: "power3.out",
          delay: 0.1
        });
      } else {
        if (lyricsControls) lyricsControls.classList.remove('is-visible');
        if (lyricsBtn) lyricsBtn.classList.remove('is-active');
        if (audioDock) {
          audioDock.style.visibility = 'visible';
          audioDock.style.transform = 'none';
          audioDock.style.opacity = '1';
        }
      }

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
      updateRotaryDialSelection(idx);
    }
  });

  /* --------------------------------------------------------
     9. ROTARY DIAL CONTROLLER (Lyrics Mode)
     -------------------------------------------------------- */
  let rotaryDialAngle = 0;
  let isRotaryDragging = false;
  let rotaryDragStartY = 0;
  let rotaryDragStartAngle = 0;

  function renderRotaryDialTracks() {
    const trackList = document.getElementById('rotary-track-list');
    if (!trackList) return;
    const allSongs = (typeof SONGS !== 'undefined' ? SONGS : window.SONGS) || [];
    trackList.innerHTML = '';

    allSongs.forEach((song, idx) => {
      const item = document.createElement('div');
      item.className = 'rotary-track-item';
      item.setAttribute('data-idx', idx);

      const dot = document.createElement('div');
      dot.className = 'rotary-track-dot';

      const label = document.createElement('span');
      label.className = 'rotary-track-title';
      label.textContent = song.title || `Track ${idx + 1}`;

      item.appendChild(dot);
      item.appendChild(label);

      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof playSongEndScrollAnimation === 'function') {
          const dir = idx >= getActiveIndex() ? 1 : -1;
          playSongEndScrollAnimation(dir, () => {
            if (typeof selectSong === 'function') selectSong(idx, true);
          });
        } else if (typeof selectSong === 'function') {
          selectSong(idx, true);
        }
      });

      trackList.appendChild(item);
    });

    updateRotaryDialSelection(getActiveIndex(), true);
  }

  function updateRotaryDialSelection(activeIdx, instant = false) {
    const trackList = document.getElementById('rotary-track-list');
    const wheel = document.getElementById('rotary-disc-wheel');
    if (!trackList) return;

    const items = trackList.querySelectorAll('.rotary-track-item');
    items.forEach((item, idx) => {
      const isActive = (idx === activeIdx);
      if (isActive) {
        item.classList.add('is-active');
      } else {
        item.classList.remove('is-active');
      }

      // Curved radius displacement based on distance from active index
      const dist = idx - activeIdx;
      const absDist = Math.abs(dist);
      const curveX = Math.max(0, 16 - absDist * 3.5);
      const itemOpacity = Math.max(0.18, 1 - absDist * 0.22);
      item.style.transform = `translateX(${curveX}px)`;
      item.style.opacity = isActive ? '1' : itemOpacity.toFixed(2);
    });

    // Rotate dial wheel smoothly based on track index step (~18 deg per track)
    const allSongs = (typeof SONGS !== 'undefined' ? SONGS : window.SONGS) || [];
    if (wheel && allSongs.length > 0) {
      const stepAngle = 360 / Math.max(8, allSongs.length);
      rotaryDialAngle = activeIdx * stepAngle;
      if (typeof gsap !== 'undefined' && !instant) {
        gsap.to(wheel, {
          rotation: rotaryDialAngle,
          duration: 0.5,
          ease: "power2.out"
        });
      } else {
        wheel.style.transform = `rotate(${rotaryDialAngle}deg)`;
      }
    }
  }

  function showRotaryDial() {
    const dial = document.getElementById('lyrics-rotary-dial');
    if (!dial) return;
    renderRotaryDialTracks();
    dial.classList.add('is-visible');
    if (typeof gsap !== 'undefined') {
      gsap.killTweensOf(dial);
      gsap.fromTo(dial, 
        { opacity: 0, x: -30, scale: 0.94 },
        { opacity: 1, x: 0, scale: 1, duration: 0.6, ease: "power3.out", delay: 0.1 }
      );
    } else {
      dial.style.opacity = '1';
    }
  }

  function hideRotaryDial() {
    const dial = document.getElementById('lyrics-rotary-dial');
    if (!dial) return;
    if (typeof gsap !== 'undefined') {
      gsap.killTweensOf(dial);
      gsap.to(dial, {
        opacity: 0,
        x: -20,
        scale: 0.94,
        duration: 0.35,
        ease: "power2.in",
        onComplete: () => {
          dial.classList.remove('is-visible');
        }
      });
    } else {
      dial.classList.remove('is-visible');
    }
  }

  function initRotaryDialInteractions() {
    const dial = document.getElementById('lyrics-rotary-dial');
    const viewport = dial ? dial.querySelector('.rotary-disc-viewport') : null;
    if (!viewport) return;

    // Wheel drag interaction to switch tracks with tactile click feel
    viewport.addEventListener('pointerdown', (e) => {
      isRotaryDragging = true;
      rotaryDragStartY = e.clientY;
      rotaryDragStartAngle = rotaryDialAngle;
      viewport.setPointerCapture(e.pointerId);
    });

    viewport.addEventListener('pointermove', (e) => {
      if (!isRotaryDragging) return;
      const deltaY = e.clientY - rotaryDragStartY;
      const allSongs = (typeof SONGS !== 'undefined' ? SONGS : window.SONGS) || [];
      if (Math.abs(deltaY) > 30 && allSongs.length > 0) {
        const dir = deltaY > 0 ? 1 : -1;
        const curIdx = getActiveIndex();
        const nextIdx = (curIdx + dir + allSongs.length) % allSongs.length;
        rotaryDragStartY = e.clientY;
        if (typeof playSongEndScrollAnimation === 'function') {
          playSongEndScrollAnimation(dir, () => {
            if (typeof selectSong === 'function') selectSong(nextIdx, true);
          });
        } else if (typeof selectSong === 'function') {
          selectSong(nextIdx, true);
        }
      }
    });

    const stopDrag = (e) => {
      if (isRotaryDragging) {
        isRotaryDragging = false;
        try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    viewport.addEventListener('pointerup', stopDrag);
    viewport.addEventListener('pointercancel', stopDrag);
  }

  // Attach button and keyboard listeners
  function initLyricsEvents() {
    const toggleBtn = document.getElementById('lyrics-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleLyricsMode();
      });
    }

    // Keyboard shortcuts in lyrics mode:
    window.addEventListener('keydown', (e) => {
      // Ignore if user is currently typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'l' || e.key === 'L') {
        toggleLyricsMode();
        return;
      }

      // If in lyrics mode, allow quick keyboard controls (Space, Left/Right arrow)
      if (isLyricsMode) {
        const audio = document.getElementById('real-audio-player');
        if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault();
          if (audio) {
            if (audio.paused) {
              audio.play().catch(console.error);
            } else {
              audio.pause();
            }
          }
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          if (audio) {
            seekAudioToTime(Math.max(0, audio.currentTime - 10));
          }
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          if (audio) {
            seekAudioToTime(Math.min(audio.duration || Infinity, audio.currentTime + 10));
          }
        }
      }
    });

    // Integrated transport controls in lyrics header
    const backwardBtn = document.getElementById('lyrics-btn-backward');
    const forwardBtn = document.getElementById('lyrics-btn-forward');
    const lyricsPlayBtn = document.getElementById('lyrics-btn-play');
    const prevSongBtn = document.getElementById('lyrics-btn-prev-song');
    const nextSongBtn = document.getElementById('lyrics-btn-next-song');
    const closeBtn = document.getElementById('lyrics-btn-close');

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleLyricsMode();
      });
    }

    if (backwardBtn) {
      backwardBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const audio = document.getElementById('real-audio-player');
        if (audio) {
          seekAudioToTime(Math.max(0, audio.currentTime - 10));
        }
      });
    }

    if (forwardBtn) {
      forwardBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const audio = document.getElementById('real-audio-player');
        if (audio) {
          seekAudioToTime(Math.min(audio.duration || Infinity, audio.currentTime + 10));
        }
      });
    }

    if (lyricsPlayBtn) {
      lyricsPlayBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const audio = document.getElementById('real-audio-player');
        if (!audio) return;
        if (audio.paused) {
          audio.play().catch(console.error);
        } else {
          audio.pause();
        }
      });
    }

    if (prevSongBtn) {
      prevSongBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof SONGS !== 'undefined' && SONGS.length) {
          const prev = (getActiveIndex() - 1 + SONGS.length) % SONGS.length;
          if (typeof playSongEndScrollAnimation === 'function') {
            playSongEndScrollAnimation(-1, () => {
              if (typeof selectSong === 'function') {
                selectSong(prev, true);
              }
            });
          } else if (typeof selectSong === 'function') {
            selectSong(prev, true);
          }
        }
      });
    }

    if (nextSongBtn) {
      nextSongBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof SONGS !== 'undefined' && SONGS.length) {
          const next = (getActiveIndex() + 1) % SONGS.length;
          if (typeof playSongEndScrollAnimation === 'function') {
            playSongEndScrollAnimation(1, () => {
              if (typeof selectSong === 'function') {
                selectSong(next, true);
              }
            });
          } else if (typeof selectSong === 'function') {
            selectSong(next, true);
          }
        }
      });
    }

    initRotaryDialInteractions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLyricsEvents);
  } else {
    initLyricsEvents();
  }

})();
