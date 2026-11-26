// ===========================
// Full search results page
// ===========================
// Loads the same build-time index as the header drawer and renders every match.
// The query lives in ?q= so a search can be linked to and reloaded.

(function () {
  'use strict';

  const root = document.querySelector('[data-search-page]');
  const searchApi = window.PixySearch;

  if (!root || !searchApi) return;

  const form = root.querySelector('[data-search-page-form]');
  const input = root.querySelector('[data-search-page-input]');
  const status = root.querySelector('[data-search-page-status]');
  const resultsRoot = root.querySelector('[data-search-page-results]');
  const discovery = root.querySelector('[data-search-page-discovery]');
  const genresRoot = root.querySelector('[data-search-page-genres]');
  const filters = root.querySelector('[data-search-page-filters]');
  const typesRoot = root.querySelector('[data-search-page-types]');
  const indexUrl = root.dataset.index;
  const siteTitle = root.dataset.siteTitle || 'Pixy Streams';
  const validTypes = Object.keys(searchApi.kindLabels);

  let entries = null;
  let loadPromise = null;
  let loadFailed = false;
  let request = 0;
  let timer;
  let activeType = 'all';

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const setUrl = (query) => {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    if (query && activeType !== 'all') url.searchParams.set('type', activeType);
    else url.searchParams.delete('type');
    window.history.replaceState({}, '', url);
  };

  const setTitle = (query) => {
    document.title = query ? query + ' - Search | ' + siteTitle : 'Search | ' + siteTitle;
  };

  const typeLabel = (type) => searchApi.kindLabels[type] || 'Titles';

  const typeFromUrl = (params) => {
    const type = params.get('type') || 'all';
    return validTypes.includes(type) ? type : 'all';
  };

  const hideFilters = () => {
    if (!filters || !typesRoot) return;
    filters.hidden = true;
    typesRoot.textContent = '';
  };

  const renderFilters = (matches) => {
    if (!filters || !typesRoot) return;
    if (!matches.length) {
      hideFilters();
      return;
    }

    const counts = new Map();
    matches.forEach(entry => {
      counts.set(entry.kind, (counts.get(entry.kind) || 0) + 1);
    });

    typesRoot.textContent = '';
    const options = [['all', 'All', matches.length]].concat(
      validTypes.map(type => [type, searchApi.kindLabels[type], counts.get(type) || 0])
    );

    options.forEach(([type, label, count]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'search-type-filter';
      button.dataset.searchPageType = type;
      button.setAttribute('aria-pressed', String(type === activeType));
      button.setAttribute('aria-label', label + ': ' + count + (count === 1 ? ' result' : ' results'));
      button.textContent = label;

      const badge = document.createElement('span');
      badge.className = 'search-type-filter-count';
      badge.textContent = String(count);
      button.append(badge);

      typesRoot.append(button);
    });

    filters.hidden = false;
  };

  const loadIndex = () => {
    if (entries) return Promise.resolve(entries);
    if (loadPromise) return loadPromise;

    loadPromise = fetch(indexUrl, { headers: { Accept: 'application/json' } })
      .then(response => {
        if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
        return response.json();
      })
      .then(data => {
        entries = Array.isArray(data) ? data : [];
        return entries;
      })
      .catch(() => {
        loadFailed = true;
        entries = [];
        return entries;
      });

    return loadPromise;
  };

  const renderGenres = (data) => {
    const counts = new Map();
    (data || []).forEach(entry => {
      (entry.genres || []).forEach(genre => {
        const label = String(genre || '').trim();
        if (!label) return;
        counts.set(label, (counts.get(label) || 0) + 1);
      });
    });

    const genres = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    if (!genres.length || !genresRoot || !discovery) return;

    genresRoot.textContent = '';
    genres.forEach(([genre, count]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'search-suggestion';
      button.dataset.searchPageGenre = genre;
      button.textContent = genre;

      const badge = document.createElement('span');
      badge.className = 'search-suggestion-count';
      badge.textContent = String(count);
      button.append(badge);

      genresRoot.append(button);
    });

    discovery.hidden = false;
  };

  const renderResults = (query, data) => {
    const matches = searchApi.search(data, query);
    const visible = activeType === 'all'
      ? matches
      : matches.filter(entry => entry.kind === activeType);

    // A zero-match query hides the filters, so do not leave an invisible type
    // selection behind in the URL and on the next genre click.
    if (!matches.length && activeType !== 'all') {
      activeType = 'all';
      setUrl(query);
    }

    resultsRoot.textContent = '';
    if (discovery) discovery.hidden = true;
    renderFilters(matches);

    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'search-page-empty';

      if (matches.length) {
        const label = typeLabel(activeType);
        empty.textContent = 'No ' + label + ' results for "' + query + '". Choose All to see all ' + matches.length + ' results.';
        setStatus('No ' + label + ' results for "' + query + '".');
      } else {
        empty.textContent = 'No titles match "' + query + '". Try a different spelling, or browse by genre below.';
        setStatus('No results for "' + query + '".');
        renderGenres(data);
      }

      resultsRoot.append(empty);
      return;
    }

    const list = document.createElement('ol');
    list.className = 'search-page-list';

    visible.forEach(entry => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'search-result search-page-result';
      link.href = entry.url;

      const main = document.createElement('span');
      main.className = 'search-result-main';

      const title = document.createElement('span');
      title.className = 'search-result-title';
      title.textContent = entry.title;
      main.append(title);

      if (entry.meta) {
        const meta = document.createElement('span');
        meta.className = 'search-result-meta';
        meta.textContent = entry.meta;
        main.append(meta);
      }

      const kind = document.createElement('span');
      kind.className = 'search-result-kind';
      kind.textContent = searchApi.kindLabels[entry.kind] || 'Title';

      link.append(main, kind);
      item.append(link);
      list.append(item);
    });

    resultsRoot.append(list);
    const suffix = activeType === 'all' ? '' : ' in ' + typeLabel(activeType);
    setStatus(visible.length + (visible.length === 1 ? ' result' : ' results') + ' for "' + query + '"' + suffix + '.');
  };

  const showDiscovery = async (message) => {
    const requestId = ++request;
    resultsRoot.textContent = '';
    hideFilters();
    setStatus(message || 'Type at least two characters to search, or browse by genre.');

    const data = await loadIndex();
    if (requestId !== request) return;

    if (loadFailed) {
      setStatus('Search is unavailable right now.');
      return;
    }

    renderGenres(data);
  };

  const run = async (query, updateUrl = true) => {
    const value = String(query || '').trim();

    if (value.length < 2) {
      activeType = 'all';
      if (updateUrl) setUrl('');
      setTitle('');
      await showDiscovery();
      return;
    }

    if (updateUrl) setUrl(value);

    const requestId = ++request;
    if (!entries && !loadFailed) setStatus('Searching titles.');

    const data = await loadIndex();
    if (requestId !== request) return;

    if (loadFailed) {
      resultsRoot.textContent = '';
      setStatus('Search is unavailable right now.');
      return;
    }

    renderResults(value, data);
    setTitle(value);
  };

  const init = async () => {
    const params = new URLSearchParams(window.location.search);
    const initial = params.get('q') || '';
    activeType = typeFromUrl(params);
    input.value = initial;

    if (initial.trim().length >= 2) {
      await run(initial, false);
    } else {
      activeType = 'all';
      await showDiscovery();
    }

    root.dataset.searchPageReady = 'true';
  };

  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearTimeout(timer);
      run(input.value);
    });
  }

  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      run(input.value);
    }, 150);
  });

  input.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !input.value) return;
    event.preventDefault();
    clearTimeout(timer);
    input.value = '';
    run('');
  });

  if (genresRoot) {
    genresRoot.addEventListener('click', function (event) {
      const button = event.target.closest('[data-search-page-genre]');
      if (!button) return;

      input.value = button.dataset.searchPageGenre || '';
      run(input.value);
      input.focus();
    });
  }

  if (typesRoot) {
    typesRoot.addEventListener('click', function (event) {
      const button = event.target.closest('[data-search-page-type]');
      if (!button) return;

      const type = button.dataset.searchPageType || 'all';
      activeType = validTypes.includes(type) ? type : 'all';
      run(input.value).then(() => {
        const current = typesRoot.querySelector('[data-search-page-type="' + activeType + '"]');
        if (current) current.focus();
      });
    });
  }

  window.addEventListener('popstate', function () {
    const params = new URLSearchParams(window.location.search);
    const query = params.get('q') || '';
    activeType = typeFromUrl(params);
    input.value = query;
    run(query, false);
  });

  init();
})();
