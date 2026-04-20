"use client";

import { useRef, useEffect, useCallback } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  baseAlpha: number;
}

interface Props {
  /** Whether dark mode is active. */
  dark: boolean;
  /** Container width (px). */
  width: number;
  /** Container height (px). */
  height: number;
}

const PARTICLE_COUNT = 60;
const MOUSE_RADIUS = 150;
const MOUSE_FORCE = 0.04;

export function HeroParticles({ dark, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const rafRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const color = dark ? "0, 229, 255" : "0, 100, 180"; // cyan in dark, deep blue in light

  const initParticles = useCallback(
    (w: number, h: number) => {
      const particles: Particle[] = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const baseAlpha = 0.15 + Math.random() * 0.35;
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.6,
          vy: (Math.random() - 0.5) * 0.6,
          radius: 1 + Math.random() * 2,
          alpha: baseAlpha,
          baseAlpha,
        });
      }
      particlesRef.current = particles;
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    initParticles(width, height);

    // Track mouse on the parent hero section (canvas has pointer-events: none)
    const container = canvas.parentElement;
    const handleMouseMove = (e: MouseEvent) => {
      const rect = container ? container.getBoundingClientRect() : canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const handleMouseLeave = () => {
      mouseRef.current = { x: -1000, y: -1000 };
    };

    (container || canvas).addEventListener("mousemove", handleMouseMove);
    (container || canvas).addEventListener("mouseleave", handleMouseLeave);
    const eventTarget = container || canvas;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const particles = particlesRef.current;

      for (const p of particles) {
        // Mouse repulsion
        const dx = p.x - mx;
        const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_RADIUS && dist > 0) {
          const force = ((MOUSE_RADIUS - dist) / MOUSE_RADIUS) * MOUSE_FORCE;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
          // Brighten near cursor
          p.alpha = Math.min(1, p.baseAlpha + ((MOUSE_RADIUS - dist) / MOUSE_RADIUS) * 0.5);
        } else {
          p.alpha += (p.baseAlpha - p.alpha) * 0.02;
        }

        // Drift
        p.x += p.vx;
        p.y += p.vy;

        // Damping
        p.vx *= 0.992;
        p.vy *= 0.992;

        // Wrap edges
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;

        // Draw particle with glow
        const r = Math.max(0.5, p.radius);
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
        gradient.addColorStop(0, `rgba(${color}, ${p.alpha})`);
        gradient.addColorStop(0.4, `rgba(${color}, ${p.alpha * 0.4})`);
        gradient.addColorStop(1, `rgba(${color}, 0)`);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Core dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color}, ${p.alpha * 0.9})`;
        ctx.fill();
      }

      // Draw connection lines between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const ddx = a.x - b.x;
          const ddy = a.y - b.y;
          const d = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < 100) {
            const lineAlpha = ((100 - d) / 100) * 0.15 * Math.min(a.alpha, b.alpha);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(${color}, ${lineAlpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      eventTarget.removeEventListener("mousemove", handleMouseMove);
      eventTarget.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [width, height, color, initParticles]);

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0, zIndex: 1 }}>
      <canvas
        ref={canvasRef}
        style={{
          width,
          height,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
