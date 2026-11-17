// ===========================
// Pixy Streams - Main JavaScript
// ===========================

(function() {
  'use strict';

  // ===========================
  // Theme Toggle
  // ===========================
  const themeToggle = document.querySelector('.theme-toggle');
  const html = document.documentElement;
  
  // Check for saved theme preference or default to 'light' mode
  const currentTheme = localStorage.getItem('theme') || 'light';
  html.setAttribute('data-theme', currentTheme);
  
  if (themeToggle) {
    themeToggle.addEventListener('click', function() {
      const theme = html.getAttribute('data-theme');
      const newTheme = theme === 'light' ? 'dark' : 'light';
      
      html.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      
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
  
  if (navbarToggle && navbarMenu) {
    navbarToggle.addEventListener('click', function() {
      navbarMenu.classList.toggle('active');
      navbarToggle.classList.toggle('active');
      
      // Toggle aria-expanded for accessibility
      const expanded = navbarToggle.getAttribute('aria-expanded') === 'true' || false;
      navbarToggle.setAttribute('aria-expanded', !expanded);
      
      // Prevent body scroll when menu is open
      if (navbarMenu.classList.contains('active')) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', function(e) {
      if (!navbarToggle.contains(e.target) && !navbarMenu.contains(e.target)) {
        navbarMenu.classList.remove('active');
        navbarToggle.classList.remove('active');
        navbarToggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }
    });
    
    // Close menu when pressing Escape
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && navbarMenu.classList.contains('active')) {
        navbarMenu.classList.remove('active');
        navbarToggle.classList.remove('active');
        navbarToggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }
    });
  }

  // ===========================
  // Mobile Dropdown Toggles
  // ===========================
  const dropdownLinks = document.querySelectorAll('.nav-item-dropdown > .nav-link');
  
  if (window.innerWidth <= 768) {
    dropdownLinks.forEach(link => {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        const parent = this.closest('.nav-item-dropdown');
        parent.classList.toggle('active');
      });
    });
  }

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
          behavior: 'smooth'
        });
        
        // Close mobile menu if open
        if (navbarMenu && navbarMenu.classList.contains('active')) {
          navbarMenu.classList.remove('active');
          navbarToggle.classList.remove('active');
          document.body.style.overflow = '';
        }
      }
    });
  });

  // ===========================
  // Category Filter
  // ===========================
  const categoryFilter = document.querySelector('[data-category-filter]');

  if (categoryFilter) {
    const categoryButtons = Array.from(categoryFilter.querySelectorAll('[data-genre]'));
    const clearButton = categoryFilter.querySelector('[data-clear]');
    const statusMessage = categoryFilter.querySelector('[data-filter-status]');
    const emptyMessage = categoryFilter.querySelector('[data-filter-empty]');
    const filterableSections = Array.from(document.querySelectorAll('.rail-section[data-filterable]'));

    const selectedCategories = () => categoryButtons
      .filter(button => button.getAttribute('aria-pressed') === 'true')
      .map(button => ({ slug: button.dataset.genre, label: button.dataset.label }));

    const applyCategoryFilter = () => {
      const selected = selectedCategories();
      const slugs = selected.map(category => category.slug);
      const labels = selected.map(category => category.label);
      let shown = 0;

      filterableSections.forEach(section => {
        let matchesInSection = 0;

        section.querySelectorAll('.rail-card').forEach(card => {
          const cardGenres = (card.dataset.genres || '').split(',').filter(Boolean);
          const matches = slugs.length === 0 || slugs.some(slug => cardGenres.includes(slug));

          card.classList.toggle('is-filtered-out', !matches);
          if (matches) matchesInSection += 1;
        });

        section.classList.toggle('is-filtered-out', matchesInSection === 0);
        shown += matchesInSection;
      });

      if (clearButton) clearButton.hidden = selected.length === 0;
      if (emptyMessage) emptyMessage.hidden = shown !== 0;

      if (statusMessage) {
        if (!selected.length) {
          statusMessage.textContent = '';
        } else if (!shown) {
          statusMessage.textContent = 'Nothing in ' + labels.join(' + ') + ' right now.';
        } else {
          statusMessage.textContent = shown + ' title' + (shown === 1 ? '' : 's') + ' in ' + labels.join(' + ') + '.';
        }
      }
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
          behavior: 'smooth'
        });
      });
    });

    rail.addEventListener('scroll', updateRailControls, { passive: true });
    window.addEventListener('resize', updateRailControls);
    updateRailControls();
  });

  // ===========================
  // Active Nav Link Highlighting
  // ===========================
  function setActiveNavLink() {
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.nav-link');
    
    navLinks.forEach(link => {
      const linkPath = new URL(link.href).pathname;
      const navItem = link.closest('.nav-item');
      
      if (currentPath === linkPath || (linkPath !== '/' && currentPath.startsWith(linkPath))) {
        navItem?.classList.add('active');
      } else {
        navItem?.classList.remove('active');
      }
    });
  }
  
  setActiveNavLink();

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
        behavior: 'smooth'
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
  console.log('%cMovies, anime and sport in one place.', 'font-size: 12px; color: #6b6b6b;');

  // ===========================
  // Handle Window Resize
  // ===========================
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // Re-initialize mobile menu if needed
      if (window.innerWidth > 768 && navbarMenu) {
        navbarMenu.classList.remove('active');
        navbarToggle?.classList.remove('active');
        document.body.style.overflow = '';
      }
    }, 250);
  });

  // ===========================
  // Initialize
  // ===========================
  console.log('Pixy Streams initialized successfully!');

})();
