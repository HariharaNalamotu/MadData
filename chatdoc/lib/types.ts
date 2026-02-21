// ─── Document ────────────────────────────────────────────────────────────────

export interface FileItem {
  id: string;            // local UI identifier
  docId: string;         // Milvus document ID returned by backend
  name: string;
  content: string;       // full extracted text (for display + selection indexing)
  type: string;
  size: number;
  uploadedAt: Date;
  chunkCount: number;    // number of clauses stored in Milvus
}

// ─── Highlights ──────────────────────────────────────────────────────────────

export interface HighlightSegment {
  id: string;
  fileId: string;
  selectedText: string;
  startIndex: number;
  endIndex: number;
  /** Conversation messages in this highlight's side panel */
  messages: ChatMessage[];
  colorKey: HighlightColorKey;
  createdAt: Date;
  /** Auto-explanation streamed from /explain (undefined = not yet triggered) */
  explanation?: string;
  /** True while /explain is still streaming */
  explainLoading?: boolean;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// ─── Highlight colors ────────────────────────────────────────────────────────

export type HighlightColorKey = 'yellow' | 'pink' | 'green' | 'blue' | 'lavender';

export const HIGHLIGHT_COLORS: Record<
  HighlightColorKey,
  { bg: string; border: string; hoverBg: string; dot: string }
> = {
  yellow:   { bg: '#fef9c3', border: '#fef08a', hoverBg: '#fef08a', dot: '#eab308' },
  pink:     { bg: '#fce7f3', border: '#fbcfe8', hoverBg: '#fbcfe8', dot: '#ec4899' },
  green:    { bg: '#dcfce7', border: '#bbf7d0', hoverBg: '#bbf7d0', dot: '#22c55e' },
  blue:     { bg: '#dbeafe', border: '#bfdbfe', hoverBg: '#bfdbfe', dot: '#3b82f6' },
  lavender: { bg: '#ede9fe', border: '#ddd6fe', hoverBg: '#ddd6fe', dot: '#8b5cf6' },
};

export const HIGHLIGHT_COLOR_CYCLE: HighlightColorKey[] = [
  'yellow', 'pink', 'green', 'blue', 'lavender',
];
