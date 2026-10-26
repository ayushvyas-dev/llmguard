# ==============================================================================
# Multi-stage Lightweight & Optimized Dockerfile for LLMGuard Backend
# Compatible with Render, Fly.io, Railway, AWS ECS, and local Docker
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Dependency Builder
# ------------------------------------------------------------------------------
FROM python:3.12-slim AS builder

# Install uv directly from Astral's official minimal image
COPY --from=ghcr.io/astral-sh/uv:0.5.24 /uv /bin/uv

# Compile bytecode for faster container startup and cache efficiency
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Copy dependency specifications first to leverage Docker layer caching
COPY pyproject.toml uv.lock ./

# Install only production dependencies into isolated virtualenv (exclude dev group)
RUN uv sync --frozen --no-dev --no-install-project

# ------------------------------------------------------------------------------
# Stage 2: Minimal Runtime Image
# ------------------------------------------------------------------------------
FROM python:3.12-slim AS final

# Standard production Python runtime optimizations
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app" \
    PORT=8000

WORKDIR /app

# Create a non-root system user and group for container security
RUN groupadd -g 10001 llmguard && \
    useradd -u 10001 -g llmguard -s /bin/sh -d /app -M llmguard

# Copy the pre-built virtualenv from the builder stage
COPY --from=builder --chown=llmguard:llmguard /app/.venv /app/.venv

# Copy database migration configs and application source code
COPY --chown=llmguard:llmguard alembic.ini ./
COPY --chown=llmguard:llmguard alembic/ ./alembic/
COPY --chown=llmguard:llmguard config/ ./config/
COPY --chown=llmguard:llmguard app/ ./app/
COPY --chown=llmguard:llmguard main.py ./

# Drop privileges to non-root user
USER llmguard

# Expose default port (Render will override via $PORT environment variable)
EXPOSE 8000

# Zero-dependency health check using standard library urllib
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request, os; port = os.getenv('PORT', '8000'); urllib.request.urlopen(f'http://127.0.0.1:{port}/api/v1/health')"

# Start Uvicorn bound to 0.0.0.0 and dynamic $PORT with proxy headers for cloud reverse proxies (Render)
CMD ["sh", "-c", "exec python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers --forwarded-allow-ips '*'"]
