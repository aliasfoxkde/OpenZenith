"use client";

import { useState } from "react";

interface GetInTouchProps {
  dark: boolean;
  /** Optional section heading (default: "Get in Touch") */
  heading?: string;
  /** Optional description text */
  description?: string;
  /** Optional submit button label */
  submitLabel?: string;
  /** Optional success title */
  successTitle?: string;
  /** Optional success message */
  successMessage?: string;
}

export function GetInTouch({
  dark,
  heading = "Get in Touch",
  description = "Have a question, suggestion, or want to collaborate? Drop us a message.",
  submitLabel = "Send Message",
  successTitle = "Message received",
  successMessage = "We'll get back to you as soon as possible.",
}: GetInTouchProps) {
  const [contactForm, setContactForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [contactSent, setContactSent] = useState(false);

  const cardBg = dark ? "#161616" : "#ffffff";
  const border = dark ? "#222" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSecondary = dark ? "#9CA3AF" : "#6B7280";
  const accent = "#22c55e";
  const accentDim = dark ? "rgba(34,197,94,0.12)" : "#dcfce7";
  const inputBg = dark ? "#111" : "#fff";

  async function sendContact(e: React.FormEvent) {
    e.preventDefault();
    if (!contactForm.name || !contactForm.email || !contactForm.message) return;
    setContactSent(true);
    setContactForm({ name: "", email: "", subject: "", message: "" });
  }

  return (
    <section
      id="contact"
      style={{
        maxWidth: 1400,
        margin: "0 auto",
        padding: "2.5rem 1.5rem",
        borderTop: `1px solid ${dark ? "#1a1a1a" : "#f0f0f0"}`,
      }}
    >
      <div
        style={{
          position: "relative",
          background: cardBg,
          border: `1px solid ${border}`,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "linear-gradient(90deg, #22c55e, #3b82f6, #a855f7)",
          }}
        />
        <div style={{ padding: "2rem 2.5rem" }}>
          <h2
            style={{
              fontSize: "1.3rem",
              fontWeight: 700,
              margin: "0 0 0.35rem",
              textAlign: "center",
              letterSpacing: "-0.02em",
            }}
          >
            {heading}
          </h2>
          <p style={{ fontSize: "0.85rem", color: textSecondary, margin: "0 0 1.75rem", textAlign: "center" }}>
            {description}
          </p>
          {contactSent ? (
            <div style={{ textAlign: "center", padding: "2rem 0" }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: accentDim,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 0.75rem",
                  color: accent,
                  fontSize: "1.5rem",
                }}
              >
                &#10003;
              </div>
              <p style={{ fontSize: "0.95rem", fontWeight: 500, margin: "0 0 0.25rem" }}>{successTitle}</p>
              <p style={{ fontSize: "0.82rem", color: textSecondary, margin: "0" }}>{successMessage}</p>
              <button
                onClick={() => setContactSent(false)}
                style={{
                  marginTop: "1rem",
                  padding: "0.4rem 1rem",
                  borderRadius: 6,
                  border: `1px solid ${border}`,
                  background: "transparent",
                  color: textSecondary,
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  fontFamily: "inherit",
                }}
              >
                Send another
              </button>
            </div>
          ) : (
            <form
              onSubmit={sendContact}
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "0.75rem",
                maxWidth: 640,
                margin: "0 auto",
              }}
            >
              <div>
                <label
                  htmlFor="contact-name"
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    color: textSecondary,
                    marginBottom: "0.3rem",
                  }}
                >
                  Name *
                </label>
                <input
                  id="contact-name"
                  type="text"
                  required
                  value={contactForm.name}
                  onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                  placeholder="Your name"
                  aria-required="true"
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    borderRadius: 8,
                    border: `1px solid ${border}`,
                    background: inputBg,
                    color: text,
                    fontSize: "0.85rem",
                    outline: "none",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label
                  htmlFor="contact-email"
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    color: textSecondary,
                    marginBottom: "0.3rem",
                  }}
                >
                  Email *
                </label>
                <input
                  id="contact-email"
                  type="email"
                  required
                  value={contactForm.email}
                  onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                  placeholder="you@example.com"
                  aria-required="true"
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    borderRadius: 8,
                    border: `1px solid ${border}`,
                    background: inputBg,
                    color: text,
                    fontSize: "0.85rem",
                    outline: "none",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label
                  htmlFor="contact-subject"
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    color: textSecondary,
                    marginBottom: "0.3rem",
                  }}
                >
                  Subject
                </label>
                <input
                  id="contact-subject"
                  type="text"
                  value={contactForm.subject}
                  onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
                  placeholder="What's this about?"
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    borderRadius: 8,
                    border: `1px solid ${border}`,
                    background: inputBg,
                    color: text,
                    fontSize: "0.85rem",
                    outline: "none",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label
                  htmlFor="contact-message"
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    color: textSecondary,
                    marginBottom: "0.3rem",
                  }}
                >
                  Message *
                </label>
                <textarea
                  id="contact-message"
                  required
                  rows={4}
                  value={contactForm.message}
                  onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                  placeholder="Your message..."
                  aria-required="true"
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    borderRadius: 8,
                    border: `1px solid ${border}`,
                    background: inputBg,
                    color: text,
                    fontSize: "0.85rem",
                    outline: "none",
                    fontFamily: "inherit",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ gridColumn: "1 / -1", textAlign: "right" }}>
                <button
                  type="submit"
                  style={{
                    padding: "0.55rem 1.6rem",
                    borderRadius: 8,
                    border: "none",
                    background: accent,
                    color: "#000",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {submitLabel}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
