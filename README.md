# AeroQueue – High‑Throughput Asynchronous Email Scheduling Engine

## 🎯 Project Goal
Build a **robust, scalable email dispatch platform** that can ingest, schedule, and reliably deliver millions of emails while enforcing per‑sender rate limits. The UI is a modern **React + Vite** dashboard rendered as a **Bento‑grid**, with a **dark / light theme toggle**. All internal infrastructure (PostgreSQL, Redis, BullMQ, Elasticsearch, MailHog, Caddy) is containerised and hidden from the end‑user – the frontend only speaks to the public API.

---

## 📦 Tech Stack
| Layer | Technology | Reason |
|-------|------------|--------|
| **Frontend** | React 18, Vite, TypeScript, TailwindCSS | Fast HMR, component‑driven UI, easy dark‑mode support |
| **Backend API** | Node.js (TypeScript), Express, Pino | Minimal latency, structured logging |
| **Queue** | BullMQ + Redis 7 | Persistent delayed jobs, concurrency control |
| **Database** | PostgreSQL 16 (Docker) | ACID guarantees for job state, idempotency checks |
| **Search / Auditing** | Elasticsearch 8 | Full‑text searchable audit logs |
| **SMTP Mock** | MailHog | Inspect sent mails locally without external services |
| **Reverse Proxy** | Caddy | Simple routing (`/api/*`, `/search/*`, `/mailhog/*`) |
| **Containerisation** | Docker‑Compose | One‑command local development & production deployment |

---

## 🏗️ Architecture Overview
```mermaid
flowchart TD
    UI["React Dashboard (Bento Grid)\n+ Dark/Light toggle"] -->|HTTP| Caddy["Caddy Reverse Proxy (:80)"]
    Caddy -->|/api/*| API["Express API (:3000)"]
    Caddy -->|/search/*| ES["Elasticsearch (:9200)"]
    Caddy -->|/mailhog/*| MailHog["MailHog UI (:8025)"]

    subgraph CoreEngine
        API -->|INSERT PENDING| DB[("PostgreSQL")]
        API -->|ENQUEUE DELAYED| Redis[("Redis / BullMQ")]
        Worker["BullMQ Workers (5×)" ] -->|FETCH| Redis
        Worker -->|SELECT FOR UPDATE SKIP LOCKED| DB
        Worker -->|RATE LIMIT (Lua ZSET)| Redis
        Worker -->|SEND via SMTP| MailHogSMTP["MailHog SMTP (:1025)"]
        Worker -->|UPDATE STATE| DB
        Worker -->|INDEX LOG| ES
        Recovery["Recovery Daemon"] -.-|RECONCILE STALE LEASES| DB
    end
```
*The UI never touches the internal components – it talks only to the API.*

---

## 🔄 End‑to‑End Request Flow (Interviewer Focus)
1. **Ingestion** – `POST /api/emails/schedule` receives an email payload (recipient, subject, body, `scheduledAt`, optional `idempotencyKey`).
2. **Validation & Idempotency** – Zod validates the request. The service checks the `idempotency_key` column; if it exists it returns the existing job ID to guarantee *exactly‑once* semantics.
3. **Persist & Queue** – Inside a PostgreSQL transaction the row status flips from **PENDING** → **QUEUED** and a BullMQ job is created (`jobId = email_job.id`). The API returns `202 Accepted` instantly.
4. **Worker Claim** – A worker pulls the job, acquires the DB row with `SELECT … FOR UPDATE SKIP LOCKED`, sets a 60 s **lease** (`lease_expires_at`) and records its own UUID.
5. **Rate Limiting** –
   - **Sliding‑window** (Redis ZSET) counts sends per sender in the past hour. If the quota (default 200 emails/hr) is exceeded the job is re‑queued for the next window.
   - **Inter‑send delay** – A Lua script enforces a minimum 2 s gap between two sends for the same sender.
6. **SMTP Dispatch** – Nodemailer talks to MailHog (`localhost:1025`). On success the row status becomes **SENT**; on permanent failure it becomes **FAILED**.
7. **Auditing** – After every attempt a log entry is written to `delivery_logs` and indexed into Elasticsearch (`email_logs`). The **Search API** (`GET /api/search`) exposes these logs to the UI.
8. **Recovery** – On server/worker start‑up (or crash) the **Recovery Daemon** scans for jobs stuck in `PROCESSING` with an expired lease. If retries < 3 it resets them to **QUEUED**; otherwise it moves them to **FAILED** and pushes to a Dead‑Letter Queue.

