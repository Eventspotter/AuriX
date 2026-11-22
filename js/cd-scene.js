/* ========================================================
   AURIX — 3D THREE.JS OPTICAL DISC SCENE, SHADERS & LIGHTING
   ======================================================== */

const container = document.getElementById('webgl-canvas');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 4.4);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.86;
if (container) {
  container.appendChild(renderer.domElement);
}

// Value noise helper for micro-textures
function valueNoise(x, y) {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

// Procedural CD Surface Maps (Micro-grooves, ink grain, gloss variations)
function createCDMaps() {
  const size = 512;
  const center = size / 2;

  // 1. Front Normal Map (optical micro-grooves & printing texture)
  const fNormCanvas = document.createElement('canvas');
  fNormCanvas.width = size;
  fNormCanvas.height = size;
  const fNormCtx = fNormCanvas.getContext('2d');
  const fNormImgData = fNormCtx.createImageData(size, size);
  const fNormData = fNormImgData.data;
  const heightMap = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const r = Math.sqrt(dx * dx + dy * dy) + 0.0001;
      const optical = Math.sin(r * 0.6) * 0.025;
      const ink = (valueNoise(x * 0.4, y * 0.4) - 0.5) * 0.175;
      heightMap[y * size + x] = optical + ink;
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const left = heightMap[y * size + Math.max(0, x - 1)];
      const right = heightMap[y * size + Math.min(size - 1, x + 1)];
      const up = heightMap[Math.max(0, y - 1) * size + x];
      const down = heightMap[Math.min(size - 1, y + 1) * size + x];
      let nx = left - right, ny = up - down, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const idx = (y * size + x) * 4;
      fNormData[idx] = (nx * inv * 0.5 + 0.5) * 255;
      fNormData[idx + 1] = (ny * inv * 0.5 + 0.5) * 255;
      fNormData[idx + 2] = (nz * inv * 0.5 + 0.5) * 255;
      fNormData[idx + 3] = 255;
    }
  }
  fNormCtx.putImageData(fNormImgData, 0, 0);
  const frontNormalMap = new THREE.CanvasTexture(fNormCanvas);

  // 2. Front Roughness Map (Radial variation & sheen contrast)
  const fRoughCanvas = document.createElement('canvas');
  fRoughCanvas.width = size;
  fRoughCanvas.height = size;
  const fRoughCtx = fRoughCanvas.getContext('2d');
  const fRoughImgData = fRoughCtx.createImageData(size, size);
  const fRoughData = fRoughImgData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const rNorm = Math.sqrt(dx * dx + dy * dy) / (size * 0.5);
      let roughness = 0.42;
      roughness += (valueNoise(x * 2.3, y * 2.3) - 0.5) * 0.2;
      roughness -= (Math.sin(rNorm * 14) * 0.5 + 0.5) * 0.25;
      roughness = Math.max(0.04, Math.min(1.0, roughness));
      const val = roughness * 255;
      const idx = (y * size + x) * 4;
      fRoughData[idx] = val;
      fRoughData[idx + 1] = val;
      fRoughData[idx + 2] = val;
      fRoughData[idx + 3] = 255;
    }
  }
  fRoughCtx.putImageData(fRoughImgData, 0, 0);
  const frontRoughMap = new THREE.CanvasTexture(fRoughCanvas);

  return { frontNormalMap, frontRoughMap };
}

const cdMaps = createCDMaps();

// Procedural Studio Reflection Environment (A24 studio softbox bars)
function createEnvironmentTexture(rend) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, 0, 512);
  bg.addColorStop(0, '#25282f');
  bg.addColorStop(0.5, '#0e0f13');
  bg.addColorStop(1, '#020203');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1024, 512);

  const r = 0.07;
  [[0.14, r, 1.0], [0.4, r * 0.7, 0.6], [0.26, r * 1.1, 0.85], [0.62, r * 0.5, 0.35]].forEach(([pos, halfW, intensity]) => {
    const topY = 512 * (pos - halfW);
    const botY = 512 * (pos + halfW);
    const stripGrad = ctx.createLinearGradient(0, topY, 0, botY);
    stripGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    stripGrad.addColorStop(0.5, `rgba(255, 255, 255, ${Math.max(0.1, 0.95 * intensity)})`);
    stripGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = stripGrad;
    ctx.fillRect(0, topY, 1024, botY - topY);
  });

  const envTex = new THREE.CanvasTexture(canvas);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(rend);
  const envMap = pmrem.fromEquirectangular(envTex);
  envTex.dispose();
  pmrem.dispose();
  return envMap.texture;
}

