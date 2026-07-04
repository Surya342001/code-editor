# code-editor

Local Terminal is an AI-first desktop code editor built with Electron, React, Vite, Monaco Editor, xterm.js, and Ollama.

## Features

- Monaco-powered code editing with inline Ollama completions
- Project-wide indexing and semantic search
- AI assistant that can analyze, explain, navigate, and apply code edits
- Integrated terminal with automatic project run detection
- File explorer, tabs, command palette, and status bar

## Run Locally

```bash
bash start.sh
```

Or:

```bash
npm install
npm run dev
```

For AI features, run Ollama locally:

```bash
ollama serve
ollama pull codellama
```
