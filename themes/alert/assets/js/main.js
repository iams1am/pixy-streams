// ===========================
// Pixy Streams - Main JavaScript
// ===========================

(function() {
  'use strict';

  const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionBehavior = () => reduceMotionQuery.matches ? 'auto' : 'smooth';

  // ===========================
  // Local kick-off times
  // ===========================
  // The source timestamps stay UTC in the markup so the page remains correct
  // without JavaScript. When it is available, show the same instant in the
  // visitor's own time zone.
  const applyLocalTimes = () => {
    if (!window.Intl || !window.Intl.DateTimeFormat) return;
    let formatter;
    try {
      formatter = new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return;
    }

    document.querySelectorAll('[data-local-time]').forEach(element => {
      const iso = element.getAttribute('datetime') || element.getAttribute('data-local-time');
      if (!iso) return;
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return;

      element.textContent = formatter.format(date);
      element.setAttribute('title', date.toISOString());
      element.setAttribute('data-local-time-applied', 'true');
    });
  };

  applyLocalTimes();

  // ===========================
  // Theme Toggle
  // ===========================
  const themeToggle = document.querySelector('.theme-toggle');
  const html = document.documentElement;

  const readStoredTheme = () => {
    try {
      const stored = localStorage.getItem('theme');
      return stored === 'dark' || stored === 'light' ? stored : null;
    } catch (error) {
      return null;
    }
  };

  const writeStoredTheme = (theme) => {
    try {
      localStorage.setItem('theme', theme);
    } catch (error) {
      // Persistence is best-effort; the theme still applies for this visit.
    }
  };

  const syncThemeToggle = (theme) => {
    if (!themeToggle) return;
    themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
    themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  };

  // The inline head script restores the saved theme before paint; this keeps it
  // correct when storage is unavailable or the script could not run.
  const currentTheme = readStoredTheme() || (html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  html.setAttribute('data-theme', currentTheme);
  syncThemeToggle(currentTheme);

  if (themeToggle) {
    themeToggle.addEventListener('click', function() {
      const theme = html.getAttribute('data-theme');
      const newTheme = theme === 'light' ? 'dark' : 'light';

      html.setAttribute('data-theme', newTheme);
      writeStoredTheme(newTheme);
      syncThemeToggle(newTheme);

      // Add a transition class for smooth theme change
      html.style.transition = 'background-color 0.3s ease, color 0.3s ease';
      setTimeout(() => {
        html.style.transition = '';
      }, 300);
    });
  }

  // ===========================
  // Mobile Navigation Toggle
  // ===========================
  const navbarToggle = document.querySelector('.navbar-toggle');
  const navbarMenu = document.querySelector('.navbar-menu');
  const mobileNavQuery = window.matchMedia('(max-width: 1279px)');

  // Keep body scroll locked only while a modal surface is actually open.
  const syncBodyScrollLock = () => {
    const navOpen = Boolean(navbarMenu && mobileNavQuery.matches && navbarMenu.classList.contains('active'));
    const dialog = document.querySelector('[data-trailer-dialog]');
    const dialogOpen = Boolean(dialog && dialog.open);
    document.body.style.overflow = navOpen || dialogOpen ? 'hidden' : '';
  };

  const setDropdownState = (dropdown, expanded) => {
    if (!dropdown) return;
    dropdown.classList.toggle('active', expanded);
    const trigger = dropdown.querySelector('.nav-link');
    if (trigger) trigger.setAttribute('aria-expanded', String(expanded));
  };

  const closeDropdowns = () => {
    document.querySelectorAll('.nav-item-dropdown').forEach(dropdown => setDropdownState(dropdown, false));
  };

  const closeMobileNav = () => {
    if (!navbarMenu || !navbarToggle) return;
    navbarMenu.classList.remove('active');
    navbarToggle.classList.remove('active');
    navbarToggle.setAttribute('aria-expanded', 'false');
    closeDropdowns();
    syncBodyScrollLock();
  };

  if (navbarToggle && navbarMenu) {
    navbarToggle.addEventListener('click', function() {
      const willOpen = !navbarMenu.classList.contains('active');

      navbarMenu.classList.toggle('active', willOpen);
      navbarToggle.classList.toggle('active', willOpen);
      navbarToggle.setAttribute('aria-expanded', String(willOpen));

      if (!willOpen) closeDropdowns();
      syncBodyScrollLock();
    });

    // Close menu when clicking outside
    document.addEventListener('click', function(e) {
      if (!navbarToggle.contains(e.target) && !navbarMenu.contains(e.target)) {
        closeMobileNav();
      }
    });

    // Close menu when pressing Escape
    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[data-trailer-dialog][open]')) return;

      const openDropdown = document.querySelector('.nav-item-dropdown.active');
      if (openDropdown) {
        setDropdownState(openDropdown, false);
        openDropdown.querySelector('.nav-link')?.focus();
        e.preventDefault();
        return;
      }

      if (navbarMenu.classList.contains('active')) {
        closeMobileNav();
        navbarToggle.focus();
      }
    });

    // Keep Tab inside the open mobile menu instead of reaching the page behind it.
    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Tab' || !mobileNavQuery.matches || !navbarMenu.classList.contains('active')) return;

      const focusable = Array.from(navbarMenu.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter(element => !element.hidden && element.offsetParent !== null);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeInside = navbarMenu.contains(document.activeElement);

      if (e.shiftKey && (!activeInside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!activeInside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  // ===========================
  // Dropdown Toggles
  // ===========================
  const dropdownItems = document.querySelectorAll('.nav-item-dropdown');

  dropdownItems.forEach(dropdown => {
    const trigger = dropdown.querySelector('.nav-link');
    if (!trigger) return;

    // Mobile: the parent link becomes a disclosure button.
    trigger.addEventListener('click', function(event) {
      if (!mobileNavQuery.matches) return;

      event.preventDefault();
      const willExpand = !dropdown.classList.contains('active');
      closeDropdowns();
      setDropdownState(dropdown, willExpand);
    });

    // Desktop: keep ARIA state in sync with the CSS hover/focus behaviour.
    dropdown.addEventListener('mouseenter', function() {
      if (!mobileNavQuery.matches) trigger.setAttribute('aria-expanded', 'true');
    });

    dropdown.addEventListener('mouseleave', function() {
      if (!mobileNavQuery.matches && !dropdown.contains(document.activeElement)) {
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    dropdown.addEventListener('focusin', function() {
      if (!mobileNavQuery.matches) trigger.setAttribute('aria-expanded', 'true');
    });

    dropdown.addEventListener('focusout', function(event) {
      if (mobileNavQuery.matches) return;
      if (event.relatedTarget && dropdown.contains(event.relatedTarget)) return;
      if (!dropdown.matches(':hover')) trigger.setAttribute('aria-expanded', 'false');
    });
  });

  // Collapse the mobile menu and any open disclosure when crossing breakpoints.
  mobileNavQuery.addEventListener('change', function() {
    closeMobileNav();
    closeDropdowns();
  });

  // ===========================
  // Smooth Scrolling for Anchor Links
  // ===========================
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      
      // Don't smooth scroll for empty hashes
      if (href === '#') return;
      
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        
        const headerHeight = document.querySelector('.site-header')?.offsetHeight || 0;
        const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerHeight;
        
        window.scrollTo({
          top: targetPosition,
          behavior: motionBehavior()
        });
        
        // Close mobile menu if open
        if (navbarMenu && navbarMenu.classList.contains('active')) {
          closeMobileNav();
        }
      }
    });
  });

  // ===========================
  // Rail Controls Refresh
  // ===========================
  const railUpdateCallbacks = [];

  const refreshRailControls = () => {
    railUpdateCallbacks.forEach(callback => callback());
  };

  // ===========================
  // Category Filter
  // ===========================
  const categoryFilter = document.querySelector('[data-category-filter]');

  if (categoryFilter) {
    const categoryButtons = Array.from(categoryFilter.querySelectorAll('[data-genre]'));
    const clearButton = categoryFilter.querySelector('[data-clear]');
    const statusMessage = categoryFilter.querySelector('[data-filter-status]');
    const emptyMessage = categoryFilter.querySelector('[data-filter-empty]');
    const filterableSections = Array.from(document.querySelectorAll('[data-filterable]'));
    const railCards = Array.from(document.querySelectorAll('[data-filterable] .rail-card'));

    // The same title can appear in several rails. Count each genre once per title
    // so the chip numbers match what selecting that genre will actually reveal.
    const genreCounts = new Map();
    const countedTitles = new Set();

    railCards.forEach(card => {
      const title = card.getAttribute('href') || card.textContent.trim();
      if (countedTitles.has(title)) return;
      countedTitles.add(title);

      (card.dataset.genres || '').split(',').filter(Boolean).forEach(slug => {
        genreCounts.set(slug, (genreCounts.get(slug) || 0) + 1);
      });
    });

    categoryButtons.forEach(button => {
      const count = genreCounts.get(button.dataset.genre) || 0;
      const badge = button.querySelector('.category-count');
      if (badge) badge.textContent = String(count);
      button.hidden = count === 0;
    });

    const selectedCategories = () => categoryButtons
      .filter(button => button.getAttribute('aria-pressed') === 'true')
      .map(button => ({ slug: button.dataset.genre, label: button.dataset.label }));

    const applyCategoryFilter = () => {
      const selected = selectedCategories();
      const slugs = selected.map(category => category.slug);
      const labels = selected.map(category => category.label);
      const shownTitles = new Set();

      filterableSections.forEach(section => {
        let matchesInSection = 0;

        section.querySelectorAll('.rail-card').forEach(card => {
          const cardGenres = (card.dataset.genres || '').split(',').filter(Boolean);
          const matches = slugs.length === 0 || slugs.some(slug => cardGenres.includes(slug));

          card.classList.toggle('is-filtered-out', !matches);
          if (matches) {
            matchesInSection += 1;
            shownTitles.add(card.getAttribute('href') || card.textContent.trim());
          }
        });

        section.classList.toggle('is-filtered-out', matchesInSection === 0);
      });

      const shown = shownTitles.size;

      if (clearButton) clearButton.hidden = selected.length === 0;
      if (emptyMessage) emptyMessage.hidden = shown !== 0;

      if (statusMessage) {
        if (!selected.length) {
          statusMessage.textContent = '';
        } else if (!shown) {
          statusMessage.textContent = 'Nothing matches ' + labels.join(' or ') + ' right now.';
        } else {
          statusMessage.textContent = shown + ' title' + (shown === 1 ? '' : 's') + ' matching ' + labels.join(' or ') + '.';
        }
      }

      refreshRailControls();
    };

    categoryButtons.forEach(button => {
      button.addEventListener('click', function() {
        const pressed = this.getAttribute('aria-pressed') === 'true';
        this.setAttribute('aria-pressed', pressed ? 'false' : 'true');
        applyCategoryFilter();
      });
    });

    if (clearButton) {
      clearButton.addEventListener('click', function() {
        categoryButtons.forEach(button => button.setAttribute('aria-pressed', 'false'));
        applyCategoryFilter();
      });
    }

    applyCategoryFilter();
  }

  // ===========================
  // Rail Scrolling
  // ===========================
  document.querySelectorAll('.rail-section').forEach(section => {
    const rail = section.querySelector('.rail');
    const buttons = section.querySelectorAll('[data-rail-scroll]');

    if (!rail || !buttons.length) return;

    const updateRailControls = () => {
      const overflowing = rail.scrollWidth > rail.clientWidth + 4;
      const atStart = rail.scrollLeft <= 2;
      const atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2;

      buttons.forEach(button => {
        const direction = Number(button.dataset.railScroll);
        button.hidden = !overflowing;
        button.disabled = !overflowing || (direction < 0 ? atStart : atEnd);
      });
    };

    buttons.forEach(button => {
      button.addEventListener('click', function() {
        const direction = Number(this.dataset.railScroll);
        rail.scrollBy({
          left: direction * Math.round(rail.clientWidth * 0.8),
          behavior: motionBehavior()
        });
      });
    });

    rail.addEventListener('scroll', updateRailControls, { passive: true });
    window.addEventListener('resize', updateRailControls);
    railUpdateCallbacks.push(updateRailControls);
    updateRailControls();
  });

  // ===========================
  // Browse-all sorting
  // ===========================
  document.querySelectorAll('[data-grid-sort]').forEach(select => {
    const section = document.getElementById(select.dataset.gridSort);
    const grid = section?.querySelector('[data-catalog-grid]');
    const status = section?.querySelector('[data-grid-status]');

    if (!grid) return;

    const cards = Array.from(grid.querySelectorAll('.rail-card'));
    cards.forEach((card, index) => { card.dataset.defaultIndex = String(index); });

    const text = (card, key, fallback = '') => card.dataset[key] ?? fallback;
    const number = (card, key) => Number.parseFloat(card.dataset[key] || '0') || 0;
    const byTitle = (a, b) => text(a, 'sortTitle').localeCompare(text(b, 'sortTitle'));

    const comparators = {
      score: (a, b) => number(b, 'sortScore') - number(a, 'sortScore') || byTitle(a, b),
      year: (a, b) => number(b, 'sortYear') - number(a, 'sortYear') || byTitle(a, b),
      time: (a, b) => text(a, 'sortTime', '9999').localeCompare(text(b, 'sortTime', '9999')),
      title: byTitle,
      default: (a, b) => Number(a.dataset.defaultIndex) - Number(b.dataset.defaultIndex)
    };

    select.addEventListener('change', function() {
      const comparator = comparators[select.value] || comparators.default;
      const fragment = document.createDocumentFragment();

      cards.slice().sort(comparator).forEach(card => fragment.append(card));
      grid.append(fragment);

      if (status) {
        const label = select.options[select.selectedIndex].text;
        status.textContent = select.value === 'default' ? '' : 'Sorted by ' + label.toLowerCase() + '.';
      }
    });
  });

  // ===========================
  // Header Search
  // ===========================
  const searchRoot = document.querySelector('[data-search]');

  if (searchRoot) {
    const searchForm = searchRoot.querySelector('[data-search-form]');
    const searchInput = searchRoot.querySelector('[data-search-input]');
    const searchPanel = searchRoot.querySelector('[data-search-results]');
    const searchStatus = searchRoot.querySelector('[data-search-status]');
    const indexUrl = searchRoot.dataset.index;
    const genresUrl = searchRoot.dataset.genresUrl || '';

    let searchIndex = null;
    let indexPromise = null;
    let indexFailed = false;
    let results = [];
    let resultTotal = 0;
    let activeResult = -1;
    let searchTimer;
    let searchRequest = 0;

    const kindLabels = { movie: 'Movie', series: 'TV Series', anime: 'Anime', event: 'Sport', sample: 'Free film' };

    const setStatus = (message) => {
      if (searchStatus) searchStatus.textContent = message;
    };

    const loadIndex = () => {
      if (searchIndex) return Promise.resolve(searchIndex);
      if (indexPromise) return indexPromise;

      indexPromise = fetch(indexUrl, { headers: { Accept: 'application/json' } })
        .then(response => {
          if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
          return response.json();
        })
        .then(data => {
          searchIndex = Array.isArray(data) ? data : [];
          return searchIndex;
        })
        .catch(() => {
          indexFailed = true;
          searchIndex = [];
          return searchIndex;
        });

      return indexPromise;
    };

    const showPanel = () => {
      searchPanel.hidden = false;
      searchInput.setAttribute('aria-expanded', 'true');
    };

    const closeResults = () => {
      searchPanel.hidden = true;
      searchPanel.textContent = '';
      searchInput.setAttribute('aria-expanded', 'false');
      searchInput.removeAttribute('aria-activedescendant');
      activeResult = -1;
      setStatus('');
    };

    const renderMessage = (message) => {
      searchPanel.textContent = '';
      const paragraph = document.createElement('p');
      paragraph.className = 'search-empty';
      paragraph.textContent = message;
      searchPanel.append(paragraph);

      if (genresUrl) {
        const link = document.createElement('a');
        link.className = 'search-empty-link';
        link.href = genresUrl;
        link.textContent = 'Browse all genres →';
        searchPanel.append(link);
      }

      showPanel();
      searchInput.removeAttribute('aria-activedescendant');
    };

    const renderLoading = (message) => {
      searchPanel.textContent = '';
      searchPanel.setAttribute('aria-busy', 'true');
      const paragraph = document.createElement('p');
      paragraph.className = 'search-empty search-loading';
      paragraph.textContent = message;
      searchPanel.append(paragraph);
      showPanel();
    };

    const renderDiscovery = (data) => {
      searchPanel.textContent = '';
      searchPanel.removeAttribute('aria-busy');
      searchInput.removeAttribute('aria-activedescendant');
      activeResult = -1;

      if (indexFailed) {
        renderMessage('Search is unavailable right now.');
        setStatus('Search is unavailable right now.');
        return;
      }

      const counts = new Map();
      (data || []).forEach(entry => {
        (entry.genres || []).forEach(genre => {
          const label = String(genre || '').trim();
          if (!label) return;
          counts.set(label, (counts.get(label) || 0) + 1);
        });
      });

      const topGenres = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8);

      if (topGenres.length) {
        const label = document.createElement('p');
        label.className = 'search-discovery-label';
        label.textContent = 'Browse by genre';

        const suggestions = document.createElement('div');
        suggestions.className = 'search-suggestions';

        topGenres.forEach(([genre, count]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'search-suggestion';
          button.dataset.searchSuggestion = genre;
          button.textContent = genre;

          const badge = document.createElement('span');
          badge.className = 'search-suggestion-count';
          badge.textContent = String(count);
          button.append(badge);

          suggestions.append(button);
        });

        searchPanel.append(label, suggestions);
      }

      if (genresUrl) {
        const link = document.createElement('a');
        link.className = 'search-discovery-link';
        link.href = genresUrl;
        link.textContent = 'All genres →';
        searchPanel.append(link);
      }

      if (!topGenres.length && !genresUrl) {
        renderMessage('Start typing to search titles.');
        return;
      }

      setStatus('Browse by genre, or type at least two letters.');
      showPanel();
    };

    const showDiscovery = async () => {
      const requestId = ++searchRequest;

      if (!searchIndex && !indexFailed) {
        setStatus('Loading genres.');
        renderLoading('Loading genres…');
      }

      const data = await loadIndex();
      if (requestId !== searchRequest) return;
      renderDiscovery(data);
    };

    const scoreEntry = (entry, terms) => {
      const title = (entry.title || '').toLowerCase();
      const haystack = [title, entry.meta || '', (entry.genres || []).join(' ')].join(' ').toLowerCase();

      if (!terms.every(term => haystack.includes(term))) return -1;
      if (title.startsWith(terms[0])) return 0;
      if (title.includes(terms[0])) return 1;
      return 2;
    };

    const renderResults = (query) => {
      searchPanel.textContent = '';
      searchPanel.removeAttribute('aria-busy');

      if (indexFailed) {
        renderMessage('Search is unavailable right now.');
        return;
      }

      if (!results.length) {
        const empty = document.createElement('p');
        empty.className = 'search-empty';
        empty.textContent = 'No titles match "' + query + '".';
        searchPanel.append(empty);

        if (genresUrl) {
          const link = document.createElement('a');
          link.className = 'search-empty-link';
          link.href = genresUrl;
          link.textContent = 'Browse all genres →';
          searchPanel.append(link);
        }
      } else {
        results.forEach((entry, position) => {
          const link = document.createElement('a');
          link.className = 'search-result';
          link.href = entry.url;
          link.id = 'search-result-' + position;
          link.tabIndex = -1;
          link.setAttribute('role', 'option');
          link.setAttribute('aria-selected', String(position === activeResult));

          if (entry.external) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
          }

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
          kind.textContent = kindLabels[entry.kind] || 'Title';

          link.append(main, kind);
          searchPanel.append(link);
        });
      }

      showPanel();

      if (activeResult >= 0) {
        searchInput.setAttribute('aria-activedescendant', 'search-result-' + activeResult);
        const active = searchPanel.querySelector('#search-result-' + activeResult);
        if (active && typeof active.scrollIntoView === 'function') {
          active.scrollIntoView({ block: 'nearest' });
        }
      } else {
        searchInput.removeAttribute('aria-activedescendant');
      }
    };

    const runSearch = async () => {
      const rawValue = searchInput.value.trim();
      const value = rawValue.toLowerCase();
      const requestId = ++searchRequest;

      if (value.length < 2) {
        results = [];
        resultTotal = 0;
        activeResult = -1;
        if (document.activeElement === searchInput) showDiscovery();
        else closeResults();
        return;
      }

      if (!searchIndex && !indexFailed) {
        setStatus('Searching titles.');
        renderLoading('Searching titles…');
      }

      const data = await loadIndex();
      if (requestId !== searchRequest) return;

      if (indexFailed) {
        results = [];
        resultTotal = 0;
        renderResults(rawValue);
        setStatus('Search is unavailable right now.');
        return;
      }

      const terms = value.split(/\s+/).filter(Boolean);
      const matches = (data || [])
        .map(entry => ({ entry, score: scoreEntry(entry, terms) }))
        .filter(result => result.score >= 0)
        .sort((a, b) => a.score - b.score || a.entry.title.localeCompare(b.entry.title));

      resultTotal = matches.length;
      results = matches.slice(0, 8).map(result => result.entry);
      activeResult = -1;
      renderResults(rawValue);

      if (!resultTotal) {
        setStatus('No titles match ' + rawValue + '.');
      } else if (resultTotal > results.length) {
        setStatus('Showing ' + results.length + ' of ' + resultTotal + ' results for ' + rawValue + '.');
      } else {
        setStatus(resultTotal + (resultTotal === 1 ? ' result' : ' results') + ' for ' + rawValue + '.');
      }
    };

    const openResult = (position) => {
      const entry = results[position] || results[0];
      if (!entry) return;

      if (entry.external) window.open(entry.url, '_blank', 'noopener');
      else window.location.href = entry.url;
    };

    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 120);
    });

    searchInput.addEventListener('search', function() {
      clearTimeout(searchTimer);
      runSearch();
    });

    searchInput.addEventListener('focus', function() {
      if (searchInput.value.trim().length >= 2) runSearch();
      else showDiscovery();
    });

    searchInput.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        // Close the results first and keep the event from also closing the
        // mobile menu; a second Escape reaches the document handler.
        if (!searchPanel.hidden) {
          closeResults();
          event.stopPropagation();
        }
        return;
      }

      if (searchPanel.hidden || !results.length) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();

        if (event.key === 'Home') activeResult = 0;
        else if (event.key === 'End') activeResult = results.length - 1;
        else if (event.key === 'ArrowDown') activeResult = (activeResult + 1) % results.length;
        else activeResult = activeResult <= 0 ? results.length - 1 : activeResult - 1;

        renderResults(searchInput.value.trim());
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        openResult(activeResult >= 0 ? activeResult : 0);
      }
    });

    if (searchForm) {
      searchForm.addEventListener('submit', function(event) {
        event.preventDefault();
        if (results.length) openResult(activeResult >= 0 ? activeResult : 0);
      });
    }

    searchPanel.addEventListener('click', function(event) {
      const suggestion = event.target.closest('[data-search-suggestion]');
      if (!suggestion) return;

      searchInput.value = suggestion.dataset.searchSuggestion || '';
      searchInput.focus();
      runSearch();
    });

    document.addEventListener('click', function(event) {
      if (!searchRoot.contains(event.target)) closeResults();
    });

    searchRoot.addEventListener('focusout', function(event) {
      if (event.relatedTarget && searchRoot.contains(event.relatedTarget)) return;

      // Defer so a click on a result is processed before the panel is cleared.
      setTimeout(function() {
        if (!searchRoot.contains(document.activeElement)) closeResults();
      }, 0);
    });

    // "/" focuses search from anywhere on the page, matching common site-search
    // shortcuts without stealing the key from form fields.
    document.addEventListener('keydown', function(event) {
      if (event.key !== '/' || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (document.querySelector('[data-trailer-dialog][open]')) return;

      const target = event.target;
      if (target instanceof HTMLElement && (target.closest('input, textarea, select') || target.isContentEditable)) return;

      event.preventDefault();

      if (mobileNavQuery.matches && navbarMenu && !navbarMenu.classList.contains('active')) {
        navbarToggle.click();
        // Apply the open state before focusing: a visibility transition can
        // otherwise leave the field unfocusable in the same task.
        navbarMenu.getBoundingClientRect();
      }

      searchInput.focus();
      searchInput.select();
    });

    // Lets the browser smoke test wait for real readiness instead of guessing
    // a timeout on slower networks.
    searchRoot.dataset.searchReady = 'true';
  }

  // ===========================
  // Native Video Playback and Progress
  // ===========================
  const WATCH_PROGRESS_PREFIX = 'pixy:watch:progress:';
  const WATCH_PROGRESS_VERSION = 1;
  const WATCH_COMPLETED_KEY = 'pixy:watch:completed';
  const WATCH_COMPLETED_VERSION = 1;

  const formatWatchTime = (seconds) => {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remaining = total % 60;
    return hours
      ? hours + ':' + String(minutes).padStart(2, '0') + ':' + String(remaining).padStart(2, '0')
      : minutes + ':' + String(remaining).padStart(2, '0');
  };

  const readWatchProgress = (id) => {
    if (!id) return null;
    try {
      const value = JSON.parse(localStorage.getItem(WATCH_PROGRESS_PREFIX + id) || 'null');
      if (!value || typeof value.t !== 'number' || typeof value.d !== 'number') return null;
      if (!Number.isFinite(value.t) || !Number.isFinite(value.d) || value.d <= 0) return null;
      if (value.t < 5 || value.d - value.t < 10) return null;
      return value;
    } catch (error) {
      return null;
    }
  };

  const writeWatchProgress = (id, currentTime, duration) => {
    if (!id) return;
    try {
      localStorage.setItem(
        WATCH_PROGRESS_PREFIX + id,
        JSON.stringify({ version: WATCH_PROGRESS_VERSION, t: currentTime, d: duration, at: Date.now() })
      );
    } catch (error) {
      // Progress is a convenience; private browsing can reject storage.
    }
  };

  const clearWatchProgress = (id) => {
    if (!id) return;
    try {
      localStorage.removeItem(WATCH_PROGRESS_PREFIX + id);
    } catch (error) {
      // Ignore storage failures.
    }
  };

  const readWatchCompleted = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(WATCH_COMPLETED_KEY) || '[]');
      const items = Array.isArray(parsed)
        ? parsed
        : (parsed && Array.isArray(parsed.items) ? parsed.items : []);
      return items
        .map(item => (typeof item === 'string' ? { id: item, at: 0 } : item))
        .filter(item => item && typeof item.id === 'string');
    } catch (error) {
      return [];
    }
  };

  const writeWatchCompleted = (items) => {
    try {
      localStorage.setItem(
        WATCH_COMPLETED_KEY,
        JSON.stringify({ version: WATCH_COMPLETED_VERSION, items: items.slice(0, 50) })
      );
    } catch (error) {
      // Completion state is a convenience; storage can be unavailable.
    }
  };

  const markWatchComplete = (id) => {
    if (!id) return;
    const items = readWatchCompleted().filter(item => item.id !== id);
    items.unshift({ id, at: Date.now() });
    writeWatchCompleted(items);
  };

  const clearWatchComplete = (id) => {
    if (!id) return;
    writeWatchCompleted(readWatchCompleted().filter(item => item.id !== id));
  };

  const isWatchComplete = (id) => Boolean(id) && readWatchCompleted().some(item => item.id === id);

  const hasWatchHistory = () => {
    if (readWatchCompleted().length) return true;
    return Array.from(document.querySelectorAll('.watch-library .watch-card[data-watch-id]'))
      .some(card => Boolean(readWatchProgress(card.getAttribute('data-watch-id'))));
  };

  const clearWatchHistory = () => {
    try {
      const keys = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.startsWith(WATCH_PROGRESS_PREFIX)) keys.push(key);
      }
      keys.forEach(key => localStorage.removeItem(key));
      localStorage.removeItem(WATCH_COMPLETED_KEY);
    } catch (error) {
      // Clearing history is best-effort in restricted storage contexts.
    }
  };

  // The watch library lists every sample, so Continue Watching can reuse the
  // existing cards instead of keeping a second copy of the metadata. Completed
  // records are separate from progress so a finished film can be labelled
  // without keeping a resume position around.
  const watchLibraryCards = Array.from(document.querySelectorAll('.watch-library .watch-card[data-watch-id]'));
  const continueSection = document.querySelector('[data-watch-continue]');
  const continueGrid = continueSection ? continueSection.querySelector('[data-watch-continue-grid]') : null;
  const historyClear = document.querySelector('[data-watch-history-clear]');

  const updateWatchCardStates = () => {
    const completed = new Set(readWatchCompleted().map(item => item.id));

    watchLibraryCards.forEach(card => {
      const id = card.getAttribute('data-watch-id');
      const poster = card.querySelector('.watch-card-poster');
      if (!id || !poster) return;

      let state = poster.querySelector('[data-watch-state]');
      if (!state) {
        state = document.createElement('span');
        state.className = 'watch-card-state';
        state.setAttribute('data-watch-state', '');
        poster.append(state);
      }

      let track = poster.querySelector('[data-watch-progress-track]');
      let fill = track ? track.querySelector('.watch-card-progress-fill') : null;
      if (!track) {
        track = document.createElement('span');
        track.className = 'watch-card-progress-track';
        track.setAttribute('data-watch-progress-track', '');
        track.setAttribute('aria-hidden', 'true');

        fill = document.createElement('span');
        fill.className = 'watch-card-progress-fill';
        track.append(fill);
        poster.append(track);
      }

      const progress = readWatchProgress(id);
      const finished = completed.has(id);
      const percent = progress
        ? Math.max(1, Math.min(99, Math.round((progress.t / progress.d) * 100)))
        : 0;

      card.classList.toggle('is-completed', finished);
      card.classList.toggle('is-in-progress', Boolean(progress) && !finished);

      if (finished) {
        state.hidden = false;
        state.textContent = 'Watched';
        track.hidden = true;
      } else if (progress) {
        state.hidden = false;
        state.textContent = percent + '% watched';
        track.hidden = false;
        if (fill) fill.style.width = percent + '%';
      } else {
        state.hidden = true;
        state.textContent = '';
        track.hidden = true;
        if (fill) fill.style.width = '0%';
      }
    });

    if (historyClear) historyClear.hidden = !hasWatchHistory();
  };

  const renderWatchContinue = () => {
    if (!continueSection || !continueGrid) return;

    const completed = new Set(readWatchCompleted().map(item => item.id));
    const entries = [];

    watchLibraryCards.forEach(card => {
      const id = card.getAttribute('data-watch-id');
      if (!id || completed.has(id)) return;

      const progress = readWatchProgress(id);
      if (progress) entries.push({ card, progress });
    });

    entries.sort((a, b) => (b.progress.at || 0) - (a.progress.at || 0));
    continueGrid.textContent = '';

    entries.forEach(({ card, progress }) => {
      const clone = card.cloneNode(true);
      clone.removeAttribute('data-watch-id');
      clone.removeAttribute('data-watch-slug');

      const target = new URL(clone.getAttribute('href'), window.location.href);
      target.searchParams.set('resume', '1');
      clone.setAttribute('href', target.pathname + target.search + target.hash);

      const meta = clone.querySelector('.watch-card-meta');
      if (meta) {
        const line = document.createElement('p');
        line.className = 'watch-card-progress';
        line.textContent = 'Resume at ' + formatWatchTime(progress.t) + ' · ' +
          Math.round((progress.t / progress.d) * 100) + '%';
        meta.insertAdjacentElement('afterend', line);
      }

      continueGrid.appendChild(clone);
    });

    continueSection.hidden = entries.length === 0;
    if (historyClear) historyClear.hidden = !hasWatchHistory();
  };

  const refreshWatchHistory = () => {
    updateWatchCardStates();
    renderWatchContinue();
  };

  if (historyClear) {
    historyClear.addEventListener('click', function() {
      if (!window.confirm('Clear watch progress and completed titles in this browser?')) return;
      clearWatchHistory();
      refreshWatchHistory();
    });
  }

  window.addEventListener('storage', function(event) {
    if (!event.key) return;
    if (event.key === WATCH_COMPLETED_KEY || event.key.startsWith(WATCH_PROGRESS_PREFIX)) {
      refreshWatchHistory();
    }
  });

  window.addEventListener('pageshow', refreshWatchHistory);
  refreshWatchHistory();

  // Internet Archive MP4s and the self-hosted branch render
  // <video data-watch-video>. Surface a failure instead of leaving a silent,
  // broken player, and remember progress for the native player only.
  document.querySelectorAll('[data-watch-video]').forEach(video => {
    const wrapper = video.closest('.watch-player');
    const error = wrapper ? wrapper.parentElement.querySelector('[data-watch-error]') : null;
    const source = video.querySelector('source');
    const watchRoot = video.closest('[data-watch-id]');
    const slowNotice = watchRoot ? watchRoot.querySelector('[data-watch-slow]') : null;
    let slowTimer = 0;

    const clearSlowNotice = () => {
      if (slowTimer) {
        clearTimeout(slowTimer);
        slowTimer = 0;
      }
      if (slowNotice) slowNotice.hidden = true;
    };

    const showError = () => {
      clearSlowNotice();
      video.hidden = true;
      if (error) error.hidden = false;
    };

    video.addEventListener('error', showError);
    if (source) source.addEventListener('error', showError);

    if (slowNotice) {
      slowTimer = window.setTimeout(() => {
        if (video.readyState < 1 && !video.hidden) slowNotice.hidden = false;
      }, 20000);
      ['loadedmetadata', 'canplay', 'playing'].forEach(eventName => {
        video.addEventListener(eventName, clearSlowNotice);
      });
    }

    if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) showError();

    const watchId = watchRoot ? watchRoot.getAttribute('data-watch-id') : '';
    const resumePanel = watchRoot ? watchRoot.querySelector('[data-watch-resume]') : null;
    const resumeTime = resumePanel ? resumePanel.querySelector('[data-watch-resume-time]') : null;
    const resumeStart = resumePanel ? resumePanel.querySelector('[data-watch-resume-start]') : null;
    const resumeReset = resumePanel ? resumePanel.querySelector('[data-watch-resume-reset]') : null;
    let savedAt = 0;
    let resumeTarget = readWatchProgress(watchId);

    const hideResume = () => {
      if (resumePanel) resumePanel.hidden = true;
    };

    const seekToResume = () => {
      if (!resumeTarget) return;
      try {
        video.currentTime = resumeTarget.t;
      } catch (error) {
        return;
      }
      const attempt = video.play();
      if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
      hideResume();
    };

    if (resumeStart) resumeStart.addEventListener('click', seekToResume);

    if (resumeReset) {
      resumeReset.addEventListener('click', () => {
        resumeTarget = null;
        clearWatchProgress(watchId);
        clearWatchComplete(watchId);
        hideResume();
        try {
          video.currentTime = 0;
        } catch (error) {
          // A player without seekable media still starts from the beginning.
        }
      });
    }

    const initResume = () => {
      if (!watchId || !resumeTarget) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      if (resumeTarget.t >= video.duration - 10) {
        clearWatchProgress(watchId);
        resumeTarget = null;
        return;
      }

      if (new URLSearchParams(window.location.search).get('resume') === '1') {
        seekToResume();
        return;
      }

      if (resumePanel && resumeTime) {
        resumeTime.textContent = formatWatchTime(resumeTarget.t);
        resumePanel.hidden = false;
      }
    };

    video.addEventListener('loadedmetadata', initResume);
    if (video.readyState >= 1) initResume();

    const saveProgress = () => {
      if (!watchId || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const currentTime = video.currentTime;
      if (currentTime < 5) return;
      if (video.duration - currentTime < 10) {
        clearWatchProgress(watchId);
        markWatchComplete(watchId);
        return;
      }
      if (isWatchComplete(watchId)) clearWatchComplete(watchId);
      writeWatchProgress(watchId, currentTime, video.duration);
      savedAt = Date.now();
    };

    video.addEventListener('timeupdate', () => {
      if (Date.now() - savedAt >= 5000) saveProgress();
    });
    video.addEventListener('pause', saveProgress);
    video.addEventListener('ended', () => {
      clearWatchProgress(watchId);
      markWatchComplete(watchId);
    });
    window.addEventListener('pagehide', saveProgress);
  });

  // ===========================
  // Trailer Modal
  // ===========================
  const trailerDialog = document.querySelector('[data-trailer-dialog]');
  const trailerFrame = document.querySelector('[data-trailer-frame]');

  if (trailerDialog && trailerFrame) {
    const closeTrailer = () => {
      if (trailerDialog.open && typeof trailerDialog.close === 'function') {
        trailerDialog.close();
      } else {
        trailerDialog.removeAttribute('open');
      }

      trailerFrame.replaceChildren();
      syncBodyScrollLock();
    };

    document.querySelectorAll('[data-trailer]').forEach(link => {
      link.addEventListener('click', function(event) {
        const embed = link.dataset.trailer || '';
        if (!embed.includes('/embed/')) return;

        event.preventDefault();

        const frame = document.createElement('iframe');
        frame.src = embed;
        frame.title = link.closest('.catalog-hero')?.querySelector('h1')?.textContent.trim() + ' trailer' || 'Trailer';
        frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        frame.allowFullscreen = true;
        frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');

        trailerFrame.replaceChildren(frame);

        if (typeof trailerDialog.showModal === 'function') trailerDialog.showModal();
        else trailerDialog.setAttribute('open', '');

        syncBodyScrollLock();
      });
    });

    document.querySelector('[data-trailer-close]')?.addEventListener('click', closeTrailer);

    trailerDialog.addEventListener('close', closeTrailer);

    trailerDialog.addEventListener('click', function(event) {
      if (event.target === trailerDialog) closeTrailer();
    });
  }

  // ===========================
  // Broken artwork fallback
  // ===========================
  document.addEventListener('error', function(event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;

    const poster = image.closest('.rail-poster, .catalog-poster');
    if (!poster || poster.classList.contains('poster-match') || poster.querySelector('.poster-fallback')) return;

    const title = (image.alt || poster.closest('.rail-card')?.querySelector('.rail-title')?.textContent || 'Untitled').trim();
    const monogram = title.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word.charAt(0)).join('').toUpperCase();

    // Remote artwork can disappear from a CDN; keep the card readable instead of
    // showing a broken image.
    const fallback = document.createElement('span');
    fallback.className = 'poster-fallback';

    const initials = document.createElement('span');
    initials.className = 'poster-monogram';
    initials.textContent = monogram;

    const label = document.createElement('span');
    label.className = 'poster-title';
    label.textContent = title;

    fallback.append(initials, label);
    image.replaceWith(fallback);
  }, true);

  // ===========================
  // My List (saved titles, browser-local)
  // ===========================
  const LIST_KEY = 'pixy-my-list';
  const LIST_VERSION = 1;
  const listGrid = document.querySelector('[data-my-list]');
  const listEmpty = document.querySelector('[data-my-list-empty]');
  const listToolbar = document.querySelector('[data-my-list-toolbar]');
  const listCount = document.querySelector('[data-my-list-count]');
  const listClear = document.querySelector('[data-my-list-clear]');

  const readList = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
      const items = Array.isArray(parsed)
        ? parsed
        : (parsed && Array.isArray(parsed.items) ? parsed.items : []);
      return items.filter(item => item && typeof item.url === 'string' && typeof item.title === 'string');
    } catch (error) {
      return [];
    }
  };

  const writeList = (items) => {
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify({ version: LIST_VERSION, items }));
    } catch (error) {
      // Storage may be blocked or full; the list simply will not persist.
    }
  };

  const safeAccent = (value) => /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : '';
  const safePoster = (value) => /^https?:\/\//i.test(value || '') ? value : '';

  const readSavePayload = () => {
    const script = document.querySelector('[data-save-data]');
    if (!script) return null;

    try {
      const payload = JSON.parse(script.textContent || '{}');
      return payload && typeof payload.url === 'string' ? payload : null;
    } catch (error) {
      return null;
    }
  };

  const buildListCard = (item) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'my-list-item';

    const link = document.createElement('a');
    link.className = 'rail-card';
    link.href = item.url;

    const poster = document.createElement('div');
    poster.className = 'rail-poster';
    const posterUrl = safePoster(item.poster);

    if (posterUrl) {
      const img = document.createElement('img');
      img.src = posterUrl;
      img.alt = item.title;
      img.loading = 'lazy';
      img.decoding = 'async';
      poster.append(img);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'poster-fallback';
      const accent = safeAccent(item.accent);
      if (accent) fallback.style.setProperty('--poster-accent', accent);

      const monogram = document.createElement('span');
      monogram.className = 'poster-monogram';
      monogram.textContent = item.title
        .split(/\s+/)
        .slice(0, 2)
        .map(word => word.charAt(0))
        .join('')
        .toUpperCase();

      const label = document.createElement('span');
      label.className = 'poster-title';
      label.textContent = item.title;

      fallback.append(monogram, label);
      poster.append(fallback);
    }

    const title = document.createElement('h3');
    title.className = 'rail-title';
    title.textContent = item.title;
    link.append(poster, title);

    if (item.meta) {
      const meta = document.createElement('p');
      meta.className = 'rail-meta';
      meta.textContent = item.meta;
      link.append(meta);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'my-list-remove';
    remove.dataset.remove = item.url;
    remove.setAttribute('aria-label', 'Remove ' + item.title + ' from My List');
    remove.innerHTML = '&times;';

    wrapper.append(link, remove);
    return wrapper;
  };

  const renderList = () => {
    if (!listGrid) return;

    const items = readList();
    listGrid.textContent = '';
    items.forEach(item => listGrid.append(buildListCard(item)));

    if (listEmpty) listEmpty.hidden = items.length > 0;
    if (listToolbar) listToolbar.hidden = items.length === 0;
    if (listCount) {
      listCount.textContent = items.length === 1 ? '1 title saved' : items.length + ' titles saved';
    }
  };

  let navCountBadge = null;

  const getNavCountBadge = () => {
    if (navCountBadge) return navCountBadge;

    const myListLink = Array.from(document.querySelectorAll('.nav-link')).find(link => {
      const href = link.getAttribute('href') || '';
      return href.replace(/\/$/, '').endsWith('/my-list');
    });

    if (!myListLink) return null;

    navCountBadge = document.createElement('span');
    navCountBadge.className = 'nav-count';
    navCountBadge.hidden = true;
    myListLink.append(navCountBadge);
    return navCountBadge;
  };

  const syncSaveButtons = () => {
    const saved = new Set(readList().map(item => item.url));
    const payload = readSavePayload();
    const isSaved = Boolean(payload && saved.has(payload.url));

    document.querySelectorAll('[data-save]').forEach(button => {
      button.setAttribute('aria-pressed', String(isSaved));

      const label = button.querySelector('[data-save-label]');
      if (label) label.textContent = isSaved ? 'In My List' : 'Save to My List';
    });

    const badge = getNavCountBadge();
    if (badge) {
      const total = saved.size;
      badge.textContent = String(total);
      badge.hidden = total === 0;
    }
  };

  document.querySelectorAll('[data-save]').forEach(button => {
    button.addEventListener('click', function() {
      const payload = readSavePayload();
      if (!payload) return;

      const items = readList();
      const position = items.findIndex(item => item.url === payload.url);
      if (position >= 0) items.splice(position, 1);
      else items.push(payload);

      writeList(items);
      syncSaveButtons();
      renderList();
    });
  });

  if (listGrid) {
    listGrid.addEventListener('click', function(event) {
      const remove = event.target.closest('[data-remove]');
      if (!remove) return;

      event.preventDefault();
      writeList(readList().filter(item => item.url !== remove.dataset.remove));
      renderList();
      syncSaveButtons();
    });
  }

  if (listClear) {
    listClear.addEventListener('click', function() {
      writeList([]);
      renderList();
      syncSaveButtons();
    });
  }

  window.addEventListener('storage', function(event) {
    if (event.key !== LIST_KEY) return;
    renderList();
    syncSaveButtons();
  });

  syncSaveButtons();
  renderList();

  // ===========================
  // Home Personalisation
  // ===========================
  // Continue watching and genre recommendations are built in the browser from
  // the same localStorage records the watch pages write. Both sections ship
  // hidden, so a visitor with no history never sees an empty rail.
  const readJsonScript = (selector) => {
    const script = document.querySelector(selector);
    if (!script) return [];

    try {
      const parsed = JSON.parse(script.textContent || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  };

  const buildHomeCard = (item, options = {}) => {
    const card = document.createElement('a');
    card.className = 'rail-card';
    card.href = item.url;

    const poster = document.createElement('div');
    poster.className = 'rail-poster';
    const posterUrl = safePoster(item.poster);

    if (posterUrl) {
      const img = document.createElement('img');
      img.src = posterUrl;
      img.alt = item.title;
      img.loading = 'lazy';
      img.decoding = 'async';
      poster.append(img);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'poster-fallback';
      const accent = safeAccent(item.accent);
      if (accent) fallback.style.setProperty('--poster-accent', accent);

      const monogram = document.createElement('span');
      monogram.className = 'poster-monogram';
      monogram.textContent = item.title
        .split(/\s+/)
        .slice(0, 2)
        .map(word => word.charAt(0))
        .join('')
        .toUpperCase();

      const label = document.createElement('span');
      label.className = 'poster-title';
      label.textContent = item.title;

      fallback.append(monogram, label);
      poster.append(fallback);
    }

    if (options.badge) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = options.badge;
      poster.append(badge);
    }

    if (options.progress && options.progress.d > 0) {
      const percent = Math.max(1, Math.min(99, Math.round((options.progress.t / options.progress.d) * 100)));
      const track = document.createElement('span');
      track.className = 'rail-progress-track';
      track.setAttribute('aria-hidden', 'true');

      const fill = document.createElement('span');
      fill.className = 'rail-progress-fill';
      fill.style.width = percent + '%';
      track.append(fill);
      poster.append(track);
    }

    const title = document.createElement('h3');
    title.className = 'rail-title';
    title.textContent = item.title;
    card.append(poster, title);

    if (item.meta) {
      const meta = document.createElement('p');
      meta.className = 'rail-meta';
      meta.textContent = item.meta;
      card.append(meta);
    }

    return card;
  };

  const homeContinue = document.querySelector('[data-home-continue]');
  const homeContinueRail = homeContinue ? homeContinue.querySelector('[data-home-continue-rail]') : null;
  const homeRecommend = document.querySelector('[data-home-recommend]');
  const homeRecommendRail = homeRecommend ? homeRecommend.querySelector('[data-home-recommend-rail]') : null;
  const homeRecommendNote = homeRecommend ? homeRecommend.querySelector('[data-home-recommend-note]') : null;

  const renderHomeContinue = () => {
    if (!homeContinue || !homeContinueRail) return;

    const completed = new Set(readWatchCompleted().map(item => item.id));
    const entries = readJsonScript('[data-home-watch]')
      .map(item => ({ item, progress: readWatchProgress(item.progressId) }))
      .filter(entry => entry.progress && !completed.has(entry.item.progressId))
      .sort((a, b) => (b.progress.at || 0) - (a.progress.at || 0));

    homeContinueRail.textContent = '';

    entries.forEach(({ item, progress }) => {
      const percent = Math.max(1, Math.min(99, Math.round((progress.t / progress.d) * 100)));
      const card = buildHomeCard(Object.assign({}, item, {
        meta: 'Resume at ' + formatWatchTime(progress.t) + ' · ' + percent + '%'
      }), { progress, badge: 'Resume' });

      const target = new URL(item.url, window.location.href);
      target.searchParams.set('resume', '1');
      card.href = target.pathname + target.search + target.hash;
      homeContinueRail.append(card);
    });

    homeContinue.hidden = entries.length === 0;
    if (entries.length) refreshRailControls();
  };

  const renderHomeRecommend = () => {
    if (!homeRecommend || !homeRecommendRail) return;

    const catalogue = readJsonScript('[data-home-recommend-data]');
    const saved = readList();
    const savedUrls = new Set(saved.map(item => item.url));
    const completed = new Set(readWatchCompleted().map(item => item.id));
    const weights = new Map();
    const watching = new Set();

    const addGenres = (genres, weight) => {
      (genres || []).forEach(genre => {
        const slug = String(genre || '').trim().toLowerCase();
        if (!slug) return;
        weights.set(slug, (weights.get(slug) || 0) + weight);
      });
    };

    saved.forEach(item => addGenres(item.genres, 2));

    catalogue.forEach(item => {
      if (!item.progressId) return;
      const progress = readWatchProgress(item.progressId);
      if (!progress) return;
      watching.add(item.progressId);
      addGenres(item.genres, 3);
    });

    const picks = catalogue
      .filter(item => !savedUrls.has(item.url))
      .filter(item => !(item.progressId && (watching.has(item.progressId) || completed.has(item.progressId))))
      .map(item => ({
        item,
        weight: (item.genres || []).reduce((total, genre) => {
          return total + (weights.get(String(genre || '').trim().toLowerCase()) || 0);
        }, 0)
      }))
      .filter(entry => entry.weight > 0)
      .sort((a, b) => b.weight - a.weight ||
        (Number(b.item.score) || 0) - (Number(a.item.score) || 0) ||
        a.item.title.localeCompare(b.item.title))
      .slice(0, 14);

    homeRecommendRail.textContent = '';
    picks.forEach(entry => homeRecommendRail.append(buildHomeCard(entry.item)));

    if (homeRecommendNote && picks.length) {
      homeRecommendNote.textContent = saved.length && watching.size
        ? 'Based on the genres in My List and what you are watching.'
        : (saved.length
          ? 'Based on the genres in My List.'
          : 'Based on what you are watching.');
    }

    homeRecommend.hidden = picks.length === 0;
    if (picks.length) refreshRailControls();
  };

  const refreshHomePersonal = () => {
    renderHomeContinue();
    renderHomeRecommend();
  };

  refreshHomePersonal();

  window.addEventListener('storage', function(event) {
    if (!event.key) return;

    if (event.key === LIST_KEY) {
      renderHomeRecommend();
      return;
    }

    if (event.key === WATCH_COMPLETED_KEY || event.key.startsWith(WATCH_PROGRESS_PREFIX)) {
      refreshHomePersonal();
    }
  });

  window.addEventListener('pageshow', refreshHomePersonal);
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) refreshHomePersonal();
  });

  // ===========================
  // Lazy Loading Images
  // ===========================
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
          }
          observer.unobserve(img);
        }
      });
    });

    document.querySelectorAll('img[data-src]').forEach(img => {
      imageObserver.observe(img);
    });
  }

  // ===========================
  // Scroll to Top Button (Optional)
  // ===========================
  function createScrollToTopButton() {
    const button = document.createElement('button');
    button.classList.add('scroll-to-top');
    button.setAttribute('aria-label', 'Scroll to top');
    button.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="18 15 12 9 6 15"></polyline>
      </svg>
    `;
    
    document.body.appendChild(button);
    
    // Show/hide button based on scroll position
    window.addEventListener('scroll', () => {
      if (window.pageYOffset > 300) {
        button.classList.add('visible');
      } else {
        button.classList.remove('visible');
      }
    });
    
    // Scroll to top on click
    button.addEventListener('click', () => {
      window.scrollTo({
        top: 0,
        behavior: motionBehavior()
      });
    });
  }
  
  // Uncomment to enable scroll-to-top button
  // createScrollToTopButton();

  // ===========================
  // Header Scroll Effect
  // ===========================
  let lastScroll = 0;
  const header = document.querySelector('.site-header');
  
  if (header) {
    window.addEventListener('scroll', () => {
      const currentScroll = window.pageYOffset;
      
      // Add shadow on scroll
      if (currentScroll > 10) {
        header.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
      } else {
        header.style.boxShadow = '';
      }
      
      lastScroll = currentScroll;
    });
  }

  // ===========================
  // Animate Elements on Scroll (Fade In)
  // ===========================
  if ('IntersectionObserver' in window) {
    const animationObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('fade-in');
          animationObserver.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    });

    // Observe elements that should animate
    document.querySelectorAll('.feature-card, .post-card, .section-item-card, .stat-item, .specialty-item').forEach(el => {
      animationObserver.observe(el);
    });
  }

  // ===========================
  // Form Validation (if forms are added later)
  // ===========================
  const forms = document.querySelectorAll('form[data-validate]');
  
  forms.forEach(form => {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      
      // Basic validation
      const inputs = form.querySelectorAll('input[required], textarea[required]');
      let isValid = true;
      
      inputs.forEach(input => {
        if (!input.value.trim()) {
          isValid = false;
          input.classList.add('error');
        } else {
          input.classList.remove('error');
        }
      });
      
      if (isValid) {
        // Submit form or handle submission
        console.log('Form is valid, submitting...');
        // form.submit();
      }
    });
  });

  // ===========================
  // Prefers Reduced Motion
  // ===========================
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  
  if (mediaQuery.matches) {
    // Disable animations for users who prefer reduced motion
    document.documentElement.style.scrollBehavior = 'auto';
  }

  // ===========================
  // External Links - Open in New Tab
  // ===========================
  document.querySelectorAll('a[href^="http"]').forEach(link => {
    if (!link.hostname.includes(window.location.hostname)) {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
  });

  // ===========================
  // Console Welcome Message
  // ===========================
  console.log('%cPixy Streams', 'font-size: 16px; font-weight: bold; color: #ff6b35;');
  console.log('%cMovies, TV, anime and sport in one place.', 'font-size: 12px; color: #6b6b6b;');

  // ===========================
  // Initialize
  // ===========================
  console.log('Pixy Streams initialized successfully!');

})();
