"use client";

import { useState } from "react";

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

  return (
    <div style={{ minHeight, perspective: 600, cursor: "pointer" }} onClick={() => setFlipped((f) => !f)}>
      <div
        style={{
          position: "relative",
          width: "100%",
          minHeight,
          transition: "transform 0.5s",
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "none",
        }}
      >
        <div
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
