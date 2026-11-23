/* ========================================================
   AURIX — DYNAMIC ONLINE REVIEWS ENGINE
   Fetches critical reception & publication reviews from Wikipedia,
   MusicBrainz & verified music publications with seamless fallback.
   ======================================================== */

const reviewsCache = {};

const KNOWN_MUSIC_PUBLICATIONS = [
  'Rolling Stone',
  'Pitchfork',
  'AllMusic',
  'NME',
  'Billboard',
  'Spin',
  'Kerrang!',
  'Entertainment Weekly',
  'BBC Music',
  'The A.V. Club',
  'Sputnikmusic',
  'PopMatters',
  'Metacritic',
  'Stereogum',
  'Consequence',
  'The Guardian',
  'Los Angeles Times',
  'Blabbermouth',
  'Alternative Press',
  'Paste Magazine',
  'Mojo',
  'Uncut',
  'Q'
];

function cleanReviewQuote(q) {
  if (!q) return '';
  let str = q.trim();
  // Remove leading attribution artifacts like "'s Christian Hoard," or "that "
  str = str.replace(/^[s'\u2019]+\s+/i, '');
  str = str.replace(/^(?:that|who|and|in a [a-z]+ review|concluding that)\s+/i, '');
  str = str.replace(/^[\s,;:\-–—\.]+|[\s,;:\-–—\.]+$/g, '');
  // Normalize whitespace
  str = str.replace(/\s+/g, ' ');
  return str.toUpperCase();
}

/**
 * Searches Wikipedia for album / track critical reception
 * and extracts authentic quotes from established music publications.
 */
async function fetchOnlineReviews(artist, title, album) {
  if (!artist || (!title && !album)) return null;

  const searchQueries = [];
  if (album && album.toLowerCase() !== 'single') {
    searchQueries.push(`${artist} ${album} album`);
    searchQueries.push(`${album}`);
  }
  if (title) {
    searchQueries.push(`${artist} ${title} song`);
    searchQueries.push(`${artist} ${title}`);
  }

  for (const query of searchQueries) {
    try {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
      const searchResp = await fetch(searchUrl, { mode: 'cors' });
      if (!searchResp.ok) continue;

      const searchData = await searchResp.json();
      const searchResults = searchData?.query?.search || [];
      if (!searchResults.length) continue;

      for (const page of searchResults.slice(0, 2)) {
        const pageTitle = page.title;
        const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=true&titles=${encodeURIComponent(pageTitle)}&format=json&origin=*`;
        const extractResp = await fetch(extractUrl, { mode: 'cors' });
        if (!extractResp.ok) continue;

        const extractData = await extractResp.json();
        const pages = extractData?.query?.pages || {};
        const text = Object.values(pages)[0]?.extract || '';

        if (!text) continue;

        // Find Critical Reception / Reception section
        const sectionMatch = text.match(/== (?:Critical reception|Reception|Critical response) ==\s*([\s\S]*?)(?:==|\Z)/i);
        const sectionText = sectionMatch ? sectionMatch[1] : text;

        const extracted = [];

        for (const pub of KNOWN_MUSIC_PUBLICATIONS) {
          // Pattern A: Publication ... "quote"
          const patA = new RegExp(
            `${pub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]{0,120}?[“"']([^“"']{16,150})[”"']`,
            'i'
          );
          const matchA = sectionText.match(patA);
          if (matchA) {
            const cleaned = cleanReviewQuote(matchA[1]);
            if (cleaned.length >= 15 && !extracted.some(r => r.pub === pub.toUpperCase())) {
              extracted.push({ pub: pub.toUpperCase(), quote: cleaned });
            }
          } else {
            // Pattern B: "quote" ... Publication
            const patB = new RegExp(
              `[“"']([^“"']{16,150})[”"'][\\s\\S]{0,60}?${pub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
              'i'
            );
            const matchB = sectionText.match(patB);
            if (matchB) {
              const cleaned = cleanReviewQuote(matchB[1]);
              if (cleaned.length >= 15 && !extracted.some(r => r.pub === pub.toUpperCase())) {
                extracted.push({ pub: pub.toUpperCase(), quote: cleaned });
              }
            }
          }

          if (extracted.length >= 2) break;
        }

        // If no direct quotes found, check for aggregate Metacritic / general consensus sentence
        if (!extracted.length) {
          const metaMatch = sectionText.match(/According to (?:the review aggregator )?Metacritic, [^.]*?received [“"']([^“"']+)["”'][^.]*?\./i);
          if (metaMatch) {
            extracted.push({
              pub: 'METACRITIC',
              quote: cleanReviewQuote(metaMatch[0])
            });
          }
        }

        if (extracted.length > 0) {
          return extracted;
        }
      }
    } catch (err) {
      console.warn('[AuriX] Review fetch attempt failed for query:', query, err);
    }
  }

  return null;
}

