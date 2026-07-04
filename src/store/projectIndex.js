// src/store/projectIndex.js — builds a searchable symbol index from all source files
import { create } from 'zustand';

// ─── Symbol extractors ─────────────────────────────────────────────────────
const RE = {
  js: [
    { re: /(?:export\s+default\s+)?(?:export\s+)?(?:async\s+)?function\s+\*?\s*(\w+)/g,           type: 'function' },
    { re: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g,          type: 'function' },
    { re: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/g,                 type: 'function' },
    { re: /(?:export\s+)?class\s+(\w+)/g,                                                           type: 'class'    },
    { re: /^\s{2,}(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/gm,                                         type: 'method'   },
    { re: /(?:const|let|var)\s+(\w+)\s*=\s*React\.(?:memo|forwardRef|createContext)/g,             type: 'component'},
    { re: /^export\s+default\s+function\s+(\w+)/gm,                                                type: 'component'},
  ],
  python: [
    { re: /^(?:async\s+)?def\s+(\w+)/gm,  type: 'function' },
    { re: /^class\s+(\w+)/gm,             type: 'class'    },
  ],
  rust: [
    { re: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g,  type: 'function' },
    { re: /(?:pub\s+)?struct\s+(\w+)/g,            type: 'struct'   },
    { re: /(?:pub\s+)?enum\s+(\w+)/g,              type: 'enum'     },
    { re: /(?:pub\s+)?trait\s+(\w+)/g,             type: 'trait'    },
  ],
  go: [
    { re: /^func\s+(?:\([^)]+\)\s+)?(\w+)/gm, type: 'function' },
    { re: /^type\s+(\w+)\s+struct/gm,          type: 'struct'   },
    { re: /^type\s+(\w+)\s+interface/gm,       type: 'interface'},
  ],
  java: [
    { re: /(?:public|private|protected)?\s+(?:static\s+)?(?:\w+)\s+(\w+)\s*\(/g, type: 'function' },
    { re: /class\s+(\w+)/g,                                                         type: 'class'    },
    { re: /interface\s+(\w+)/g,                                                     type: 'interface'},
  ],
};

const EXT_LANG = {
  js: 'js', jsx: 'js', ts: 'js', tsx: 'js', mjs: 'js', cjs: 'js',
  py: 'python', go: 'go', rs: 'rust', java: 'java',
};

function extractSymbols(content, ext) {
  const lang    = EXT_LANG[ext] || 'js';
  const pats    = RE[lang] || RE.js;
  const symbols = [];
  const lines   = content.split('\n');

  lines.forEach((line, lineIdx) => {
    for (const { re, type } of pats) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const name = m[1];
        if (name && name.length > 1 && !/^(if|for|while|switch|catch|return|import|export|new|delete|typeof|void|in|of)$/.test(name)) {
          symbols.push({ name, type, line: lineIdx + 1 });
        }
      }
    }
  });

  // Deduplicate (keep first occurrence)
  const seen = new Set();
  return symbols.filter(s => {
    const k = `${s.name}:${s.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'you', 'your', 'are', 'was',
  'were', 'how', 'what', 'where', 'when', 'show', 'tell', 'code', 'file', 'function',
  'method', 'class', 'component', 'please', 'about', 'does', 'work', 'works', 'use',
  'using', 'can', 'could', 'should', 'would', 'into', 'then', 'than', 'also', 'particular',
]);

function tokenize(text = '') {
  return (text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .match(/[a-z0-9_]{2,}/g) || [])
    .filter(word => !STOPWORDS.has(word));
}

function makeSnippet(content, centerLine = 1, radius = 7) {
  const lines = content.split('\n');
  const start = Math.max(1, centerLine - radius);
  const end = Math.min(lines.length, centerLine + radius);
  return {
    startLine: start,
    endLine: end,
    text: lines.slice(start - 1, end).join('\n'),
  };
}

function bestLineForTerms(content, terms) {
  const lines = content.split('\n');
  let best = { line: 1, score: 0 };
  lines.forEach((line, idx) => {
    const lineTokens = tokenize(line);
    const score = terms.reduce((sum, term) => {
      if (line.toLowerCase().includes(term)) return sum + 3;
      return sum + (lineTokens.includes(term) ? 1 : 0);
    }, 0);
    if (score > best.score) best = { line: idx + 1, score };
  });
  return best.line;
}

function scoreIndexedFile(file, query, terms) {
  const lowerPath = file.relativePath.toLowerCase();
  const fileName = lowerPath.split('/').pop();
  const tokenSet = new Set(file.tokens || []);
  let score = 0;
  const reasons = [];

  if (fileName === query) { score += 40; reasons.push('exact filename'); }
  else if (fileName.includes(query)) { score += 24; reasons.push('filename'); }
  else if (lowerPath.includes(query)) { score += 14; reasons.push('path'); }

  for (const symbol of file.symbols) {
    const symbolName = symbol.name.toLowerCase();
    if (symbolName === query) { score += 48; reasons.push(`${symbol.type} ${symbol.name}`); }
    else if (symbolName.includes(query)) { score += 28; reasons.push(`${symbol.type} ${symbol.name}`); }
    else if (terms.some(term => symbolName.includes(term))) { score += 16; reasons.push(`${symbol.type} ${symbol.name}`); }
  }

  for (const term of terms) {
    if (tokenSet.has(term)) score += 5;
    if (lowerPath.includes(term)) score += 3;
  }

  const queryWords = new Set(terms);
  const matchedTerms = (file.tokens || []).filter(token => queryWords.has(token)).length;
  if (matchedTerms > 1) score += matchedTerms * 2;

  return { score, reasons: [...new Set(reasons)].slice(0, 4) };
}

// ─── Store ─────────────────────────────────────────────────────────────────
const useProjectIndex = create((set, get) => ({
  index: {},       // { [relativePath]: { path, relativePath, ext, symbols, lineCount } }
  files: [],       // flat list of all indexed files
  indexing: false,
  indexedAt: null,
  indexedFolder: null,
  error: null,

  buildIndex: async (folder) => {
    if (!window.api || get().indexing) return;
    set({ indexing: true, error: null, indexedFolder: folder });
    try {
      const rawFiles = await window.api.readDirRecursive(folder, {
        maxDepth: 8,
        maxFiles: 800,
        includeContent: true,
        codeOnly: true,
      });

      const index = {};
      const files = [];

      for (const file of rawFiles) {
        const symbols = file.content ? extractSymbols(file.content, file.ext) : [];
        const tokenSource = [
          file.relativePath,
          symbols.map(symbol => symbol.name).join(' '),
          file.content?.slice(0, 160000) || '',
        ].join('\n');
        const entry = {
          path:         file.path,
          relativePath: file.relativePath,
          ext:          file.ext,
          symbols,
          lineCount:    file.content ? file.content.split('\n').length : 0,
          content:      file.content || '',
          tokens:       [...new Set(tokenize(tokenSource))],
        };
        index[file.relativePath] = entry;
        files.push(entry);
      }

      set({ index, files, indexing: false, indexedAt: Date.now(), indexedFolder: folder });
    } catch (err) {
      set({ indexing: false, error: err.message });
    }
  },

  // ── Search ────────────────────────────────────────────────────────────
  search: (query) => {
    return get().semanticSearch(query).slice(0, 30);
  },

  semanticSearch: (query, limit = 30) => {
    if (!query.trim()) return [];
    const { files } = get();
    const q = query.toLowerCase().trim();
    const terms = tokenize(query);
    const results = [];

    for (const f of files) {
      const fileScore = scoreIndexedFile(f, q, terms);
      for (const sym of f.symbols) {
        const symL = sym.name.toLowerCase();
        const termHit = terms.some(term => symL.includes(term));
        if (symL.includes(q) || q.includes(symL.slice(0, Math.max(3, q.length))) || termHit) {
          const snippet = makeSnippet(f.content, sym.line);
          results.push({
            kind:         'symbol',
            name:         sym.name,
            symbolType:   sym.type,
            path:         f.path,
            relativePath: f.relativePath,
            line:         sym.line,
            snippet,
            reason:       `${sym.type} match`,
            score:        fileScore.score + (symL === q ? 60 : symL.startsWith(q) ? 42 : 26),
          });
        }
      }

      if (fileScore.score > 0) {
        const line = bestLineForTerms(f.content, terms);
        results.push({
          kind: 'file',
          path: f.path,
          relativePath: f.relativePath,
          line,
          snippet: makeSnippet(f.content, line),
          reason: fileScore.reasons.join(', ') || 'content match',
          score: fileScore.score,
        });
      }
    }

    const seen = new Set();
    return results
      .sort((a, b) => b.score - a.score)
      .filter(result => {
        const key = `${result.kind}:${result.path}:${result.line || 1}:${result.name || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  },

  // ── AI context summary ────────────────────────────────────────────────
  getSummary: () => {
    const { files } = get();
    if (files.length === 0) return '';
    const byExt = {};
    for (const f of files) { byExt[f.ext] = (byExt[f.ext] || 0) + 1; }
    const extSummary = Object.entries(byExt).map(([k, v]) => `${v} .${k}`).join(', ');
    const lines = [`Project: ${files.length} files (${extSummary})`];
    for (const f of files.slice(0, 60)) {
      const syms = f.symbols.slice(0, 6).map(s => s.name).join(', ');
      if (syms) lines.push(`  ${f.relativePath}: ${syms}`);
    }
    if (files.length > 60) lines.push(`  …${files.length - 60} more files`);
    return lines.join('\n');
  },

  getSymbolByName: (name) => {
    const q = name.toLowerCase().trim();
    if (!q) return null;
    for (const file of get().files) {
      const found = file.symbols.find(symbol => symbol.name.toLowerCase() === q);
      if (found) return { ...found, path: file.path, relativePath: file.relativePath, content: file.content };
    }
    return null;
  },

  getProjectTree: () => {
    const { files } = get();
    return files
      .slice(0, 200)
      .map(file => {
        const symbols = file.symbols.slice(0, 8).map(symbol => `${symbol.type}:${symbol.name}`).join(', ');
        return `${file.relativePath}${symbols ? ` => ${symbols}` : ''}`;
      })
      .join('\n');
  },

  // Get content of most relevant files for a query
  getContextForQuery: async (query) => {
    const results = get().semanticSearch(query, 8);
    const seen = new Set();
    const paths = [];
    for (const r of results) {
      if (!seen.has(r.path)) { seen.add(r.path); paths.push(r.path); }
      if (paths.length >= 4) break;
    }

    const contexts = [];
    for (const fp of paths) {
      const f = Object.values(get().index).find(x => x.path === fp);
      if (f?.content) {
        const hit = results.find(result => result.path === fp);
        const line = hit?.line || 1;
        const snippet = makeSnippet(f.content, line, 32);
        contexts.push(`// File: ${f.relativePath}\n// Lines ${snippet.startLine}-${snippet.endLine}\n${snippet.text}`);
      }
    }
    return contexts.join('\n\n---\n\n');
  },
}));

export default useProjectIndex;
