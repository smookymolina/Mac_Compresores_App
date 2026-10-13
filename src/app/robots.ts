import type { MetadataRoute } from "next";

// El portal de socios no debe indexarse (además lleva noindex y CSP desde el middleware).
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: ["/socios"] } };
}