---

## 🎨 UI Details (What the Interviewer Will See)
- **Header** with the title *AeroQueue Dashboard*.
- **Theme toggle** button on the top‑right – toggles a `dark` class on `<html>`; state saved in `localStorage`.
- **Bento‑grid layout** (Tailwind CSS) containing:
  - **Metrics cards** (total jobs, pending, queued, processing, sent, failed).
  - **Dispatch form** – schedule a new email (calls `/api/emails/schedule`).
  - **Search panel** – free‑text search over Elasticsearch audit logs.
  - **Activity feed** – real‑time stream of job state changes (polls `/api/metrics/overview`).
- No mention of **NeonDB, BullMQ, Redis, etc.** – the UI is clean and user‑focused.

---

## 🛠️ Development Setup (One‑Command Init)
```bash
# 1️⃣ Clone the repo (you already have the folder)
# 2️⃣ Install root dependencies (API + client)
cd "C:/Users/gaurav/OneDrive/Desktop/AeroQueue-high throughput asynchronous  email schedulling engine"
npm ci   # installs API deps

# 3️⃣ Install client deps
cd client
npm ci

# 4️⃣ Start all services (Docker‑Compose)
cd ..
docker compose up -d   # starts postgres, redis, elasticsearch, mailhog, caddy, api

# 5️⃣ Run the React dev server
cd client
npm run dev   # http://localhost:5173
```
**Production build** (served via Caddy):
```bash
cd client
npm run build          # outputs to client/dist
cd ..
# Re‑build the Docker image (multi‑stage Dockerfile already copies client/dist)
docker compose up --build -d
```
All needed permissions are declared in `docker-compose.yml`; no runtime prompts.

---

## ✅ Testing & Verification
- **Unit tests** – located under `client/src/__tests__` (Jest + React Testing Library). Run `npm test` in the client folder.
- **Integration tests** – `scripts/benchmark.sh` exercises rate‑limiting, lease recovery, and idempotency. Execute inside the container: `docker exec -it aeroqueue_api ./scripts/benchmark.sh`.
- **Manual verification** – open the dashboard, schedule a few emails, watch the activity feed, and confirm they appear in MailHog at `http://localhost:8025`.

---

## 📈 Interview Talking Points (What to Emphasise)
| Topic | What to Say |
|-------|-------------|
| **Scalability** | Decoupled ingestion from delivery via BullMQ; workers can be horizontally scaled by adding more containers.
| **Exactly‑once delivery** | Idempotency key check, DB row locking, lease mechanism, and a recovery daemon guarantee no duplicate sends.
| **Rate limiting** | Sliding‑window algorithm implemented in Redis Lua script – guarantees provider‑level throughput limits.
| **Observability** | Metrics endpoint, real‑time activity feed, Elasticsearch audit logs, and MailHog UI for debugging.
| **Containerised everything** | Single `docker compose up` brings up the entire stack – ideal for reproducible environments.
| **Modern Frontend** | React + Vite + Tailwind gives instant hot‑module reload; dark/light toggle shows UI‑theming competence.
| **Testing mindset** | Unit tests for components, integration benchmark suite for backend concurrency, and automated recovery checks.
| **Clean separation** | UI never knows about PostgreSQL/Redis; it only consumes public REST endpoints, making the front‑end maintainable.

---

## 📦 Deployment
The repo contains a **multi‑stage Dockerfile**:
1. **Builder stage** – compiles the TypeScript API and builds the React client.
2. **Runner stage** – copies the compiled API (`dist/`) and the React build (`client/dist`) into a lightweight `node:20‑slim` image and starts the Express server.
Deploy to any container platform (Docker, Kubernetes, Cloud Run, etc.) – just expose port 80 (Caddy) or 3000 (API) as needed.

---

## 📜 License
MIT – feel free to use, remix, and showcase this project in a portfolio.

---

## 🙋‍♂️ Ready to Show Off?
Run the local dev server, flip the theme toggle, schedule a few emails, and walk the interviewer through:
- **Why we chose BullMQ over a simple cron**.
- **How the sliding‑window limiter works atomically**.
- **How the recovery daemon prevents stuck jobs**.
- **How the React UI mirrors the backend state in real‑time**.

That narrative demonstrates end‑to‑end system design, performance awareness, and modern full‑stack development.

---

*Happy coding and good luck with your interview!*