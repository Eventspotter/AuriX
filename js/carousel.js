/* ========================================================
   DISC ARC TRAJECTORY & PROPER SPACING
   Calculates smooth swoop across the 3D space
   ======================================================== */

function updateDiscArc() {
  const N = discMeshes.length;

  discMeshes.forEach((mesh, i) => {
    const m = i - carouselOffset;
    const absDelta = Math.abs(m);

    // Mathematical arc formula derived from authentic A24 site:
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

    mesh.position.set(x, y, z);
    mesh.scale.set(s, s, s);
    mesh.rotation.set(0, -theta, 0);

    // Hide discs that are far offscreen
    mesh.visible = absDelta < 4.0;
  });
}

function getCarouselTargetIndex() {
  if (carouselTween && carouselTween.isActive()) {
    return Math.max(0, Math.min(SONGS.length - 1, pendingTargetIndex));
  }
  return Math.max(0, Math.min(SONGS.length - 1, Math.round(carouselOffset)));
}

function selectSong(idx, playImmediately = true, options = {}) {
  if (idx < 0 || idx >= SONGS.length) return;
  activeIndex = idx;
  pendingTargetIndex = idx;
  targetCarouselOffset = idx;

  // Update Top-Left HUD with GSAP
  const song = SONGS[idx];
  if (typeof gsap !== 'undefined') {
    gsap.to('#song-title, #song-artist, #song-year, #song-album, #rev1-pub, #rev1-quote, #rev2-pub, #rev2-quote', {
      opacity: 0,
      y: -6,
      duration: 0.18,
      overwrite: 'auto',
      onComplete: () => {
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

        if (r1Pub && song.reviews[0]) r1Pub.textContent = song.reviews[0].pub;
        if (r1Quote && song.reviews[0]) r1Quote.textContent = `“${song.reviews[0].quote}”`;
        if (r2Pub && song.reviews[1]) r2Pub.textContent = song.reviews[1].pub;
        if (r2Quote && song.reviews[1]) r2Quote.textContent = `“${song.reviews[1].quote}”`;

        gsap.to('#song-title, #song-artist, #song-year, #song-album, #rev1-pub, #rev1-quote, #rev2-pub, #rev2-quote', {
          opacity: 1,
          y: 0,
          duration: 0.45,
          stagger: 0.02,
          ease: "aurixGlide"
        });
      }
    });
  }

  // Update Dropdown Active state
  if (typeof updateDropdownActiveState === 'function') {
    updateDropdownActiveState(idx);
  }

  // Kill previous carousel tween if active
  if (carouselTween) {
    carouselTween.kill();
    carouselTween = null;
  }

  // Authentic A24 duration: 0.51s for wheel (snapDuration 0.46 + 0.05), 0.46s for snap
  const duration = options.source === 'wheel' ? 0.51 : (options.source === 'snap' ? 0.46 : 0.55);

  if (typeof gsap !== 'undefined') {
    carouselTween = gsap.to(carouselState, {
      offset: idx,
      duration: duration,
      ease: "aurixGlide",
      overwrite: true,
      onUpdate: () => {
        carouselOffset = carouselState.offset;
        updateDiscArc();
      },
      onComplete: () => {
        carouselOffset = idx;
        carouselState.offset = idx;
        updateDiscArc();
        carouselTween = null;
      }
    });
  } else {
    carouselOffset = idx;
    carouselState.offset = idx;
    updateDiscArc();
  }

  // Load & Play Audio
  if (typeof loadAudioTrack === 'function') {
    loadAudioTrack(idx, playImmediately);
  }
}

function snapToNearest() {
  const nearestIdx = Math.max(0, Math.min(SONGS.length - 1, Math.round(carouselOffset)));
  selectSong(nearestIdx, isAudioPlaying, { source: 'snap' });
}
