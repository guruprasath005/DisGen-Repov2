"""
MinIO client singleton — shared across API and Celery worker processes.

One Minio instance per process. The MinIO SDK manages its own connection pool
internally, so repeated calls to get_minio() are inexpensive.

secure=False: TLS is terminated at nginx. The internal minio:9000 endpoint
communicates over plain HTTP on the isolated disgen_net Docker network.
"""

from __future__ import annotations

import logging

from minio import Minio

from config import settings

logger = logging.getLogger(__name__)

_minio: Minio | None = None


def get_minio() -> Minio:
    """Return the process-level MinIO singleton, creating it on first call."""
    global _minio
    if _minio is None:
        _minio = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=False,
        )
        logger.info("MinIO client initialised (endpoint=%s)", settings.minio_endpoint)
    return _minio
