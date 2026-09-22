/**
 * Encode an inline SVG string as a data URI for CesiumJS billboards.
 *
 * billboard.image treats a string as a URL — a raw `<svg>` string is fetched
 * as a page-relative URL and 404s, leaving every icon broken in console and
 * on screen. Data-URI SVG is parsed as XML by <img>, so the root element
 * must carry xmlns or the decode fails.
 */
export function svgIcon(svg: string): string {
  const withNs = svg.includes("xmlns=")
    ? svg
    : svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withNs)}`;
}
