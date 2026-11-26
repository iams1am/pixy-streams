// ===========================
// Shared search matching
// ===========================
// Used by the header drawer and the full search page so both rank a query the
// same way. The index is a flat JSON array of { title, url, meta, kind, genres }.

(function () {
  'use strict';

  const kindLabels = {
    movie: 'Movie',
    series: 'TV Series',
    anime: 'Anime',
    event: 'Sport',
    sample: 'Free film'
  };

  const termsFor = (query) => String(query || '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const scoreEntry = (entry, terms) => {
    const title = String(entry.title || '').toLowerCase();
    const haystack = [
      title,
      entry.meta || '',
      (entry.genres || []).join(' ')
    ].join(' ').toLowerCase();

    if (!terms.every(term => haystack.includes(term))) return -1;
    if (title.startsWith(terms[0])) return 0;
    if (title.includes(terms[0])) return 1;
    return 2;
  };

  // Returns every match, best first. Callers decide how many to render.
  const search = (entries, query) => {
    const terms = termsFor(query);
    if (!terms.length) return [];

    return (entries || [])
      .map(entry => ({ entry, score: scoreEntry(entry, terms) }))
      .filter(result => result.score >= 0)
      .sort((a, b) => a.score - b.score || a.entry.title.localeCompare(b.entry.title))
      .map(result => result.entry);
  };

  window.PixySearch = { kindLabels, termsFor, scoreEntry, search };
})();
