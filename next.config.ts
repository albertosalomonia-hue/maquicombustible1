import type { NextConfig } from "next";

// Sitios que pueden mostrar esta app dentro de un <iframe>, separados por espacios
// (ej. "https://intranet.miempresa.com https://otro.com"). Vacío = nadie (solo el mismo origen).
// X-Frame-Options no admite listas, por eso se usa CSP frame-ancestors, que es su sucesor.
const FRAME_ANCESTORS = (process.env.FRAME_ANCESTORS ?? "").split(/\s+/).filter(Boolean);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Paquetes pesados que solo se usan en acciones puntuales (exportar Excel/PDF, gráficos).
  // Next recorta los imports de barril para no cargar la librería completa.
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "date-fns"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          FRAME_ANCESTORS.length
            ? { key: "Content-Security-Policy", value: `frame-ancestors 'self' ${FRAME_ANCESTORS.join(" ")}` }
            : { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
