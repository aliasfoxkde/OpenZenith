"use client";

import { useState } from "react";

export function FlipCard({
  front,
  back,
  cardBg,
  border,
  height = 160,
}: {
  front: React.ReactNode;
  back: React.ReactNode;
  cardBg: string;
  border: string;
  /** Fixed height for the card (px). All cards should use the same value for alignment. */
  height?: number;
}) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div style={{ height, perspective: 600, cursor: "pointer" }} onClick={() => setFlipped((f) => !f)}>
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
            overflow: "hidden",
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
            overflow: "hidden",
          }}
        >
          {back}
        </div>
      </div>
    </div>
  );
}
