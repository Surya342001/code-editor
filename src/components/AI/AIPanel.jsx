// src/components/AI/AIPanel.jsx
// Ollama assistant with project analysis, semantic search, run-project, and applyable edits.
import { useState, useRef, useEffect, useCallback } from 'react';
import useEditorStore from '../../store/editorStore';
import useProjectIndex from '../../store/projectIndex';

const OLLAMA = 'http://localhost:11434';

function parseFileEdits(text) {
  const edits = [];
  const pattern = /FILE:\s*([^\n]+)\n```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    edits.push({ filePath: match[1].trim(), content: match[2].replace(/\n$/, '') });
  }
  return edits;
}

function isRunRequest(text) {
  return /\b(run|start|launch|execute)\b[\s\S]*\b(project|app|server|this)\b/i.test(text)
    || /^run this project$/i.test(text.trim());
}

function SearchResults({ results = [] }) {
  const navigateTo = useEditorStore(s => s.navigateTo);
  if (!results.length) return null;

  return (
    <div className="mt-3 border border-[#30363d] rounded-lg overflow-hidden bg-[#0d1117]">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-[#8b949e] border-b border-[#30363d]">
        Project matches
      </div>
      {results.slice(0, 5).map((result, index) => (
        <button
          key={`${result.path}:${result.line || 1}:${result.name || index}`}
          onClick={() => navigateTo(result.path, result.line || 1)}
          className="w-full text-left px-3 py-2 hover:bg-[#21262d] border-b border-[#21262d] last:border-b-0 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[#a78bfa] text-xs flex-shrink-0">{result.kind === 'symbol' ? 'ƒ' : 'file'}</span>
            <span className="text-xs text-[#e6edf3] truncate">{result.name || result.relativePath}</span>
            {result.line && <span className="text-[10px] text-[#484f58] flex-shrink-0">L{result.line}</span>}
          </div>
          <div className="text-[10px] text-[#8b949e] truncate mt-0.5">{result.relativePath}</div>
        </button>
      ))}
    </div>
  );
}

function EditActions({ edits = [] }) {
  const applyFileEdit = useEditorStore(s => s.applyFileEdit);
  if (!edits.length) return null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      {edits.map((edit, index) => (
        <button
          key={`${edit.filePath}:${index}`}
          onClick={() => applyFileEdit(edit.filePath, edit.content)}
          className="px-3 py-2 bg-[#238636] hover:bg-[#2ea043] text-white text-xs rounded-lg text-left transition-colors"
        >
          Apply edit to {edit.filePath}
        </button>
      ))}
    </div>
  );
}

function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[92%] rounded-xl px-3 py-2 text-sm break-words leading-relaxed
          ${isUser
            ? 'bg-[#7c3aed] text-white rounded-br-sm'
            : 'bg-[#21262d] text-[#e6edf3] rounded-bl-sm border border-[#30363d]'}`}
      >
        {msg.role === 'assistant' && msg.loading ? (
          <span className="flex items-center gap-2 text-[#8b949e]">
            <span className="animate-bounce">●</span>
            <span className="animate-bounce delay-75">●</span>
            <span className="animate-bounce delay-150">●</span>
          </span>
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm">{msg.content}</pre>
        )}
        {!isUser && <SearchResults results={msg.searchResults} />}
        {!isUser && <EditActions edits={msg.edits} />}
      </div>
    </div>
  );
}

