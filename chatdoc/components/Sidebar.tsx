'use client';

import { useRef, useState } from 'react';
import {
  FileText,
  Upload,
  X,
  FilePlus,
  Settings,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  Scale,
} from 'lucide-react';
import { FileItem } from '@/lib/types';
import { uploadDocument } from '@/lib/api';

interface SidebarProps {
  files: FileItem[];
  selectedFileId: string | null;
  chatbotName: string;
  onFileSelect: (id: string) => void;
  onFileUpload: (file: FileItem) => void;
  onFileRemove: (id: string) => void;
  onChatbotNameChange: (name: string) => void;
}

export default function Sidebar({
  files,
  selectedFileId,
  chatbotName,
  onFileSelect,
  onFileUpload,
  onFileRemove,
  onChatbotNameChange,
}: SidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [nameInput, setNameInput] = useState(chatbotName);
  const [editingName, setEditingName] = useState(false);

  const handleFile = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const result = await uploadDocument(file);
      const newFile: FileItem = {
        id: crypto.randomUUID(),
        docId: result.doc_id,
        name: file.name,
        content: result.full_text,
        fileUrl: URL.createObjectURL(file),
        type: file.type || 'application/octet-stream',
        size: file.size,
        uploadedAt: new Date(),
        chunkCount: result.chunk_count,
      };
      onFileUpload(newFile);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSaveName = () => {
    if (nameInput.trim()) onChatbotNameChange(nameInput.trim());
    setEditingName(false);
  };

  return (
    <aside
      style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--sidebar-active)' }}
      className="w-64 flex-shrink-0 flex flex-col h-full"
    >
      {/* Header */}
      <div className="px-4 py-5 border-b" style={{ borderColor: 'var(--sidebar-active)' }}>
        <div className="flex items-center gap-2 mb-1">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #ec4899)' }}
          >
            <Scale size={13} className="text-white" />
          </div>
          <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            LexDoc
          </span>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          AI Legal Document Analysis
        </p>
      </div>

      {/* Upload area */}
      <div className="px-3 py-3">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className="rounded-xl border-2 border-dashed p-4 text-center transition-all duration-200"
          style={{
            borderColor: dragOver ? '#f59e0b' : '#3a3a3a',
            background:  dragOver ? 'rgba(245,158,11,0.1)' : uploading ? '#1f1f1f' : 'rgba(255,255,255,0.03)',
            cursor: uploading ? 'wait' : 'pointer',
          }}
        >
          <div
            className="w-8 h-8 rounded-lg mx-auto mb-2 flex items-center justify-center"
            style={{ background: dragOver ? '#f59e0b' : 'rgba(245,158,11,0.15)' }}
          >
            {uploading ? (
              <Loader2 size={14} style={{ color: '#f59e0b' }} className="animate-spin" />
            ) : (
              <Upload size={14} style={{ color: dragOver ? '#111111' : '#f59e0b' }} />
            )}
          </div>
          <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            {uploading ? 'Processing…' : dragOver ? 'Drop to upload' : 'Add a document'}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {uploading ? 'Chunking & encoding with BGE…' : 'PDF or TXT — drag or click'}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.txt,.md,.csv,.json"
            onChange={handleInputChange}
          />
        </div>

        {/* Upload error */}
        {uploadError && (
          <div
            className="mt-2 flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs"
            style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}
          >
            <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
            <span>{uploadError}</span>
          </div>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {files.length === 0 ? (
          <div className="text-center py-8 px-3">
            <FilePlus size={28} className="mx-auto mb-2 opacity-30" style={{ color: '#f59e0b' }} />
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              No documents yet. Upload a contract to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            <p
              className="text-xs font-medium px-2 py-1.5 uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              Documents ({files.length})
            </p>
            {files.map((file) => {
              const isActive = file.id === selectedFileId;
              return (
                <div
                  key={file.id}
                  onClick={() => onFileSelect(file.id)}
                  className="group relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150"
                  style={{
                    background: isActive ? 'var(--sidebar-active)' : 'transparent',
                    color: isActive ? '#fbbf24' : 'var(--text-primary)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive)
                      (e.currentTarget as HTMLDivElement).style.background = 'var(--sidebar-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive)
                      (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                  }}
                >
                  <div
                    className="w-7 h-7 rounded-md flex-shrink-0 flex items-center justify-center"
                    style={{ background: isActive ? 'rgba(245,158,11,0.2)' : '#2a2a2a' }}
                  >
                    <FileText size={13} style={{ color: isActive ? '#f59e0b' : '#6b7280' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{file.name}</p>
                    <p className="text-xs opacity-60">
                      {formatSize(file.size)} · {file.chunkCount} clauses
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onFileRemove(file.id); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-100"
                  >
                    <X size={12} style={{ color: '#ef4444' }} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="border-t px-3 py-3" style={{ borderColor: 'var(--sidebar-active)' }}>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all duration-150 hover:bg-white/5"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Settings size={13} />
          <span className="font-medium">Settings</span>
          {showSettings ? (
            <ChevronDown size={12} className="ml-auto" />
          ) : (
            <ChevronRight size={12} className="ml-auto" />
          )}
        </button>

        {showSettings && (
          <div className="mt-2 px-1">
            <p className="text-xs mb-1.5 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Assistant name
            </p>
            {editingName ? (
              <div className="flex gap-1">
                <input
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                  className="flex-1 text-xs px-2 py-1.5 rounded-md border outline-none"
                  style={{ borderColor: '#f59e0b', background: '#1a1a1a', color: 'var(--text-primary)' }}
                />
                <button
                  onClick={handleSaveName}
                  className="text-xs px-2 py-1 rounded-md text-white"
                  style={{ background: '#f59e0b' }}
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setNameInput(chatbotName); setEditingName(true); }}
                className="w-full text-left text-xs px-2 py-1.5 rounded-md border hover:border-amber-400 transition-colors"
                style={{ borderColor: '#3a3a3a', background: '#1a1a1a', color: '#fbbf24' }}
              >
                {chatbotName}
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
