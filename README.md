# AeroQueue Email Scheduler

A distributed, fault-tolerant email scheduling and delivery platform. Built to handle delayed sending, rate limiting, crash recovery, and searchable audit logs using Node.js, TypeScript, PostgreSQL, Redis (BullMQ), Elasticsearch, Docker, and Caddy.

* * *

## 🧰 Tech Stack

| Layer | Technology | Purpose | Why It Was Chosen |
|-------|------------|---------|-------------------|
| Runtime | **Node.js (v20+)** | Executes the API and worker processes | Non-blocking I/O is a good fit for network-heavy work like queueing and SMTP |
| Language | **TypeScript** | Type-safe codebase for the API, workers, and services | Catches bugs at compile time and keeps queue payloads and DB models consistent |
| API Framework | **Express.js** | REST API for ingestion, sender management, and search | Lightweight, familiar, and fast to build on |
| Database | **PostgreSQL 16** | Source of truth for senders, emails, statuses, and leases | ACID transactions and row-level locking (`FOR UPDATE SKIP LOCKED`) |
| ORM / Migrations | **Prisma** | Schema definition, migrations, and type-safe queries | Typed database access and simple migrations |
| Queue | **BullMQ v5** | Delayed jobs, retries, and the worker pool | Redis-backed delayed jobs avoid cron polling and table scans |
| Cache / Broker | **Redis 7** | Queue storage and rate-limit state | Fast in-memory data structures (sorted sets) and atomic Lua scripting |
| Rate Limiter | **Redis Lua script** | Sliding-window limit per sender | Eviction, counting, and insertion run atomically across all workers |
| Search | **Elasticsearch 8.x** | Full-text and fuzzy search over delivered and failed emails | Sub-50ms search and status aggregations without loading PostgreSQL |
| Mail Server (Dev) | **MailHog** | Fake SMTP server with a web inbox | Test sending safely without real emails or provider blocks |
| Reverse Proxy | **Caddy** | Routes `/api/*` and search traffic to the right service | Simple configuration and automatic HTTPS in production |
| Containers | **Docker & Docker Compose** | Runs PostgreSQL, Redis, Elasticsearch, and MailHog | One command to start the full infrastructure |

* * *

## 🏗 Architecture Overview

The system is built on a decoupled architecture where the Express API handles ingestion and a pool of BullMQ workers handles execution, so the API stays fast and responsive under load.

```
                      +-----------------------------+
                      |   Caddy Reverse Proxy (:80) |
                      +--------------+--------------+
                                     |
             +-----------------------+-----------------------+
             |                                               |
  /api/* (REST Requests)                            /search/* (Query)
             v                                               v
+------------------------+                        +--------------------+
|  Express Ingestion API |                        |   Elasticsearch    |
|        (:3000)         |                        |      (:9200)       |
+-----------+------------+                        +---------^----------+
            |                                               |
    1. Persist PENDING / QUEUED                             | 6. Audit Indexing
            v                                               |
+------------------------+                                  |
|   PostgreSQL (State)   |<-------------------+             |
+------------------------+                    |             |
            |                                 |             |
    2. Enqueue Delayed Job                    |             |
            v                                 |             |
+------------------------+                    |             |
|  Redis 7 (BullMQ ZSET) |                    |             |
+-----------+------------+                    |             |
            |                                 |             |
    3. Pop Due Job (Worker Concurrency = 5)   |             |
            v                                 |             |
+---------------------------------------------+-----+       |
|            BullMQ Worker Pool (5x)                |-------+
|  - 4. Row Lock (SELECT ... FOR UPDATE SKIP LOCKED)|
|  - 5. Atomic Sliding-Window Rate Limit (Lua)      |
|  - 6. Inter-Send Delay Throttling (2s spacing)    |
|  - 7. Background Heartbeat Lease Renewal (20s)    |
+---------------------+-----------------------------+
                      |
              8. SMTP Dispatch (:1025)
                      v
           +--------------------+
           |  MailHog Mock SMTP |  (Web Inbox at :8025)
           +--------------------+
```

### Components

| Component | Responsibility |
|-----------|----------------|
| **Caddy** | Entry point. Forwards REST traffic to the API and search traffic to Elasticsearch. |
| **Express API** | Validates requests, enforces idempotency, saves emails to PostgreSQL, and enqueues delayed jobs. Never sends emails itself. |
| **PostgreSQL** | Source of truth for every email's state, retry count, and send lease. |
| **Redis + BullMQ** | Holds delayed jobs in sorted sets and hands them to workers when they are due. |
| **Worker Pool** | Runs 5 concurrent workers that lock a row, check rate limits, send via SMTP, and update state. |
| **Recovery Service** | Detects expired leases at startup and periodically, then re-queues orphaned emails. |
| **Elasticsearch** | Secondary index for fast full-text search over delivered and failed emails. |
| **MailHog** | Local SMTP sink so no real emails are sent during development. |

