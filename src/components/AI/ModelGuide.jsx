// src/components/AI/ModelGuide.jsx — Model recommendations + install helper
import { useState } from 'react';
import useEditorStore from '../../store/editorStore';
import useRagStore from '../../store/ragStore';

const MODELS = [
  {
    id: 'qwen2.5-coder:14b',
    label: 'qwen2.5-coder:14b',
    badge: '⭐ Best',
    badgeColor: '#3fb950',
    ram: '~10 GB VRAM',
    task: 'Code generation, refactoring, review',
    notes: 'Best open coding model currently. Needs 16GB+ unified memory (M1 Pro / M2+).',
  },
  {
    id: 'qwen2.5-coder:7b',
    label: 'qwen2.5-coder:7b',
    badge: 'Fast',
    badgeColor: '#79c0ff',
    ram: '~5 GB VRAM',
    task: 'Quick completions, short tasks',
    notes: 'Good on 16GB RAM, CPU-only works. Great for inline completions.',
  },
  {
    id: 'deepseek-coder-v2:16b',
    label: 'deepseek-coder-v2:16b',
    badge: 'Alt',
    badgeColor: '#e3b341',
    ram: '~12 GB VRAM',
    task: 'Code + reasoning, debugging',
    notes: 'Strong reasoning about code. Good alternative if Qwen is slow.',
  },
  {
    id: 'codellama:13b',
    label: 'codellama:13b',
    badge: 'Fallback',
    badgeColor: '#8b949e',
    ram: '~9 GB VRAM',
    task: 'Code generation',
    notes: 'Reliable fallback. Works on 16GB RAM. Less capable than Qwen.',
  },
  {
    id: 'llama3.1:8b',
    label: 'llama3.1:8b',
    badge: 'Chat',
    badgeColor: '#d2a8ff',
    ram: '~5 GB VRAM',
    task: 'General Q&A, explaining concepts',
    notes: 'Great for asking questions, understanding docs. Not code-specialized.',
  },
  {
    id: 'nomic-embed-text',
    label: 'nomic-embed-text',
    badge: 'RAG',
    badgeColor: '#f0883e',
    ram: '<1 GB',
    task: 'Embeddings for semantic search',
    notes: 'Required for the RAG codebase search. Tiny model, install this first.',
  },
];

const HARDWARE_TIPS = [
  { ram: '8 GB', tip: 'Use 7B models only. Avoid 13B+ unless heavily quantized.' },
  { ram: '16 GB', tip: 'Run 7–13B models well CPU-only. For GPU: 7B at full speed.' },
  { ram: '32 GB / M2 Pro+', tip: '14–16B models run great. Unified memory = no VRAM limit.' },
  { ram: '64 GB / M2 Max+', tip: 'Run 32B+ models. qwen2.5-coder:32b is state-of-the-art.' },
];

