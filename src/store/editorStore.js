// src/store/editorStore.js — Zustand global state
import { create } from 'zustand';

// ─── Language detector ────────────────────────────────────────────────────
const EXT_MAP = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', kt: 'kotlin',
  java: 'java', cs: 'csharp', cpp: 'cpp', cc: 'cpp', c: 'c', h: 'c',
  html: 'html', css: 'css', scss: 'scss', less: 'less',
  json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  md: 'markdown', mdx: 'markdown',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  php: 'php', swift: 'swift', dart: 'dart', lua: 'lua', r: 'r',
  xml: 'xml', svg: 'xml', dockerfile: 'dockerfile',
  env: 'plaintext', txt: 'plaintext',
};

export function detectLanguage(name = '') {
  const parts = name.toLowerCase().split('.');
  const ext = parts[parts.length - 1];
  if (name.toLowerCase() === 'dockerfile') return 'dockerfile';
  return EXT_MAP[ext] || 'plaintext';
}

// ─── Store ────────────────────────────────────────────────────────────────
const useEditorStore = create((set, get) => ({
  // ── Workspace ──────────────────────────────────────────────────────────
  currentFolder: null,
  setCurrentFolder: (folder) => set({ currentFolder: folder }),

  // ── Tabs ───────────────────────────────────────────────────────────────
  tabs: [],
  activeTabId: null,

  openFile: async (file) => {
    const { tabs } = get();
    const existing = tabs.find(t => t.path === file.path);
    if (existing) { set({ activeTabId: existing.id }); return; }

    let content = '';
    if (window.api) {
      const res = await window.api.readFile(file.path);
      if (res.content != null) content = res.content;
    }

    const tab = {
      id: `tab-${Date.now()}`,
      name: file.name,
      path: file.path,
      content,
      originalContent: content,
      isDirty: false,
      language: detectLanguage(file.name),
    };
    set(s => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex(t => t.id === tabId);
    const next = tabs.filter(t => t.id !== tabId);
    let newActive = activeTabId;
    if (activeTabId === tabId)
      newActive = next.length ? next[Math.max(0, idx - 1)].id : null;
    set({ tabs: next, activeTabId: newActive });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateContent: (tabId, content) => set(s => ({
    tabs: s.tabs.map(t =>
      t.id === tabId ? { ...t, content, isDirty: content !== t.originalContent } : t
    ),
  })),

  saveTab: async (tabId) => {
    const tab = get().tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (window.api) await window.api.writeFile(tab.path, tab.content);
    set(s => ({
      tabs: s.tabs.map(t =>
        t.id === tabId ? { ...t, isDirty: false, originalContent: t.content } : t
      ),
    }));
  },

  saveActive: () => {
    const { activeTabId, saveTab } = get();
    if (activeTabId) saveTab(activeTabId);
  },

  resolvePath: (filePath) => {
    const { currentFolder } = get();
    if (!filePath) return null;
    if (filePath.startsWith('/')) return filePath;
    if (!currentFolder) return filePath;
    return `${currentFolder.replace(/\/$/, '')}/${filePath.replace(/^\.\//, '')}`;
  },

  applyFileEdit: async (filePath, content) => {
    const { resolvePath, tabs, openFile, toast } = get();
    const fullPath = resolvePath(filePath);
    if (!fullPath || !window.api) { toast('Cannot apply edit without file access', 'error'); return false; }
    const result = await window.api.writeFile(fullPath, content);
    if (result?.error) { toast(result.error, 'error'); return false; }

    const existing = tabs.find(tab => tab.path === fullPath);
    if (existing) {
      set(state => ({
        tabs: state.tabs.map(tab => tab.path === fullPath
          ? { ...tab, content, originalContent: content, isDirty: false }
          : tab
        ),
        activeTabId: existing.id,
      }));
    } else {
      await openFile({ path: fullPath, name: fullPath.split('/').pop() });
    }
    toast(`Applied edit to ${fullPath.split('/').pop()}`, 'success');
    return true;
  },

  replaceActiveSelection: (replacement) => {
    const { activeTabId, tabs, updateContent } = get();
    const tab = tabs.find(item => item.id === activeTabId);
    if (!tab) return false;
    updateContent(tab.id, replacement);
    return true;
  },

  // ── Layout ─────────────────────────────────────────────────────────────
  showSidebar:   true,
  showTerminal:  false,
  showAIPanel:   true,
  sidebarWidth:  256,
  terminalHeight: 240,
  aiPanelWidth:  340,
  activePanel:   'explorer', // 'explorer' | 'search' | null

  toggleSidebar:  () => set(s => ({ showSidebar: !s.showSidebar })),
  toggleTerminal: () => set(s => ({ showTerminal: !s.showTerminal })),
  toggleAIPanel:  () => set(s => ({ showAIPanel: !s.showAIPanel })),
  setShowAIPanel: (v) => set({ showAIPanel: v }),
  setActivePanel: (p) => set(s => ({
    activePanel: s.activePanel === p ? null : p,
    showSidebar: s.activePanel === p ? false : true,
  })),

  // ── Navigate to file + line ────────────────────────────────────────────
  pendingNavigation: null,   // { filePath, lineNumber }
  navigateTo: async (filePath, lineNumber = 1) => {
    const { tabs, openFile } = get();
    const fileName = filePath.split('/').pop();
    const existing = tabs.find(t => t.path === filePath);
    if (existing) {
      set({ activeTabId: existing.id, pendingNavigation: { filePath, lineNumber } });
    } else {
      await openFile({ path: filePath, name: fileName });
      set({ pendingNavigation: { filePath, lineNumber } });
    }
  },
  clearNavigation: () => set({ pendingNavigation: null }),

  // ── Run project ────────────────────────────────────────────────────────
  runInfo:    null,   // { cmd, type, icon, desc }
  terminalSender: null,   // fn registered by TerminalPanel
  setTerminalSender: (fn) => set({ terminalSender: fn }),
  setRunInfo: (info) => set({ runInfo: info }),

  detectAndRun: async () => {
    const { currentFolder, showTerminal, toggleTerminal, terminalSender, toast } = get();
    if (!currentFolder || !window.api) { toast('No folder open', 'warn'); return; }
    const info = await window.api.runDetect(currentFolder);
    if (!info) { toast('Could not detect how to run this project', 'warn'); return; }
    set({ runInfo: info });
    if (!showTerminal) toggleTerminal();
    // Give terminal time to mount, then send command
    const send = () => {
      const sender = get().terminalSender;
      if (sender) { sender(info.cmd + '\r'); toast(`Running: ${info.cmd}`, 'success'); }
      else setTimeout(send, 300);
    };
    setTimeout(send, 400);
  },

  // ── Command palette ────────────────────────────────────────────────────
  showPalette: false,
  togglePalette: () => set(s => ({ showPalette: !s.showPalette })),

  // ── Notifications ─────────────────────────────────────────────────────
  toasts: [],
  toast: (msg, type = 'info') => {
    const n = { id: Date.now(), msg, type };
    set(s => ({ toasts: [...s.toasts, n] }));
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(x => x.id !== n.id) })), 3500);
  },

  // ── Ollama ────────────────────────────────────────────────────────────
  ollamaModels: [],
  selectedModel: 'llama3',
  ollamaOnline: false,
  setOllamaModels: (models) => set({ ollamaModels: models }),
  setSelectedModel: (m) => set({ selectedModel: m }),
  setOllamaOnline: (v) => set({ ollamaOnline: v }),

  // ── Inline AI query (from editor selection → AI Panel) ────────────────
  pendingAIQuery: null,    // { text, context } sent from CodeEditor to AIPanel
  pendingAITab: 'chat',    // which AI tab to auto-switch to
  setAIQuery: (text, tab = 'chat') => set({ pendingAIQuery: text, pendingAITab: tab, showAIPanel: true }),
  clearAIQuery: () => set({ pendingAIQuery: null }),

  // ── Inline Diff (accept/reject AI edits with diff preview) ────────────
  inlineDiff: null,   // { original, proposed, filePath, language }
  showInlineDiff: (original, proposed, filePath, language) =>
    set({ inlineDiff: { original, proposed, filePath, language } }),
  acceptInlineDiff: async () => {
    const { inlineDiff, applyFileEdit, toast } = get();
    if (!inlineDiff) return;
    await applyFileEdit(inlineDiff.filePath, inlineDiff.proposed);
    set({ inlineDiff: null });
  },
  rejectInlineDiff: () => set({ inlineDiff: null }),
}));

export default useEditorStore;
