// electron/preload.js — safe bridge between Electron main and React renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── File system ──────────────────────────────────────────────────────────
  readDir:    (p)        => ipcRenderer.invoke('fs:readDir', p),
  readFile:   (p)        => ipcRenderer.invoke('fs:readFile', p),
  writeFile:  (p, c)     => ipcRenderer.invoke('fs:writeFile', p, c),
  createFile: (p)        => ipcRenderer.invoke('fs:createFile', p),
  createDir:  (p)        => ipcRenderer.invoke('fs:createDir', p),
  deleteItem: (p)        => ipcRenderer.invoke('fs:delete', p),
  renameItem: (o, n)     => ipcRenderer.invoke('fs:rename', o, n),
  openFolder: ()         => ipcRenderer.invoke('fs:openFolder'),
  openFile:   ()         => ipcRenderer.invoke('fs:openFile'),
  readDirRecursive: (p, opts) => ipcRenderer.invoke('fs:readDirRecursive', p, opts),

  // ── Platform ─────────────────────────────────────────────────────────────
  platformInfo: () => ipcRenderer.invoke('platform:info'),

  // ── Run project ──────────────────────────────────────────────────────────
  runDetect: (dir) => ipcRenderer.invoke('run:detect', dir),

  // ── Terminal ─────────────────────────────────────────────────────────────
  termAvailable: ()              => ipcRenderer.invoke('terminal:available'),
  termCreate:    (id, c, r, cwd) => ipcRenderer.invoke('terminal:create', id, c, r, cwd),
  termWrite:     (id, data)      => ipcRenderer.invoke('terminal:write', id, data),
  termResize:    (id, c, r)      => ipcRenderer.invoke('terminal:resize', id, c, r),
  termKill:      (id)            => ipcRenderer.invoke('terminal:kill', id),

  onTermData: (id, cb) => {
    const ch = `term:data:${id}`;
    const fn = (_, d) => cb(d);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },
  onTermExit: (id, cb) => {
    const ch = `term:exit:${id}`;
    const fn = (_, c) => cb(c);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },

  // ── Git ──────────────────────────────────────────────────────────────────
  gitIsRepo:   (dir)          => ipcRenderer.invoke('git:isRepo',  dir),
  gitStatus:   (dir)          => ipcRenderer.invoke('git:status',  dir),
  gitDiff:     (dir, fp)      => ipcRenderer.invoke('git:diff',    dir, fp),
  gitLog:      (dir, n)       => ipcRenderer.invoke('git:log',     dir, n),
  gitStageAll: (dir)          => ipcRenderer.invoke('git:stageAll',dir),
  gitStage:    (dir, fp)      => ipcRenderer.invoke('git:stage',   dir, fp),
  gitUnstage:  (dir, fp)      => ipcRenderer.invoke('git:unstage', dir, fp),
  gitCommit:   (dir, msg)     => ipcRenderer.invoke('git:commit',  dir, msg),
  gitPush:     (dir)          => ipcRenderer.invoke('git:push',    dir),
  gitDiscard:  (dir, fp)      => ipcRenderer.invoke('git:discard', dir, fp),
});
