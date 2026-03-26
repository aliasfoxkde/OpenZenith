import { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://openzenith.pages.dev";

  const routes = [
    "",
    "/map",
    "/globe",
    "/explore",
    "/contribute",
    "/demo",
    "/api/docs",
  ];

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "/explore" ? ("daily" as const) : ("weekly" as const),
    priority: route === "" ? 1 : route.startsWith("/api") ? 0.7 : 0.8,
  }));
}
