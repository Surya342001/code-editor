// src/store/knowledgeGraphStore.js
// Complete project knowledge graph: analysis, SAST, architecture, persistence
import { create } from 'zustand';

// ─── IndexedDB helpers ─────────────────────────────────────────────────────
const DB_NAME  = 'lt-kg-v1';
const DB_STORE = 'graph';

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE))
        db.createObjectStore(DB_STORE, { keyPath: 'k' });
    };
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e.target.error);
  });
}
async function idbGet(k) {
  const db = await openDB();
  return new Promise(res => {
    const r = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(k);
    r.onsuccess = () => res(r.result?.v ?? null);
    r.onerror   = () => res(null);
  });
}
async function idbPut(k, v) {
  const db = await openDB();
  return new Promise(res => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put({ k, v });
    tx.oncomplete = () => res(true);
    tx.onerror    = () => res(false);
  });
}
async function idbClear() {
  const db = await openDB();
  return new Promise(res => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = () => res();
  });
}

// ─── Language detection ────────────────────────────────────────────────────
const EXT_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python',     rb: 'ruby',       go: 'go',          rs: 'rust',
  java: 'java',     cs: 'csharp',     cpp: 'cpp',        c: 'c',
  css: 'css',       scss: 'scss',     less: 'css',
  html: 'html',     vue: 'vue',       svelte: 'svelte',
  json: 'json',     yaml: 'yaml',     toml: 'toml',
  md: 'markdown',   sh: 'shell',      bash: 'shell',
  sql: 'sql',       graphql: 'graphql',
};
function getLang(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  if (filename.toLowerCase() === 'dockerfile') return 'dockerfile';
  return EXT_LANG[ext] || 'plaintext';
}

