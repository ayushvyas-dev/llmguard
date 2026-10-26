from typing import Any

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.core.errors import error_response


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Any, max_bytes: int) -> None:
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > self.max_bytes:
            return error_response(
                request,
                status_code=413,
                code="request_too_large",
                message="Request body exceeds the configured limit.",
                error_type="invalid_request_error",
            )
        body = await request.body()
        if len(body) > self.max_bytes:
            return error_response(
                request,
                status_code=413,
                code="request_too_large",
                message="Request body exceeds the configured limit.",
                error_type="invalid_request_error",
            )
        return await call_next(request)
