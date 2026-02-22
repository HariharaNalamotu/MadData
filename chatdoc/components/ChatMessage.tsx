'use client';

import { Bot, User } from 'lucide-react';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  chatbotName?: string;
  isStreaming?: boolean;
}

export default function ChatMessage({ role, content, chatbotName = 'LexDoc', isStreaming }: ChatMessageProps) {
  const isUser = role === 'user';

  return (
    <div className={`flex gap-3 fade-up ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
        style={{
          background: isUser
            ? 'linear-gradient(135deg, #f59e0b, #ec4899)'
            : 'linear-gradient(135deg, #3b82f6, #06b6d4)',
        }}
      >
        {isUser ? (
          <User size={13} className="text-white" />
        ) : (
          <Bot size={13} className="text-white" />
        )}
      </div>

      {/* Bubble */}
      <div
        className="max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
        style={{
          background: isUser ? '#1e2d3d' : '#1e1e1e',
          color: isUser ? '#bfdbfe' : '#e5e7eb',
          borderBottomRightRadius: isUser ? '4px' : '16px',
          borderBottomLeftRadius: isUser ? '16px' : '4px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
        {isStreaming && !content ? (
          <span className="flex items-center gap-1.5 py-0.5">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </span>
        ) : (
          <p className="whitespace-pre-wrap break-words m-0">{content}</p>
        )}
      </div>
    </div>
  );
}