// ─── Complexity analysis ───────────────────────────────────────────────────
function calcComplexity(content) {
  const patterns = [
    /\bif\s*\(/g, /\belse\s+if\s*\(/g, /\bfor\s*\(/g,   /\bwhile\s*\(/g,
    /\bcase\s+[^:]+:/g, /\bcatch\s*\(/g, /\?\s*[^:\n]/g, /&&|\|\|/g,
  ];
  return 1 + patterns.reduce((s, re) => s + (content.match(re) || []).length, 0);
}

function estimateBigO(content) {
  const lines = content.split('\n');
  let maxNest = 0, cur = 0;
  for (const ln of lines) {
    if (/\b(for|while|forEach|map|reduce|filter|some|every|find)\b/.test(ln)) cur++;
    if (/^\s*\}/.test(ln) && cur > 0) cur--;
    maxNest = Math.max(maxNest, cur);
  }
  const TABLE = ['O(1)', 'O(n)', 'O(n²)', 'O(n³)', 'O(n⁴)'];
  return TABLE[Math.min(maxNest, 4)] || `O(n^${maxNest})`;
}

function maxNesting(content) {
  let max = 0, cur = 0;
  for (const ch of content) {
    if (ch === '{' || ch === '(') cur++;
    else if (ch === '}' || ch === ')') cur--;
    max = Math.max(max, cur);
  }
  return max;
}

// ─── SAST rules ────────────────────────────────────────────────────────────
const SAST_RULES = [
  { re: /\beval\s*\(/g,              sev: 'critical', msg: 'eval() — arbitrary code execution' },
  { re: /\.innerHTML\s*=/g,          sev: 'high',     msg: 'innerHTML assignment — XSS risk' },
  { re: /dangerouslySetInnerHTML/g,  sev: 'high',     msg: 'dangerouslySetInnerHTML — XSS risk' },
  { re: /document\.write\s*\(/g,     sev: 'high',     msg: 'document.write() — XSS risk' },
  { re: /setTimeout\s*\(\s*['"`]/g,  sev: 'medium',   msg: 'setTimeout with string arg — eval risk' },
  { re: /(?:password|passwd|secret|api[_-]?key|private[_-]?key)\s*[:=]\s*['"`][^'"`]{6,}/gi,
    sev: 'critical', msg: 'Possible hardcoded credential' },
  { re: /\.env\b(?!.*process)/g,     sev: 'info',     msg: '.env reference (ensure not committed)' },
  { re: /console\.(log|warn|debug)/g, sev: 'info',    msg: 'console statement (remove for prod)' },
  { re: /TODO:|FIXME:|HACK:|XXX:/g,  sev: 'info',     msg: 'TODO / FIXME comment' },
  { re: /Math\.random\s*\(\)/g,      sev: 'info',     msg: 'Math.random() — not crypto-safe' },
  { re: /http:\/\//g,                sev: 'medium',   msg: 'Plain HTTP URL — prefer HTTPS' },
  { re: /localhost|127\.0\.0\.1/g,   sev: 'info',     msg: 'Hardcoded localhost address' },
];

// ─── Core file analyser ────────────────────────────────────────────────────
export function analyzeFile(filePath, content, projectRoot) {
  const rel      = filePath.replace(projectRoot, '').replace(/^[/\\]/, '');
  const filename = rel.split('/').pop();
  const lang     = getLang(filename);
  const lines    = content.split('\n');

  const node = {
    id:           rel,
    type:         'file',
    name:         filename,
    path:         filePath,
    relativePath: rel,
    language:     lang,
    lineCount:    lines.length,
    size:         content.length,
    imports:      [],
    exports:      [],
    functions:    [],
    components:   [],
    hooks:        [],
    classes:      [],
    issues:       [],
    complexity:   0,
    bigO:         'O(1)',
    maxNesting:   0,
    linesOfCode:  0,
    commentLines: 0,
    blankLines:   0,
    isEntryPoint: /index\.(jsx?|tsx?)$/.test(filename) || /^main\.(jsx?|tsx?)$/.test(filename),
  };

  // Line type counts
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) node.blankLines++;
    else if (/^(\/\/|\/\*|\*|#|--\s)/.test(t)) node.commentLines++;
    else node.linesOfCode++;
  }

  // Only deep-parse code files
  const CODE_LANGS = new Set(['javascript','typescript','python','ruby','go','rust','java','csharp','cpp','c','php','swift','kotlin','vue','svelte','graphql','sql']);
  if (!CODE_LANGS.has(lang)) return { node, edges: [] };

  // ── Imports ─────────────────────────────────────────────────────────────
  const importPats = [
    /import\s+(?:[^;'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,                     // dynamic
    /from\s+['"]([^'"]+)['"]/g,                                  // Python
    /import\s+['"]([^'"]+)['"]/g,                                // Go
  ];
  const allImports = new Set();
  for (const p of importPats)
    for (const m of content.matchAll(p)) allImports.add(m[1]);
  node.imports = [...allImports];

  // ── Exports ─────────────────────────────────────────────────────────────
  const expPats = [
    /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/g,
    /export\s+\{([^}]+)\}/g,
    /module\.exports\s*=\s*\{?([^}\n]+)/g,
    /exports\.(\w+)\s*=/g,
  ];
  const allExports = new Set();
  for (const p of expPats)
    for (const m of content.matchAll(p))
      m[1].split(',').map(s => s.trim().replace(/\s+as\s+\w+/, '').trim()).filter(Boolean).forEach(n => allExports.add(n));
  node.exports = [...allExports];

  // ── Functions ────────────────────────────────────────────────────────────
  const fnPats = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g,
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/g,
    /def\s+(\w+)\s*\(/g,   // Python
    /func\s+(\w+)\s*\(/g,  // Go/Swift
    /fn\s+(\w+)\s*\(/g,    // Rust
  ];
  const reserved = new Set(['if','for','while','switch','catch','else','class','return','do','try']);
  const allFns = new Set();
  for (const p of fnPats)
    for (const m of content.matchAll(p))
      if (!reserved.has(m[1])) allFns.add(m[1]);
  node.functions = [...allFns];

  // ── React components & hooks ─────────────────────────────────────────────
  if (lang === 'javascript' || lang === 'typescript') {
    const compRe = /(?:export\s+)?(?:default\s+)?(?:function|const)\s+([A-Z][a-zA-Z0-9]*)/g;
    const hookRe = /(?:function|const)\s+(use[A-Z][a-zA-Z0-9]*)/g;
    for (const m of content.matchAll(compRe)) node.components.push(m[1]);
    for (const m of content.matchAll(hookRe))  node.hooks.push(m[1]);
  }

  // ── Classes ──────────────────────────────────────────────────────────────
  const classRe = /class\s+(\w+)(?:\s+extends\s+(\w+))?/g;
  for (const m of content.matchAll(classRe))
    node.classes.push({ name: m[1], extends: m[2] || null });

  // ── Metrics ──────────────────────────────────────────────────────────────
  node.complexity  = calcComplexity(content);
  node.bigO        = estimateBigO(content);
  node.maxNesting  = maxNesting(content);

  // ── SAST ─────────────────────────────────────────────────────────────────
  for (const rule of SAST_RULES) {
    const hits = [...content.matchAll(rule.re)];
    if (hits.length) node.issues.push({ severity: rule.sev, message: rule.msg, count: hits.length });
  }
  if (node.lineCount > 500) node.issues.push({ severity: 'medium', message: `God file (${node.lineCount} lines)`, count: 1 });
  if (node.complexity > 50) node.issues.push({ severity: 'medium', message: `High complexity (${node.complexity})`, count: 1 });
  if (node.maxNesting > 30) node.issues.push({ severity: 'low',    message: `Deep nesting (level ${Math.floor(node.maxNesting/4)})`, count: 1 });

  // ── Build edges ──────────────────────────────────────────────────────────
  const edges = [];
  for (const imp of node.imports) {
    if (imp.startsWith('.') || imp.startsWith('/')) {
      // Resolve relative path
      const dir   = rel.split('/').slice(0, -1);
      const parts = (imp.startsWith('/') ? imp.slice(1) : `${dir.join('/')}/${imp}`).split('/');
      const resolved = [];
      for (const p of parts) {
        if (p === '..') resolved.pop();
        else if (p && p !== '.') resolved.push(p);
      }
      let target = resolved.join('/');
      // Try with common extensions if no extension
      if (!/\.[a-z]+$/i.test(target)) target = target; // keep bare, we'll match by prefix
      edges.push({ id: `${rel}→${target}`, type: 'imports', source: rel, target, weight: 1 });
    } else {
      const pkg = imp.split('/')[0].replace(/^@/, '');
      edges.push({ id: `${rel}→pkg:${pkg}`, type: 'uses-package', source: rel, target: `pkg:${pkg}`, weight: 0.5 });
    }
  }

  return { node, edges };
}

// ─── Cycle detection (DFS) ────────────────────────────────────────────────
function detectCycles(nodes, edges) {
  const adj = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) {
    if (e.type === 'imports' && adj.has(e.source)) adj.get(e.source).push(e.target);
  }
  const visited = new Set(), stack = new Set(), cycles = [];
  function dfs(id, path) {
    if (stack.has(id)) {
      const ci = path.indexOf(id);
      cycles.push(path.slice(ci));
      return;
    }
    if (visited.has(id)) return;
    visited.add(id); stack.add(id);
    for (const nb of (adj.get(id) || [])) dfs(nb, [...path, id]);
    stack.delete(id);
  }
  for (const n of nodes) dfs(n.id, []);
  return cycles.slice(0, 20); // cap
}

// ─── Project stats ────────────────────────────────────────────────────────
function computeStats(nodes, edges) {
  const langCounts  = {};
  let totalLines = 0, totalLOC = 0, totalComplexity = 0;
  const allIssues   = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const importCount = new Map(); // target → count (most-imported)

  for (const n of nodes) {
    if (n.type === 'package') continue;
    langCounts[n.language] = (langCounts[n.language] || 0) + 1;
    totalLines     += n.lineCount    || 0;
    totalLOC       += n.linesOfCode  || 0;
    totalComplexity += n.complexity  || 0;
    for (const iss of n.issues || []) allIssues[iss.severity] = (allIssues[iss.severity] || 0) + iss.count;
  }
  for (const e of edges) {
    if (e.type === 'imports') importCount.set(e.target, (importCount.get(e.target) || 0) + 1);
  }
  const hotspots = [...importCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([id, count]) => ({ id, count, name: id.split('/').pop() }));

  const fileNodes = nodes.filter(n => n.type === 'file');
  return {
    fileCount:    fileNodes.length,
    totalLines,
    totalLOC,
    avgComplexity: fileNodes.length ? Math.round(totalComplexity / fileNodes.length) : 0,
    edgeCount:    edges.length,
    langCounts,
    issues:       allIssues,
    hotspots,
    avgLinesPerFile: fileNodes.length ? Math.round(totalLines / fileNodes.length) : 0,
  };
}

// ─── Zustand store ─────────────────────────────────────────────────────────
const useKgStore = create((set, get) => ({
  nodes:       [],
  edges:       [],
  stats:       null,
  building:    false,
  progress:    0,
  phase:       '',
  error:       null,
  lastBuilt:   null,
  projectRoot: null,

  // Load persisted graph from IndexedDB
  load: async () => {
    try {
      const data = await idbGet('graph');
      if (data) set({ nodes: data.nodes || [], edges: data.edges || [], stats: data.stats || null, lastBuilt: data.lastBuilt || null, projectRoot: data.projectRoot || null });
    } catch (e) { /* ignore */ }
  },

  clear: async () => {
    await idbClear();
    set({ nodes: [], edges: [], stats: null, lastBuilt: null, projectRoot: null });
  },

  // Full project analysis
  build: async (folder) => {
    if (!window.api) return;
    set({ building: true, progress: 0, phase: 'Reading project files…', error: null, nodes: [], edges: [], stats: null });

    try {
      // Read all project files
      const res = await window.api.readDirRecursive(folder, { content: true });
      const SKIP = ['/node_modules/', '/.git/', '/dist/', '/.next/', '/build/', '/__pycache__/', '/venv/', '/.venv/'];
      const files = (res.files || []).filter(f =>
        f.content != null && !SKIP.some(s => f.path.includes(s))
      );

      set({ progress: 8, phase: `Analysing ${files.length} source files…` });

      const nodes = [];
      const edgeMap = new Map();

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        try {
          const { node, edges } = analyzeFile(f.path, f.content || '', folder);
          nodes.push(node);
          for (const e of edges) edgeMap.set(e.id, e);
        } catch { /* skip unparseable file */ }

        if (i % 5 === 0) {
          const pct = 8 + Math.floor((i / files.length) * 60);
          set({ progress: pct, phase: `Analysing ${i + 1}/${files.length}: ${f.path.split('/').pop()}` });
        }
      }

      set({ progress: 70, phase: 'Resolving import targets…' });

      // Resolve bare import targets to actual file nodes
      const nodeIdSet = new Set(nodes.map(n => n.id));
      const resolvedEdges = [];
      for (const e of edgeMap.values()) {
        if (e.type !== 'imports') { resolvedEdges.push(e); continue; }
        // Try exact match, then with extensions
        const exts = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '/index.js', '/index.jsx', '/index.ts', '/index.tsx'];
        let found = false;
        for (const ext of exts) {
          const candidate = e.target + ext;
          if (nodeIdSet.has(candidate)) {
            resolvedEdges.push({ ...e, target: candidate });
            found = true; break;
          }
        }
        // Also try prefix matching
        if (!found) {
          const prefix = e.target + '.';
          const match = nodes.find(n => n.id.startsWith(prefix) || n.id === e.target);
          if (match) resolvedEdges.push({ ...e, target: match.id });
          // else: drop unresolved (external or missing)
        }
      }

      set({ progress: 78, phase: 'Detecting circular dependencies…' });

      // Add external package nodes
      const pkgMap = new Map();
      for (const e of edgeMap.values()) {
        if (e.target.startsWith('pkg:')) {
          const pkg = e.target.slice(4);
          if (!pkgMap.has(pkg)) pkgMap.set(pkg, {
            id: e.target, type: 'package', name: pkg, language: 'external',
            lineCount: 0, size: 0, imports: [], exports: [], functions: [],
            components: [], hooks: [], classes: [], issues: [], complexity: 0,
            relativePath: e.target,
          });
        }
      }
      const allNodes = [...nodes, ...pkgMap.values()];

      // All edges including package refs
      const allEdges = [...resolvedEdges, ...[...edgeMap.values()].filter(e => e.target.startsWith('pkg:'))];

      // Detect cycles
      const cycles = detectCycles(allNodes, allEdges);
      for (const cycle of cycles) {
        for (const id of cycle) {
          const n = allNodes.find(x => x.id === id);
          if (n && !n.issues?.find(i => i.message.includes('Circular'))) {
            (n.issues = n.issues || []).push({ severity: 'high', message: `Circular dependency: …→ ${cycle.slice(-2).join(' → ')}`, count: 1 });
          }
        }
      }

      set({ progress: 88, phase: 'Computing architecture stats…' });
      const stats = computeStats(allNodes, allEdges);

      set({ progress: 96, phase: 'Persisting to IndexedDB…' });
      const payload = { nodes: allNodes, edges: allEdges, stats, lastBuilt: Date.now(), projectRoot: folder };
      await idbPut('graph', payload);

      set({ ...payload, building: false, progress: 100, phase: `Done — ${allNodes.length} nodes, ${allEdges.length} edges` });
    } catch (err) {
      console.error('[KG] build error:', err);
      set({ building: false, progress: 0, error: err.message, phase: 'Error during analysis' });
    }
  },
}));

export default useKgStore;
