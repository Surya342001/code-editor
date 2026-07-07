// src/components/AI/GitPanel.jsx — Full Git Desktop panel (status, branches, stash, remotes)
import { useState, useEffect, useCallback } from 'react';
import useEditorStore from '../../store/editorStore';

const OLLAMA = 'http://localhost:11434';

function statusMeta(xy) {
  const s = xy?.trim() || '?';
  if (s === 'M') return { label: 'M', color: '#e3b341', title: 'Modified'  };
  if (s === 'A') return { label: 'A', color: '#3fb950', title: 'Added'     };
  if (s === 'D') return { label: 'D', color: '#f85149', title: 'Deleted'   };
  if (s === '?') return { label: '?', color: '#8b949e', title: 'Untracked' };
  if (s === 'R') return { label: 'R', color: '#79c0ff', title: 'Renamed'   };
  if (s === 'C') return { label: 'C', color: '#79c0ff', title: 'Copied'    };
  if (s === 'U') return { label: 'U', color: '#ff7b72', title: 'Conflict'  };
  return                { label: s,   color: '#8b949e', title: s           };
}

// Small reusable button
function Btn({ onClick, disabled, children, className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-xs px-2 py-1 rounded border border-[#30363d] bg-[#21262d] hover:bg-[#30363d]
        text-[#e6edf3] disabled:opacity-40 transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

export default function GitPanel() {
  const { currentFolder, toast } = useEditorStore();

  // ── core state
  const [isRepo,   setIsRepo]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [tab,      setTab]      = useState('changes');

  // changes
  const [status,   setStatus]   = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [commitMsg,  setCommitMsg]  = useState('');
  const [committing, setCommitting] = useState(false);
  const [generating, setGenerating] = useState(false);

  // diff
  const [diff,     setDiff]     = useState('');
  const [diffFile, setDiffFile] = useState(null);

  // branches
  const [branches,  setBranches]  = useState({ branches: [], remotes: [] });
  const [newBranch, setNewBranch] = useState('');
  const [branchBusy, setBranchBusy] = useState(false);

  // history
  const [log, setLog] = useState('');

  // stash
  const [stashes,  setStashes]  = useState([]);
  const [stashMsg, setStashMsg] = useState('');

  // remotes
  const [remotes,       setRemotes]       = useState([]);
  const [showRemoteForm, setShowRemoteForm] = useState(false);
  const [remoteName,    setRemoteName]    = useState('origin');
  const [remoteUrl,     setRemoteUrl]     = useState('');

  // action busy states
  const [pushing,  setPushing]  = useState(false);
  const [pulling,  setPulling]  = useState(false);
  const [fetching, setFetching] = useState(false);

  // ── data load
  const refresh = useCallback(async () => {
    if (!currentFolder || !window.api) return;
    setLoading(true);
    try {
      const repo = await window.api.gitIsRepo(currentFolder);
      setIsRepo(repo);
      if (!repo) return;

      const [s, l, br, st, rm] = await Promise.all([
        window.api.gitStatus(currentFolder),
        window.api.gitLog(currentFolder, 30),
        window.api.gitBranches(currentFolder),
        window.api.gitStashList(currentFolder),
        window.api.gitRemotes(currentFolder),
      ]);
      if (s.ok)  { setStatus(s); setSelected(new Set(s.files.map(f => f.path))); }
      if (l.ok)  setLog(l.log);
      if (br.ok) setBranches(br);
      if (st.ok) setStashes(st.stashes);
      if (rm.ok) setRemotes(rm.remotes);
    } finally { setLoading(false); }
  }, [currentFolder]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── diff
  const loadDiff = async (fp = null) => {
    if (!currentFolder || !window.api) return;
    setDiffFile(fp);
    const r = await window.api.gitDiff(currentFolder, fp);
    setDiff(r.ok ? r.diff : r.error || '');
    setTab('diff');
  };

  // ── remote actions
  const doPull = async () => {
    if (pulling) return;
    setPulling(true);
    toast('Pulling…', 'info');
    const r = await window.api.gitPull(currentFolder);
    setPulling(false);
    if (r.ok) { toast('Pulled ✓', 'success'); refresh(); }
    else toast(r.error, 'error');
  };

  const doPush = async () => {
    if (pushing) return;
    setPushing(true);
    toast('Pushing…', 'info');
    const r = await window.api.gitPush(currentFolder);
    setPushing(false);
    if (r.ok) toast('Pushed ✓', 'success');
    else toast(r.error, 'error');
  };

  const doFetch = async () => {
    if (fetching) return;
    setFetching(true);
    toast('Fetching…', 'info');
    const r = await window.api.gitFetch(currentFolder);
    setFetching(false);
    if (r.ok) { toast('Fetched ✓', 'success'); refresh(); }
    else toast(r.error, 'error');
  };

  // ── staging
  const stageSelected = async () => {
    if (!selected.size) return;
    for (const fp of selected) await window.api.gitStage(currentFolder, fp);
    toast(`Staged ${selected.size} file(s)`, 'success');
    refresh();
  };

  const discard = async (fp) => {
    if (!window.confirm(`Discard changes to ${fp}?`)) return;
    const r = await window.api.gitDiscard(currentFolder, fp);
    if (r.ok) { toast(`Discarded ${fp}`, 'success'); refresh(); }
    else toast(r.error, 'error');
  };

  // ── commit
  const generateCommitMsg = async () => {
    if (!status?.files?.length) return;
    setGenerating(true);
    setCommitMsg('');
    try {
      const d = await window.api.gitDiff(currentFolder);
      const diffCtx  = d.ok ? d.diff.slice(0, 3000) : '';
      const fileList = status.files.map(f => `${f.xy} ${f.path}`).join('\n');
      const res = await fetch(`${OLLAMA}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: useEditorStore.getState().selectedModel || 'codellama',
          prompt: `Write a concise git commit message (≤72 chars, imperative mood) for:\n\nFiles:\n${fileList}\n\nDiff:\n${diffCtx}\n\nReturn ONLY the commit message.`,
          stream: false,
          options: { temperature: 0.3, num_predict: 80 },
        }),
      });
      if (res.ok) setCommitMsg(((await res.json()).response || '').trim());
    } catch (e) { toast('AI error: ' + e.message, 'error'); }
    finally { setGenerating(false); }
  };

  const doCommit = async () => {
    if (!commitMsg.trim()) { toast('Enter a commit message', 'warn'); return; }
    setCommitting(true);
    try {
      await window.api.gitStageAll(currentFolder);
      const r = await window.api.gitCommit(currentFolder, commitMsg.trim());
      if (r.ok) { toast('Committed ✓', 'success'); setCommitMsg(''); refresh(); }
      else toast(r.error, 'error');
    } finally { setCommitting(false); }
  };

  // ── branches
  const switchBranch = async (name) => {
    setBranchBusy(true);
    const r = await window.api.gitSwitchBranch(currentFolder, name);
    setBranchBusy(false);
    if (r.ok) { toast(`Switched to ${name}`, 'success'); refresh(); }
    else toast(r.error, 'error');
  };

  const createBranch = async () => {
    if (!newBranch.trim()) return;
    setBranchBusy(true);
    const r = await window.api.gitCreateBranch(currentFolder, newBranch.trim());
    setBranchBusy(false);
    if (r.ok) { toast(`Created → ${newBranch}`, 'success'); setNewBranch(''); refresh(); }
    else toast(r.error, 'error');
  };

  const deleteBranch = async (name) => {
    if (!window.confirm(`Delete branch "${name}"?`)) return;
    const r = await window.api.gitDeleteBranch(currentFolder, name, false);
    if (r.ok) { toast(`Deleted ${name}`, 'success'); refresh(); return; }
    if (window.confirm(`Force delete "${name}"? Unmerged commits will be lost.`)) {
      const r2 = await window.api.gitDeleteBranch(currentFolder, name, true);
      if (r2.ok) { toast(`Force deleted ${name}`, 'success'); refresh(); }
      else toast(r2.error, 'error');
    }
  };

  // ── stash
  const doStash = async () => {
    const r = await window.api.gitStash(currentFolder, stashMsg.trim() || undefined);
    if (r.ok) { toast('Stashed ✓', 'success'); setStashMsg(''); refresh(); }
    else toast(r.error, 'error');
  };

  const doStashPop = async () => {
    const r = await window.api.gitStashPop(currentFolder);
    if (r.ok) { toast('Stash applied ✓', 'success'); refresh(); }
    else toast(r.error, 'error');
  };

  const doStashDrop = async (idx) => {
    if (!window.confirm('Drop this stash entry?')) return;
    const r = await window.api.gitStashDrop(currentFolder, idx);
    if (r.ok) { toast('Stash dropped', 'success'); refresh(); }
    else toast(r.error, 'error');
  };

  // ── remote add
  const addRemote = async () => {
    if (!remoteName.trim() || !remoteUrl.trim()) return;
    const r = await window.api.gitAddRemote(currentFolder, remoteName.trim(), remoteUrl.trim());
    if (r.ok) {
      toast(`Remote "${remoteName}" added ✓`, 'success');
      setRemoteUrl(''); setShowRemoteForm(false); refresh();
    } else toast(r.error, 'error');
  };

  // ── init repo
  const initRepo = async () => {
    const r = await window.api.gitInit(currentFolder);
    if (r.ok) { toast('Initialized git repo ✓', 'success'); refresh(); }
    else toast(r.error, 'error');
  };

  // ── guards
  if (!currentFolder) {
    return <div className="p-4 text-[#8b949e] text-sm">Open a folder to use Git.</div>;
  }
  if (loading) {
    return (
      <div className="p-4 text-[#8b949e] text-sm flex items-center gap-2">
        <span className="inline-block animate-spin">↻</span> Loading…
      </div>
    );
  }
  if (!isRepo) {
    return (
      <div className="p-6 flex flex-col items-center gap-4">
        <div className="text-5xl">📁</div>
        <p className="text-[#8b949e] text-sm text-center">Not a git repository.</p>
        <button
          onClick={initRepo}
          className="px-4 py-2 bg-[#238636] hover:bg-[#2ea043] text-white text-sm rounded-lg transition-colors w-full"
        >
          Initialize Repository
        </button>
      </div>
    );
  }

  const allFiles = status?.files ?? [];

  const TABS = [
    { id: 'changes',  label: `Changes ${allFiles.length > 0 ? `(${allFiles.length})` : '✓'}` },
    { id: 'diff',     label: 'Diff' },
    { id: 'branches', label: `Branches (${branches.branches?.length ?? 0})` },
    { id: 'history',  label: 'History' },
    { id: 'stash',    label: `Stash (${stashes.length})` },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs">

      {/* ── Header: branch + action buttons ── */}
      <div className="flex-shrink-0 bg-[#161b22] border-b border-[#30363d]">
        <div className="flex items-center gap-2 px-3 pt-2 pb-1">
          <span className="text-[#3fb950] font-mono font-semibold text-xs">⎇ {status?.branch || '…'}</span>
          {(status?.ahead  ?? 0) > 0 && (
            <span className="text-[#e3b341] text-[10px] bg-[#e3b34118] px-1.5 py-0.5 rounded">↑{status.ahead} ahead</span>
          )}
          {(status?.behind ?? 0) > 0 && (
            <span className="text-[#f85149] text-[10px] bg-[#f8514918] px-1.5 py-0.5 rounded">↓{status.behind} behind</span>
          )}
          <div className="flex-1" />
          <button
            onClick={refresh}
            title="Refresh"
            className="text-[#8b949e] hover:text-[#e6edf3] text-sm px-1 transition-colors"
          >↻</button>
        </div>
        <div className="flex gap-1.5 px-3 pb-2">
          <button
            onClick={doFetch}
            disabled={fetching}
            className="flex-1 py-1 text-[10px] bg-[#21262d] hover:bg-[#30363d] border border-[#30363d]
              text-[#e6edf3] rounded disabled:opacity-40 transition-colors"
          >
            {fetching ? '⏳' : '⟳'} Fetch
          </button>
          <button
            onClick={doPull}
            disabled={pulling}
            className="flex-1 py-1 text-[10px] bg-[#21262d] hover:bg-[#30363d] border border-[#30363d]
              text-[#e6edf3] rounded disabled:opacity-40 transition-colors"
          >
            {pulling ? '⏳' : '↓'} Pull
          </button>
          <button
            onClick={doPush}
            disabled={pushing}
            className="flex-1 py-1 text-[10px] bg-[#7c3aed] hover:bg-[#6d28d9]
              text-white rounded disabled:opacity-40 transition-colors font-semibold"
          >
            {pushing ? '⏳' : '↑'} Push
          </button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex border-b border-[#30363d] bg-[#0d1117] flex-shrink-0 overflow-x-auto">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-shrink-0 px-3 py-1.5 text-[10px] transition-colors whitespace-nowrap
              ${tab === id
                ? 'border-b-2 border-[#7c3aed] text-[#e6edf3]'
                : 'text-[#8b949e] hover:text-[#e6edf3]'
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden min-h-0 flex flex-col">

        {/* ╔══ CHANGES ══╗ */}
        {tab === 'changes' && (
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-2">
              {allFiles.length === 0 ? (
                <div className="text-center py-6 text-[#8b949e]">
                  <div className="text-2xl mb-1">✓</div>
                  Working tree is clean
                </div>
              ) : allFiles.map(f => {
                const { label, color, title } = statusMeta(f.xy);
                return (
                  <div key={f.path} className="flex items-center gap-1.5 py-1 px-1 rounded hover:bg-[#21262d] group">
                    <input
                      type="checkbox"
                      checked={selected.has(f.path)}
                      onChange={e => {
                        const next = new Set(selected);
                        e.target.checked ? next.add(f.path) : next.delete(f.path);
                        setSelected(next);
                      }}
                      className="accent-[#7c3aed] cursor-pointer flex-shrink-0"
                    />
                    <span title={title} style={{ color }} className="font-mono w-3.5 text-center flex-shrink-0">{label}</span>
                    <button
                      onClick={() => loadDiff(f.path)}
                      className="flex-1 text-left text-[#e6edf3] font-mono truncate hover:text-[#79c0ff] min-w-0"
                      title={f.path}
                    >
                      {f.path}
                    </button>
                    <button
                      onClick={() => discard(f.path)}
                      title="Discard"
                      className="hidden group-hover:block text-[#f85149] hover:text-red-300 px-1 flex-shrink-0"
                    >×</button>
                  </div>
                );
              })}
            </div>

            {/* Commit area */}
            <div className="flex-shrink-0 border-t border-[#30363d] bg-[#0d1117] p-2 space-y-1.5">
              <textarea
                value={commitMsg}
                onChange={e => setCommitMsg(e.target.value)}
                placeholder="Commit message…"
                rows={2}
                className="w-full bg-[#161b22] border border-[#30363d] rounded text-xs text-[#e6edf3]
                  placeholder-[#484f58] px-2 py-1.5 resize-none focus:outline-none focus:border-[#7c3aed]"
              />
              <div className="flex gap-1">
                <button
                  onClick={generateCommitMsg}
                  disabled={generating || !allFiles.length}
                  className="flex-1 py-1 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d]
                    text-[#e6edf3] rounded disabled:opacity-40 transition-colors"
                >
                  {generating ? '⏳ Generating…' : '✨ AI Message'}
                </button>
                <button
                  onClick={stageSelected}
                  disabled={!selected.size}
                  className="py-1 px-2 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d]
                    text-[#e6edf3] rounded disabled:opacity-40 transition-colors"
                >
                  Stage ({selected.size})
                </button>
                <button
                  onClick={doCommit}
                  disabled={committing || !commitMsg.trim()}
                  className="py-1 px-3 bg-[#238636] hover:bg-[#2ea043] text-white rounded
                    disabled:opacity-40 transition-colors font-semibold"
                >
                  {committing ? '…' : 'Commit'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ╔══ DIFF ══╗ */}
        {tab === 'diff' && (
          <div className="flex-1 overflow-y-auto p-2">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[#8b949e]">{diffFile || 'All changes'}</span>
              <button onClick={() => loadDiff(null)} className="text-[#79c0ff] hover:underline">Show all</button>
            </div>
            <pre className="font-mono overflow-x-auto whitespace-pre leading-5">
              {diff.split('\n').map((line, i) => (
                <span
                  key={i}
                  style={{
                    color: line.startsWith('+') && !line.startsWith('+++') ? '#3fb950'
                      : line.startsWith('-') && !line.startsWith('---') ? '#f85149'
                      : line.startsWith('@@') ? '#79c0ff'
                      : '#8b949e',
                    display: 'block',
                  }}
                >{line}</span>
              ))}
            </pre>
          </div>
        )}

        {/* ╔══ BRANCHES ══╗ */}
        {tab === 'branches' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-4">

            {/* Create branch */}
            <section>
              <p className="text-[#8b949e] uppercase tracking-wider mb-1.5">New Branch</p>
              <div className="flex gap-1">
                <input
                  value={newBranch}
                  onChange={e => setNewBranch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createBranch()}
                  placeholder="branch-name"
                  className="flex-1 bg-[#161b22] border border-[#30363d] rounded text-xs text-[#e6edf3]
                    placeholder-[#484f58] px-2 py-1.5 focus:outline-none focus:border-[#7c3aed]"
                />
                <button
                  onClick={createBranch}
                  disabled={!newBranch.trim() || branchBusy}
                  className="px-3 py-1 bg-[#238636] hover:bg-[#2ea043] text-white rounded disabled:opacity-40 transition-colors"
                >
                  Create
                </button>
              </div>
            </section>

            {/* Local branches */}
            <section>
              <p className="text-[#8b949e] uppercase tracking-wider mb-1.5">
                Local ({branches.branches?.length ?? 0})
              </p>
              <div className="space-y-0.5">
                {branches.branches?.map(b => (
                  <div
                    key={b.name}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded group ${
                      b.current ? 'bg-[#7c3aed]/15 border border-[#7c3aed]/30' : 'hover:bg-[#21262d]'
                    }`}
                  >
                    <span className={b.current ? 'text-[#7c3aed]' : 'text-[#484f58]'}>●</span>
                    <span className={`flex-1 font-mono truncate ${b.current ? 'text-[#d2a8ff]' : 'text-[#e6edf3]'}`}>
                      {b.name}
                    </span>
                    {b.current ? (
                      <span className="text-[#7c3aed] text-[10px]">current</span>
                    ) : (
                      <div className="hidden group-hover:flex gap-1">
                        <button
                          onClick={() => switchBranch(b.name)}
                          disabled={branchBusy}
                          className="px-1.5 py-0.5 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d]
                            text-[#e6edf3] rounded disabled:opacity-40"
                        >
                          Switch
                        </button>
                        <button
                          onClick={() => deleteBranch(b.name)}
                          className="px-1.5 py-0.5 text-[#f85149] hover:bg-[#f8514920] rounded"
                          title="Delete branch"
                        >
                          🗑
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Remote branches */}
            {(branches.remotes?.length ?? 0) > 0 && (
              <section>
                <p className="text-[#8b949e] uppercase tracking-wider mb-1.5">
                  Remote ({branches.remotes.length})
                </p>
                <div className="space-y-0.5">
                  {branches.remotes.map(r => (
                    <div key={r} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#21262d] group">
                      <span className="text-[#8b949e]">⌀</span>
                      <span className="flex-1 font-mono text-[#79c0ff] truncate">{r}</span>
                      <button
                        onClick={() => switchBranch(r.replace(/^[^/]+\//, ''))}
                        className="hidden group-hover:block px-1.5 py-0.5 bg-[#21262d] hover:bg-[#30363d]
                          border border-[#30363d] text-[#e6edf3] rounded"
                      >
                        Checkout
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Remotes management */}
            <section>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[#8b949e] uppercase tracking-wider">Remotes</p>
                <button
                  onClick={() => setShowRemoteForm(v => !v)}
                  className="text-[#7c3aed] hover:underline"
                >
                  + Add remote
                </button>
              </div>

              {showRemoteForm && (
                <div className="space-y-1 mb-2 p-2 bg-[#161b22] border border-[#30363d] rounded-lg">
                  <input
                    value={remoteName}
                    onChange={e => setRemoteName(e.target.value)}
                    placeholder="name (origin)"
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded text-xs text-[#e6edf3]
                      placeholder-[#484f58] px-2 py-1.5 focus:outline-none focus:border-[#7c3aed]"
                  />
                  <div className="flex gap-1">
                    <input
                      value={remoteUrl}
                      onChange={e => setRemoteUrl(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addRemote()}
                      placeholder="https://github.com/user/repo.git"
                      className="flex-1 bg-[#0d1117] border border-[#30363d] rounded text-xs text-[#e6edf3]
                        placeholder-[#484f58] px-2 py-1.5 focus:outline-none focus:border-[#7c3aed]"
                    />
                    <button
                      onClick={addRemote}
                      disabled={!remoteUrl.trim()}
                      className="px-2 py-1 bg-[#238636] hover:bg-[#2ea043] text-white rounded disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              {remotes.length > 0 ? (
                <div className="space-y-1">
                  {remotes.map(r => (
                    <div key={r.name} className="flex items-center gap-2 px-2 py-1.5 bg-[#161b22] border border-[#30363d] rounded">
                      <span className="font-mono text-[#e3b341] flex-shrink-0">{r.name}</span>
                      <span className="text-[#8b949e] truncate font-mono">{r.url}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[#484f58]">No remotes configured</p>
              )}
            </section>
          </div>
        )}

        {/* ╔══ HISTORY ══╗ */}
        {tab === 'history' && (
          <div className="flex-1 overflow-y-auto p-2">
            {log ? log.split('\n').filter(Boolean).map((line, i) => {
              const hash = line.slice(0, 7);
              const rest = line.slice(7).trim();
              return (
                <div key={i} className="flex items-start gap-2 py-1.5 px-1 hover:bg-[#21262d] rounded">
                  <span className="text-[#e3b341] font-mono flex-shrink-0">{hash}</span>
                  <span className="text-[#e6edf3] leading-4 break-all">{rest}</span>
                </div>
              );
            }) : (
              <p className="text-[#8b949e] p-4 text-center">No commits yet.</p>
            )}
          </div>
        )}

        {/* ╔══ STASH ══╗ */}
        {tab === 'stash' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-4">

            <section>
              <p className="text-[#8b949e] uppercase tracking-wider mb-1.5">Save Stash</p>
              <div className="flex gap-1">
                <input
                  value={stashMsg}
                  onChange={e => setStashMsg(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doStash()}
                  placeholder="Stash message (optional)"
                  className="flex-1 bg-[#161b22] border border-[#30363d] rounded text-xs text-[#e6edf3]
                    placeholder-[#484f58] px-2 py-1.5 focus:outline-none focus:border-[#7c3aed]"
                />
                <button
                  onClick={doStash}
                  disabled={!allFiles.length}
                  className="px-3 py-1 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d]
                    text-[#e6edf3] rounded disabled:opacity-40 transition-colors"
                >
                  Stash
                </button>
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[#8b949e] uppercase tracking-wider">Stashes ({stashes.length})</p>
                {stashes.length > 0 && (
                  <button
                    onClick={doStashPop}
                    className="px-2 py-0.5 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d]
                      text-[#e6edf3] rounded transition-colors"
                  >
                    Pop latest
                  </button>
                )}
              </div>
              {stashes.length === 0 ? (
                <p className="text-[#484f58]">No stashes saved</p>
              ) : (
                <div className="space-y-1">
                  {stashes.map((s, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 px-2 py-1.5 bg-[#161b22] border border-[#30363d]
                        rounded hover:border-[#484f58] group"
                    >
                      <span className="text-[#7c3aed] font-mono flex-shrink-0">{idx}</span>
                      <span className="flex-1 text-[#e6edf3] truncate">{s.replace(/^stash@\{\d+\}: /, '')}</span>
                      <div className="hidden group-hover:flex gap-1">
                        <button
                          onClick={doStashPop}
                          className="px-1.5 py-0.5 text-[#3fb950] hover:bg-[#3fb95020] rounded"
                        >
                          Apply
                        </button>
                        <button
                          onClick={() => doStashDrop(idx)}
                          className="px-1.5 py-0.5 text-[#f85149] hover:bg-[#f8514920] rounded"
                        >
                          Drop
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

      </div>
    </div>
  );
}

