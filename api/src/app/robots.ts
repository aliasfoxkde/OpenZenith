import { MetadataRoute } from "next";

/**
 * `robots.txt` for the site. Crawling is allowed everywhere except the
 * generic proxy route (an open relay would otherwise be indexed), and the
 * sitemap URL is advertised so crawlers find the canonical route list.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = "https://openzenith.cyopsys.com";

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
