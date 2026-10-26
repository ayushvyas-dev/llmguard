import asyncio

from sqlalchemy import select

from app.core.config import get_settings
from app.db.models import Provider, ProviderModel
from app.db.session import make_engine, make_session_factory
from app.providers.catalog import ModelCatalog


async def seed_models() -> None:
    settings = get_settings()
    engine = make_engine(settings)
    session_factory = make_session_factory(engine)
    try:
        async with session_factory.begin() as session:
            for model in ModelCatalog.from_seed().models.values():
                if model.provider == "fake":
                    continue
                existing = await session.scalar(
                    select(ProviderModel).where(ProviderModel.alias == model.alias)
                )
                if not existing:
                    session.add(
                        ProviderModel(
                            alias=model.alias,
                            provider=Provider(model.provider),
                            provider_model_id=model.provider_model_id,
                            capabilities=model.capabilities,
                        )
                    )
                else:
                    existing.provider_model_id = model.provider_model_id
                    existing.capabilities = model.capabilities
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed_models())