// Studio Environment Reflections
scene.environment = createEnvironmentTexture(renderer);
scene.environmentIntensity = 1.0;

// Authentic A24 Studio Lighting Rig
const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff9e8, 0.75);
keyLight.position.set(3.5, -8, 6);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
fillLight.position.set(-5, -2, 4);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0x499ff5, 0.75);
rimLight.position.set(0, 3, -6);
scene.add(rimLight);

// Specular Glint Strip Light (sweeps across CD faces during 3D hover tilt)
const topStripLight = new THREE.DirectionalLight(0xffffff, 1.9);
topStripLight.position.set(0, 3.2, 3);
scene.add(topStripLight);

// Exact A24 Disc Dimensions: Outer R = 1.0, Hub R = 0.24, Hole R = 0.14
const DISC_OUTER_R = 1.0;
const DISC_HUB_R = 0.24;
const DISC_HOLE_R = 0.14;

function remapRingUVs(geom) {
  const pos = geom.attributes.position;
  const uvs = geom.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) * 0.5 + 0.5;
    const v = pos.getY(i) * 0.5 + 0.5;
    uvs.setXY(i, u, v);
  }
  uvs.needsUpdate = true;
}

const frontRingGeom = new THREE.RingGeometry(0.24, 0.974, 256, 1);
remapRingUVs(frontRingGeom);

const backRingGeom = new THREE.RingGeometry(0.24, 0.974, 256, 1);
remapRingUVs(backRingGeom);

// Inner Disc Geometry Layers (Frost Ring, Matrix Mirror Band, Polycarbonate Hub)
const frostGeom = new THREE.RingGeometry(0.14, 0.174, 180, 1);
const matrixGeom = new THREE.RingGeometry(0.174, 0.214, 180, 1);
const hubGeom = new THREE.RingGeometry(0.214, 0.24, 180, 1);

// Ultra-Smooth Outer Rim Bevel (256-segment LatheGeometry revolving around 360 degrees)
function createSmoothRimGeometry() {
  const discThickness = 0.01;
  const halfH = discThickness / 2; // 0.005
  const bevel = 0.0015 + 1.0 * Math.min(discThickness * 0.55, 0.018); // 0.007
  const innerR = 1.0 - 0.026; // 0.974
  const pts = [
    new THREE.Vector2(innerR, halfH),
    new THREE.Vector2(1.0 - bevel, halfH),
    new THREE.Vector2(1.0, halfH - bevel),
    new THREE.Vector2(1.0, -halfH + bevel),
    new THREE.Vector2(1.0 - bevel, -halfH),
    new THREE.Vector2(innerR, -halfH)
  ];
  const geom = new THREE.LatheGeometry(pts, 256);
  geom.rotateX(Math.PI / 2);
  geom.computeVertexNormals();
  return geom;
}

const rimGeom = createSmoothRimGeometry();

