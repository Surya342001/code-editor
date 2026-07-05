// src/components/AI/AIPanel.jsx — Tabbed AI: Chat (RAG+Agent) | Git | Models
import { useState, useRef, useEffect, useCallback } from 'react';
import useEditorStore from '../../store/editorStore';
import useProjectIndex from '../../store/projectIndex';
import useRagStore from '../../store/ragStore';
import GitPanel from './GitPanel';
import ModelGuide from './ModelGuide';

const OLLAMA = 'http://localhost:11434';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseFileEdits(text) {
  const edits = [];
  const re = /FILE:\s*([^\n]+)\n```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null)
    edits.push({ filePath: m[1].trim(), content: m[2].replace(/\n$/, '') });
  return edits;
}

function isRunRequest(text) {
  return /\b(run|start|launch|execute)\b[\s\S]*\b(project|app|server|this)\b/i.test(text)
    || /^run this project$/i.test(text.trim());
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SearchResults({ results }) {
  const navigateTo = useEditorStore(s => s.navigateTo);
  if (!results || results.length === 0) return null;
  return (
    <div className="mt-2 border border-[#30363d] rounded-lg overflow-hidden bg-[#0d1117]">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-[#8b949e] border-b border-[#30363d]">
        Project matches
      </div>
      {results.slice(0, 5).map((r, i) => (
        <button
          key={`${r.path}:${r.line || 1}:${i}`}
          onClick={() => navigateTo(r.path, r.line || 1)}
          className="w-full text-left px-3 py-2 hover:bg-[#21262d] border-b border-[#21262d] last:border-b-0 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[#a78bfa] text-xs flex-shrink-0">
              {r.kind === 'symbol' ? 'ƒ' : 'file'}
            </span>
            <span className="text-xs text-[#e6edf3] truncate">{r.name || r.relativePath}</span>
            {r.line && (
              <span className="text-[10px] text-[#484f58] flex-shrink-0">L{r.line}</span>
            )}
          </div>
          <div className="text-[10px] text-[#8b949e] truncate mt-0.5">{r.relativePath}</div>
        </button>
      ))}
    </div>
  );
}

function EditActions({ edits }) {
  const { applyFileEdit, showInlineDiff, tabs } = useEditorStore();
  if (!edits || edits.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-2">
      {edits.map((edit, i) => {
        const openTab = tabs.find(
          t => t.path?.endsWith(edit.filePath) || t.path === edit.filePath
        );
        return (
          <button
            key={`${edit.filePath}:${i}`}
            onClick={() =>
              openTab
                ? showInlineDiff(openTab.content, edit.content, openTab.path, openTab.language)
                : applyFileEdit(edit.filePath, edit.content)
            }
            className="px-3 py-2 bg-[#238636] hover:bg-[#2ea043] text-white text-xs rounded-lg text-left transition-colors flex items-center gap-2"
          >
            <span>✏️</span>
            <span className="truncate">Apply → {edit.filePath}</span>
          </button>
        );
      })}
    </div>
  );
}

function ChatMessage({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[92%] rounded-xl px-3 py-2 text-sm break-words leading-relaxed
          ${isUser
            ? 'bg-[#7c3aed] text-white rounded-br-sm'
            : 'bg-[#21262d] text-[#e6edf3] rounded-bl-sm'}`}
      >
        {msg.role === 'assistant' && msg.loading ? (
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#8b949e] animate-bounce" />
            <span className="w-1.5 h-1.5 rounded-full bg-[#8b949e] animate-bounce [animation-delay:0.15s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-[#8b949e] animate-bounce [animation-delay:0.3s]" />
          </span>
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm">{msg.content}</pre>
        )}
        {!isUser && <SearchResults results={msg.searchResults} />}
        {!isUser && <EditActions edits={msg.fileEdits} />}
      </div>
    </div>
  );
}

