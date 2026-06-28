'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { detectHosts, cepExtensionsDir } = require('./detect');
const { getCatalog } = require('./catalog');
const { startStorageServer } = require('./storage-server');
const { getManifest } = require('./releases');
const { downloadAndInstall } = require('./download');
const config = require('./config');
const store = require('./store');

let STORAGE_BASE = null; // loopback-хранилище для режима local
let RES_SCRIPTS = null;
let MANIFEST = null;     // текущий манифест релизов (local или remote)

function resourcesScriptsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'scripts')
    : path.join(app.getAppPath(), 'resources', 'scripts');
}

function readCepVersion(cepBase, folder) {
  try {
    const xml = fs.readFileSync(path.join(cepBase, folder, 'CSXS', 'manifest.xml'), 'utf8');
    const m = xml.match(/ExtensionBundleVersion="([^"]+)"/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

function cepBaseFor(hosts) {
  const demo = hosts.length && hosts[0].demo;
  return demo ? path.join(app.getPath('userData'), 'demo-install', 'cep') : cepExtensionsDir();
}

async function loadManifest() {
  try {
    if (config.RELEASE_SOURCE === 'remote') console.log('[releases] источник: remote →', config.REMOTE_MANIFEST_URL);
    else console.log('[releases] источник: local (встроенные файлы)');
    MANIFEST = await getManifest({ scriptsDir: RES_SCRIPTS, baseUrl: STORAGE_BASE, catalog: getCatalog() });
    return true;
  } catch (e) {
    console.warn('[releases] не удалось загрузить манифест:', e.message);
    MANIFEST = null; // remote-источник недоступен → установка вернёт понятную ошибку
    return false;
  }
}

function releaseFor(script) {
  if (!MANIFEST || !MANIFEST.plugins || !script) return null;
  // ключ манифеста — папка расширения (так генератор не знает внутренних id); откат на id
  const p = MANIFEST.plugins[script.extensionFolder] || MANIFEST.plugins[script.id];
  return p && p.latest;
}

function semverNewer(a, b) {
  // true, если a строго новее b
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function enableCepDebug() {
  return new Promise((resolve) => {
    const versions = [9, 10, 11, 12];
    let cmds = [];
    if (process.platform === 'darwin') {
      cmds = versions.map((v) => 'defaults write com.adobe.CSXS.' + v + ' PlayerDebugMode 1');
    } else if (process.platform === 'win32') {
      cmds = versions.map((v) => 'reg add "HKCU\\Software\\Adobe\\CSXS.' + v + '" /v PlayerDebugMode /t REG_SZ /d 1 /f');
    } else {
      return resolve({ ok: false, error: 'поддерживается только Windows и macOS' });
    }
    let done = 0, okCount = 0;
    cmds.forEach((c) => exec(c, (err) => {
      done++; if (!err) okCount++;
      if (done === cmds.length) resolve({ ok: okCount > 0, applied: okCount });
    }));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1040, height: 700, minWidth: 900, minHeight: 560,
    backgroundColor: '#15171C',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  store.init(app.getPath('userData'));
  RES_SCRIPTS = resourcesScriptsDir();

  // loopback-хранилище нужно только для режима local
  if (config.RELEASE_SOURCE !== 'remote') {
    try {
      const port = await startStorageServer(RES_SCRIPTS);
      STORAGE_BASE = 'http://127.0.0.1:' + port;
    } catch (e) { STORAGE_BASE = null; }
  }

  await loadManifest();

  ipcMain.handle('hosts:get', () => detectHosts());

  ipcMain.handle('catalog:get', () => {
    const hosts = detectHosts();
    const cepBase = cepBaseFor(hosts);
    const rec = store.getInstalled();
    return getCatalog().map((s) => {
      let installed = false, installedVersion = null;
      if (s.kind === 'cep' && s.extensionFolder) {
        // CEP: источник истины — диск (папка в CEP/extensions), без «липкой» записи store
        const v = readCepVersion(cepBase, s.extensionFolder);
        if (v) { installed = true; installedVersion = v; }
      } else if (rec[s.id]) {
        // не-CEP: пока определяем по записи store
        installed = true; installedVersion = rec[s.id].version;
      }
      const rel = releaseFor(s);
      const version = rel ? rel.version : s.version; // доступная версия из манифеста
      const notes = rel && rel.notes ? rel.notes : null;
      return Object.assign({}, s, { version: version, installed: installed, installedVersion: installedVersion, available: !!rel, notes: notes });
    });
  });

  ipcMain.handle('releases:refresh', async () => {
    const ok = await loadManifest();
    return { ok: ok, source: MANIFEST ? MANIFEST.source : null };
  });

  ipcMain.handle('releases:info', () => ({
    source: config.RELEASE_SOURCE === 'remote' ? 'remote' : 'local',
    url: config.RELEASE_SOURCE === 'remote' ? config.REMOTE_MANIFEST_URL : null
  }));

  ipcMain.handle('app:checkUpdate', async () => {
    await loadManifest();
    const current = app.getVersion();
    const a = MANIFEST && MANIFEST.app;
    const latest = a && a.version ? a.version : null;
    return {
      current: current,
      latest: latest,
      url: a && a.url ? a.url : null,
      hasUpdate: !!(latest && semverNewer(latest, current))
    };
  });

  ipcMain.handle('script:install', async (event, { scriptId, hostId }) => {
    const host = detectHosts().find((h) => h.id === hostId);
    const script = getCatalog().find((s) => s.id === scriptId);
    if (!host || !script) return { ok: false, error: 'host или script не найден' };
    if (!script.owned) return { ok: false, error: 'скрипт не приобретён' };

    // ЗАЩИТА (позже): здесь backend проверит лицензию/окно поддержки и вернёт
    // короткоживущий ПОДПИСАННЫЙ url. Сейчас url берём из манифеста релизов.
    const rel = releaseFor(script);
    if (!rel || !rel.url) return { ok: false, error: 'релиз не найден в манифесте (проверь источник релизов)' };
    console.log('[install] качаю артефакт:', rel.url);

    const kind = script.kind || 'script';
    let destDir;
    if (host.demo) {
      destDir = path.join(app.getPath('userData'), 'demo-install', kind === 'cep' ? 'cep' : 'scripts');
    } else {
      destDir = kind === 'cep' ? cepExtensionsDir() : host.scriptsPath;
    }

    try {
      const res = await downloadAndInstall(
        { version: rel.version, url: rel.url, sha256: rel.sha256, file: rel.file },
        destDir, kind,
        (p) => event.sender.send('install:progress', { scriptId: scriptId, percent: Math.round(p * 100) })
      );
      store.markInstalled(script.id, rel.version);
      return Object.assign({ ok: true, version: rel.version }, res);
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  ipcMain.handle('script:uninstall', (_e, { scriptId, hostId }) => {
    const host = detectHosts().find((h) => h.id === hostId);
    const script = getCatalog().find((s) => s.id === scriptId);
    if (!host || !script) return { ok: false, error: 'host или script не найден' };
    try {
      if (script.kind === 'cep' && script.extensionFolder) {
        const cepBase = host.demo ? path.join(app.getPath('userData'), 'demo-install', 'cep') : cepExtensionsDir();
        fs.rmSync(path.join(cepBase, script.extensionFolder), { recursive: true, force: true });
      } else if (script.file) {
        const base = host.demo ? path.join(app.getPath('userData'), 'demo-install', 'scripts') : host.scriptsPath;
        fs.rmSync(path.join(base, script.file), { force: true });
      }
      store.remove(scriptId);
      console.log('[uninstall] удалён:', scriptId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  ipcMain.handle('cep:enableDebug', () => enableCepDebug());
  ipcMain.handle('shell:open', (_e, url) => shell.openExternal(url));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((e) => { console.error(e); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
