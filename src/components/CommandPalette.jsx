// src/components/CommandPalette.jsx
import { useState, useRef, useEffect } from 'react';
import useEditorStore from '../store/editorStore';
import useProjectIndex from '../store/projectIndex';

export default function CommandPalette() {
  const store = useEditorStore();
  const projectIndex = useProjectIndex();
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  const commands = [
    { label: 'Open Folder',       icon: '📂', run: async () => { const r = await window.api?.openFolder(); if (!r?.canceled) { store.setCurrentFolder(r.filePaths[0]); store.setActivePanel('explorer'); } } },
    { label: 'Run Project',       icon: '▶',  run: () => store.detectAndRun() },
    { label: 'Semantic Search',   icon: '🔍', run: () => { store.setActivePanel('search'); } },
    { label: 'Re-index Project',  icon: '⟳', run: async () => { if (store.currentFolder) { await projectIndex.buildIndex(store.currentFolder); store.toast('Project index refreshed', 'success'); } } },
    { label: 'New File',          icon: '📄', run: () => store.toast('Use the sidebar context menu to create files') },
    { label: 'Toggle Sidebar',    icon: '⬅', run: () => store.toggleSidebar() },
    { label: 'Toggle Terminal',   icon: '⌨', run: () => store.toggleTerminal() },
    { label: 'Toggle AI Panel',   icon: '🤖', run: () => store.toggleAIPanel() },
    { label: 'Save File',         icon: '💾', run: () => store.saveActive() },
    { label: 'Close Active Tab',  icon: '✕', run: () => { if (store.activeTabId) store.closeTab(store.activeTabId); } },
    { label: 'Close Palette',     icon: '⎋', run: () => store.togglePalette() },
  ];

  const filtered = commands.filter(c =>
    c.label.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => { inputRef.current?.focus(); }, []);

  const execute = (cmd) => { cmd.run(); store.togglePalette(); };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm"
      onClick={store.togglePalette}
    >
      <div
        className="w-[520px] bg-[#161b22] rounded-xl border border-[#30363d] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') store.togglePalette();
            if (e.key === 'Enter' && filtered[0]) execute(filtered[0]);
          }}
          placeholder="Type a command…"
          className="w-full bg-transparent px-4 py-3 text-[#e6edf3] placeholder-[#484f58] outline-none text-sm border-b border-[#30363d]"
        />
        <ul className="max-h-72 overflow-y-auto py-1">
          {filtered.map((c, i) => (
            <li
              key={i}
              onClick={() => execute(c)}
              className="flex items-center gap-3 px-4 py-2 text-sm text-[#e6edf3] cursor-pointer hover:bg-[#21262d] transition-colors"
            >
              <span>{c.icon}</span>
              <span>{c.label}</span>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-4 py-3 text-sm text-[#8b949e]">No commands found</li>
          )}
        </ul>
      </div>
    </div>
  );
}
