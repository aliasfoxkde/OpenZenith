"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { GetInTouch } from "@/components/GetInTouch";
import { CodeBlock } from "@/components/CodeBlock";

/* ─── Helpers ─── */

const LOCATIONS = [
  { name: "Mount Everest", lat: "28.0", lon: "86.9" },
  { name: "K2", lat: "35.8825", lon: "76.5133" },
  { name: "Kangchenjunga", lat: "27.7025", lon: "88.1475" },
  { name: "Denali", lat: "63.0695", lon: "-151.0074" },
  { name: "Mt. Whitney", lat: "36.5785", lon: "-118.2923" },
  { name: "Matterhorn", lat: "45.9763", lon: "7.6586" },
  { name: "Mont Blanc", lat: "45.8326", lon: "6.8652" },
  { name: "Aconcagua", lat: "-32.6532", lon: "-70.0109" },
  { name: "Kilimanjaro", lat: "-3.0674", lon: "37.3556" },
  { name: "Elbrus", lat: "43.3499", lon: "42.4453" },
  { name: "Mt. Fuji", lat: "35.3606", lon: "138.7274" },
  { name: "Table Mountain", lat: "-33.9628", lon: "18.4098" },
  { name: "Torres del Paine", lat: "-51.0", lon: "-73.0" },
  { name: "Ben Nevis", lat: "56.7969", lon: "-5.0036" },
  { name: "Mt. Cook", lat: "-43.5950", lon: "170.1418" },
  { name: "Pico de Orizaba", lat: "19.0303", lon: "-97.2689" },
  { name: "Vinson Massif", lat: "-78.5254", lon: "-85.6171" },
  { name: "Puncak Jaya", lat: "-4.0833", lon: "137.1833" },
  { name: "Mt. Rainier", lat: "46.8523", lon: "-121.7603" },
  { name: "Grand Teton", lat: "43.7410", lon: "-110.8025" },
  { name: "Mt. Olympus", lat: "40.1475", lon: "-22.3578" },
  { name: "Eiger", lat: "46.5770", lon: "7.9633" },
  { name: "Cotopaxi", lat: "-0.6811", lon: "-78.4369" },
  { name: "Mt. St. Helens", lat: "46.1912", lon: "-122.1944" },
  { name: "Popocat\u00e9petl", lat: "19.0230", lon: "-98.6217" },
  { name: "Mt. Kenya", lat: "-0.1521", lon: "37.3084" },
  { name: "Shishapangma", lat: "28.3537", lon: "85.7858" },
  { name: "Cho Oyu", lat: "28.0953", lon: "86.6661" },
  { name: "Makalu", lat: "27.8897", lon: "87.0886" },
  { name: "Lhotse", lat: "27.9617", lon: "86.9333" },
  { name: "Mt. Logan", lat: "60.5670", lon: "-140.4055" },
  { name: "Mt. Robson", lat: "53.1104", lon: "-119.1553" },
  { name: "Mt. Aspiring", lat: "-44.4450", lon: "168.2930" },
  { name: "Mt. Kosciuszko", lat: "-36.4561", lon: "148.2632" },
  { name: "Mt. Sinai", lat: "28.5394", lon: "33.9753" },
  { name: "Mt. Etna", lat: "37.7510", lon: "14.9934" },
  { name: "Mt. Vesuvius", lat: "40.8214", lon: "14.4261" },
  { name: "Mt. Bromo", lat: "-7.9425", lon: "112.9530" },
  { name: "Mt. Pinatubo", lat: "15.1400", lon: "120.3500" },
  { name: "Mt. Hood", lat: "45.3734", lon: "-121.6957" },
  { name: "Mt. Adams", lat: "46.2061", lon: "-121.4905" },
  { name: "Mt. Baker", lat: "48.7767", lon: "-121.8131" },
  { name: "Half Dome", lat: "37.7459", lon: "-119.5338" },
  { name: "El Capitan", lat: "37.7340", lon: "-119.6371" },
  { name: "Angel's Landing", lat: "37.1835", lon: "-112.9526" },
  { name: "Zion Canyon", lat: "37.2982", lon: "-113.0263" },
  { name: "Grand Canyon", lat: "36.1069", lon: "-112.1129" },
  { name: "Niagara Falls", lat: "43.0962", lon: "-79.0377" },
  { name: "Victoria Falls", lat: "-17.9243", lon: "25.8572" },
  { name: "Iguazu Falls", lat: "-25.6953", lon: "-54.4367" },
  { name: "Machu Picchu", lat: "-13.1631", lon: "-72.5450" },
  { name: "Petra", lat: "30.3285", lon: "35.4444" },
  { name: "Angkor Wat", lat: "13.4125", lon: "103.8670" },
  { name: "Taj Mahal", lat: "27.1751", lon: "78.0421" },
  { name: "Colosseum", lat: "41.8902", lon: "12.4922" },
  { name: "Stonehenge", lat: "51.1789", lon: "-1.8262" },
  { name: "Pyramids of Giza", lat: "29.9792", lon: "31.1342" },
  { name: "Sydney Opera House", lat: "-33.8568", lon: "151.2153" },
  { name: "Eiffel Tower", lat: "48.8584", lon: "2.2945" },
  { name: "Statue of Liberty", lat: "40.6892", lon: "-74.0445" },
  { name: "Christ the Redeemer", lat: "-22.9519", lon: "-43.2105" },
  { name: "Big Ben", lat: "51.5007", lon: "-0.1246" },
  { name: "Tokyo Tower", lat: "35.6586", lon: "139.7454" },
  { name: "Burj Khalifa", lat: "25.1972", lon: "55.2744" },
  { name: "Empire State Building", lat: "40.7484", lon: "-73.9857" },
  { name: "Golden Gate Bridge", lat: "37.8199", lon: "-122.4783" },
  { name: "Great Wall (Mutianyu)", lat: "40.4319", lon: "116.5704" },
  { name: "Forbidden City", lat: "39.9163", lon: "116.3972" },
  { name: "Santorini", lat: "36.3932", lon: "25.4615" },
  { name: "Galapagos", lat: "-0.9538", lon: "-90.9656" },
  { name: "Sahara (Tamanrasset)", lat: "22.7850", lon: "5.5228" },
  { name: "Amazon (Manaus)", lat: "-3.1190", lon: "-60.0217" },
  { name: "Antarctica (McMurdo)", lat: "-77.8460", lon: "166.6760" },
  { name: "North Pole", lat: "90.0", lon: "0.0" },
  { name: "Svalbard (Longyearbyen)", lat: "78.2232", lon: "15.6267" },
  { name: "Reykjavik", lat: "64.1466", lon: "-21.9426" },
  { name: "Ushuaia", lat: "-54.8019", lon: "-68.3030" },
  { name: "Cape Town", lat: "-33.9249", lon: "18.4241" },
  { name: "Dubai", lat: "25.2048", lon: "55.2708" },
  { name: "Singapore", lat: "1.3521", lon: "103.8198" },
  { name: "Mumbai", lat: "19.0760", lon: "72.8777" },
  { name: "Bangkok", lat: "13.7563", lon: "100.5018" },
  { name: "Seoul", lat: "37.5665", lon: "126.9780" },
  { name: "Beijing", lat: "39.9042", lon: "116.4074" },
  { name: "Moscow", lat: "55.7558", lon: "37.6173" },
  { name: "Istanbul", lat: "41.0082", lon: "28.9784" },
  { name: "Cairo", lat: "30.0444", lon: "31.2357" },
  { name: "Lima", lat: "-12.0464", lon: "-77.0428" },
  { name: "Mexico City", lat: "19.4326", lon: "-99.1332" },
  { name: "New York", lat: "40.7128", lon: "-74.0060" },
  { name: "Los Angeles", lat: "34.0522", lon: "-118.2437" },
  { name: "Chicago", lat: "41.8781", lon: "-87.6298" },
  { name: "London", lat: "51.5074", lon: "-0.1278" },
  { name: "Paris", lat: "48.8566", lon: "2.3522" },
  { name: "Berlin", lat: "52.5200", lon: "13.4050" },
  { name: "Rome", lat: "41.9028", lon: "12.4964" },
  { name: "Madrid", lat: "40.4168", lon: "-3.7038" },
  { name: "Barcelona", lat: "41.3874", lon: "2.1686" },
  { name: "Amsterdam", lat: "52.3676", lon: "4.9041" },
  { name: "Vienna", lat: "48.2082", lon: "16.3738" },
  { name: "Prague", lat: "50.0755", lon: "14.4378" },
  { name: "Rio de Janeiro", lat: "-22.9068", lon: "-43.1729" },
  { name: "Buenos Aires", lat: "-34.6037", lon: "-58.3816" },
  { name: "Santiago", lat: "-33.4489", lon: "-70.6693" },
  { name: "Bogota", lat: "4.7110", lon: "-74.0721" },
  { name: "Havana", lat: "23.1136", lon: "-82.3666" },
  { name: "Nairobi", lat: "-1.2921", lon: "36.8219" },
  { name: "Lagos", lat: "6.5244", lon: "3.3792" },
  { name: "Addis Ababa", lat: "9.0250", lon: "38.7469" },
  { name: "Casablanca", lat: "33.5731", lon: "-7.5898" },
  { name: "Athens", lat: "37.9838", lon: "23.7275" },
  { name: "Lisbon", lat: "38.7223", lon: "-9.1393" },
  { name: "Edinburgh", lat: "55.9533", lon: "-3.1883" },
  { name: "Oslo", lat: "59.9139", lon: "10.7522" },
  { name: "Stockholm", lat: "59.3293", lon: "18.0686" },
  { name: "Helsinki", lat: "60.1699", lon: "24.9384" },
  { name: "Warsaw", lat: "52.2297", lon: "21.0122" },
  { name: "Budapest", lat: "47.4979", lon: "19.0402" },
  { name: "Dublin", lat: "53.3498", lon: "-6.2603" },
  { name: "Copenhagen", lat: "55.6761", lon: "12.5683" },
];

