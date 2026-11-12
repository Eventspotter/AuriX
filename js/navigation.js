/* ========================================================
   INDEX DROPDOWN ROSTER (Authentic A24 Interaction & Animation)
   ======================================================== */

const mainNav = document.getElementById('main-nav');
const pageBackdrop = document.getElementById('page-backdrop');
const dropdownToggle = document.getElementById('dropdown-toggle');
const dropdownRoster = document.getElementById('dropdown-roster');
const dropdownContentScroller = document.getElementById('dropdown-content-scroller');
const dropdownItemsContainer = document.getElementById('dropdown-items');
const dropdownScrollThumb = document.getElementById('dropdown-scroll-thumb');
const dropdownScrollbar = document.getElementById('dropdown-scrollbar');
const navSongsBtn = document.getElementById('nav-songs-btn');
const navArtistsBtn = document.getElementById('nav-artists-btn');
const navLogoBtn = document.getElementById('nav-logo-btn');

function toTitleCase(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/(^|\s|\/|-|\()([a-z])/g, m => m.toUpperCase());
}

function renderDropdownItems() {
  if (!dropdownItemsContainer) return;
  dropdownItemsContainer.innerHTML = '';

  // Build items based on sort mode
  const items = SONGS.map((song, originalIdx) => ({ song, originalIdx }));
  if (currentSortMode === 'artists') {
    items.sort((a, b) => a.song.artist.localeCompare(b.song.artist));
  }

  items.forEach(({ song, originalIdx }) => {
    const row = document.createElement('div');
    row.className = 'nav-dropdown__row';

    const a = document.createElement('a');
    a.className = 'nav-dropdown__link';
    a.setAttribute('data-film-status', originalIdx === activeIndex ? 'active' : 'inactive');
    a.setAttribute('data-song-idx', originalIdx);
    a.href = '#';

    const titleFormatted = toTitleCase(song.title);
    const titleText = currentSortMode === 'artists' ? `${song.artist} — ${titleFormatted}` : titleFormatted;
    const metaText = currentSortMode === 'artists' ? song.year : song.artist;

    a.innerHTML = `
      <div class="nav-dropdown__link-bg" aria-hidden="true"></div>
      <div class="nav-dropdown__link-inner">
        <span class="nav-dropdown__link-label nav-dropdown__title">${titleText}</span>
        <span class="nav-dropdown__year-mask">
          <span class="nav-dropdown__link-label nav-dropdown__meta">${metaText}</span>
        </span>
      </div>
    `;

    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof selectSong === 'function') {
        selectSong(originalIdx, true);
      }
      closeDropdown();
    });

    row.appendChild(a);
    dropdownItemsContainer.appendChild(row);
  });

  updateScrollFade();
}

function updateDropdownActiveState(idx) {
  if (!dropdownItemsContainer) return;
  const allLinks = dropdownItemsContainer.querySelectorAll('.nav-dropdown__link');
  allLinks.forEach(link => {
    const songIdx = parseInt(link.getAttribute('data-song-idx'), 10);
    link.setAttribute('data-film-status', songIdx === idx ? 'active' : 'inactive');
  });
}

function updateScrollFade() {
  const el = dropdownContentScroller;
  if (!el) return;
  const maxScroll = el.scrollHeight - el.clientHeight;
  const topFade = maxScroll > 0 ? Math.min(1, el.scrollTop / 28) : 0;
  const botFade = maxScroll > 0 ? Math.min(1, (maxScroll - el.scrollTop) / 28) : 0;
  el.style.setProperty('--nav-fade-top', topFade.toFixed(4));
  el.style.setProperty('--nav-fade-bottom', botFade.toFixed(4));

  if (dropdownScrollbar) {
    if (maxScroll <= 0) {
      dropdownScrollbar.classList.add('is-disabled');
    } else {
      dropdownScrollbar.classList.remove('is-disabled');
      if (dropdownScrollThumb) {
        const trackH = dropdownScrollbar.clientHeight;
        const thumbH = Math.max(24, (el.clientHeight / el.scrollHeight) * trackH);
        const thumbTop = (el.scrollTop / maxScroll) * (trackH - thumbH);
        dropdownScrollThumb.style.height = `${thumbH}px`;
        dropdownScrollThumb.style.transform = `translateY(${thumbTop}px)`;
      }
    }
  }
}

if (dropdownContentScroller) {
  dropdownContentScroller.addEventListener('scroll', updateScrollFade, { passive: true });
}

function openDropdown() {
  if (!mainNav || !dropdownToggle || !dropdownRoster || !pageBackdrop) return;
  isDropdownOpen = true;
  mainNav.setAttribute('data-nav-dropdown', 'open');
  dropdownToggle.setAttribute('data-dropdown-toggle', 'open');
  dropdownToggle.setAttribute('aria-expanded', 'true');
  dropdownRoster.setAttribute('aria-hidden', 'false');
  pageBackdrop.classList.add('is-active');

  updateDropdownActiveState(activeIndex);

  // Smoothly center the active track inside scroller
  setTimeout(() => {
    if (!dropdownItemsContainer || !dropdownContentScroller) return;
    const activeLink = dropdownItemsContainer.querySelector('[data-film-status="active"]');
    if (activeLink) {
      const offsetTop = activeLink.offsetTop - dropdownContentScroller.clientHeight / 2 + activeLink.clientHeight / 2;
      dropdownContentScroller.scrollTo({ top: Math.max(0, offsetTop), behavior: 'smooth' });
    }
    updateScrollFade();
  }, 60);
}

function closeDropdown() {
  if (!mainNav || !dropdownToggle || !dropdownRoster || !pageBackdrop) return;
  isDropdownOpen = false;
  mainNav.removeAttribute('data-nav-dropdown');
  dropdownToggle.setAttribute('data-dropdown-toggle', 'closed');
  dropdownToggle.setAttribute('aria-expanded', 'false');
  dropdownRoster.setAttribute('aria-hidden', 'true');
  pageBackdrop.classList.remove('is-active');
}

if (dropdownToggle) {
  dropdownToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    isDropdownOpen ? closeDropdown() : openDropdown();
  });
}

if (pageBackdrop) {
  pageBackdrop.addEventListener('click', closeDropdown);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isDropdownOpen) {
    closeDropdown();
  }
});

document.addEventListener('click', (e) => {
  if (isDropdownOpen && mainNav && !mainNav.contains(e.target)) {
    closeDropdown();
  }
});

if (navSongsBtn) {
  navSongsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    currentSortMode = 'songs';
    navSongsBtn.classList.add('active');
    if (navArtistsBtn) navArtistsBtn.classList.remove('active');
    renderDropdownItems();
    openDropdown();
  });
}

if (navArtistsBtn) {
  navArtistsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    currentSortMode = 'artists';
    navArtistsBtn.classList.add('active');
    if (navSongsBtn) navSongsBtn.classList.remove('active');
    renderDropdownItems();
    openDropdown();
  });
}

if (navLogoBtn) {
  navLogoBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof selectSong === 'function') {
      selectSong(0);
    }
    closeDropdown();
  });
}

// Initial render of dropdown roster items
renderDropdownItems();