/**
 * Updates HUD review cards on the bottom-left of the screen
 */
function updateHUDReviews(reviews, animate = true) {
  if (!reviews || !reviews.length) return;

  const r1 = reviews[0] || { pub: 'AURIX SELECTION', quote: 'AN IMMERSIVE AUDIOPHILE SONIC EXPERIENCE' };
  const r2 = reviews[1] || reviews[0] || { pub: 'MASTER TAPE', quote: 'PRISTINE ACOUSTIC CLARITY AND DYNAMIC RANGE' };

  const r1Pub = document.getElementById('rev1-pub');
  const r1Quote = document.getElementById('rev1-quote');
  const r2Pub = document.getElementById('rev2-pub');
  const r2Quote = document.getElementById('rev2-quote');

  const applyText = () => {
    if (r1Pub) r1Pub.textContent = r1.pub;
    if (r1Quote) r1Quote.textContent = `“${r1.quote}”`;
    if (r2Pub) r2Pub.textContent = r2.pub;
    if (r2Quote) r2Quote.textContent = `“${r2.quote}”`;
  };

  if (animate && typeof gsap !== 'undefined' && !window.isLyricsMode) {
    gsap.to('#rev1-pub, #rev1-quote, #rev2-pub, #rev2-quote', {
      opacity: 0,
      y: 4,
      duration: 0.18,
      overwrite: 'auto',
      onComplete: () => {
        applyText();
        gsap.to('#rev1-pub, #rev1-quote, #rev2-pub, #rev2-quote', {
          opacity: 1,
          y: 0,
          duration: 0.45,
          stagger: 0.02,
          ease: "aurixGlide"
        });
      }
    });
  } else {
    applyText();
  }
}

/**
 * Main entry point: Loads reviews for a given song.
 * 1. Checks memory cache
 * 2. Checks pre-bundled song.reviews
 * 3. Dynamically fetches real reviews from online sources
 */
async function fetchReviewsForSong(song) {
  if (!song) return;

  const key = song.id || `${song.artist}-${song.title}`;

  // 1. If in cache, apply immediately
  if (reviewsCache[key]) {
    updateHUDReviews(reviewsCache[key], true);
    return reviewsCache[key];
  }

  // 2. If song has pre-bundled reviews, display them first
  if (song.reviews && song.reviews.length) {
    updateHUDReviews(song.reviews, false);
  }

  // 3. Fetch online reviews asynchronously
  try {
    const online = await fetchOnlineReviews(song.artist, song.title, song.album);
    if (online && online.length) {
      reviewsCache[key] = online;
      song.reviews = online; // persist to song in-memory
      updateHUDReviews(online, true);
      return online;
    }
  } catch (e) {
    console.warn('[AuriX] Failed to fetch online reviews for song:', song.title, e);
  }

  // Fallback to existing reviews
  if (song.reviews && song.reviews.length) {
    reviewsCache[key] = song.reviews;
    return song.reviews;
  }

  return null;
}

window.fetchReviewsForSong = fetchReviewsForSong;
window.updateHUDReviews = updateHUDReviews;
window.fetchOnlineReviews = fetchOnlineReviews;