export default function AIPanel() {
  const {
    ollamaOnline, ollamaModels, selectedModel, setSelectedModel,
    tabs, activeTabId, currentFolder, detectAndRun,
  } = useEditorStore();

  const {
    files, indexing, indexedFolder, buildIndex, semanticSearch,
    getContextForQuery, getSummary, getProjectTree,
  } = useProjectIndex();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const abortRef  = useRef(null);

  const activeTab = tabs.find(t => t.id === activeTabId);
  const hasCurrentIndex = currentFolder && indexedFolder === currentFolder;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const ensureIndexed = useCallback(async () => {
    if (currentFolder && (files.length === 0 || indexedFolder !== currentFolder) && !indexing) {
      await buildIndex(currentFolder);
    }
  }, [currentFolder, files.length, indexedFolder, indexing, buildIndex]);

  const explainProject = useCallback(async () => {
    await ensureIndexed();
    const summary = getSummary() || 'No project index available yet.';
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `Project analysis:\n\n${summary}`,
      searchResults: semanticSearch('main entry api components routes services state', 6),
    }]);
  }, [ensureIndexed, getSummary, semanticSearch]);

  const runProject = useCallback(async () => {
    setMessages(prev => [...prev, { role: 'assistant', content: 'Starting the project in the integrated terminal...', loading: false }]);
    await detectAndRun();
  }, [detectAndRun]);

  const send = useCallback(async (userText) => {
    const trimmed = userText.trim();
    if (!trimmed || sending) return;

    const userMsg = { role: 'user', content: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setInput('');

    if (isRunRequest(trimmed)) {
      await runProject();
      return;
    }

    await ensureIndexed();
    const searchResults = semanticSearch(trimmed, 8);
    const asstMsg = { role: 'assistant', content: '', loading: true, id: Date.now(), searchResults };
    setMessages(prev => [...prev, asstMsg]);
    setSending(true);

    const projectSummary = getSummary();
    const projectTree = getProjectTree();
    const queryContext = await getContextForQuery(trimmed);
    const activeContext = activeTab
      ? `Active file: ${activeTab.path}\nLanguage: ${activeTab.language}\n\n${activeTab.content.slice(0, 7000)}`
      : 'No active file.';

    const systemPrompt = `You are Local Terminal's built-in coding agent. You are inside the user's desktop code editor.

Capabilities you must use in your answer:
- Analyze the entire indexed project from the provided summary/tree/context.
- When asked to show how a function works, identify the best matching file/function, explain it, and cite path + line numbers.
- When asked to edit code, return full-file replacements only for files you can see. Use this exact format for each edited file:
FILE: relative/path/to/file.ext
\`\`\`language
<complete new file content>
\`\`\`
- Do not invent files or APIs that are not in context. If context is insufficient, say what to open or index.
- Be direct and practical. Prefer code-level answers over generic instructions.

Project summary:
${projectSummary || 'No indexed files yet.'}

Project tree and symbols:
${projectTree || 'No project tree available.'}

Relevant semantic search snippets:
${queryContext || 'No relevant snippets found.'}

${activeContext}`;

    const history = messages.slice(-8).map(message => ({ role: message.role, content: message.content }));
    history.push({ role: 'user', content: trimmed });

    try {
      abortRef.current = new AbortController();
      const res = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: 'system', content: systemPrompt }, ...history],
          stream: true,
          options: { temperature: 0.15, num_ctx: 8192 },
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`Ollama error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.content) {
              fullText += parsed.message.content;
              setMessages(prev => prev.map(message =>
                message.id === asstMsg.id
                  ? { ...message, content: fullText, loading: false, edits: parseFileEdits(fullText) }
                  : message
              ));
            }
          } catch {
            // Ollama streams newline-delimited JSON; ignore partial JSON fragments.
          }
        }
      }

      setMessages(prev => prev.map(message =>
        message.id === asstMsg.id
          ? { ...message, content: fullText || 'No response returned.', loading: false, edits: parseFileEdits(fullText) }
          : message
      ));
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => prev.map(message =>
          message.id === asstMsg.id
            ? { ...message, content: `Error: ${err.message}. Make sure Ollama is running with: ollama serve`, loading: false }
            : message
        ));
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, [activeTab, ensureIndexed, getContextForQuery, getProjectTree, getSummary, messages, runProject, selectedModel, semanticSearch, sending]);

  const stop = () => { abortRef.current?.abort(); setSending(false); };

  const quickActions = [
    { label: 'Analyze project', run: explainProject, disabled: !currentFolder },
    { label: 'Run project', run: runProject, disabled: !currentFolder },
    { label: 'Explain file', run: () => send(`Explain this file and the important functions: ${activeTab?.path || ''}`), disabled: !activeTab || !ollamaOnline },
    { label: 'Find bugs', run: () => send('Analyze the current file and project context for likely bugs. Show exact files and fixes.'), disabled: !activeTab || !ollamaOnline },
    { label: 'Edit with AI', run: () => send('Improve the active file. Return an applyable full-file edit using the FILE: format.'), disabled: !activeTab || !ollamaOnline },
    { label: 'Write tests', run: () => send('Find the best place for tests for the active code and write applyable test code.'), disabled: !ollamaOnline },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#30363d] flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#e6edf3]">🤖 AI Assistant</span>
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ollamaOnline ? 'bg-green-400' : 'bg-red-400'}`} />
        </div>
        {ollamaModels.length > 0 && (
          <select
            value={selectedModel}
            onChange={event => setSelectedModel(event.target.value)}
            className="text-xs bg-[#21262d] text-[#e6edf3] border border-[#30363d] rounded px-2 py-0.5 outline-none max-w-[150px]"
          >
            {ollamaModels.map(model => <option key={model} value={model}>{model}</option>)}
          </select>
        )}
      </div>

      {!ollamaOnline && (
        <div className="mx-3 mt-3 p-3 bg-[#3a1a1a] border border-red-900 rounded-lg text-xs text-red-300">
          <p className="font-semibold mb-1">Ollama is offline</p>
          <p>Run: <code className="bg-black/30 px-1 rounded">ollama serve</code></p>
          <p className="mt-1">Install a model: <code className="bg-black/30 px-1 rounded">ollama pull codellama</code></p>
        </div>
      )}

      <div className="p-3 border-b border-[#30363d] flex-shrink-0">
        <div className="grid grid-cols-2 gap-1.5">
          {quickActions.map(action => (
            <button
              key={action.label}
              onClick={action.run}
              disabled={action.disabled || sending}
              className="text-xs px-2 py-1.5 bg-[#21262d] text-[#e6edf3] rounded-lg hover:bg-[#30363d] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {action.label}
            </button>
          ))}
        </div>
        <div className="mt-2 text-[10px] text-[#484f58]">
          {indexing ? 'Indexing project...' : hasCurrentIndex ? `${files.length} files indexed for project search` : 'Open a folder for project-wide analysis'}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-[#484f58] text-sm text-center px-4">
            <span className="text-3xl mb-2">💬</span>
            <p>Ask about any function, file, bug, or change.</p>
            <p className="text-xs mt-1">Examples: “show sendChat”, “edit booking flow”, “run this project”.</p>
          </div>
        )}
        {messages.map((message, index) => <Message key={message.id || index} msg={message} />)}
        <div ref={bottomRef} />
      </div>

      <div className="flex-shrink-0 border-t border-[#30363d] p-3">
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="text-xs text-[#484f58] hover:text-[#8b949e] mb-2 transition-colors"
          >
            Clear chat
          </button>
        )}
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(input); }
            }}
            placeholder="Ask about your whole project..."
            rows={2}
            className="flex-1 bg-[#0d1117] text-[#e6edf3] placeholder-[#484f58] border border-[#30363d] rounded-lg px-3 py-2 text-sm resize-none outline-none focus:border-[#7c3aed] transition-colors disabled:opacity-50"
          />
          <div className="flex flex-col gap-1">
            {sending ? (
              <button
                onClick={stop}
                className="px-3 py-2 bg-red-600 text-white rounded-lg text-xs hover:bg-red-700 transition-colors"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={() => send(input)}
                disabled={!input.trim() || (!ollamaOnline && !isRunRequest(input))}
                className="px-3 py-2 bg-[#7c3aed] text-white rounded-lg text-xs hover:bg-[#6d28d9] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
