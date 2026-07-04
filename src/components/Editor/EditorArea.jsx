// src/components/Editor/EditorArea.jsx
import useEditorStore from '../../store/editorStore';
import RunBar       from './RunBar';
import EditorTabs   from './EditorTabs';
import CodeEditor   from './CodeEditor';
import TerminalPanel from '../Terminal/TerminalPanel';

export default function EditorArea() {
  const { tabs, showTerminal, terminalHeight } = useEditorStore();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Run / project toolbar */}
      <RunBar />

      {/* Editor pane */}
      <div
        className="flex flex-col flex-1 overflow-hidden"
        style={{ height: showTerminal ? `calc(100% - ${terminalHeight}px)` : '100%' }}
      >
        <EditorTabs />
        <div className="flex-1 overflow-hidden">
          {tabs.length > 0 ? <CodeEditor /> : <WelcomeScreen />}
        </div>
      </div>

      {/* Terminal pane */}
      {showTerminal && (
        <div
          style={{ height: terminalHeight }}
          className="flex-shrink-0 border-t border-[#30363d]"
        >
          <TerminalPanel />
        </div>
      )}
    </div>
  );
}

function WelcomeScreen() {
  const { setCurrentFolder, setActivePanel, togglePalette, toast } = useEditorStore();

  const openFolder = async () => {
    const r = await window.api?.openFolder();
    if (!r?.canceled && r?.filePaths?.[0]) {
      setCurrentFolder(r.filePaths[0]);
      setActivePanel('explorer');
    } else if (!window.api) {
      toast('Running in browser mode — file access unavailable', 'warn');
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center bg-[#0d1117] text-[#8b949e] select-none">
      <div className="mb-6">
        <div className="text-7xl text-center mb-2">⌨️</div>
        <h1 className="text-2xl font-bold text-[#e6edf3] text-center">Local Terminal</h1>
        <p className="text-sm text-center mt-1">AI-first code editor · Ollama powered</p>
      </div>

      <div className="flex flex-col gap-2 w-52 text-sm">
        <button
          onClick={openFolder}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#7c3aed] text-white rounded-lg hover:bg-[#6d28d9] transition-colors font-medium"
        >
          <span>📂</span> Open Folder
        </button>
        <button
          onClick={togglePalette}
          className="flex items-center justify-between px-4 py-2.5 bg-[#21262d] text-[#e6edf3] rounded-lg hover:bg-[#30363d] transition-colors"
        >
          <span>🎯 Command Palette</span>
          <span className="text-[#a78bfa] text-xs">⌘⇧P</span>
        </button>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 text-xs text-[#8b949e]">
        {[
          ['Ctrl+S', 'Save file'],
          ['Ctrl+`', 'Terminal'],
          ['Tab', 'Accept AI completion'],
          ['Ctrl+Shift+P', 'Command palette'],
        ].map(([key, desc]) => (
          <div key={key} className="flex gap-2">
            <kbd className="px-1.5 py-0.5 bg-[#21262d] rounded text-[#a78bfa]">{key}</kbd>
            <span>{desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
