/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { safeCopy } from "../helpers";
import { getClientElevation } from "@/lib/client-elevation";
import type { ToolMode } from "../tools/tools";

/* ─── Sub-components ───────────────────────────────────── */

export function CtxDivider() {
  return <div style={{ height: 1, background: "var(--border)", margin: "4px 8px" }} />;
}

export function CtxSection({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "2px 0" }}>{children}</div>;
}

interface CtxMenuItemProps {
  label: string;
  icon?: string;
  accent?: boolean;
  color?: string;
  shortcut?: string;
  onClick: () => void;
}

export function CtxMenuItem({ label, icon, accent, color, shortcut, onClick }: CtxMenuItemProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "5px 12px",
        border: "none",
        background: "transparent",
        color: accent ? "var(--accent)" : color || "var(--text)",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        fontSize: "12px",
        borderRadius: 4,
        transition: "background .1s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {icon && <span style={{ width: 16, textAlign: "center", fontSize: "13px", flexShrink: 0 }}>{icon}</span>}
      <span style={{ flex: 1 }}>{label}</span>
      {shortcut && (
        <span style={{ fontSize: "9px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{shortcut}</span>
      )}
    </button>
  );
}

interface CtxSubMenuProps {
  label: string;
  icon?: string;
  children: React.ReactNode;
  expandedGroup: string | null;
  onToggle: (label: string) => void;
}

export function CtxSubMenu({ label, icon, children, expandedGroup, onToggle }: CtxSubMenuProps) {
  const isOpen = expandedGroup === label;
  return (
    <>
      <button
        onClick={() => onToggle(isOpen ? "" : label)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "5px 12px",
          border: "none",
          background: "transparent",
          color: "var(--text)",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
          fontSize: "12px",
          borderRadius: 4,
          transition: "background .1s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        {icon && <span style={{ width: 16, textAlign: "center", fontSize: "13px", flexShrink: 0 }}>{icon}</span>}
        <span style={{ flex: 1 }}>{label}</span>
        <span
          style={{
            fontSize: "9px",
            transition: "transform 0.2s",
            transform: isOpen ? "rotate(90deg)" : "rotate(0)",
            display: "inline-block",
            color: "var(--text-muted)",
          }}
        >
          &#9654;
        </span>
      </button>
      {isOpen && (
        <div style={{ paddingLeft: 16, borderLeft: "1px solid var(--border)", margin: "1px 0 1px 12px" }}>
          {children}
        </div>
      )}
    </>
  );
}

/* ─── Section header ──────────────────────────────────── */

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "2px 12px 1px",
        fontSize: "9px",
        color: "var(--text-muted)",
        fontWeight: 700,
        letterSpacing: "1px",
        fontFamily: "var(--font-mono)",
      }}
    >
      {label}
    </div>
  );
}

/* ─── Main ContextMenu ───────────────────────────────── */

interface CtxMenuState {
  x: number;
  y: number;
  lng: number;
  lat: number;
  elev?: number | null;
  entity?: any;
}

interface ContextMenuProps {
  ctxMenu: CtxMenuState;
  setCtxMenu: (m: CtxMenuState | null) => void;
  expandedGroup: string | null;
  setExpandedGroup: (g: string | null) => void;
  viewerRef: React.RefObject<any>;
  cesiumRef: React.RefObject<any>;
  toolManagerRef: React.RefObject<any>;
  elevationProfileRef: React.RefObject<any>;
  activeTool: ToolMode;
  setActiveTool: React.Dispatch<React.SetStateAction<ToolMode>>;
  setSelectedSat: (s: any) => void;
  setFollowSat: (f: boolean) => void;
  flyToISS: () => void;
}

