"""
Agentic query router and LLM streaming helpers.
Uses HuggingFace free Inference API for all LLM operations via its
OpenAI-compatible /v1/chat/completions endpoint — no API key purchase required.

Routing logic:
  - 'rag'    → query requires retrieving specific content from the uploaded contract
  - 'direct' → general legal question answerable without the document
"""

from __future__ import annotations

import json
import logging
import os
from typing import Iterator, List

import requests

logger = logging.getLogger(__name__)

# Free HuggingFace model. Override via HF_CHAT_MODEL env var.
# Other options: "HuggingFaceH4/zephyr-7b-beta", "microsoft/Phi-3-mini-4k-instruct"
_CHAT_MODEL = os.environ.get("HF_CHAT_MODEL", "mistralai/Mistral-7B-Instruct-v0.3")
_HF_CHAT_URL = "https://api-inference.huggingface.co/v1/chat/completions"


def _hf_headers() -> dict:
    token = os.environ.get("HF_TOKEN", "")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


# ---------------------------------------------------------------------------
# Query classification
# ---------------------------------------------------------------------------

_CLASSIFIER_SYSTEM = """\
You are a query router for a legal document assistant.
Classify the user's query into exactly one category:

  rag    — the query asks about specific content in the contract
           (clauses, dates, names of parties, allowed/prohibited activities,
            monetary amounts, obligations, rights, definitions, deadlines, etc.)
  direct — the query is general knowledge or does not require reading the contract
           (legal concept definitions, general advice, conversational questions)

Respond with exactly one word: 'rag' or 'direct'.
No explanation, no punctuation."""


def classify_query(query: str) -> str:
    """Returns 'rag' or 'direct'."""
    try:
        resp = requests.post(
            _HF_CHAT_URL,
            headers=_hf_headers(),
            json={
                "model": _CHAT_MODEL,
                "messages": [
                    {"role": "system", "content": _CLASSIFIER_SYSTEM},
                    {"role": "user",   "content": query},
                ],
                "max_tokens": 5,
                "temperature": 0,
                "stream": False,
            },
            timeout=30,
        )
        resp.raise_for_status()
        label = resp.json()["choices"][0]["message"]["content"].strip().lower()
        result = "rag" if "rag" in label else "direct"
        logger.info("classify_query → '%s' for: %s", result, query[:80])
        return result
    except Exception as exc:
        logger.warning("Classification failed (%s), defaulting to 'rag'", exc)
        return "rag"  # safer default: always try to use the document


# ---------------------------------------------------------------------------
# Streaming generators
# ---------------------------------------------------------------------------

def stream_rag_response(
    query: str,
    context_chunks: List[dict],
    history: List[dict],
) -> Iterator[str]:
    """
    Answer a document-specific query using retrieved chunks as grounding context.
    """
    context_text = "\n\n".join(
        f"[{c['header']}]\n{c['text']}" for c in context_chunks
    )
    system = (
        "You are a legal document assistant. Answer questions accurately using "
        "the contract excerpts below. Cite the clause header when relevant. "
        "If the excerpts do not contain the answer, say so clearly rather than "
        "guessing. Use plain English — avoid unnecessary legal jargon.\n\n"
        f"CONTRACT EXCERPTS:\n{context_text}"
    )
    messages = [{"role": "system", "content": system}] + history + [
        {"role": "user", "content": query}
    ]
    yield from _stream(messages, temperature=0.2)


def stream_direct_response(query: str, history: List[dict]) -> Iterator[str]:
    """
    Answer a general query without document retrieval.
    """
    system = (
        "You are a knowledgeable legal assistant. Answer the user's question "
        "clearly and concisely. For general legal concepts, give accurate "
        "definitions in plain English. Always recommend consulting a qualified "
        "attorney for specific legal advice."
    )
    messages = [{"role": "system", "content": system}] + history + [
        {"role": "user", "content": query}
    ]
    yield from _stream(messages, temperature=0.4)


def stream_explain_response(
    selected_text: str,
    doc_context: str = "",
) -> Iterator[str]:
    """
    Explain a selected legal clause in plain English.
    """
    system = (
        "You are a legal plain-language expert. Your job is to explain legal "
        "text so that someone with no legal background can understand it.\n"
        "Rules:\n"
        "- Use simple, everyday language\n"
        "- Be concise: 2–5 sentences for short clauses, up to 8 for complex ones\n"
        "- If the clause has important implications (risks, obligations, rights), "
        "highlight them clearly\n"
        "- Do NOT use legal jargon without immediately explaining it"
    )
    user_content = f'Explain this legal text in plain English:\n\n"{selected_text}"'
    if doc_context.strip():
        user_content += f"\n\nFor context, surrounding text from the document:\n{doc_context[:800]}"

    messages = [
        {"role": "system", "content": system},
        {"role": "user",   "content": user_content},
    ]
    yield from _stream(messages, temperature=0.3)


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

def _stream(messages: List[dict], temperature: float) -> Iterator[str]:
    """Stream via HuggingFace Inference API OpenAI-compatible SSE endpoint."""
    response = requests.post(
        _HF_CHAT_URL,
        headers=_hf_headers(),
        json={
            "model": _CHAT_MODEL,
            "messages": messages,
            "max_tokens": 1024,
            "temperature": temperature,
            "stream": True,
        },
        stream=True,
        timeout=60,
    )
    response.raise_for_status()

    for line in response.iter_lines():
        if not line:
            continue
        if isinstance(line, bytes):
            line = line.decode("utf-8")
        if not line.startswith("data: "):
            continue
        data = line[6:]
        if data == "[DONE]":
            break
        try:
            chunk = json.loads(data)
            delta = chunk["choices"][0]["delta"].get("content", "")
            if delta:
                yield delta
        except (json.JSONDecodeError, KeyError, IndexError):
            continue
