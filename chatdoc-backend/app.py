"""
DocChat Flask backend.

Routes:
  GET  /health                  — liveness probe
  POST /documents/upload        — process + embed + store document
  DEL  /documents/<doc_id>      — remove document from Milvus
  POST /chat                    — agentic query (RAG or direct), streamed
  POST /explain                 — explain selected legal text, streamed
"""

from __future__ import annotations

import atexit
import io
import logging
import os
import uuid

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS
from pypdf import PdfReader

from agent import classify_query, stream_direct_response, stream_explain_response, stream_rag_response
from chunker import extract_chunks
from encoder import encode, warmup
from milvus_store import delete_document, reset_collection, insert_chunks, search_similar

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Allow all origins for development; tighten in production via ALLOWED_ORIGINS env var
allowed_origins = os.environ.get("ALLOWED_ORIGINS", "*")
CORS(app, origins=allowed_origins)

# ---------------------------------------------------------------------------
# Startup / shutdown
# ---------------------------------------------------------------------------

def startup():
    logger.info("Initializing services…")
    reset_collection()   # wipe any stale vectors from the previous run
    warmup()
    logger.info("Startup complete.")

def shutdown():
    logger.info("Shutting down — wiping Milvus collection…")
    try:
        reset_collection()
    except Exception:
        logger.exception("Shutdown wipe failed (non-fatal).")

with app.app_context():
    startup()

atexit.register(shutdown)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/", methods=["GET", "HEAD"])
def root():
    return jsonify({"status": "ok"}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200


@app.route("/documents/upload", methods=["POST"])
def upload_document():
    """
    Accepts a multipart/form-data request with a 'file' field.
    Processes the document, embeds it, and stores chunks in Milvus.

    Returns JSON: {doc_id, full_text, chunk_count}
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided. Send a 'file' field."}), 400

    file = request.files["file"]
    filename = (file.filename or "").lower()
    file_bytes = file.read()

    if not file_bytes:
        return jsonify({"error": "Empty file."}), 400

    # ---- Extract text -------------------------------------------------------
    if filename.endswith(".pdf"):
        try:
            reader = PdfReader(io.BytesIO(file_bytes))
            pages = [p.extract_text() or "" for p in reader.pages]
            full_text = "\n".join(p for p in pages if p.strip())
        except Exception as exc:
            logger.exception("PDF extraction failed")
            return jsonify({"error": f"PDF extraction failed: {exc}"}), 422
    else:
        for encoding in ("utf-8", "latin-1"):
            try:
                full_text = file_bytes.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            return jsonify({"error": "Cannot decode file as text."}), 422

    if not full_text.strip():
        return jsonify({"error": "No text content found in file."}), 422

    # ---- Chunk ---------------------------------------------------------------
    chunks = extract_chunks(full_text)
    if not chunks:
        return jsonify({"error": "No clauses could be identified in the document."}), 422

    logger.info("Document '%s': %d chunks", filename, len(chunks))

    # ---- Encode (batched) ----------------------------------------------------
    chunk_texts = [c["text"] for c in chunks]
    try:
        embeddings = encode(chunk_texts)
    except Exception as exc:
        logger.exception("Embedding failed for '%s'", filename)
        return jsonify({"error": f"Embedding service error: {exc}"}), 503

    # ---- Store in Milvus -----------------------------------------------------
    doc_id = str(uuid.uuid4())
    count = insert_chunks(doc_id, chunks, embeddings)

    return jsonify({
        "doc_id":      doc_id,
        "full_text":   full_text,
        "chunk_count": count,
    }), 201


@app.route("/documents/<doc_id>", methods=["DELETE"])
def delete_doc(doc_id: str):
    """Remove all chunks for a document from Milvus."""
    try:
        delete_document(doc_id)
        return jsonify({"deleted": doc_id}), 200
    except Exception as exc:
        logger.exception("Delete failed for doc_id=%s", doc_id)
        return jsonify({"error": str(exc)}), 500


@app.route("/chat", methods=["POST"])
def chat():
    """
    Agentic document Q&A.

    Request JSON:
        query         (str)  — the user's question
        doc_id        (str)  — document to search (optional; if absent, skips RAG)
        history       (list) — prior conversation [{role, content}]
        selected_text (str)  — highlighted clause for context (optional)

    Response: streaming plain text
    """
    data = request.get_json(force=True) or {}
    query: str = (data.get("query") or "").strip()
    doc_id: str = (data.get("doc_id") or "").strip()
    history: list = data.get("history") or []
    selected_text: str = (data.get("selected_text") or "").strip()

    if not query:
        return jsonify({"error": "'query' is required"}), 400

    # Compose the effective query (prepend selected_text as context when present)
    if selected_text:
        effective_query = f'Regarding this clause: "{selected_text[:400]}"\n\n{query}'
    else:
        effective_query = query

    # Sanitize history to only include valid fields
    clean_history = [
        {"role": m["role"], "content": m["content"]}
        for m in history
        if isinstance(m, dict) and m.get("role") in ("user", "assistant") and m.get("content")
    ]

    def generate():
        try:
            if doc_id:
                yield "__STATUS__:Routing query...\n"
                intent = classify_query(effective_query)
            else:
                intent = "direct"

            if intent == "rag" and doc_id:
                yield "__STATUS__:BGE is retrieving...\n"
                query_emb = encode(effective_query)[0]
                hits = search_similar(query_emb, doc_id, top_k=5)
                yield "__STATUS__:Qwen is thinking...\n"
                if hits:
                    yield from stream_rag_response(effective_query, hits, clean_history)
                else:
                    yield from stream_direct_response(
                        effective_query + "\n\n(Note: no matching clauses found in the document.)",
                        clean_history,
                    )
            else:
                yield "__STATUS__:Qwen is thinking...\n"
                yield from stream_direct_response(effective_query, clean_history)
        except Exception as exc:
            logger.exception("Chat streaming error")
            yield f"\n\n[Error: {exc}]"

    return Response(
        stream_with_context(generate()),
        content_type="text/plain; charset=utf-8",
    )


@app.route("/explain", methods=["POST"])
def explain():
    """
    Explain selected legal text in plain English.

    Request JSON:
        selected_text (str) — the highlighted clause
        doc_context   (str) — optional surrounding document text for context

    Response: streaming plain text
    """
    data = request.get_json(force=True) or {}
    selected_text: str = (data.get("selected_text") or "").strip()
    doc_context: str = (data.get("doc_context") or "").strip()

    if not selected_text:
        return jsonify({"error": "'selected_text' is required"}), 400

    def generate():
        try:
            yield "__STATUS__:Qwen is thinking...\n"
            yield from stream_explain_response(selected_text, doc_context)
        except Exception as exc:
            logger.exception("Explain streaming error")
            yield f"\n\n[Error: {exc}]"

    return Response(
        stream_with_context(generate()),
        content_type="text/plain; charset=utf-8",
    )


# ---------------------------------------------------------------------------
# Dev server entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=False)
