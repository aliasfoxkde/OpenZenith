import { MetadataRoute } from "next";

/**
 * `sitemap.xml` for the site. The map, globe and studio are the daily
 * changing pages; the rest change weekly. The API landing pages carry a
 * lower priority because they are reference material rather than
 * destinations.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://openzenith.cyopsys.com";

  const routes = [
    "",
    "/map",
    "/globe",
    "/studio",
    "/explore",
    "/about",
    "/contribute",
    "/demo",
    "/api/docs",
    "/api/stac",
  ];

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency:
      route === "/map" || route === "/globe" || route === "/studio" ? ("daily" as const) : ("weekly" as const),
    priority: route === "" ? 1 : route.startsWith("/api") ? 0.7 : 0.8,
  }));
}
