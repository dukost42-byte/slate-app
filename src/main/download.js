'use strict';
// Сетевой слой: получить JSON-манифест и скачать артефакт с проверкой целостности.
// Пайплайн установки:
//   1) скачать по URL во временный файл (стримом, с прогрессом),
//   2) попутно посчитать SHA-256,
//   3) сверить с ожидаемым хешем,
//   4) атомарно установить (распаковать .zip или перенести файл).
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function pick(url) { return url.indexOf('https:') === 0 ? https : http; }

// GET JSON (с редиректами) — для manifest.json
function httpGetJson(url, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('слишком много редиректов'));
    const req = pick(url).get(url, { headers: { 'User-Agent': 'Slate', 'Accept': 'application/json' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(httpGetJson(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('манифест не является корректным JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('таймаут загрузки манифеста')));
  });
}

function fetchToFile(url, destFile, onProgress, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('слишком много редиректов'));
    console.log('[download] GET', url);
    const req = pick(url).get(url, { headers: { 'User-Agent': 'Slate' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        console.log('[download] редирект →', next);
        return resolve(fetchToFile(next, destFile, onProgress, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(destFile);
      res.on('data', (chunk) => {
        received += chunk.length;
        hash.update(chunk);
        if (onProgress && total) onProgress(received / total);
      });
      res.on('error', reject);
      out.on('error', reject);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve({ sha256: hash.digest('hex'), bytes: received })));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('таймаут загрузки')));
  });
}

function fileNameFromUrl(u) {
  try {
    const p = new URL(u).pathname;
    return decodeURIComponent(p.split('/').pop() || '') || null;
  } catch (e) { return null; }
}

function moveFile(src, dest) {
  try { fs.renameSync(src, dest); }
  catch (e) {
    if (e.code === 'EXDEV') { fs.copyFileSync(src, dest); fs.unlinkSync(src); }
    else throw e;
  }
}

function extractZip(file, dir) {
  let AdmZip;
  try { AdmZip = require('adm-zip'); }
  catch (e) { throw new Error('Для установки .zip нужен пакет adm-zip (npm install)'); }
  new AdmZip(file).extractAllTo(dir, true);
}

// release: { version, url, sha256, size?, file? }
async function downloadAndInstall(release, destDir, kind, onProgress) {
  const file = release.file || fileNameFromUrl(release.url) || 'artifact.bin';
  const tmpDir = path.join(os.tmpdir(), 'slate-dl');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, file + '.part');

  const { sha256 } = await fetchToFile(release.url, tmp, onProgress);

  if (release.sha256 && sha256.toLowerCase() !== String(release.sha256).toLowerCase()) {
    try { fs.unlinkSync(tmp); } catch (e) { /* noop */ }
    throw new Error('Контрольная сумма не совпала — файл повреждён или подменён');
  }
  if (onProgress) onProgress(1);

  fs.mkdirSync(destDir, { recursive: true });

  if (kind === 'cep' || file.toLowerCase().endsWith('.zip')) {
    extractZip(tmp, destDir); // распаковка папки расширения в CEP/extensions
    try { fs.unlinkSync(tmp); } catch (e) { /* noop */ }
    return { path: destDir, sha256: sha256 };
  }

  const dest = path.join(destDir, file);
  moveFile(tmp, dest);
  return { path: dest, sha256: sha256 };
}

module.exports = { httpGetJson, downloadAndInstall };
