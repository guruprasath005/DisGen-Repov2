import asyncio
import os
import sys
from logging.config import fileConfig
from pathlib import Path

# Add the backend root to sys.path so imports like `from database import Base` work
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override URL from environment — supports the running container's DATABASE_URL
_db_url = os.getenv("DATABASE_URL", "postgresql://disgen:changeme@postgres:5432/disgen")
_async_url = _db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
config.set_main_option("sqlalchemy.url", _async_url)

# We use explicit (non-autogenerate) migrations, so we don't need models imported here.
# target_metadata is only needed if you run `alembic revision --autogenerate`.
target_metadata = None


def do_run_migrations(connection):
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online():
    url = config.get_main_option("sqlalchemy.url")
    connectable = create_async_engine(url, echo=False)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_offline():
    """Generate SQL script without a live DB connection."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
