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
}

const STATUS_PREFIX = '__STATUS__:';

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
        });

        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        // Buffer for incomplete lines; status markers always appear before content
        let lineBuffer = '';
        let statusDone = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          lineBuffer += decoder.decode(value, { stream: true });

          // Drain complete __STATUS__: lines from the front of the buffer
          if (!statusDone) {
            let nlIdx: number;
            while ((nlIdx = lineBuffer.indexOf('\n')) !== -1) {
              const line = lineBuffer.slice(0, nlIdx);
              if (line.startsWith(STATUS_PREFIX)) {
                setStatus(line.slice(STATUS_PREFIX.length).trim());
                lineBuffer = lineBuffer.slice(nlIdx + 1);
              } else {
                // First non-status line — switch to content mode
                statusDone = true;
                break;
              }
            }
          }

          // Everything remaining in the buffer (after status lines) is content
          if (statusDone && lineBuffer) {
            accumulated += lineBuffer;
            lineBuffer = '';
            const snap = accumulated;
            setMessages((prev) =>
              prev.map((m) => (m.id === asstMsg.id ? { ...m, content: snap } : m))
            );
          }
        }

        // Flush any remaining buffer as content
        if (lineBuffer) {
          accumulated += lineBuffer;
          const snap = accumulated;
          setMessages((prev) =>
            prev.map((m) => (m.id === asstMsg.id ? { ...m, content: snap } : m))
          );
        }
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
