/**
 * WCAG 2.4.1 (Bypass Blocks): the body's first focusable element on every
 * page, jumping past repeated chrome to that page's
 * <main id="main-content" tabIndex={-1}>.
 *
 * The focus move is NOT handled here: it lives in the pre-hydration inline
 * script in the root layout (see the comment there). A React onClick only
 * exists once the page has hydrated, and on the heaviest pages (map, globe,
 * explore) a keyboard user can activate the link before that — the click
 * then falls through to native fragment navigation, which moves sequential
 * focus in Chromium but leaves document.activeElement on <body> in WebKit
 * and Firefox. The inline script is in the server HTML, so it is live from
 * the first paint. The href stays for no-JS clients and right-click
 * copy-link semantics. Visual reveal is the .skip-to-content:focus rule in
 * globals.css.
 */
export function SkipLink() {
  return (
    <a href="#main-content" className="skip-to-content">
      Skip to content
    </a>
  );
}
