/* ========================================================
   INTUITIVE USER INTERACTIONS (Drag, Scroll, Click, Keys)
   ======================================================== */

let isDragging = false;
let hasDragged = false;
let startX = 0;
let prevOffset = 0;

let lastPointerX = window.innerWidth / 2;
let lastPointerY = window.innerHeight / 2;
let isPointerOverCanvas = false;

// Raycaster for CD hover, tilt and selection
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function getDiscIntersection(clientX, clientY) {
  mouse.x = (clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(pickMeshes, false);
  if (intersects.length > 0) {
    return { index: intersects[0].object.userData.index, point: intersects[0].point };
  }
  return null;
}

function updateHoverAndRaycast(clientX = lastPointerX, clientY = lastPointerY) {
  lastPointerX = clientX;
  lastPointerY = clientY;

  if (isDragging) return;

  if (window.isLyricsMode) {
    discMeshes.forEach((m) => {
      m.userData.targetHover = 0;
      m.userData.targetTiltX = 0;
      m.userData.targetTiltY = 0;
    });
    hoveredDiscIndex = -1;
    if (renderer && renderer.domElement) renderer.domElement.style.cursor = 'default';
    return;
  }

  // Check if mouse is hovering over floating HTML overlays
  const el = document.elementFromPoint(clientX, clientY);
  if (el && el.closest('.nav, .audio-player-dock, .hero-info-panel, .nav-dropdown, #page-backdrop, .lyrics-dock, .lyrics-view')) {
    discMeshes.forEach((m) => {
      m.userData.targetHover = 0;
      m.userData.targetTiltX = 0;
      m.userData.targetTiltY = 0;
    });
    hoveredDiscIndex = -1;
    if (renderer && renderer.domElement) renderer.domElement.style.cursor = 'default';
    return;
  }

  // Raycast against all CD discs for interactive 3D tilt & scribble
  const hit = getDiscIntersection(clientX, clientY);
  const hitIdx = hit ? hit.index : -1;

  discMeshes.forEach((mesh, idx) => {
    if (idx === hitIdx && hit.point) {
      // Calculate contact point relative to the hovered disc in its own local coordinates [-1, 1]
      const localHit = mesh.worldToLocal(hit.point.clone());
      const nx = Math.max(-1, Math.min(1, localHit.x));
      const ny = Math.max(-1, Math.min(1, localHit.y));

      // Authentic A24 subtle tilt towards cursor (~0.055 rad ≈ 3.1 degrees)
      mesh.userData.targetHover = 1.0;
      mesh.userData.targetTiltY = nx * 0.055;
      mesh.userData.targetTiltX = -ny * 0.055;
    } else {
      mesh.userData.targetHover = 0.0;
      mesh.userData.targetTiltX = 0;
      mesh.userData.targetTiltY = 0;
    }
  });

  // Authentic A24 scribble outline is exclusively on the active / playing CD
  hoveredDiscIndex = (hitIdx === activeIndex) ? activeIndex : -1;
  if (renderer && renderer.domElement) {
    renderer.domElement.style.cursor = (hitIdx !== -1) ? 'pointer' : 'default';
  }
}

window.addEventListener('pointerenter', (e) => {
  isPointerOverCanvas = true;
  updateHoverAndRaycast(e.clientX, e.clientY);
});

window.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.nav') || e.target.closest('.audio-player-dock') || e.target.closest('.nav-dropdown') || e.target.closest('.lyrics-dock') || e.target.closest('.lyrics-view')) return;
  if (window.isLyricsMode) return;
  if (carouselTween) {
    carouselTween.kill();
    carouselTween = null;
  }
  isDragging = true;
  hasDragged = false;
  startX = e.clientX;
  prevOffset = carouselOffset;
  carouselState.offset = carouselOffset;
});

window.addEventListener('pointermove', (e) => {
  isPointerOverCanvas = true;
  if (isDragging) {
    if (Math.abs(e.clientX - startX) > 6) {
      hasDragged = true;
    }
    const dx = (e.clientX - startX) / (window.innerWidth * 0.45);
    carouselOffset = Math.max(-0.15, Math.min(SONGS.length - 0.85, prevOffset - dx));
    carouselState.offset = carouselOffset;
    targetCarouselOffset = carouselOffset;
    updateDiscArc();
    discMeshes.forEach((m) => {
      m.userData.targetHover = 0;
      m.userData.targetTiltX = 0;
      m.userData.targetTiltY = 0;
    });
    hoveredDiscIndex = -1;
    return;
  }

  updateHoverAndRaycast(e.clientX, e.clientY);
});

