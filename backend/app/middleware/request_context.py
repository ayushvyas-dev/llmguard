import re
from uuid import uuid4

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

CORRELATION_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope["headers"])
        received = headers.get(b"x-correlation-id", b"").decode("latin-1")
        correlation_id = received if CORRELATION_ID_PATTERN.fullmatch(received) else None
        request_id = f"req_{uuid4().hex}"
        scope.setdefault("state", {})["request_id"] = request_id
        scope["state"]["correlation_id"] = correlation_id or request_id

        async def send_with_ids(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = MutableHeaders(scope=message)
                response_headers["X-Request-ID"] = request_id
                response_headers["X-Correlation-ID"] = correlation_id or request_id
            await send(message)

        await self.app(scope, receive, send_with_ids)
