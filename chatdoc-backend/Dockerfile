# ─────────────────────────────────────────────────────────────────────────────
# DocChat backend — Flask + Legal-BERT + Milvus
#
# Build strategy:
#   1. Install CPU-only PyTorch first (avoids pulling the 2 GB CUDA wheel).
#   2. Install remaining Python deps.
#   3. Pre-download Legal-BERT so it is baked into the image layer.
#      Cold starts download nothing; the model is always available immediately.
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.11-slim

WORKDIR /app

# OS packages needed by some transformers tokenizer dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        g++ \
        git \
    && rm -rf /var/lib/apt/lists/*

# ── 1. CPU-only PyTorch (saves ~1.8 GB vs the default CUDA wheel) ────────────
RUN pip install --no-cache-dir \
    "torch==2.2.2" \
    --index-url https://download.pytorch.org/whl/cpu

# ── 2. Python dependencies ───────────────────────────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── 3. Pre-download Legal-BERT into the image layer ──────────────────────────
# HF_HOME controls where Hugging Face caches models.
# We set it to /app/.cache so it stays inside the image's WORKDIR.
ENV HF_HOME=/app/.cache
RUN python - <<'EOF'
from transformers import AutoTokenizer, AutoModel
name = "nlpaueb/legal-bert-base-uncased"
print(f"Downloading {name}…")
AutoTokenizer.from_pretrained(name)
AutoModel.from_pretrained(name)
print("Download complete.")
EOF

# ── 4. Application code ───────────────────────────────────────────────────────
COPY . .

EXPOSE 5000

# Single sync worker: Legal-BERT requires ~1.2 GB RAM on CPU.
# Multiple workers would multiply RAM usage and OOM on most cloud plans.
# Increase --timeout for large PDF uploads + encoding (can take 30–60 s on CPU).
CMD ["gunicorn", \
     "--bind", "0.0.0.0:5000", \
     "--workers", "1", \
     "--timeout", "180", \
     "--worker-class", "sync", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "app:app"]
