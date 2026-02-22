# ─────────────────────────────────────────────────────────────────────────────
# DocChat backend — Flask + HuggingFace Inference API + Milvus + Anthropic
#
# No local ML model — embeddings are generated via the HF free serverless API.
# This keeps the image tiny (~100 MB) and RAM usage well under 200 MB,
# making Render's 512 MB Starter plan viable.
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.11-slim

WORKDIR /app

# ── Python dependencies ───────────────────────────────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Application code ──────────────────────────────────────────────────────────
COPY . .

EXPOSE 5000

# Single worker — prevents two processes racing to drop/recreate the Milvus
# collection on startup and ensures atexit cleanup runs exactly once on shutdown.
CMD ["gunicorn", \
     "--bind", "0.0.0.0:5000", \
     "--workers", "1", \
     "--timeout", "120", \
     "--worker-class", "sync", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "app:app"]
