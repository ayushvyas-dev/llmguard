from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db.models import SecurityEvent


class SecurityEventWriter:
    def __init__(self, session_factory: async_sessionmaker) -> None:
        self.session_factory = session_factory

    async def write(self, rows: list[dict]) -> None:
        async with self.session_factory.begin() as session:
            session.add_all(SecurityEvent(**row) for row in rows)
