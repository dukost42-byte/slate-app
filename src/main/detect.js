'use strict';
// Поиск установленных Adobe-хостов + папок установки (ScriptUI и общая CEP/extensions).
const fs = require('fs');
const path = require('path');
const os = require('os');

function listDir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return []; }
}

// Общая (per-user) папка CEP-расширений — одна на все Adobe-приложения.
function cepExtensionsDir() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Adobe', 'CEP', 'extensions');
  }
  return '';
}

function detectMac() {
  const hosts = [];
  const appsDir = '/Applications';
  const cep = cepExtensionsDir();
  for (const ent of listDir(appsDir)) {
    if (!ent.isDirectory()) continue;
    let m;
    if ((m = ent.name.match(/^Adobe After Effects (.+)$/))) {
      const base = path.join(appsDir, ent.name);
      hosts.push({
        id: 'ae-' + m[1], code: 'ae', name: 'After Effects', version: m[1], demo: false,
        scriptsPath: path.join(base, 'Scripts', 'ScriptUI Panels'),
        cepPath: cep
      });
    } else if ((m = ent.name.match(/^Adobe Premiere Pro (.+)$/))) {
      hosts.push({
        id: 'pr-' + m[1], code: 'pr', name: 'Premiere Pro', version: m[1], demo: false,
        scriptsPath: path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'UXP', 'PluginsStorage'),
        cepPath: cep
      });
    }
  }
  return hosts;
}

function detectWin() {
  const hosts = [];
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const adobeDir = path.join(programFiles, 'Adobe');
  const cep = cepExtensionsDir();
  for (const ent of listDir(adobeDir)) {
    if (!ent.isDirectory()) continue;
    let m;
    if ((m = ent.name.match(/^Adobe After Effects (.+)$/))) {
      const base = path.join(adobeDir, ent.name);
      hosts.push({
        id: 'ae-' + m[1], code: 'ae', name: 'After Effects', version: m[1], demo: false,
        scriptsPath: path.join(base, 'Support Files', 'Scripts', 'ScriptUI Panels'),
        cepPath: cep
      });
    } else if ((m = ent.name.match(/^Adobe Premiere Pro (.+)$/))) {
      hosts.push({
        id: 'pr-' + m[1], code: 'pr', name: 'Premiere Pro', version: m[1], demo: false,
        scriptsPath: path.join(process.env['APPDATA'] || '', 'Adobe', 'UXP', 'PluginsStorage'),
        cepPath: cep
      });
    }
  }
  return hosts;
}

function detectHosts() {
  let hosts = [];
  if (process.platform === 'darwin') hosts = detectMac();
  else if (process.platform === 'win32') hosts = detectWin();

  if (hosts.length === 0) {
    hosts = [
      { id: 'ae-demo', code: 'ae', name: 'After Effects', version: '2025', demo: true, scriptsPath: 'демо-режим', cepPath: 'демо-режим' },
      { id: 'pr-demo', code: 'pr', name: 'Premiere Pro', version: '2026', demo: true, scriptsPath: 'демо-режим', cepPath: 'демо-режим' }
    ];
  }
  hosts.sort((a, b) => String(b.version).localeCompare(String(a.version)));
  return hosts;
}

module.exports = { detectHosts, cepExtensionsDir };
