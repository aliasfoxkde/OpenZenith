import { describe, it, expect } from "vitest";
import { SURVEILLANCE_THEME } from "@/lib/theme";

describe("Surveillance Theme", () => {
  it("exports all expected theme constants", () => {
    expect(SURVEILLANCE_THEME.bg).toBeTruthy();
    expect(SURVEILLANCE_THEME.panel).toBeTruthy();
    expect(SURVEILLANCE_THEME.border).toBeTruthy();
    expect(SURVEILLANCE_THEME.accent).toBeTruthy();
    expect(SURVEILLANCE_THEME.green).toBeTruthy();
    expect(SURVEILLANCE_THEME.red).toBeTruthy();
    expect(SURVEILLANCE_THEME.text).toBeTruthy();
    expect(SURVEILLANCE_THEME.textMuted).toBeTruthy();
    expect(SURVEILLANCE_THEME.fontMono).toBeTruthy();
    expect(SURVEILLANCE_THEME.fontSans).toBeTruthy();
    expect(SURVEILLANCE_THEME.glow).toBeTruthy();
    expect(SURVEILLANCE_THEME.glowSubtle).toBeTruthy();
    expect(SURVEILLANCE_THEME.basemapDark).toBeTruthy();
  });

  it("uses dark color scheme", () => {
    // bg should be very dark
    expect(SURVEILLANCE_THEME.bg).toMatch(/^#[0-9a-f]{6}$/);
    // accent should be cyan
    expect(SURVEILLANCE_THEME.accent).toBe("#00e5ff");
  });

  it("has valid CSS color values", () => {
    const colorProps = ["bg", "accent", "green", "amber", "red", "blue", "text", "textMuted"];
    for (const prop of colorProps) {
      const val = (SURVEILLANCE_THEME as any)[prop];
      expect(val).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