// Matrix Ring Texture Generator (Silver mirror with laser track markings)
function createMatrixCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(256, 256, 40.96, 256, 256, 256);
  grad.addColorStop(0, '#d9dde4');
  grad.addColorStop(0.42, '#f0f2f5');
  grad.addColorStop(0.72, '#cfd4dc');
  grad.addColorStop(1, '#b8bec8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  ctx.lineWidth = 1;
  [0.255, 0.285, 0.315, 0.345].forEach((e, n) => {
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.14 - n * 0.018})`;
    ctx.beginPath();
    ctx.arc(256, 256, 512 * e, 0, Math.PI * 2);
    ctx.stroke();
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const matrixTexture = createMatrixCanvas();

// Authentic A24 Materials
const backIridescentMat = new THREE.MeshPhysicalMaterial({
  color: 0x1a1e2a,
  metalness: 1.0,
  roughness: 0.23,
  roughnessMap: cdMaps.frontRoughMap,
  normalMap: cdMaps.frontNormalMap,
  normalScale: new THREE.Vector2(0.5, 0.5),
  clearcoat: 0.34,
  clearcoatRoughness: 0.06,
  iridescence: 1.0,
  iridescenceIOR: 1.86,
  iridescenceThicknessRange: [140, 900],
  envMapIntensity: 1.5,
  side: THREE.FrontSide
});

const rimMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0.55,
  roughness: 0.04,
  clearcoat: 0.7,
  clearcoatRoughness: 0.05,
  envMapIntensity: 1.8,
  side: THREE.DoubleSide
});

const hubMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.14,
  metalness: 0,
  transmission: 0.68,
  thickness: 0.6,
  ior: 1.5,
  clearcoat: 1.0,
  clearcoatRoughness: 0.04,
  envMapIntensity: 1.3,
  transparent: true,
  side: THREE.DoubleSide
});

const matrixMat = new THREE.MeshPhysicalMaterial({
  color: 0xdfdfeb,
  map: matrixTexture,
  roughness: 0.28,
  metalness: 0.82,
  clearcoat: 0.7,
  clearcoatRoughness: 0.12,
  envMapIntensity: 1.45,
  side: THREE.DoubleSide
});

const frostMat = new THREE.MeshPhysicalMaterial({
  color: 0xeeeeee,
  roughness: 0.55,
  metalness: 0,
  transmission: 0.23,
  thickness: 0.3,
  ior: 1.5,
  clearcoat: 0.4,
  clearcoatRoughness: 0.3,
  envMapIntensity: 0.9,
  transparent: true,
  side: THREE.DoubleSide
});

// Solid invisible hit-test pick target (1:1 identical to A24 pickGeometry)
const pickGeom = new THREE.CircleGeometry(DISC_OUTER_R, 32);
const pickMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
const pickMeshes = [];

// Gallery Root Group (Exact 1:1 A24 reverse-engineered parameters)
const galleryGroup = new THREE.Group();
galleryGroup.rotation.x = THREE.MathUtils.degToRad(-30);
galleryGroup.rotation.y = THREE.MathUtils.degToRad(-30);
galleryGroup.position.set(0, 0, 0);
galleryGroup.scale.setScalar(1.08);
scene.add(galleryGroup);

window.galleryGroup = galleryGroup;
window.discMeshes = discMeshes;
window.camera = camera;
window.scene = scene;
window.renderer = renderer;

/* ========================================================
   INDIVIDUAL CD CANVAS TEXTURE GENERATOR (1024x1024)
   ======================================================== */
function createCDTextureForSong(song) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    const center = 512;
    const outerR = Math.round(512 * 0.974); // 499px
    const hubR = Math.round(512 * 0.24);    // 123px

    let rendered = false;
    function doRender() {
      if (rendered) return;
      rendered = true;
      renderCanvas();
    }

    const img = new Image();
    img.onload = doRender;
    img.onerror = doRender;

    function renderCanvas() {
      ctx.clearRect(0, 0, 1024, 1024);

      // 1. Circular disc clip
      ctx.save();
      ctx.beginPath();
      ctx.arc(center, center, outerR, 0, Math.PI * 2);
      ctx.arc(center, center, hubR, 0, Math.PI * 2, true);
      ctx.clip('evenodd');

      // 2. Base Disc background color
      ctx.fillStyle = song.bgColor || "#0c0c0e";
      ctx.fillRect(0, 0, 1024, 1024);

      // 3. FULL HIGH-RESOLUTION ALBUM ARTWORK
      if (img.complete && img.naturalWidth > 0) {
        ctx.save();
        ctx.globalAlpha = 0.98;
        if (song.rotation) {
          ctx.translate(center, center);
          ctx.rotate((song.rotation * Math.PI) / 180);
          ctx.translate(-center, -center);
        }
        const scale = Math.max(1024 / img.naturalWidth, 1024 / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        ctx.drawImage(img, (1024 - w) / 2, (1024 - h) / 2, w, h);
        ctx.restore();

        // Contrast vignette
        const vignette = ctx.createRadialGradient(center, center, hubR + 10, center, center, outerR);
        vignette.addColorStop(0, "rgba(0,0,0,0.05)");
        vignette.addColorStop(0.7, "rgba(0,0,0,0.2)");
        vignette.addColorStop(1, "rgba(0,0,0,0.5)");
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, 1024, 1024);
      }

      // 4. Subtle Concentric Disc Grooves
      ctx.save();
      for (let r = hubR + 12; r < outerR - 8; r += 6) {
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.02 + Math.sin(r * 0.5) * 0.015})`;
        ctx.beginPath();
        ctx.arc(center, center, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // 5. Stylized Stamp on Disc Face
      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
      ctx.shadowBlur = 10;

      // If fallback (no image), render title and artist positioned outside the center hole (hubR = 123px)
      if (!img.complete || img.naturalWidth === 0) {
        ctx.fillStyle = song.textColor || "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const titleText = (song.title || 'UNTITLED').toUpperCase();
        const artistText = (song.artist || 'UNKNOWN ARTIST').toUpperCase();

        // 1. Title placed above the center hub hole (between y: 160 and 320)
        // Dynamically adjust font size based on title length
        let titleFontSize = 46;
        if (titleText.length > 22) titleFontSize = 32;
        else if (titleText.length > 15) titleFontSize = 38;
        ctx.font = `bold ${titleFontSize}px 'PPEiko', Georgia, serif`;

        const words = titleText.split(' ');
        if (words.length > 2 && titleText.length > 14) {
          const mid = Math.ceil(words.length / 2);
          ctx.fillText(words.slice(0, mid).join(' '), center, 240);
          ctx.fillText(words.slice(mid).join(' '), center, 295);
        } else {
          ctx.fillText(titleText, center, 270);
        }

        // 2. Artist placed below the center hub hole (between y: 700 and 780)
        let artistFontSize = 22;
        if (artistText.length > 25) artistFontSize = 18;
        ctx.font = `600 ${artistFontSize}px 'NeueMontreal', sans-serif`;
        ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
        ctx.fillText(artistText, center, 740);

        // 3. Subtle audiophile badge at bottom rim (y: 830)
        ctx.font = "500 13px 'NeueMontreal', sans-serif";
        ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
        ctx.letterSpacing = "2px";
        ctx.fillText("COMPACT DISC DIGITAL AUDIO", center, 830);
      }
      ctx.restore();

      ctx.restore(); // end clip

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      if (renderer && renderer.capabilities) {
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      }
      texture.needsUpdate = true;
      resolve(texture);
    }

    img.src = song.artDataUrl || song.artFile;
    if (img.complete && img.naturalWidth > 0) {
      doRender();
    }
  });
}

