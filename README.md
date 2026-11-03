## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [Docker Desktop](https://www.docker.com/) running
- A free [Neon](https://neon.tech) account (serverless PostgreSQL)

### 1. Create a Neon database

1. Create a new project on Neon.
2. From the dashboard, copy two connection strings:
   - **Pooled** (host contains `-pooler`) → `DATABASE_URL`
   - **Direct** → `DIRECT_URL`

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `DATABASE_URL`, `DIRECT_URL` and set a `REDIS_PASSWORD`.

### 3. Start infrastructure (Redis, MailHog, Elasticsearch)

```bash
docker compose up -d redis mailhog elasticsearch
```

| Service       | URL                    |
| ------------- | ---------------------- |
| Redis         | `localhost:6379`       |
| MailHog UI    | http://localhost:8025  |
| Elasticsearch | http://localhost:9200  |

### 4. Install dependencies and run migrations

```bash
npm install
npx prisma migrate deploy
```

### 5. Seed demo data

```bash
npm run seed
```

Creates a default sender (`growth@startup.io`), a sample campaign, and 5 delayed email jobs.

### 6. Run the app

**Option A: local development** (two terminals)

```bash
npm run dev:api      # Ingestion API
npm run dev:worker   # BullMQ worker pool
```

**Option B: fully containerised**

```bash
docker compose up -d --build
```

Open the MailHog dashboard at http://localhost:8025 to watch emails arrive.

> **Note:** Neon free-tier databases auto-suspend when idle, so the first
> query after inactivity may take a few seconds. The worker retries DB
> errors with backoff.