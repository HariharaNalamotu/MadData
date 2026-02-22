"""
Milvus / Zilliz Cloud vector store operations.
Uses the high-level MilvusClient API (pymilvus >= 2.4).
"""

from __future__ import annotations

import logging
import os
from typing import List

from pymilvus import MilvusClient, DataType

logger = logging.getLogger(__name__)

COLLECTION = "legal_docs"
EMBED_DIM = 768

_client: MilvusClient | None = None


def get_client() -> MilvusClient:
    global _client
    if _client is None:
        uri = os.environ["CLUSTER_ENDPOINT"]
        token = os.environ["TOKEN"]
        _client = MilvusClient(uri=uri, token=token)
        logger.info("Milvus client connected to %s", uri)
    return _client


def _create_collection(client: MilvusClient) -> None:
    """Internal: create the collection schema and index from scratch."""
    schema = client.create_schema(auto_id=True, enable_dynamic_field=False)
    schema.add_field("id",          DataType.INT64,        is_primary=True)
    schema.add_field("doc_id",      DataType.VARCHAR,      max_length=64)
    schema.add_field("chunk_index", DataType.INT64)
    schema.add_field("header",      DataType.VARCHAR,      max_length=512)
    schema.add_field("text",        DataType.VARCHAR,      max_length=8192)
    schema.add_field("embedding",   DataType.FLOAT_VECTOR, dim=EMBED_DIM)

    index_params = client.prepare_index_params()
    index_params.add_index(
        field_name="embedding",
        index_type="AUTOINDEX",
        metric_type="COSINE",
    )

    client.create_collection(
        collection_name=COLLECTION,
        schema=schema,
        index_params=index_params,
    )
    logger.info("Collection '%s' created.", COLLECTION)


def reset_collection() -> None:
    """Drop the collection (if it exists) and recreate it empty.

    Called on startup and on shutdown so the DB is always wiped clean
    at both ends of the server's lifetime.
    """
    client = get_client()
    if client.has_collection(COLLECTION):
        client.drop_collection(COLLECTION)
        logger.info("Collection '%s' dropped.", COLLECTION)
    _create_collection(client)


def ensure_collection() -> None:
    """Create the collection + index if it does not already exist."""
    client = get_client()
    if client.has_collection(COLLECTION):
        logger.info("Collection '%s' already exists.", COLLECTION)
        return
    _create_collection(client)


def insert_chunks(doc_id: str, chunks: List[dict], embeddings: List[List[float]]) -> int:
    """
    Insert encoded chunks into Milvus.

    Args:
        doc_id:     Unique document identifier (UUID string).
        chunks:     List of {header, text, chunk_index} dicts from chunker.py.
        embeddings: Parallel list of 768-dim float vectors from encoder.py.

    Returns:
        Number of rows inserted.
    """
    client = get_client()
    rows = []
    for chunk, emb in zip(chunks, embeddings):
        rows.append({
            "doc_id":      doc_id,
            "chunk_index": int(chunk["chunk_index"]),
            "header":      chunk["header"][:512],
            "text":        chunk["text"][:8192],
            "embedding":   emb,
        })

    result = client.insert(collection_name=COLLECTION, data=rows)
    count = result.get("insert_count", len(rows))
    logger.info("Inserted %d chunks for doc_id=%s", count, doc_id)
    return count


def delete_document(doc_id: str) -> None:
    """Delete all chunks belonging to a document."""
    client = get_client()
    client.delete(
        collection_name=COLLECTION,
        filter=f'doc_id == "{doc_id}"',
    )
    logger.info("Deleted all chunks for doc_id=%s", doc_id)


def search_similar(
    query_embedding: List[float],
    doc_id: str,
    top_k: int = 5,
) -> List[dict]:
    """
    ANN search filtered to a single document.

    Returns:
        List of {header, text, chunk_index, score} dicts, sorted by score desc.
    """
    client = get_client()
    results = client.search(
        collection_name=COLLECTION,
        data=[query_embedding],
        limit=top_k,
        filter=f'doc_id == "{doc_id}"',
        output_fields=["header", "text", "chunk_index"],
        search_params={"metric_type": "COSINE", "params": {}},
    )
    hits = []
    for hit in results[0]:
        hits.append({
            "header":      hit["entity"]["header"],
            "text":        hit["entity"]["text"],
            "chunk_index": hit["entity"]["chunk_index"],
            "score":       round(hit["distance"], 4),
        })
    return hits