// Assemble a single 3D CD mesh group for a given song and index
async function createCDMeshForSong(song, index) {
  const cdMeshGroup = new THREE.Group();

  // Separate spin group so axial spin does not interfere with 3D hover tilt
  const spinGroup = new THREE.Group();
  cdMeshGroup.add(spinGroup);

  // 1. Front printed label with unique cover art + satin metallic micro-groove sheen
  const frontMat = new THREE.MeshPhysicalMaterial({
    roughness: 0.42,
    metalness: 0.48,
    roughnessMap: cdMaps.frontRoughMap,
    normalMap: cdMaps.frontNormalMap,
    normalScale: new THREE.Vector2(0.3, 0.3),
    clearcoat: 0.8,
    clearcoatRoughness: 0.02,
    envMapIntensity: 0.85,
    side: THREE.FrontSide
  });
  const frontMesh = new THREE.Mesh(frontRingGeom, frontMat);
  frontMesh.position.z = 0.0056;
  spinGroup.add(frontMesh);

  // 2. Back silver optical data surface with rainbow diffraction
  const backMesh = new THREE.Mesh(backRingGeom, backIridescentMat);
  backMesh.position.z = -0.0056;
  backMesh.rotation.y = Math.PI;
  spinGroup.add(backMesh);

  // 3. Center Hub System (Frosted Ring, Silver Matrix Band, Polycarbonate Hub)
  const frostMesh = new THREE.Mesh(frostGeom, frostMat);
  spinGroup.add(frostMesh);

  const matrixMesh = new THREE.Mesh(matrixGeom, matrixMat);
  spinGroup.add(matrixMesh);

  const hubMesh = new THREE.Mesh(hubGeom, hubMat);
  spinGroup.add(hubMesh);

  // 4. Outer Polycarbonate Bevel Rim
  const rimMesh = new THREE.Mesh(rimGeom, rimMat);
  spinGroup.add(rimMesh);

  // 5. Invisible Solid Pick Mesh covering whole disc including center hole (1:1 identical to A24)
  const pickMesh = new THREE.Mesh(pickGeom, pickMat);
  pickMesh.userData = { index: index };
  cdMeshGroup.add(pickMesh);
  pickMeshes.push(pickMesh);

  cdMeshGroup.userData = {
    index: index,
    song: song,
    spinGroup: spinGroup,
    baseRotX: 0,
    baseRotY: 0,
    baseRotZ: 0,
    basePosZ: 0,
    baseScale: 1,
    hover: 0,
    targetHover: 0,
    tiltX: 0,
    tiltY: 0,
    targetTiltX: 0,
    targetTiltY: 0
  };
  galleryGroup.add(cdMeshGroup);
  discMeshes.push(cdMeshGroup);

  // Generate and apply CD texture
  const tex = await createCDTextureForSong(song);
  frontMat.map = tex;
  frontMat.needsUpdate = true;

  return cdMeshGroup;
}

// Assemble all 3D CDs
async function initCDs() {
  const promises = [];
  for (let i = 0; i < SONGS.length; i++) {
    promises.push(createCDMeshForSong(SONGS[i], i));
  }

  await Promise.all(promises);

  if (typeof updateDiscArc === 'function') {
    updateDiscArc();
  }
  if (typeof loadAudioTrack === 'function') {
    loadAudioTrack(0, false);
  }
}
