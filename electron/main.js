// electron/main.js  — Main process
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const isDev = process.env.ELECTRON_IS_DEV === '1';
let mainWindow;
const ptyProcs = {};

// ─── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1440,
    height: 900,
    minWidth:  900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5199');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    Object.values(ptyProcs).forEach(p => { try { p.kill(); } catch (_) {} });
    mainWindow = null;
  });

  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });

// ─── IPC : File System ───────────────────────────────────────────────────────
ipcMain.handle('fs:readDir', async (_, dir) => {
  try {
    const ents = await fs.promises.readdir(dir, { withFileTypes: true });
    return {
      entries: ents
        .map(e => ({
          name: e.name,
          isDirectory: e.isDirectory(),
          path: path.join(dir, e.name),
          ext:  e.isFile() ? path.extname(e.name).slice(1) : null,
        }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
    };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fs:readFile', async (_, fp) => {
  try {
    const stat = await fs.promises.stat(fp);
    if (stat.size > 12 * 1024 * 1024) return { error: 'File too large (>12 MB)' };
    const content = await fs.promises.readFile(fp, 'utf-8');
    return { content, modified: stat.mtime };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fs:writeFile', async (_, fp, content) => {
  try { await fs.promises.writeFile(fp, content, 'utf-8'); return { ok: true }; }
  catch (err) { return { error: err.message }; }
});

ipcMain.handle('fs:createFile', async (_, fp) => {
  try { await fs.promises.writeFile(fp, ''); return { ok: true }; }
  catch (err) { return { error: err.message }; }
});

ipcMain.handle('fs:createDir', async (_, dp) => {
  try { await fs.promises.mkdir(dp, { recursive: true }); return { ok: true }; }
  catch (err) { return { error: err.message }; }
});

ipcMain.handle('fs:delete', async (_, fp) => {
  try {
    const st = await fs.promises.stat(fp);
    if (st.isDirectory()) await fs.promises.rm(fp, { recursive: true, force: true });
    else await fs.promises.unlink(fp);
    return { ok: true };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('fs:rename', async (_, oldP, newP) => {
  try { await fs.promises.rename(oldP, newP); return { ok: true }; }
  catch (err) { return { error: err.message }; }
});

ipcMain.handle('fs:openFolder', async () => {
  return dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Open Folder',
  });
});

ipcMain.handle('fs:openFile', async () => {
  return dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Open File(s)',
  });
});

ipcMain.handle('platform:info', () => ({
  platform: process.platform,
  homedir: os.homedir(),
  arch: os.arch(),
  version: app.getVersion(),
}));

// ─── IPC : Project (recursive scan + run detection) ─────────────────────────
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', 'coverage', '.cache', '.idea', '.vscode',
  'vendor', 'target', 'bin', 'obj', '.DS_Store', '.turbo',
  '.output', 'out', '.svelte-kit', '.nuxt',
]);
const CODE_EXTS = new Set(['js','jsx','ts','tsx','mjs','cjs','py','go','rs','java','c','cpp','h','cs','rb','php','swift','kt','dart','lua','r','sh','yaml','yml','json','toml','env','md']);

ipcMain.handle('fs:readDirRecursive', async (_, dir, opts = {}) => {
  const {
    maxDepth    = 8,
    maxFiles    = 800,
    includeContent  = false,
    maxFileSize = 300 * 1024, // 300 KB
    codeOnly    = true,
  } = opts;
  const results = [];

  async function walk(cur, depth) {
    if (depth > maxDepth || results.length >= maxFiles) return;
    let entries;
    try { entries = await fs.promises.readdir(cur, { withFileTypes: true }); }
    catch { return; }

    for (const e of entries) {
      if (IGNORE_DIRS.has(e.name)) continue;
      const fp = path.join(cur, e.name);
      if (e.isDirectory()) {
        await walk(fp, depth + 1);
      } else {
        const ext = path.extname(e.name).slice(1).toLowerCase();
        if (codeOnly && !CODE_EXTS.has(ext)) continue;
        const item = {
          name: e.name,
          path: fp,
          relativePath: path.relative(dir, fp),
          ext,
        };
        if (includeContent) {
          try {
            const stat = await fs.promises.stat(fp);
            if (stat.size <= maxFileSize) item.content = await fs.promises.readFile(fp, 'utf-8');
          } catch { /* skip */ }
        }
        results.push(item);
        if (results.length >= maxFiles) return;
      }
    }
  }
  await walk(dir, 0);
  return results;
});

ipcMain.handle('run:detect', async (_, dir) => {
  const exists = async (f) => { try { await fs.promises.access(path.join(dir, f)); return true; } catch { return false; } };
  const read   = async (f) => fs.promises.readFile(path.join(dir, f), 'utf-8');

  if (await exists('package.json')) {
    try {
      const pkg     = JSON.parse(await read('package.json'));
      const scripts = pkg.scripts || {};
      const best    = ['dev','start','serve','run'].find(k => scripts[k]);
      if (best) return { cmd: `npm run ${best}`, type: 'node', icon: '📦', desc: `npm run ${best}` };
    } catch { /* fall through */ }
    return { cmd: 'npm install && npm start', type: 'node', icon: '📦', desc: 'npm start' };
  }
  if (await exists('requirements.txt') || await exists('pyproject.toml')) {
    for (const f of ['main.py','app.py','server.py','run.py','manage.py']) {
      if (await exists(f)) {
        const cmd = f === 'manage.py' ? 'python manage.py runserver' : `python ${f}`;
        return { cmd, type: 'python', icon: '🐍', desc: cmd };
      }
    }
  }
  if (await exists('Cargo.toml')) return { cmd: 'cargo run', type: 'rust', icon: '🦀', desc: 'cargo run' };
  if (await exists('go.mod'))     return { cmd: 'go run .', type: 'go',   icon: '🐹', desc: 'go run .' };
  if (await exists('Makefile'))   return { cmd: 'make',     type: 'make', icon: '⚙️', desc: 'make' };
  if (await exists('main.py'))    return { cmd: 'python main.py', type: 'python', icon: '🐍', desc: 'python main.py' };
  if (await exists('index.js'))   return { cmd: 'node index.js',  type: 'node',   icon: '💛', desc: 'node index.js' };
  return null;
});

// ─── IPC : Terminal (node-pty) ───────────────────────────────────────────────
let pty, ptyOK = false;
try { pty = require('node-pty'); ptyOK = true; } catch (_) {}

ipcMain.handle('terminal:available', () => ptyOK);

ipcMain.handle('terminal:create', (_, id, cols, rows, cwd) => {
  if (!ptyOK) return { ok: false, error: 'node-pty unavailable — run: npm run postinstall' };
  try {
    const shell =
      process.platform === 'win32' ? 'powershell.exe' :
      process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');

    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: cwd || os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });

    proc.onData(data => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send(`term:data:${id}`, data);
    });
    proc.onExit(({ exitCode }) => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send(`term:exit:${id}`, exitCode);
      delete ptyProcs[id];
    });

    ptyProcs[id] = proc;
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('terminal:write',  (_, id, data)       => { ptyProcs[id]?.write(data); });
ipcMain.handle('terminal:resize', (_, id, cols, rows)  => { ptyProcs[id]?.resize(cols, rows); });
ipcMain.handle('terminal:kill',   (_, id)              => { ptyProcs[id]?.kill(); delete ptyProcs[id]; });