### Key Design Ideas

- **How Persistence on Restart is Handled:** PostgreSQL is the strict source of truth; Redis queues are treated as ephemeral. Every worker claims a **60-second send lease** on the row it is processing and renews it with a heartbeat every 20 seconds. If a worker crashes mid-send (OOM, `SIGKILL`, restart), the lease expires. On startup and periodically after that, the `RecoveryService` detects expired leases, verifies retry limits, resets the email to `QUEUED`, and re-pushes it to BullMQ, so no email is dropped.

- **How Rate Limiting & Concurrency are Implemented:**

  - *Concurrency:* The BullMQ worker pool runs with a concurrency of `5`, so up to 5 emails are processed simultaneously. Row-level locking (`FOR UPDATE SKIP LOCKED`) ensures two workers never pick up the same email.
  - *Rate Limiting:* Before sending, the worker runs an atomic **Redis Lua script** that evicts timestamps older than 3600 seconds, counts active sends, and records the new one in a single step. Each sender is capped at **200 emails/hour**. If the limit is hit, the worker gets back a `retryAfterSeconds` value and the job is delayed until the window reopens.
  - *Inter-Send Throttle:* A minimum **2-second gap** between consecutive emails from the same sender prevents SMTP provider throttling and spam flags.

* * *

## 🔄 Request Flow

### 1. Scheduling an Email (Ingestion Path)

```
Client            Caddy          Express API        PostgreSQL         Redis (BullMQ)
  |                 |                 |                  |                   |
  | POST /api/emails/schedule         |                  |                   |
  |---------------->|---------------->|                  |                   |
  |                 |                 | validate + check idempotencyKey      |
  |                 |                 |----------------->|                   |
  |                 |                 | insert row (QUEUED)                  |
  |                 |                 |<-----------------|                   |
  |                 |                 | add delayed job (delay = scheduledAt - now)
  |                 |                 |------------------------------------->|
  |  201 Created    |                 |                  |                   |
  |<----------------|<----------------|                  |                   |
```

1. The client sends `POST /api/emails/schedule` through Caddy.
2. The API validates the payload and checks the `idempotencyKey`. A duplicate request returns the existing email instead of creating a new one.
3. The email is saved to PostgreSQL with status `QUEUED`.
4. The API enqueues a BullMQ job with `delay = scheduledAt - now`.
5. The API responds immediately. The response does not wait for the email to be sent.

### 2. Sending an Email (Worker Path)

```
Redis         Worker              PostgreSQL           Redis (Lua)       SMTP          Elasticsearch
  |             |                      |                    |              |                 |
  | job is due  |                      |                    |              |                 |
  |------------>|                      |                    |              |                 |
  |             | lock row (SKIP LOCKED) + claim 60s lease  |              |                 |
  |             |--------------------->|                    |              |                 |
  |             | start heartbeat (renew every 20s)         |              |                 |
  |             | check sliding-window limit                |              |                 |
  |             |------------------------------------------>|              |                 |
  |             |     allowed (or retryAfterSeconds)        |              |                 |
  |             |<------------------------------------------|              |                 |
  |             | wait for 2s inter-send gap                |              |                 |
  |             | send email                                |              |                 |
  |             |------------------------------------------------------->  |                 |
  |             | mark SENT, release lease                  |              |                 |
  |             |--------------------->|                    |              |                 |
  |             | index document                            |              |                 |
  |             |---------------------------------------------------------------------->   |
```

1. BullMQ hands a due job to one of the 5 workers.
2. The worker locks the PostgreSQL row with `FOR UPDATE SKIP LOCKED` and claims a 60-second lease tagged with its `worker_id`.
3. A background heartbeat renews the lease every 20 seconds while the worker is busy.
4. The worker runs the Lua rate-limit script:
   - **Allowed:** it continues.
   - **Limit reached:** the job is delayed by `retryAfterSeconds` and retried later.
5. The worker enforces the 2-second minimum gap since this sender's last email.
6. The email is dispatched over SMTP.
7. The status is updated to `SENT` (or `FAILED` after retries are exhausted), and the lease is released.
8. The result is indexed into Elasticsearch for search.

### 3. Crash Recovery Path

1. A worker dies mid-send, so the heartbeat stops and the lease expires after 60 seconds.
2. The `RecoveryService` (at startup and on a periodic schedule) finds `PROCESSING` rows with expired leases.
3. If retries remain, the row is reset to `QUEUED` and re-pushed to BullMQ. Otherwise it is marked `FAILED`.
4. A healthy worker picks it up and completes the send.

### 4. Searching Logs

