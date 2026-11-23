/* global window, document */

(() => {
  let preference = 'system';

  try {
    const stored = window.localStorage.getItem('dsc-theme-preference');
    if (stored === 'dark' || stored === 'light' || stored === 'system') {
      preference = stored;
    }
  } catch {
    // Storage can be unavailable in restricted browsing contexts.
  }

  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;
  const root = document.documentElement;

  root.classList.add(resolved);
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
})();
