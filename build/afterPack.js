'use strict';
// Ad-hoc подпись приложения без сертификата.
// Нужна, чтобы неподписанная сборка запускалась на Apple Silicon
// (чип требует наличие хотя бы ad-hoc подписи). Запускается только на macOS.
const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, appName + '.app');
  console.log('[afterPack] ad-hoc подпись:', appPath);
  // --deep подписывает вложенные фреймворки/хелперы, -s - = ad-hoc (без сертификата)
  execSync('codesign --force --deep --sign - ' + JSON.stringify(appPath), { stdio: 'inherit' });
};