function pickRandomLocations(count: number) {
  const shuffled = [...LOCATIONS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function useTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return dark;
}

function elevationToTerrarium(data: Int16Array): Uint8Array {
  const pixels = new Uint8Array(data.length * 4);
  for (let i = 0; i < data.length; i++) {
    const elev = data[i];
    if (elev === -32768) {
      pixels[i * 4 + 3] = 0;
    } else {
      const h = elev + 32768;
      pixels[i * 4] = (h / 256) | 0;
      pixels[i * 4 + 1] = h % 256;
      pixels[i * 4 + 2] = 0;
      pixels[i * 4 + 3] = 255;
    }
  }
  return pixels;
}

function waitForMapLibre(timeoutMs = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.maplibregl) return resolve(w.maplibregl);
    const start = Date.now();
    const iv = setInterval(() => {
      if (w.maplibregl) {
        clearInterval(iv);
        resolve(w.maplibregl);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error("MapLibre GL failed to load"));
      }
    }, 100);
  });
}

/* ─── Flip Card ─── */

function FlipCard({
  front,
  back,
  dark,
  cardBg,
  border,
  text,
  textSecondary,
  accent,
  accentDim,
  minHeight = 160,
}: {
  front: React.ReactNode;
  back: React.ReactNode;
  dark: boolean;
  cardBg: string;
  border: string;
  text: string;
  textSecondary: string;
  accent: string;
  accentDim: string;
  minHeight?: number;
}) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div
      onMouseEnter={() => setFlipped(true)}
      onMouseLeave={() => setFlipped(false)}
      style={{ perspective: 800, minHeight }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          minHeight,
          transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* Front */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            background: cardBg,
            border: `1px solid ${border}`,
            borderRadius: 12,
            padding: "1.25rem",
            overflow: "hidden",
          }}
        >
          {front}
        </div>
        {/* Back */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            background: dark ? "#111" : "#f8f8f8",
            border: `1px solid ${accent}33`,
            borderRadius: 12,
            padding: "1.25rem",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          {back}
        </div>
      </div>
    </div>
  );
}

/* ─── Hero Slideshow ─── */

const HERO_SLIDES = [
  {
    title: "Free global elevation API",
    desc: "Query any point on Earth for elevation. NASA SRTM 30m, 14,296 tiles, ~30m resolution, 80% land coverage.",
    cta: null,
    gradient: ["#22c55e", "#16a34a", "#0d9488"],
    tag: "Open source \u00B7 No API key required",
  },
  {
    title: "Interactive Map",
    desc: "MapLibre GL with 3D terrain, 5 basemaps, hillshade layer, elevation pins, and drawing tools.",
    cta: { label: "Open Map", href: "/map" },
    gradient: ["#3b82f6", "#6366f1", "#8b5cf6"],
    tag: "MapLibre GL \u00B7 3D Terrain",
  },
  {
    title: "WorldView 3D Globe",
    desc: "CesiumJS 3D globe with 12+ real-time data layers: earthquakes, flights, satellites, weather, and more.",
    cta: { label: "Launch WorldView", href: "/worldview" },
    gradient: ["#a855f7", "#ec4899", "#f43f5e"],
    tag: "CesiumJS \u00B7 Real-time Data",
  },
  {
    title: "Data Explorer",
    desc: "Multi-tab explorer integrating NOAA, USGS, Celestrak, OpenSky, ArcGIS, Overpass, and marine weather.",
    cta: { label: "Explore Data", href: "/explore" },
    gradient: ["#f59e0b", "#f97316", "#ef4444"],
    tag: "NOAA \u00B7 USGS \u00B7 Celestrak",
  },
  {
    title: "Open Source & Free",
    desc: "No API key required. No rate limits on basic queries. MIT licensed. Deployed on Cloudflare's global edge.",
    cta: { label: "View API Docs", href: "/api/docs" },
    gradient: ["#06b6d4", "#0ea5e9", "#3b82f6"],
    tag: "MIT License \u00B7 Cloudflare Edge",
  },
];

