# KardexERP-DIESEL 2026 (Next.js)

Frontend del sistema de logística e inventarios de Maquicombustibles, migrado de Vite + React Router
a **Next.js 16 (App Router)**. El backend sigue siendo el servidor Express de `../server`.

## Puesta en marcha

```bash
# 1. Backend (puerto 3001)
cd ../server && npm run dev

# 2. Frontend (puerto 3000)
cd maquicombustible1
npm install
npm run dev
```

El navegador siempre llama a `/api/*` en el mismo origen; `next.config.ts` lo reenvía al servidor
Express (`API_URL`, por defecto `http://localhost:3001`). Copia `.env.example` a `.env.local` si
necesitas otra URL. No hace falta CORS.

## Estructura

```
app/
  layout.tsx            Layout raíz (fuente Inter, metadata, Providers)
  providers.tsx         React Query + Auth + Confirm + Toaster (Client Component)
  globals.css           Tailwind v4 (@theme con los colores de marca) + clases de componentes
  not-found.tsx         Cualquier ruta desconocida redirige a /
  (auth)/login/         Pantalla de login
  (app)/                Grupo protegido: layout con AppShell (sesión + Sidebar/Header)
    <modulo>/page.tsx   Una página de servidor mínima por módulo; valida el permiso con
                        <RequiereAcceso modulo="..."> y renderiza la pantalla de features/
features/               Pantallas (Client Components), una carpeta por módulo
components/             Layout/, auth/ y ui/ reutilizables
context/ hooks/         AuthContext, ConfirmContext y hooks
services/api.ts         Cliente axios (token Bearer desde localStorage)
utils/                  navState (paso de datos entre pantallas), vale de salida en PDF
public/                 Logo y js-fluid-meter (vendor)
```

## Decisiones de la migración

- **Rutas**: `react-router-dom` → `next/navigation` y `next/link`. Lo que antes viajaba en
  `location.state` (OC → Recepciones, Recepciones → Transferencias) ahora pasa por
  `utils/navState.ts` (sessionStorage de un solo uso).
- **Sesión**: el token sigue en `localStorage`, así que la protección de rutas es de cliente
  (`AppShell`, `LoginGate`, `RequiereAcceso`). Si se migra a cookies httpOnly en el servidor,
  se puede mover la comprobación a `proxy.ts`.
- **Tailwind 3 → 4**: tema en CSS (`@theme`) y clases renombradas (`shadow-xs`, `rounded-sm`,
  `shrink-0`, `outline-hidden`, `bg-linear-to-*`, `placeholder:`).
- **Rendimiento**: `exceljs`, `xlsx` y `jspdf` se cargan con `import()` solo al exportar/importar;
  `js-fluid-meter` se inyecta bajo demanda desde `FluidGauge`; la fuente Inter usa `next/font`.
- Se descartaron `Cotizaciones` y `Pagos`, que no tenían ruta ni referencias.

## Producción

```bash
# En el servidor, con el Express ya corriendo (server/: NODE_ENV=production npm start)
cd maquicombustible1
npm ci
# API_URL se lee al COMPILAR: define la URL real del Express en .env.production
npm run build
npm start            # puerto 3000 (usa `npx next start -p <puerto>` para otro)
```

| Variable | Dónde | Descripción |
|---|---|---|
| `API_URL` | `maquicombustible1/.env.production` | URL del Express, sin `/` final. Se fija en `next build`; si cambia hay que recompilar. |
| `DB_*`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`, `NODE_ENV`, `CLIENT_URL` | `server/.env` | Siguen en el backend. **No** van en Next: no hay secretos en el frontend. |

Recomendado detrás de HTTPS (Nginx/Caddy/IIS) apuntando al puerto de Next; el Express no necesita
quedar expuesto a internet porque Next reenvía `/api/*` por dentro. Con pm2:
`pm2 start npm --name kardex-web -- start`.
