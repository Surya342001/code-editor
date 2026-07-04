// src/components/Editor/CodeEditor.jsx
// Monaco Editor with Ollama AI inline completions (ghost text)
import { useRef, useEffect, useCallback } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import useEditorStore from '../../store/editorStore';
import useProjectIndex from '../../store/projectIndex';

const OLLAMA = 'http://localhost:11434';

// ─── Custom theme ──────────────────────────────────────────────────────────
const THEME = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '',           foreground: 'e6edf3', background: '0d1117' },
    { token: 'comment',    foreground: '8b949e', fontStyle: 'italic'  },
    { token: 'keyword',    foreground: 'ff7b72', fontStyle: 'bold'    },
    { token: 'string',     foreground: 'a5d6ff' },
    { token: 'number',     foreground: '79c0ff' },
    { token: 'regexp',     foreground: '79c0ff' },
    { token: 'type',       foreground: 'ffa657' },
    { token: 'class',      foreground: 'ffa657', fontStyle: 'bold' },
    { token: 'function',   foreground: 'd2a8ff' },
    { token: 'variable',   foreground: 'e6edf3' },
    { token: 'parameter',  foreground: 'ffa657' },
    { token: 'operator',   foreground: 'ff7b72' },
    { token: 'delimiter',  foreground: 'e6edf3' },
    { token: 'tag',        foreground: '7ee787' },
    { token: 'attribute',  foreground: '79c0ff' },
    { token: 'namespace',  foreground: 'ffa657' },
  ],
  colors: {
    'editor.background':              '#0d1117',
    'editor.foreground':              '#e6edf3',
    'editor.lineHighlightBackground': '#161b2260',
    'editor.selectionBackground':     '#264f78aa',
    'editor.inactiveSelectionBackground': '#264f7840',
    'editorLineNumber.foreground':    '#484f58',
    'editorLineNumber.activeForeground': '#e6edf3',
    'editorCursor.foreground':        '#a78bfa',
    'editorCursor.background':        '#0d1117',
    'editorIndentGuide.background1':  '#21262d',
    'editorIndentGuide.activeBackground1': '#484f58',
    'editorSuggestWidget.background': '#161b22',
    'editorSuggestWidget.border':     '#30363d',
    'editorSuggestWidget.selectedBackground': '#21262d',
    'editorHoverWidget.background':   '#161b22',
    'editorHoverWidget.border':       '#30363d',
    'editor.findMatchBackground':     '#9e6a0388',
    'editor.findMatchHighlightBackground': '#9e6a0344',
    'scrollbarSlider.background':     '#30363d55',
    'scrollbarSlider.hoverBackground': '#484f58',
    'scrollbarSlider.activeBackground': '#6e7681',
    'minimap.background':             '#0d1117',
    'editorGutter.background':        '#0d1117',
    'editorBracketMatch.background':  '#17e5e620',
    'editorBracketMatch.border':      '#17e5e6',
    'tab.activeBackground':           '#0d1117',
    'tab.inactiveBackground':         '#161b22',
    'titleBar.activeBackground':      '#0d1117',
  },
};

