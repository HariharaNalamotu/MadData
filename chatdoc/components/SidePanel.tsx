'use client';

import { useEffect, useRef } from 'react';
import { X, Sparkles, Send, Loader2, BookOpen } from 'lucide-react';
import { HighlightSegment, HIGHLIGHT_COLORS } from '@/lib/types';
import { useStreamingChat, ChatMsg } from '@/lib/useStreamingChat';
import ChatMessage from './ChatMessage';

interface SidePanelProps {
  highlight: HighlightSegment;
  fileDocId: string;
  fileContent: string;
  chatbotName: string;
  onClose: () => void;
  onSaveMessages: (highlightId: string, messages: ChatMsg[]) => void;
}

export default function SidePanel({
  highlight,
  fileDocId,
  fileContent,
  chatbotName,
  onClose,
  onSaveMessages,
}: SidePanelProps) {
  const colors = HIGHLIGHT_COLORS[highlight.colorKey];
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, input, setInput, send, isLoading, status } = useStreamingChat(
    highlight.messages
  );

  // Keep ref for save-on-unmount
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    return () => { onSaveMessages(highlight.id, messagesRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-send pendingQuery on first mount, but only if the conversation has
  // no saved messages — prevents re-firing when the user closes and reopens
  // the same highlight panel.
  useEffect(() => {
    if (highlight.pendingQuery && highlight.messages.length === 0) {
      send(highlight.pendingQuery, {
        docId:        fileDocId,
        selectedText: highlight.selectedText,
        fullText:     fileContent,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, highlight.explanation]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    send(input, {
      docId:        fileDocId,
      selectedText: highlight.selectedText,
      fullText:     fileContent,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const isExplainMode = highlight.explanation !== undefined || highlight.explainLoading;

  return (
    <div
      className="flex flex-col h-full slide-in-right"
      style={{ background: '#111111', borderLeft: '1px solid var(--border)' }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 flex items-start gap-3 px-4 py-3.5"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            {isExplainMode ? (
              <BookOpen size={13} style={{ color: colors.dot }} />
            ) : (
              <Sparkles size={13} style={{ color: colors.dot }} />
            )}
            <span
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: colors.dot }}
            >
              {isExplainMode ? 'Plain English Explanation' : 'Selection Chat'}
            </span>
          </div>
          <div
            className="rounded-lg px-2.5 py-1.5 text-xs leading-relaxed"
            style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
          >
            <p className="line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
              {highlight.selectedText}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors mt-0.5"
        >
          <X size={14} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

        {/* ── Explain panel: auto-generated plain-English explanation ── */}
        {isExplainMode && (
          <div
            className="rounded-xl p-3.5"
            style={{
              background: 'linear-gradient(135deg, #1a1a1a, #1f1a2e)',
              border: '1px solid #2a2a2a',
            }}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <BookOpen size={12} style={{ color: '#f59e0b' }} />
              <span className="text-xs font-semibold" style={{ color: '#fbbf24' }}>
                Plain-language explanation
              </span>
            </div>
            {highlight.explainLoading && !highlight.explanation ? (
              <span className="flex items-center gap-1.5">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </span>
            ) : (
              <p
                className="text-xs leading-relaxed whitespace-pre-wrap"
                style={{ color: 'var(--text-secondary)' }}
              >
                {highlight.explanation}
              </p>
            )}
          </div>
        )}

        {/* ── Chat messages ── */}
        {messages.length === 0 && !isExplainMode && (
          <div className="text-center py-6">
            <div
              className="w-10 h-10 rounded-2xl mx-auto mb-3 flex items-center justify-center"
              style={{ background: colors.bg }}
            >
              <Sparkles size={18} style={{ color: colors.dot }} />
            </div>
            <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
              Ask about this selection
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {chatbotName} will search the contract using LegalBERT RAG for
              specific questions, or answer general legal concepts directly.
            </p>
          </div>
        )}

        {messages.length === 0 && isExplainMode && (highlight.explanation || highlight.explainLoading) && (
          <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            Follow-up questions below are answered using LegalBERT RAG on your contract.
          </p>
        )}

        {messages.map((msg, i) => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            content={msg.content}
            chatbotName={chatbotName}
            isStreaming={
              isLoading &&
              i === messages.length - 1 &&
              msg.role === 'assistant' &&
              !msg.content
            }
          />
        ))}
        {isLoading && status && (
          <div className="flex items-center gap-1.5 px-1 py-0.5">
            <Loader2 size={11} className="animate-spin flex-shrink-0" style={{ color: '#f59e0b' }} />
            <span className="text-xs font-medium" style={{ color: '#f59e0b' }}>{status}</span>
          </div>
        )}
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <ChatMessage role="assistant" content="" chatbotName={chatbotName} isStreaming />
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-3 py-3" style={{ borderTop: '1px solid var(--border)' }}>
        <div
          className="flex items-end gap-2 rounded-xl px-3 py-2.5 transition-all"
          style={{
            background: '#1a1a1a',
            border: '1.5px solid',
            borderColor: input ? '#f59e0b' : '#2a2a2a',
            boxShadow: input ? '0 0 0 3px rgba(245,158,11,0.2)' : 'none',
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={isExplainMode ? `Ask a follow-up question…` : `Ask ${chatbotName}…`}
            disabled={isLoading}
            className="flex-1 resize-none bg-transparent outline-none text-xs leading-relaxed placeholder:opacity-40 disabled:opacity-50"
            style={{ color: 'var(--text-primary)', maxHeight: 100, overflowY: 'auto' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center transition-all disabled:opacity-30"
            style={{ background: input.trim() ? '#f59e0b' : '#2a2a2a' }}
          >
            {isLoading ? (
              <Loader2 size={12} className="text-white animate-spin" />
            ) : (
              <Send size={12} className="text-white" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
