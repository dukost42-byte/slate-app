'use strict';
// Источник релизов.
//   'remote' — брать manifest.json по HTTP с GitHub. Так сейчас и настроено.
//   'local'  — собирать из встроенных файлов (офлайн-разработка).
//
// Переопределить без правки файла можно через переменные окружения, например:
//   SLATE_RELEASE_SOURCE=local npm start
module.exports = {
  RELEASE_SOURCE: process.env.SLATE_RELEASE_SOURCE || 'remote',

  REMOTE_MANIFEST_URL:
    process.env.SLATE_MANIFEST_URL ||
    'https://raw.githubusercontent.com/dukost42-byte/slate-releases/main/manifest.json',

  // Сервер лицензий (аккаунты, привязка устройств, проверка лицензии).
  BACKEND_URL: process.env.SLATE_BACKEND_URL || 'https://api.saucedistributionteam.com'
};
