from fastapi import APIRouter, Query, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(probe: int | None = Query(default=None)) -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready", response_model=None)
async def readiness(request: Request) -> JSONResponse | dict[str, object]:
    try:
        async with request.app.state.engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "unavailable", "checks": {"database": "unavailable"}},
        )
    return {"status": "ok", "checks": {"database": "ok", "redis": "not_checked"}}
