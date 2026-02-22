'use client';

import { useRef, useCallback, useEffect } from 'react';
import { FileText } from 'lucide-react';
import { FileItem, HighlightSegment, HIGHLIGHT_COLORS } from '@/lib/types';
import SelectionPopup from './SelectionPopup';

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

// Compute character offset from a DOM node + offset within the container
function getTextOffset(container: Element, node: Node, offset: number): number {
  let total = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let current: Node | null = walker.nextNode();
  while (current) {
    if (current === node) return total + offset;
    total += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return total;
}

// Build an array of text segments with highlight metadata
function buildSegments(
  text: string,
  highlights: HighlightSegment[],
  activeId: string | null
): Array<{ text: string; highlight: HighlightSegment | null }> {
  if (!highlights.length) return [{ text, highlight: null }];

  const sorted = [...highlights].sort((a, b) => a.startIndex - b.startIndex);
  const segments: Array<{ text: string; highlight: HighlightSegment | null }> = [];
  let cursor = 0;

  for (const hl of sorted) {
    const start = Math.max(hl.startIndex, cursor);
    const end = Math.min(hl.endIndex, text.length);
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), highlight: null });
    }
    if (end > start) {
      segments.push({ text: text.slice(start, end), highlight: hl });
    }
    cursor = Math.max(cursor, end);
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlight: null });
  }

  return segments;
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
  const contentRef = useRef<HTMLDivElement>(null);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      return;
    }
    if (!contentRef.current) return;

    const selectedText = sel.toString();
    const range = sel.getRangeAt(0);

    // Check selection is within our content div
    if (!contentRef.current.contains(range.commonAncestorContainer)) {
      return;
    }

    const startIndex = getTextOffset(contentRef.current, range.startContainer, range.startOffset);
    const endIndex = getTextOffset(contentRef.current, range.endContainer, range.endOffset);

    // Get popup position from selection rect
    const rect = range.getBoundingClientRect();
    onSelectionChange({
      text: selectedText,
      x: rect.left + rect.width / 2 - 80,
      y: rect.top,
      startIndex,
      endIndex,
    });
  }, [onSelectionChange]);

  // Clear selection when clicking outside popup
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only clear if not clicking on popup
      const target = e.target as HTMLElement;
      if (target.closest('[data-popup]')) return;
      onSelectionChange(null);
    },
    [onSelectionChange]
  );

  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div
            className="w-20 h-20 rounded-3xl mx-auto mb-5 flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #ede9fe, #fce7f3)' }}
          >
            <FileText size={36} style={{ color: '#a78bfa' }} />
          </div>
          <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            No document selected
          </h2>
          <p className="text-sm max-w-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Upload a legal document (PDF or text) to get started. Clauses are automatically identified, encoded with Legal-BERT, and indexed for smart retrieval.
          </p>
        </div>
      </div>
    );
  }

  const segments = buildSegments(file.content, highlights, activeHighlightId);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* File header */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-6 py-3.5"
        style={{ borderBottom: '1px solid var(--border)', background: 'white' }}
      >
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: '#ede9fe' }}
        >
          <FileText size={15} style={{ color: '#7c3aed' }} />
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {file.name}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {file.content.length.toLocaleString()} characters
            {highlights.length > 0 && ` · ${highlights.length} annotation${highlights.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {highlights.length > 0 && (
          <div className="ml-auto flex items-center gap-1">
            {highlights.slice(0, 5).map((hl) => (
              <button
                key={hl.id}
                onClick={() => onHighlightClick(hl.id)}
                title={hl.selectedText.slice(0, 60)}
                className="w-4 h-4 rounded-full border-2 border-white transition-transform hover:scale-125"
                style={{ background: HIGHLIGHT_COLORS[hl.colorKey].dot }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Document content */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ background: '#f0f0f0', padding: '2rem 1.5rem' }}
      >
        <div
          ref={contentRef}
          onMouseUp={handleMouseUp}
          onMouseDown={handleMouseDown}
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
          {segments.map((seg, i) => {
            if (!seg.highlight) {
              return <span key={i}>{seg.text}</span>;
            }
            const hl = seg.highlight;
            const colors = HIGHLIGHT_COLORS[hl.colorKey];
            const isActive = hl.id === activeHighlightId;
            return (
              <span
                key={i}
                className={`doc-highlight ${isActive ? 'active-highlight' : ''}`}
                onClick={() => onHighlightClick(hl.id)}
                style={{
                  background: colors.bg,
                  borderBottom: `2px solid ${colors.border}`,
                }}
                title={`Click to open conversation (${hl.messages.length} message${hl.messages.length !== 1 ? 's' : ''})`}
              >
                {seg.text}
              </span>
            );
          })}
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
