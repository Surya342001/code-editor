// src/components/Sidebar/SearchPanel.jsx
import { useMemo, useState } from 'react';
import useEditorStore from '../../store/editorStore';
import useProjectIndex from '../../store/projectIndex';

function ResultRow({ result }) {
  const navigateTo = useEditorStore(s => s.navigateTo);

  return (
    <button
      onClick={() => navigateTo(result.path, result.line || 1)}
      className="w-full text-left px-3 py-2 hover:bg-[#21262d] border-b border-[#21262d] transition-colors group"
      title={`Open ${result.relativePath}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs text-[#a78bfa] flex-shrink-0">
          {result.kind === 'symbol' ? 'ƒ' : 'file'}
        </span>
        <span className="text-sm text-[#e6edf3] truncate">
          {result.name || result.relativePath.split('/').pop()}
        </span>
        {result.line && <span className="text-[10px] text-[#484f58] flex-shrink-0">L{result.line}</span>}
      </div>
      <div className="text-[11px] text-[#8b949e] truncate mt-0.5">{result.relativePath}</div>
      {result.reason && <div className="text-[10px] text-[#484f58] mt-1">{result.reason}</div>}
      {result.snippet?.text && (
        <pre className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap text-[10px] leading-4 text-[#8b949e] bg-[#0d1117] border border-[#30363d] rounded p-2">
          {result.snippet.text}
        </pre>
      )}
    </button>
  );
}

export default function SearchPanel() {
  const { currentFolder, setActivePanel, toast } = useEditorStore();
  const { files, indexing, indexedAt, indexedFolder, semanticSearch, buildIndex } = useProjectIndex();
  const [query, setQuery] = useState('');

  const hasCurrentIndex = currentFolder && indexedFolder === currentFolder;
  const results = useMemo(() => hasCurrentIndex ? semanticSearch(query, 40) : [], [query, files, hasCurrentIndex, semanticSearch]);

  const reindex = async () => {
    if (!currentFolder) { toast('Open a folder first', 'warn'); return; }
    await buildIndex(currentFolder);
    toast('Project index refreshed', 'success');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#30363d] flex-shrink-0">
        <span className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Semantic Search</span>
        <button
          onClick={reindex}
          title="Re-index project"
          className="text-[#8b949e] hover:text-[#e6edf3] text-sm transition-colors"
        >
          ⟳
        </button>
      </div>

      <div className="p-3 border-b border-[#30363d] flex-shrink-0">
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search files, functions, behavior..."
          className="w-full bg-[#0d1117] text-[#e6edf3] placeholder-[#484f58] border border-[#30363d] rounded-md px-3 py-2 text-xs outline-none focus:border-[#7c3aed]"
        />
        <div className="flex items-center justify-between mt-2 text-[10px] text-[#484f58]">
          <span>{indexing ? 'Indexing project...' : hasCurrentIndex && indexedAt ? `${files.length} files indexed` : 'No index yet'}</span>
          {currentFolder && (
            <button onClick={() => setActivePanel('explorer')} className="hover:text-[#8b949e]">Explorer</button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!currentFolder && (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 text-xs text-[#8b949e] gap-2">
            <span className="text-3xl">🔍</span>
            <p>Open a folder to search the whole project.</p>
          </div>
        )}

        {currentFolder && !query.trim() && hasCurrentIndex && (
          <div className="p-3 text-xs text-[#8b949e] leading-5">
            <p className="mb-2 text-[#e6edf3]">Ask for things the way you think about them:</p>
            <button onClick={() => setQuery('booking chat api')} className="block hover:text-[#a78bfa]">booking chat api</button>
            <button onClick={() => setQuery('send message function')} className="block hover:text-[#a78bfa]">send message function</button>
            <button onClick={() => setQuery('ollama completion')} className="block hover:text-[#a78bfa]">ollama completion</button>
          </div>
        )}

        {query.trim() && results.length === 0 && (
          <div className="p-4 text-xs text-[#8b949e]">No matches found.</div>
        )}

        {results.map((result, index) => (
          <ResultRow key={`${result.path}:${result.line || 1}:${result.name || index}`} result={result} />
        ))}
      </div>
    </div>
  );
}
