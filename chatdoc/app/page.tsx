'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import Sidebar from '@/components/Sidebar';
// FileViewer uses react-pdf / pdfjs-dist which calls new DOMMatrix() at module
// evaluation time — a browser-only API.  Importing it with ssr:false prevents
// Next.js from evaluating it during server-side pre-rendering.
const FileViewer = dynamic(() => import('@/components/FileViewer'), { ssr: false });
import QueryBar from '@/components/QueryBar';
import SidePanel from '@/components/SidePanel';
import ChatMessage from '@/components/ChatMessage';
import { FileItem, HighlightSegment, HIGHLIGHT_COLOR_CYCLE } from '@/lib/types';
import { useStreamingChat, ChatMsg } from '@/lib/useStreamingChat';
import { deleteDocument, explainStream } from '@/lib/api';

interface SelectionState {
  text: string;
  x: number;
  y: number;
  startIndex: number;
  endIndex: number;
}

export default function Home() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<Record<string, HighlightSegment[]>>({});
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [chatbotName, setChatbotName] = useState('LexDoc');
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [highlightCounter, setHighlightCounter] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Refs for use inside callbacks without stale closures
  const selectedFileRef = useRef<FileItem | null>(null);
  const chatbotNameRef = useRef(chatbotName);
  const highlightCounterRef = useRef(highlightCounter);
  chatbotNameRef.current = chatbotName;
  highlightCounterRef.current = highlightCounter;

  // Per-document main chat history — keyed by fileId
  const mainChatHistoriesRef = useRef<Record<string, ChatMsg[]>>({});
  const mainMessagesRef = useRef<ChatMsg[]>([]);
  const prevFileIdRef = useRef<string | null>(null);

  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null;
  selectedFileRef.current = selectedFile;

  const fileHighlights = selectedFileId ? (highlights[selectedFileId] ?? []) : [];
  const activeHighlight = fileHighlights.find((h) => h.id === activeHighlightId) ?? null;

  // Main document chat (bottom query bar)
  const {
    messages: mainMessages,
    setMessages: setMainMessages,
    input: mainInput,
    setInput: setMainInput,
    send: sendMain,
    isLoading: mainLoading,
    status: mainStatus,
  } = useStreamingChat([]);

  // Keep messages ref always current (used in file-switch effect below)
  mainMessagesRef.current = mainMessages;

  // Save/restore per-file chat history when the active document changes
  useEffect(() => {
    const prevId = prevFileIdRef.current;
    if (prevId !== null) {
      mainChatHistoriesRef.current[prevId] = mainMessagesRef.current;
    }
    setMainMessages(mainChatHistoriesRef.current[selectedFileId ?? ''] ?? []);
    prevFileIdRef.current = selectedFileId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFileId]);

  // Auto-scroll main chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mainMessages]);

  // Escape → close side panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidePanelOpen) {
        setSidePanelOpen(false);
        setActiveHighlightId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidePanelOpen]);

  // ── File management ────────────────────────────────────────────────────────

  const handleFileUpload = useCallback((file: FileItem) => {
    setFiles((prev) => [...prev, file]);
    setSelectedFileId(file.id);
    setHighlights((prev) => ({ ...prev, [file.id]: [] }));
    setSidePanelOpen(false);
    setActiveHighlightId(null);
  }, []);

  const handleFileRemove = useCallback((id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      // Delete from Milvus (fire-and-forget)
      if (target?.docId) deleteDocument(target.docId);

      const remaining = prev.filter((f) => f.id !== id);
      if (selectedFileRef.current?.id === id) {
        const next = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
        setSelectedFileId(next);
        setSidePanelOpen(false);
        setActiveHighlightId(null);
      }
      return remaining;
    });
    setHighlights((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    delete mainChatHistoriesRef.current[id];
  }, []);

  const handleFileSelect = useCallback((id: string) => {
    setSelectedFileId(id);
    setSidePanelOpen(false);
    setActiveHighlightId(null);
    setSelection(null);
  }, []);

  // ── Selection: Explain (auto-trigger via /explain) ─────────────────────────

  const handleExplainSelection = useCallback(
    async (startIndex: number, endIndex: number, text: string) => {
      const file = selectedFileRef.current;
      if (!file) return;

      const colorKey =
        HIGHLIGHT_COLOR_CYCLE[highlightCounterRef.current % HIGHLIGHT_COLOR_CYCLE.length];
      setHighlightCounter((c) => c + 1);

      const highlightId = uuidv4();

      const newHighlight: HighlightSegment = {
        id: highlightId,
        fileId: file.id,
        selectedText: text,
        startIndex,
        endIndex,
        messages: [],
        colorKey,
        createdAt: new Date(),
        explanation: '',
        explainLoading: true,
      };

      setHighlights((prev) => ({
        ...prev,
        [file.id]: [...(prev[file.id] ?? []), newHighlight],
      }));
      setActiveHighlightId(highlightId);
      setSidePanelOpen(true);

      // Surrounding context (300 chars each side) for better explanation
      const docContext = file.content.slice(
        Math.max(0, startIndex - 300),
        endIndex + 300
      );

      try {
        const stream = await explainStream({ selectedText: text, docContext });
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let raw = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          raw += decoder.decode(value, { stream: true });
          const display = raw.replace(/^__STATUS__:[^\n]*\n/gm, '');
          if (display) {
            setHighlights((prev) => ({
              ...prev,
              [file.id]: (prev[file.id] ?? []).map((h) =>
                h.id === highlightId ? { ...h, explanation: display, explainLoading: true } : h
              ),
            }));
          }
        }

        // Final flush (handles no trailing newline)
        const display = raw.replace(/^__STATUS__:[^\n]*\n/gm, '');
        setHighlights((prev) => ({
          ...prev,
          [file.id]: (prev[file.id] ?? []).map((h) =>
            h.id === highlightId ? { ...h, explanation: display, explainLoading: true } : h
          ),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setHighlights((prev) => ({
          ...prev,
          [file.id]: (prev[file.id] ?? []).map((h) =>
            h.id === highlightId
              ? { ...h, explanation: `Could not get explanation: ${msg}`, explainLoading: false }
              : h
          ),
        }));
        return;
      }

      // Mark explain as done
      setHighlights((prev) => ({
        ...prev,
        [file.id]: (prev[file.id] ?? []).map((h) =>
          h.id === highlightId ? { ...h, explainLoading: false } : h
        ),
      }));
    },
    []
  );

  // ── Selection: Ask (user types question → RAG or direct) ──────────────────

  const handleAskAboutSelection = useCallback(
    (question: string, startIndex: number, endIndex: number, text: string) => {
      const file = selectedFileRef.current;
      if (!file) return;

      const colorKey =
        HIGHLIGHT_COLOR_CYCLE[highlightCounterRef.current % HIGHLIGHT_COLOR_CYCLE.length];
      setHighlightCounter((c) => c + 1);

      const highlightId = uuidv4();

      const newHighlight: HighlightSegment = {
        id: highlightId,
        fileId: file.id,
        selectedText: text,
        startIndex,
        endIndex,
        messages: [],
        pendingQuery: question,
        colorKey,
        createdAt: new Date(),
      };

      setHighlights((prev) => ({
        ...prev,
        [file.id]: [...(prev[file.id] ?? []), newHighlight],
      }));
      setActiveHighlightId(highlightId);
      setSidePanelOpen(true);
    },
    []
  );

  const handleHighlightClick = useCallback((id: string) => {
    setActiveHighlightId(id);
    setSidePanelOpen(true);
  }, []);

  const handleSaveMessages = useCallback((highlightId: string, messages: ChatMsg[]) => {
    setHighlights((prev) => {
      const fileId = Object.keys(prev).find((fid) =>
        prev[fid].some((h) => h.id === highlightId)
      );
      if (!fileId) return prev;
      return {
        ...prev,
        [fileId]: prev[fileId].map((h) =>
          h.id === highlightId ? { ...h, messages } : h
        ),
      };
    });
  }, []);

  // ── Bottom query bar ───────────────────────────────────────────────────────

  const handleMainQuerySubmit = useCallback(() => {
    if (!mainInput.trim() || mainLoading) return;
    sendMain(mainInput, {
      docId:    selectedFileRef.current?.docId,
      fullText: selectedFileRef.current?.content,
    });
  }, [mainInput, mainLoading, sendMain]);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar
        files={files}
        selectedFileId={selectedFileId}
        chatbotName={chatbotName}
        onFileSelect={handleFileSelect}
        onFileUpload={handleFileUpload}
        onFileRemove={handleFileRemove}
        onChatbotNameChange={setChatbotName}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left column */}
        <div
          className="flex flex-col overflow-hidden"
          style={{
            flex: sidePanelOpen ? '0 0 50%' : '1 1 auto',
            transition: 'flex 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <FileViewer
            file={selectedFile}
            highlights={fileHighlights}
            activeHighlightId={activeHighlightId}
            selection={selection}
            chatbotName={chatbotName}
            onSelectionChange={setSelection}
            onExplainSelection={handleExplainSelection}
            onAskAboutSelection={handleAskAboutSelection}
            onHighlightClick={handleHighlightClick}
          />

          {/* Document-level conversation */}
          {mainMessages.length > 0 && (
            <div
              className="flex-shrink-0 overflow-y-auto px-4 py-3"
              style={{
                maxHeight: '260px',
                background: '#111111',
                borderTop: '1px solid var(--border)',
              }}
            >
              <div className="max-w-3xl mx-auto space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
                  <span
                    className="text-xs font-medium px-2 uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Document Chat · LegalBERT RAG
                  </span>
                  <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
                </div>
                {mainMessages.map((msg, i) => (
                  <ChatMessage
                    key={msg.id}
                    role={msg.role}
                    content={msg.content}
                    chatbotName={chatbotName}
                    isStreaming={
                      mainLoading &&
                      i === mainMessages.length - 1 &&
                      msg.role === 'assistant' &&
                      !msg.content
                    }
                  />
                ))}
                {mainLoading && mainStatus && (
                  <div className="flex items-center gap-1.5 px-1 py-0.5">
                    <Loader2 size={11} className="animate-spin flex-shrink-0" style={{ color: '#f59e0b' }} />
                    <span className="text-xs font-medium" style={{ color: '#f59e0b' }}>{mainStatus}</span>
                  </div>
                )}
                {mainLoading && mainMessages[mainMessages.length - 1]?.role === 'user' && (
                  <ChatMessage
                    role="assistant"
                    content=""
                    chatbotName={chatbotName}
                    isStreaming
                  />
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}

          <QueryBar
            value={mainInput}
            onChange={setMainInput}
            onSubmit={handleMainQuerySubmit}
            isLoading={mainLoading}
            hasFile={!!selectedFile}
            chatbotName={chatbotName}
          />
        </div>

        {/* Right column: side panel */}
        {sidePanelOpen && activeHighlight && (
          <div
            className="overflow-hidden"
            style={{ flex: '0 0 50%', maxWidth: '50%' }}
          >
            <SidePanel
              key={activeHighlight.id}
              highlight={activeHighlight}
              fileDocId={selectedFile?.docId ?? ''}
              fileContent={selectedFile?.content ?? ''}
              chatbotName={chatbotName}
              onClose={() => {
                setSidePanelOpen(false);
                setActiveHighlightId(null);
              }}
              onSaveMessages={handleSaveMessages}
            />
          </div>
        )}
      </div>
    </div>
  );
}
