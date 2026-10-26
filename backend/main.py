"""Root entrypoint alias allowing 'uv run uvicorn main:app --reload' from backend directory."""

from app.main import app

__all__ = ["app"]
