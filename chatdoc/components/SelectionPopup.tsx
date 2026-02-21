'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, BookOpen } from 'lucide-react';

interface SelectionPopupProps {
  x: number;
  y: number;
  selectedText: string;
  chatbotName: string;
  /** Triggered when user clicks "Explain" — no user input needed */
  onExplain: () => void;
  /** Triggered when user submits a free-form question */
  onAsk: (question: string) => void;
  onDismiss: () => void;
}

export default function SelectionPopup({
  x,
  y,
  selectedText,
  chatbotName,
  onExplain,
  onAsk,
  onDismiss,
}: SelectionPopupProps) {
  const [mode, setMode] = useState<'idle' | 'ask'>('idle');
  const [question, setQuestion] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode === 'ask') setTimeout(() => inputRef.current?.focus(), 50);
  }, [mode]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    document.addEventListener('mousedown', handleClick, { capture: true });
    return () => document.removeEventListener('mousedown', handleClick, { capture: true });
  }, [onDismiss]);

  const handleAskSubmit = () => {
    if (!question.trim()) return;
    onAsk(question.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAskSubmit(); }
    if (e.key === 'Escape') onDismiss();
  };

  const POPUP_W = mode === 'ask' ? 308 : 200;
  const clampedX = Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 800) - POPUP_W - 16);

  return (
    <div
      ref={popupRef}
      className="popup-in fixed z-50"
      style={{ left: clampedX, top: y - 8, transform: 'translateY(-100%)' }}
    >
      {mode === 'idle' ? (
        /* ── Compact two-button pill ── */
        <div
          className="flex items-center gap-1 p-1 rounded-full shadow-lg"
          style={{ background: 'white', border: '1px solid #ede9fe' }}
        >
          {/* Explain — primary action */}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onExplain(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-white transition-all hover:scale-105 active:scale-95"
            style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}
          >
            <BookOpen size={11} />
            Explain
          </button>

          {/* Separator */}
          <div className="w-px h-5 bg-gray-200 mx-0.5" />

          {/* Ask — secondary action */}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMode('ask')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-white transition-all hover:scale-105 active:scale-95"
            style={{ background: 'linear-gradient(135deg, #ec4899, #db2777)' }}
          >
            <Sparkles size={11} />
            Ask {chatbotName}
          </button>
        </div>
      ) : (
        /* ── Expanded ask card ── */
        <div
          className="rounded-2xl shadow-xl overflow-hidden"
          style={{ width: 308, background: 'white', border: '1px solid #ede9fe' }}
        >
          {/* Selected text preview */}
          <div className="px-3 pt-3 pb-2">
            <div
              className="rounded-lg px-2.5 py-1.5 text-xs leading-relaxed"
              style={{ background: '#fef9c3', color: '#713f12', border: '1px solid #fef08a' }}
            >
              <span className="font-medium opacity-60">Selected: </span>
              {selectedText.length > 80 ? selectedText.slice(0, 80) + '…' : selectedText}
            </div>
          </div>

          {/* Input */}
          <div className="px-3 pb-3">
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2"
              style={{ background: '#f5f3ff', border: '1.5px solid #c4b5fd' }}
            >
              <Sparkles size={13} style={{ color: '#8b5cf6', flexShrink: 0 }} />
              <input
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask ${chatbotName} about this…`}
                className="flex-1 text-xs bg-transparent outline-none placeholder:opacity-50"
                style={{ color: '#1e1b4b' }}
              />
              <button
                onClick={handleAskSubmit}
                disabled={!question.trim()}
                className="w-6 h-6 rounded-lg flex items-center justify-center transition-all disabled:opacity-30"
                style={{ background: question.trim() ? '#8b5cf6' : '#e5e7eb' }}
              >
                <Send size={10} className="text-white" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
