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

export function useStreamingChat(initialMessages: ChatMsg[] = []) {
  const [messages, setMessages] = useState<ChatMsg[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState('');
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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
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
              ? { ...m, content: `Error: ${msg}. Check that the backend is running and OPENAI_API_KEY is set.` }
              : m
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [] // reads from refs, no stale closure issues
  );

  return { messages, setMessages, input, setInput, send, isLoading };
}