function HeroSlideshow({
  dark,
  slide,
  setSlide,
  lat,
  setLat,
  lon,
  setLon,
  loading,
  lookup,
  error,
  result,
  snippetTab,
  setSnippetTab,
  copied,
  setCopied,
  elevCopied,
  setElevCopied,
  sampleLocations,
  setSampleLocations,
  pickRandomLocations,
  inputStyle,
  codeBg,
  cardBg,
  border,
  text,
  textSecondary,
  accent,
  accentDim,
  W,
}: {
  dark: boolean;
  slide: number;
  setSlide: React.Dispatch<React.SetStateAction<number>>;
  lat: string;
  setLat: (v: string) => void;
  lon: string;
  setLon: (v: string) => void;
  loading: boolean;
  lookup: () => void;
  error: string;
  result: any;
  snippetTab: string;
  setSnippetTab: React.Dispatch<React.SetStateAction<"url" | "curl" | "js" | "python">>;
  copied: boolean;
  setCopied: (b: boolean) => void;
  elevCopied: boolean;
  setElevCopied: (b: boolean) => void;
  sampleLocations: { name: string; lat: string; lon: string }[];
  setSampleLocations: (locs: { name: string; lat: string; lon: string }[]) => void;
  pickRandomLocations: (n: number) => { name: string; lat: string; lon: string }[];
  inputStyle: React.CSSProperties;
  codeBg: string;
  cardBg: string;
  border: string;
  text: string;
  textSecondary: string;
  accent: string;
  accentDim: string;
  W: number;
}) {
  const total = HERO_SLIDES.length;

  // Auto-rotate every 8s, pause on hover
  useEffect(() => {
    const iv = setInterval(() => setSlide((s) => (s + 1) % total), 8000);
    return () => clearInterval(iv);
  }, [total, setSlide]);

  const s = HERO_SLIDES[slide];
  const gradBg = `linear-gradient(135deg, ${s.gradient[0]}22 0%, ${s.gradient[1]}15 50%, ${s.gradient[2]}22 100%)`;

  return (
    <section style={{ position: "relative", overflow: "hidden" }}>
      {/* Animated gradient background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: gradBg,
          opacity: 0.6,
          transition: "opacity 0.8s ease",
        }}
      />
      {/* Dot grid pattern */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: dark
            ? "radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)"
            : "radial-gradient(circle, rgba(0,0,0,0.04) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div style={{ position: "relative", maxWidth: W, margin: "0 auto", padding: "3rem 1.5rem 1.5rem", textAlign: "center" }}>
        {/* Tag pill */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            padding: "0.25rem 0.7rem",
            borderRadius: 100,
            background: accentDim,
            color: accent,
            fontSize: "0.75rem",
            fontWeight: 500,
            marginBottom: "1.25rem",
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: accent, display: "inline-block" }} />
          {s.tag}
        </div>
        {/* Title */}
        <h1
          style={{
            fontSize: "clamp(1.8rem, 4vw, 2.8rem)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            margin: "0 0 0.75rem",
            lineHeight: 1.15,
          }}
        >
          {s.title}
        </h1>
        {/* Description */}
        <p style={{ fontSize: "1.05rem", color: textSecondary, maxWidth: 520, margin: "0 auto 1.5rem", lineHeight: 1.6 }}>
          {s.desc}
        </p>
        {/* Slide content */}
        {slide === 0 ? (
          /* Elevation lookup (slide 1) */
          <div
            style={{
              background: cardBg,
              border: `1px solid ${border}`,
              borderRadius: 12,
              padding: "1.25rem 1.5rem",
              maxWidth: 560,
              margin: "0 auto",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Latitude (28.0)"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                style={inputStyle}
                onKeyDown={(e) => e.key === "Enter" && lookup()}
              />
              <input
                type="text"
                placeholder="Longitude (86.9)"
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                style={inputStyle}
                onKeyDown={(e) => e.key === "Enter" && lookup()}
              />
              <button
                onClick={lookup}
                disabled={loading}
                style={{
                  padding: "0.55rem 1.1rem",
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  borderRadius: 6,
                  border: "none",
                  background: accent,
                  color: "#000",
                  cursor: loading ? "wait" : "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                {loading ? "..." : "Lookup"}
              </button>
            </div>
            {error && <p style={{ color: "#ef4444", margin: "0 0 0.4rem", fontSize: "0.85rem" }}>{error}</p>}
            {result && (
              <>
                <div
                  style={{
                    background: codeBg,
                    borderRadius: 8,
                    padding: "0.6rem 0.8rem",
                    fontFamily: "monospace",
                    fontSize: "0.8rem",
                    marginBottom: "0.75rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "0.25rem",
                    }}
                  >
                    <span style={{ color: accent, fontWeight: 600, fontSize: "1.1rem" }}>
                      {result.elevation !== null
                        ? `${result.elevation.toLocaleString()}m (${(result.elevation * 3.28084).toFixed(2)} ft)`
                        : "null"}
                    </span>
                    <button
                      onClick={async () => {
                        const txt = result.elevation !== null
                          ? `${result.elevation.toLocaleString()}m (${(result.elevation * 3.28084).toFixed(2)} ft)`
                          : "null";
                        await navigator.clipboard.writeText(txt);
                        setElevCopied(true);
                        setTimeout(() => setElevCopied(false), 1500);
                      }}
                      title="Copy elevation"
                      aria-label="Copy elevation"
                      style={{
                        background: "none",
                        border: "none",
                        color: textSecondary,
                        cursor: "pointer",
                        fontSize: "0.78rem",
                        padding: "2px 6px",
                        borderRadius: 3,
                        opacity: 0.7,
                        transition: "opacity 0.15s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
                    >
                      {elevCopied ? "Copied!" : "Copy"}
                    </button>
                    <a href="/api/docs" style={{ fontSize: "0.72rem", color: accent, textDecoration: "none" }}>
                      View API Docs &rarr;
                    </a>
                  </div>
                  <div>
                    <span style={{ color: textSecondary }}>tile </span>
                    <span style={{ color: text }}>{result.srtmTile}</span>
                  </div>
                  <div>
                    <span style={{ color: textSecondary }}>source </span>
                    <span style={{ color: text }}>
                      {result.source} &middot; {result.resolution}m resolution
                    </span>
                  </div>
                  <div>
                    <span style={{ color: textSecondary }}>coords </span>
                    <span style={{ color: text }}>
                      {result.location.lat}, {result.location.lon}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.4rem" }}>
                  {(["url", "curl", "js", "python"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setSnippetTab(tab)}
                      style={{
                        padding: "0.2rem 0.6rem",
                        fontSize: "0.72rem",
                        fontWeight: 500,
                        borderRadius: 4,
                        border: "none",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        background: snippetTab === tab ? accent : "transparent",
                        color: snippetTab === tab ? "#000" : textSecondary,
                      }}
                    >
                      {tab === "url" ? "API URL" : tab === "js" ? "JavaScript" : tab === "python" ? "Python" : "cURL"}
                    </button>
                  ))}
                </div>
                <div style={{ position: "relative" }}>
                  <button
                    onClick={async () => {
                      const snippets: Record<string, string> = {
                        url: `https://openzenith.pages.dev/api/elevation?lat=${result.location.lat}&lon=${result.location.lon}`,
                        curl: `curl "https://openzenith.pages.dev/api/elevation?lat=${result.location.lat}&lon=${result.location.lon}"`,
                        js: `const res = await fetch('/api/elevation?lat=${result.location.lat}&lon=${result.location.lon}')\nconst { elevation } = await res.json()`,
                        python: `import requests\nres = requests.get("https://openzenith.pages.dev/api/elevation", params={"lat": ${result.location.lat}, "lon": ${result.location.lon}})\nprint(res.json()["elevation"])`,
                      };
                      await navigator.clipboard.writeText(snippets[snippetTab]);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    style={{
                      position: "absolute",
                      top: "0.4rem",
                      right: "0.4rem",
                      background: "none",
                      border: "none",
                      color: textSecondary,
                      cursor: "pointer",
                      fontSize: "0.68rem",
                      padding: "2px 6px",
                      borderRadius: 3,
                    }}
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                  <div
                    style={{
                      background: codeBg,
                      borderRadius: 8,
                      padding: "0.6rem 0.8rem",
                      fontFamily: "monospace",
                      fontSize: "0.75rem",
                      lineHeight: 1.7,
                      overflowX: "auto",
                    }}
                  >
                    {snippetTab === "url" && (
                      <a
                        href={`https://openzenith.pages.dev/api/elevation?lat=${result.location.lat}&lon=${result.location.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: accent, textDecoration: "none", wordBreak: "break-all" }}
                      >
                        https://openzenith.pages.dev/api/elevation?lat={result.location.lat}&amp;lon={result.location.lon}
                      </a>
                    )}
                    {snippetTab === "curl" && (
                      <div>
                        <span style={{ color: accent }}>curl</span>{" "}
                        <span style={{ color: "#98c379" }}>
                          &quot;https://openzenith.pages.dev/api/elevation?lat={result.location.lat}&amp;lon=
                          {result.location.lon}&quot;
                        </span>
                      </div>
                    )}
                    {snippetTab === "js" && (
                      <>
                        <div>
                          <span style={{ color: "#c678dd" }}>const</span> res ={" "}
                          <span style={{ color: textSecondary }}>await</span>{" "}
                          <span style={{ color: "#61afef" }}>fetch</span>(
                          <span style={{ color: "#98c379" }}>
                            &apos;/api/elevation?lat={result.location.lat}&amp;lon={result.location.lon}&apos;
                          </span>
                          )
                        </div>
                        <div>
                          <span style={{ color: "#c678dd" }}>const</span> &#123; elevation &#125; ={" "}
                          <span style={{ color: textSecondary }}>await</span> res.json()
                        </div>
                      </>
                    )}
                    {snippetTab === "python" && (
                      <>
                        <div>
                          <span style={{ color: "#c678dd" }}>import</span> requests
                        </div>
                        <div>
                          res = requests.<span style={{ color: "#61afef" }}>get</span>(
                          <span style={{ color: "#98c379" }}>&quot;https://openzenith.pages.dev/api/elevation&quot;</span>,
                        </div>
                        <div>
                          &nbsp;&nbsp;&nbsp;&nbsp;params=&#123;<span style={{ color: "#98c379" }}>&quot;lat&quot;</span>:{" "}
                          <span style={{ color: "#d19a66" }}>{result.location.lat}</span>,{" "}
                          <span style={{ color: "#98c379" }}>&quot;lon&quot;</span>:{" "}
                          <span style={{ color: "#d19a66" }}>{result.location.lon}</span>&#125;)
                        </div>
                        <div>
                          <span style={{ color: "#c678dd" }}>print</span>(res.json()[
                          <span style={{ color: "#98c379" }}>&quot;elevation&quot;</span>])&nbsp;{" "}
                          <span style={{ color: textSecondary }}># {result.elevation}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
            {!result && !error && (
              <p style={{ margin: 0, fontSize: "0.78rem", color: textSecondary, textAlign: "center" }}>
                Try:{" "}
                {sampleLocations.map((loc, i) => (
                  <span key={loc.name}>
                    <button
                      onClick={() => {
                        setLat(loc.lat);
                        setLon(loc.lon);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: accent,
                        cursor: "pointer",
                        fontSize: "inherit",
                        fontFamily: "inherit",
                        padding: 0,
                      }}
                    >
                      {loc.name}
                    </button>
                    {i < sampleLocations.length - 1 ? " \u00B7 " : ""}
                  </span>
                ))}
                <button
                  onClick={() => setSampleLocations(pickRandomLocations(4))}
                  title="Shuffle locations"
                  aria-label="Refresh locations"
                  style={{
                    background: "none",
                    border: "none",
                    color: textSecondary,
                    cursor: "pointer",
                    fontSize: "0.78rem",
                    padding: "0 0 0 0.3rem",
                    marginLeft: "0.15rem",
                    verticalAlign: "middle",
                    opacity: 0.7,
                    transition: "opacity 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
                >
                  &#x21bb;
                </button>
              </p>
            )}
          </div>
        ) : (
          /* Feature slides 2-5 */
          <div style={{ display: "flex", justifyContent: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            {s.cta && (
              <a
                href={s.cta!.href}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  padding: "0.6rem 1.5rem",
                  borderRadius: 8,
                  background: accent,
                  color: "#000",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                  textDecoration: "none",
                  fontFamily: "inherit",
                }}
              >
                {s.cta.label}
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 01-1.06-1.06l4.25-4.25-4.25-4.25a.75.75 0 010-1.06z" />
                </svg>
              </a>
            )}
          </div>
        )}
        {/* Navigation dots */}
        <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem", marginTop: "1.5rem" }}>
          {HERO_SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              aria-label={`Go to slide ${i + 1}`}
              style={{
                width: slide === i ? 24 : 8,
                height: 8,
                borderRadius: 4,
                border: "none",
                background: slide === i ? s.gradient[0] : dark ? "#333" : "#ccc",
                cursor: "pointer",
                padding: 0,
                transition: "all 0.3s ease",
              }}
            />
          ))}
        </div>
        {/* Prev/Next arrows */}
        <button
          onClick={() => setSlide((slide - 1 + total) % total)}
          aria-label="Previous slide"
          style={{
            position: "absolute",
            left: "1rem",
            top: "50%",
            transform: "translateY(-50%)",
            background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
            border: `1px solid ${dark ? "#333" : "#ddd"}`,
            borderRadius: 8,
            color: textSecondary,
            cursor: "pointer",
            padding: "0.5rem",
            fontSize: "1.2rem",
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.5,
            transition: "opacity 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
        >
          &#x2039;
        </button>
        <button
          onClick={() => setSlide((slide + 1) % total)}
          aria-label="Next slide"
          style={{
            position: "absolute",
            right: "1rem",
            top: "50%",
            transform: "translateY(-50%)",
            background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
            border: `1px solid ${dark ? "#333" : "#ddd"}`,
            borderRadius: 8,
            color: textSecondary,
            cursor: "pointer",
            padding: "0.5rem",
            fontSize: "1.2rem",
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.5,
            transition: "opacity 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
        >
          &#x203A;
        </button>
      </div>
    </section>
  );
}

/* ─── Main Page ─── */

export default function Home() {
  const dark = useTheme();
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [sampleLocations, setSampleLocations] = useState(() => pickRandomLocations(4));
  const [result, setResult] = useState<{
    elevation: number | null;
    unit: string;
    srtmTile: string;
    source: string;
    resolution: number;
    location: { lat: number; lon: number };
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mapLoading, setMapLoading] = useState(true);
  const [showTop, setShowTop] = useState(false);
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [snippetTab, setSnippetTab] = useState<"url" | "curl" | "js" | "python">("url");
  const [copied, setCopied] = useState(false);
  const [elevCopied, setElevCopied] = useState(false);
  const [slide, setSlide] = useState(0);
  const miniMapRef = useRef<HTMLDivElement>(null);
  const miniMapInstance = useRef<any>(null);

  const bg = dark ? "#0a0a0a" : "#fafafa";
  const cardBg = dark ? "#161616" : "#ffffff";
  const border = dark ? "#222" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSecondary = dark ? "#888" : "#737373";
  const accent = "#22c55e";
  const accentDim = dark ? "rgba(34,197,94,0.12)" : "#dcfce7";
  const codeBg = dark ? "#1a1a1a" : "#f5f5f5";
  const inputBg = dark ? "#111" : "#fff";
  const W = 1400;

  // Back-to-top scroll listener
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 500);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = useCallback(() => window.scrollTo({ top: 0, behavior: "smooth" }), []);

  // Init mini map
  useEffect(() => {
    if (!miniMapRef.current || miniMapInstance.current) return;
    let cancelled = false;
    (async () => {
      try {
        const mlgl = await waitForMapLibre();
        if (cancelled || !miniMapRef.current) return;

        const map = new mlgl.Map({
          container: miniMapRef.current,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"],
                tileSize: 256,
                attribution: "&copy; CartoDB",
              },
            },
            layers: [{ id: "osm", type: "raster", source: "osm" }],
            glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
          },
          center: [0, 25],
          zoom: 1.5,
          interactive: false,
          attributionControl: false,
        });

        map.on("load", () => {
          if (cancelled) return;
          mlgl.addProtocol("elevation", async (params: any, callback: any) => {
            const { z, x, y } = params;
            try {
              const res = await fetch(`/api/tile/${z}/${x}/${y}`);
              if (!res.ok) {
                callback(null, null, null);
                return { cancel: () => {} };
              }
              const buffer = await res.arrayBuffer();
              const int16 = new Int16Array(buffer);
              const terrarium = elevationToTerrarium(int16);
              const canvas = document.createElement("canvas");
              canvas.width = 256;
              canvas.height = 256;
              const ctx = canvas.getContext("2d")!;
              const img = ctx.createImageData(256, 256);
              img.data.set(terrarium);
              ctx.putImageData(img, 0, 0);
              canvas.toBlob((blob: Blob | null) => {
                if (blob) callback(null, blob, null, null);
                else callback(new Error("Tile error"));
              }, "image/png");
              return { cancel: () => {} };
            } catch (err) {
              callback(err);
              return { cancel: () => {} };
            }
          });

          map.addSource("elevation", {
            type: "raster-dem",
            tiles: ["elevation://{z}/{x}/{y}"],
            tileSize: 256,
            maxzoom: 6,
            encoding: "terrarium",
          });
          map.addLayer(
            {
              id: "hillshade",
              type: "hillshade",
              source: "elevation",
              paint: {
                "hillshade-shadow-color": "#000",
                "hillshade-highlight-color": "#fff",
                "hillshade-exaggeration": 0.4,
                "hillshade-direction": 315,
              },
            },
            "osm",
          );
          setMapLoading(false);
        });

        miniMapInstance.current = map;
      } catch {
        setMapLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (miniMapInstance.current) {
        miniMapInstance.current.remove();
        miniMapInstance.current = null;
      }
    };
  }, []);

  async function lookup() {
    const la = parseFloat(lat);
    const lo = parseFloat(lon);
    if (isNaN(la) || isNaN(lo)) {
      setError("Enter valid coordinates");
      return;
    }
    if (la < -60 || la > 60 || lo < -180 || lo > 180) {
      setError("Out of SRTM coverage (lat -60 to 60)");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/elevation?lat=${la}&lon=${lo}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setResult(null);
      } else {
        setResult(data);
      }
    } catch {
      setError("Failed to fetch elevation data");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: "0.55rem 0.75rem",
    fontSize: "0.9rem",
    borderRadius: 6,
    border: `1px solid ${border}`,
    background: inputBg,
    color: text,
    outline: "none",
    fontFamily: "inherit",
    minWidth: 0,
  };

  return (
    <div style={{ background: bg, color: text, minHeight: "100vh", fontFamily: "inherit" }}>
      <Navbar dark={dark} />

      {/* Hero Slideshow */}
      <HeroSlideshow
        dark={dark}
        slide={slide}
        setSlide={setSlide}
        // Props passed through for slide 1 (elevation lookup)
        lat={lat}
        setLat={setLat}
        lon={lon}
        setLon={setLon}
        loading={loading}
        lookup={lookup}
        error={error}
        result={result}
        snippetTab={snippetTab}
        setSnippetTab={setSnippetTab}
        copied={copied}
        setCopied={setCopied}
        elevCopied={elevCopied}
        setElevCopied={setElevCopied}
        sampleLocations={sampleLocations}
        setSampleLocations={setSampleLocations}
        pickRandomLocations={pickRandomLocations}
        inputStyle={inputStyle}
        codeBg={codeBg}
        cardBg={cardBg}
        border={border}
        text={text}
        textSecondary={textSecondary}
        accent={accent}
        accentDim={accentDim}
        W={W}
      />

      {/* Mini map */}
      <section style={{ maxWidth: W, margin: "0 auto", padding: "0 1.5rem 2rem" }}>
        <div
          style={{
            position: "relative",
            borderRadius: 12,
            overflow: "hidden",
            border: `1px solid ${border}`,
            height: 340,
          }}
        >
          <div ref={miniMapRef} style={{ width: "100%", height: "100%" }} />
          {mapLoading && (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%,-50%)",
                background: "rgba(0,0,0,0.7)",
                color: "#22c55e",
                padding: "0.5rem 1rem",
                borderRadius: 6,
                fontSize: "0.85rem",
              }}
            >
              Loading elevation map...
            </div>
          )}
          <a
            href="/map"
            style={{
              position: "absolute",
              bottom: "0.75rem",
              right: "0.75rem",
              background: "rgba(0,0,0,0.7)",
              color: "#ccc",
              padding: "0.4rem 0.8rem",
              borderRadius: 6,
              fontSize: "0.8rem",
              textDecoration: "none",
              border: "1px solid #333",
              backdropFilter: "blur(8px)",
            }}
          >
            Open Full Map &rarr;
          </a>
        </div>
      </section>

      {/* Stats */}
      <section style={{ maxWidth: W, margin: "0 auto", padding: "0 1.5rem 2rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "0.75rem" }}>
          {[
            {
              label: "SRTM tiles",
              value: "14,296",
              tip: "14,296 one-degree tiles covering all land between 60\u00b0N and 60\u00b0S. Each tile is a 3601\u00d73601 pixel GeoTIFF from NASA\u2019s Shuttle Radar Topography Mission.",
            },
            {
              label: "Data chunks",
              value: "3.2M",
              tip: "Each 3601\u00d73601 SRTM tile is split into 256\u00d7256 chunks (15\u00d715 = 225 per tile). Chunks are compressed and served on demand for efficiency.",
            },
            {
              label: "Resolution",
              value: "~30m",
              tip: "1 arc-second resolution means each pixel represents ~30\u00d730 meters on the ground. Bilinear interpolation provides sub-pixel accuracy for point queries.",
            },
            {
              label: "Land coverage",
              value: "80%",
              tip: "SRTM covers 80% of Earth\u2019s landmass between 60\u00b0N and 60\u00b0S. Polar regions and some small islands are excluded.",
            },
            {
              label: "World coverage",
              value: "~29%",
              tip: "Land (80%) covers ~29% of Earth\u2019s total surface. Ocean bathymetry and waterway elevations are planned for future coverage.",
            },
            {
              label: "Lat range",
              value: "60\u00b0N\u201360\u00b0S",
              tip: "SRTM coverage spans from 60\u00b0N to 60\u00b0S latitude. That\u2019s roughly 120\u00b0 out of 180\u00b0 of latitude. No data for polar ice caps.",
            },
            {
              label: "API endpoints",
              value: "8",
              tip: "Elevation, tiles, health, flights, weather warnings, overpass, proxy, and ArcGIS discovery. All documented in the OpenAPI 3.0 spec at /api/docs.",
            },
            {
              label: "Data layers",
              value: "12+",
              tip: "WorldView integrates 12+ real-time data layers including earthquakes, radar, flights, military ADS-B, vessels, weather warnings, satellites, hurricanes, and more.",
            },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                background: cardBg,
                border: `1px solid ${border}`,
                borderRadius: 10,
                padding: "0.75rem 1rem",
                textAlign: "center",
                position: "relative",
              }}
            >
              <div style={{ fontSize: "1.3rem", fontWeight: 700, color: accent, marginBottom: "0.15rem" }}>
                {s.value}
              </div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: textSecondary,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.2rem",
                }}
              >
                {s.label}
                <span
                  onMouseEnter={(e) => {
                    setTooltip(s.tip);
                    (e.target as HTMLElement).style.cursor = "help";
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    border: `1px solid ${border}`,
                    fontSize: "0.6rem",
                    color: textSecondary,
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  &#63;
                </span>
              </div>
              {tooltip === s.tip && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 8px)",
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: dark ? "#222" : "#1a1a1a",
                    color: "#e5e5e5",
                    padding: "0.5rem 0.7rem",
                    borderRadius: 8,
                    fontSize: "0.72rem",
                    lineHeight: 1.5,
                    width: 220,
                    zIndex: 10,
                    boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                    whiteSpace: "normal",
                  }}
                >
                  {s.tip}
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: "50%",
                      transform: "translateX(-50%)",
                      border: "5px solid transparent",
                      borderTopColor: dark ? "#222" : "#1a1a1a",
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section
        style={{
          maxWidth: W,
          margin: "0 auto",
          padding: "0 1.5rem 1.5rem",
          borderTop: `1px solid ${dark ? "#1a1a1a" : "#f0f0f0"}`,
          paddingTop: "2rem",
        }}
      >
        <h2 style={{ fontSize: "1.2rem", fontWeight: 600, margin: "0 0 0.4rem", textAlign: "center" }}>Features</h2>
        <p style={{ fontSize: "0.85rem", color: textSecondary, margin: "0 0 1.25rem", textAlign: "center" }}>
          Core API &amp; Map Tools
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.75rem" }}>
          {[
            {
              emoji: "\u26F0\uFE0F",
              title: "Elevation API",
              desc: "Query elevation by lat/lon. Returns height in meters with bilinear interpolation and SRTM tile metadata.",
              back: "NASA SRTM 30m resolution with bilinear interpolation. Returns elevation, unit, source tile, and resolution metadata.",
              href: "/api/docs",
              btn: "View API Docs",
            },
            {
              emoji: "\uD83D\uDDFA\uFE0F",
              title: "Tile Server",
              desc: "Slippy map tiles (z/x/y) serving raw Int16 elevation data. Terrarium encoding for MapLibre GL hillshade.",
              back: "256\u00d7256 Int16 tiles at zoom 0\u201315. Terrarium encoding compatible with MapLibre GL raster-dem sources.",
              href: "/map",
              btn: "Open Map",
            },
            {
              emoji: "\uD83D\uDDFA\uFE0F",
              title: "Interactive Map",
              desc: "MapLibre GL dark theme, 3D terrain, 5 basemaps, elevation pins, context menu, elevation profile.",
              back: "Click any point for elevation. Drag to draw profile. Right-click context menu with copy coordinates and tile info.",
              href: "/map",
              btn: "Open Map",
            },
            {
              emoji: "\uD83C\uDF0D",
              title: "WorldView 3D Globe",
              desc: "CesiumJS 3D globe with 3D/Columbus/2D view modes, 5 themes, and 12+ real-time data layers.",
              back: "Switch between 3D globe, Columbus 3D, and 2D map. Five built-in themes from Dark to Classified Intel HUD.",
              href: "/worldview",
              btn: "Launch WorldView",
            },
            {
              emoji: "\u2708\uFE0F",
              title: "Flight Tracking",
              desc: "OpenSky ADS-B live flights plus military aircraft via ADS-B Exchange. Altitudes, callsigns, speeds.",
              back: "Real-time positions from OpenSky Network. Military and unfiltered aircraft from ADS-B Exchange. Auto-refresh.",
              href: "/worldview",
              btn: "Track Flights",
            },
            {
              emoji: "\uD83D\uDD0D",
              title: "Data Explorer",
              desc: "Discover ArcGIS REST services and query OpenStreetMap via Overpass API. Built-in query builder.",
              back: "ArcGIS service discovery with layer metadata. Overpass QL query builder with syntax help and examples.",
              href: "/explore",
              btn: "Explore Data",
            },
            {
              emoji: "\uD83D\uDD17",
              title: "CORS Proxy",
              desc: "Universal CORS proxy for external geospatial APIs. Pass any allowed URL and get proxied JSON.",
              back: "10s timeout, 30s cache. Supports USGS, NWS, OpenSky, Overpass, and custom whitelisted domains.",
              href: "/api/docs",
              btn: "View Proxy Docs",
            },
            {
              emoji: "\u26C8\uFE0F",
              title: "Weather Data",
              desc: "NWS warnings with polygon boundaries, NOAA NEXRAD radar mosaic, and hurricane track history.",
              back: "Color-coded NWS watches/warnings/advisories. Live radar mosaic. IBTrACS hurricane history with tracks.",
              href: "/worldview",
              btn: "View Weather",
            },
            {
              emoji: "\uD83D\uDEF0\uFE0F",
              title: "Satellite Tracking",
              desc: "3,000+ active satellites from Celestrak TLE data, propagated to real-time positions using satellite.js.",
              back: "Real-time orbital propagation from TLE elements. Visible, communication, navigation, and more satellite groups.",
              href: "/worldview",
              btn: "Track Satellites",
            },
            {
              emoji: "\uD83D\uDD13",
              title: "No Authentication",
              desc: "Completely free. No API keys, no rate limits, no sign-up required. Just query and go.",
              back: "Zero friction. No accounts, no tokens, no billing. Every endpoint is open and free to use.",
              href: "https://github.com/aliasfoxkde/OpenZenith",
              btn: "View on GitHub",
            },
            {
              emoji: "\uD83D\uDCD6",
              title: "OpenAPI Spec",
              desc: "Full OpenAPI 3.0.3 documentation with interactive try-it panel, editable parameters, and code examples.",
              back: "Interactive docs with editable params and live Try-It. Code examples in cURL, JavaScript, and Python.",
              href: "/api/docs",
              btn: "Read the Docs",
            },
            {
              emoji: "\uD83D\uDEE0\uFE0F",
              title: "Self-Hostable",
              desc: "Deploy anywhere with Next.js + Cloudflare Pages. Data stored on HuggingFace or your own backend.",
              back: "Open source MIT license. Next.js 14 edge runtime. HuggingFace or custom chunk backend. One-click deploy.",
              href: "https://github.com/aliasfoxkde/OpenZenith",
              btn: "Get Source",
            },
          ].map((f) => (
            <FlipCard
              key={f.title}
              dark={dark}
              cardBg={cardBg}
              border={border}
              text={text}
              textSecondary={textSecondary}
              accent={accent}
              accentDim={accentDim}
              minHeight={150}
              front={
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.5rem" }}>
                    <div style={{ fontSize: "1.5rem" }}>{f.emoji}</div>
                    <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>{f.title}</h3>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.8rem", color: textSecondary, lineHeight: 1.45 }}>{f.desc}</p>
                </>
              }
              back={
                <>
                  <div style={{ fontSize: "0.82rem", color: textSecondary, lineHeight: 1.55, marginBottom: "0.85rem" }}>
                    {f.back}
                  </div>
                  <a
                    href={f.href}
                    target={f.href.startsWith("http") ? "_blank" : undefined}
                    rel={f.href.startsWith("http") ? "noopener noreferrer" : undefined}
                    style={{
                      display: "inline-block",
                      padding: "0.4rem 1rem",
                      borderRadius: 6,
                      background: accent,
                      color: "#000",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      textDecoration: "none",
                      textAlign: "center",
                    }}
                  >
                    {f.btn}
                  </a>
                </>
              }
            />
          ))}
        </div>
      </section>

      {/* Data Layers */}
      <section style={{ maxWidth: W, margin: "0 auto", padding: "0 1.5rem 1.5rem" }}>
        <p style={{ fontSize: "0.85rem", color: textSecondary, margin: "0 0 1.25rem", textAlign: "center" }}>
          WorldView Data Layers
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.75rem" }}>
          {[
            {
              emoji: "\uD83D\uDD27",
              title: "Earthquakes",
              desc: "USGS real-time seismic data with magnitude, depth, and event details.",
              back: "Auto-refreshes every 60s. Color-coded by magnitude. Click for event details including depth and location.",
              color: "#ef4444",
            },
            {
              emoji: "\uD83C\uDF27\uFE0F",
              title: "Weather Radar",
              desc: "RainViewer NEXRAD radar mosaic with precipitation intensity overlays.",
              back: "Live NEXRAD composite radar with transparency. Zoom-dependent tile resolution for performance.",
              color: "#3b82f6",
            },
            {
              emoji: "\u2708\uFE0F",
              title: "Flight Tracking",
              desc: "OpenSky ADS-B live aircraft positions, altitudes, call signs.",
              back: "15-second refresh cycle. Shows altitude, speed, heading, callsign. Hover for flight details.",
              color: "#f59e0b",
            },
            {
              emoji: "\uD83D\uDEE1\uFE0F",
              title: "Military Flights",
              desc: "ADS-B Exchange unfiltered aircraft data. Military, government, private.",
              back: "Includes military, government, and private aircraft not visible on commercial trackers.",
              color: "#ec4899",
            },
            {
              emoji: "\uD83D\uDEA2",
              title: "Vessel Tracking",
              desc: "AIS vessel positions and marine weather data from Open-Meteo API.",
              back: "Marine vessel positions from AIS data. Wave height, wind speed, and temperature overlays.",
              color: "#3b82f6",
            },
            {
              emoji: "\u26A0\uFE0F",
              title: "Weather Warnings",
              desc: "NWS watches, warnings, and advisories with polygon boundaries.",
              back: "Color-coded by severity. Polygon boundaries from NOAA via ArcGIS. US-only coverage.",
              color: "#a855f7",
            },
            {
              emoji: "\uD83C\uDF0B",
              title: "Natural Events",
              desc: "NASA EONET events: volcanoes, wildfires, icebergs, landslides.",
              back: "Volcanoes, wildfires, icebergs, landslides, floods, droughts, and more from NASA Earth Observatory.",
              color: "#f97316",
            },
            {
              emoji: "\uD83D\uDEF0\uFE0F",
              title: "Satellites",
              desc: "3,000+ active satellites from Celestrak. Real-time orbital positions.",
              back: "SGP4 propagation via satellite.js. Grouped by type: visible, communication, navigation, science.",
              color: "#06b6d4",
            },
            {
              emoji: "\uD83C\uDF2A\uFE0F",
              title: "Hurricanes",
              desc: "IBTrACS tropical cyclone tracks with category-based color coding.",
              back: "Historical and active tropical cyclone tracks. Category 1\u20135 color coding with wind speed data.",
              color: "#ff6600",
            },
            {
              emoji: "\u26F0\uFE0F",
              title: "Hillshade & 3D",
              desc: "Terrain hillshade rendering with SRTM elevation data and 3D globe.",
              back: "Client-side hillshade from our elevation tiles. 3D terrain extrusion on the CesiumJS globe.",
              color: "#22c55e",
            },
            {
              emoji: "\uD83C\uDFA8",
              title: "Elevation Color",
              desc: "Color-coded elevation grid sampled from the SRTM API.",
              back: "Low-to-high gradient from deep green through yellow to brown and white for peaks.",
              color: "#8b5cf6",
            },
            {
              emoji: "\uD83D\uDCF8",
              title: "NASA Satellite",
              desc: "MODIS Terra true-color imagery from NASA GIBS. Global daily coverage.",
              back: "Daily true-color composite from MODIS Terra satellite. Global coverage via NASA GIBS tiles.",
              color: "#0ea5e9",
            },
          ].map((d) => (
            <FlipCard
              key={d.title}
              dark={dark}
              cardBg={cardBg}
              border={border}
              text={text}
              textSecondary={textSecondary}
              accent={accent}
              accentDim={accentDim}
              minHeight={130}
              front={
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                    <div style={{ fontSize: "1.3rem" }}>{d.emoji}</div>
                    <h3 style={{ margin: 0, fontSize: "0.88rem", fontWeight: 600 }}>{d.title}</h3>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: textSecondary, lineHeight: 1.4 }}>{d.desc}</p>
                </>
              }
              back={
                <>
                  <div style={{ fontSize: "0.78rem", color: textSecondary, lineHeight: 1.5, marginBottom: "0.75rem" }}>
                    {d.back}
                  </div>
                  <a
                    href="/worldview"
                    style={{
                      display: "inline-block",
                      padding: "0.35rem 0.85rem",
                      borderRadius: 6,
                      background: d.color,
                      color: "#fff",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      textDecoration: "none",
                      textAlign: "center",
                    }}
                  >
                    View on Globe
                  </a>
                </>
              }
            />
          ))}
        </div>
      </section>

      {/* Contribute & Integrations */}
      <section style={{ maxWidth: W, margin: "0 auto", padding: "0 1.5rem 2rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.75rem" }}>
          <FlipCard
            key="contribute"
            dark={dark}
            cardBg={cardBg}
            border={border}
            text={text}
            textSecondary={textSecondary}
            accent={accent}
            accentDim={accentDim}
            minHeight={120}
            front={
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
                  <div style={{ fontSize: "1.5rem" }}>\uD83D\uDCE4</div>
                  <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Contribute Data</h3>
                </div>
                <p style={{ margin: 0, fontSize: "0.82rem", color: textSecondary, lineHeight: 1.5 }}>
                  Add your own geospatial data to OpenZenith. Upload files, integrate data sources, or submit pull
                  requests. Supports GeoJSON, GeoTIFF, CSV, and more.
                </p>
              </>
            }
            back={
              <>
                <div style={{ fontSize: "0.82rem", color: textSecondary, lineHeight: 1.55, marginBottom: "0.85rem" }}>
                  Submit data via the contribute page, open a GitHub issue, or send a pull request. We support GeoJSON,
                  GeoTIFF, CSV, Shapefile, and custom formats.
                </div>
                <a
                  href="/contribute"
                  style={{
                    display: "inline-block",
                    padding: "0.4rem 1rem",
                    borderRadius: 6,
                    background: accent,
                    color: "#000",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    textDecoration: "none",
                    textAlign: "center",
                  }}
                >
                  Contribute Now
                </a>
              </>
            }
          />
          <FlipCard
            key="integrations"
            dark={dark}
            cardBg={cardBg}
            border={border}
            text={text}
            textSecondary={textSecondary}
            accent={accent}
            accentDim={accentDim}
            minHeight={120}
            front={
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
                  <div style={{ fontSize: "1.5rem" }}>\uD83D\uDD27</div>
                  <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Integrations &amp; Tools</h3>
                </div>
                <p style={{ margin: 0, fontSize: "0.82rem", color: textSecondary, lineHeight: 1.5 }}>
                  OpenAPI spec, CORS proxy, MapLibre GL elevation tiles, and Overpass API proxy. Integrate elevation
                  into your own maps and apps in minutes.
                </p>
              </>
            }
            back={
              <>
                <div style={{ fontSize: "0.82rem", color: textSecondary, lineHeight: 1.55, marginBottom: "0.85rem" }}>
                  MapLibre GL JS, Leaflet, deck.gl, CesiumJS &mdash; any map library works with our Terrarium-encoded
                  tiles. Full OpenAPI spec for programmatic access.
                </div>
                <a
                  href="/api/docs"
                  style={{
                    display: "inline-block",
                    padding: "0.4rem 1rem",
                    borderRadius: 6,
                    background: "#a855f7",
                    color: "#fff",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    textDecoration: "none",
                    textAlign: "center",
                  }}
                >
                  View API Docs
                </a>
              </>
            }
          />
        </div>
      </section>

      {/* Community */}
      <section
        id="community"
        style={{
          maxWidth: W,
          margin: "0 auto",
          padding: "0 1.5rem 2rem",
          borderTop: `1px solid ${dark ? "#1a1a1a" : "#f0f0f0"}`,
          paddingTop: "2rem",
        }}
      >
        <h2 style={{ fontSize: "1.2rem", fontWeight: 600, margin: "0 0 0.4rem", textAlign: "center" }}>Community</h2>
        <p style={{ fontSize: "0.85rem", color: textSecondary, margin: "0 0 1.25rem", textAlign: "center" }}>
          Share your tools, maps, and projects
        </p>
        <div
          style={{
            background: cardBg,
            border: `1px solid ${border}`,
            borderRadius: 14,
            padding: "2rem 2.5rem",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              background: `linear-gradient(90deg, #22c55e, #3b82f6, #f59e0b)`,
            }}
          />
          <p
            style={{
              fontSize: "0.92rem",
              color: textSecondary,
              maxWidth: 680,
              margin: "0 auto 1.75rem",
              textAlign: "center",
              lineHeight: 1.65,
            }}
          >
            Built something with OpenZenith? We want to see it. Whether it's a custom map visualization, a mobile app, a
            research tool, or an integration with another platform &mdash; share it with the community.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
              marginBottom: "1.75rem",
            }}
          >
            {[
              {
                icon: "\uD83D\uDDFA\uFE0F",
                title: "Maps & Visualizations",
                desc: "Custom web maps, dashboards, terrain renderings, 3D flythroughs, or any visual project using our elevation or tile data.",
              },
              {
                icon: "\uD83D\uDCF1",
                title: "Apps & Integrations",
                desc: "Mobile apps, desktop tools, CLI utilities, or plugins that query the API or display elevation data.",
              },
              {
                icon: "\uD83D\uDCCA",
                title: "Research & Analysis",
                desc: "Scientific papers, environmental studies, geology surveys, or academic projects leveraging the dataset.",
              },
              {
                icon: "\uD83D\uDC68\u200D\uD83C\uDFA8",
                title: "Tutorials & Guides",
                desc: "Blog posts, YouTube videos, notebooks, or documentation that helps others use OpenZenith.",
              },
            ].map((item) => (
              <div key={item.title} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: accentDim,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.1rem",
                    flexShrink: 0,
                  }}
                >
                  {item.icon}
                </div>
                <div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.1rem" }}>{item.title}</div>
                  <div style={{ fontSize: "0.8rem", color: textSecondary, lineHeight: 1.45 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
            <a
              href="https://github.com/aliasfoxkde/OpenZenith/discussions"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.6rem 1.4rem",
                borderRadius: 8,
                background: cardBg,
                color: text,
                textDecoration: "none",
                fontSize: "0.85rem",
                fontWeight: 500,
                border: `1px solid ${border}`,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Share on GitHub
            </a>
            <a
              href="https://github.com/aliasfoxkde/OpenZenith/issues"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.6rem 1.4rem",
                borderRadius: 8,
                background: accent,
                color: "#000",
                textDecoration: "none",
                fontSize: "0.85rem",
                fontWeight: 600,
              }}
            >
              Submit an Issue
            </a>
          </div>
        </div>
      </section>

      {/* API Quickstart */}
      <section
        style={{
          maxWidth: W,
          margin: "0 auto",
          padding: "0 1.5rem 2rem",
          borderTop: `1px solid ${dark ? "#1a1a1a" : "#f0f0f0"}`,
          paddingTop: "2rem",
        }}
      >
        <h2 style={{ fontSize: "1.2rem", fontWeight: 600, margin: "0 0 1.25rem", textAlign: "center" }}>Quick start</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div
            style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.25rem 1.5rem" }}
          >
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>Elevation lookup</div>
            <CodeBlock
              dark={dark}
              code={`GET /api/elevation?lat={lat}&lon={lon}\n\n# Mount Everest\ncurl "https://openzenith.pages.dev/api/elevation?lat=28.0&lon=86.9"\n\n{"elevation": 8848, "unit": "meters", "srtmTile": "N28E086.tif"}`}
            >
              <div>
                <span style={{ color: accent }}>GET</span>{" "}
                <span style={{ color: textSecondary }}>/api/elevation?lat=&#123;lat&#125;&amp;lon=&#123;lon&#125;</span>
              </div>
              <div style={{ marginTop: "0.3rem" }}>
                <span style={{ color: textSecondary }}># Mount Everest</span>
              </div>
              <div>
                <span style={{ color: accent }}>curl</span>{" "}
                <span style={{ color: text }}>"https://openzenith.pages.dev/api/elevation?lat=28.0&amp;lon=86.9"</span>
              </div>
              <div
                style={{ marginTop: "0.3rem" }}
              >{`{"elevation": 8848, "unit": "meters", "srtmTile": "N28E086.tif"}`}</div>
            </CodeBlock>
          </div>
          <div
            style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.25rem 1.5rem" }}
          >
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>JavaScript</div>
            <CodeBlock
              dark={dark}
              code={`const res = await fetch('/api/elevation?lat=48.8566&lon=2.3522')\nconst { elevation } = await res.json()`}
            >
              <div>
                <span style={{ color: "#c678dd" }}>const</span> res ={" "}
                <span style={{ color: textSecondary }}>await</span> <span style={{ color: "#61afef" }}>fetch</span>(
                <span style={{ color: "#98c379" }}>'/api/elevation?lat=48.8566&amp;lon=2.3522'</span>)
              </div>
              <div>
                <span style={{ color: "#c678dd" }}>const</span> &#123; elevation &#125; ={" "}
                <span style={{ color: textSecondary }}>await</span> res.json()
              </div>
            </CodeBlock>
          </div>
          <div
            style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.25rem 1.5rem" }}
          >
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>Python</div>
            <CodeBlock
              dark={dark}
              code={`import requests\n\nres = requests.get(\n    "https://openzenith.pages.dev/api/elevation",\n    params={"lat": 48.8566, "lon": 2.3522})\ndata = res.json()\nprint(data["elevation"])  # 35`}
            >
              <div>
                <span style={{ color: "#c678dd" }}>import</span> requests
              </div>
              <div style={{ marginTop: "0.3rem" }}>
                res = requests.<span style={{ color: "#61afef" }}>get</span>(
                <span style={{ color: "#98c379" }}>"https://openzenith.pages.dev/api/elevation"</span>,
              </div>
              <div>
                &nbsp;&nbsp;&nbsp;&nbsp;params=&#123;<span style={{ color: "#98c379" }}>"lat"</span>:{" "}
                <span style={{ color: "#d19a66" }}>48.8566</span>, <span style={{ color: "#98c379" }}>"lon"</span>:{" "}
                <span style={{ color: "#d19a66" }}>2.3522</span>&#125;)
              </div>
              <div>data = res.json()</div>
              <div>
                <span style={{ color: "#c678dd" }}>print</span>(data[
                <span style={{ color: "#98c379" }}>"elevation"</span>])&nbsp;{" "}
                <span style={{ color: textSecondary }}># 35</span>
              </div>
            </CodeBlock>
          </div>
        </div>
      </section>

      {/* Contact Form */}
      <GetInTouch dark={dark} />

      {/* Back to top */}
      {showTop && (
        <button
          onClick={scrollToTop}
          aria-label="Back to top"
          style={{
            position: "fixed",
            bottom: "1.5rem",
            right: "1.5rem",
            zIndex: 200,
            width: 40,
            height: 40,
            borderRadius: 10,
            background: cardBg,
            border: `1px solid ${border}`,
            color: text,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
            transition: "opacity 0.2s",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M8 12V4M4 7l4-4 4 4" />
          </svg>
        </button>
      )}

      {/* Support / Donate */}
      <section
        style={{
          maxWidth: W,
          margin: "0 auto",
          padding: "2.5rem 1.5rem",
          borderTop: `1px solid ${dark ? "#1a1a1a" : "#f0f0f0"}`,
        }}
      >
        <div
          style={{
            background: cardBg,
            border: `1px solid ${border}`,
            borderRadius: 14,
            padding: "2rem 2.5rem",
            textAlign: "center",
            position: "relative",
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
              background: `linear-gradient(90deg, ${accent}, #3b82f6, #a855f7, ${accent})`,
            }}
          />
          <h2 style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0 0 0.5rem", letterSpacing: "-0.02em" }}>
            Help us push further
          </h2>
          <p
            style={{
              fontSize: "0.95rem",
              color: textSecondary,
              maxWidth: 600,
              margin: "0 auto 1.5rem",
              lineHeight: 1.65,
            }}
          >
            OpenZenith runs entirely client-side on Cloudflare's free tier &mdash; no servers, no databases, no monthly
            costs. That keeps it free for everyone, but it also means we're limited to what a browser can do.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "1rem",
              maxWidth: 720,
              margin: "0 auto 2rem",
              textAlign: "left",
            }}
          >
            {[
              {
                icon: "D",
                title: "Dedicated Hardware",
                desc: "Run heavy data processing (viewshed analysis, water flow simulation, slope computation) on a real GPU server instead of trying to do it in your browser tab.",
              },
              {
                icon: "S",
                title: "Self-Hosted Services",
                desc: "Deploy our own ADS-B receiver, AIS antenna, and weather stations for live, local data that doesn't depend on third-party rate limits.",
              },
              {
                icon: "M",
                title: "Mapping Tools",
                desc: "Build proper elevation profiling, contour generation, flood simulation, and terrain analysis tools that go beyond what edge functions can handle.",
              },
              {
                icon: "F",
                title: "Further Development",
                desc: "Time to build the cool stuff: 3D terrain flythroughs, real-time hurricane spaghetti models, vessel tracking, and all the features we have planned.",
              },
            ].map((item) => (
              <div key={item.title} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: accentDim,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: accent,
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {item.icon}
                </div>
                <div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.15rem" }}>{item.title}</div>
                  <div style={{ fontSize: "0.78rem", color: textSecondary, lineHeight: 1.45 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: "0.8rem", color: textSecondary, marginBottom: "1.25rem", lineHeight: 1.5 }}>
            Every contribution directly funds hardware, data processing, and new features. No middlemen, no platform
            fees &mdash; just geospatial tools that keep getting better.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
            <a
              href="https://github.com/sponsors/aliasfoxkde"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.6rem 1.4rem",
                borderRadius: 8,
                background: "#000",
                color: "#fff",
                textDecoration: "none",
                fontSize: "0.85rem",
                fontWeight: 500,
                border: dark ? "1px solid #333" : "1px solid #ddd",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Sponsor on GitHub
            </a>
            <a
              href="https://ko-fi.com/aliasfoxkde"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.6rem 1.4rem",
                borderRadius: 8,
                background: "#ff5e5b",
                color: "#fff",
                textDecoration: "none",
                fontSize: "0.85rem",
                fontWeight: 500,
              }}
            >
              Ko-fi
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <Footer dark={dark} />
    </div>
  );
}
