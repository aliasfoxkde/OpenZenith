import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = "https://openzenith.pages.dev";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/proxy/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
