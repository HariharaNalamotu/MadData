"""
Agentic query router and LLM streaming helpers.
Uses HuggingFace InferenceClient for all LLM operations (remote, no local model).

Default generation model: Qwen/Qwen2.5-72B-Instruct
Override via HF_CHAT_MODEL environment variable.

Qwen is Apache 2.0 licensed — no license acceptance required on HuggingFace.

Routing logic:
  - 'rag'    → query requires retrieving specific content from the uploaded contract
  - 'direct' → general legal question answerable without the document
"""

from __future__ import annotations

import logging
import os
from typing import Iterator, List

from huggingface_hub import InferenceClient

logger = logging.getLogger(__name__)

CHAT_MODEL = os.environ.get("HF_CHAT_MODEL", "Qwen/Qwen2.5-72B-Instruct")

_client: InferenceClient | None = None


def get_client() -> InferenceClient:
    global _client
    if _client is None:
        _client = InferenceClient(token=os.environ.get("HF_TOKEN", ""))
    return _client


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
        response = get_client().chat_completion(
            messages=[
                {"role": "system", "content": _CLASSIFIER_SYSTEM},
                {"role": "user",   "content": query},
            ],
            model=CHAT_MODEL,
            max_tokens=5,
            temperature=0,
        )
        label = response.choices[0].message.content.strip().lower()
        result = "rag" if "rag" in label else "direct"
        logger.info("classify_query → '%s' for: %s", result, query[:80])
        return result
    except Exception as exc:
        logger.warning("Classification failed (%s), defaulting to 'rag'", exc)
        return "rag"


# ---------------------------------------------------------------------------
# Streaming generators
# ---------------------------------------------------------------------------

def stream_rag_response(
    query: str,
    context_chunks: List[dict],
    history: List[dict],
    full_text: str = "",
) -> Iterator[str]:
    """Answer a document-specific query grounded in retrieved contract clauses.

    The full document text (if provided) is included as broad context so the
    model is aware of the entire contract.  Retrieved chunks are surfaced as
    HIGHLY RELEVANT so the model prioritises them for the specific answer.
    """
    retrieved = "\n\n".join(
        f"[HIGHLY RELEVANT — {c['header']}]\n{c['text']}" for c in context_chunks
    )

    doc_section = ""
    if full_text:
        truncated = full_text[:12000]
        suffix = "\n[...document continues...]" if len(full_text) > 12000 else ""
        doc_section = (
            "FULL CONTRACT TEXT (for broad context):\n"
            f"{truncated}{suffix}\n\n"
        )

    system = (
        "You are a legal document assistant.\n\n"
        + doc_section
        + "HIGHLY RELEVANT EXCERPTS (answer primarily from these):\n"
        + retrieved
        + "\n\nAnswer the user's question accurately. Cite the clause header when "
        "relevant. If the document does not contain the answer, say so clearly "
        "rather than guessing. Use plain English."
    )
    yield from _stream(system, history + [{"role": "user", "content": query}], temperature=0.2)


def stream_direct_response(query: str, history: List[dict], full_text: str = "") -> Iterator[str]:
    """Answer a general query. Includes full document text when available."""
    doc_section = ""
    if full_text:
        truncated = full_text[:12000]
        suffix = "\n[...document continues...]" if len(full_text) > 12000 else ""
        doc_section = (
            "\n\nCONTRACT TEXT (for reference):\n"
            f"{truncated}{suffix}"
        )

    system = (
        "You are a knowledgeable legal assistant. Answer the user's question "
        "clearly and concisely. For general legal concepts, give accurate "
        "definitions in plain English. Always recommend consulting a qualified "
        "attorney for specific legal advice."
        + doc_section
    )
    yield from _stream(system, history + [{"role": "user", "content": query}], temperature=0.4)


def stream_explain_response(
    selected_text: str,
    doc_context: str = "",
) -> Iterator[str]:
    """Explain a selected legal clause in plain English."""
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

    yield from _stream(system, [{"role": "user", "content": user_content}], temperature=0.3)


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

def _stream(system: str, messages: List[dict], temperature: float) -> Iterator[str]:
    """Shared streaming wrapper using HuggingFace InferenceClient."""
    full_messages = [{"role": "system", "content": system}] + messages
    for chunk in get_client().chat_completion(
        messages=full_messages,
        model=CHAT_MODEL,
        max_tokens=1024,
        temperature=temperature,
        stream=True,
    ):
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
