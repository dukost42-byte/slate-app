'use strict';
// Локальное состояние «что установлено», переживает перезапуск.
const fs = require('fs');
const path = require('path');

let file = null;

function init(userDataDir) {
  file = path.join(userDataDir, 'installed.json');
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return {};
  }
}

function write(data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    /* noop */
  }
}

function markInstalled(id, version) {
  const data = read();
  data[id] = { version: version, at: Date.now() };
  write(data);
  return data;
}

function getInstalled() {
  return read();
}

function remove(id) {
  const data = read();
  if (data[id]) { delete data[id]; write(data); }
}

module.exports = { init, markInstalled, getInstalled, remove };
