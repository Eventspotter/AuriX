/* ========================================================
   AURIX — AUDIO PLAYER DOCK & CONTROLLER
   ======================================================== */

const audio = document.getElementById('real-audio-player');
const playBtn = document.getElementById('audio-play-btn');
const playSvg = document.getElementById('play-svg');
const progressBar = document.getElementById('audio-progress-bar');
const progressFill = document.getElementById('audio-progress-fill');
const timeCurrent = document.getElementById('audio-time-current');
const timeTotal = document.getElementById('audio-time-total');

function formatTime(sec) {
  if (!sec || isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function loadAudioTrack(idx, autoPlay = false) {
  if (!audio || !SONGS[idx]) return;
  const song = SONGS[idx];
  audio.src = song.audioSrc;
  audio.load();
  if (autoPlay) {
    audio.play().then(() => setPlayState(true)).catch(() => setPlayState(false));
  } else {
    setPlayState(false);
  }
}

function setPlayState(playing) {
  isAudioPlaying = playing;
  if (playBtn) playBtn.classList.toggle('is-playing', playing);
  if (playSvg) {
    playSvg.innerHTML = playing
      ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>' // Pause icon
      : '<path d="M8 5v14l11-7z"/>';                  // Play icon
  }
}

if (playBtn) {
  playBtn.addEventListener('click', () => {
    if (!audio) return;
    if (audio.paused) {
      audio.play().then(() => setPlayState(true)).catch(console.error);
    } else {
      audio.pause();
      setPlayState(false);
    }
  });
}

if (audio) {
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const progress = (audio.currentTime / audio.duration) * 100;
    if (progressFill) progressFill.style.width = `${progress}%`;
    if (timeCurrent) timeCurrent.textContent = formatTime(audio.currentTime);
    if (timeTotal) timeTotal.textContent = formatTime(audio.duration);
    if (window.isLyricsMode && typeof window.updateLyricsTime === 'function') {
      window.updateLyricsTime(audio.currentTime);
    }
  });

  audio.addEventListener('seeked', () => {
    if (window.isLyricsMode && typeof window.updateLyricsTime === 'function') {
      window.updateLyricsTime(audio.currentTime, true);
    }
  });

  audio.addEventListener('ended', () => {
    if (typeof selectSong === 'function') {
      selectSong((activeIndex + 1) % SONGS.length, true);
    }
  });
}

if (progressBar && audio) {
  progressBar.addEventListener('click', (e) => {
    const rect = progressBar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = clickX / rect.width;
    audio.currentTime = pct * audio.duration;
  });
}
