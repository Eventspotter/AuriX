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

    mesh.rotation.x = (ud.baseRotX || 0) + ud.tiltX;
    mesh.rotation.y = (ud.baseRotY || 0) + ud.tiltY;
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
