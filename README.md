# MAC Compresores — Sistema interno

Cotizaciones, ventas, inventario, clientes, catálogo de precios y comisiones.
Next.js 15 (App Router) · TypeScript estricto · PostgreSQL 16 · Prisma 6 · Tailwind 4 · Zod · Vitest · Playwright.

## Requisitos
Node 22+, Docker (para PostgreSQL).

## Docker (todo en contenedores)
```bash
cp .env.example .env            # define SEED_ADMIN_PASSWORD
docker compose up -d --build    # db → migrate (migraciones + seed) → app
```
App en **http://localhost:3080** (o `http://<IP-de-tu-PC>:3080` desde el celular en la misma Wi‑Fi).
Variables: `APP_PORT` (3080), `SEED_DEMO` (1 = datos ficticios [DEMO]), `COOKIE_SECURE` (false para HTTP en LAN; `true` detrás de HTTPS).
Actualizar tras cambios de código: `docker compose up -d --build app`.

## Instalación local (desarrollo)
```bash
cp .env.example .env            # ajusta SEED_ADMIN_PASSWORD
docker compose up -d            # PostgreSQL en localhost:5433 (+ BD *_test)
npm install                     # ejecuta prisma generate
npm run db:deploy               # aplica migraciones (en desarrollo: npm run db:migrate)
npm run db:seed                 # roles, permisos, admin, almacén, tabla de comisiones (borrador)
SEED_DEMO=1 npm run db:seed     # opcional: datos FICTICIOS marcados [DEMO]
```
Admin inicial: `admin@maccompresores.local` con la contraseña de `SEED_ADMIN_PASSWORD`.
Los usuarios demo (`ventas1@demo.local`, `ventas2@demo.local`, `almacen@demo.local`, `gerencia@demo.local`) usan la misma contraseña.

## Ejecutar
```bash
npm run dev                     # http://localhost:3000
npm run build && npm start      # producción
```

## Lista de precios
Exporta la hoja `base filtros` de *Lista precios.xlsx* como **CSV UTF-8** e impórtala en
*Productos → Importar CSV*, o desde consola (recomendado para la lista completa, ~36 mil filas):
```bash
npm run import:products -- ruta/lista.csv
```

## Pruebas
```bash
npm run lint && npm run typecheck
npm test                        # unitarias + integración (usa TEST_DATABASE_URL; nunca la BD de desarrollo)
npx playwright install chromium # una vez
npm run build && npx dotenv -e .env -- npm run test:e2e   # requiere SEED_DEMO=1
```

Documentación: [arquitectura](docs/architecture.md) · [plan](docs/implementation-plan.md).
