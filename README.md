# LLMGuard: Enterprise-Grade Secure, Observable LLM Gateway

[![CI](https://github.com/ayushvyas-dev/llmguard/actions/workflows/ci.yml/badge.svg)](https://github.com/ayushvyas-dev/llmguard/actions/workflows/ci.yml)
[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**LLMGuard** is a high-performance, production-grade LLM Gateway and Security Orchestrator. It provides unified, OpenAI-compatible API access, multi-tier threat inspection (prompt injection, jailbreak heuristics, PII masking, secret detection), intelligent fallback routing with adaptive circuit breakers, distributed sliding-window rate limiting, semantic caching, microsecond telemetry, and a zero-trust administrative dashboard.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Request Flow](#request-flow)
- [Tech Stack & Dependencies](#tech-stack--dependencies)
- [Project Folder Structure](#project-folder-structure)
- [Environment Variables](#environment-variables)
- [Setup & Run Instructions](#setup--run-instructions)
  - [Prerequisites](#prerequisites)
  - [Local Development with Docker Compose](#local-development-with-docker-compose)
  - [Backend Setup & Execution](#backend-setup--execution)
  - [Frontend Setup & Execution](#frontend-setup--execution)
  - [Production Docker Build](#production-docker-build)
- [Testing & Quality Verification](#testing--quality-verification)
  - [Backend Unit, Integration & Contract Tests](#backend-unit-integration--contract-tests)
  - [Security Evaluation Benchmark](#security-evaluation-benchmark)
  - [Resilience & Fallback Failure Injection](#resilience--fallback-failure-injection)
  - [Load & Concurrency Testing](#load--concurrency-testing)
  - [Frontend Unit, Accessibility & E2E Tests](#frontend-unit-accessibility--e2e-tests)
- [Deployment](#deployment)

---

## Features

### 🛡️ Multi-Tier Security Engine
- **Prompt Injection & Jailbreak Defense**: Multi-layered heuristic detectors with Unicode normalization (NFKC), homoglyph translation, zero-width space removal, and structural pattern matching.
- **Sensitive Data & Secret Scanning**: High-entropy token detection, regex matching for AWS keys, GitHub PATs, JWTs, private keys, and API tokens.
- **PII Detection & Redaction**: Detection and masking of emails, phone numbers, SSNs, and credit cards with **Luhn algorithm checksum validation**.
- **Output Guardrails**: Post-generation scan to prevent secret leakage, PII echoes, or toxic completion delivery.
- **Security Audit Logs**: Comprehensive security event recording categorized by violation severity and policy action (`BLOCK`, `MASK`, `LOG`, `ALLOW`).

### ⚡ Intelligent Gateway & Routing
- **OpenAI-Compatible Chat API**: Drop-in `/v1/chat/completions` replacement supporting standard request and response schemas.
- **Provider Support**: Out-of-the-box support for **Groq** (`llama-3.3-70b-versatile`), **Google Gemini** (`gemini-2.5-flash-lite`), and **Fake/Mock** providers for reproducible testing.
- **Adaptive Circuit Breakers**: Per-provider error budget tracking with exponential failure counters, automated trip-to-OPEN states, and half-open probes.
- **Dynamic Fallbacks**: Configurable priority fallback chains with jittered exponential backoffs and strict per-attempt deadline budgets.
- **Distributed Rate Limiting**: Redis-backed sliding-window rate limiter per client and API key with graceful in-memory fallback.
- **Semantic Response Caching**: Normalized canonical prompt hashing (SHA-256) with TTL expiration and dynamic bypass headers.

### 📊 Observability & Cost Telemetry
- **Microsecond Waterfall Traces**: Granular latency measurements for every stage: body parsing, rate limiting, security engine, cache lookup, upstream provider TTFT (time-to-first-token), and output filtering.
- **Token Economics**: Accurate token usage accounting and real-time cost estimations based on provider pricing tables.
- **Asynchronous Trace Pipeline**: Background batching trace recorder writing directly to PostgreSQL with dead-letter queue (DLQ) file fallback under extreme load.

### 🖥️ Zero-Trust Admin Console
- **Next.js 16 App Router & React 19**: Modern dark-mode interface built with Tailwind CSS.
- **BFF (Backend-For-Frontend) Security**: HttpOnly encrypted session cookies (`jose`), double-submit CSRF tokens, and zero exposure of provider keys or tenant peppers to client browsers.
- **Interactive API Playground**: Real-time prompt testing with live security evaluation, model switching, fallback simulation, and cost breakdowns.
- **Key & Client Management**: Tenant onboarding, scoped client creation, cryptographic one-time raw secret reveals, and instantaneous key revocation.
- **Live Trace Inspection**: Searchable request logs with full waterfall timelines and fallback audit visualization.

---

## Architecture

LLMGuard employs a layered, zero-trust architecture separating client edge traffic, core security orchestration, upstream provider integration, and administrative controls.

```
+-----------------------------------------------------------------------------------+
|                                  Client Layer                                     |
|  [ External API Consumers / SDKs ]           [ Next.js Admin Console (Port 3000) ]|
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼ HTTPS / JSON
+-----------------------------------------------------------------------------------+
|                        Edge & Gateway Middleware (FastAPI)                        |
|  - Correlation ID (X-Correlation-ID)          - Body Size Guard (10MB Max)        |
|  - Security Headers (HSTS, CSP, XFO)          - Structured JSON Logging           |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
|                           Authentication & Rate Limiting                          |
|  - Tenant API Key Authentication (SHA-256 + Pepper)                               |
|  - Sliding-Window Rate Limiter (Redis 7+ / In-Memory Fallback)                    |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
|                               Security Engine                                     |
|  1. Text Normalization (NFKC, Homoglyphs, Invisible Characters)                   |
|  2. Heuristic Rule Detectors (Prompt Injection, Jailbreaks)                       |
|  3. Secret & PII Scanning (Entropy, Regex, Luhn Checksum)                         |
|  4. Dynamic Policy Evaluation (ALLOW / MASK / BLOCK / LOG)                        |
+-----------------------------------------------------------------------------------+
                                         │
                        [ Cache Hit ]    ▼    [ Cache Miss ]
       ┌─────────────────────────────── ( ? ) ──────────────────────────────┐
       ▼                                                                    ▼
[ Semantic Cache ]                                           [ Gateway Router & Resilience ]
(Redis SHA-256 Key)                                          - Model Catalog Resolution
       │                                                     - Circuit Breaker Checks
       │                                                     - Jittered Backoff Retries
       │                                                     - Dynamic Provider Fallback
       │                                                                    │
       │                                                                    ▼
       │                                                         [ Upstream Providers ]
       │                                                         - Groq API
       │                                                         - Google Gemini API
       │                                                         - Fake / Mock Provider
       │                                                                    │
       │                                                                    ▼
       │                                                         [ Output Guardrails ]
       │                                                         - PII & Secret Redaction
       │                                                         - Leakage Verification
       │                                                                    │
       └───────────────────────────────┬────────────────────────────────────┘
                                       ▼
+-----------------------------------------------------------------------------------+
|                              Response & Audit Telemetry                           |
|  - OpenAI-compatible Response Formatted and Returned to Caller                    |
|  - Async Background Worker: Flush Traces & Usage Records -> PostgreSQL            |
|  - Dead Letter Queue (DLQ) Safeguard on DB Disconnection                          |
+-----------------------------------------------------------------------------------+
```

---

## Request Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client as API Consumer / Playground
    participant GW as Gateway Middleware
    participant Auth as Auth & Rate Limiter
    participant SecIn as Input Security Engine
    participant Cache as Semantic Cache (Redis)
    participant Router as Router & Breaker
    participant Upstream as Upstream LLM (Groq/Gemini)
    participant SecOut as Output Security Engine
    participant Trace as Async Trace Buffer
    participant DB as PostgreSQL Database

    Client->>GW: POST /api/v1/chat/completions
    GW->>GW: Assign X-Correlation-ID & Enforce Body Size
    GW->>Auth: Validate API Key (Hash + Pepper) & Check Rate Limits
    alt Rate Limit Exceeded or Invalid Key
        Auth-->>Client: 429 Too Many Requests / 401 Unauthorized
    end

    Auth->>SecIn: Inspect Prompt (Normalization, Rules, PII, Secrets)
    alt Security Policy Violation (e.g. Injection Detected)
        SecIn-->>Client: 400 Bad Request (Blocked by Security Policy)
        SecIn-)Trace: Record Security Block Event
    end

    SecIn->>Cache: Check Cached Response (SHA-256 Hash)
    alt Cache Hit
        Cache-->>Client: 200 OK (Cached Completion)
        Cache-)Trace: Record Trace (Cache Hit)
    else Cache Miss
        SecIn->>Router: Select Primary Route (e.g., Groq)
        Router->>Router: Check Circuit Breaker Status
        alt Circuit Closed / Healthy
            Router->>Upstream: Forward Completion Request
            alt Provider Times Out or Returns 5xx
                Router->>Router: Trip Breaker / Apply Fallback
                Router->>Upstream: Forward to Secondary (e.g., Gemini)
            end
        end
        Upstream-->>Router: Upstream Model Response
        Router->>SecOut: Inspect Output (PII / Secret Leakage)
        SecOut->>Cache: Store Response (TTL)
        SecOut-->>Client: 200 OK (OpenAI-compatible Payload)
        SecOut-)Trace: Dispatch Background Trace Event
    end

    critical Async Background Persistence
        Trace->>DB: Batch Insert Request Traces & Usage Records
    end
```

---

## Tech Stack & Dependencies

### Backend (`backend/`)
- **Runtime**: Python 3.12+
- **Framework**: [FastAPI](https://fastapi.tiangolo.com/) `^0.115`, [Starlette](https://www.starlette.io/), [Uvicorn](https://www.uvicorn.org/) `^0.32`
- **Data Validation & Settings**: [Pydantic v2](https://docs.pydantic.dev/) and `pydantic-settings` `^2.6`
- **Database & ORM**: PostgreSQL via [SQLAlchemy 2.0 (asyncio)](https://www.sqlalchemy.org/) and [psycopg3 binary](https://www.psycopg.org/) `^3.2`
- **Migrations**: [Alembic](https://alembic.sqlalchemy.org/) `^1.14`
- **Caching & Rate Limiting**: [Redis](https://redis.io/) `^8.1.0` (async connection pooling)
- **Upstream Providers**:
  - [Groq Python SDK](https://github.com/groq/groq-python) `^0.13`
  - [Google GenAI SDK](https://github.com/google/generative-ai-python) `^1.0`
- **Logging**: [Structlog](https://www.structlog.org/) `^24.4` (structured JSON logging)
- **Package Manager**: [uv](https://github.com/astral-sh/uv) (ultra-fast packaging and environment manager)
- **Dev & Test Stack**:
  - `pytest`, `pytest-asyncio`, `pytest-cov`
  - `hypothesis` (property-based fuzzing)
  - `locust` (high-concurrency load testing)
  - `pip-audit` (vulnerability scanning)
  - `ruff` (linter and code formatter)

### Frontend (`frontend/`)
- **Runtime & Framework**: [Next.js 16](https://nextjs.org/) (App Router), [React 19](https://react.dev/), [TypeScript 5](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/), [Lucide React](https://lucide.dev/) (icons), `clsx`, `tailwind-merge`
- **Data Visualization**: [Recharts](https://recharts.org/) `^3.10`
- **Security & Session Management**:
  - [jose](https://github.com/panva/jose) `^6.2` (edge-compatible JWT signing and verification)
  - Zero-trust proxy pattern (`/api/proxy/[...path]`) with Double-Submit Cookie CSRF tokens
- **Testing**:
  - [Vitest](https://vitest.dev/) `^5.0` (speed-optimized unit and component testing)
  - `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`
  - [Playwright](https://playwright.dev/) `^1.64` (Chromium end-to-end browser tests)

---

## Project Folder Structure

```text
llmguard/
├── .github/
│   └── workflows/
│       └── ci.yml                 # GitHub Actions CI (Lint, Format, Test, Docker Build)
├── backend/
│   ├── alembic/                   # Database migration scripts
│   │   ├── env.py
│   │   └── versions/              # 0001 (baseline) to 0004 (traces & usage)
│   ├── app/
│   │   ├── api/                   # FastAPI route handlers
│   │   │   ├── admin/             # Overview, clients, keys, policies, traces, playground
│   │   │   ├── auth/              # Admin session authentication
│   │   │   ├── chat.py            # OpenAI-compatible /v1/chat/completions
│   │   │   └── health.py          # Liveness and readiness endpoints (/health, /health/ready)
│   │   ├── audit/                 # Audit logging and event formatting
│   │   ├── auth/                  # API key verification, hashing, and token services
│   │   ├── cache/                 # Redis semantic caching layer
│   │   ├── core/                  # Configuration, logging, exception handlers
│   │   ├── db/                    # SQLAlchemy async models, session, and seed data
│   │   ├── gateway/               # Gateway orchestration pipelines
│   │   ├── middleware/            # Correlation ID, body size limit, error handling
│   │   ├── observability/         # Background trace recorder and microsecond timers
│   │   ├── providers/             # Adapters for Groq, Gemini, and Fake providers
│   │   ├── ratelimit/             # Sliding-window distributed rate limiter
│   │   ├── routing/               # Router, priority fallback, and circuit breakers
│   │   ├── schemas/               # Pydantic schemas (chat, admin, policies, traces)
│   │   ├── security/              # Security engine, detectors (PII, rules, secrets), policies
│   │   └── usage/                 # Token estimation and pricing models
│   ├── config/                    # Seed configurations (models, pricing, default policies)
│   ├── tests/
│   │   ├── contract/              # OpenAPI snapshot drift tests
│   │   ├── integration/           # API integration and fallback resilience tests
│   │   ├── load/                  # Locust load test scripts and automated runner
│   │   ├── security_eval/         # Automated security benchmarking and evaluation suites
│   │   └── unit/                  # Unit tests for all backend subsystems
│   ├── .dockerignore
│   ├── .env.example               # Backend environment template (46 documented vars)
│   ├── .gitignore
│   ├── Dockerfile                 # Multi-stage lightweight Docker image (~84MB)
│   ├── main.py                    # Root entrypoint for Uvicorn
│   └── pyproject.toml             # uv package dependencies and tool configurations
├── frontend/
│   ├── e2e/                       # Playwright browser end-to-end tests
│   ├── src/
│   │   ├── app/                   # Next.js App Router pages
│   │   │   ├── api/               # Server-side auth, proxy, and CSRF endpoints
│   │   │   ├── clients/           # Tenant and API key management
│   │   │   ├── playground/        # Interactive model and policy playground
│   │   │   ├── policies/          # Policy editor (security and routing rules)
│   │   │   ├── providers/         # Provider health and circuit breaker monitors
│   │   │   ├── security/          # Security events log and threat analytics
│   │   │   ├── traces/            # Waterfall trace browser and detail viewer
│   │   │   ├── login/             # Secure admin authentication screen
│   │   │   ├── layout.tsx         # Root layout with sidebar navigation
│   │   │   └── page.tsx           # Telemetry overview dashboard
│   │   ├── components/            # Reusable UI components (header, shell, dialogs)
│   │   ├── lib/                   # API clients, session encryption, and utility helpers
│   │   └── test/                  # Vitest unit and accessibility tests
│   ├── .env.example               # Frontend environment template
│   ├── .gitignore
│   ├── package.json               # Node.js dependencies and scripts
│   ├── playwright.config.ts       # Playwright E2E configuration
│   └── vitest.config.mts          # Vitest testing setup
├── docs/
│   └── reports/                   # Security, load, and fallback verification reports
├── .gitignore                     # Monorepo root gitignore
├── docker-compose.yml             # Local PostgreSQL and Redis infrastructure
├── README.md                      # Project documentation
├── requirements.md                # System requirements specification
└── sequence.md                    # Architecture and implementation execution tracker
```

---

## Environment Variables

### Backend Configuration (`backend/.env`)

Copy `backend/.env.example` to `backend/.env` and adjust the variables:

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `DATABASE_URL` | Async PostgreSQL connection string | `postgresql+psycopg://postgres:postgres@localhost:5432/llmguard` |
| `DATABASE_URL_DIRECT` | Direct sync connection for Alembic migrations | `postgresql://postgres:postgres@localhost:5432/llmguard` |
| `REDIS_URL` | Redis URL for rate limiting and semantic caching | `redis://localhost:6379/0` |
| `API_KEY_PEPPER` | 64-char hex string for cryptographic API key hashing | *Required in production* |
| `GROQ_API_KEY` | Upstream API key for Groq | `gsk_...` |
| `GEMINI_API_KEY` | Upstream API key for Google Gemini | `AIza...` |
| `ALLOWED_ORIGINS` | Permitted CORS origins (comma-separated) | `http://localhost:3000,http://127.0.0.1:3000` |
| `MAX_REQUEST_BODY_BYTES` | Maximum incoming payload size in bytes | `10485760` (10 MB) |
| `TRACE_FLUSH_INTERVAL_SECONDS` | Background trace batch writer interval | `2.0` |

> [!TIP]
> Generate a secure `API_KEY_PEPPER` using Python:
> ```bash
> python3 -c "import secrets; print(secrets.token_hex(32))"
> ```

### Frontend Configuration (`frontend/.env.local`)

Copy `frontend/.env.example` to `frontend/.env.local`:

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `BACKEND_API_URL` | Base URL of the running FastAPI backend | `http://127.0.0.1:8000` |
| `SESSION_SECRET` | 32+ character key used to encrypt session JWTs | `llmguard-admin-session-secret-at-least-32-chars-long` |
| `NODE_ENV` | Application environment | `development` |

---

## Setup & Run Instructions

### Prerequisites
- **Python 3.12+**
- **uv**: Fast Python package installer (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- **Node.js 20+** and **npm**
- **Docker & Docker Compose**

---

### Local Development with Docker Compose

1. **Start PostgreSQL and Redis:**
   ```bash
   docker compose up -d
   ```
   This spins up:
   - PostgreSQL on `localhost:5432` (database: `llmguard`)
   - Redis on `localhost:6379`

---

### Backend Setup & Execution

1. **Install dependencies using `uv`:**
   ```bash
   cd backend
   uv sync --all-groups
   ```

2. **Apply database migrations:**
   ```bash
   uv run alembic upgrade head
   ```

3. **Seed default models, pricing, and initial admin key:**
   ```bash
   uv run python -m app.db.seed
   ```
   *Note: Note down the generated admin master API key printed in the output.*

4. **Start the backend development server:**
   ```bash
   uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```
   - API Root: `http://localhost:8000`
   - Interactive OpenAPI Docs: `http://localhost:8000/docs`
   - Health Check: `http://localhost:8000/api/v1/health`

---

### Frontend Setup & Execution

1. **Install frontend dependencies:**
   ```bash
   cd frontend
   npm install
   ```

2. **Run the Next.js development server:**
   ```bash
   npm run dev
   ```

3. **Open the Admin Console:**
   - Navigate to [http://localhost:3000](http://localhost:3000).
   - Sign in using the Admin Master Key generated during backend seeding.

---

### Production Docker Build

The backend includes an optimized multi-stage `Dockerfile` built on `python:3.12-slim` using `uv`:

```bash
cd backend

# Build Docker image
docker build -t llmguard-backend:latest .

# Run container with dynamic port (Render compatible)
docker run -d \
  --name llmguard \
  -p 8000:8000 \
  -e PORT=8000 \
  -e DATABASE_URL="postgresql+psycopg://user:pass@host:5432/db" \
  -e DATABASE_URL_DIRECT="postgresql://user:pass@host:5432/db" \
  -e REDIS_URL="redis://host:6379/0" \
  -e API_KEY_PEPPER="your-64-character-hex-pepper" \
  llmguard-backend:latest
```

---

## Testing & Quality Verification

LLMGuard maintains a rigorous test suite spanning unit tests, integration scenarios, contract tests, security evaluations, load benchmarks, and frontend end-to-end flows.

### Backend Unit, Integration & Contract Tests

```bash
cd backend

# Run all 230+ automated tests with coverage
uv run pytest tests/unit tests/integration tests/contract -v --cov=app

# Run OpenAPI schema stability snapshot test
uv run pytest tests/contract/test_openapi_snapshot.py

# Lint and format checks
uv run ruff check .
uv run ruff format --check .

# Dependency vulnerability audit
uv run pip-audit
```

---

### Benchmark & Reliability Reports

LLMGuard maintains reproducible benchmark suites spanning security inspection accuracy, high-concurrency performance, provider resilience, and reliability regression testing:

- **Executive Summary & Overview**: [`docs/reports/benchmark_summary.md`](docs/reports/benchmark_summary.md)
- **Security Evaluation (178 test cases)**: [`docs/reports/security_eval.md`](docs/reports/security_eval.md)
- **Load & Concurrency (18,000 requests)**: [`docs/reports/load_test_report.md`](docs/reports/load_test_report.md)
- **Resilience & Fallback (100 executions)**: [`docs/reports/resilience_and_fallback.md`](docs/reports/resilience_and_fallback.md)
- **Reliability & Regressions (278 automated tests)**: [`docs/reports/reliability_and_regression.md`](docs/reports/reliability_and_regression.md)

---

### Security Evaluation Benchmark

Evaluates detector recall, precision, and false-positive rates (FPR) across adversarial prompt injection, jailbreak, sensitive PII, and secret leak datasets:

```bash
cd backend
uv run python -m tests.security_eval.run --dataset all --report ../docs/reports/security_eval.md
```
*Full report generated at: [`docs/reports/security_eval.md`](docs/reports/security_eval.md)*

---

### Resilience & Fallback Failure Injection

Simulates transient 503s, 500 internal errors, 429 rate limits, downstream network timeouts, and cascading provider outages to verify that circuit breakers trip and requests fallback cleanly without bypassing security checks:

```bash
cd backend
# Comprehensive 10-scenario, 10-repetition benchmark suite
uv run python -m tests.resilience.run_resilience_benchmark --report ../docs/reports/resilience_and_fallback.md --reps 10

# Or standard integration test
uv run pytest tests/integration/test_failure_injection.py -v
```
*Full report generated at: [`docs/reports/resilience_and_fallback.md`](docs/reports/resilience_and_fallback.md)*

---

### Load & Concurrency Testing

Simulates high-concurrency client workloads (10 to 50 concurrent virtual users) to measure throughput (RPS), p50/p90/p95/p99 latencies, error rates, timeout rates, and security pipeline overhead across cache-enabled and cache-disabled scenarios:

```bash
cd backend

# Automated headless load test runner (18,000 requests across concurrency levels 10, 25, 50)
uv run python -m tests.load.run_load_test --requests 1000 --runs 3 --report ../docs/reports/load_test_report.md

# Or interactive Locust dashboard
uv run locust -f tests/load/locustfile.py --host http://localhost:8000
```
*Full report generated at: [`docs/reports/load_test_report.md`](docs/reports/load_test_report.md)*

---

### Frontend Unit, Accessibility & E2E Tests

```bash
cd frontend

# Typecheck and linting
npm run lint
npx tsc --noEmit

# Unit, component, and accessibility (a11y) tests (Vitest)
npm run test

# End-to-End browser journeys (Playwright)
npm run test:e2e

# Verify production Next.js build
npm run build
```

---

## Deployment

LLMGuard is engineered for zero-downtime deployment on modern cloud platforms:

- **Backend (FastAPI)**: Deployable as a Docker Web Service on **Render**, **Railway**, **Fly.io**, or **AWS ECS/Fargate**. It automatically binds to `$PORT` and provides a zero-dependency health check at `/api/v1/health`.
- **Frontend (Next.js)**: Deployable on **Vercel**, **Cloudflare Pages**, or **Netlify** with standard Next.js preset.
- **Database & Cache**: Compatible with **Neon**, **Supabase**, or **AWS RDS** (PostgreSQL) and **Upstash** or **Redis Cloud**.

For detailed production deployment walkthroughs, consult [`requirements.md`](requirements.md) and [`sequence.md`](sequence.md).
