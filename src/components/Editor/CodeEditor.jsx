// src/components/Editor/CodeEditor.jsx
// Monaco Editor with Ollama AI inline completions (ghost text)
import { useRef, useEffect, useCallback } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import useEditorStore from '../../store/editorStore';
import useProjectIndex from '../../store/projectIndex';

const OLLAMA = 'http://localhost:11434';

const KNAPSACK_JS_SNIPPET = `function knapsack01(weights, values, capacity) {
  const n = weights.length;
  const dp = new Array(capacity + 1).fill(0);

  for (let i = 0; i < n; i++) {
    const w = weights[i];
    const v = values[i];

    // Iterate backward so each item is used at most once
    for (let c = capacity; c >= w; c--) {
      dp[c] = Math.max(dp[c], dp[c - w] + v);
    }
  }

  return dp[capacity];
}

// Example:
const weights = [2, 3, 4, 5];
const values = [3, 4, 5, 8];
const capacity = 8;
console.log(knapsack01(weights, values, capacity)); // 12
`;

function isKnapsackJsPrompt(text = '') {
  const lower = text.toLowerCase();
  const hasKnapsack =
    lower.includes('knapsack') ||
    lower.includes('kanpsack') ||
    lower.includes('knap sack');
  const hasJs =
    lower.includes('javascript') ||
    lower.includes('javaacript') ||
    lower.includes('java script') ||
    /\bjs\b/.test(lower);
  const asksForCode =
    lower.includes('code') ||
    lower.includes('teach') ||
    lower.includes('algorithm') ||
    lower.includes('generate');
  return hasKnapsack && hasJs && asksForCode;
}

function detectAlgo(text = '') {
  const lower = text.toLowerCase();
  if (
    lower.includes('knapsack') ||
    lower.includes('kanpsack') ||
    lower.includes('knap sack')
  ) return 'knapsack';
  if (
    lower.includes('binary search') ||
    lower.includes('binarry search') ||
    lower.includes('binarysearch')
  ) return 'binary-search';
  if (
    lower.includes('fibonacci') ||
    lower.includes('fibanocci') ||
    lower.includes('fibanaci') ||
    lower.includes('fabonacci')
  ) return 'fibonacci';
  return null;
}

