// src/components/Editor/RunBar.jsx — top bar: project name, run button, file actions
import { useEffect, useState } from 'react';
import useEditorStore  from '../../store/editorStore';
import useProjectIndex from '../../store/projectIndex';

export default function RunBar() {
  const { currentFolder, runInfo, detectAndRun, tabs, activeTabId, saveTab, setActivePanel } = useEditorStore();
  const { files, indexing, indexedAt, indexedFolder } = useProjectIndex();
  const [detecting, setDetecting] = useState(false);

  const activeTab = tabs.find(t => t.id === activeTabId);

  const handleRun = async () => {
    setDetecting(true);
    await detectAndRun();
    setDetecting(false);
  };

  if (!currentFolder && tabs.length === 0) return null;

  const folderName = currentFolder?.split('/').pop() || '';
  const hasCurrentIndex = currentFolder && indexedFolder === currentFolder;

  return (
    <div className="flex items-center h-9 bg-[#161b22] border-b border-[#30363d] px-3 gap-3 flex-shrink-0 select-none">
      {/* Project name */}
      {currentFolder && (
        <span className="text-xs text-[#8b949e] font-medium truncate max-w-[120px]">
          {folderName}
        </span>
      )}

      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={detecting || !currentFolder}
        title={runInfo ? `Run: ${runInfo.desc}` : 'Run project'}
        className="flex items-center gap-1.5 px-3 py-1 bg-[#238636] hover:bg-[#2ea043] text-white text-xs rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
      >
        {detecting ? (
          <><span className="animate-spin">⟳</span> Detecting…</>
        ) : (
          <><span>▶</span> {runInfo ? runInfo.desc : 'Run'}</>
        )}
      </button>

      {/* Save button */}
      {activeTab?.isDirty && (
        <button
          onClick={() => saveTab(activeTab.id)}
          className="flex items-center gap-1 px-2 py-1 bg-[#7c3aed] text-white text-xs rounded-md hover:bg-[#6d28d9] transition-colors"
          title="Save (Ctrl+S)"
        >
          💾 Save
        </button>
      )}

      <div className="flex-1" />

      {/* Index status */}
      <span className="text-[10px] text-[#484f58]" title={hasCurrentIndex && indexedAt ? `Indexed ${files.length} files` : 'Not indexed'}>
        {indexing
          ? '⏳ indexing…'
          : hasCurrentIndex && indexedAt
          ? `📊 ${files.length} files`
          : ''}
      </span>

      <button
        onClick={() => setActivePanel('search')}
        className="text-[10px] text-[#484f58] hover:text-[#8b949e] transition-colors px-1"
        title="Semantic Search"
      >
        Search
      </button>

      {/* Command palette hint */}
      <button
        onClick={useEditorStore.getState().togglePalette}
        className="text-[10px] text-[#484f58] hover:text-[#8b949e] transition-colors px-1"
        title="Command Palette (Ctrl+Shift+P)"
      >
        ⌘⇧P
      </button>
    </div>
  );
}
