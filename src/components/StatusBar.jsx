// src/components/StatusBar.jsx
import useEditorStore from '../store/editorStore';

export default function StatusBar() {
  const { tabs, activeTabId, ollamaOnline, selectedModel, currentFolder, toggleTerminal } = useEditorStore();
  const tab = tabs.find(t => t.id === activeTabId);

  return (
    <div className="flex items-center justify-between h-6 bg-[#7c3aed] text-white text-xs px-3 flex-shrink-0 select-none">
      <div className="flex items-center gap-3">
        <span className="font-semibold tracking-wide">Local Terminal</span>
        {currentFolder && (
          <span className="opacity-70 truncate max-w-[200px]">
            {currentFolder.split('/').pop()}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {tab && (
          <>
            <span className="uppercase opacity-80">{tab.language}</span>
            {tab.isDirty && <span className="opacity-70">● unsaved</span>}
          </>
        )}

        <button
          onClick={toggleTerminal}
          className="opacity-80 hover:opacity-100 transition-opacity"
          title="Toggle Terminal"
        >
          ⌨ terminal
        </button>

        <span
          className={`flex items-center gap-1 ${ollamaOnline ? 'text-green-300' : 'text-red-300'}`}
          title={ollamaOnline ? `Ollama: ${selectedModel}` : 'Ollama offline — install & run ollama serve'}
        >
          <span className={`w-2 h-2 rounded-full ${ollamaOnline ? 'bg-green-400' : 'bg-red-400'}`} />
          {ollamaOnline ? selectedModel || 'AI ready' : 'AI offline'}
        </span>
      </div>
    </div>
  );
}
