/* ========================================================
   AURIX — GLOBAL APPLICATION STATE & SHARED CONSTANTS
   ======================================================== */

// Register GSAP CustomEase plugin for authentic A24 glide
if (typeof gsap !== 'undefined' && typeof CustomEase !== 'undefined') {
  gsap.registerPlugin(CustomEase);
  CustomEase.create("aurixGlide", "0.32, 0.72, 0, 1");
}

// Retrieve songs array from songs-data.js
const SONGS = (typeof AURIX_SONGS !== 'undefined' ? AURIX_SONGS : (window.AURIX_SONGS || []));

// Active Playback & Carousel State
let activeIndex = 0;
let carouselOffset = 0;
let targetCarouselOffset = 0;
const carouselState = { offset: 0 };
let carouselTween = null;
let pendingTargetIndex = 0;
const discMeshes = [];

// Explicit window bindings
if (typeof window !== 'undefined') {
  window.SONGS = SONGS;
  window.activeIndex = activeIndex;
  window.discMeshes = discMeshes;
  window.carouselState = carouselState;
  window.carouselOffset = carouselOffset;
}

// Audio & Navigation State
let isAudioPlaying = false;
let isDropdownOpen = false;
let currentSortMode = 'songs';

