/* ========================================================
   AUTHENTIC A24 HOVER SCRIBBLE (Stop-Motion Hand-Drawn Outline)
   ======================================================== */

const scribbleConfig = {
  enabled: true,
  color: 0x000000,
  fps: 10,                 // 10 FPS choppy stop-motion sketch aesthetic
  points: 24,              // Organic jitter control nodes
  jitter: 0.034,           // Random radius wobbliness
  loops: 2,                // Dual concentric sketch loops
  loopGap: 0.045,          // Spacing between the dual sketched outlines
  padding: 0.05,           // Offset from the CD outer boundary
  width: 0.018,            // Tapered stroke thickness
  sweep: 0.76,             // Arc length around disc (76%)
  sweepJitter: 0.35,       // Random sweep arc variation
  inSteps: [0.35, 0.65, 0.9, 1.0],
  outSteps: [0.75, 0.45, 0.2]
};

const scribbleGroup = new THREE.Group();
scribbleGroup.visible = false;
scribbleGroup.renderOrder = 999;
if (typeof galleryGroup !== 'undefined') {
  galleryGroup.add(scribbleGroup);
}

const scribbleMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color(scribbleConfig.color),
  side: THREE.DoubleSide,
  depthWrite: false,
  depthTest: true,
  transparent: true,
  toneMapped: false
});

const scribbleGeometries = [];
const N_SEGMENTS = scribbleConfig.points * 3; // 72 fine segments per loop

for (let l = 0; l < scribbleConfig.loops; l++) {
  const geom = new THREE.BufferGeometry();
  const totalVerts = (N_SEGMENTS + 1) * 2;
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(totalVerts * 3), 3));
  const indices = [];
  for (let s = 0; s < N_SEGMENTS; s++) {
    const idx = s * 2;
    indices.push(idx, idx + 1, idx + 2, idx + 1, idx + 3, idx + 2);
  }
  geom.setIndex(indices);
  scribbleGeometries.push(geom);

  const mesh = new THREE.Mesh(geom, scribbleMaterial);
  mesh.renderOrder = 999;
  scribbleGroup.add(mesh);
}

function updateScribbleStroke(loopIdx, progress) {
  const geom = scribbleGeometries[loopIdx];
  const posAttr = geom.getAttribute('position');

  const baseRadius = DISC_OUTER_R * (1 + scribbleConfig.padding + loopIdx * scribbleConfig.loopGap);
  const halfWidth = DISC_OUTER_R * scribbleConfig.width * 0.5;

  const sweepFactor = Math.max(0.12, Math.min(1.0, scribbleConfig.sweep * (1 + (Math.random() - 0.5) * scribbleConfig.sweepJitter))) * progress;
  const sweepAngle = Math.PI * 2 * sweepFactor;
  const startAngle = Math.random() * Math.PI * 2;

  const jitterNodes = [];
  for (let p = 0; p <= scribbleConfig.points; p++) {
    jitterNodes.push(1.0 + (Math.random() - 0.5) * 2.0 * scribbleConfig.jitter);
  }

  for (let s = 0; s <= N_SEGMENTS; s++) {
    const t = s / N_SEGMENTS;
    const angle = startAngle + t * sweepAngle;

    const u = t * scribbleConfig.points * sweepFactor;
    const d = Math.floor(u);
    const f = Math.min(scribbleConfig.points, d + 1);
    const p = u - d;
    const smooth = p * p * (3 - 2 * p); // smoothstep
    const jitterMult = jitterNodes[d] * (1 - smooth) + jitterNodes[f] * smooth;

    // Natural tapered stroke ends (thick in middle, tapered at tips)
    const taper = Math.min(1.0, Math.min(t, 1 - t) * 14 + 0.15);
    const innerR = baseRadius * jitterMult - halfWidth * taper;
    const outerR = baseRadius * jitterMult + halfWidth * taper;

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Position slightly in front of disc front label to prevent clipping
    posAttr.setXYZ(s * 2, cosA * innerR, sinA * innerR, 0.022);
    posAttr.setXYZ(s * 2 + 1, cosA * outerR, sinA * outerR, 0.022);
  }

  posAttr.needsUpdate = true;
  geom.computeBoundingSphere();
}

