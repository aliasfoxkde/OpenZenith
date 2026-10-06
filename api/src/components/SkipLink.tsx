"use client";

/**
 * WCAG 2.4.1 (Bypass Blocks): the body's first focusable element on every
 * page, jumping past repeated chrome to that page's
 * <main id="main-content" tabIndex={-1}>.
 *
 * The onClick focus() is the cross-browser half of the contract: fragment
 * navigation moves *sequential focus* to the target in Chromium, but leaves
 * document.activeElement on <body> in Firefox and Safari — the E2E assertion
 * (a11y.spec.ts "Skip link") would fail there. Preventing the default and
 * focusing the target explicitly behaves identically everywhere; the href
 * stays for no-JS clients and right-click-copy-link semantics. Visual
 * reveal is the .skip-to-content:focus rule in globals.css.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="skip-to-content"
      onClick={(e) => {
        const target = document.getElementById("main-content");
        if (target) {
          e.preventDefault();
          target.focus();
          target.scrollIntoView();
        }
      }}
    >
      Skip to content
    </a>
  );
}
