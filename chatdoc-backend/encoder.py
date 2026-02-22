"""
Text embeddings via HuggingFace free Serverless Inference API.

Model: BAAI/bge-base-en-v1.5
  - 768-dim (same as Legal-BERT — no Milvus schema change needed)
  - Consistently available on the HF free tier
  - Strong performance on retrieval/search tasks
"""

from __future__ import annotations

import logging
import os
from typing import List, Union

import numpy as np
import requests

logger = logging.getLogger(__name__)

EMBED_DIM = 768
_MODEL = "BAAI/bge-base-en-v1.5"
_HF_API_URL = f"https://router.huggingface.co/hf-inference/models/{_MODEL}"


def _headers() -> dict:
    token = os.environ.get("HF_TOKEN", "")
    return {"Authorization": f"Bearer {token}"} if token else {}


def encode(
    texts: Union[str, List[str]],
    max_length: int = 256,
    normalize: bool = True,
    batch_size: int = 16,
) -> List[List[float]]:
    """
    Encode texts and return List[List[float]] of shape [len(texts), EMBED_DIM].
    JSON-safe and directly usable with Milvus insert().
    """
    if isinstance(texts, str):
        texts = [texts]

    all_embeddings: List[List[float]] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        batch = [t[: max_length * 5] for t in batch]

        response = requests.post(
            _HF_API_URL,
            headers=_headers(),
            json={"inputs": batch, "options": {"wait_for_model": True}},
            timeout=60,
        )
        response.raise_for_status()

        result = response.json()

        # HF API response shape varies by model:
        #   sentence-transformer models → [batch, hidden_size]  (already pooled)
        #   raw BERT models             → [batch, seq_len, hidden_size]
        # Handle both so a model swap never breaks this.
        for item in result:
            arr = np.array(item, dtype=np.float32)
            pooled = arr.mean(axis=0) if arr.ndim == 2 else arr  # pool if needed
            if normalize:
                norm = float(np.linalg.norm(pooled))
                if norm > 0:
                    pooled = pooled / norm
            all_embeddings.append(pooled.tolist())

    return all_embeddings


def warmup() -> None:
    """No-op — no local model to warm up."""
    logger.info("Encoder: using HuggingFace Inference API (model: %s)", _MODEL)
