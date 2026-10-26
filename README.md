# LLMGuard: Secure, Observable LLM Gateway

LLMGuard is a production-grade LLM Gateway providing unified API access, multi-tier security inspection (prompt injection, jailbreak, PII masking, secret detection), intelligent fallback routing, distributed rate-limiting, semantic caching, and granular usage telemetry.

---

## Architecture Overview

```
[ Client Application ]
         │ (OpenAI-compatible Chat Completion Request)
         ▼
[ Body Size Limit & Request Context Middlewares ]
         │ (Correlation IDs, Client Authentication, SHA-256 Key Hashes)
         ▼
[ Distributed Rate Limiter ] ─── (Redis Sliding Window / Memory Fallback)
         │
         ▼
[ Security Engine ]
   ├── Input Normalization (Unicode NFKC, Homoglyphs, Zero-Width Stripping)
   ├── Rule Detectors (Prompt Injection, Jailbreak heuristics)
   ├── Sensitive Data Detectors (PII Regex & Luhn card validation, Secrets)
   └── Policy Resolution & Redaction Pipeline
         │
         ▼
[ Gateway Cache ] ────────────── (SHA-256 Semantic Key, Redis / In-Memory TTL)
         │ (Cache Miss)
         ▼
[ Gateway Router & Resilience ]
   ├── Model Catalog Resolution (Fake, Groq, Google Gemini)
   ├── Adaptive Circuit Breakers & Health Tracking
   ├── Jittered Exponential Backoff & Per-Attempt Budgets
   └── Dynamic Provider Fallback
         │
         ▼
[ Upstream Providers ] (Groq / Gemini / Fake)
         │
         ▼
[ Output Security Engine ] (PII / Secret / Toxicity Leakage Verification)
         │
         ▼
[ Observability & Audit Pipeline ]
   ├── Asynchronous Buffered Trace Writer
   └── Usage Tracking & Accurate Token Cost Estimation
```

---

## Quick Start & Setup

### 1. Prerequisites
- Python 3.12+
- `uv` (Fast Python package manager)
- Docker & Docker Compose (for PostgreSQL and Redis)

### 2. Environment Configuration
```bash
cp .env.example .env
# Edit .env with your GROQ_API_KEY and GEMINI_API_KEY (optional for mock tests)
```

### 3. Spin up Infrastructure
```bash
docker compose up -d
```

### 4. Install Dependencies & Initialize Database
```bash
cd backend
uv sync --all-groups
uv run alembic upgrade head
uv run python -m app.db.seed
```

### 5. Run Development Server
```bash
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
- API Base URL: `http://localhost:8000`
- Interactive OpenAPI Docs: `http://localhost:8000/docs`

---

## Security, Evaluation & Verification Suite

LLMGuard includes comprehensive verification and benchmarking tools:

### 1. Full Security Evaluation Suite
Evaluates detector recall, false positive rates (FPR), precision, F1 score, and latency across versioned datasets (natural, obfuscated, multilingual) and held-out test splits.
```bash
cd backend
uv run python -m tests.security_eval.run --dataset all --report ../docs/reports/security_eval.md
```
Report generated at: `docs/reports/security_eval.md`

### 2. Failure-Injection & Fallback Resilience
Runs automated failure scenarios (transient 503s, server errors, cascading provider failures) to measure fallback success rate within strict deadline budgets.
```bash
cd backend
uv run pytest tests/integration/test_failure_injection.py -v
```
Report generated at: `docs/reports/resilience_and_fallback.md`

### 3. Load & Concurrency Benchmarking
Simulates high-concurrency traffic (10 to 50 concurrent clients) measuring throughput (RPS), p50/p95/p99 roundtrip latencies, and gateway internal overhead.
```bash
cd backend
# Automated headless benchmark runner
uv run python -m tests.load.run_load_test --report ../docs/reports/load_test_report.md

# Or via Locust CLI
uv run locust -f tests/load/locustfile.py --headless -u 25 -r 5 -t 30s --host http://localhost:8000
```
Report generated at: `docs/reports/load_test_report.md`

### 4. OpenAPI Contract Stability Testing
Enforces contract freeze and ensures no accidental breaking changes occur to the OpenAPI schema without an explicit update.
```bash
cd backend
uv run pytest tests/contract/test_openapi_snapshot.py
```

### 5. Dependency Audit & Secret Scanning
```bash
cd backend
# Vulnerability scanning across all dependencies
uv run pip-audit

# Static secret scanner ensuring no credentials in source or config
uv run pytest tests/unit/test_secret_scan.py
```

### 6. Full Test Suite & Coverage
```bash
cd backend
uv run pytest --cov=app --cov-report=term-missing
uv run ruff check .
uv run ruff format --check .
```

---

## Frontend Admin Console & Dashboard

The LLMGuard frontend is a zero-trust, dark-mode administrative console built with Next.js 16 (App Router), React 19, TypeScript, and Tailwind CSS. It communicates securely with the backend via server-side session cookies (signed JWTs via `jose`), ensuring no upstream or tenant credentials are ever exposed to client browsers.

### Key Capabilities
- **Overview & Telemetry (`/`)**: Live request metrics, success rates, p50/p95/p99 latency distributions, token economics, and security alerts.
- **API Playground (`/playground`)**: Interactive prompt testing environment with live policy enforcement, fallback simulation, token usage, and detector breakdown.
- **Audit Traces (`/traces`)**: Real-time searchable request logs with step-by-step waterfall execution timelines and fallback journey visualization.
- **Client & Key Governance (`/clients`)**: Tenant management, client provisioning, scoped API key creation with cryptographic one-time secret reveals, and instant revocation.
- **Policy Engine (`/policies`)**: Dynamic routing, fallback priorities, rate limiting, and detection sensitivity configuration.
- **Provider Health (`/providers`)**: Upstream circuit breaker states, error rates, and latency monitoring.

### 1. Environment Configuration
Create `frontend/.env.local` (or configure via environment):
```bash
# Backend Gateway API Base URL
BACKEND_API_URL=http://127.0.0.1:8000

# Secret key used for signing session tokens (min 32 characters)
SESSION_SECRET=llmguard-admin-session-secret-at-least-32-chars-long
```

### 2. Install Dependencies & Run Locally
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser. Log in with your admin master key (seeded by default as `lg_admin_master_key_for_testing_only`).

### 3. Frontend Quality & Test Suite
The frontend incorporates comprehensive unit, component, accessibility (a11y), and browser-level end-to-end (E2E) suites:

```bash
cd frontend

# Code Linting & Static Typing
npm run lint
npx tsc --noEmit

# Unit, Component & A11y Tests (Vitest + Testing Library)
npm run test

# End-to-End User Journeys (Playwright Chromium)
npm run test:e2e

# Production Build Verification
npm run build
```

---

## Performance & Hardening Reports

- **Security Evaluation**: [`docs/reports/security_eval.md`](docs/reports/security_eval.md)
- **Load & Latency Benchmarks**: [`docs/reports/load_test_report.md`](docs/reports/load_test_report.md)
- **Resilience & Fallback Matrix**: [`docs/reports/resilience_and_fallback.md`](docs/reports/resilience_and_fallback.md)

