# Hermes / ReachInbox — Distributed Outbound Email Engine
> A fault-tolerant, high-throughput email scheduling and delivery system built with Node.js, TypeScript, PostgreSQL, Redis, BullMQ, Elasticsearch, Docker, and Caddy.

[![Node.js](https://img.shields.io/badge/Node.js-v24+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5+-blue.svg)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-red.svg)](https://redis.io/)
[![BullMQ](https://img.shields.io/badge/BullMQ-v5-orange.svg)](https://bullmq.io/)
[![Elasticsearch](https://img.shields.io/badge/Elasticsearch-8-yellow.svg)](https://www.elastic.co/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)](https://www.docker.com/)

---

## Architecture Overview

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

---

## Core Engineering Highlights

### 1. Reliable Asynchronous Scheduling (No Cron Polling)
* Traditional email schedulers poll the database (`SELECT * FROM emails WHERE send_at <= NOW() AND status = 'PENDING'`), creating database CPU spikes, table bloat, and serialization locks at scale.
* This engine uses **BullMQ delayed jobs backed by Redis sorted sets (`ZSET`)**. Scheduling is $O(\log N)$, separating instant API ingestion (sub-20ms) from background worker execution.

### 2. Controlled Throughput (Sliding-Window Rate Limiter)
* **Atomic Redis Lua Script:** Enforces a hard **200 emails / hour** cap per sender account. Unlike fixed-window counters that suffer from burst boundary issues, the sliding-window evicts timestamps older than 3600 seconds and counts active sends in real time.
* **Provider-Safe Inter-Send Throttle:** Enforces a minimum 2-second delay between consecutive emails for the same sender to prevent SMTP provider throttling, greylisting, and spam flags.

### 3. Fault-Tolerant Delivery & Crash Recovery
* **60-Second Distributed Send Lease:** When a worker picks up a job, it locks the PostgreSQL row (`FOR UPDATE SKIP LOCKED`) and claims a 60-second lease with its unique `worker_id`.
* **Heartbeat Renewal:** For long-running network operations, a background timer extends the lease every 20 seconds.
* **Startup & Periodic Reconciler:** If a worker node crashes mid-send (e.g. OOM or `SIGKILL`), the `RecoveryService` automatically detects expired leases, verifies retry limits, resets state to `QUEUED`, and re-pushes to BullMQ without message loss.
* **Idempotency Guarantees:** Compound constraints and state guards ensure duplicate API submissions or replayed network frames never trigger duplicate email dispatches.

### 4. Elasticsearch Full-Text Search & Observability
* Every delivered and failed message is indexed into **Elasticsearch 8.x** with full-text search across subject, body, sender, and recipient fields.
* Supports fuzzy search and status aggregation queries under 50ms.

---

## Quick Start Guide

### Prerequisites
* [Node.js](https://nodejs.org/) v20+
* [Docker Desktop](https://www.docker.com/) running

### 1. Start Infrastructure (PostgreSQL, Redis, MailHog, Elasticsearch)
```bash
docker compose up -d
```
Verify all containers are healthy:
* PostgreSQL: `localhost:5432`
* Redis: `localhost:6379`
* MailHog Web Dashboard: http://localhost:8025
* Elasticsearch: http://localhost:9200

### 2. Run Database Migrations
```bash
npx prisma migrate dev --name init
```

### 3. Seed Demo Data
```bash
npm run seed
```
Creates a default sender (`growth@startup.io`), a sample campaign, and 5 delayed email jobs.

### 4. Start the Application
In separate terminal windows:
```bash
# Terminal 1: Ingestion API Service
npm run dev:api

# Terminal 2: BullMQ Worker Pool (5 concurrent workers)
npm run dev:worker
```

Open the MailHog web dashboard at [http://localhost:8025](http://localhost:8025) to watch emails arrive in real time!

---

## Verification & Chaos Test Suite

### 1. Test Sliding-Window Rate Limiter
```bash
npm run test:rate-limit
```
Fires 15 consecutive requests against a 10-email limit. Verifies that exactly 10 pass, 5 are blocked, and calculated `retryAfterSeconds` are returned.

### 2. Test Crash Recovery & Zombie Lease Healing
```bash
npm run test:crash-recovery
```
Creates a simulated crashed job in `PROCESSING` state with an expired lease timestamp (`NOW() - 120s`). Verifies the reconciliation engine heals the job, resets it to `QUEUED`, and schedules it for retry.

---

## REST API Reference

### Health Check
```http
GET /api/health
```

### Register Sender
```http
POST /api/senders
Content-Type: application/json

{
  "email": "outreach@startup.io",
  "name": "Outreach Sales",
  "hourlyQuota": 200,
  "minDelayMs": 2000
}
```

### Schedule Single Email (Decoupled Ingestion)
```http
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

### Search Outbound Logs (Elasticsearch)
```http
GET /api/search?q=partnership&status=SENT
```

---

## Resume Talking Points

* **Q: Why BullMQ over standard Cron jobs?**
  * *A:* Cron requires recurring table scans that scale poorly with data volume. BullMQ uses Redis Sorted Sets to achieve sub-millisecond precision scheduling without database load.
* **Q: How do you prevent duplicate emails when a worker crashes?**
  * *A:* We combine PostgreSQL row-level locks (`SKIP LOCKED`), a 60-second heartbeat-renewed send lease, idempotency keys, and an automated startup reconciler that sweeps orphaned `PROCESSING` jobs.
* **Q: How does the rate limiter handle multiple distributed workers?**
  * *A:* An atomic Redis Lua script executes eviction, count, and addition in a single atomic transaction, preventing race conditions across concurrent workers.
