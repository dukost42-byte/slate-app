'use strict';
// Манифест релизов — контракт «последняя версия + URL + sha256» по каждому плагину.
//
// local:  строится из встроенных файлов (sha256 считается на месте) — офлайн-разработка.
// remote: GET manifest.json по HTTP (GitHub raw / Pages / любой HTTPS).
//
// В ПРОДЕ этот же манифест начнёт отдавать твой бэкенд (GET /releases/latest) с проверкой
// лицензии и короткоживущим ПОДПИСАННЫМ url. Схема ответа — та же, клиент не меняется.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { httpGetJson } = require('./download');

function hashFile(p) {
  const buf = fs.readFileSync(p);
  return { sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length };
}

function localManifest(ctx) {
  const plugins = {};
  ctx.catalog.forEach((s) => {
    const file = s.file || (s.id + '.jsx');
    let sha256 = null, size = 0;
    try { const r = hashFile(path.join(ctx.scriptsDir, file)); sha256 = r.sha256; size = r.size; }
    catch (e) { /* нет файла — установка вернёт ошибку */ }
    plugins[s.id] = {
      name: s.name,
      host: s.hosts && s.hosts[0],
      kind: s.kind,
      extensionFolder: s.extensionFolder,
      latest: {
        version: s.version,
        file: file,
        url: ctx.baseUrl + '/' + encodeURIComponent(file),
        sha256: sha256,
        size: size
      }
    };
  });
  return { source: 'local', generatedAt: new Date().toISOString(), plugins: plugins };
}

async function getManifest(ctx) {
  if (config.RELEASE_SOURCE === 'remote') {
    if (!config.REMOTE_MANIFEST_URL || config.REMOTE_MANIFEST_URL.indexOf('<owner>') !== -1) {
      throw new Error('REMOTE_MANIFEST_URL не задан — впиши URL манифеста в src/main/config.js');
    }
    const m = await httpGetJson(config.REMOTE_MANIFEST_URL);
    m.source = 'remote';
    return m;
  }
  return localManifest(ctx);
}

module.exports = { getManifest };
