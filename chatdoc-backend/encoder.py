"""
Legal-BERT embeddings via HuggingFace InferenceClient.

Model: nlpaueb/legal-bert-base-uncased
  - 768-dim BERT model trained on legal corpora
  - Runs remotely on HF serverless infrastructure — zero local RAM
  - Response shape: [batch, seq_len, 768] — mean-pooled to [batch, 768]
"""

from __future__ import annotations

import logging
import os
from typing import List, Union

import numpy as np
from huggingface_hub import InferenceClient

logger = logging.getLogger(__name__)

EMBED_MODEL = "BAAI/bge-base-en-v1.5"
EMBED_DIM = 768

_client: InferenceClient | None = None


def get_client() -> InferenceClient:
    global _client
    if _client is None:
        _client = InferenceClient(token=os.environ.get("HF_TOKEN", ""))
    return _client


def encode(
    texts: Union[str, List[str]],
    max_length: int = 256,
    normalize: bool = True,
    batch_size: int = 8,
) -> List[List[float]]:
    """
    Encode texts with Legal-BERT and return List[List[float]] of shape
    [len(texts), EMBED_DIM]. JSON-safe and directly usable with Milvus.

    Args:
        texts:      Single string or list of strings.
        max_length: Approximate token limit (converted to chars for truncation).
        normalize:  L2-normalise embeddings (recommended for cosine similarity).
        batch_size: Texts per API call. Keep small to avoid HF request size limits.
    """
    if isinstance(texts, str):
        texts = [texts]

    all_embeddings: List[List[float]] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        # Rough char truncation (~5 chars/token) to stay within BERT's 512-token limit
        batch = [t[: max_length * 5] for t in batch]

        # InferenceClient.feature_extraction returns np.ndarray.
        # For Legal-BERT with a list of texts:
        #   shape [batch, seq_len, 768]  — BERT token-level output, needs pooling
        # For sentence-transformer models:
        #   shape [batch, 768]           — already pooled
        # For a single text:
        #   shape [seq_len, 768] or [768]
        result = get_client().feature_extraction(batch, model=EMBED_MODEL)
        arr = np.array(result, dtype=np.float32)

        if arr.ndim == 3:
            # [batch, seq_len, hidden] — mean-pool each sequence
            for j in range(arr.shape[0]):
                pooled = arr[j].mean(axis=0)
                all_embeddings.append(_maybe_normalize(pooled, normalize))
        elif arr.ndim == 2:
            if arr.shape[0] == len(batch) and arr.shape[1] == EMBED_DIM:
                # [batch, hidden] — already pooled (sentence-transformer style)
                for j in range(arr.shape[0]):
                    all_embeddings.append(_maybe_normalize(arr[j], normalize))
            else:
                # [seq_len, hidden] — single text, mean-pool
                pooled = arr.mean(axis=0)
                all_embeddings.append(_maybe_normalize(pooled, normalize))
        elif arr.ndim == 1:
            # [hidden] — single text already pooled
            all_embeddings.append(_maybe_normalize(arr, normalize))

    return all_embeddings


def _maybe_normalize(vec: np.ndarray, normalize: bool) -> List[float]:
    if normalize:
        norm = float(np.linalg.norm(vec))
        if norm > 0:
            vec = vec / norm
    return vec.tolist()


def warmup() -> None:
    """No-op — no local model to warm up."""
    logger.info("Encoder: Legal-BERT via HuggingFace InferenceClient (remote).")
