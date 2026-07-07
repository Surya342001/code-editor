// src/components/AI/ModelGuide.jsx — Interactive Ollama model manager
import { useState, useRef, useEffect } from 'react';
import useEditorStore from '../../store/editorStore';
import useRagStore from '../../store/ragStore';

const OLLAMA = 'http://localhost:11434';

const RECOMMENDED = [
  {
    id: 'qwen2.5-coder:7b',
    badge: 'Fast',
    badgeColor: '#79c0ff',
    ram: '~5 GB',
    notes: 'Best speed/quality balance. Works on 16 GB RAM.',
  },
  {
    id: 'qwen2.5-coder:14b',
    badge: '⭐ Best',
    badgeColor: '#3fb950',
    ram: '~10 GB',
    notes: 'State-of-the-art code model. Needs 16 GB+ unified memory.',
  },
  {
    id: 'deepseek-coder-v2:16b',
    badge: 'Alt',
    badgeColor: '#e3b341',
    ram: '~12 GB',
    notes: 'Strong reasoning about code and debugging.',
  },
  {
    id: 'codellama:13b',
    badge: 'Fallback',
    badgeColor: '#8b949e',
    ram: '~9 GB',
    notes: 'Reliable fallback, works on 16 GB RAM.',
  },
  {
    id: 'nomic-embed-text',
    badge: 'RAG',
    badgeColor: '#f0883e',
    ram: '<1 GB',
    notes: 'Required for RAG semantic search. Install this first.',
  },
];

const HARDWARE = [
  { ram: '8 GB',         tip: 'Use 7B models only. Avoid 13B+ unless quantized.' },
  { ram: '16 GB',        tip: 'Run 7–13B well CPU-only. 7B at full speed with GPU.' },
  { ram: '32 GB / M2+',  tip: '14–16B run great. Unified memory = no VRAM limit.' },
  { ram: '64 GB / M2 Max', tip: 'Run 32B+ models. qwen2.5-coder:32b is excellent.' },
];