window.addEventListener('pointerup', () => {
  if (!isDragging) return;
  isDragging = false;
  snapToNearest();
  updateHoverAndRaycast(lastPointerX, lastPointerY);
});

window.addEventListener('pointerleave', () => {
  isPointerOverCanvas = false;
  discMeshes.forEach((m) => {
    m.userData.targetHover = 0;
    m.userData.targetTiltX = 0;
    m.userData.targetTiltY = 0;
  });
  hoveredDiscIndex = -1;
  if (renderer && renderer.domElement) {
    renderer.domElement.style.cursor = 'default';
  }
});

/* ========================================================
   AUTHENTIC A24 WHEEL SCROLLING ENGINE
   Filters delta noise, normalizes line/pixel mode, decays envelope,
   and triggers butter-smooth 0.51s aurixGlide steps.
   ======================================================== */
const wheelConfig = {
  noiseFloor: 0.3,
  stepThreshold: 6,
  eventCap: 24,
  envelopeTau: 550,
  riseFactor: 1.2,
  tickGap: 34,
  tickRatio: 1,
  pauseGap: 130,
  idleReset: 150,
  minStepTick: 90,
  minStepFlick: 190,
  sustainDelay: 480,
  sustainRatio: 0.8
};

let wheelArmed = true;
let wheelFlickMode = false;
let wheelAccDelta = 0;
let wheelLastSign = 0;
let wheelEnvelopePeak = 0;
let wheelStepPeak = 0;
let wheelStepCount = 0;
let wheelStepTimestamp = 0;
let wheelLastTimestamp = 0;
let wheelIsActive = false;
let wheelIdleTimer = 0;

function normalizeWheel(e) {
  let dx = e.deltaX;
  let dy = e.deltaY;
  if (e.deltaMode === 1) { // Line mode (common on PC mouse wheels)
    dx *= 16;
    dy *= 16;
  } else if (e.deltaMode === 2) { // Page mode
    dx *= window.innerWidth;
    dy *= window.innerHeight;
  }
  return Math.abs(dx) > Math.abs(dy) * 1.25 ? dx : dy;
}

function resetWheelState() {
  wheelArmed = true;
  wheelFlickMode = false;
  wheelAccDelta = 0;
  wheelLastSign = 0;
  wheelEnvelopePeak = 0;
  wheelStepPeak = 0;
  wheelStepCount = 0;
  wheelStepTimestamp = 0;
  wheelLastTimestamp = 0;
  wheelIsActive = false;
}

function scheduleWheelIdleReset() {
  clearTimeout(wheelIdleTimer);
  wheelIdleTimer = setTimeout(() => {
    wheelIdleTimer = 0;
    resetWheelState();
  }, wheelConfig.idleReset);
}

function triggerWheelStep(direction, delta, now) {
  wheelArmed = false;
  wheelFlickMode = false;
  wheelAccDelta = 0;
  wheelStepTimestamp = now;
  wheelStepCount = 0;
  wheelStepPeak = delta;

  if (window.isLyricsMode) {
    if (typeof SONGS !== 'undefined' && SONGS.length) {
      const current = typeof activeIndex !== 'undefined' ? activeIndex : 0;
      const next = (current + direction + SONGS.length) % SONGS.length;
      if (next !== current) {
        if (typeof window.playSongEndScrollAnimation === 'function') {
          window.playSongEndScrollAnimation(direction, () => {
            if (typeof selectSong === 'function') selectSong(next, true, { source: 'wheel' });
          });
        } else if (typeof selectSong === 'function') {
          selectSong(next, true, { source: 'wheel' });
        }
      }
    }
    return;
  }

  const current = getCarouselTargetIndex();
  const next = Math.max(0, Math.min(SONGS.length - 1, current + direction));
  if (next !== current) {
    selectSong(next, isAudioPlaying, { source: 'wheel' });
  }
}

