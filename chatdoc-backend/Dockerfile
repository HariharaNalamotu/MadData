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

# Two sync workers are safe now — no heavy in-process model.
# Increase --timeout for large PDF uploads (pypdf extraction can take a few seconds).
CMD ["gunicorn", \
     "--bind", "0.0.0.0:5000", \
     "--workers", "2", \
     "--timeout", "120", \
     "--worker-class", "sync", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "app:app"]
