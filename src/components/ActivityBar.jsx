// src/components/ActivityBar.jsx
import useEditorStore from '../store/editorStore';

const icons = [
  { id: 'explorer', icon: '📁', tip: 'Explorer' },
  { id: 'search',   icon: '🔍', tip: 'Semantic Search' },
];

export default function ActivityBar() {
  const { activePanel, setActivePanel, toggleTerminal, toggleAIPanel, showAIPanel } = useEditorStore();

  return (
    <div className="no-drag flex flex-col items-center w-12 bg-[#161b22] border-r border-[#30363d] py-2 gap-1 flex-shrink-0">
      {/* Top icons */}
      {icons.map(({ id, icon, tip }) => (
        <button
          key={id}
          title={tip}
          onClick={() => setActivePanel(id)}
          className={`w-9 h-9 flex items-center justify-center rounded-md text-lg transition-colors
            ${activePanel === id
              ? 'bg-[#7c3aed] text-white'
              : 'text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]'}`}
        >
          {icon}
        </button>
      ))}

      {/* Spacer */}
      <div className="flex-1" />

      {/* AI panel toggle */}
      <button
        title="Toggle AI Panel"
        onClick={toggleAIPanel}
        className={`w-9 h-9 flex items-center justify-center rounded-md text-lg transition-colors
          ${showAIPanel
            ? 'bg-[#7c3aed] text-white'
            : 'text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]'}`}
      >
        🤖
      </button>

      {/* Terminal toggle */}
      <button
        title="Toggle Terminal (Ctrl+`)"
        onClick={toggleTerminal}
        className="w-9 h-9 flex items-center justify-center rounded-md text-lg text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3] transition-colors"
      >
        ⌨
      </button>
    </div>
  );
}
