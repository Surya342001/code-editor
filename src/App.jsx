import { useEffect } from 'react';
import ActivityBar    from './components/ActivityBar';
import FileExplorer   from './components/Sidebar/FileExplorer';
import SearchPanel    from './components/Sidebar/SearchPanel';
import EditorArea     from './components/Editor/EditorArea';
import AIPanel        from './components/AI/AIPanel';
import InlineDiff     from './components/AI/InlineDiff';
import StatusBar      from './components/StatusBar';
import CommandPalette from './components/CommandPalette';
import Toasts         from './components/Toasts';
import useEditorStore from './store/editorStore';
import useProjectIndex from './store/projectIndex';
import useRagStore    from './store/ragStore';

const OLLAMA = 'http://localhost:11434';

export default function App() {
  const {
    showSidebar, showAIPanel, activePanel,
    sidebarWidth, aiPanelWidth,
    showPalette, togglePalette,
    setOllamaModels, setOllamaOnline, setSelectedModel,
    currentFolder, setRunInfo,
  } = useEditorStore();

  const buildIndex = useProjectIndex(s => s.buildIndex);
  const checkRagModel = useRagStore(s => s.checkModel);

  // Re-index when folder changes
  useEffect(() => {
    if (currentFolder) buildIndex(currentFolder);
  }, [currentFolder, buildIndex]);

  // Check whether nomic-embed-text is available at startup
  useEffect(() => { checkRagModel(); }, []);

  // Detect how the project should run as soon as a folder opens.
  useEffect(() => {
    if (!currentFolder || !window.api) return;
    let cancelled = false;
    window.api.runDetect(currentFolder).then(info => {
      if (!cancelled) setRunInfo(info);
    });
    return () => { cancelled = true; };
  }, [currentFolder, setRunInfo]);

  // Poll Ollama status on startup
  useEffect(() => {
    async function probe() {
      try {
        const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2000) });
        if (!r.ok) { setOllamaOnline(false); return; }
        const data = await r.json();
        const models = (data.models || []).map(m => m.name);
        setOllamaModels(models);
        setOllamaOnline(true);
        // Pick a code-friendly default
        const pref = ['codellama', 'llama3', 'llama2', 'mistral', 'phi3'];
        const match = pref.find(p => models.some(m => m.startsWith(p)));
        if (match) setSelectedModel(models.find(m => m.startsWith(match)));
      } catch { setOllamaOnline(false); }
    }
    probe();
    const id = setInterval(probe, 15000);
    return () => clearInterval(id);
  }, []);

  // Global shortcuts
  useEffect(() => {
    const handler = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key === 'P') { e.preventDefault(); togglePalette(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-[#0d1117] text-[#e6edf3] overflow-hidden">
      {/* macOS traffic-light drag region */}
      <div className="drag-region absolute top-0 left-0 right-0 h-8 pointer-events-none z-50" />

      <div className="flex flex-1 overflow-hidden">
        {/* Activity Bar */}
        <ActivityBar />

        {/* Sidebar */}
        {showSidebar && activePanel && (
          <aside
            style={{ width: sidebarWidth }}
            className="flex-shrink-0 bg-[#161b22] border-r border-[#30363d] overflow-hidden flex flex-col"
          >
            {activePanel === 'explorer' && <FileExplorer />}
            {activePanel === 'search'   && <SearchPanel />}
          </aside>
        )}

        {/* Editor */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          <EditorArea />
        </main>

        {/* AI Panel */}
        {showAIPanel && (
          <aside
            style={{ width: aiPanelWidth }}
            className="flex-shrink-0 bg-[#161b22] border-l border-[#30363d] overflow-hidden flex flex-col"
          >
            <AIPanel />
          </aside>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar />

      {/* Command Palette */}
      {showPalette && <CommandPalette />}

      {/* Toast notifications */}
      <Toasts />

      {/* Inline diff overlay */}
      <InlineDiff />
    </div>
  );
}
