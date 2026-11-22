/* ========================================================
   AURIX — APPLICATION BOOTSTRAP, RESIZING & RENDER LOOP
   ======================================================== */

// Responsive Resizing (Centered hero CD matching authentic A24 layout)
function handleResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  if (typeof galleryGroup !== 'undefined') {
    const origY = (typeof window.getOrigGalleryY === 'function') ? window.getOrigGalleryY() : (window.innerWidth < 768 ? 0.08 : window.innerWidth < 1024 ? 0.06 : 0.04);
    const origScale = (typeof window.getOrigGalleryScale === 'function') ? window.getOrigGalleryScale() : (window.innerWidth < 768 ? 0.85 : window.innerWidth < 1024 ? 0.96 : 1.08);

    if (window.isLyricsMode) {
      const targetGalleryX = (typeof window.getStackGalleryX === 'function') ? window.getStackGalleryX() : -1.35;
      galleryGroup.position.set(targetGalleryX, origY, 0);
      galleryGroup.scale.setScalar(origScale);
      galleryGroup.rotation.set(0, 0, 0);
    } else {
      const targetRot = (typeof THREE !== 'undefined' && THREE.MathUtils) ? THREE.MathUtils.degToRad(-30) : -0.5235987755982988;
      galleryGroup.rotation.set(targetRot, targetRot, 0);
      if (window.innerWidth < 768) {
        galleryGroup.position.set(0, 0.08, 0);
        galleryGroup.scale.setScalar(0.85);
      } else if (window.innerWidth < 1024) {
        galleryGroup.position.set(0, 0.06, 0);
        galleryGroup.scale.setScalar(0.96);
      } else {
        galleryGroup.position.set(0, 0.04, 0);
        galleryGroup.scale.setScalar(1.08);
      }
    }
  }
}

window.addEventListener('resize', handleResize);
handleResize();

// Main Animation Render Loop
function animate() {
  requestAnimationFrame(animate);

  // Continuously evaluate 3D hover raycasting so that when scrolling the wheel,
  // the newly arriving active CD is immediately detected under the cursor and triggers scribble
  if (typeof isPointerOverCanvas !== 'undefined' && isPointerOverCanvas && !isDragging) {
    if (typeof updateHoverAndRaycast === 'function') {
      updateHoverAndRaycast(lastPointerX, lastPointerY);
    }
  }

  // Smooth spring interpolation for subtle 3D hover tilt across discs
  discMeshes.forEach((mesh) => {
    const ud = mesh.userData;
    ud.hover += (ud.targetHover - ud.hover) * 0.12;
    ud.tiltX += (ud.targetTiltX - ud.tiltX) * 0.12;
    ud.tiltY += (ud.targetTiltY - ud.tiltY) * 0.12;

    if (typeof gsap === 'undefined' || !gsap.isTweening(mesh.rotation)) {
      mesh.rotation.x = (ud.baseRotX || 0) + ud.tiltX;
      mesh.rotation.y = (ud.baseRotY || 0) + ud.tiltY;
    }
  });

  // Animate authentic A24 hover scribble
  if (typeof updateScribbleAnimation === 'function') {
    updateScribbleAnimation(performance.now());
  }

  // Maintain authentic A24 disc orientation without off-axis drift
  discMeshes.forEach(mesh => {
    if (mesh.userData?.spinGroup && mesh.userData.spinGroup.rotation.z !== 0) {
      mesh.userData.spinGroup.rotation.z = 0;
    }
  });

  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

// Initialize Application
if (typeof initCDs === 'function') {
  initCDs();
}
animate();
