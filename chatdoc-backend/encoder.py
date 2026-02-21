"""
Legal-BERT encoder — nlpaueb/legal-bert-base-uncased with mean pooling.
Singleton pattern: model loads once at startup, reused across all requests.
"""

from __future__ import annotations

import logging
from typing import List, Union

import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModel

logger = logging.getLogger(__name__)

MODEL_NAME = "nlpaueb/legal-bert-base-uncased"
EMBED_DIM = 768

# Module-level singletons — populated by _load() on first use
_tokenizer = None
_model = None


def _load() -> None:
    """Load tokenizer and model if not already loaded."""
    global _tokenizer, _model
    if _tokenizer is not None:
        return
    logger.info("Loading Legal-BERT model: %s", MODEL_NAME)
    _tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    _model = AutoModel.from_pretrained(MODEL_NAME)
    _model.eval()
    logger.info("Legal-BERT loaded successfully (dim=%d)", EMBED_DIM)


def _mean_pool(last_hidden_state: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
    mask = attention_mask.unsqueeze(-1).expand(last_hidden_state.size()).float()
    summed = torch.sum(last_hidden_state * mask, dim=1)
    counts = torch.clamp(mask.sum(dim=1), min=1e-9)
    return summed / counts


@torch.no_grad()
def encode(
    texts: Union[str, List[str]],
    max_length: int = 256,
    normalize: bool = True,
    batch_size: int = 32,
) -> List[List[float]]:
    """
    Encode one or more texts with Legal-BERT.

    Returns a list of float lists (not Tensors) so results are JSON-safe
    and directly usable with Milvus insert().

    Args:
        texts:      Single string or list of strings.
        max_length: Truncation length in tokens (BERT max = 512).
        normalize:  L2-normalize embeddings (recommended for cosine similarity).
        batch_size: Process this many texts per forward pass.

    Returns:
        List[List[float]] of shape [len(texts), EMBED_DIM].
    """
    _load()

    if isinstance(texts, str):
        texts = [texts]

    all_embeddings: List[List[float]] = []

    for start in range(0, len(texts), batch_size):
        batch = texts[start : start + batch_size]
        inputs = _tokenizer(
            batch,
            padding=True,
            truncation=True,
            max_length=max_length,
            return_tensors="pt",
        )
        outputs = _model(**inputs)
        emb = _mean_pool(outputs.last_hidden_state, inputs["attention_mask"])
        if normalize:
            emb = F.normalize(emb, p=2, dim=1)
        all_embeddings.extend(emb.tolist())

    return all_embeddings


def warmup() -> None:
    """Call at server startup to pre-load the model into memory."""
    encode("warmup text", max_length=16)
    logger.info("Encoder warmed up.")
