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
    return result.sort((a, b) => a.time - b.time);
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
    if (typeof AURIX_LYRICS !== 'undefined' && AURIX_LYRICS[song.id]) {
      const entry = AURIX_LYRICS[song.id];
      if (entry.synced) {
        const parsed = parseLRC(entry.synced);
        lyricsCache[song.id] = parsed;
        return parsed;
      }
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
    const ambientGlow = document.getElementById('lyrics-ambient-glow');

    if (headerTitle) headerTitle.textContent = song.title.toUpperCase();
    if (headerArtist) headerArtist.textContent = song.artist;

    // Update dynamic background ambient light blob
    if (ambientGlow) {
      const accent = song.accent || '#499ff5';
      ambientGlow.style.background = `radial-gradient(circle, ${accent}66 0%, rgba(20, 20, 25, 0.4) 60%, transparent 80%)`;
    }

    if (!scroller) return;
    scroller.innerHTML = '<div class="lyrics-loading">Loading synchronized lyrics...</div>';
    currentActiveLineIdx = -1;

    currentLyricLines = await getLyricsForSong(song);

    if (!currentLyricLines || !currentLyricLines.length) {
      scroller.innerHTML = `
        <div class="lyrics-empty">
          <div class="lyrics-empty-icon">♪</div>
          <div class="lyrics-empty-title">Instrumental Track</div>
          <div class="lyrics-empty-sub">No vocal lyrics synchronized for this recording</div>
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
      lineEl.textContent = line.text;

      // Click-to-seek directly to that vocal line
      lineEl.addEventListener('click', () => {
        const audio = document.getElementById('real-audio-player');
        if (audio) {
          audio.currentTime = line.time;
          if (audio.paused) {
            audio.play().catch(console.error);
          }
        }
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
     4. REAL-TIME PLAYHEAD SYNC & SPRING SCROLL (BetterLyrics style)
     -------------------------------------------------------- */
  function updateLyricsTime(currentTime, instant = false) {
    if (!isLyricsMode || !currentLyricLines || !currentLyricLines.length) return;

    // Determine current active lyric line (with slight 0.12s anticipation)
    const playTime = currentTime + 0.12;
    let activeIdx = -1;

    for (let i = 0; i < currentLyricLines.length; i++) {
      if (currentLyricLines[i].time <= playTime) {
        activeIdx = i;
      } else {
        break;
      }
    }

    if (activeIdx === currentActiveLineIdx && !instant) return;
    currentActiveLineIdx = activeIdx;

    const scroller = document.getElementById('lyrics-scroller');
    if (!scroller) return;

    const allLineEls = scroller.querySelectorAll('.lyric-line');
    allLineEls.forEach((el, idx) => {
      el.classList.remove('is-active', 'is-past', 'is-future');
      if (idx === activeIdx) {
        el.classList.add('is-active');
      } else if (idx < activeIdx) {
        el.classList.add('is-past');
      } else {
        el.classList.add('is-future');
      }
    });

    if (activeIdx >= 0 && allLineEls[activeIdx]) {
      const activeEl = allLineEls[activeIdx];
      const viewport = scroller.parentElement;
      const viewportHeight = viewport ? viewport.clientHeight : 500;
      const lineTop = activeEl.offsetTop;
      const lineHeight = activeEl.offsetHeight;

      // Apple Music / BetterLyrics focal position: roughly 38% from top of viewport
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
  window.updateLyricsTime = updateLyricsTime;

  function getStackGalleryX() {
    const aspect = (window.innerWidth && window.innerHeight) ? (window.innerWidth / window.innerHeight) : 1.77;
    const halfWidth = 1.601 * aspect;
    return -(halfWidth * 0.53);
  }
  window.getStackGalleryX = getStackGalleryX;

  /* --------------------------------------------------------
     5. 3D DISC STACKING CONTROLLER (GSAP)
     Smoothly morphs horizontal carousel into physical vertical stack on the left
     -------------------------------------------------------- */
  function animateDiscsToStack(animate = true) {
    const gallery = window.galleryGroup || (typeof galleryGroup !== 'undefined' ? galleryGroup : null);
    const meshes = window.discMeshes || (typeof discMeshes !== 'undefined' ? discMeshes : []);
    if (!gallery || !meshes.length) return;

    const N = meshes.length;
    const activeIdx = getActiveIndex();

    // 1. Shift galleryGroup to the left side using responsive focal center
    const targetGalleryX = getStackGalleryX();
    if (animate && typeof gsap !== 'undefined') {
      gsap.to(gallery.position, {
        x: targetGalleryX,
        y: 0.05,
        z: 0.3,
        duration: 0.85,
        ease: "power3.out"
      });
    } else {
      gallery.position.set(targetGalleryX, 0.05, 0.3);
    }

    // 2. Animate every disc into stack formation
    meshes.forEach((mesh, i) => {
      mesh.visible = true;
      const ud = mesh.userData;

      let targetX, targetY, targetZ, targetRotZ, targetScale;
      let dist = 0;

      if (i === activeIdx) {
        // Hero Active Disc sits elevated on TOP of the stack
        targetX = 0;
        targetY = 0.08;
        targetZ = 0.55;
        targetRotZ = 0;
        targetScale = 1.05;

        ud.baseRotX = 0;
        ud.baseRotY = 0;
        ud.baseRotZ = 0;
        ud.basePosZ = targetZ;
        ud.baseScale = targetScale;
      } else {
        // Layer beneath in stack order relative to activeIndex
        dist = (i - activeIdx + N) % N;
        const k = dist; // 1 to N-1

        const angleSign = (k % 2 === 0 ? 1 : -1);
        targetX = Math.sin(k * 1.9) * 0.04;
        targetY = -0.022 * k;
        targetZ = 0.55 - (k * 0.055);
        targetRotZ = angleSign * (0.04 + k * 0.025); // Organic rotation angles (3° to 10°)
        targetScale = Math.max(0.86, 1.0 - k * 0.015);

        ud.baseRotX = 0;
        ud.baseRotY = 0;
        ud.baseRotZ = targetRotZ;
        ud.basePosZ = targetZ;
        ud.baseScale = targetScale;
      }

      if (animate && typeof gsap !== 'undefined') {
        gsap.killTweensOf(mesh.position);
        gsap.killTweensOf(mesh.rotation);
        gsap.killTweensOf(mesh.scale);

        gsap.to(mesh.position, {
          x: targetX,
          y: targetY,
          z: targetZ,
          duration: 0.85,
          ease: "power3.out",
          delay: i === activeIdx ? 0 : 0.02 * Math.min(dist || 1, 6)
        });
        gsap.to(mesh.rotation, {
          x: 0,
          y: 0,
          z: targetRotZ,
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
        mesh.rotation.set(0, 0, targetRotZ);
        mesh.scale.set(targetScale, targetScale, targetScale);
      }
    });

    // Reposition scribble outline if active
    if (typeof snapScribbleToTarget === 'function' && meshes[activeIdx]) {
      snapScribbleToTarget(meshes[activeIdx], false);
    }
  }
  window.animateDiscsToStack = animateDiscsToStack;

  /* --------------------------------------------------------
     6. RESTORE HORIZONTAL CAROUSEL ARC (GSAP)
     Smoothly morphs stack back into authentic A24 ribbon arc
     -------------------------------------------------------- */
  function animateDiscsToCarousel(animate = true) {
    const gallery = window.galleryGroup || (typeof galleryGroup !== 'undefined' ? galleryGroup : null);
    const meshes = window.discMeshes || (typeof discMeshes !== 'undefined' ? discMeshes : []);
    if (!gallery || !meshes.length) return;

    if (animate && typeof gsap !== 'undefined') {
      gsap.to(gallery.position, {
        x: 0,
        y: 0,
        z: 0,
        duration: 0.8,
        ease: "power3.out"
      });
    } else {
      gallery.position.set(0, 0, 0);
    }

    meshes.forEach((mesh, i) => {
      const m = i - getCarouselOffset();
      const absDelta = Math.abs(m);

      const theta = m * 0.35;
      const x = Math.sin(theta) * 5.52;
      const y = Math.max(0, 0.06 * (1.0 - absDelta));
      const z = -Math.cos(theta) * 2.4 + 2.4;
      const s = Math.max(0.8, 1.0 - absDelta * 0.2);

      mesh.userData.baseRotX = 0;
      mesh.userData.baseRotY = -theta;
      mesh.userData.baseRotZ = 0;
      mesh.userData.basePosZ = z;
      mesh.userData.baseScale = s;

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
          ease: "power3.out"
        });
      } else {
        mesh.position.set(x, y, z);
        mesh.rotation.set(0, -theta, 0);
        mesh.scale.set(s, s, s);
      }
      mesh.visible = absDelta < 4.0;
    });

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
      // 1. Enter Lyrics Mode: animate discs to stack
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
      if (heroInfo && typeof gsap !== 'undefined') {
        gsap.to(heroInfo, { opacity: 0, y: -15, duration: 0.4, overwrite: 'auto' });
      }
      if (reviews && typeof gsap !== 'undefined') {
        gsap.to(reviews, { opacity: 0, y: 15, duration: 0.4, overwrite: 'auto' });
      }

      // 4. Load lyrics for currently active song
      loadAndRenderLyrics(getActiveIndex());
    } else {
      // 1. Exit Lyrics Mode: restore horizontal ribbon arc
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
      if (heroInfo && typeof gsap !== 'undefined') {
        gsap.to(heroInfo, { opacity: 1, y: 0, duration: 0.5, delay: 0.2, overwrite: 'auto' });
      }
      if (reviews && typeof gsap !== 'undefined') {
        gsap.to(reviews, { opacity: 1, y: 0, duration: 0.5, delay: 0.2, overwrite: 'auto' });
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
