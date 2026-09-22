"use client";

import { useState, type ReactNode } from "react";

interface CodeBlockProps {
  children: ReactNode;
  label?: string;
  dark?: boolean;
  code?: string;
}

export function CodeBlock({ children, label, dark = true, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    const textToCopy = code || getTextContent(children);
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        setCopied(true);
        setTimeout(() => { setCopied(false); }, 2000);
      })
      .catch(() => {
        // clipboard unavailable/denied — leave the button label as "Copy"
      });
  };

  return (
    <div
      style={{
        position: "relative",
        background: dark ? "#0d1117" : "#f5f5f5",
        borderRadius: 8,
        padding: "0.8rem 1rem",
        fontFamily: "monospace",
        fontSize: "0.8rem",
        lineHeight: 1.7,
        overflowX: "auto",
      }}
    >
      {label && (
        <div
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            // AAA on the block background: #c9d1d9 = 11.5:1 on #0d1117,
            // #404040 = 9.8:1 on #f5f5f5.
            color: dark ? "#c9d1d9" : "#404040",
            marginBottom: "0.4rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {label}
        </div>
      )}
      <button
        onClick={copyCode}
        style={{
          position: "absolute",
          top: "0.5rem",
          right: "0.5rem",
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 4,
          // Rest-state colors must already pass AAA — the previous 0.7 opacity
          // blended the label down to 2.9:1 on light backgrounds. Effective
          // surface is #f5f5f5 (light) / #202429 (dark, white 8% over #0d1117):
          // #404040 = 9.8:1, #c9d1d9 = 11.5:1.
          color: dark ? "#c9d1d9" : "#404040",
          padding: "0.2rem 0.5rem",
          cursor: "pointer",
          fontSize: "0.7rem",
          fontFamily: "inherit",
          transition: "border-color 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.35)")}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)")}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {children}
    </div>
  );
}

function getTextContent(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(getTextContent).join("\n");
  return "";
}
