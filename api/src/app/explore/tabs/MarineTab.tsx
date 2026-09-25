/**
 * Marine tab of the Data Explorer: Open-Meteo Marine API coordinate inputs
 * and the current-conditions grid. Extracted verbatim from
 * explore/page.tsx; fetch state stays in the page so filters survive tab
 * switches.
 */
import type { MarineResponse } from "../data";

interface MarineTabProps {
  data: MarineResponse | null;
  error: string;
  loading: boolean;
  lat: string;
  lon: string;
  onLatChange: (value: string) => void;
  onLonChange: (value: string) => void;
  onFetch: () => void;
}

export function MarineTab({ data, error, loading, lat, lon, onLatChange, onLonChange, onFetch }: MarineTabProps) {
  return (
    <>
      <h2>Marine Weather (Open-Meteo)</h2>
      <p style={{ fontSize: "0.8rem", color: "#a3a3a3", margin: "0 0 1rem" }}>
        Wave height, direction, period, wind speed, and temperature from Open-Meteo Marine API.
      </p>

      <div className="ex-filter-group">
        <label>Latitude</label>
        <input placeholder="40.7128" value={lat} onChange={(e) => { onLatChange(e.target.value); }} style={{ width: 120 }} />
        <label>Longitude</label>
        <input placeholder="-74.006" value={lon} onChange={(e) => { onLonChange(e.target.value); }} style={{ width: 120 }} />
        <button className="primary" onClick={onFetch} disabled={loading}>
          {loading ? "Fetching..." : "Fetch"}
        </button>
      </div>

      {error && (
        <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)", marginTop: "1rem" }}>
          <span className="ex-badge err">Error</span> {error}
        </div>
      )}

      {data?.current && (
        <div style={{ marginTop: "1rem" }}>
          <h3>
            Current Conditions at {lat}, {lon}
          </h3>
          <div style={{ fontSize: "0.72rem", color: "#a3a3a3", marginBottom: "0.75rem" }}>
            Time: {data.current.time ? new Date(data.current.time).toLocaleString() : "N/A"}
          </div>
          <div className="ex-grid">
            {[
              { label: "Wave Height", value: `${data.current.wave_height ?? "---"} m`, icon: "🌊" },
              { label: "Wave Direction", value: `${data.current.wave_direction ?? "---"}°`, icon: "🧳" },
              { label: "Wave Period", value: `${data.current.wave_period ?? "---"} s`, icon: "⏱️" },
              { label: "Wind Wave Height", value: `${data.current.wind_wave_height ?? "---"} m`, icon: "🌬️" },
              { label: "Swell Height", value: `${data.current.swell_wave_height ?? "---"} m`, icon: "🌊" },
              { label: "Swell Direction", value: `${data.current.swell_wave_direction ?? "---"}°`, icon: "🧳" },
              { label: "Swell Period", value: `${data.current.swell_wave_period ?? "---"} s`, icon: "⏱️" },
              { label: "Wind Speed", value: `${data.current.wind_speed_10m ?? "---"} km/h`, icon: "🌬️" },
              { label: "Wind Direction", value: `${data.current.wind_direction_10m ?? "---"}°`, icon: "🧳" },
              { label: "Wind Gusts", value: `${data.current.wind_gusts_10m ?? "---"} km/h`, icon: "🌬️" },
              { label: "Temperature", value: `${data.current.temperature_2m ?? "---"}°C`, icon: "🌡️" },
            ].map((item) => (
              <div key={item.label} className="ex-card" style={{ textAlign: "center" }}>
                <div style={{ fontSize: "1.3rem", marginBottom: "0.25rem" }}>{item.icon}</div>
                <div
                  style={{
                    fontSize: "1.2rem",
                    fontWeight: 700,
                    color: "#7cb8ff",
                    fontFamily: "'JetBrains Mono',monospace",
                    marginBottom: "0.15rem",
                  }}
                >
                  {item.value}
                </div>
                <div style={{ fontSize: "0.72rem", color: "#a3a3a3" }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
