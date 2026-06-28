#!/usr/bin/env node
'use strict';
// Считает sha256 и размер артефакта и печатает запись для manifest.json.
// Использование:
//   node tools/make-manifest.js <путь-к-zip> <публичный-url> [scriptId]
// Пример:
//   node tools/make-manifest.js resources/scripts/AEMotionPanel.zip \
//     https://raw.githubusercontent.com/me/slate-releases/main/plugins/AEMotionPanel.zip motionpanel
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const file = process.argv[2];
const url = process.argv[3];
const id = process.argv[4] || 'plugin-id';

if (!file || !url) {
  console.error('usage: node tools/make-manifest.js <zip> <url> [scriptId]');
  process.exit(1);
}

const buf = fs.readFileSync(file);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

const entry = {};
entry[id] = {
  latest: {
    version: 'X.Y.Z',
    file: path.basename(file),
    url: url,
    sha256: sha256,
    size: buf.length
  }
};

console.log('// вставь в manifest.json -> "plugins", и проставь version:');
console.log(JSON.stringify(entry, null, 2));