window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) return;
  if (isDropdownOpen || e.target.closest('.nav-dropdown') || e.target.closest('.lyrics-view') || e.target.closest('.lyrics-dock')) return;

  isPointerOverCanvas = true;
  if (e.clientX !== undefined && e.clientY !== undefined) {
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
  }

  const delta = normalizeWheel(e);
  const absDelta = Math.abs(delta);
  if (absDelta < 0.001) return;

  e.preventDefault();

  const now = performance.now();
  const dt = wheelIsActive ? (now - wheelLastTimestamp) : Infinity;
  wheelLastTimestamp = now;
  wheelIsActive = true;
  scheduleWheelIdleReset();

  const envelopeDecay = dt === Infinity ? 0 : Math.exp(-dt / wheelConfig.envelopeTau);
  const decayedPeak = wheelEnvelopePeak * envelopeDecay;

  if (absDelta < wheelConfig.noiseFloor) {
    wheelEnvelopePeak = decayedPeak;
    return;
  }

  const isRising = absDelta > decayedPeak * wheelConfig.riseFactor;
  wheelEnvelopePeak = Math.max(absDelta, decayedPeak);

  if (!wheelArmed) {
    wheelStepCount += 1;
    wheelStepPeak = Math.max(wheelStepPeak, absDelta);
    const stepDt = now - wheelStepTimestamp;
    const isPause = dt >= wheelConfig.pauseGap;
    const isTick = dt >= wheelConfig.tickGap && wheelStepCount <= 2 && stepDt >= wheelConfig.minStepTick && absDelta >= wheelStepPeak * wheelConfig.tickRatio;
    const isFlick = isRising && stepDt >= wheelConfig.minStepFlick;
    const isSustain = stepDt >= wheelConfig.sustainDelay && wheelEnvelopePeak >= wheelStepPeak * wheelConfig.sustainRatio;

    if (!(isPause || isTick || isFlick || isSustain)) return;

    wheelArmed = true;
    wheelAccDelta = 0;
    wheelLastSign = 0;
    wheelFlickMode = !(isPause || isTick || isSustain);
  }

  const dir = delta > 0 ? 1 : -1;
  if (dir !== wheelLastSign) {
    wheelAccDelta = 0;
    wheelLastSign = dir;
  }

  const effectiveDelta = wheelFlickMode ? Math.max(0, absDelta - decayedPeak) : absDelta;
  wheelAccDelta += Math.min(effectiveDelta, wheelConfig.eventCap);

  if (wheelAccDelta >= wheelConfig.stepThreshold) {
    triggerWheelStep(dir, absDelta, now);
  }
}, { passive: false });

// Keyboard Arrow Keys support
window.addEventListener('keydown', (e) => {
  if (window.isLyricsMode) {
    if (e.key === ' ') {
      e.preventDefault();
      if (playBtn) playBtn.click();
    }
    return;
  }

  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    const current = getCarouselTargetIndex();
    const next = Math.min(SONGS.length - 1, current + 1);
    if (next !== current) selectSong(next, isAudioPlaying, { source: 'wheel' });
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    const current = getCarouselTargetIndex();
    const prev = Math.max(0, current - 1);
    if (prev !== current) selectSong(prev, isAudioPlaying, { source: 'wheel' });
  } else if (e.key === ' ') {
    e.preventDefault();
    if (playBtn) playBtn.click();
  }
});

// Direct Disc Click
window.addEventListener('click', (e) => {
  if (hasDragged) return;
  if (e.target.closest('.nav') || e.target.closest('.audio-player-dock') || e.target.closest('.nav-dropdown') || e.target.closest('.lyrics-dock') || e.target.closest('.lyrics-view')) return;
  const hit = getDiscIntersection(e.clientX, e.clientY);
  const hitIdx = hit ? hit.index : -1;
  if (hitIdx !== -1) {
    if (window.isLyricsMode) {
      if (hitIdx === activeIndex && playBtn) {
        playBtn.click();
      }
      return;
    }

    // Physical tactile spring bounce on whichever disc was clicked
    if (discMeshes[hitIdx] && typeof gsap !== 'undefined') {
      gsap.to(discMeshes[hitIdx].position, {
        z: (discMeshes[hitIdx].userData.basePosZ || 0) - 0.12,
        duration: 0.09,
        yoyo: true,
        repeat: 1,
        ease: 'power2.out'
      });
    }

    if (hitIdx === activeIndex) {
      if (playBtn) playBtn.click();
    } else {
      selectSong(hitIdx, true, { source: 'click' });
    }
  }
});
