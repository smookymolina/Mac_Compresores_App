import type { MetadataRoute } from "next";

// Instalable como app (Android/Chrome: «Instalar app»; iOS: «Agregar a inicio»).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MAC Compresores",
    short_name: "MAC",
    description: "Cotizaciones, ventas, inventario y cobranza de MAC Compresores.",
    lang: "es-MX",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#1e293b",
    theme_color: "#1e293b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
