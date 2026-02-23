/**
 * API client for the LexDoc Flask backend.
 *
 * Backend URL is configured via NEXT_PUBLIC_BACKEND_URL (set in .env.local
 * for dev, and in Vercel Environment Variables for production).
 */

export const BACKEND_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_BACKEND_URL) ||
  'http://localhost:5000';

// ─── Document upload ──────────────────────────────────────────────────────────

export interface UploadResult {
  doc_id: string;
  full_text: string;
  chunk_count: number;
}

/**
 * Upload a file to the backend for processing and storage in Milvus.
 * Returns doc_id (Milvus), full extracted text, and chunk count.
 */
export async function uploadDocument(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`${BACKEND_URL}/documents/upload`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    let msg = `Upload failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }

  return res.json() as Promise<UploadResult>;
}

/**
 * Delete all Milvus vectors for a document.
 * Fire-and-forget — errors are logged but not re-thrown.
 */
export async function deleteDocument(docId: string): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/documents/${encodeURIComponent(docId)}`, {
      method: 'DELETE',
    });
  } catch (err) {
    console.warn('deleteDocument error:', err);
  }
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatParams {
  query: string;
  docId?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  selectedText?: string;
  fullText?: string;
}

/**
 * Send a chat query to the backend.
 * Returns a ReadableStream — read chunks directly for streaming display.
 *
 * The backend is agentic: it classifies the query as 'rag' or 'direct' and
 * routes accordingly. RAG uses Legal-BERT to encode the query and searches
 * Milvus for relevant contract clauses.
 */
export async function chatStream(params: ChatParams): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${BACKEND_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query:         params.query,
      doc_id:        params.docId ?? '',
      history:       params.history ?? [],
      selected_text: params.selectedText ?? '',
      full_text:     params.fullText ?? '',
    }),
  });

  if (!res.ok) {
    throw new Error(`Chat error (${res.status})`);
  }
  return res.body!;
}

// ─── Explain ──────────────────────────────────────────────────────────────────

export interface ExplainParams {
  selectedText: string;
  /** Optional surrounding text to give the LLM more context */
  docContext?: string;
}

/**
 * Ask the backend to explain selected legal text in plain English.
 * Returns a ReadableStream for streaming display.
 */
export async function explainStream(params: ExplainParams): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${BACKEND_URL}/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selected_text: params.selectedText,
      doc_context:   params.docContext ?? '',
    }),
  });

  if (!res.ok) {
    throw new Error(`Explain error (${res.status})`);
  }
  return res.body!;
}
