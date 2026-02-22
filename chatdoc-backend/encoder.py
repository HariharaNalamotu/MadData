"""
Legal-BERT embeddings via HuggingFace Inference API.

Replaces local torch/transformers with an API call to the free HF serverless
endpoint, eliminating the ~1.2 GB RAM requirement from running the model locally.
The same nlpaueb/legal-bert-base-uncased model is used — just hosted by HF.
"""

from __future__ import annotations

import logging
import os
from typing import List, Union

import numpy as np
import requests

logger = logging.getLogger(__name__)

EMBED_DIM = 768
_HF_API_URL = (
    "https://api-inference.huggingface.co/pipeline/feature-extraction/"
    "nlpaueb/legal-bert-base-uncased"
)


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
    Encode texts using Legal-BERT via the HuggingFace Inference API.

    Returns List[List[float]] of shape [len(texts), EMBED_DIM] —
    JSON-safe and directly usable with Milvus insert().

    Args:
        texts:      Single string or list of strings.
        max_length: Approximate token limit (converted to chars for truncation).
        normalize:  L2-normalise embeddings (recommended for cosine similarity).
        batch_size: Texts per API call. Keep ≤16 to stay within HF request limits.
    """
    if isinstance(texts, str):
        texts = [texts]

    all_embeddings: List[List[float]] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        # Rough character truncation (~5 chars per token) to stay within BERT's 512-token limit
        batch = [t[: max_length * 5] for t in batch]

        response = requests.post(
            _HF_API_URL,
            headers=_headers(),
            json={"inputs": batch, "options": {"wait_for_model": True}},
            timeout=60,
        )
        response.raise_for_status()

        # HF returns shape [batch_size, seq_len, hidden_size] per call.
        # seq_len varies per input; we mean-pool each independently.
        token_embeddings = response.json()
        for seq in token_embeddings:
            arr = np.array(seq, dtype=np.float32)  # [seq_len, hidden_size]
            pooled = arr.mean(axis=0)              # [hidden_size]
            if normalize:
                norm = float(np.linalg.norm(pooled))
                if norm > 0:
                    pooled = pooled / norm
            all_embeddings.append(pooled.tolist())

    return all_embeddings


def warmup() -> None:
    """No-op — no local model to warm up."""
    logger.info("Encoder: using HuggingFace Inference API — no local model warmup needed.")
