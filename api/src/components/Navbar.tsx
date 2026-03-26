"use client";

import { useState, type ReactNode } from "react";
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
          <div style={{ display: "flex", gap: "1.2rem", alignItems: "center" }} className="desktop-nav">
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
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenu(!mobileMenu)}
            style={{
              display: "none",
              background: "none",
              border: "none",
              color: text,
              cursor: "pointer",
              padding: "4px",
            }}
            aria-label="Menu"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d={mobileMenu ? "M5 5l10 10M15 5L5 15" : "M3 5h14M3 10h14M3 15h14"} />
            </svg>
          </button>
        </div>
        {/* Mobile menu dropdown */}
        {mobileMenu && (
          <div
            style={{
              padding: "0.5rem 1.5rem 1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.6rem",
              borderTop: `1px solid ${border}`,
            }}
          >
            {NAV_LINKS.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                onClick={() => setMobileMenu(false)}
                style={{ color: textSecondary, textDecoration: "none", fontSize: "0.9rem", padding: "0.3rem 0" }}
              >
                {l.label}
              </Link>
            ))}
            <a
              href="https://github.com/aliasfoxkde/OpenZenith"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMobileMenu(false)}
              style={{ color: textSecondary, textDecoration: "none", fontSize: "0.9rem", padding: "0.3rem 0" }}
            >
              GitHub
            </a>
          </div>
        )}
      </nav>
      <style
        dangerouslySetInnerHTML={{
          __html: `@media(max-width:768px){.desktop-nav{display:none!important}nav button{display:block!important}}`,
        }}
      />
    </>
  );
}
