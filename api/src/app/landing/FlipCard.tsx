"use client";

import { useState, useRef, useCallback, useLayoutEffect } from "react";

export function FlipCard({
  front,
  back,
  cardBg,
  border,
  minHeight = 160,
}: {
  front: React.ReactNode;
  back: React.ReactNode;
  cardBg: string;
  border: string;
  minHeight?: number;
}) {
  const [flipped, setFlipped] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Use a CSS approach: set explicit height via ref, no setState in effects
  const measureHeight = useCallback(() => {
    if (!containerRef.current) return;
    // The inner div has position:absolute children, so its scrollHeight is 0.
    // Instead, use the max of the two face heights via their actual content.
    const faces = containerRef.current.querySelectorAll<HTMLElement>("[data-flip-face]");
    let maxH = minHeight;
    for (const face of faces) {
      // Temporarily make it visible for measurement
      const prev = face.style.position;
      face.style.position = "relative";
      maxH = Math.max(maxH, face.scrollHeight);
      face.style.position = prev;
    }
    containerRef.current.style.height = maxH + "px";
  }, [minHeight]);

  useLayoutEffect(() => {
    measureHeight();
  }, [measureHeight, front, back]);

  return (
    <div ref={containerRef} style={{ minHeight, perspective: 600, cursor: "pointer" }} onClick={() => setFlipped((f) => !f)}>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          transition: "transform 0.5s",
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "none",
        }}
      >
        <div
          data-flip-face
          style={{
            backfaceVisibility: "hidden",
            position: "absolute",
            inset: 0,
            background: cardBg,
            border: `1px solid ${border}`,
            borderRadius: 12,
            padding: 20,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          {front}
        </div>
        <div
          data-flip-face
          style={{
            backfaceVisibility: "hidden",
            position: "absolute",
            inset: 0,
            background: cardBg,
            border: `1px solid ${border}`,
            borderRadius: 12,
            padding: 20,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            textAlign: "center",
            transform: "rotateY(180deg)",
          }}
        >
          {back}
        </div>
      </div>
    </div>
  );
}
