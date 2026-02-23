'use client';

import { useState, useRef, useCallback } from 'react';
import { chatStream } from './api';

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface SendOptions {
  /** Milvus document ID — enables RAG when provided */
  docId?: string;
  /** Highlighted clause for context in side-panel conversations */
  selectedText?: string;
  /** Full document text — gives Qwen whole-document context */
  fullText?: string;
}

export function useStreamingChat(initialMessages: ChatMsg[] = []) {
  const [messages, setMessages] = useState<ChatMsg[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const messagesRef = useRef<ChatMsg[]>(initialMessages);
  messagesRef.current = messages;

  const send = useCallback(
    async (content: string, options: SendOptions = {}) => {
      if (!content.trim()) return;

      const userMsg: ChatMsg = { id: crypto.randomUUID(), role: 'user', content };
      const asstMsg: ChatMsg = { id: crypto.randomUUID(), role: 'assistant', content: '' };

      const prevMessages = messagesRef.current;
      setMessages([...prevMessages, userMsg, asstMsg]);
      setInput('');
      setIsLoading(true);
      setStatus('');

      try {
        const history = prevMessages.map((m) => ({ role: m.role, content: m.content }));
        const stream = await chatStream({
          query:        content,
          docId:        options.docId,
          history,
          selectedText: options.selectedText,
          fullText:     options.fullText,
        });

        const reader = stream.getReader();
        const decoder = new TextDecoder();
        // Accumulate the full raw text (including __STATUS__: lines)
        let raw = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          raw += decoder.decode(value, { stream: true });

          // Show the most recent status line in the indicator
          const statusHits = [...raw.matchAll(/^__STATUS__:([^\n]*)/gm)];
          if (statusHits.length > 0) {
            setStatus(statusHits[statusHits.length - 1][1].trim());
          }

          // Strip all __STATUS__: lines and display the rest immediately
          const display = raw.replace(/^__STATUS__:[^\n]*\n/gm, '');
          if (display) {
            setMessages((prev) =>
              prev.map((m) => (m.id === asstMsg.id ? { ...m, content: display } : m))
            );
          }
        }

        // Final pass — handles trailing content with no newline
        const display = raw.replace(/^__STATUS__:[^\n]*\n/gm, '');
        setMessages((prev) =>
          prev.map((m) => (m.id === asstMsg.id ? { ...m, content: display } : m))
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === asstMsg.id
              ? { ...m, content: `Error: ${msg}. Check that the backend is running.` }
              : m
          )
        );
      } finally {
        setIsLoading(false);
        setStatus('');
      }
    },
    [] // reads from refs, no stale closure issues
  );

  return { messages, setMessages, input, setInput, send, isLoading, status };
}
