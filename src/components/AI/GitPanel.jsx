// src/components/AI/GitPanel.jsx — Aider-style Git panel with AI commit messages
import { useState, useEffect, useCallback } from 'react';
import useEditorStore from '../../store/editorStore';

const OLLAMA = 'http://localhost:11434';

// Status code → human label + color
function fileStatus(xy) {
  const s = xy?.trim() || '?';
  if (s === 'M')  return { label: 'Modified',  color: '#e3b341' };
  if (s === 'A')  return { label: 'Added',     color: '#3fb950' };
  if (s === 'D')  return { label: 'Deleted',   color: '#f85149' };
  if (s === '?')  return { label: 'Untracked', color: '#8b949e' };
  if (s === 'R')  return { label: 'Renamed',   color: '#79c0ff' };
  if (s === 'C')  return { label: 'Copied',    color: '#79c0ff' };
  return          { label: s,          color: '#8b949e' };
}

export default function GitPanel() {
  const { currentFolder, toast, showTerminal, toggleTerminal, terminalSender } = useEditorStore();

  const [status,      setStatus]      = useState(null);   // { branch, files, ahead, behind }
  const [log,         setLog]         = useState('');
  const [diff,        setDiff]        = useState('');
  const [diffFile,    setDiffFile]    = useState(null);   // null = all
  const [isRepo,      setIsRepo]      = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [committing,  setCommitting]  = useState(false);
  const [commitMsg,   setCommitMsg]   = useState('');
  const [generating,  setGenerating]  = useState(false);
  const [tab,         setTab]         = useState('changes'); // 'changes' | 'diff' | 'log'
  const [selected,    setSelected]    = useState(new Set()); // selected file paths for staging

  const refresh = useCallback(async () => {
    if (!currentFolder || !window.api) return;
    setLoading(true);
    try {
      const repo = await window.api.gitIsRepo(currentFolder);
      setIsRepo(repo);
      if (!repo) return;

      const [s, l] = await Promise.all([
        window.api.gitStatus(currentFolder),
        window.api.gitLog(currentFolder, 15),
      ]);
      if (s.ok)  setStatus(s);
      if (l.ok)  setLog(l.log);

      // Auto-select all changed files
      if (s.ok) setSelected(new Set(s.files.map(f => f.path)));
    } finally { setLoading(false); }
  }, [currentFolder]);

  useEffect(() => { refresh(); }, [refresh]);

  const loadDiff = async (filePath = null) => {
    if (!currentFolder || !window.api) return;
    setDiffFile(filePath);
    const r = await window.api.gitDiff(currentFolder, filePath);
    setDiff(r.ok ? r.diff : r.error);
    setTab('diff');
  };

  const stageAll = async () => {
    if (!currentFolder || !window.api) return;
    const r = await window.api.gitStageAll(currentFolder);
    if (r.ok) { toast('Staged all changes', 'success'); await refresh(); }
    else toast(r.error, 'error');
  };

  const stageSelected = async () => {
    if (!currentFolder || !window.api || selected.size === 0) return;
    for (const fp of selected) {
      await window.api.gitStage(currentFolder, fp);
    }
    toast(`Staged ${selected.size} file(s)`, 'success');
    await refresh();
  };

  const discard = async (fp) => {
    if (!window.api || !window.confirm(`Discard changes to ${fp}?`)) return;
    const r = await window.api.gitDiscard(currentFolder, fp);
    if (r.ok) { toast(`Discarded ${fp}`, 'success'); await refresh(); }
    else toast(r.error, 'error');
  };

  const generateCommitMessage = async () => {
    if (!status?.files?.length) return;
    setGenerating(true);
    setCommitMsg('');
    try {
      // Get diff to give AI context
      const d = await window.api.gitDiff(currentFolder);
      const diffContext = d.ok ? d.diff.slice(0, 3000) : '';
      const fileList = status.files.map(f => `${f.xy} ${f.path}`).join('\n');

      const res = await fetch(`${OLLAMA}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: useEditorStore.getState().selectedModel || 'codellama',
          prompt: `Generate a concise git commit message (imperative mood, ≤72 chars) for these changes:\n\nFiles changed:\n${fileList}\n\nDiff (first 3000 chars):\n${diffContext}\n\nReturn ONLY the commit message, no quotes, no explanation.`,
          stream: false,
          options: { temperature: 0.3, num_predict: 80 },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCommitMsg((data.response || '').trim());
      }
    } catch (e) { toast('AI error: ' + e.message, 'error'); }
    finally { setGenerating(false); }
  };

  const doCommit = async () => {
    if (!commitMsg.trim()) { toast('Commit message is empty', 'warn'); return; }
    setCommitting(true);
    try {
      // Stage all first if nothing is staged
      await window.api.gitStageAll(currentFolder);
      const r = await window.api.gitCommit(currentFolder, commitMsg.trim());
      if (r.ok) {
        toast('Committed ✓', 'success');
        setCommitMsg('');
        await refresh();
      } else toast(r.error, 'error');
    } finally { setCommitting(false); }
  };

  const doPush = async () => {
    if (!currentFolder || !window.api) return;
    toast('Pushing…', 'info');
    const r = await window.api.gitPush(currentFolder);
    if (r.ok) toast('Pushed ✓', 'success');
    else toast(r.error, 'error');
  };

  const runGitCmd = (cmd) => {
    if (!showTerminal) toggleTerminal();
    const send = () => {
      const sender = terminalSender || useEditorStore.getState().terminalSender;
      if (sender) sender(`cd "${currentFolder}" && ${cmd}\r`);
      else setTimeout(send, 300);
    };
    setTimeout(send, 400);
  };

  if (!currentFolder) {
    return <div className="p-4 text-[#8b949e] text-sm">Open a folder to use Git features.</div>;
  }

  if (loading) {
    return <div className="p-4 text-[#8b949e] text-sm animate-pulse">Loading git status…</div>;
  }

  if (!isRepo) {
    return (
      <div className="p-4 space-y-3">
        <p className="text-[#8b949e] text-sm">Not a git repository.</p>
        <button
          onClick={() => runGitCmd('git init')}
          className="w-full py-1.5 px-3 bg-[#238636] hover:bg-[#2ea043] text-white text-xs rounded transition-colors"
        >
          git init
        </button>
      </div>
    );
  }

  const untracked = status?.files?.filter(f => f.xy?.trim() === '?') ?? [];
  const changed   = status?.files?.filter(f => f.xy?.trim() !== '?') ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden text-sm">
      {/* Branch bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#30363d] bg-[#161b22] flex-shrink-0">
        <span className="text-[#3fb950] font-mono text-xs">⎇ {status?.branch || '…'}</span>
        {status?.ahead  > 0 && <span className="text-[#e3b341] text-xs">↑{status.ahead}</span>}
        {status?.behind > 0 && <span className="text-[#f85149] text-xs">↓{status.behind}</span>}
        <div className="flex-1" />
        <button onClick={refresh} title="Refresh" className="text-[#8b949e] hover:text-[#e6edf3] text-base">↻</button>
        <button onClick={doPush}  title="Push" className="text-[#8b949e] hover:text-[#79c0ff] text-xs px-1.5 py-0.5 border border-[#30363d] rounded">↑ push</button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#30363d] flex-shrink-0">
        {[['changes', `Changes (${status?.files?.length ?? 0})`], ['diff','Diff'], ['log','Log']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-1.5 text-xs transition-colors ${tab === id ? 'border-b-2 border-[#7c3aed] text-[#e6edf3]' : 'text-[#8b949e] hover:text-[#e6edf3]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {/* ── Changes tab ── */}
        {tab === 'changes' && (
          <div className="p-2 space-y-1">
            {status?.files?.length === 0 && (
              <p className="text-[#8b949e] text-xs p-2">Working tree is clean ✓</p>
            )}
            {status?.files?.map(f => {
              const { label, color } = fileStatus(f.xy);
              const checked = selected.has(f.path);
              return (
                <div
                  key={f.path}
                  className="flex items-center gap-1.5 py-1 px-1 rounded hover:bg-[#21262d] group"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => {
                      const next = new Set(selected);
                      e.target.checked ? next.add(f.path) : next.delete(f.path);
                      setSelected(next);
                    }}
                    className="accent-[#7c3aed] cursor-pointer"
                  />
                  <span style={{ color }} className="text-xs font-mono w-4 flex-shrink-0">{f.xy?.trim()}</span>
                  <button
                    onClick={() => loadDiff(f.path)}
                    className="flex-1 text-left text-[#e6edf3] text-xs font-mono truncate hover:text-[#79c0ff]"
                    title={f.path}
                  >
                    {f.path}
                  </button>
                  <button
                    onClick={() => discard(f.path)}
                    title="Discard changes"
                    className="hidden group-hover:block text-[#f85149] hover:text-red-400 text-xs px-1"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Diff tab ── */}
        {tab === 'diff' && (
          <div className="p-2">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[#8b949e] text-xs">{diffFile || 'All changes'}</span>
              <button onClick={() => loadDiff(null)} className="text-xs text-[#79c0ff] hover:underline">Show all</button>
            </div>
            <pre className="text-xs font-mono text-[#e6edf3] overflow-x-auto whitespace-pre leading-5">
              {diff.split('\n').map((line, i) => {
                const color = line.startsWith('+') && !line.startsWith('+++')
                  ? '#3fb950' : line.startsWith('-') && !line.startsWith('---')
                  ? '#f85149' : line.startsWith('@@')
                  ? '#79c0ff' : '#8b949e';
                return <span key={i} style={{ color }}>{line}{'\n'}</span>;
              })}
            </pre>
          </div>
        )}

        {/* ── Log tab ── */}
        {tab === 'log' && (
          <div className="p-2">
            <pre className="text-xs font-mono text-[#8b949e] leading-5 whitespace-pre-wrap">{log || 'No commits yet.'}</pre>
          </div>
        )}
      </div>

      {/* ── Commit section ── */}
      <div className="border-t border-[#30363d] p-2 space-y-2 flex-shrink-0 bg-[#0d1117]">
        <div className="flex items-center gap-1">
          <textarea
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            placeholder="Commit message…"
            rows={2}
            className="flex-1 bg-[#161b22] border border-[#30363d] rounded text-xs text-[#e6edf3] placeholder-[#484f58] px-2 py-1.5 resize-none focus:outline-none focus:border-[#7c3aed]"
          />
        </div>
        <div className="flex gap-1">
          <button
            onClick={generateCommitMessage}
            disabled={generating || !status?.files?.length}
            className="flex-1 py-1 text-xs bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] rounded disabled:opacity-50 transition-colors"
          >
            {generating ? '⏳ Generating…' : '✨ AI message'}
          </button>
          <button
            onClick={stageSelected}
            disabled={selected.size === 0}
            className="py-1 px-2 text-xs bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] rounded disabled:opacity-50 transition-colors"
          >
            Stage ({selected.size})
          </button>
          <button
            onClick={doCommit}
            disabled={committing || !commitMsg.trim()}
            className="py-1 px-3 text-xs bg-[#238636] hover:bg-[#2ea043] text-white rounded disabled:opacity-50 transition-colors font-medium"
          >
            {committing ? '…' : 'Commit'}
          </button>
        </div>
      </div>
    </div>
  );
}