export function ContextMenu({
  ctxMenu,
  setCtxMenu,
  expandedGroup,
  setExpandedGroup,
  viewerRef,
  cesiumRef,
  toolManagerRef,
  elevationProfileRef,
  activeTool,
  setActiveTool,
  setSelectedSat,
  setFollowSat,
  flyToISS,
}: ContextMenuProps) {
  const { x, y, lng, lat, entity } = ctxMenu;
  const entType = entity?.type as string | undefined;
  const entName = entity?.name as string | undefined;
  const entId = entity?.id as string | undefined;
  const isEq = entId?.startsWith("eq-");
  const isFlight = entId?.startsWith("flight-") || entId?.startsWith("mil-");
  const isVessel = entId?.startsWith("vessel-");
  const isSat = entId?.startsWith("sat-") || entType === "orbitalTrack";
  const isStorm = entId?.startsWith("storm-");

  const closeCtx = () => {
    setCtxMenu(null);
    setExpandedGroup(null);
  };

  const toggleGroup = (label: string) => {
    setExpandedGroup(expandedGroup === label ? null : label);
  };

  const v = viewerRef.current;
  const C = cesiumRef.current;

  // Keep menu within viewport
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const menuW = 240;
  const adjustedX = x + menuW > vw ? vw - menuW - 8 : x;
  const adjustedY = Math.min(y, vh - 8);

  const entityColor = isEq
    ? "var(--err)"
    : isFlight
      ? "var(--warn)"
      : isVessel
        ? "#4488ff"
        : isSat
          ? "#aa44ff"
          : isStorm
            ? "#ff00ff"
            : "var(--accent)";

  return (
    <div
      className="wv-ctx-menu"
      style={{
        position: "fixed",
        top: adjustedY,
        left: adjustedX,
        zIndex: 200,
        background: "var(--bg-solid)",
        border: "1px solid var(--border-hover)",
        borderRadius: 8,
        padding: "4px 0",
        minWidth: menuW,
        maxHeight: "70vh",
        overflowY: "auto",
        boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
        backdropFilter: "blur(12px)",
        fontFamily: "var(--font-ui)",
        fontSize: "12px",
      }}
    >
      {/* Entity header */}
      {entity && (
        <div
          style={{
            padding: "6px 12px",
            borderBottom: "1px solid var(--border)",
            marginBottom: 2,
            fontSize: "11px",
            color: "var(--text-muted)",
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--text)", fontSize: "12px", marginBottom: 2 }}>
            {entName || entId}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: entityColor,
                flexShrink: 0,
              }}
            />
            <span>{entType || "Entity"}</span>
          </div>
        </div>
      )}

      {/* ── Navigate ── */}
      <CtxSection>
        <SectionHeader label="NAVIGATE" />
        <CtxMenuItem
          label="Fly here (close)"
          icon="&#x1F50D;"
          accent
          onClick={() => {
            if (v && C)
              v.camera.flyTo({
                destination: C.Cartesian3.fromDegrees(lng, lat, 10000),
                orientation: { heading: 0, pitch: C.Math.toRadians(-45), roll: 0 },
                duration: 1.5,
              });
            closeCtx();
          }}
        />
        <CtxMenuItem
          label="Fly here (overview)"
          icon="&#x1F30D;"
          accent
          onClick={() => {
            if (v && C)
              v.camera.flyTo({
                destination: C.Cartesian3.fromDegrees(lng, lat, 200000),
                orientation: { heading: 0, pitch: C.Math.toRadians(-60), roll: 0 },
                duration: 2,
              });
            closeCtx();
          }}
        />
        <CtxMenuItem
          label="Fly here (orbital)"
          icon="&#x1F680;"
          accent
          onClick={() => {
            if (v && C)
              v.camera.flyTo({
                destination: C.Cartesian3.fromDegrees(lng, lat, 5000000),
                orientation: { heading: 0, pitch: C.Math.toRadians(-75), roll: 0 },
                duration: 3,
              });
            closeCtx();
          }}
        />
        <CtxMenuItem
          label="Zoom to ISS"
          icon="&#x1F6F0;"
          accent
          onClick={() => {
            flyToISS();
            closeCtx();
          }}
        />
      </CtxSection>

      <CtxDivider />

      {/* ── Create ── */}
      <CtxSection>
        <SectionHeader label="CREATE" />
        <CtxMenuItem
          label="Add marker"
          icon="&#x1F4CD;"
          color="var(--err)"
          onClick={() => {
            if (v && C)
              v.entities.add({
                id: `marker-${Date.now()}`,
                position: C.Cartesian3.fromDegrees(lng, lat),
                point: { pixelSize: 10, color: C.Color.fromCssColorString("#ff4444") },
                label: {
                  text: "Marker",
                  font: "11px sans-serif",
                  fillColor: C.Color.WHITE,
                  style: C.LabelStyle.FILL_AND_OUTLINE,
                  outlineWidth: 2,
                  outlineColor: C.Color.BLACK,
                  verticalOrigin: C.VerticalOrigin.BOTTOM,
                  pixelOffset: new C.Cartesian2(0, -12),
                },
              });
            v.scene.requestRender();
            closeCtx();
          }}
        />
        <CtxMenuItem
          label="Add annotation"
          icon="&#x270D;"
          color="#44aaff"
          onClick={() => {
            if (v && C)
              v.entities.add({
                id: `ann-text-${Date.now()}`,
                position: C.Cartesian3.fromDegrees(lng, lat),
                label: {
                  text: "Double-click to edit",
                  font: "12px sans-serif",
                  fillColor: C.Color.fromCssColorString("#44aaff"),
                  style: C.LabelStyle.FILL_AND_OUTLINE,
                  outlineWidth: 2,
                  outlineColor: C.Color.BLACK,
                  verticalOrigin: C.VerticalOrigin.BOTTOM,
                  pixelOffset: new C.Cartesian2(0, -14),
                  showBackground: true,
                  backgroundColor: new C.Color(0, 0, 0, 0.7),
                  backgroundPadding: new C.Cartesian2(6, 4),
                },
              });
            v.scene.requestRender();
            closeCtx();
          }}
        />
        <CtxMenuItem
          label="Place range rings"
          icon="&#x25CE;"
          color="var(--warn)"
          onClick={() => {
            if (!v || !C) {
              closeCtx();
              return;
            }
            for (const r of [50, 100, 200, 500]) {
              const rDeg = r / 111.32;
              v.entities.add({
                id: `ring-${r}km-${Date.now()}`,
                position: C.Cartesian3.fromDegrees(lng, lat),
                ellipse: {
                  semiMajorAxis: rDeg,
                  semiMinorAxis: rDeg,
                  material: C.Color.fromCssColorString("#eab308").withAlpha(0.08),
                  outline: true,
                  outlineColor: C.Color.fromCssColorString("#eab308").withAlpha(0.3),
                },
              });
            }
            v.scene.requestRender();
            closeCtx();
          }}
        />
        <CtxMenuItem
          label="Add bookmark"
          icon="&#x2606;"
          color="var(--warn)"
          onClick={() => {
            if (!v || !C) {
              closeCtx();
              return;
            }
            const cam = v.camera;
            const cg = cam.positionCartographic;
            const bm = {
              id: `bm-${Date.now()}`,
              name: `Bookmark @ ${lat.toFixed(2)}, ${lng.toFixed(2)}`,
              lat,
              lon: lng,
              alt: cg.height,
              heading: C.Math.toDegrees(cam.heading),
              pitch: C.Math.toDegrees(cam.pitch),
              timestamp: Date.now(),
            };
            try {
              const existing = JSON.parse(localStorage.getItem("globe-bookmarks") || "[]");
              existing.push(bm);
              localStorage.setItem("globe-bookmarks", JSON.stringify(existing));
            } catch {
              /* */
            }
            closeCtx();
          }}
        />
      </CtxSection>

      <CtxDivider />

      {/* ── Measure ── */}
      <CtxSection>
        <CtxSubMenu label="Measure" icon="&#x1F4CF;" expandedGroup={expandedGroup} onToggle={toggleGroup}>
          <CtxMenuItem
            label="Distance from here"
            icon="&#x2194;"
            onClick={() => {
              setActiveTool("measure-distance");
              if (toolManagerRef.current) {
                toolManagerRef.current.setMode("measure-distance");
                toolManagerRef.current.handleClick(lng, lat);
              }
              closeCtx();
            }}
          />
          <CtxMenuItem
            label="Area from here"
            icon="&#x25A1;"
            onClick={() => {
              setActiveTool("measure-area");
              if (toolManagerRef.current) {
                toolManagerRef.current.setMode("measure-area");
                toolManagerRef.current.handleClick(lng, lat);
              }
              closeCtx();
            }}
          />
          <CtxMenuItem
            label="Elevation profile"
            icon="&#x26F0;"
            onClick={() => {
              setActiveTool("elevation-profile");
              if (elevationProfileRef.current) elevationProfileRef.current.addPoint(lng, lat);
              closeCtx();
            }}
          />
        </CtxSubMenu>
      </CtxSection>

      <CtxDivider />

      {/* ── Copy ── */}
      <CtxSection>
        <CtxSubMenu label="Copy" icon="&#x2398;" expandedGroup={expandedGroup} onToggle={toggleGroup}>
          <CtxMenuItem
            label="Coordinates (DD)"
            onClick={() => {
              safeCopy(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
              closeCtx();
            }}
          />
          <CtxMenuItem
            label="Compact"
            onClick={() => {
              safeCopy(`${lat.toFixed(4)},${lng.toFixed(4)}`);
              closeCtx();
            }}
          />
          <CtxMenuItem
            label="DMS"
            onClick={() => {
              const toDms = (d: number, pos: string, neg: string) => {
                const dir = d >= 0 ? pos : neg;
                const a = Math.abs(d);
                const deg = Math.floor(a);
                const min = Math.floor((a - deg) * 60);
                const sec = ((a - deg - min / 60) * 3600).toFixed(2);
                return `${deg}\u00b0${min}'${sec}"${dir}`;
              };
              safeCopy(`${toDms(lat, "N", "S")} ${toDms(lng, "E", "W")}`);
              closeCtx();
            }}
          />
          <CtxMenuItem
            label="Elevation"
            color="var(--ok)"
            onClick={async () => {
              try {
                const d = await getClientElevation(lat, lng);
                safeCopy(
                  `${d?.elevation !== null && d?.elevation !== undefined ? d.elevation + "m" : "No data"} @ ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
                );
              } catch {
                /* */
              }
              closeCtx();
            }}
          />
        </CtxSubMenu>
      </CtxSection>

      <CtxDivider />

      {/* ── Edit / Manage ── */}
      <CtxSection>
        <CtxSubMenu label="Edit" icon="&#x270E;" expandedGroup={expandedGroup} onToggle={toggleGroup}>
          <CtxMenuItem
            label="Clear measurements"
            color="var(--err)"
            onClick={() => {
              if (toolManagerRef.current) toolManagerRef.current.clear();
              setActiveTool("none");
              closeCtx();
            }}
          />
          <CtxMenuItem
            label="Clear annotations"
            color="var(--err)"
            onClick={() => {
              if (!v) return;
              const toRemove: any[] = [];
              v.entities.values.forEach((e: any) => {
                if (
                  e.id &&
                  (e.id.startsWith("marker-") ||
                    e.id.startsWith("ann-text-") ||
                    e.id.startsWith("ann-line-") ||
                    e.id.startsWith("ann-poly-"))
                )
                  toRemove.push(e);
              });
              toRemove.forEach((e) => v.entities.remove(e));
              v.scene.requestRender();
              closeCtx();
            }}
          />
          <CtxMenuItem
            label="Clear range rings"
            color="var(--err)"
            onClick={() => {
              if (!v) return;
              const toRemove: any[] = [];
              v.entities.values.forEach((e: any) => {
                if (e.id && e.id.startsWith("ring-")) toRemove.push(e);
              });
              toRemove.forEach((e) => v.entities.remove(e));
              v.scene.requestRender();
              closeCtx();
            }}
          />
          <CtxMenuItem
            label="Clear all custom"
            color="var(--err)"
            onClick={() => {
              if (!v) return;
              const toRemove: any[] = [];
              v.entities.values.forEach((e: any) => {
                if (
                  e.id &&
                  (e.id.startsWith("marker-") ||
                    e.id.startsWith("ann-") ||
                    e.id.startsWith("ring-") ||
                    e.id.startsWith("bm-"))
                )
                  toRemove.push(e);
              });
              toRemove.forEach((e) => v.entities.remove(e));
              if (toolManagerRef.current) toolManagerRef.current.clear();
              setActiveTool("none");
              v.scene.requestRender();
              closeCtx();
            }}
          />
        </CtxSubMenu>
      </CtxSection>

      <CtxDivider />

      {/* ── Entity-specific actions ── */}
      {isEq && (
        <CtxSection>
          <SectionHeader label="EARTHQUAKE" />
          <CtxMenuItem
            label="USGS details"
            icon="&#x1F517;"
            accent
            onClick={() => {
              const usgsId = entId?.replace("eq-", "");
              window.open(`https://earthquake.usgs.gov/earthquakes/eventpage/${usgsId}`, "_blank");
              closeCtx();
            }}
          />
          <CtxMenuItem
            label="Copy coordinates"
            onClick={() => {
              safeCopy(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
              closeCtx();
            }}
          />
        </CtxSection>
      )}
      {isFlight && (
        <CtxSection>
          <SectionHeader label="AIRCRAFT" />
          <CtxMenuItem
            label="FlightAware"
            icon="&#x1F517;"
            accent
            onClick={() => {
              const callsign = entName || entId?.replace("flight-", "") || "";
              window.open(`https://flightaware.com/live/flight/${callsign}`, "_blank");
              closeCtx();
            }}
          />
          <CtxMenuItem
            label="Copy callsign"
            onClick={() => {
              safeCopy(entName || entId || "");
              closeCtx();
            }}
          />
        </CtxSection>
      )}
      {isVessel && (
        <CtxSection>
          <SectionHeader label="VESSEL" />
          <CtxMenuItem
            label="MarineTraffic"
            icon="&#x1F517;"
            accent
            onClick={() => {
              const mmsi = entId?.replace("vessel-", "") || "";
              window.open(`https://www.marinetraffic.com/en/ais/details/ships/mmsi:${mmsi}`, "_blank");
              closeCtx();
            }}
          />
          <CtxMenuItem
            label="Copy MMSI"
            onClick={() => {
              safeCopy(entId?.replace("vessel-", "") || "");
              closeCtx();
            }}
          />
        </CtxSection>
      )}
      {isSat && (
        <CtxSection>
          <SectionHeader label="SATELLITE" />
          <CtxMenuItem
            label="Show orbit info"
            icon="&#x1F6F0;"
            accent
            onClick={() => {
              if (v && C && entity) {
                const found = v.entities.values.find(
                  (e: any) => e.id === entId || (entName && e.name?.includes(entName)),
                );
                if (found) {
                  const pos = found.position?.getValue(C.JulianDate.now());
                  if (pos) {
                    const cg = C.Cartographic.fromCartesian(pos);
                    const altKm = +(cg.height / 1000).toFixed(1);
                    const group = found.properties?.group?.getValue?.() || entName || "Unknown";
                    let orbitType = "Unknown";
                    if (altKm < 2000) orbitType = "LEO";
                    else if (altKm > 30000) orbitType = "GEO";
                    else orbitType = "MEO";
                    const velKms = altKm > 30000 ? 3.07 : +(7.66 / Math.sqrt(1 + altKm / 6371)).toFixed(2);
                    setSelectedSat({
                      name: entName || group,
                      alt: altKm,
                      vel: velKms,
                      lat: +C.Math.toDegrees(cg.latitude).toFixed(2),
                      lon: +C.Math.toDegrees(cg.longitude).toFixed(2),
                      orbit: orbitType,
                    });
                  }
                }
              }
              closeCtx();
            }}
          />
          <CtxMenuItem
            label="Follow satellite"
            icon="&#x1F440;"
            onClick={() => {
              if (v) {
                const found = v.entities.values.find(
                  (e: any) => e.id === entId || (entName && e.name?.includes(entName)),
                );
                (window as any).__ozSetFollowEntity?.(found || null);
                setFollowSat(true);
              }
              closeCtx();
            }}
          />
        </CtxSection>
      )}
      {isStorm && (
        <CtxSection>
          <SectionHeader label="STORM" />
          <CtxMenuItem
            label="NHC advisory"
            icon="&#x1F517;"
            accent
            onClick={() => {
              window.open("https://www.nhc.noaa.gov/", "_blank");
              closeCtx();
            }}
          />
          <CtxMenuItem
            label="Zoom to track"
            onClick={() => {
              if (v && C)
                v.camera.flyTo({
                  destination: C.Cartesian3.fromDegrees(lng, lat, 3000000),
                  orientation: { heading: 0, pitch: C.Math.toRadians(-70), roll: 0 },
                  duration: 2,
                });
              closeCtx();
            }}
          />
        </CtxSection>
      )}

      {/* ── External links ── */}
      <CtxSection>
        <SectionHeader label="EXTERNAL" />
        <CtxMenuItem
          label="Open in OSM"
          icon="&#x1F5FA;"
          onClick={() => {
            window.open(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`, "_blank");
            closeCtx();
          }}
        />
        <CtxMenuItem
          label="Open in Google Maps"
          icon="&#x1F5FA;"
          onClick={() => {
            window.open(`https://www.google.com/maps/@${lat},${lng},15z`, "_blank");
            closeCtx();
          }}
        />
        <CtxMenuItem
          label="Open in Google Earth"
          icon="&#x1F30C;"
          onClick={() => {
            window.open(`https://earth.google.com/web/@${lat},${lng},1000a,300d,35y,0h,0t,0r`, "_blank");
            closeCtx();
          }}
        />
        {isEq && (
          <CtxMenuItem
            label="Open in USGS"
            icon="&#x1F517;"
            onClick={() => {
              const usgsId = entId?.replace("eq-", "");
              window.open(`https://earthquake.usgs.gov/earthquakes/eventpage/${usgsId}`, "_blank");
              closeCtx();
            }}
          />
        )}
      </CtxSection>
    </div>
  );
}
