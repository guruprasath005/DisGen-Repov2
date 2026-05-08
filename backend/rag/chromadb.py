"""
ChromaDB client for scheme RAG (Retrieval-Augmented Generation).

One collection per scheme named after the scheme ID (e.g. "pmjay", "cghs").
Uses ChromaDB's default embedding model (all-MiniLM-L6-v2) — works offline.

Seeding is idempotent: if the collection already has documents, skip seeding.
Call seed_all_builtin_schemes() once at application startup.
"""

import logging
from typing import Optional

import chromadb
from chromadb.config import Settings as ChromaSettings

from config import settings

logger = logging.getLogger(__name__)

_client: Optional[chromadb.HttpClient] = None


def get_client() -> chromadb.HttpClient:
    global _client
    if _client is None:
        _client = chromadb.HttpClient(
            host=settings.chroma_host,
            port=settings.chroma_port,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
    return _client


def _get_or_create_collection(scheme_id: str) -> chromadb.Collection:
    return get_client().get_or_create_collection(
        name=scheme_id,
        metadata={"hnsw:space": "cosine"},
    )


def seed_scheme(scheme_id: str, chunks: list[str]) -> None:
    """
    Seed RAG chunks for a scheme into ChromaDB.
    Skips if the collection already contains documents.
    """
    collection = _get_or_create_collection(scheme_id)
    if collection.count() > 0:
        logger.info("ChromaDB collection '%s' already seeded (%d docs), skipping", scheme_id, collection.count())
        return

    ids = [f"{scheme_id}_{i}" for i in range(len(chunks))]
    metadatas = [{"scheme_id": scheme_id, "chunk_index": i} for i in range(len(chunks))]

    collection.add(documents=chunks, metadatas=metadatas, ids=ids)
    logger.info("ChromaDB: seeded %d chunks into collection '%s'", len(chunks), scheme_id)


def seed_all_builtin_schemes() -> None:
    """Seed all built-in schemes. Call once at startup."""
    from schemes.data import ALL_SCHEMES

    for scheme in ALL_SCHEMES:
        try:
            seed_scheme(scheme.id, scheme.rag_chunks)
        except Exception:
            logger.exception("Failed to seed ChromaDB collection for scheme '%s'", scheme.id)


def get_relevant_rules(scheme_id: str, query: str, top_k: int = 3) -> list[str]:
    """
    Retrieve the top-k most relevant rule chunks for a scheme given a query.
    Returns empty list if the collection doesn't exist or is empty.
    """
    try:
        collection = _get_or_create_collection(scheme_id)
        if collection.count() == 0:
            logger.warning("ChromaDB collection '%s' is empty — no RAG rules available", scheme_id)
            return []

        results = collection.query(
            query_texts=[query],
            n_results=min(top_k, collection.count()),
        )
        documents = results.get("documents", [[]])
        return documents[0] if documents else []
    except Exception:
        logger.exception("ChromaDB query failed for scheme '%s'", scheme_id)
        return []


def delete_scheme_collection(scheme_id: str) -> None:
    """Delete a scheme's ChromaDB collection (called when a custom scheme is deleted)."""
    try:
        get_client().delete_collection(scheme_id)
        logger.info("ChromaDB collection '%s' deleted", scheme_id)
    except Exception:
        logger.warning("Could not delete ChromaDB collection '%s' (may not exist)", scheme_id)