export default function ModelGuide() {
  const { ollamaModels, selectedModel, setSelectedModel, ollamaOnline, toast } = useEditorStore();
  const { embedModelAvailable, building, progress, checkModel } = useRagStore();
  const [copied, setCopied] = useState(null);

  const installedIds = new Set(ollamaModels.map(m => m.name));

  const copyCmd = (cmd) => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(cmd);
      toast(`Copied: ${cmd}`, 'success');
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto p-3 space-y-4 text-sm">
      {/* Ollama status */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
        ollamaOnline ? 'border-[#3fb950]/40 bg-[#1a2d1a]' : 'border-[#f85149]/40 bg-[#2d1a1a]'
      }`}>
        <span className={`text-base ${ollamaOnline ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
          {ollamaOnline ? '●' : '○'}
        </span>
        <div>
          <p className={`text-xs font-medium ${ollamaOnline ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
            Ollama {ollamaOnline ? 'running' : 'offline'}
          </p>
          {!ollamaOnline && (
            <p className="text-[#8b949e] text-xs">Start with: <code className="text-[#e3b341]">ollama serve</code></p>
          )}
        </div>
      </div>

      {/* RAG status */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
        embedModelAvailable ? 'border-[#f0883e]/40 bg-[#2d1e0a]' : 'border-[#30363d] bg-[#161b22]'
      }`}>
        <span className="text-lg">{embedModelAvailable ? '🧠' : '⚪'}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-medium ${embedModelAvailable ? 'text-[#f0883e]' : 'text-[#8b949e]'}`}>
            RAG / Semantic search: {embedModelAvailable ? 'Ready' : 'Not available'}
          </p>
          {!embedModelAvailable && (
            <p className="text-[#8b949e] text-xs">Install nomic-embed-text to enable</p>
          )}
          {building && (
            <div className="mt-1">
              <div className="h-1 bg-[#21262d] rounded-full overflow-hidden">
                <div className="h-full bg-[#f0883e] transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-[#8b949e] text-xs mt-0.5">Building index… {progress}%</p>
            </div>
          )}
        </div>
        <button
          onClick={checkModel}
          className="text-xs text-[#8b949e] hover:text-[#e6edf3] px-1.5 py-0.5 border border-[#30363d] rounded"
        >
          recheck
        </button>
      </div>

      {/* Installed models */}
      {ollamaModels.length > 0 && (
        <div>
          <p className="text-[#8b949e] text-xs font-medium mb-2 uppercase tracking-wider">Installed Models</p>
          <div className="space-y-1">
            {ollamaModels.map(m => (
              <button
                key={m.name}
                onClick={() => { setSelectedModel(m.name); toast(`Model: ${m.name}`, 'success'); }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                  selectedModel === m.name
                    ? 'bg-[#7c3aed]/20 border border-[#7c3aed]/50 text-[#d2a8ff]'
                    : 'bg-[#161b22] border border-[#30363d] text-[#e6edf3] hover:bg-[#21262d]'
                }`}
              >
                {selectedModel === m.name && <span className="text-[#7c3aed] text-xs">✓</span>}
                <span className="text-xs font-mono flex-1">{m.name}</span>
                {m.size && <span className="text-[#8b949e] text-xs">{(m.size / 1e9).toFixed(1)}G</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recommended models */}
      <div>
        <p className="text-[#8b949e] text-xs font-medium mb-2 uppercase tracking-wider">Recommended Models</p>
        <div className="space-y-2">
          {MODELS.map(m => {
            const installed = installedIds.has(m.id) || [...installedIds].some(id => id.startsWith(m.id.split(':')[0]));
            return (
              <div key={m.id} className={`border rounded-md p-3 ${installed ? 'border-[#3fb950]/30 bg-[#161b22]' : 'border-[#30363d] bg-[#0d1117]'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono font-medium text-[#e6edf3]">{m.label}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: m.badgeColor + '22', color: m.badgeColor }}>
                    {m.badge}
                  </span>
                  {installed && <span className="text-xs text-[#3fb950]">✓ installed</span>}
                  <div className="flex-1" />
                  <span className="text-xs text-[#8b949e]">{m.ram}</span>
                </div>
                <p className="text-xs text-[#79c0ff] mb-1">{m.task}</p>
                <p className="text-xs text-[#8b949e] mb-2">{m.notes}</p>
                {!installed && (
                  <button
                    onClick={() => copyCmd(`ollama pull ${m.id}`)}
                    className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors ${
                      copied === `ollama pull ${m.id}`
                        ? 'border-[#3fb950] text-[#3fb950] bg-[#1a2d1a]'
                        : 'border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#e6edf3]'
                    }`}
                  >
                    <span>{copied === `ollama pull ${m.id}` ? '✓ Copied!' : '📋 ollama pull ' + m.id}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Hardware tips */}
      <div>
        <p className="text-[#8b949e] text-xs font-medium mb-2 uppercase tracking-wider">Hardware Guide</p>
        <div className="space-y-1">
          {HARDWARE_TIPS.map(h => (
            <div key={h.ram} className="flex gap-2 text-xs">
              <span className="text-[#e3b341] font-mono w-20 flex-shrink-0">{h.ram}</span>
              <span className="text-[#8b949e]">{h.tip}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