1. The client calls `GET /api/search?q=partnership&status=SENT`.
2. The query goes to Elasticsearch, which returns matching emails with fuzzy full-text matching across subject, body, sender, and recipient.

* * *

## ✨ Features Implemented

### Backend

- **Scheduler:** Time-based task execution using BullMQ delayed jobs backed by Redis sorted sets (`ZSET`). There is no cron polling and no recurring table scans.
- **Persistence & Crash Recovery:** Distributed send leases, heartbeat renewal, and a startup + periodic reconciler that heals "zombie" jobs.
- **Rate Limiting:** A sliding-window limiter (atomic Lua) with a per-sender hourly quota and a minimum inter-send delay.
- **Concurrency:** A scalable worker pool with PostgreSQL row-level locking to prevent double-processing.
- **Idempotency:** Idempotency keys and state guards ensure duplicate API submissions or replayed requests never trigger duplicate sends.
- **Search Engine:** Elasticsearch 8.x indexing of every delivered and failed message, with full-text and fuzzy search across subject, body, sender, and recipient, plus status filtering.
- **Sender Management:** Register senders with custom `hourlyQuota` and `minDelayMs` settings.
- **Reverse Proxy:** Caddy routes `/api/*` to the API and handles search traffic.
- **Containerised:** Docker and Docker Compose setup for the entire infrastructure.

* * *

## 🚀 Project Setup

### 1. Prerequisites

Make sure you have installed:

