from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from config import settings

# pool_recycle=1800: connections idle for > 30 min are replaced before use,
# preventing "server closed the connection unexpectedly" on long-running API
# processes. Celery tasks must NOT use this engine — they call task_db() which
# creates a NullPool engine per-task to avoid asyncpg loop-binding issues.
engine = create_async_engine(
    settings.async_database_url,
    pool_size=10,
    max_overflow=20,
    pool_recycle=1800,
    echo=False,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


@asynccontextmanager
async def task_db():
    """
    Async context manager that provides a session factory for Celery tasks.

    Celery tasks call asyncio.run() which creates a fresh event loop per task.
    asyncpg connection pools bind to the loop that created them, so reusing the
    module-level pooled engine across asyncio.run() calls raises
    'Future attached to a different loop'. NullPool avoids this.

    One engine is created per task invocation and disposed on exit — no
    connection leaks, no loop binding issues.

    Usage:
        async with task_db() as make_session:
            async with make_session() as db:
                ...
    """
    task_engine = create_async_engine(settings.async_database_url, poolclass=NullPool)
    try:
        yield async_sessionmaker(task_engine, class_=AsyncSession, expire_on_commit=False)
    finally:
        await task_engine.dispose()


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