export default function CodeEditor() {
  const monaco     = useMonaco();
  const editorRef  = useRef(null);
  const { tabs, activeTabId, updateContent, saveTab, pendingNavigation, clearNavigation } = useEditorStore();
  const activeTab  = tabs.find(t => t.id === activeTabId);

  useEffect(() => {
    if (!pendingNavigation || !editorRef.current || !activeTab) return;
    if (pendingNavigation.filePath !== activeTab.path) return;
    const lineNumber = Math.max(1, pendingNavigation.lineNumber || 1);
    editorRef.current.revealLineInCenter(lineNumber);
    editorRef.current.setPosition({ lineNumber, column: 1 });
    editorRef.current.focus();
    clearNavigation();
  }, [pendingNavigation, activeTab, clearNavigation]);

  // ── Define theme + register AI completions ─────────────────────────────
  useEffect(() => {
    if (!monaco) return;

    monaco.editor.defineTheme('lt-dark', THEME);
    monaco.editor.setTheme('lt-dark');

    // Inline ghost-text completions powered by Ollama
    const disp = monaco.languages.registerInlineCompletionsProvider({ pattern: '**' }, {
      provideInlineCompletions: async (model, position, _ctx, token) => {
        const lineContent = model.getLineContent(position.lineNumber);
        if (lineContent.trimStart().length < 2) return { items: [] };

        const prefix = model.getValueInRange({
          startLineNumber: Math.max(1, position.lineNumber - 30),
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });

        const suffix = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: Math.min(model.getLineCount(), position.lineNumber + 20),
          endColumn: 200,
        });

        const ctrl = new AbortController();
        token.onCancellationRequested(() => ctrl.abort());

        try {
          const editorState = useEditorStore.getState();
          const projectState = useProjectIndex.getState();
          const active = editorState.tabs.find(tab => tab.id === editorState.activeTabId);
          const model_ = editorState.selectedModel || 'llama3';
          const projectSummary = projectState.getSummary().slice(0, 1800);
          const queryContext = (await projectState.getContextForQuery(prefix.split('\n').slice(-8).join('\n'))).slice(0, 2200);

          const res = await fetch(`${OLLAMA}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: model_,
              prompt: `You are an inline coding assistant like GitHub Copilot. Complete code at the cursor.

Rules:
- Output only the exact code to insert at the cursor.
- No markdown fences, no explanations, no repeated existing code.
- Keep the style consistent with the active file.
- Prefer using existing project functions/imports when visible in context.

Active file: ${active?.path || 'unknown'}
Language: ${active?.language || model.getLanguageId()}

Project summary:
${projectSummary || 'No project index available.'}

Relevant project context:
${queryContext || 'No related context.'}

Code before cursor:
${prefix}

Code after cursor:
${suffix}

Insert at cursor:`,
              stream: false,
              options: { num_predict: 120, temperature: 0.05, top_p: 0.8, stop: ['```', '<|end|>'] },
            }),
            signal: ctrl.signal,
          });
          if (!res.ok) return { items: [] };
          const data = await res.json();
          const text = (data.response || '')
            .replace(/^```[a-zA-Z0-9_-]*\n?/, '')
            .replace(/```[\s\S]*$/, '')
            .trimEnd();
          if (!text) return { items: [] };
          return {
            items: [{
              insertText: text,
              range: {
                startLineNumber: position.lineNumber, startColumn: position.column,
                endLineNumber:   position.lineNumber, endColumn:   position.column,
              },
            }],
          };
        } catch { return { items: [] }; }
      },
      freeInlineCompletions: () => {},
    });

    return () => disp.dispose();
  }, [monaco]);

  // ── Editor mount ───────────────────────────────────────────────────────
  // onMount receives (editor, monacoInstance) per @monaco-editor/react API
  const onMount = useCallback((editor, monacoInstance) => {
    editorRef.current = editor;

    const { KeyMod, KeyCode } = monacoInstance;

    // Ctrl/Cmd+S → save
    editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyS, () => {
      const { activeTabId } = useEditorStore.getState();
      if (activeTabId) saveTab(activeTabId);
    });

    // Ctrl+` → toggle terminal
    editor.addCommand(KeyMod.WinCtrl | KeyCode.Backquote, () => {
      useEditorStore.getState().toggleTerminal();
    });

    editor.focus();
  }, [saveTab]);

  const onChange = useCallback((val) => {
    if (activeTabId) updateContent(activeTabId, val ?? '');
  }, [activeTabId]);

  if (!activeTab) return null;

  return (
    <Editor
      key={activeTab.id}
      height="100%"
      language={activeTab.language}
      value={activeTab.content}
      theme="lt-dark"
      onChange={onChange}
      onMount={onMount}
      options={{
        fontSize: 14,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
        fontLigatures: true,
        lineHeight: 22,
        letterSpacing: 0.3,
        minimap:        { enabled: true, scale: 1, renderCharacters: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        insertSpaces: true,
        wordWrap: 'on',
        smoothScrolling: true,
        cursorSmoothCaretAnimation: 'on',
        cursorBlinking: 'smooth',
        renderLineHighlight: 'line',
        padding: { top: 12, bottom: 40 },
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true },
        inlineSuggest: { enabled: true, showToolbar: 'onHover' },
        quickSuggestions: { other: true, comments: false, strings: false },
        suggest: { preview: true, previewMode: 'prefix' },
        formatOnPaste: true,
        formatOnType: false,
        multiCursorModifier: 'alt',
        renderWhitespace: 'selection',
        stickyScroll: { enabled: true },
        folding: true,
        foldingHighlight: true,
        showFoldingControls: 'mouseover',
        matchBrackets: 'always',
        occurrencesHighlight: 'singleFile',
        selectionHighlight: true,
        codeLens: true,
        lightbulb: { enabled: 'on' },
        accessibilitySupport: 'off',
      }}
    />
  );
}
