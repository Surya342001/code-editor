// src/components/Editor/EditorTabs.jsx
import useEditorStore from '../../store/editorStore';

export default function EditorTabs() {
  const { tabs, activeTabId, setActiveTab, closeTab, saveTab } = useEditorStore();
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center overflow-x-auto bg-[#161b22] border-b border-[#30363d] flex-shrink-0 min-h-[36px]">
      {tabs.map(tab => (
        <div
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`group flex items-center gap-2 px-4 py-2 text-xs border-r border-[#30363d] cursor-pointer select-none flex-shrink-0 transition-colors
            ${activeTabId === tab.id
              ? 'bg-[#0d1117] text-[#e6edf3] border-t-2 border-t-[#7c3aed]'
              : 'bg-[#161b22] text-[#8b949e] hover:bg-[#1c2128] hover:text-[#e6edf3]'}`}
        >
          <span className="truncate max-w-[120px]">{tab.name}</span>
          {tab.isDirty && <span className="text-[#a78bfa] font-bold">●</span>}
          <button
            onClick={e => { e.stopPropagation(); tab.isDirty ? saveTab(tab.id) : closeTab(tab.id); }}
            className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all ml-1 text-xs leading-none"
            title={tab.isDirty ? 'Save and close' : 'Close'}
          >
            {tab.isDirty ? '💾' : '×'}
          </button>
          <button
            onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
            className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all text-xs leading-none"
            title="Close without saving"
            style={{ display: tab.isDirty ? 'inline' : 'none' }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