function AgentStep({ step }) {
  const COLORS = {
    READ:  '#79c0ff',
    WRITE: '#3fb950',
    RUN:   '#e3b341',
    DONE:  '#a78bfa',
    ERROR: '#f85149',
  };
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 bg-[#161b22] border border-[#30363d] rounded-lg text-xs font-mono my-1">
      <span style={{ color: COLORS[step.type] || '#8b949e' }} className="flex-shrink-0 font-bold">
        [{step.type}]
      </span>
      <span className="text-[#8b949e] truncate">{step.detail}</span>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function AIPanel() {
  const {
    tabs, activeTabId,
    selectedModel, ollamaModels, ollamaOnline,
    setSelectedModel,
    showTerminal, toggleTerminal,
    terminalSender,
    detectAndRun,
    pendingAIQuery, pendingAITab,
    setAIQuery, clearAIQuery,
    toast,
    currentFolder,
  } = useEditorStore();

  const {
    semanticSearch,
    getSummary,
    getContextForQuery,
    getProjectTree,
  } = useProjectIndex();

  const {
    search:    ragSearch,
    getContext: ragGetContext,
    buildIndex: buildRagIndex,
    building:  ragBuilding,
    progress:  ragProgress,
    chunks,
    embedModelAvailable,
  } = useRagStore();

  const [tab,        setTab]        = useState('chat');
  const [messages,   setMessages]   = useState([]);
  const [input,      setInput]      = useState('');
  const [streaming,  setStreaming]   = useState(false);
  const [agentMode,  setAgentMode]  = useState(false);
  const [agentSteps, setAgentSteps] = useState([]);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const abortRef  = useRef(null);

  const activeTab = tabs.find(t => t.id === activeTabId);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, agentSteps]);

  // Handle pendingAIQuery from CodeEditor selection → AI panel
  useEffect(() => {
    if (!pendingAIQuery) return;
    if (pendingAIQuery === '\x00git-tab-switch') {
      setTab('git');
      clearAIQuery();
      return;
    }
    const q = pendingAIQuery;
    const t = pendingAITab || 'chat';
    clearAIQuery();
    setTab(t);
    if (t === 'chat') sendMessage(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAIQuery]);

  // ── State helpers ─────────────────────────────────────────────────────────

  const addMsg = (role, content, extra = {}) =>
    setMessages(prev => [...prev, { id: Date.now() + Math.random(), role, content, loading: false, ...extra }]);

  const updateLastAssistant = (content, extra = {}) =>
    setMessages(prev => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant') {
          next[i] = { ...next[i], content, loading: false, ...extra };
          break;
        }
      }
      return next;
    });

  // ── Context builder (RAG → keyword fallback) ──────────────────────────────

  const buildContext = useCallback(async (query) => {
    if (embedModelAvailable && chunks.length > 0) {
      try {
        const ctx = await ragGetContext(query, 5);
        if (ctx) return ctx;
      } catch { /* fall through */ }
    }
    try {
      return await getContextForQuery(query);
    } catch { return ''; }
  }, [embedModelAvailable, chunks, ragGetContext, getContextForQuery]);

  // ── Chat send ─────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text) => {
    const userText = (text || input).trim();
    if (!userText || streaming) return;
    setInput('');

    const searchResults = semanticSearch ? semanticSearch(userText, 4) : [];
    addMsg('user', userText, { searchResults });
    addMsg('assistant', '', { loading: true });
    setStreaming(true);

    if (isRunRequest(userText)) {
      detectAndRun();
      updateLastAssistant('Running project — check the terminal.', {});
      setStreaming(false);
      return;
    }

    try {
      const ragCtx  = await buildContext(userText);
      const summary = getSummary ? getSummary() : '';
      const tree    = getProjectTree ? getProjectTree() : '';

      const systemPrompt = [
        'You are an expert AI coding assistant embedded in a code editor.',
        'Be concise, direct, and technically precise.',
        summary ? `\nPROJECT:\n${summary}` : '',
        tree    ? `\nFILE TREE:\n${tree.slice(0, 1500)}` : '',
        ragCtx  ? `\nRELEVANT CODE:\n${ragCtx}` : '',
        activeTab
          ? `\nACTIVE FILE (${activeTab.name}):\n\`\`\`${activeTab.language || ''}\n${activeTab.content?.slice(0, 3000) || ''}\n\`\`\``
          : '',
        '',
        'For file edits use exactly:',
        'FILE: path/to/file.ext',
        '```lang',
        '// full file content here',
        '```',
      ].filter(Boolean).join('\n');

      const historyMsgs = messages
        .filter(m => !m.loading)
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));

      const res = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: (abortRef.current = new AbortController()).signal,
        body: JSON.stringify({
          model: selectedModel || 'codellama',
          stream: true,
          messages: [
            { role: 'system', content: systemPrompt },
            ...historyMsgs,
            { role: 'user', content: userText },
          ],
        }),
      });

      if (!res.ok) throw new Error(`Ollama ${res.status}`);

      let full = '';
      const reader = res.body.getReader();
      const dec    = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value).split('\n')) {
          if (!line.trim()) continue;
          try {
            const j = JSON.parse(line);
            if (j.message?.content) { full += j.message.content; updateLastAssistant(full); }
          } catch { /* partial JSON line */ }
        }
      }

      updateLastAssistant(full, { fileEdits: parseFileEdits(full) });
    } catch (err) {
      if (err.name !== 'AbortError')
        updateLastAssistant(`Error: ${err.message}`, {});
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, streaming, messages, selectedModel, activeTab, buildContext,
      semanticSearch, getSummary, getProjectTree, detectAndRun]);

  // ── Agentic send (Cline-style) ────────────────────────────────────────────

  const runAgent = useCallback(async (task) => {
    if (!task.trim() || streaming) return;
    setInput('');
    setAgentSteps([]);
    addMsg('user', `[Agent] ${task}`);
    addMsg('assistant', '', { loading: true });
    setStreaming(true);

    const addStep = (type, detail) =>
      setAgentSteps(prev => [...prev, { type, detail, id: Date.now() + Math.random() }]);

    try {
      const ragCtx  = await buildContext(task);
      const summary = getSummary?.() || '';
      const tree    = getProjectTree?.() || '';

      const AGENT_SYSTEM = [
        'You are an autonomous coding agent. Solve tasks step-by-step using tool calls.',
        'TOOLS (one per line, use exact format):',
        'READ: path/to/file',
        'WRITE: path/to/file',
        '(content on following lines until next tool or DONE)',
        'RUN: shell command',
        'DONE: brief summary',
        '',
        'Rules: READ before WRITE. Keep changes minimal. After RUN, describe what to check.',
        summary ? `\nProject: ${summary}` : '',
        ragCtx  ? `\nContext:\n${ragCtx}` : '',
        tree    ? `\nTree:\n${tree.slice(0, 1000)}` : '',
      ].filter(Boolean).join('\n');

      const agentMsgs = [
        { role: 'system', content: AGENT_SYSTEM },
        { role: 'user',   content: task },
      ];

      let fullLog = '';
      const MAX_TURNS = 8;

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const res = await fetch(`${OLLAMA}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: (abortRef.current = new AbortController()).signal,
          body: JSON.stringify({
            model: selectedModel || 'codellama',
            stream: false,
            messages: agentMsgs,
          }),
        });
        if (!res.ok) throw new Error(`Ollama ${res.status}`);

        const data  = await res.json();
        const reply = data.message?.content || '';
        agentMsgs.push({ role: 'assistant', content: reply });

        let toolResult = '';
        let done = false;
        const lines = reply.split('\n');

        for (let li = 0; li < lines.length; li++) {
          const line = lines[li].trim();

          if (line.startsWith('READ:')) {
            const fp = line.slice(5).trim();
            addStep('READ', fp);
            if (window.api) {
              const fullPath = fp.startsWith('/') ? fp : `${currentFolder}/${fp}`;
              const r = await window.api.readFile(fullPath);
              toolResult += `\nFILE ${fp}:\n${r.content || r.error || '(empty)'}\n`;
            }

          } else if (line.startsWith('WRITE:')) {
            const fp = line.slice(6).trim();
            addStep('WRITE', fp);
            // Collect content lines until next tool keyword or end
            const contentLines = [];
            li++;
            while (li < lines.length) {
              const next = lines[li].trim();
              if (next.startsWith('READ:') || next.startsWith('WRITE:') ||
                  next.startsWith('RUN:')  || next.startsWith('DONE:')) {
                li--;
                break;
              }
              contentLines.push(lines[li]);
              li++;
            }
            if (window.api) {
              const fullPath = fp.startsWith('/') ? fp : `${currentFolder}/${fp}`;
              await window.api.writeFile(fullPath, contentLines.join('\n'));
              toolResult += `\nWrote: ${fp}\n`;
            }

          } else if (line.startsWith('RUN:')) {
            const cmd = line.slice(4).trim();
            addStep('RUN', cmd);
            if (!showTerminal) toggleTerminal();
            setTimeout(() => {
              const sender = terminalSender || useEditorStore.getState().terminalSender;
              if (sender) sender(cmd + '\r');
            }, 500);
            toolResult += `\nRan: ${cmd} (check terminal)\n`;

          } else if (line.startsWith('DONE:')) {
            const summary = line.slice(5).trim();
            addStep('DONE', summary);
            fullLog += `\n✅ ${summary}`;
            done = true;
            break;
          }
        }

        fullLog += `\n${reply}`;
        updateLastAssistant(fullLog.trim());

        if (done) break;

        if (toolResult) {
          agentMsgs.push({ role: 'user', content: `Tool results:${toolResult}` });
        } else {
          break; // natural reply with no tools
        }
      }

      updateLastAssistant(fullLog.trim(), { fileEdits: parseFileEdits(fullLog) });
    } catch (err) {
      if (err.name !== 'AbortError')
        updateLastAssistant(`Agent error: ${err.message}`, {});
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, streaming, selectedModel, buildContext, getSummary, getProjectTree,
      currentFolder, showTerminal, toggleTerminal, terminalSender]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSend = () => agentMode ? runAgent(input) : sendMessage(input);
  const handleStop = () => abortRef.current?.abort();
  const handleKey  = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── Build RAG index ────────────────────────────────────────────────────────

  const buildRag = async () => {
    if (!currentFolder || !window.api) { toast('Open a folder first', 'warn'); return; }
    toast('Building RAG index…', 'info');
    const res = await window.api.readDirRecursive(currentFolder, { content: true });
    if (res.files) {
      await buildRagIndex(res.files, currentFolder);
      toast(`RAG ready — ${chunks.length} chunks`, 'success');
    }
  };

  // ── Quick actions ──────────────────────────────────────────────────────────

  const QUICK = [
    { label: '🔍 Analyze project',  text: 'Analyze this project: architecture, main files, entry points, key patterns.' },
    { label: '▶ Run project',       text: 'Run this project' },
    { label: '🐛 Find bugs',        text: 'Review the active file for bugs, security issues, and improvements.' },
    { label: '📝 Write tests',      text: 'Write unit tests for the active file.' },
    { label: '✨ Refactor',         text: 'Refactor the active file for clarity and best practices.' },
    { label: '📖 Explain code',     text: 'Explain what the active file does in plain English.' },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-[#30363d] bg-[#161b22] flex-shrink-0">
        {[
          { id: 'chat',   label: '🤖 Chat'   },
          { id: 'git',    label: '🌿 Git'    },
          { id: 'models', label: '📦 Models' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs font-medium transition-colors flex-1 border-b-2
              ${tab === t.id
                ? 'border-[#7c3aed] text-[#e6edf3]'
                : 'border-transparent text-[#8b949e] hover:text-[#e6edf3]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Git tab ───────────────────────────────────────────────────────── */}
      {tab === 'git' && (
        <div className="flex-1 overflow-y-auto">
          <GitPanel />
        </div>
      )}

      {/* ── Models tab ────────────────────────────────────────────────────── */}
      {tab === 'models' && (
        <div className="flex-1 overflow-y-auto">
          <ModelGuide />
        </div>
      )}

      {/* ── Chat tab ──────────────────────────────────────────────────────── */}
      {tab === 'chat' && (
        <>
          {/* Model selector + agent toggle */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[#30363d] flex-shrink-0 bg-[#0d1117]">
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className="flex-1 bg-[#21262d] border border-[#30363d] rounded px-2 py-1 text-xs text-[#e6edf3] focus:outline-none focus:border-[#7c3aed] min-w-0"
            >
              {ollamaModels.length > 0
                ? ollamaModels.map(m => <option key={m} value={m}>{m}</option>)
                : <option value={selectedModel}>{selectedModel}</option>}
            </select>

            <button
              onClick={() => setAgentMode(v => !v)}
              title={agentMode ? 'Switch to Chat mode' : 'Switch to Agent mode (reads/writes files)'}
              className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors flex-shrink-0
                ${agentMode
                  ? 'bg-[#f0883e] text-white'
                  : 'bg-[#21262d] text-[#8b949e] hover:text-[#e6edf3] border border-[#30363d]'}`}
            >
              {agentMode ? '🤖 Agent' : '💬 Chat'}
            </button>

            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${ollamaOnline ? 'bg-[#3fb950]' : 'bg-[#f85149]'}`}
              title={ollamaOnline ? 'Ollama online' : 'Ollama offline — run: ollama serve'}
            />
          </div>

          {/* Message list */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <div className="text-4xl mb-3">🤖</div>
                <p className="text-[#8b949e] text-sm mb-1">
                  {agentMode
                    ? 'Agent mode — I can read/write files and run commands'
                    : 'Ask anything about your code'}
                </p>
                <p className="text-[#484f58] text-xs">
                  {ollamaOnline
                    ? `${selectedModel} · ${embedModelAvailable ? `RAG ${chunks.length > 0 ? `(${chunks.length} chunks)` : '(not indexed)'}` : 'keyword search'}`
                    : 'Ollama offline — start with: ollama serve'}
                </p>
              </div>
            )}

            {messages.map(msg => <ChatMessage key={msg.id} msg={msg} />)}

            {agentSteps.length > 0 && (
              <div className="mt-2 space-y-1">
                {agentSteps.map(s => <AgentStep key={s.id} step={s} />)}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Quick actions (shown only when no messages) */}
          {messages.length === 0 && (
            <div className="px-2 pb-2 flex-shrink-0">
              <div className="grid grid-cols-2 gap-1">
                {QUICK.map(q => (
                  <button
                    key={q.label}
                    onClick={() => sendMessage(q.text)}
                    className="px-2 py-1.5 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded text-[10px] text-[#8b949e] hover:text-[#e6edf3] text-left transition-colors truncate"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* RAG status bar */}
          <div className="px-3 py-1.5 border-t border-[#30363d] bg-[#0d1117] flex items-center gap-2 text-[10px] flex-shrink-0">
            {embedModelAvailable ? (
              ragBuilding ? (
                <span className="text-[#e3b341] animate-pulse flex items-center gap-1">
                  <span>⚡ Building RAG…</span>
                  <span>{ragProgress}%</span>
                  <div className="flex-1 h-1 bg-[#21262d] rounded overflow-hidden ml-1">
                    <div className="h-full bg-[#e3b341] transition-all" style={{ width: `${ragProgress}%` }} />
                  </div>
                </span>
              ) : chunks.length > 0 ? (
                <span className="text-[#3fb950]">⚡ RAG: {chunks.length} chunks</span>
              ) : (
                <button
                  onClick={buildRag}
                  className="text-[#f0883e] hover:text-[#e3b341] transition-colors"
                >
                  ⚡ Build RAG index
                </button>
              )
            ) : (
              <span className="text-[#484f58]">
                RAG unavailable —{' '}
                <code className="bg-[#161b22] px-1 rounded">ollama pull nomic-embed-text</code>
              </span>
            )}
          </div>

          {/* Input */}
          <div className="px-2 pb-2 pt-1 flex-shrink-0 border-t border-[#30363d]">
            <div className="flex gap-1 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={
                  agentMode
                    ? 'Describe a task — agent reads/writes files autonomously…'
                    : 'Ask about your code… (Enter to send, Shift+Enter for newline)'
                }
                rows={2}
                className="flex-1 bg-[#21262d] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3] placeholder-[#484f58] resize-none focus:outline-none focus:border-[#7c3aed] leading-relaxed"
              />
              <button
                onClick={streaming ? handleStop : handleSend}
                disabled={!streaming && !input.trim()}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0 self-end
                  ${streaming
                    ? 'bg-[#f85149] hover:bg-[#da3633] text-white'
                    : input.trim()
                      ? 'bg-[#7c3aed] hover:bg-[#6d28d9] text-white'
                      : 'bg-[#21262d] text-[#484f58] cursor-not-allowed'}`}
              >
                {streaming ? '■' : '↑'}
              </button>
            </div>
            {agentMode && (
              <p className="text-[10px] text-[#484f58] mt-1 text-center">
                Agent can read / write files and run terminal commands autonomously
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
