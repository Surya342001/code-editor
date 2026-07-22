// src/components/KnowledgeGraph/KnowledgeGraphPanel.jsx
// Interactive project knowledge-graph: force-directed canvas, SAST, metrics
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import useKgStore from '../../store/knowledgeGraphStore';
import useEditorStore from '../../store/editorStore';

// ─── Node visual config ────────────────────────────────────────────────────
const LANG_COLOR = {
  javascript: '#7c3aed', typescript: '#3b82f6', python: '#f59e0b',
  ruby:       '#e11d48', go:         '#06b6d4', rust:   '#f97316',
  java:       '#ef4444', csharp:     '#8b5cf6', cpp:    '#ec4899',
  css:        '#a855f7', html:       '#f0883e', vue:    '#3fb950',
  svelte:     '#ff4500', json:       '#8b949e', yaml:   '#6b7280',
  markdown:   '#6b7280', shell:      '#22d3ee', sql:    '#fbbf24',
  package:    '#10b981', external:   '#484f58', default:'#8b949e',
};
const SEV_COLOR = { critical:'#f85149', high:'#f0883e', medium:'#e3b341', low:'#79c0ff', info:'#8b949e' };
const SEV_ORDER = ['critical','high','medium','low','info'];

function nodeColor(n) { return LANG_COLOR[n.language] || LANG_COLOR.default; }
function maxSev(issues = []) {
  for (const s of SEV_ORDER) if (issues.find(i => i.severity === s)) return s;
  return null;
}

// ─── Force-directed layout ─────────────────────────────────────────────────
class ForceLayout {
  constructor(nodes, edges, W, H) {
    this.W = W; this.H = H;
    const R = Math.min(W, H) * 0.38;
    this.nodes = nodes.map((n, i) => ({
      ...n,
      x:  W / 2 + Math.cos((i / nodes.length) * Math.PI * 2) * R * (0.6 + Math.random() * 0.4),
      y:  H / 2 + Math.sin((i / nodes.length) * Math.PI * 2) * R * (0.6 + Math.random() * 0.4),
      vx: (Math.random() - 0.5) * 3,
      vy: (Math.random() - 0.5) * 3,
      r:  Math.max(5, Math.min(22, 5 + Math.cbrt(n.lineCount || 0) * 1.2)),
      pinned: false,
    }));
    this.edges   = edges;
    this.nodeMap = new Map(this.nodes.map(n => [n.id, n]));
    this.alpha   = 1.0;
  }

  tick() {
    if (this.alpha < 0.001) return false;
    this.alpha *= 0.993;
    const cx = this.W / 2, cy = this.H / 2;

    // Repulsion (O(n²) — fine for <500 nodes, use grid for larger)
    for (let i = 0; i < this.nodes.length; i++) {
      const a = this.nodes[i];
      for (let j = i + 1; j < this.nodes.length; j++) {
        const b  = this.nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = Math.max(dx * dx + dy * dy, 1);
        const d  = Math.sqrt(d2);
        const f  = (12000 / d2) * this.alpha;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        if (!a.pinned) { a.vx += fx; a.vy += fy; }
        if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
      }
      // Gravity
      if (!a.pinned) {
        a.vx += (cx - a.x) * 0.004 * this.alpha;
        a.vy += (cy - a.y) * 0.004 * this.alpha;
      }
    }

    // Edge spring attraction
    for (const e of this.edges) {
      const a = this.nodeMap.get(e.source), b = this.nodeMap.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d  = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f  = (d - 110) * 0.035 * this.alpha;
      if (!a.pinned) { a.vx += (dx / d) * f; a.vy += (dy / d) * f; }
      if (!b.pinned) { b.vx -= (dx / d) * f; b.vy -= (dy / d) * f; }
    }

    // Integrate
    for (const n of this.nodes) {
      if (n.pinned) continue;
      n.vx *= 0.72; n.vy *= 0.72;
      n.x  += n.vx; n.y  += n.vy;
      n.x = Math.max(n.r + 2, Math.min(this.W - n.r - 2, n.x));
      n.y = Math.max(n.r + 2, Math.min(this.H - n.r - 2, n.y));
    }
    return true;
  }

