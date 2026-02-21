'use client';

import { useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';

interface QueryBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  hasFile: boolean;
  chatbotName: string;
}

export default function QueryBar({ value, onChange, onSubmit, isLoading, hasFile, chatbotName }: QueryBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isLoading) onSubmit();
    }
  };

  const placeholder = hasFile
    ? `Ask ${chatbotName} about this document…`
    : `Upload a file to start asking questions…`;

  return (
    <div
      className="flex-shrink-0 px-4 py-3"
      style={{ background: 'var(--bg-primary)', borderTop: '1px solid var(--border)' }}
    >
      <div
        className="flex items-end gap-3 rounded-2xl px-4 py-3 transition-all"
        style={{
          background: 'white',
          border: '1.5px solid',
          borderColor: value ? '#c4b5fd' : '#e5e7eb',
          boxShadow: value ? '0 0 0 3px #ede9fe' : '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!hasFile || isLoading}
          placeholder={placeholder}
          className="flex-1 resize-none bg-transparent outline-none text-sm leading-relaxed placeholder:opacity-40 disabled:opacity-50"
          style={{ color: 'var(--text-primary)', maxHeight: 160, overflowY: 'auto' }}
        />
        <button
          onClick={() => { if (value.trim() && !isLoading) onSubmit(); }}
          disabled={!value.trim() || isLoading || !hasFile}
          className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center transition-all disabled:opacity-30 hover:scale-105 active:scale-95"
          style={{ background: value.trim() && hasFile ? '#7c3aed' : '#e5e7eb' }}
        >
          {isLoading ? (
            <Loader2 size={14} className="text-white animate-spin" />
          ) : (
            <Send size={14} className="text-white" />
          )}
        </button>
      </div>
      <p className="text-center text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
        {chatbotName} can make mistakes. Verify important information.
      </p>
    </div>
  );
}
