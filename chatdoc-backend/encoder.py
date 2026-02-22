"""
Legal-BERT embeddings via HuggingFace InferenceClient.

Model: BAAI/bge-base-en-v1.5
  - 768-dim sentence-transformer model, excellent for semantic similarity
  - Runs remotely on HF serverless infrastructure — zero local RAM
  - Response shape: [batch, 768] (already pooled by BGE)

Large-document handling:
  - batch_size=32 keeps the number of HF API calls low (200 chunks → 7 calls)
  - Each batch retries up to 3 times with exponential backoff (handles 429 / 503)
  - 0.5 s inter-batch delay avoids rate-limit bursts on free-tier HF accounts
"""

from __future__ import annotations

import logging
import os
import time
from typing import List, Union

import numpy as np
from huggingface_hub import InferenceClient

logger = logging.getLogger(__name__)

EMBED_MODEL = "BAAI/bge-base-en-v1.5"
EMBED_DIM = 768

_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 1.0   # seconds; doubles on each retry

_client: InferenceClient | None = None


def get_client() -> InferenceClient:
    global _client
    if _client is None:
        _client = InferenceClient(token=os.environ.get("HF_TOKEN", ""))
    return _client


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _encode_batch_with_retry(batch: List[str]) -> np.ndarray:
    """
    Call the HF feature-extraction endpoint for one batch, retrying on
    transient errors (rate-limit 429, server-side 503, network blips).
    Raises on the final attempt.
    """
    delay = _RETRY_BASE_DELAY
    last_exc: Exception | None = None

    for attempt in range(_MAX_RETRIES + 1):
        try:
            result = get_client().feature_extraction(batch, model=EMBED_MODEL)
            return np.array(result, dtype=np.float32)
        except Exception as exc:
            last_exc = exc
            if attempt == _MAX_RETRIES:
                break
            logger.warning(
                "Batch embed attempt %d/%d failed (%s) — retrying in %.1f s",
                attempt + 1, _MAX_RETRIES, exc, delay,
            )
            time.sleep(delay)
            delay *= 2  # exponential backoff

    raise RuntimeError(f"Embedding failed after {_MAX_RETRIES} retries: {last_exc}") from last_exc


def _maybe_normalize(vec: np.ndarray, normalize: bool) -> List[float]:
    if normalize:
        norm = float(np.linalg.norm(vec))
        if norm > 0:
            vec = vec / norm
    return vec.tolist()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def encode(
    texts: Union[str, List[str]],
    max_length: int = 256,
    normalize: bool = True,
    batch_size: int = 32,
) -> List[List[float]]:
    """
    Encode texts with BGE-base and return List[List[float]] of shape
    [len(texts), EMBED_DIM].  JSON-safe and directly usable with Milvus.

    Args:
        texts:      Single string or list of strings.
        max_length: Approximate token limit (converted to chars for truncation).
        normalize:  L2-normalise embeddings (recommended for cosine similarity).
        batch_size: Texts per API call. 32 balances throughput and HF payload limits.
    """
    if isinstance(texts, str):
        texts = [texts]

    all_embeddings: List[List[float]] = []
    n_batches = (len(texts) + batch_size - 1) // batch_size

    for batch_idx, i in enumerate(range(0, len(texts), batch_size)):
        batch = texts[i : i + batch_size]
        # Rough char truncation (~5 chars/token) to stay within BGE's 512-token limit
        batch = [t[: max_length * 5] for t in batch]

        arr = _encode_batch_with_retry(batch)

        if arr.ndim == 3:
            # [batch, seq_len, hidden] — mean-pool each sequence
            for j in range(arr.shape[0]):
                all_embeddings.append(_maybe_normalize(arr[j].mean(axis=0), normalize))
        elif arr.ndim == 2:
            if arr.shape[0] == len(batch) and arr.shape[1] == EMBED_DIM:
                # [batch, hidden] — already pooled (sentence-transformer style, expected for BGE)
                for j in range(arr.shape[0]):
                    all_embeddings.append(_maybe_normalize(arr[j], normalize))
            else:
                # [seq_len, hidden] — single text, mean-pool
                all_embeddings.append(_maybe_normalize(arr.mean(axis=0), normalize))
        elif arr.ndim == 1:
            # [hidden] — single text already pooled
            all_embeddings.append(_maybe_normalize(arr, normalize))

        # Polite inter-batch delay — avoids HF free-tier rate limits on large docs
        if batch_idx < n_batches - 1:
            time.sleep(0.5)

    return all_embeddings


def warmup() -> None:
    """No-op — no local model to warm up."""
    logger.info("Encoder: BGE-base-en-v1.5 via HuggingFace InferenceClient (remote, batch_size=32).")