export default function ModelGuide() {
  const { ollamaModels, selectedModel, setSelectedModel, ollamaOnline, setOllamaModels, setOllamaOnline, toast } = useEditorStore();
  const { embedModelAvailable, checkModel } = useRagStore();

  const [detailedModels, setDetailedModels] = useState([]); // [{name, size, modified_at}]
  const [pullTarget,   setPullTarget]   = useState('');
  const [pulling,      setPulling]      = useState(false);
  const [pullProgress, setPullProgress] = useState(null);
  const [deleting,     setDeleting]     = useState(null);
  const abortRef = useRef(null);

  // Fetch detailed model list (with sizes)
  const refreshModels = async () => {
    try {
      const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return;
      const data = await r.json();
      const models = data.models || [];
      setDetailedModels(models);
      setOllamaModels(models.map(m => m.name));
      setOllamaOnline(true);
    } catch { setOllamaOnline(false); }
  };

  useEffect(() => { refreshModels(); }, []);

  const installedSet = new Set(detailedModels.map(m => m.name));

  // Pull a model with streaming progress
  const pullModel = async (modelId) => {
    const target = (modelId || pullTarget).trim();
    if (!target) return;
    if (!ollamaOnline) { toast('Ollama offline — run: ollama serve', 'error'); return; }
    setPulling(true);
    setPullProgress({ status: 'Starting…', completed: 0, total: 0 });
    abortRef.current = new AbortController();
    try {
      const res = await fetch(`${OLLAMA}/api/pull`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  abortRef.current.signal,
        body:    JSON.stringify({ name: target, stream: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value).split('\n')) {
          if (!line.trim()) continue;
          try {
            const j = JSON.parse(line);
            setPullProgress({ status: j.status || '', completed: j.completed || 0, total: j.total || 0 });
          } catch { /* partial */ }
        }
      }
      toast(`Pulled ${target} ✓`, 'success');
      setPullTarget('');
      await refreshModels();
      checkModel();
    } catch (e) {
      if (e.name !== 'AbortError') toast('Pull failed: ' + e.message, 'error');
    } finally {
      setPulling(false);
      setPullProgress(null);
      abortRef.current = null;
    }
  };

  const deleteModel = async (name) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeleting(name);
    try {
      const res = await fetch(`${OLLAMA}/api/delete`, {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name }),
      });
      if (res.ok) {
        toast(`Deleted ${name}`, 'success');
        if (selectedModel === name) setSelectedModel('codellama');
        await refreshModels();
      } else throw new Error(`HTTP ${res.status}`);
    } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
    finally { setDeleting(null); }
  };

  const pct = pullProgress?.total > 0
    ? Math.round((pullProgress.completed / pullProgress.total) * 100)
    : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto p-3 space-y-5 text-xs">

      {/* Status card */}
      <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${
        ollamaOnline
          ? 'border-[#3fb950]/40 bg-[#0a1f0a]'
          : 'border-[#f85149]/40 bg-[#1f0a0a]'
      }`}>
        <span className="text-2xl">{ollamaOnline ? '🟢' : '🔴'}</span>
        <div className="flex-1">
          <p className={`text-sm font-semibold ${ollamaOnline ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
            Ollama {ollamaOnline ? 'Online' : 'Offline'}
          </p>
          {!ollamaOnline && (
            <p className="text-[#8b949e]">Start with: <code className="text-[#e3b341]">ollama serve</code></p>
          )}
        </div>
        <button
          onClick={refreshModels}
          className="text-[#8b949e] hover:text-[#e6edf3] text-base transition-colors"
          title="Refresh"
        >↻</button>
      </div>

      {/* Download model */}
      <section className="space-y-2">
        <p className="text-[#8b949e] uppercase tracking-wider font-semibold">Download Model</p>
        <div className="flex gap-1">
          <input
            value={pullTarget}
            onChange={e => setPullTarget(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !pulling && pullModel()}
            placeholder="e.g. qwen2.5-coder:7b"
            disabled={pulling}
            className="flex-1 bg-[#161b22] border border-[#30363d] rounded text-xs text-[#e6edf3]
              placeholder-[#484f58] px-2 py-1.5 focus:outline-none focus:border-[#7c3aed] disabled:opacity-50"
          />
          {pulling ? (
            <button
              onClick={() => abortRef.current?.abort()}
              className="px-3 py-1 bg-[#f85149] hover:bg-red-600 text-white rounded transition-colors"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={() => pullModel()}
              disabled={!pullTarget.trim() || !ollamaOnline}
              className="px-3 py-1 bg-[#7c3aed] hover:bg-[#6d28d9] text-white rounded disabled:opacity-40 transition-colors"
            >
              Pull
            </button>
          )}
        </div>
        {pulling && pullProgress && (
          <div className="space-y-1">
            <div className="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#7c3aed] transition-all duration-300 rounded-full"
                style={{ width: pct != null ? `${pct}%` : '30%' }}
              />
            </div>
            <p className="text-[#8b949e] truncate">
              {pullProgress.status}
              {pct != null && ` — ${pct}%`}
              {pullProgress.total > 0 && ` (${(pullProgress.completed / 1e9).toFixed(2)} / ${(pullProgress.total / 1e9).toFixed(2)} GB)`}
            </p>
          </div>
        )}
      </section>

      {/* Installed models */}
      {detailedModels.length > 0 && (
        <section className="space-y-2">
          <p className="text-[#8b949e] uppercase tracking-wider font-semibold">
            Installed ({detailedModels.length})
          </p>
          <div className="space-y-1">
            {detailedModels.map(m => {
              const isActive = selectedModel === m.name;
              return (
                <div
                  key={m.name}
                  className={`flex items-center gap-2 px-2 py-2 rounded border transition-colors ${
                    isActive
                      ? 'bg-[#7c3aed]/15 border-[#7c3aed]/50'
                      : 'bg-[#161b22] border-[#30363d] hover:border-[#484f58]'
                  }`}
                >
                  <button
                    onClick={() => { setSelectedModel(m.name); toast(`Active: ${m.name}`, 'success'); }}
                    className="flex-1 flex items-center gap-2 min-w-0 text-left"
                  >
                    <span className={isActive ? 'text-[#7c3aed]' : 'text-[#484f58]'}>
                      {isActive ? '●' : '○'}
                    </span>
                    <span className={`font-mono truncate ${isActive ? 'text-[#d2a8ff]' : 'text-[#e6edf3]'}`}>
                      {m.name}
                    </span>
                    {isActive && <span className="text-[10px] text-[#7c3aed] flex-shrink-0">active</span>}
                  </button>
                  {m.size > 0 && (
                    <span className="text-[#8b949e] flex-shrink-0">{(m.size / 1e9).toFixed(1)} GB</span>
                  )}
                  <button
                    onClick={() => deleteModel(m.name)}
                    disabled={deleting === m.name}
                    title="Delete model"
                    className="text-[#8b949e] hover:text-[#f85149] flex-shrink-0 px-1 disabled:opacity-40 transition-colors"
                  >
                    {deleting === m.name ? '…' : '🗑'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* RAG status */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
        embedModelAvailable ? 'border-[#f0883e]/40 bg-[#1f120a]' : 'border-[#30363d] bg-[#161b22]'
      }`}>
        <span className="text-xl">{embedModelAvailable ? '🧠' : '⚪'}</span>
        <div className="flex-1 min-w-0">
          <p className={`font-medium ${embedModelAvailable ? 'text-[#f0883e]' : 'text-[#8b949e]'}`}>
            RAG: {embedModelAvailable ? 'Ready' : 'nomic-embed-text not installed'}
          </p>
        </div>
        <button
          onClick={checkModel}
          className="text-[#8b949e] hover:text-[#e6edf3] px-1.5 py-0.5 border border-[#30363d] rounded transition-colors"
        >
          Recheck
        </button>
      </div>

      {/* Recommended models */}
      <section className="space-y-2">
        <p className="text-[#8b949e] uppercase tracking-wider font-semibold">Recommended</p>
        <div className="space-y-2">
          {RECOMMENDED.map(m => {
            const installed = installedSet.has(m.id) ||
              [...installedSet].some(id => id.startsWith(m.id.split(':')[0]));
            return (
              <div
                key={m.id}
                className={`rounded-lg border p-2.5 ${installed ? 'border-[#3fb950]/30 bg-[#0d1f0d]' : 'border-[#30363d] bg-[#161b22]'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono font-medium text-[#e6edf3]">{m.id}</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: m.badgeColor + '22', color: m.badgeColor }}
                  >
                    {m.badge}
                  </span>
                  <span className="ml-auto text-[#8b949e] flex-shrink-0">{m.ram}</span>
                </div>
                <p className="text-[#8b949e] mb-2">{m.notes}</p>
                {installed ? (
                  <button
                    onClick={() => { setSelectedModel(m.id); toast(`Active: ${m.id}`, 'success'); }}
                    disabled={selectedModel === m.id}
                    className={`px-2 py-1 rounded border transition-colors ${
                      selectedModel === m.id
                        ? 'border-[#7c3aed]/50 text-[#7c3aed] bg-[#7c3aed]/10'
                        : 'border-[#30363d] text-[#8b949e] hover:border-[#7c3aed] hover:text-[#d2a8ff]'
                    }`}
                  >
                    {selectedModel === m.id ? '✓ Active' : 'Set Active'}
                  </button>
                ) : (
                  <button
                    onClick={() => pullModel(m.id)}
                    disabled={pulling || !ollamaOnline}
                    className="flex items-center gap-1.5 px-2 py-1 rounded border border-[#30363d]
                      text-[#8b949e] hover:border-[#7c3aed] hover:text-[#d2a8ff] disabled:opacity-40 transition-colors"
                  >
                    ⬇ Download
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Hardware guide */}
      <section className="space-y-2">
        <p className="text-[#8b949e] uppercase tracking-wider font-semibold">Hardware Guide</p>
        <div className="space-y-1">
          {HARDWARE.map(h => (
            <div key={h.ram} className="flex gap-3">
              <span className="text-[#e3b341] font-mono w-24 flex-shrink-0">{h.ram}</span>
              <span className="text-[#8b949e]">{h.tip}</span>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
