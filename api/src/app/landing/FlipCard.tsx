"use client";

import { useState, useRef, useEffect } from "react";

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
  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(minHeight);

  // Measure actual content height and use the max of front/back
  useEffect(() => {
    const frontH = frontRef.current?.scrollHeight ?? minHeight;
    const backH = backRef.current?.scrollHeight ?? minHeight;
    const h = Math.max(frontH, backH, minHeight);
    if (h !== height) setHeight(h);
  }, [front, back, minHeight]);

  return (
    <div style={{ height, perspective: 600, cursor: "pointer" }} onClick={() => setFlipped((f) => !f)}>
      <div
        style={{
          position: "relative",
          width: "100%",
          height,
          transition: "transform 0.5s",
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "none",
        }}
      >
        <div
          ref={frontRef}
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
          ref={backRef}
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