function refreshScribble(progress = 1.0) {
  for (let l = 0; l < scribbleGeometries.length; l++) {
    updateScribbleStroke(l, progress);
  }
}

let hoveredDiscIndex = -1;
let scribbleTargetIndex = -1;
let scribbleState = 'hidden'; // 'hidden' | 'in' | 'on' | 'out'
let scribbleStep = 0;
let lastScribbleTime = 0;

function snapScribbleToTarget(targetMesh, instant = false) {
  if (!targetMesh) return;
  if (instant) {
    scribbleGroup.position.copy(targetMesh.position);
    scribbleGroup.rotation.copy(targetMesh.rotation);
    scribbleGroup.scale.copy(targetMesh.scale);
    scribbleGroup.updateMatrix();
  } else {
    scribbleGroup.position.lerp(targetMesh.position, 0.45);
    scribbleGroup.quaternion.slerp(targetMesh.quaternion, 0.45);
    scribbleGroup.scale.lerp(targetMesh.scale, 0.45);
    scribbleGroup.rotation.setFromQuaternion(scribbleGroup.quaternion);
  }
}

function updateScribbleAnimation(now) {
  const frameInterval = 1000 / scribbleConfig.fps;
  const isDue = (now - lastScribbleTime) >= frameInterval;

  // Authentic A24 scribble outline display:
  // 1. In lyrics mode: active disc ALWAYS displays the animated scribble outline
  // 2. In carousel mode: only the currently active CD displays scribble when hovered
  const inLyrics = !!window.isLyricsMode;
  const isTargetActive = inLyrics || (hoveredDiscIndex !== -1 && hoveredDiscIndex === activeIndex);

  // Is scene / carousel currently in motion? (dragging or tweening or offset gliding)
  const isMoving = inLyrics
    ? (typeof gsap !== 'undefined' && discMeshes[activeIndex] && (gsap.isTweening(discMeshes[activeIndex].position) || (typeof galleryGroup !== 'undefined' && gsap.isTweening(galleryGroup.position))))
    : ((typeof isDragging !== 'undefined' && isDragging) ||
       (carouselTween && carouselTween.isActive()) ||
       Math.abs(carouselOffset - activeIndex) > 0.005);

  if (isTargetActive) {
    const targetMesh = discMeshes[activeIndex];
    if (scribbleState === 'hidden' || scribbleTargetIndex !== activeIndex) {
      scribbleTargetIndex = activeIndex;
      scribbleState = 'in';
      scribbleStep = 0;
      scribbleGroup.visible = true;
      snapScribbleToTarget(targetMesh, true);
      refreshScribble(scribbleConfig.inSteps[0]);
      lastScribbleTime = now;
    } else {
      snapScribbleToTarget(targetMesh, isMoving || inLyrics);

      if (isDue) {
        lastScribbleTime = now;
        if (scribbleState === 'in') {
          scribbleStep++;
          if (scribbleStep < scribbleConfig.inSteps.length) {
            refreshScribble(scribbleConfig.inSteps[scribbleStep]);
          } else {
            scribbleState = 'on';
            refreshScribble(1.0);
          }
        } else {
          refreshScribble(1.0);
        }
      }
    }
  } else {
    if (scribbleState !== 'hidden') {
      if (scribbleTargetIndex !== -1 && discMeshes[scribbleTargetIndex]) {
        snapScribbleToTarget(discMeshes[scribbleTargetIndex], isMoving);
      }

      if (scribbleState !== 'out') {
        scribbleState = 'out';
        scribbleStep = 0;
        lastScribbleTime = now;
      }

      if (isDue) {
        lastScribbleTime = now;
        if (scribbleStep < scribbleConfig.outSteps.length) {
          refreshScribble(scribbleConfig.outSteps[scribbleStep]);
          scribbleStep++;
        } else {
          scribbleState = 'hidden';
          scribbleTargetIndex = -1;
          scribbleGroup.visible = false;
        }
      }
    }
  }
}

window.scribbleGroup = scribbleGroup;
window.snapScribbleToTarget = snapScribbleToTarget;
window.refreshScribble = refreshScribble;
window.updateScribbleAnimation = updateScribbleAnimation;
