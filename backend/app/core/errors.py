from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException


class ErrorDetail(BaseModel):
    code: str
    type: str
    message: str
    request_id: str
    details: Any | None = None


class ErrorEnvelope(BaseModel):
    error: ErrorDetail


class GatewayError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        error_type: str = "gateway_error",
        details: Any | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code, self.code, self.message, self.error_type = (
            status_code,
            code,
            message,
            error_type,
        )
        self.details = details
        self.headers = headers or {}


def error_response(
    request: Request,
    *,
    status_code: int,
    code: str,
    message: str,
    error_type: str,
    details: Any | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "unknown")
    body = ErrorEnvelope(
        error=ErrorDetail(
            code=code, type=error_type, message=message, request_id=request_id, details=details
        )
    )
    resp_headers = {"X-Request-ID": request_id}
    if headers:
        resp_headers.update(headers)
    return JSONResponse(
        status_code=status_code,
        content=body.model_dump(exclude_none=True),
        headers=resp_headers,
    )


async def gateway_error_handler(request: Request, exc: GatewayError) -> JSONResponse:
    return error_response(
        request,
        status_code=exc.status_code,
        code=exc.code,
        message=exc.message,
        error_type=exc.error_type,
        details=exc.details,
        headers=exc.headers,
    )


async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code, message = (
        ("not_found", "The requested resource was not found.")
        if exc.status_code == 404
        else ("bad_request", "Bad request.")
    )
    return error_response(
        request,
        status_code=exc.status_code,
        code=code,
        message=message,
        error_type="invalid_request_error",
    )


async def unhandled_error_handler(request: Request, _: Exception) -> JSONResponse:
    return error_response(
        request,
        status_code=500,
        code="internal_error",
        message="An internal server error occurred.",
        error_type="server_error",
    )