  warmup(steps = 300) { for (let i = 0; i < steps; i++) this.tick(); }

  hitTest(wx, wy) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      const dx = n.x - wx, dy = n.y - wy;
      if (dx * dx + dy * dy <= (n.r + 4) * (n.r + 4)) return n;
    }
    return null;
  }
}

// ─── Canvas renderer ───────────────────────────────────────────────────────
function drawFrame(ctx, sim, cam, selId, hovId, filter, W, H) {
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  if (!sim) return;
  ctx.save();
  ctx.translate(cam.x, cam.y);
  ctx.scale(cam.zoom, cam.zoom);

  // ── Edges ────────────────────────────────────────────────────────────────
  for (const e of sim.edges) {
    if (e.type === 'uses-package' && filter !== 'all') continue;
    const a = sim.nodeMap.get(e.source), b = sim.nodeMap.get(e.target);
    if (!a || !b) continue;
    const highlighted = a.id === selId || b.id === selId;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = highlighted ? '#7c3aed88' : '#30363d55';
    ctx.lineWidth   = highlighted ? 1.5 / cam.zoom : 0.8 / cam.zoom;
    ctx.stroke();

    // Arrow tip
    if (highlighted) {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const tip = { x: b.x - Math.cos(ang) * (b.r + 2), y: b.y - Math.sin(ang) * (b.r + 2) };
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - Math.cos(ang - 0.4) * 8, tip.y - Math.sin(ang - 0.4) * 8);
      ctx.lineTo(tip.x - Math.cos(ang + 0.4) * 8, tip.y - Math.sin(ang + 0.4) * 8);
      ctx.closePath();
      ctx.fillStyle = '#7c3aed';
      ctx.fill();
    }
  }

  // ── Nodes ────────────────────────────────────────────────────────────────
  for (const n of sim.nodes) {
    const isSel  = n.id === selId;
    const isHov  = n.id === hovId;
    const color  = nodeColor(n);
    const sev    = maxSev(n.issues || []);

    // Glow
    if (isSel || isHov) {
      ctx.shadowColor = color;
      ctx.shadowBlur  = 16 / cam.zoom;
    }

    // Body
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = isSel ? color : color + 'cc';
    ctx.fill();
    ctx.shadowBlur = 0;

    // Issues ring
    if (sev) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 3 / cam.zoom, 0, Math.PI * 2);
      ctx.strokeStyle = SEV_COLOR[sev];
      ctx.lineWidth   = 2 / cam.zoom;
      ctx.stroke();
    }

    // Selection ring
    if (isSel) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 6 / cam.zoom, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff80';
      ctx.lineWidth   = 1.5 / cam.zoom;
      ctx.stroke();
    }

    // Label (only when big enough or selected/hovered)
    if (n.r > 9 || isSel || isHov) {
      const label = n.name.length > 18 ? n.name.slice(0, 16) + '…' : n.name;
      ctx.font      = `${isSel ? 'bold ' : ''}${Math.max(9, 10 / cam.zoom)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = isSel ? '#ffffff' : '#e6edf3cc';
      ctx.fillText(label, n.x, n.y + n.r + 14 / cam.zoom);
    }
  }

  ctx.restore();
}

// ─── Graph Canvas Component ────────────────────────────────────────────────
function GraphCanvas({ nodes, edges, selectedId, onSelect, filter }) {
  const canvasRef  = useRef(null);
  const simRef     = useRef(null);
  const camRef     = useRef({ x: 0, y: 0, zoom: 1 });
  const animRef    = useRef(null);
  const dragRef    = useRef(null);
  const [hovId, setHovId] = useState(null);

  // (Re)build simulation when data changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !nodes.length) return;
    const W = canvas.offsetWidth || 800;
    const H = canvas.offsetHeight || 500;
    canvas.width  = W;
    canvas.height = H;

    const sim = new ForceLayout(nodes, edges, W, H);
    // Run warmup off-screen
    sim.warmup(250);
    simRef.current = sim;
    camRef.current = { x: 0, y: 0, zoom: 1 };

    let running = true;
    function loop() {
      if (!running) return;
      const still = !sim.tick();
      const ctx   = canvas.getContext('2d');
      drawFrame(ctx, sim, camRef.current, selectedId, hovId, filter, W, H);
      animRef.current = still ? setTimeout(() => requestAnimationFrame(loop), 100) : requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
      clearTimeout(animRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, edges.length]);

  // Redraw on selection/hover change (without restarting sim)
  useEffect(() => {
    const canvas = canvasRef.current;
    const sim    = simRef.current;
    if (!canvas || !sim) return;
    const ctx = canvas.getContext('2d');
    drawFrame(ctx, sim, camRef.current, selectedId, hovId, filter, canvas.width, canvas.height);
  }, [selectedId, hovId, filter]);

  // Mouse events
  const toWorld = (e) => {
    const rect  = canvasRef.current.getBoundingClientRect();
    const cam   = camRef.current;
    return {
      x: (e.clientX - rect.left - cam.x) / cam.zoom,
      y: (e.clientY - rect.top  - cam.y) / cam.zoom,
    };
  };

  const onMouseDown = useCallback((e) => {
    const w = toWorld(e);
    const sim = simRef.current;
    if (!sim) return;
    const hit = sim.hitTest(w.x, w.y);
    if (hit) {
      hit.pinned = true;
      dragRef.current = { node: hit, startX: e.clientX, startY: e.clientY };
    } else {
      dragRef.current = { pan: true, startX: e.clientX, startY: e.clientY, ox: camRef.current.x, oy: camRef.current.y };
    }
  }, []);

  const onMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    const sim    = simRef.current;
    if (!canvas || !sim) return;

    const w = toWorld(e);
    const hit = sim.hitTest(w.x, w.y);
    setHovId(hit?.id || null);

    if (dragRef.current) {
      if (dragRef.current.pan) {
        camRef.current = {
          ...camRef.current,
          x: dragRef.current.ox + (e.clientX - dragRef.current.startX),
          y: dragRef.current.oy + (e.clientY - dragRef.current.startY),
        };
      } else if (dragRef.current.node) {
        dragRef.current.node.x = w.x;
        dragRef.current.node.y = w.y;
      }
      const ctx = canvas.getContext('2d');
      drawFrame(ctx, sim, camRef.current, selectedId, hit?.id, filter, canvas.width, canvas.height);
    }
  }, [selectedId, filter]);

  const onMouseUp = useCallback((e) => {
    if (dragRef.current?.node) {
      dragRef.current.node.pinned = false;
      const w   = toWorld(e);
      const sim = simRef.current;
      const hit = sim?.hitTest(w.x, w.y);
      if (hit) onSelect(hit);
    }
    dragRef.current = null;
  }, [onSelect]);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const cam   = camRef.current;
    const delta = e.deltaY < 0 ? 1.12 : 0.89;
    const newZoom = Math.max(0.15, Math.min(5, cam.zoom * delta));
    const rect  = canvasRef.current.getBoundingClientRect();
    const mx    = e.clientX - rect.left;
    const my    = e.clientY - rect.top;
    camRef.current = {
      x: mx - (mx - cam.x) * (newZoom / cam.zoom),
      y: my - (my - cam.y) * (newZoom / cam.zoom),
      zoom: newZoom,
    };
    const canvas = canvasRef.current;
    const sim    = simRef.current;
    if (canvas && sim) {
      const ctx = canvas.getContext('2d');
      drawFrame(ctx, sim, camRef.current, selectedId, hovId, filter, canvas.width, canvas.height);
    }
  }, [selectedId, hovId, filter]);

  const resetCamera = () => {
    camRef.current = { x: 0, y: 0, zoom: 1 };
    const canvas = canvasRef.current;
    const sim    = simRef.current;
    if (canvas && sim) {
      const ctx = canvas.getContext('2d');
      drawFrame(ctx, sim, camRef.current, selectedId, hovId, filter, canvas.width, canvas.height);
    }
  };

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onWheel={onWheel}
      />
      <button
        onClick={resetCamera}
        className="absolute bottom-2 right-2 px-2 py-1 bg-[#21262d] border border-[#30363d] rounded text-[10px] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
        title="Reset camera"
      >
        ⌂ Reset
      </button>
      <div className="absolute bottom-2 left-2 text-[10px] text-[#484f58] select-none">
        Scroll to zoom · Drag to pan · Click node to inspect
      </div>
    </div>
  );
}

// ─── Severity badge ────────────────────────────────────────────────────────
function SevBadge({ sev, count }) {
  if (!count) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded"
      style={{ background: SEV_COLOR[sev] + '25', color: SEV_COLOR[sev] }}
    >
      {sev.toUpperCase()} {count}
    </span>
  );
}

// ─── Node detail panel ─────────────────────────────────────────────────────
function NodeDetail({ node, onClose }) {
  const navigateTo = useEditorStore(s => s.navigateTo);
  if (!node) return null;

  const color = nodeColor(node);
  const sev   = maxSev(node.issues || []);
  const totalIssues = (node.issues || []).reduce((s, i) => s + i.count, 0);

  return (
    <div className="flex flex-col gap-2 p-3 bg-[#161b22] border-t border-[#30363d] text-xs overflow-y-auto max-h-[340px]">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="text-[#e6edf3] font-bold truncate flex-1">{node.name}</span>
        {sev && <span className="text-[10px] font-bold" style={{ color: SEV_COLOR[sev] }}>{sev.toUpperCase()}</span>}
        <button onClick={onClose} className="text-[#484f58] hover:text-[#e6edf3] ml-1">✕</button>
      </div>

      {/* Path + open */}
      {node.type === 'file' && (
        <div className="flex items-center gap-1">
          <span className="text-[#484f58] truncate flex-1">{node.relativePath}</span>
          <button
            onClick={() => node.path && navigateTo(node.path, 1)}
            className="text-[#7c3aed] hover:text-[#a78bfa] flex-shrink-0"
            title="Open file"
          >
            Open →
          </button>
        </div>
      )}

      {/* Metrics grid */}
      {node.type === 'file' && (
        <div className="grid grid-cols-3 gap-1.5">
          {[
            ['Lines',    node.lineCount],
            ['LOC',      node.linesOfCode],
            ['Blank',    node.blankLines],
            ['Comments', node.commentLines],
            ['Complexity', node.complexity],
            ['Big-O',    node.bigO],
            ['Imports',  node.imports?.length],
            ['Exports',  node.exports?.length],
            ['Functions',node.functions?.length],
          ].map(([label, val]) => (
            <div key={label} className="bg-[#0d1117] rounded p-1.5 text-center">
              <div className="text-[#8b949e] text-[9px]">{label}</div>
              <div className="text-[#e6edf3] font-bold">{val ?? '—'}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tags */}
      <div className="flex flex-wrap gap-1">
        {(node.components || []).map(c => (
          <span key={c} className="px-1.5 py-0.5 bg-[#3fb95025] text-[#3fb950] rounded text-[10px]">⚛ {c}</span>
        ))}
        {(node.hooks || []).map(h => (
          <span key={h} className="px-1.5 py-0.5 bg-[#7c3aed25] text-[#a78bfa] rounded text-[10px]">ƒ {h}</span>
        ))}
        {(node.classes || []).map(c => (
          <span key={c.name} className="px-1.5 py-0.5 bg-[#f0883e25] text-[#f0883e] rounded text-[10px]">
            ⬡ {c.name}{c.extends ? ` extends ${c.extends}` : ''}
          </span>
        ))}
      </div>

      {/* Issues */}
      {totalIssues > 0 && (
        <div className="space-y-1">
          <div className="text-[#8b949e] text-[10px] uppercase font-semibold">Issues ({totalIssues})</div>
          {(node.issues || []).map((iss, i) => (
            <div key={i} className="flex items-start gap-2 p-1.5 rounded" style={{ background: SEV_COLOR[iss.severity] + '15' }}>
              <span className="font-bold text-[10px] flex-shrink-0" style={{ color: SEV_COLOR[iss.severity] }}>
                {iss.severity.toUpperCase()}
              </span>
              <span className="text-[#c9d1d9]">{iss.message}</span>
              {iss.count > 1 && <span className="ml-auto text-[#484f58]">×{iss.count}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Imports list */}
      {node.imports?.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-[#8b949e] hover:text-[#e6edf3] text-[10px] uppercase font-semibold">
            Imports ({node.imports.length})
          </summary>
          <div className="mt-1 space-y-0.5 max-h-[100px] overflow-y-auto">
            {node.imports.map((imp, i) => (
              <div key={i} className="text-[#8b949e] font-mono text-[10px] truncate">
                <span className="text-[#484f58]">←</span> {imp}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ─── Legend ────────────────────────────────────────────────────────────────
function Legend() {
  const items = [
    { color: LANG_COLOR.javascript, label: 'JS/JSX'   },
    { color: LANG_COLOR.typescript, label: 'TS/TSX'   },
    { color: LANG_COLOR.python,     label: 'Python'    },
    { color: LANG_COLOR.package,    label: 'npm pkg'   },
    { color: SEV_COLOR.critical,    label: '⚠ Critical', ring: true },
    { color: SEV_COLOR.high,        label: '⚠ High',     ring: true },
  ];
  return (
    <div className="flex flex-wrap gap-2 px-3 py-1.5 border-b border-[#30363d] text-[10px]">
      {items.map(({ color, label, ring }) => (
        <span key={label} className="flex items-center gap-1 text-[#8b949e]">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={ring ? { border: `2px solid ${color}`, background: 'transparent' } : { background: color }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}

// ─── Main Panel ────────────────────────────────────────────────────────────
export default function KnowledgeGraphPanel() {
  const { nodes, edges, stats, building, progress, phase, error, lastBuilt, projectRoot, build, load, clear } = useKgStore();
  const { currentFolder, toast } = useEditorStore();

  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter]         = useState('all');
  const [tab, setTab]               = useState('graph'); // graph | stats | issues | search
  const [searchQ, setSearchQ]       = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  // Load persisted graph on mount
  useEffect(() => { load(); }, []);

  // Select handler
  const handleSelect = useCallback((n) => {
    setSelectedId(s => s === n.id ? null : n.id);
    setTab('graph');
  }, []);

  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedId), [nodes, selectedId]);

  // Filtered nodes/edges for canvas
  const { visNodes, visEdges } = useMemo(() => {
    let vn = nodes;
    if (filter === 'code')     vn = nodes.filter(n => !['json','yaml','markdown','plaintext','external'].includes(n.language));
    if (filter === 'issues')   vn = nodes.filter(n => (n.issues || []).length > 0);
    if (filter === 'packages') vn = nodes;
    const vnIds = new Set(vn.map(n => n.id));
    const ve    = edges.filter(e => vnIds.has(e.source) && vnIds.has(e.target));
    return { visNodes: vn, visEdges: ve };
  }, [nodes, edges, filter]);

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQ.trim()) return [];
    const q = searchQ.toLowerCase();
    return nodes.filter(n =>
      n.name?.toLowerCase().includes(q) ||
      n.relativePath?.toLowerCase().includes(q) ||
      n.functions?.some(f => f.toLowerCase().includes(q)) ||
      n.components?.some(c => c.toLowerCase().includes(q))
    ).slice(0, 40);
  }, [nodes, searchQ]);

  // All issues flat
  const allIssues = useMemo(() => {
    const out = [];
    for (const n of nodes) {
      for (const iss of n.issues || []) {
        out.push({ ...iss, file: n.name, filePath: n.relativePath, nodeId: n.id });
      }
    }
    return out.sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  }, [nodes]);

  const handleBuild = async () => {
    const folder = currentFolder;
    if (!folder) { toast('Open a project folder first', 'warn'); return; }
    await build(folder);
    toast('Knowledge graph built!', 'success');
  };

  const elapsed = lastBuilt ? Math.round((Date.now() - lastBuilt) / 60000) : null;

  // ── Layout ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0d1117] text-[#e6edf3] text-sm">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#30363d] bg-[#161b22] flex-shrink-0">
        <span className="text-base">🧠</span>
        <span className="font-semibold text-xs flex-1 truncate">Knowledge Graph</span>
        {elapsed !== null && (
          <span className="text-[10px] text-[#484f58]">{elapsed < 1 ? 'just now' : `${elapsed}m ago`}</span>
        )}
        {nodes.length > 0 && (
          <button
            onClick={() => setFullscreen(v => !v)}
            className="text-[#8b949e] hover:text-[#e6edf3] text-xs"
            title="Toggle fullscreen graph"
          >
            {fullscreen ? '⊡' : '⊞'}
          </button>
        )}
        <button
          onClick={handleBuild}
          disabled={building}
          className="px-2.5 py-1 bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-50 text-white rounded text-[11px] font-semibold flex-shrink-0 transition-colors"
          title={`Analyse ${currentFolder || 'project'}`}
        >
          {building ? '⟳ Analysing…' : nodes.length ? '↺ Re-analyse' : '⚡ Analyse Project'}
        </button>
        {nodes.length > 0 && (
          <button
            onClick={() => { clear(); toast('Graph cleared', 'info'); }}
            disabled={building}
            className="text-[#8b949e] hover:text-[#f85149] text-xs flex-shrink-0 transition-colors"
            title="Clear graph"
          >✕</button>
        )}
      </div>

      {/* ── Progress ───────────────────────────────────────────────────── */}
      {building && (
        <div className="flex-shrink-0 px-3 py-2 bg-[#161b22] border-b border-[#30363d]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-[#8b949e] truncate">{phase}</span>
            <span className="text-[11px] text-[#7c3aed] font-bold">{progress}%</span>
          </div>
          <div className="h-1.5 bg-[#21262d] rounded overflow-hidden">
            <div
              className="h-full bg-[#7c3aed] rounded transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="flex-shrink-0 px-3 py-2 bg-[#f851491a] border-b border-[#f8514940] text-[#f85149] text-xs">
          ⚠ {error}
        </div>
      )}

      {/* ── Empty state ────────────────────────────────────────────────── */}
      {!building && nodes.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6">
          <span className="text-5xl">🧠</span>
          <div className="text-[#8b949e] text-sm">No graph built yet</div>
          <div className="text-[#484f58] text-xs max-w-[220px] leading-relaxed">
            Click <strong className="text-[#7c3aed]">⚡ Analyse Project</strong> to build a complete knowledge graph with imports, dependencies, SAST checks, and architecture metrics.
          </div>
          <div className="text-[10px] text-[#484f58] space-y-1 mt-2 text-left">
            <div>✦ Dependency graph &amp; import edges</div>
            <div>✦ Circular dependency detection</div>
            <div>✦ SAST security analysis</div>
            <div>✦ Cyclomatic complexity + Big-O estimation</div>
            <div>✦ React components, hooks, class hierarchy</div>
            <div>✦ Architecture hotspots</div>
          </div>
        </div>
      )}

      {/* ── Main content (when graph exists) ───────────────────────────── */}
      {!building && nodes.length > 0 && (
        <>
          {/* Stats bar */}
          {stats && (
            <div className="flex items-center gap-3 px-3 py-1.5 border-b border-[#30363d] bg-[#161b22] flex-shrink-0 overflow-x-auto text-[10px]">
              <span className="text-[#8b949e] whitespace-nowrap"><span className="text-[#e6edf3] font-bold">{stats.fileCount}</span> files</span>
              <span className="text-[#8b949e] whitespace-nowrap"><span className="text-[#e6edf3] font-bold">{stats.totalLOC?.toLocaleString()}</span> LOC</span>
              <span className="text-[#8b949e] whitespace-nowrap"><span className="text-[#e6edf3] font-bold">{stats.edgeCount}</span> edges</span>
              <span className="text-[#8b949e] whitespace-nowrap">avg cc <span className="text-[#e6edf3] font-bold">{stats.avgComplexity}</span></span>
              {stats.issues?.critical > 0 && <SevBadge sev="critical" count={stats.issues.critical} />}
              {stats.issues?.high     > 0 && <SevBadge sev="high"     count={stats.issues.high}     />}
              {stats.issues?.medium   > 0 && <SevBadge sev="medium"   count={stats.issues.medium}   />}
            </div>
          )}

          {/* Tabs */}
          <div className="flex border-b border-[#30363d] bg-[#161b22] flex-shrink-0">
            {[
              { id: 'graph',  label: '🕸 Graph'   },
              { id: 'stats',  label: '📊 Stats'   },
              { id: 'issues', label: `⚠ Issues${allIssues.length ? ` (${allIssues.length})` : ''}` },
              { id: 'search', label: '🔍 Search'  },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-1.5 text-[10px] font-medium transition-colors border-b-2
                  ${tab === t.id ? 'border-[#7c3aed] text-[#e6edf3]' : 'border-transparent text-[#8b949e] hover:text-[#e6edf3]'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── GRAPH TAB ──────────────────────────────────────────────── */}
          {tab === 'graph' && (
            <div className={`flex flex-col ${fullscreen ? 'fixed inset-0 z-50 bg-[#0d1117]' : 'flex-1'} overflow-hidden`}>
              {/* Filter + legend */}
              <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#30363d] flex-shrink-0 bg-[#161b22]">
                {[
                  { id: 'all',      label: 'All' },
                  { id: 'code',     label: 'Code only' },
                  { id: 'issues',   label: '⚠ Issues' },
                ].map(f => (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={`px-2 py-0.5 rounded text-[10px] transition-colors
                      ${filter === f.id ? 'bg-[#7c3aed] text-white' : 'text-[#8b949e] hover:text-[#e6edf3]'}`}
                  >
                    {f.label}
                  </button>
                ))}
                <span className="ml-auto text-[10px] text-[#484f58]">{visNodes.length} nodes · {visEdges.length} edges</span>
                {fullscreen && (
                  <button onClick={() => setFullscreen(false)} className="ml-2 text-[#8b949e] hover:text-[#e6edf3] text-xs">✕</button>
                )}
              </div>
              <Legend />

              {/* Canvas */}
              <div className="flex-1 min-h-0" style={{ minHeight: fullscreen ? undefined : 320 }}>
                <GraphCanvas
                  nodes={visNodes}
                  edges={visEdges}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                  filter={filter}
                />
              </div>

              {/* Node detail */}
              {selectedNode && (
                <NodeDetail
                  node={selectedNode}
                  onClose={() => setSelectedId(null)}
                />
              )}
            </div>
          )}

          {/* ── STATS TAB ─────────────────────────────────────────────── */}
          {tab === 'stats' && stats && (
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {/* Language breakdown */}
              <section>
                <div className="text-[10px] text-[#8b949e] uppercase font-semibold mb-2">Language Breakdown</div>
                {Object.entries(stats.langCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([lang, count]) => {
                    const pct = Math.round((count / stats.fileCount) * 100);
                    return (
                      <div key={lang} className="flex items-center gap-2 mb-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: LANG_COLOR[lang] || LANG_COLOR.default }}
                        />
                        <span className="text-[#e6edf3] text-xs w-24 truncate">{lang}</span>
                        <div className="flex-1 h-1.5 bg-[#21262d] rounded overflow-hidden">
                          <div
                            className="h-full rounded"
                            style={{ width: `${pct}%`, background: LANG_COLOR[lang] || LANG_COLOR.default }}
                          />
                        </div>
                        <span className="text-[#8b949e] text-[10px] w-6 text-right">{count}</span>
                      </div>
                    );
                  })}
              </section>

              {/* Project metrics */}
              <section>
                <div className="text-[10px] text-[#8b949e] uppercase font-semibold mb-2">Project Metrics</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['Total Files',       stats.fileCount],
                    ['Total Lines',       stats.totalLines?.toLocaleString()],
                    ['Lines of Code',     stats.totalLOC?.toLocaleString()],
                    ['Avg Lines/File',    stats.avgLinesPerFile],
                    ['Import Edges',      stats.edgeCount],
                    ['Avg Complexity',    stats.avgComplexity],
                  ].map(([label, val]) => (
                    <div key={label} className="bg-[#161b22] border border-[#30363d] rounded p-2">
                      <div className="text-[#8b949e] text-[9px] uppercase">{label}</div>
                      <div className="text-[#e6edf3] font-bold text-sm mt-0.5">{val}</div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Hotspots */}
              {stats.hotspots?.length > 0 && (
                <section>
                  <div className="text-[10px] text-[#8b949e] uppercase font-semibold mb-2">Most Imported (Hotspots)</div>
                  {stats.hotspots.map((h, i) => (
                    <div key={i} className="flex items-center gap-2 py-1 border-b border-[#21262d] last:border-b-0">
                      <span className="text-[#484f58] text-[10px] w-4">{i + 1}.</span>
                      <span className="text-[#e6edf3] text-xs truncate flex-1">{h.name}</span>
                      <span className="text-[#7c3aed] text-[10px] font-bold">{h.count} imports</span>
                    </div>
                  ))}
                </section>
              )}

              {/* Issues summary */}
              <section>
                <div className="text-[10px] text-[#8b949e] uppercase font-semibold mb-2">SAST Summary</div>
                <div className="space-y-1.5">
                  {SEV_ORDER.map(sev => {
                    const cnt = stats.issues?.[sev] || 0;
                    if (!cnt) return null;
                    return (
                      <div key={sev} className="flex items-center gap-2">
                        <span className="w-14 text-[10px] font-bold" style={{ color: SEV_COLOR[sev] }}>{sev.toUpperCase()}</span>
                        <div className="flex-1 h-2 bg-[#21262d] rounded overflow-hidden">
                          <div
                            className="h-full rounded"
                            style={{ width: `${Math.min(100, (cnt / allIssues.length) * 100)}%`, background: SEV_COLOR[sev] }}
                          />
                        </div>
                        <span className="text-[#e6edf3] text-xs font-bold w-8 text-right">{cnt}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {/* ── ISSUES TAB ────────────────────────────────────────────── */}
          {tab === 'issues' && (
            <div className="flex-1 overflow-y-auto">
              {allIssues.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-[#8b949e] text-xs">
                  ✓ No issues detected
                </div>
              ) : (
                <div>
                  {allIssues.map((iss, i) => (
                    <button
                      key={i}
                      onClick={() => { setSelectedId(iss.nodeId); setTab('graph'); }}
                      className="w-full text-left px-3 py-2 border-b border-[#21262d] hover:bg-[#161b22] transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] font-bold" style={{ color: SEV_COLOR[iss.severity] }}>
                          {iss.severity.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-[#484f58] truncate">{iss.filePath}</span>
                        {iss.count > 1 && <span className="ml-auto text-[#484f58] text-[10px]">×{iss.count}</span>}
                      </div>
                      <div className="text-xs text-[#c9d1d9]">{iss.message}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── SEARCH TAB ────────────────────────────────────────────── */}
          {tab === 'search' && (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="px-3 py-2 border-b border-[#30363d]">
                <input
                  autoFocus
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  placeholder="Search files, functions, components…"
                  className="w-full bg-[#21262d] border border-[#30363d] rounded px-2 py-1.5 text-xs text-[#e6edf3] placeholder-[#484f58] focus:outline-none focus:border-[#7c3aed]"
                />
              </div>
              <div className="flex-1 overflow-y-auto">
                {searchQ && searchResults.length === 0 && (
                  <div className="text-center text-[#484f58] text-xs py-6">No results</div>
                )}
                {searchResults.map(n => (
                  <button
                    key={n.id}
                    onClick={() => { setSelectedId(n.id); setTab('graph'); }}
                    className="w-full text-left px-3 py-2 border-b border-[#21262d] hover:bg-[#161b22] transition-colors"
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: nodeColor(n) }} />
                      <span className="text-xs text-[#e6edf3] font-medium truncate">{n.name}</span>
                      <span className="ml-auto text-[10px] text-[#484f58]">{n.lineCount}L</span>
                    </div>
                    <div className="text-[10px] text-[#484f58] truncate">{n.relativePath}</div>
                    {(n.components?.length > 0 || n.functions?.length > 0) && (
                      <div className="text-[10px] text-[#8b949e] truncate mt-0.5">
                        {[...n.components?.slice(0, 3) || [], ...n.functions?.slice(0, 3) || []].join(' · ')}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