- [Node.js](https://nodejs.org/) (v20 or newer)
- [Docker Desktop](https://www.docker.com/) (to run the backing services)
- Git

### 2. Clone the Repository

```
git clone https://github.com/gauravshukla490/AeroQueue.git
cd AeroQueue
npm install
```

### 3. Start the Infrastructure

The application relies on PostgreSQL, Redis, Elasticsearch, and MailHog (a fake SMTP server). Start them all with Docker Compose:

```
docker compose up -d
```

*(Wait a few moments for Elasticsearch to fully boot up.)*

Verify the services are running:

- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- Elasticsearch: [http://localhost:9200](http://localhost:9200)
- MailHog Web Dashboard: [http://localhost:8025](http://localhost:8025)

### 4. Configure Environment Variables

Copy the example file and fill in your values:

```
cp .env.example .env
```

On Windows (PowerShell), use `copy .env.example .env`.

Then open `.env` and set your `DATABASE_URL` to match the Postgres credentials in `docker-compose.yml` (see the [Environment Variables](#-environment-variables) section below). The other defaults work out of the box for local development.

### 5. Run Database Migrations

```
npx prisma migrate dev --name init
```

### 6. Seed Demo Data (Optional)

```
npm run seed
```

This creates a default sender (`growth@startup.io`), a sample campaign, and 5 delayed email jobs.

### 7. Run the Backend

The backend is split into two processes: the API server (handles web requests) and the Worker pool (handles the email queue). You must run both.

Open a terminal and run the API:

```
npm run dev:api
```

Open a **second terminal** and run the Worker:

```
npm run dev:worker
```

Open the MailHog dashboard at [http://localhost:8025](http://localhost:8025) to watch emails arrive in real time.

* * *

## 🔐 Environment Variables

All configuration lives in a `.env` file at the project root. A template is provided in `.env.example`.

```
# Server Configuration
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Database (PostgreSQL via Docker)
DATABASE_URL=""
REDIS_HOST="localhost"
REDIS_PORT=6379
REDIS_PASSWORD=""

# SMTP (MailHog for development)
SMTP_HOST="localhost"
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM="AeroQueue <no-reply@aeroqueue.local>"

# Worker Configuration
WORKER_CONCURRENCY=5
DEFAULT_HOURLY_LIMIT=200
DEFAULT_MIN_DELAY_MS=2000
LEASE_DURATION_SECONDS=60
LEASE_HEARTBEAT_SECONDS=20

# Elasticsearch
ELASTICSEARCH_NODE="http://localhost:9200"
ELASTICSEARCH_INDEX="aeroqueue_email_logs"
```

### Server

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Port the Express API listens on | `3000` |
| `NODE_ENV` | Runtime environment (`development` or `production`) | `development` |
| `LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) | `info` |

### Database & Queue

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string (**required**). Points to the Postgres container started by Docker Compose | none |
| `REDIS_HOST` | Redis host used by BullMQ and the rate limiter | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis password (leave empty for local Docker Redis) | empty |

Example `DATABASE_URL` for the local Docker container:

```
DATABASE_URL="postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5432/<POSTGRES_DB>"
```

Use the same user, password, and database name defined for the `postgres` service in `docker-compose.yml`.

### SMTP

| Variable | Description | Default |
|----------|-------------|---------|
| `SMTP_HOST` | SMTP server host | `localhost` |
| `SMTP_PORT` | SMTP server port | `1025` (MailHog) |
| `SMTP_SECURE` | Use TLS (`true` for port 465) | `false` |
| `SMTP_USER` | SMTP username (not needed for MailHog) | empty |
| `SMTP_PASS` | SMTP password (not needed for MailHog) | empty |
| `SMTP_FROM` | Default "From" header on outgoing emails | `AeroQueue <no-reply@aeroqueue.local>` |

> For production, replace the MailHog values with real SMTP credentials (SendGrid, AWS SES, Mailgun, etc.).

### Worker Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `WORKER_CONCURRENCY` | Number of emails each worker process handles in parallel | `5` |
| `DEFAULT_HOURLY_LIMIT` | Default emails per hour allowed per sender (sliding window) | `200` |
| `DEFAULT_MIN_DELAY_MS` | Minimum gap between consecutive emails from the same sender, in ms | `2000` |
| `LEASE_DURATION_SECONDS` | How long a worker holds the lock on an email before it is considered crashed | `60` |
| `LEASE_HEARTBEAT_SECONDS` | How often a worker renews its lease while sending | `20` |

> Keep `LEASE_HEARTBEAT_SECONDS` comfortably lower than `LEASE_DURATION_SECONDS` so a healthy worker always renews its lease before it expires.

### Elasticsearch

| Variable | Description | Default |
|----------|-------------|---------|
| `ELASTICSEARCH_NODE` | Elasticsearch node URL | `http://localhost:9200` |
| `ELASTICSEARCH_INDEX` | Index name used for email audit logs | `aeroqueue_email_logs` |

> **Never commit your `.env` file.** It is listed in `.gitignore`. Only `.env.example` should be tracked in Git.

* * *

## 🧪 Verification & Chaos Tests

### Test the Sliding-Window Rate Limiter

```
npm run test:rate-limit
```

Fires 15 consecutive requests against a 10-email limit. Verifies that exactly 10 pass, 5 are blocked, and the calculated `retryAfterSeconds` is returned.

### Test Crash Recovery & Zombie Lease Healing

```
npm run test:crash-recovery
```

Creates a simulated crashed job in `PROCESSING` state with an expired lease (`NOW() - 120s`). Verifies the reconciler heals the job, resets it to `QUEUED`, and schedules it for retry.

* * *

## 📡 REST API Reference

### Health Check

```
GET /api/health
```

### Register Sender

```
POST /api/senders
Content-Type: application/json

{
  "email": "outreach@startup.io",
  "name": "Outreach Sales",
  "hourlyQuota": 200,
  "minDelayMs": 2000
}
```

### Schedule Single Email

```
POST /api/emails/schedule
Content-Type: application/json

{
  "senderId": "<SENDER_UUID>",
  "recipient": "client@acme.corp",
  "subject": "Platform Partnership",
  "body": "<h1>Let's Connect</h1><p>Checking in regarding our Q4 goals.</p>",
  "scheduledAt": "2026-11-02T12:00:00Z",
  "idempotencyKey": "req-client-acme-1"
}
```

### Search Outbound Logs

```
GET /api/search?q=partnership&status=SENT
```

* * *

## 📌 Assumptions & Trade-offs

- **Elasticsearch is Best-Effort:** Elasticsearch uses a lot of RAM. It is treated purely as a secondary search index. PostgreSQL remains the source of truth for scheduling and delivery state.
- **Redis is Ephemeral:** Queue state in Redis can be lost without losing emails. The recovery service rebuilds the queue from PostgreSQL.
- **MailHog for Development:** The SMTP layer points to MailHog locally so no real emails are ever sent. For production, swap in real SMTP credentials (SendGrid, AWS SES, etc.) through the `.env` file.
- **At-Least-Once Delivery with Idempotency:** A crash between "SMTP accepted" and "status updated" could in rare cases cause a retry. Idempotency keys and state guards minimise this, but exactly-once delivery over SMTP is not guaranteed by any system.
- **Fixed Worker Concurrency:** Concurrency is set to 5 per worker process. Scale horizontally by running more worker processes; the row locks and Lua rate limiter keep them safe.

* * *

## 🎯 Design Decisions (Q&A)

- **Why BullMQ over cron jobs?**
  Cron requires recurring table scans that scale poorly with data volume. BullMQ uses Redis sorted sets for precise scheduling without putting load on the database.

- **How do you prevent duplicate emails when a worker crashes?**
  PostgreSQL row-level locks (`SKIP LOCKED`), a 60-second heartbeat-renewed send lease, idempotency keys, and an automated reconciler that sweeps orphaned `PROCESSING` jobs.

- **How does the rate limiter work across multiple workers?**
  An atomic Redis Lua script performs eviction, counting, and insertion in one step, which prevents race conditions between concurrent workers.