# Reservation System API

API para la gestión de reservas de salas de reuniones. Permite administrar el catálogo de salas disponibles (capacidad, horarios de apertura por día, amenities), a los usuarios que pueden reservarlas, y las reservas en sí — con la regla central de que dos reservas nunca pueden solaparse en el tiempo para la misma sala.

## Qué resuelve

- **Salas**: alta, listado (paginado), actualización y baja lógica, cada una con su capacidad, duración mínima/máxima de reserva y horario de apertura por día de la semana.
- **Reservas**: creación, cancelación, reprogramación y listado con filtros (por sala, por usuario, por rango de fechas, por estado) y paginación.
- **No-solapamiento**: dos reservas activas para la misma sala nunca pueden pisarse en el tiempo — se garantiza a nivel de base de datos (constraint `EXCLUDE` de Postgres), no solo en código de aplicación.
- **Disponibilidad**: dado un rango de fechas, se puede consultar qué huecos libres tiene una sala puntual, considerando su horario y las reservas ya confirmadas.
- **Autenticación**: JWT con roles (`ADMIN`/`USER`). Cualquiera puede registrarse y reservar; solo un admin puede dar de alta/editar/dar de baja salas.

## Stack

- [NestJS](https://nestjs.com/) + TypeScript (ESM)
- PostgreSQL + [TypeORM](https://typeorm.io/) (migraciones versionadas, sin `synchronize`)
- Autenticación JWT (`@nestjs/passport` + `passport-jwt`)
- Documentación OpenAPI con `@nestjs/swagger`
- Tests con [Vitest](https://vitest.dev/) (unitarios, de integración y e2e)
- Gestor de paquetes: **pnpm**

## Requisitos

- Para correrlo con Docker: solo [Docker](https://www.docker.com/) (con Compose v2).
- Para correrlo en local sin Docker: Node.js 24+, [pnpm](https://pnpm.io/), y una instancia de PostgreSQL 16 accesible (podés levantar solo la base con Docker y correr la app en tu máquina, ver más abajo).

## Configuración

Copiá el archivo de variables de entorno de ejemplo:

```bash
cp .env.example .env
```

| Variable             | Descripción                                                        |
| --------------------- | ------------------------------------------------------------------- |
| `NODE_ENV`             | `development` / `production`.                                       |
| `PORT`                 | Puerto donde escucha la API (default `3000`).                       |
| `DB_HOST`              | Host de Postgres. `localhost` corriendo la app en tu máquina, `db` si corrés todo con Docker Compose (ya está resuelto en el `docker-compose.yml`, no hace falta tocarlo). |
| `DB_PORT`              | Puerto de Postgres (default `5432`).                                |
| `DB_USERNAME`          | Usuario de Postgres.                                                |
| `DB_PASSWORD`          | Password de Postgres.                                               |
| `DB_NAME`              | Nombre de la base de datos.                                         |
| `JWT_SECRET`           | Secreto para firmar los tokens JWT — cambialo en cualquier ambiente real. |
| `JWT_EXPIRES_IN`       | Tiempo de vida del token (ej. `1h`).                                 |
| `SEED_ADMIN_EMAIL`     | Email del usuario admin que se siembra automáticamente al arrancar. |
| `SEED_ADMIN_PASSWORD`  | Password de ese usuario admin sembrado.                             |

## Cómo correrlo

### Opción A — Docker (recomendada, un solo comando)

Levanta la base de datos, corre las migraciones, siembra un usuario admin (idempotente — no falla si ya existe) y arranca la API:

```bash
docker compose up --build
```

Al terminar de arrancar, la API queda disponible en `http://localhost:3000` (o el `PORT` que hayas configurado), con el usuario admin de `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` ya creado y listo para loguearse.

Para bajar todo: `docker compose down` (agregá `-v` si además querés borrar los datos de la base).

### Opción B — Ejecución local (compilando/corriendo vos mismo)

1. Instalá las dependencias:
   ```bash
   pnpm install
   ```
2. Levantá solo la base de datos con Docker (o apuntá `DB_*` a una instancia propia) — ojo, `pnpm run docker:up` levanta *todo* el `docker-compose.yml` (incluido el backend en contenedor), así que para este flujo local pedí puntualmente el servicio `db`:
   ```bash
   docker compose up -d db
   ```
3. Corré la app en modo desarrollo (recarga en caliente; las migraciones corren automáticamente al bootear):
   ```bash
   pnpm run start:dev
   ```
   O compilá y corré la build de producción:
   ```bash
   pnpm run build
   pnpm run start:prod
   ```
4. (Opcional) Sembrá el usuario admin si no vas a usar Docker Compose para eso:
   ```bash
   pnpm run seed:admin
   ```

La API queda igual en `http://localhost:3000`.

## Documentación de la API (Swagger)

Con la app corriendo, la documentación interactiva está en:

- **Swagger UI**: `http://localhost:3000/docs`
- **OpenAPI JSON**: `http://localhost:3000/docs-json`

Desde ahí se puede explorar y probar cada endpoint directamente (botón **Authorize**, ver flujo de autenticación abajo). También se puede importar el JSON en Postman/Insomnia si preferís esas herramientas.

Todas las rutas de negocio quedan versionadas bajo `/v1` (ej. `/v1/resources`), excepto `/health`.

## Autenticación

1. Registrate (crea un usuario con rol `USER`):
   ```bash
   curl -X POST http://localhost:3000/v1/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"Str0ngPass1"}'
   ```
   O usá el usuario admin ya sembrado (`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` de tu `.env`) para probar los endpoints que requieren rol `ADMIN`.

2. Logueate para obtener el token:
   ```bash
   curl -X POST http://localhost:3000/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"Str0ngPass1"}'
   ```
   Devuelve `{ "accessToken": "..." }`.

3. Usalo en cada request protegido:
   ```bash
   curl http://localhost:3000/v1/resources \
     -H "Authorization: Bearer <accessToken>"
   ```
   En Swagger UI, pegá el token en el botón **Authorize** (con o sin el prefijo `Bearer`, Swagger lo agrega solo).

Solo un usuario `ADMIN` puede crear/editar/dar de baja salas; cualquier usuario autenticado puede reservar, cancelar/reprogramar sus propias reservas y consultar disponibilidad.

## Recorrido rápido de la API

Con `$TOKEN` seteado a un `accessToken` de admin:

```bash
# Crear una sala
curl -X POST http://localhost:3000/v1/resources \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "Sala Aurora",
    "capacity": 8,
    "minBookingMinutes": 30,
    "maxBookingMinutes": 240,
    "schedules": [{ "dayOfWeek": 1, "openTime": "09:00", "closeTime": "18:00" }]
  }'

# Listar salas (paginado)
curl "http://localhost:3000/v1/resources?page=1&limit=20" -H "Authorization: Bearer $TOKEN"

# Consultar disponibilidad de una sala en un rango de fechas
curl "http://localhost:3000/v1/resources/<resourceId>/availability?from=2026-09-07T00:00:00.000Z&to=2026-09-14T00:00:00.000Z" \
  -H "Authorization: Bearer $TOKEN"

# Crear una reserva
curl -X POST http://localhost:3000/v1/reservations \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "resourceId": "<resourceId>",
    "startsAt": "2026-09-07T14:00:00.000Z",
    "endsAt": "2026-09-07T15:00:00.000Z"
  }'

# Listar reservas con filtros y paginación
curl "http://localhost:3000/v1/reservations?resourceId=<resourceId>&status=confirmed&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Cancelar una reserva
curl -X PATCH http://localhost:3000/v1/reservations/<reservationId>/cancel \
  -H "Authorization: Bearer $TOKEN"
```

El detalle completo de cada endpoint (parámetros, DTOs, códigos de error) está en Swagger UI.

## Tests

```bash
pnpm run test        # unitarios + integración
pnpm run test:e2e    # end-to-end, contra una base de datos real
pnpm run test:cov    # con cobertura
pnpm run lint         # oxlint
```

Los tests de integración y e2e necesitan una base de datos real disponible (`pnpm run docker:up` la levanta).

## Estructura del proyecto

```
src/
├── auth/          # JWT, login/registro, guards y decoradores de roles
├── users/         # Modelo de usuario
├── resources/     # Salas: CRUD, horarios, disponibilidad
├── reservations/  # Reservas: creación, cancelación, reprogramación, listado
├── health/        # Health check
├── common/        # DTOs y utilidades compartidas (paginación, manejo de fechas)
└── database/      # Migraciones y seed de admin
```
