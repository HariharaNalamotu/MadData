'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { FileText } from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { FileItem, HighlightSegment, HIGHLIGHT_COLORS } from '@/lib/types';
import SelectionPopup from './SelectionPopup';

// Configure PDF.js worker via CDN — works in Next.js without webpack config
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface SelectionState {
  text: string;
  x: number;
  y: number;
  startIndex: number;
  endIndex: number;
}

interface FileViewerProps {
  file: FileItem | null;
  highlights: HighlightSegment[];
  activeHighlightId: string | null;
  selection: SelectionState | null;
  chatbotName: string;
  onSelectionChange: (sel: SelectionState | null) => void;
  onExplainSelection: (startIndex: number, endIndex: number, text: string) => void;
  onAskAboutSelection: (question: string, startIndex: number, endIndex: number, text: string) => void;
  onHighlightClick: (id: string) => void;
}

/**
 * Find the position of selected PDF text within the extracted full text.
 * The PDF text layer and pypdf's extraction are close but not always identical
 * (spacing differences, ligatures), so we try progressively looser matches.
 */
function findTextPosition(content: string, selected: string): { start: number; end: number } {
  // 1. Exact match
  const idx = content.indexOf(selected);
  if (idx !== -1) return { start: idx, end: idx + selected.length };

  // 2. Normalise internal whitespace and try again
  const norm = selected.replace(/\s+/g, ' ').trim();
  const normContent = content.replace(/\s+/g, ' ');
  const idx2 = normContent.indexOf(norm);
  if (idx2 !== -1) return { start: idx2, end: idx2 + norm.length };

  // 3. Fallback — position unknown, still allow explain / ask to work
  return { start: 0, end: selected.length };
}

export default function FileViewer({
  file,
  highlights,
  activeHighlightId,
  selection,
  chatbotName,
  onSelectionChange,
  onExplainSelection,
  onAskAboutSelection,
  onHighlightClick,
}: FileViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [pageWidth, setPageWidth] = useState(760);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep PDF page width in sync with the scroll container width
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      setPageWidth(Math.max(320, Math.min(w - 64, 880)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    if (!containerRef.current) return;

    const range = sel.getRangeAt(0);
    if (!containerRef.current.contains(range.commonAncestorContainer)) return;

    const selectedText = sel.toString().trim();
    if (!selectedText || !file) return;

    const { start, end } = findTextPosition(file.content, selectedText);
    const rect = range.getBoundingClientRect();

    onSelectionChange({
      text: selectedText,
      x: rect.left + rect.width / 2 - 80,
      y: rect.top,
      startIndex: start,
      endIndex: end,
    });
  }, [file, onSelectionChange]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-popup]')) return;
      onSelectionChange(null);
    },
    [onSelectionChange]
  );

  // ── Empty state ──────────────────────────────────────────────────────────────

  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div
            className="w-20 h-20 rounded-3xl mx-auto mb-5 flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(236,72,153,0.2))' }}
          >
            <FileText size={36} style={{ color: '#f59e0b' }} />
          </div>
          <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            No document selected
          </h2>
          <p className="text-sm max-w-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Upload a legal document (PDF or text) to get started. Clauses are
            automatically identified, encoded with Legal-BERT, and indexed for
            smart retrieval.
          </p>
        </div>
      </div>
    );
  }

  const isPdf =
    !!file.fileUrl &&
    (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">

      {/* File header */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-6 py-3.5"
        style={{ borderBottom: '1px solid var(--border)', background: '#1a1a1a' }}
      >
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(245,158,11,0.15)' }}
        >
          <FileText size={15} style={{ color: '#f59e0b' }} />
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {file.name}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {isPdf ? `${numPages} page${numPages !== 1 ? 's' : ''}` : `${file.content.length.toLocaleString()} characters`}
            {highlights.length > 0 &&
              ` · ${highlights.length} annotation${highlights.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {highlights.length > 0 && (
          <div className="ml-auto flex items-center gap-1">
            {highlights.slice(0, 5).map((hl) => (
              <button
                key={hl.id}
                onClick={() => onHighlightClick(hl.id)}
                title={hl.selectedText.slice(0, 60)}
                className="w-4 h-4 rounded-full border-2 border-black/30 transition-transform hover:scale-125"
                style={{ background: HIGHLIGHT_COLORS[hl.colorKey].dot }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Document content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        style={{ background: '#0d0d0d' }}
        onMouseUp={handleMouseUp}
        onMouseDown={handleMouseDown}
      >
        <div ref={containerRef} className="py-8 px-8">
          {isPdf ? (
            <Document
              file={file.fileUrl}
              onLoadSuccess={({ numPages: n }) => setNumPages(n)}
              className="flex flex-col items-center gap-6"
              loading={
                <div className="flex items-center gap-2 py-16" style={{ color: 'var(--text-muted)' }}>
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="text-sm ml-1">Loading PDF…</span>
                </div>
              }
              error={
                <p className="text-sm py-16 text-center" style={{ color: '#ef4444' }}>
                  Failed to load PDF. Try re-uploading the file.
                </p>
              }
            >
              {Array.from({ length: numPages }, (_, i) => (
                <Page
                  key={i + 1}
                  pageNumber={i + 1}
                  width={pageWidth}
                  renderTextLayer
                  renderAnnotationLayer={false}
                  className="shadow-2xl"
                />
              ))}
            </Document>
          ) : (
            /* Plain-text fallback for .txt / .md / .csv etc. */
            <div
              className="max-w-2xl mx-auto select-text"
              style={{
                background: 'white',
                border: '1px solid #d1d5db',
                borderRadius: '3px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
                padding: '3.5rem 4rem',
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontSize: '0.9375rem',
                lineHeight: '1.85',
                color: '#1f2937',
                textAlign: 'justify',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {file.content}
            </div>
          )}
        </div>
      </div>

      {/* Selection popup */}
      {selection && (
        <div data-popup>
          <SelectionPopup
            x={selection.x}
            y={selection.y}
            selectedText={selection.text}
            chatbotName={chatbotName}
            onExplain={() => {
              onExplainSelection(selection.startIndex, selection.endIndex, selection.text);
              onSelectionChange(null);
              window.getSelection()?.removeAllRanges();
            }}
            onAsk={(question) => {
              onAskAboutSelection(question, selection.startIndex, selection.endIndex, selection.text);
              onSelectionChange(null);
              window.getSelection()?.removeAllRanges();
            }}
            onDismiss={() => {
              onSelectionChange(null);
              window.getSelection()?.removeAllRanges();
            }}
          />
        </div>
      )}
    </div>
  );
}
