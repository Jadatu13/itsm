# ITSM — Internal IT Service Management

A minimal internal ITSM web app built with React (Vite), Node.js/Express, and PostgreSQL.

---

## Quick start — Docker (recommended)

The easiest way to run the app. Requires [Docker](https://docs.docker.com/get-docker/) with the Compose plugin.

### 1. Configure

```bash
cp .env.example .env
```

Edit `.env` and set a strong `POSTGRES_PASSWORD`. Change `APP_PORT` if 8080 is already in use.

### 2. Build and start

```bash
docker compose up -d --build
```

The app will be available at **http://localhost:8080** (or whatever `APP_PORT` you set).

On first start, PostgreSQL automatically runs `schema.sql` then `seed.sql` to create tables and load sample data. This only happens once — when the data volume is empty.

### Useful commands

```bash
# View logs from all containers
docker compose logs -f

# View logs from a single service
docker compose logs -f server

# Stop everything (data is preserved in the volume)
docker compose down

# Stop and wipe all data (full reset)
docker compose down -v

# Rebuild after code changes
docker compose up -d --build
```

---

## Deploying on Coolify

[Coolify](https://coolify.io) supports Docker Compose natively — this app deploys with zero modifications.

### Steps

1. In Coolify, create a new **Resource → Docker Compose** application.
2. Set the **Repository** to `https://github.com/Jadatu13/itsm` (or your fork).
3. Set **Branch** to `main`.
4. Under **Environment Variables**, add:

| Variable | Required | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | Yes | Strong random password |
| `JWT_SECRET` | Yes | 96-char hex — `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ENCRYPTION_KEY` | Yes | 64-char hex — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `APP_URL` | Yes | Your Coolify domain, e.g. `https://itsm.yourdomain.com` |
| `CLIENT_URL` | Yes | Same as `APP_URL` |
| `AZURE_TENANT_ID` | Optional | For Microsoft SSO login |
| `AZURE_CLIENT_ID` | Optional | For Microsoft SSO login |
| `AZURE_CLIENT_SECRET` | Optional | For Microsoft SSO login |
| `SMTP_HOST` | Optional | For email notifications |

5. Set the **Port** to `80` (the nginx container's internal port). Coolify's proxy handles SSL/HTTPS.
6. Click **Deploy**.

> **Note:** You do not need to set `APP_PORT` when deploying on Coolify — Coolify's Traefik proxy routes traffic directly to the nginx container on port 80.

---

## Deploying on Unraid

Unraid's Docker Compose support makes this straightforward.

### Option A — Docker Compose plugin (recommended)

1. Install the **Docker Compose Manager** plugin from Community Applications.
2. Copy the project to your Unraid server (e.g. via SCP or the file manager):
   ```
   /mnt/user/appdata/itsm/
   ```
3. Create your `.env` in that directory:
   ```
   APP_PORT=8080
   POSTGRES_PASSWORD=your-strong-password
   CLIENT_URL=*
   ```
4. In the Docker Compose Manager UI, point it at `/mnt/user/appdata/itsm/docker-compose.yml` and click **Up**.

### Option B — Unraid terminal

SSH into your Unraid server and run:

```bash
# Copy the project (from your machine)
scp -r /path/to/itsm root@your-unraid-ip:/mnt/user/appdata/itsm

# On the Unraid server
cd /mnt/user/appdata/itsm
cp .env.example .env
nano .env   # set POSTGRES_PASSWORD and APP_PORT

docker compose up -d --build
```

### Pinning the database volume to a specific path

By default, Docker manages the postgres volume. To store it at a known Unraid path (e.g. so you can back it up with Unraid's Appdata Backup plugin), uncomment the volume driver block at the bottom of `docker-compose.yml`:

```yaml
volumes:
  postgres_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /mnt/user/appdata/itsm/postgres
```

Then create the directory first:

```bash
mkdir -p /mnt/user/appdata/itsm/postgres
```

---

## Local development (without Docker)

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

---

## Database setup

1. Create the database:

```bash
createdb itsm
```

Or using psql:

```sql
CREATE DATABASE itsm;
```

2. Run the schema:

```bash
psql -d itsm -f server/db/schema.sql
```

3. Load seed data:

```bash
psql -d itsm -f server/db/seed.sql
```

---

## Environment configuration

Create `server/.env` from the example:

```bash
cp .env.example server/.env
```

Edit `server/.env` for local dev:

```
DATABASE_URL=postgres://postgres:password@localhost:5432/itsm
PORT=3001
CLIENT_URL=http://localhost:5173
```

Adjust `DATABASE_URL` to match your local PostgreSQL credentials.

---

## Start the backend

```bash
cd server
npm install
node index.js
```

The API server will be available at **http://localhost:3001**.

---

## Start the frontend

```bash
cd client
npm install
npm run dev
```

The app will be available at **http://localhost:5173**.

The Vite dev server proxies `/api` requests to the backend automatically.

---

## Default ports

| Service  | Port |
|----------|------|
| Backend  | 3001 |
| Frontend | 5173 |

---

## Project structure

```
itsm/
├── docker-compose.yml    # Production / Unraid deployment
├── .env.example          # Docker environment variables template
├── server/
│   ├── Dockerfile
│   ├── index.js          # Express entry point
│   ├── db/
│   │   ├── index.js      # pg Pool
│   │   ├── schema.sql    # Table definitions (auto-run on first Docker start)
│   │   └── seed.sql      # Sample data (auto-run on first Docker start)
│   └── routes/
│       ├── tickets.js
│       ├── contacts.js
│       └── organisations.js
├── client/
│   ├── Dockerfile        # Multi-stage: Node build → nginx
│   ├── nginx.conf        # SPA routing + /api proxy to backend
│   └── src/
│       ├── App.jsx
│       ├── components/   # Layout, Badge, Modal, PageHeader
│       ├── pages/        # Dashboard, TicketList, TicketDetail, Contacts, ContactDetail, Organisations
│       ├── styles/       # Global CSS, shared form styles
│       └── utils/        # Date formatting helpers
└── README.md
```
