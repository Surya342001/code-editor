// src/store/ragStore.js — Offline RAG with Ollama embeddings (nomic-embed-text)
// Replaces keyword search with true semantic similarity when nomic-embed-text is available.
import { create } from 'zustand';

const OLLAMA = 'http://localhost:11434';
const EMBED_MODEL = 'nomic-embed-text';
const MAX_CHUNK_LINES = 60;
const OVERLAP_LINES   = 5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Cosine similarity between two float arrays */
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA  += a[i] * a[i];
    nB  += b[i] * b[i];
  }
  const denom = Math.sqrt(nA) * Math.sqrt(nB);
  return denom === 0 ? 0 : dot / denom;
}

/** Split code into semantic chunks respecting function/class boundaries */
function smartChunk(content, relativePath) {
  const lines = content.split('\n');
  const chunks = [];

  // Detect function/class boundaries for JS/TS/Python/Rust/Go
  const BOUNDARY = /^(?:(?:export\s+)?(?:default\s+)?(?:async\s+)?function[\s*]+\w|(?:export\s+)?(?:abstract\s+)?class\s+\w|def\s+\w|async\s+def\s+\w|(?:pub\s+)?(?:async\s+)?fn\s+\w|func\s+\w|(?:public|private|protected|static)\s+\w)/;

  let start = 0;
  while (start < lines.length) {
    let end = Math.min(start + MAX_CHUNK_LINES, lines.length);

    // Extend to next natural boundary (up to 20 extra lines)
    if (end < lines.length) {
      for (let i = end; i < Math.min(end + 20, lines.length); i++) {
        if (BOUNDARY.test(lines[i]?.trimStart() ?? '')) { end = i; break; }
      }
    }

    const text = lines.slice(start, end).join('\n').trim();
    if (text.length > 40) {
      chunks.push({
        relativePath,
        lineStart: start + 1,
        lineEnd: end,
        text: `// ${relativePath}\n${text}`,
        embedding: null,
      });
    }
    // Overlap: step back a few lines so context isn't lost at boundaries
    start = end - OVERLAP_LINES;
    if (start <= 0 || start >= lines.length) break;
  }

  // Fallback for tiny files
  if (chunks.length === 0 && content.trim().length > 10) {
    chunks.push({ relativePath, lineStart: 1, lineEnd: lines.length, text: `// ${relativePath}\n${content}`, embedding: null });
  }
  return chunks;
}

/** Get embedding vector from Ollama (supports both /api/embed and /api/embeddings) */
async function embed(text) {
  // Ollama ≥ 0.5: /api/embed with { input }
  try {
    const r = await fetch(`${OLLAMA}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ model: EMBED_MODEL, input: text }),
    });
    if (r.ok) {
      const d = await r.json();
      if (d.embeddings?.[0]) return d.embeddings[0];
    }
  } catch { /* try legacy */ }

  // Legacy /api/embeddings with { prompt }
  const r2 = await fetch(`${OLLAMA}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!r2.ok) throw new Error(`Embedding failed: ${r2.status}`);
  const d2 = await r2.json();
  if (!d2.embedding) throw new Error('Empty embedding response');
  return d2.embedding;
}

/** Check if nomic-embed-text is available in Ollama */
async function checkEmbedModel() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return false;
    const d = await r.json();
    return (d.models || []).some(m => m.name?.includes('nomic-embed-text'));
  } catch { return false; }
}

// ─── Store ────────────────────────────────────────────────────────────────────

const useRagStore = create((set, get) => ({
  chunks: [],           // All indexed chunks with embeddings
  indexedFolder: null,  // Which folder these chunks belong to
  building: false,
  progress: 0,          // 0–100
  total: 0,
  done: 0,
  error: null,
  embedModelAvailable: false,

  /** Check whether nomic-embed-text is installed */
  checkModel: async () => {
    const ok = await checkEmbedModel();
    set({ embedModelAvailable: ok });
    return ok;
  },

  /** Build RAG index from project files.
   *  files: [{ relativePath, content }] — same shape readDirRecursive returns
   */
  buildIndex: async (files, folder) => {
    if (get().building) return;
    set({ building: true, progress: 0, done: 0, error: null, chunks: [] });

    const available = await checkEmbedModel();
    set({ embedModelAvailable: available });

    if (!available) {
      set({ building: false, error: 'nomic-embed-text not found. Run: ollama pull nomic-embed-text' });
      return;
    }

    // Build all chunks first
    const allChunks = [];
    for (const f of files) {
      if (!f.content) continue;
      allChunks.push(...smartChunk(f.content, f.relativePath));
    }

    set({ total: allChunks.length });
    let done = 0;

    // Embed in small batches to avoid overwhelming Ollama
    const BATCH = 5;
    const embedded = [];
    for (let i = 0; i < allChunks.length; i += BATCH) {
      const batch = allChunks.slice(i, i + BATCH);
      await Promise.all(batch.map(async (chunk) => {
        try {
          chunk.embedding = await embed(chunk.text.slice(0, 2000)); // cap input length
        } catch {
          chunk.embedding = null; // partial failure — skip this chunk
        }
      }));
      embedded.push(...batch);
      done += batch.length;
      set({ done, progress: Math.round((done / allChunks.length) * 100) });
    }

    const goodChunks = embedded.filter(c => c.embedding);
    set({ chunks: goodChunks, indexedFolder: folder, building: false, progress: 100 });
  },

  /** Semantic search: returns top-k most relevant chunks */
  search: async (query, limit = 6) => {
    const { chunks, embedModelAvailable } = get();
    if (!embedModelAvailable || chunks.length === 0) return [];

    let queryVec;
    try { queryVec = await embed(query); }
    catch { return []; }

    const scored = chunks
      .filter(c => c.embedding)
      .map(c => ({ ...c, score: cosine(queryVec, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  },

  /** Get rich context for AI prompts — returns formatted string of top chunks */
  getContext: async (query, limit = 5) => {
    const results = await get().search(query, limit);
    if (results.length === 0) return '';
    return results
      .map(r => `// ${r.relativePath} (lines ${r.lineStart}-${r.lineEnd})\n${r.text.split('\n').slice(1).join('\n')}`)
      .join('\n\n---\n\n');
  },

  clearIndex: () => set({ chunks: [], indexedFolder: null, progress: 0, done: 0, total: 0 }),
}));

export default useRagStore;