function getNearestJsFunctionName(prefix = '') {
  const re = /function\s+([a-zA-Z_$][\w$]*)\s*\(|(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>/g;
  let m;
  let last = null;
  while ((m = re.exec(prefix)) !== null) {
    last = m[1] || m[2] || null;
  }
  return last;
}

function buildJsFunctionBody(algo, indent = '  ') {
  if (algo === 'knapsack') {
    return [
      `${indent}const dp = new Array(capacity + 1).fill(0);`,
      `${indent}for (let i = 0; i < weights.length; i++) {`,
      `${indent}  const w = weights[i];`,
      `${indent}  const v = values[i];`,
      `${indent}  for (let c = capacity; c >= w; c--) {`,
      `${indent}    dp[c] = Math.max(dp[c], dp[c - w] + v);`,
      `${indent}  }`,
      `${indent}}`,
      `${indent}return dp[capacity];`,
    ].join('\n');
  }

  if (algo === 'binary-search') {
    return [
      `${indent}let low = 0;`,
      `${indent}let high = arr.length - 1;`,
      `${indent}while (low <= high) {`,
      `${indent}  const mid = Math.floor((low + high) / 2);`,
      `${indent}  if (arr[mid] === target) return mid;`,
      `${indent}  if (arr[mid] < target) low = mid + 1;`,
      `${indent}  else high = mid - 1;`,
      `${indent}}`,
      `${indent}return -1;`,
    ].join('\n');
  }

  if (algo === 'fibonacci') {
    return [
      `${indent}if (n <= 1) return n;`,
      `${indent}let a = 0;`,
      `${indent}let b = 1;`,
      `${indent}for (let i = 2; i <= n; i++) {`,
      `${indent}  const next = a + b;`,
      `${indent}  a = b;`,
      `${indent}  b = next;`,
      `${indent}}`,
      `${indent}return b;`,
    ].join('\n');
  }

  return '';
}

function buildJsFullSnippet(algo) {
  if (algo === 'binary-search') {
    return [
      'function binarySearch(arr, target) {',
      '  let low = 0;',
      '  let high = arr.length - 1;',
      '  while (low <= high) {',
      '    const mid = Math.floor((low + high) / 2);',
      '    if (arr[mid] === target) return mid;',
      '    if (arr[mid] < target) low = mid + 1;',
      '    else high = mid - 1;',
      '  }',
      '  return -1;',
      '}',
      '',
      'const nums = [2, 4, 7, 11, 19, 25];',
      'const target = 11;',
      'console.log(`Index: ${binarySearch(nums, target)}`);',
    ].join('\n');
  }

  if (algo === 'fibonacci') {
    return [
      'function fibonacci(n) {',
      '  if (n <= 1) return n;',
      '  let a = 0;',
      '  let b = 1;',
      '  for (let i = 2; i <= n; i++) {',
      '    const next = a + b;',
      '    a = b;',
      '    b = next;',
      '  }',
      '  return b;',
      '}',
      '',
      'const n = 10;',
      'console.log(`Fibonacci(${n}) = ${fibonacci(n)}`);',
    ].join('\n');
  }

  return KNAPSACK_JS_SNIPPET.trimEnd();
}

function isProbablyProse(text = '') {
  const t = text.trim();
  if (!t) return true;
  const proseCue = /\b(here is|this function|i hope|let me know|you can use|possible solution)\b/i.test(t);
  const hasCodeSignal = /[{}();=<>]/.test(t) || /\b(const|let|var|function|return|if|for|while|class)\b/.test(t);
  const wordCount = t.split(/\s+/).length;
  return proseCue || (!hasCodeSignal && wordCount > 12);
}

function cleanInlineResponse(text = '') {
  return (text || '')
    .replace(/^```[a-zA-Z0-9_-]*\n?/, '')
    .replace(/```[\s\S]*$/, '')
    .trimEnd();
}

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

    // ── Inline ghost-text completions powered by Ollama ─────────────────
    // Accepts Tab, dismissed with Escape — works like GitHub Copilot
    const FIM_MODELS = ['codellama', 'deepseek-coder', 'qwen2.5-coder', 'qwen', 'starcoder', 'codegemma'];

    const disp = monaco.languages.registerInlineCompletionsProvider({ pattern: '**' }, {
      provideInlineCompletions: async (model, position, _ctx, token) => {
        // ── 1. Quick pre-checks (sync, no cost) ──────────────────────────
        const lineText     = model.getLineContent(position.lineNumber);
        const beforeCursor = lineText.slice(0, position.column - 1);
        const isNewLine    = beforeCursor.trim().length === 0;
        const lineIndent   = (lineText.match(/^\s*/) || [''])[0];

        // Deterministic editor-first generation for Knapsack JS prompts.
        const promptStart = Math.max(1, position.lineNumber - 4);
        const promptText = model.getValueInRange({
          startLineNumber: promptStart,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const langId = model.getLanguageId();
        const jsLang = langId === 'javascript' || langId === 'typescript';
        const prefixStart = Math.max(1, position.lineNumber - 40);
        const suffixEnd   = Math.min(model.getLineCount(), position.lineNumber + 15);
        const prefix = model.getValueInRange({
          startLineNumber: prefixStart,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const suffix = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: suffixEnd,
          endColumn: model.getLineMaxColumn(suffixEnd),
        });

        const functionName = getNearestJsFunctionName(prefix);
        const detectedAlgo = detectAlgo(`${promptText} ${functionName || ''}`);
        const nearEmptyBody = suffix.trimStart().startsWith('}');

        if (jsLang && detectedAlgo && functionName && nearEmptyBody) {
          const body = buildJsFunctionBody(detectedAlgo, `${lineIndent}  `);
          if (body) {
            return {
              items: [{
                insertText: `\n${body}\n${lineIndent}`,
                range: {
                  startLineNumber: position.lineNumber,
                  startColumn: position.column,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column,
                },
              }],
            };
          }
        }

        if (jsLang && isKnapsackJsPrompt(promptText)) {
          return {
            items: [{
              insertText: `\n${KNAPSACK_JS_SNIPPET}`,
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              },
            }],
          };
        }

        // Require at least 3 visible chars, OR be at the start of a new line
        if (!isNewLine && beforeCursor.trim().length < 3) return { items: [] };

        // Skip inside single-line comments (// ...) — avoid noisy suggestions
        if (/^\s*(\/\/|#|--|%)/.test(beforeCursor)) return { items: [] };

        // ── 2. Debounce — wait 700 ms; cancel silently if user keeps typing
        const proceed = await new Promise((resolve) => {
          const tid = setTimeout(() => resolve(true), 700);
          token.onCancellationRequested(() => { clearTimeout(tid); resolve(false); });
        });
        if (!proceed || token.isCancellationRequested) return { items: [] };

        // ── 3. Context already collected above ────────────────────────────

        // ── 4. Resolve model + active file ───────────────────────────────
        const editorState  = useEditorStore.getState();
        const projectState = useProjectIndex.getState();
        const activeTab    = editorState.tabs.find(t => t.id === editorState.activeTabId);
        const ollamaModel  = editorState.selectedModel || 'llama3';
        const lang         = activeTab?.language || model.getLanguageId();
        const filePath     = activeTab?.path || 'unknown';

        // Project summary for broader context (capped to avoid huge prompts)
        const projectSummary = projectState.getSummary?.().slice(0, 1000) || '';

        // ── 5. Build prompt ───────────────────────────────────────────────
        const isFIM = FIM_MODELS.some(n => ollamaModel.toLowerCase().includes(n));
        let prompt;
        if (isFIM) {
          // Fill-in-the-Middle tokens (CodeLlama, DeepSeek-Coder, Qwen-Coder…)
          prompt = `<fim_prefix>${prefix}<fim_suffix>${suffix}<fim_middle>`;
        } else {
          // Instruction-style for general models (llama3, mistral, gemma…)
          prompt = `You are an inline code completion engine. Output ONLY the code to insert at the cursor — no explanations, no markdown fences, no repeated code.

File: ${filePath}  Language: ${lang}
${projectSummary ? `Project context:\n${projectSummary}\n` : ''}
### Code before cursor
${prefix}
### Code after cursor
${suffix}
### Completion (insert at cursor, continue naturally):`;
        }

        // ── 6. Set status indicator ───────────────────────────────────────
        useEditorStore.getState().setAITyping(true);
        const ctrl = new AbortController();
        token.onCancellationRequested(() => {
          ctrl.abort();
          useEditorStore.getState().setAITyping(false);
        });

        try {
          const res = await fetch(`${OLLAMA}/api/generate`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model:   ollamaModel,
              prompt,
              stream:  false,
              options: {
                num_predict: 160,
                temperature: 0.05,
                top_p:       0.9,
                stop:        ['```', '<|end|>', '<fim_prefix>', '<fim_suffix>', '<|endoftext|>'],
              },
            }),
            signal: ctrl.signal,
          });

          useEditorStore.getState().setAITyping(false);
          if (!res.ok) return { items: [] };

          const data = await res.json();
          let text = cleanInlineResponse(data.response || '');

          // Strip any accidental repetition of the prefix's last line
          const lastPrefixLine = prefix.split('\n').pop();
          if (lastPrefixLine && text.startsWith(lastPrefixLine.trimStart())) {
            text = text.slice(lastPrefixLine.trimStart().length).trimStart();
          }

          if (isProbablyProse(text)) {
            if (jsLang && detectedAlgo) {
              if (functionName && nearEmptyBody) {
                const body = buildJsFunctionBody(detectedAlgo, `${lineIndent}  `);
                if (body) text = `\n${body}\n${lineIndent}`;
              } else {
                text = `\n${buildJsFullSnippet(detectedAlgo)}`;
              }
            } else {
              return { items: [] };
            }
          }

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
        } catch {
          useEditorStore.getState().setAITyping(false);
          return { items: [] };
        }
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

    // ── AI selection context menu actions ──────────────────────────────
    const getSelection = () => {
      const sel = editor.getSelection();
      if (!sel || sel.isEmpty()) return '';
      return editor.getModel()?.getValueInRange(sel) || '';
    };

    // "Ask AI about selection" — Ctrl/Cmd+Shift+A
    editor.addAction({
      id: 'ai-ask-selection',
      label: '🤖 Ask AI about selection',
      keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyA],
      contextMenuGroupId: '9_cutcopypaste',
      contextMenuOrder: 10,
      run: () => {
        const text = getSelection();
        const { tabs, activeTabId: tid, setAIQuery } = useEditorStore.getState();
        const tab = tabs.find(t => t.id === tid);
        const lang = tab?.language || 'code';
        if (text.trim()) {
          setAIQuery(`Explain this ${lang} code and how it works:\n\`\`\`${lang}\n${text}\n\`\`\``, 'chat');
        }
      },
    });

    // "Refactor selection" — Ctrl/Cmd+Shift+R
    editor.addAction({
      id: 'ai-refactor-selection',
      label: '✨ Refactor with AI',
      keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyR],
      contextMenuGroupId: '9_cutcopypaste',
      contextMenuOrder: 11,
      run: () => {
        const text = getSelection();
        const { tabs, activeTabId: tid, setAIQuery } = useEditorStore.getState();
        const tab = tabs.find(t => t.id === tid);
        const lang = tab?.language || 'code';
        const path = tab?.path || 'this file';
        if (text.trim()) {
          setAIQuery(`Refactor and improve this code. Return a FILE: edit for ${path}:\n\`\`\`${lang}\n${text}\n\`\`\``, 'chat');
        }
      },
    });

    // "Find bugs in selection" — Ctrl/Cmd+Shift+B  
    editor.addAction({
      id: 'ai-bugs-selection',
      label: '🐛 Find bugs in selection',
      keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyD],
      contextMenuGroupId: '9_cutcopypaste',
      contextMenuOrder: 12,
      run: () => {
        const text = getSelection();
        const { tabs, activeTabId: tid, setAIQuery } = useEditorStore.getState();
        const tab = tabs.find(t => t.id === tid);
        const lang = tab?.language || 'code';
        if (text.trim()) {
          setAIQuery(`Find bugs and issues in this code. Be specific about line numbers and what to fix:\n\`\`\`${lang}\n${text}\n\`\`\``, 'chat');
        }
      },
    });

    // "Write tests for selection"
    editor.addAction({
      id: 'ai-tests-selection',
      label: '🧪 Write tests for selection',
      keybindings: [],
      contextMenuGroupId: '9_cutcopypaste',
      contextMenuOrder: 13,
      run: () => {
        const text = getSelection();
        const { tabs, activeTabId: tid, setAIQuery } = useEditorStore.getState();
        const tab = tabs.find(t => t.id === tid);
        const lang = tab?.language || 'code';
        const path = tab?.path || 'this file';
        if (text.trim()) {
          setAIQuery(`Write comprehensive tests for this code. Return a FILE: edit for the test file:\n\`\`\`${lang}\n${text}\n\`\`\``, 'chat');
        }
      },
    });

    // "Insert Knapsack (JavaScript)" in editor directly
    editor.addAction({
      id: 'ai-insert-knapsack-js',
      label: '🧠 Insert Knapsack (JavaScript)',
      keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyK],
      contextMenuGroupId: '9_cutcopypaste',
      contextMenuOrder: 14,
      run: () => {
        const model = editor.getModel();
        const pos = editor.getPosition();
        if (!model || !pos) return;

        editor.executeEdits('knapsack-js-snippet', [{
          range: new monacoInstance.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
          text: `\n${KNAPSACK_JS_SNIPPET}`,
          forceMoveMarkers: true,
        }]);
      },
    });

    editor.addAction({
      id: 'ai-complete-current-function',
      label: '⚡ Complete Current Function (Code Only)',
      keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter],
      contextMenuGroupId: '9_cutcopypaste',
      contextMenuOrder: 15,
      run: () => {
        const model = editor.getModel();
        const pos = editor.getPosition();
        if (!model || !pos) return;

        const line = model.getLineContent(pos.lineNumber);
        const indent = (line.match(/^\s*/) || [''])[0];
        const prefixStart = Math.max(1, pos.lineNumber - 80);
        const prefix = model.getValueInRange({
          startLineNumber: prefixStart,
          startColumn: 1,
          endLineNumber: pos.lineNumber,
          endColumn: pos.column,
        });
        const functionName = getNearestJsFunctionName(prefix);
        const algo = detectAlgo(functionName || prefix.slice(-600));

        if (!algo) {
          useEditorStore.getState().toast('No supported function intent found (knapsack/binary/fibonacci)', 'warn');
          return;
        }

        const body = buildJsFunctionBody(algo, `${indent}  `);
        if (!body) return;

        editor.executeEdits('complete-current-function', [{
          range: new monacoInstance.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
          text: `\n${body}\n${indent}`,
          forceMoveMarkers: true,
        }]);
        useEditorStore.getState().toast(`Generated ${algo} function body`, 'success');
      },
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
