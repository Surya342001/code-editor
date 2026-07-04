// src/components/Sidebar/FileExplorer.jsx
import { useState, useEffect, useCallback } from 'react';
import useEditorStore from '../../store/editorStore';

// ─── File icons ───────────────────────────────────────────────────────────
function fileIcon(name, isDir) {
  if (isDir) return '📁';
  const ext = name.split('.').pop()?.toLowerCase();
  const m = {
    js:'🟨', jsx:'⚛️', ts:'🔷', tsx:'⚛️',
    py:'🐍', go:'🐹', rs:'🦀', java:'☕',
    rb:'💎', php:'🐘', cs:'💙', cpp:'⚙️', c:'⚙️',
    html:'🌐', css:'🎨', scss:'🎨', json:'📋',
    md:'📝', yaml:'⚙️', yml:'⚙️', toml:'⚙️',
    sh:'🖥', bash:'🖥', env:'🔒',
    sql:'🗃', graphql:'🔗',
    png:'🖼', jpg:'🖼', jpeg:'🖼', gif:'🖼', svg:'🎭',
    pdf:'📕', zip:'📦', tar:'📦', gz:'📦',
    dockerfile:'🐳',
  };
  return m[ext] || '📄';
}

// ─── Tree node ────────────────────────────────────────────────────────────
function TreeNode({ entry, depth = 0 }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(entry.name);
  const [ctxPos, setCtxPos] = useState(null);

  const { openFile, toast } = useEditorStore();

  const loadChildren = useCallback(async () => {
    if (!entry.isDirectory || !window.api) return;
    setLoading(true);
    const res = await window.api.readDir(entry.path);
    setLoading(false);
    if (res.entries) setChildren(res.entries);
  }, [entry]);

  const toggle = async () => {
    if (!entry.isDirectory) { openFile(entry); return; }
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && children.length === 0) await loadChildren();
  };

  const handleContext = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxPos({ x: e.clientX, y: e.clientY });
  };

  const closeCtx = () => setCtxPos(null);

  const doRename = async () => {
    if (newName === entry.name) { setRenaming(false); return; }
    const parent = entry.path.split('/').slice(0, -1).join('/');
    const res = await window.api?.renameItem(entry.path, `${parent}/${newName}`);
    if (res?.ok) { toast('Renamed', 'success'); entry.name = newName; entry.path = `${parent}/${newName}`; }
    else toast(res?.error || 'Rename failed', 'error');
    setRenaming(false);
  };

  const doDelete = async () => {
    closeCtx();
    if (!confirm(`Delete "${entry.name}"?`)) return;
    const res = await window.api?.deleteItem(entry.path);
    if (res?.ok) toast('Deleted', 'success');
    else toast(res?.error || 'Delete failed', 'error');
  };

  const doNewFile = async () => {
    closeCtx();
    const name = prompt('File name:');
    if (!name) return;
    const fp = entry.isDirectory ? `${entry.path}/${name}` : `${entry.path.split('/').slice(0, -1).join('/')}/${name}`;
    const res = await window.api?.createFile(fp);
    if (res?.ok) { toast(`Created ${name}`, 'success'); if (entry.isDirectory && open) await loadChildren(); }
    else toast(res?.error || 'Create failed', 'error');
  };

  const doNewFolder = async () => {
    closeCtx();
    const name = prompt('Folder name:');
    if (!name) return;
    const dp = entry.isDirectory ? `${entry.path}/${name}` : `${entry.path.split('/').slice(0, -1).join('/')}/${name}`;
    const res = await window.api?.createDir(dp);
    if (res?.ok) { toast(`Created ${name}/`, 'success'); if (entry.isDirectory && open) await loadChildren(); }
    else toast(res?.error || 'Create failed', 'error');
  };

  return (
    <>
      {ctxPos && (
        <div
          className="fixed z-50 bg-[#21262d] border border-[#30363d] rounded-lg shadow-xl py-1 text-sm w-44"
          style={{ top: ctxPos.y, left: ctxPos.x }}
          onMouseLeave={closeCtx}
        >
          {[
            { label: '📄 New File',   fn: doNewFile },
            { label: '📁 New Folder', fn: doNewFolder },
            { label: '✏️ Rename',     fn: () => { closeCtx(); setRenaming(true); } },
            { label: '🗑 Delete',     fn: doDelete },
          ].map(({ label, fn }) => (
            <button key={label} onClick={fn}
              className="w-full text-left px-3 py-1.5 hover:bg-[#30363d] text-[#e6edf3] transition-colors">
              {label}
            </button>
          ))}
        </div>
      )}

      <div
        className="flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-[#21262d] rounded group select-none"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={toggle}
        onContextMenu={handleContext}
      >
        <span className="text-[10px] text-[#484f58] w-3 flex-shrink-0">
          {entry.isDirectory ? (open ? '▾' : '▸') : ''}
        </span>
        <span className="text-base leading-none flex-shrink-0">{fileIcon(entry.name, entry.isDirectory)}</span>
        {renaming ? (
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onBlur={doRename}
            onKeyDown={e => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') setRenaming(false); }}
            className="ml-1 flex-1 bg-[#0d1117] text-[#e6edf3] text-sm border border-[#7c3aed] rounded px-1 outline-none"
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="ml-1 text-sm text-[#e6edf3] truncate">{entry.name}</span>
        )}
        {loading && <span className="ml-auto text-[#8b949e] text-xs">⏳</span>}
      </div>

      {entry.isDirectory && open && children.map(child => (
        <TreeNode key={child.path} entry={child} depth={depth + 1} />
      ))}
    </>
  );
}

// ─── File Explorer ─────────────────────────────────────────────────────────
export default function FileExplorer() {
  const { currentFolder, setCurrentFolder, setActivePanel, toast } = useEditorStore();
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    if (!currentFolder) return;
    (async () => {
      const res = await window.api?.readDir(currentFolder);
      if (res?.entries) setEntries(res.entries);
    })();
  }, [currentFolder]);

  const openFolder = async () => {
    const r = await window.api?.openFolder();
    if (!r?.canceled && r?.filePaths?.[0]) {
      setCurrentFolder(r.filePaths[0]);
      setActivePanel('explorer');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#30363d] flex-shrink-0">
        <span className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Explorer</span>
        <button
          onClick={openFolder}
          title="Open Folder"
          className="text-[#8b949e] hover:text-[#e6edf3] text-sm transition-colors"
        >
          📂
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-1">
        {!currentFolder ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
            <span className="text-3xl">📁</span>
            <p className="text-xs text-[#8b949e]">No folder open</p>
            <button
              onClick={openFolder}
              className="px-3 py-1.5 bg-[#7c3aed] text-white text-xs rounded-lg hover:bg-[#6d28d9] transition-colors"
            >
              Open Folder
            </button>
          </div>
        ) : (
          <>
            <div className="px-2 py-1 text-xs text-[#484f58] font-medium uppercase truncate">
              {currentFolder.split('/').pop()}
            </div>
            {entries.map(e => <TreeNode key={e.path} entry={e} depth={0} />)}
          </>
        )}
      </div>
    </div>
  );
}
