/** MapLibre helper functions for the landing page interactive demo. */

export function addOrUpdatePin(map: any, lon: number, lat: number) {
  const el = document.createElement("div");
  el.className = "oz-pin";
  el.style.cssText = `
    width:20px;height:20px;border-radius:50%;
    background:rgba(59,130,246,0.9);border:2px solid #fff;
    box-shadow:0 0 6px rgba(59,130,246,0.6);
    position:relative;
  `;
  const pulse = document.createElement("div");
  pulse.style.cssText = `
    position:absolute;inset:-6px;border-radius:50%;
    background:rgba(59,130,246,0.3);
    animation:oz-pulse 2s infinite;
  `;
  el.appendChild(pulse);

  const existing = (map as any)._ozPin;
  if (existing) existing.remove();
  const marker = new (window as any).maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
  (map as any)._ozPin = marker;
}

export function flyToWithPadding(map: any, lon: number, lat: number, zoom: number) {
  const isMobile = window.innerWidth < 768;
  map.flyTo({
    center: [lon, lat],
    zoom,
    duration: 1500,
    essential: true,
    padding: isMobile ? { top: 80, bottom: 40, left: 20, right: 20 } : { top: 100, bottom: 60, left: 400, right: 60 },
  });
}
