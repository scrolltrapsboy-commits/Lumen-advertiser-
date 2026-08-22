/**
 * fall-in-transition.js
 * -------------------------------------------------------
 * Exact fall-in transition implementation matching the reference specification:
 * - 900ms duration
 * - Outgoing: lumen-player-page-fall (900ms, cubic-bezier(0.45, 0, 0.55, 1))
 * - Incoming: lumen-player-page-fall-in (900ms, cubic-bezier(0.16, 1, 0.3, 1))
 * - transform-origin: 0% 0%
 * - Perspective: 1200px, origin 50% 50%
 * - Outgoing falls from top-left corner, incoming revealed underneath
 * 
 * Uses pure CSS animations via .lumen-player-page-fall and .lumen-player-page-fall-in classes.
 * The incoming element is revealed underneath the outgoing element,
 * then both animate simultaneously - outgoing falls away, incoming settles in.
 */

/**
 * Runs the fall-in transition between two page elements.
 * The incoming element (nextPage) is revealed underneath the outgoing element (currentPage),
 * then both animate simultaneously - outgoing falls away, incoming settles in.
 * 
 * @param {Object} params
 * @param {HTMLElement} params.currentPage - The outgoing page element (currently visible)
 * @param {HTMLElement} params.nextPage - The incoming page element (to be shown)
 * @param {number} [params.durationMs=900] - Duration in milliseconds (default 900ms)
 * @returns {Promise<void>} Resolves when animation completes
 */
export async function runFallInTransition({ currentPage, nextPage, durationMs = 900 }) {
  // Nothing to transition from (e.g., very first ad shown) - just reveal.
  if (!currentPage || !nextPage) {
    nextPage.classList.add('active');
    nextPage.style.display = 'flex';
    return;
  }

  // Ensure both pages have the base classes for the transition
  currentPage.classList.add('lumen-player-page');
  nextPage.classList.add('lumen-player-page');

  // 1. Prepare next page: reveal it underneath immediately (painter's order)
  // This ensures the next ad is visible during the entire transition.
  nextPage.classList.add('no-anim', 'active');
  nextPage.style.zIndex = '1'; // underneath current page (which gets z-index: 2 via .lumen-player-page-fall)
  nextPage.style.display = 'flex';
  void nextPage.offsetWidth; // force reflow
  nextPage.classList.remove('no-anim');

  // 2. Run the fall animation on both pages simultaneously
  // Outgoing falls away (lumen-player-page-fall), incoming settles in (lumen-player-page-fall-in)
  return new Promise((resolve) => {
    // Add the animation classes
    currentPage.classList.add('lumen-player-page-fall');
    nextPage.classList.add('lumen-player-page-fall-in');

    // Handle animation end on the OUTGOING page (it determines when transition is complete)
    const handler = () => {
      currentPage.removeEventListener('animationend', handler);
      currentPage.classList.remove('lumen-player-page-fall');
      currentPage.classList.remove('no-anim');
      currentPage.classList.remove('active');
      
      // Clean up outgoing page
      currentPage.style.display = 'none';
      currentPage.style.zIndex = '';
      currentPage.innerHTML = '';
      
      // Finalize incoming page
      nextPage.classList.remove('lumen-player-page-fall-in');
      nextPage.classList.remove('no-anim');
      nextPage.style.zIndex = '';
      nextPage.classList.add('active');
      void nextPage.offsetWidth;
      
      resolve();
    };

    currentPage.addEventListener('animationend', handler);
    
    // Safety timeout in case animationend doesn't fire
    setTimeout(() => {
      if (currentPage.classList.contains('lumen-player-page-fall')) {
        handler();
      }
    }, 900 + 200); // duration + buffer
  });
}

/**
 * Utility to prepare a page element for fall-in transition.
 * Adds necessary classes and sets up the initial state.
 * 
 * @param {HTMLElement} pageEl - The page element to prepare
 * @param {boolean} isActive - Whether this is the currently active page
 */
export function preparePageForFallIn(pageEl, isActive = false) {
  pageEl.className = 'lumen-player-page';
  pageEl.style.display = isActive ? 'flex' : 'none';
  if (isActive) {
    pageEl.classList.add('active');
  }
}

/**
 * Checks if fall-in transition is supported (CSS animations).
 * @returns {boolean}
 */
export function isFallInTransitionSupported() {
  const el = document.createElement('div');
  return 'animation' in el.style;
}