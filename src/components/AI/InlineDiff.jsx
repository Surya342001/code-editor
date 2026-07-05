// src/components/AI/InlineDiff.jsx — Monaco DiffEditor with Accept / Reject
import { useEffect } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import useEditorStore from '../../store/editorStore';

export default function InlineDiff() {
  const { inlineDiff, acceptInlineDiff, rejectInlineDiff } = useEditorStore();

  // Dismiss on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') rejectInlineDiff(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [rejectInlineDiff]);

  if (!inlineDiff) return null;

  const { original, proposed, filePath, language } = inlineDiff;
  const fileName = filePath?.split('/').pop() || 'file';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#0d1117] border border-[#30363d] rounded-lg shadow-2xl flex flex-col w-full max-w-5xl"
           style={{ maxHeight: '85vh' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#30363d] flex-shrink-0">
          <span className="text-[#7c3aed] text-base">✨</span>
          <div>
            <p className="text-[#e6edf3] text-sm font-medium">AI Suggested Edit</p>
            <p className="text-[#8b949e] text-xs font-mono">{fileName}</p>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1 text-xs text-[#8b949e]">
            <span className="text-[#f85149]">■ original</span>
            <span className="mx-1">·</span>
            <span className="text-[#3fb950]">■ proposed</span>
          </div>
        </div>

        {/* Diff editor */}
        <div className="flex-1 overflow-hidden min-h-0" style={{ height: '55vh' }}>
          <DiffEditor
            original={original}
            modified={proposed}
            language={language || 'javascript'}
            theme="vs-dark"
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              lineHeight: 20,
              padding: { top: 8, bottom: 8 },
              scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
              diffCodeLens: false,
              renderIndicators: true,
            }}
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#30363d] flex-shrink-0">
          <p className="flex-1 text-xs text-[#8b949e]">Press <kbd className="bg-[#21262d] px-1 rounded">Esc</kbd> to dismiss</p>
          <button
            onClick={rejectInlineDiff}
            className="px-4 py-1.5 text-sm border border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e] rounded transition-colors"
          >
            ✕ Reject
          </button>
          <button
            onClick={acceptInlineDiff}
            className="px-4 py-1.5 text-sm bg-[#238636] hover:bg-[#2ea043] text-white rounded font-medium transition-colors"
          >
            ✓ Accept &amp; Apply
          </button>
        </div>
      </div>
    </div>
  );
}
