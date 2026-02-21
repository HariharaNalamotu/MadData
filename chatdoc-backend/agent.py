"""
Agentic query router and LLM streaming helpers.

Routing logic:
  - 'rag'    → query requires retrieving specific content from the uploaded contract
  - 'direct' → general legal question answerable without the document
"""

from __future__ import annotations

import logging
import os
from typing import Iterator, List

from openai import OpenAI

logger = logging.getLogger(__name__)

_client: OpenAI | None = None


def get_openai() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
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
        resp = get_openai().chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _CLASSIFIER_SYSTEM},
                {"role": "user",   "content": query},
            ],
            max_tokens=5,
            temperature=0,
        )
        label = resp.choices[0].message.content.strip().lower()
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

    Args:
        query:          The user's question.
        context_chunks: List of {header, text, score} from milvus_store.search_similar().
        history:        Prior conversation turns [{role, content}, ...].
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
    """Shared streaming wrapper around OpenAI chat completions."""
    stream = get_openai().chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        stream=True,
        temperature=temperature,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
