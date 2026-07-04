// src/components/Terminal/TerminalPanel.jsx
// xterm.js + node-pty integrated terminal
import { useEffect, useRef, useState } from 'react';
import useEditorStore from '../../store/editorStore';

let terminalId = 0;

function useXterm(containerRef, id, cwd) {
  const xtermRef  = useRef(null);
  const fitRef    = useRef(null);
  const readyRef  = useRef(false);
  const [available, setAvailable] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cleanup = () => {};

    (async () => {
      // Check availability
      const ok = await window.api?.termAvailable();
      setAvailable(!!ok);

      // Dynamic import to avoid SSR issues
      const { Terminal } = await import('xterm');
      const { FitAddon }     = await import('xterm-addon-fit');
      const { WebLinksAddon } = await import('xterm-addon-web-links');
      await import('xterm/css/xterm.css');

      const term = new Terminal({
        fontFamily: '"JetBrains Mono", "Fira Code", Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 2000,
        allowProposedApi: true,
        theme: {
          background:      '#0d1117',
          foreground:      '#e6edf3',
          cursor:          '#a78bfa',
          cursorAccent:    '#0d1117',
          selectionBackground: '#264f7855',
          black:   '#0d1117', brightBlack:   '#6e7681',
          red:     '#ff7b72', brightRed:     '#ffa198',
          green:   '#3fb950', brightGreen:   '#56d364',
          yellow:  '#d29922', brightYellow:  '#e3b341',
          blue:    '#79c0ff', brightBlue:    '#79c0ff',
          magenta: '#bc8cff', brightMagenta: '#d2a8ff',
          cyan:    '#39c5cf', brightCyan:    '#56d364',
          white:   '#b1bac4', brightWhite:   '#ffffff',
        },
      });

      const fit  = new FitAddon();
      const links = new WebLinksAddon();
      term.loadAddon(fit);
      term.loadAddon(links);
      term.open(containerRef.current);
      fit.fit();
      readyRef.current = true;
      xtermRef.current = term;
      fitRef.current   = fit;

      if (ok && window.api) {
        // Create PTY process
        const res = await window.api.termCreate(id, term.cols, term.rows, cwd);
        if (!res?.ok) {
          term.write(`\r\n\x1b[31m⚠ Terminal error: ${res?.error || 'unknown'}\x1b[0m\r\n`);
          term.write(`\x1b[33mRun: npm run postinstall\x1b[0m\r\n`);
        }

        // PTY → terminal UI
        const offData = window.api.onTermData(id, data => term.write(data));
        const offExit = window.api.onTermExit(id, code => {
          term.write(`\r\n\x1b[33m[Process exited: ${code}]\x1b[0m\r\n`);
        });

        // User keystrokes → PTY
        term.onData(data => window.api.termWrite(id, data));

        // Resize
        const ro = new ResizeObserver(() => {
          if (fitRef.current) { fitRef.current.fit(); window.api.termResize(id, term.cols, term.rows); }
        });
        if (containerRef.current) ro.observe(containerRef.current);

        cleanup = () => {
          offData(); offExit();
          ro.disconnect();
          window.api.termKill(id);
          term.dispose();
        };
      } else {
        // No PTY — show info
        term.write('\x1b[33m⚠ Terminal requires native module (node-pty).\r\nRun: npm run postinstall  then restart.\x1b[0m\r\n');
        cleanup = () => term.dispose();
      }
    })();

    return () => cleanup();
  }, []);

  return { available };
}

// ─── Single terminal instance ──────────────────────────────────────────────
function TerminalInstance({ id, cwd, active }) {
  const containerRef = useRef(null);
  const { available } = useXterm(containerRef, id, cwd);

  return (
    <div
      ref={containerRef}
      style={{ display: active ? 'block' : 'none' }}
      className="w-full h-full p-1"
    />
  );
}

// ─── Panel with tab bar ────────────────────────────────────────────────────
export default function TerminalPanel() {
  const { currentFolder, toggleTerminal, setTerminalSender } = useEditorStore();
  const [initialId] = useState(() => `t-${++terminalId}`);
  const [instances, setInstances] = useState(() => [{ id: initialId, label: 'bash' }]);
  const [activeId, setActiveId]   = useState(() => initialId);

  useEffect(() => {
    setTerminalSender((command) => {
      if (activeId && window.api) window.api.termWrite(activeId, command);
    });
    return () => setTerminalSender(null);
  }, [activeId, setTerminalSender]);

  const addTerminal = () => {
    const id = `t-${++terminalId}`;
    setInstances(prev => [...prev, { id, label: `bash ${terminalId}` }]);
    setActiveId(id);
  };

  const removeTerminal = (id) => {
    const next = instances.filter(i => i.id !== id);
    setInstances(next);
    if (activeId === id) setActiveId(next.length ? next[next.length - 1].id : null);
    window.api?.termKill(id);
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      {/* Tab bar */}
      <div className="flex items-center bg-[#161b22] border-b border-[#30363d] flex-shrink-0 h-8">
        <span className="px-3 text-xs text-[#8b949e] font-semibold uppercase tracking-wide">Terminal</span>
        <div className="flex flex-1 overflow-x-auto">
          {instances.map(inst => (
            <button
              key={inst.id}
              onClick={() => setActiveId(inst.id)}
              className={`flex items-center gap-1.5 px-3 h-8 text-xs flex-shrink-0 border-r border-[#30363d] transition-colors
                ${activeId === inst.id ? 'bg-[#0d1117] text-[#e6edf3]' : 'text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d]'}`}
            >
              ⌨ {inst.label}
              <span
                onClick={e => { e.stopPropagation(); removeTerminal(inst.id); }}
                className="opacity-0 hover:opacity-100 ml-1 hover:text-red-400"
              >
                ×
              </span>
            </button>
          ))}
        </div>
        <button onClick={addTerminal} title="New terminal" className="px-2 text-[#8b949e] hover:text-[#e6edf3] text-base flex-shrink-0">+</button>
        <button onClick={toggleTerminal} title="Close terminal panel" className="px-2 text-[#8b949e] hover:text-red-400 text-base flex-shrink-0">✕</button>
      </div>

      {/* Terminal content */}
      <div className="flex-1 overflow-hidden">
        {instances.map(inst => (
          <TerminalInstance
            key={inst.id}
            id={inst.id}
            cwd={currentFolder}
            active={activeId === inst.id}
          />
        ))}
      </div>
    </div>
  );
}
