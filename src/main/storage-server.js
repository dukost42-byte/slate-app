'use strict';
// Локальное «хранилище» для прототипа: раздаёт файлы из папки по HTTP на 127.0.0.1.
// В проде это место занимает ваш CDN / presigned-URL из S3 — код загрузчика не меняется.
const http = require('http');
const fs = require('fs');
const path = require('path');

function startStorageServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const name = decodeURIComponent((req.url || '').split('?')[0].replace(/^\/+/, ''));
      const file = path.join(rootDir, path.basename(name)); // basename — защита от path traversal
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, {
          'Content-Length': buf.length,
          'Content-Type': 'application/octet-stream'
        });
        res.end(buf);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

module.exports = { startStorageServer };
