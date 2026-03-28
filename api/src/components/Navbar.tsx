"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { Logo } from "./Logo";

interface NavbarProps {
  dark: boolean;
  /** Optional right-side extra elements (theme toggles, etc.) */
  extra?: ReactNode;
  /** Show breadcrumb text after brand (e.g., "Globe") */
  breadcrumb?: string;
}

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Map", href: "/map" },
  { label: "Globe", href: "/globe" },
  { label: "Studio", href: "/studio" },
  { label: "Explore", href: "/explore" },
  { label: "Docs", href: "/api/docs" },
  { label: "Status", href: "/api/health" },
  { label: "Contribute", href: "/contribute" },
  { label: "About", href: "/about" },
];

export function Navbar({ dark, extra, breadcrumb }: NavbarProps) {
  const [mobileMenu, setMobileMenu] = useState(false);

  const bg = dark ? "#0a0a0a" : "#fafafa";
  const border = dark ? "#222" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSecondary = dark ? "#888" : "#737373";

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileMenu ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileMenu]);

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenu(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: bg,
          borderBottom: `1px solid ${border}`,
          backdropFilter: "blur(12px)",
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            padding: "0.7rem 1.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              textDecoration: "none",
              color: text,
            }}
          >
            <Logo />
            <span style={{ fontWeight: 700, fontSize: "1.05rem", letterSpacing: "-0.02em" }}>OpenZenith</span>
            {breadcrumb && (
              <span style={{ color: textSecondary, fontWeight: 400, fontSize: "0.75rem", marginLeft: 4 }}>
                / {breadcrumb}
              </span>
            )}
          </Link>
          {/* Desktop nav */}
          <div style={{ display: "flex", gap: "1.2rem", alignItems: "center" }} className="oz-desktop-nav">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                style={{ color: textSecondary, textDecoration: "none", fontSize: "0.85rem" }}
              >
                {l.label}
              </Link>
            ))}
            <a
              href="https://github.com/aliasfoxkde/OpenZenith"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: textSecondary,
                textDecoration: "none",
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              GitHub
            </a>
            {extra}
          </div>
          {/* Mobile hamburger button */}
          <button
            onClick={() => setMobileMenu(!mobileMenu)}
            className={`oz-hamburger${mobileMenu ? " oz-hamburger-open" : ""}`}
            aria-label={mobileMenu ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenu}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </nav>

      {/* Full-screen mobile menu overlay */}
      <div
        className={`oz-mobile-menu${mobileMenu ? " oz-mobile-menu-open" : ""}`}
        onClick={() => setMobileMenu(false)}
        style={{
          "--oz-mm-bg": dark ? "#0a0a0a" : "#fafafa",
          "--oz-mm-text": text,
          "--oz-mm-text-secondary": textSecondary,
          "--oz-mm-border": border,
        } as React.CSSProperties}
      >
        <div className="oz-mobile-menu-content" onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {NAV_LINKS.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                onClick={() => setMobileMenu(false)}
                className="oz-mobile-menu-link"
              >
                {l.label}
              </Link>
            ))}
            <a
              href="https://github.com/aliasfoxkde/OpenZenith"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMobileMenu(false)}
              className="oz-mobile-menu-link"
            >
              GitHub
            </a>
          </div>
          {extra && <div style={{ marginTop: "1.5rem" }}>{extra}</div>}
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            /* ─── Desktop nav hidden on mobile ─── */
            @media(max-width:768px){.oz-desktop-nav{display:none!important}.oz-hamburger{display:flex!important}}

            /* ─── Hamburger button ─── */
            .oz-hamburger {
              display: none;
              flex-direction: column;
              justify-content: center;
              align-items: center;
              width: 36px;
              height: 36px;
              padding: 6px;
              background: none;
              border: none;
              cursor: pointer;
              gap: 5px;
              z-index: 200;
            }
            .oz-hamburger span {
              display: block;
              width: 20px;
              height: 2px;
              background: currentColor;
              border-radius: 2px;
              transition: transform 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease;
              transform-origin: center;
            }
            .oz-hamburger-open span:nth-child(1) {
              transform: translateY(7px) rotate(45deg);
            }
            .oz-hamburger-open span:nth-child(2) {
              opacity: 0;
              transform: scaleX(0);
            }
            .oz-hamburger-open span:nth-child(3) {
              transform: translateY(-7px) rotate(-45deg);
            }

            /* ─── Full-screen mobile menu overlay ─── */
            .oz-mobile-menu {
              position: fixed;
              inset: 0;
              z-index: 150;
              background: var(--oz-mm-bg);
              display: flex;
              align-items: center;
              justify-content: center;
              opacity: 0;
              pointer-events: none;
              transition: opacity 0.3s cubic-bezier(0.4,0,0.2,1);
            }
            .oz-mobile-menu-open {
              opacity: 1;
              pointer-events: auto;
            }
            .oz-mobile-menu-content {
              text-align: center;
              transform: translateY(12px);
              transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
            }
            .oz-mobile-menu-open .oz-mobile-menu-content {
              transform: translateY(0);
            }
            .oz-mobile-menu-link {
              display: block;
              color: var(--oz-mm-text-secondary);
              text-decoration: none;
              font-size: 1.3rem;
              font-weight: 500;
              padding: 0.6rem 1rem;
              border-radius: 8px;
              transition: color 0.15s, background 0.15s;
            }
            .oz-mobile-menu-link:hover,
            .oz-mobile-menu-link:active {
              color: var(--oz-mm-text);
              background: var(--oz-mm-border);
            }
          `,
        }}
      />
    </>
  );
}
