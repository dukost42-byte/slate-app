'use strict';
// Реальный каталог. Сейчас один настоящий плагин — Motion Panel (CEP-расширение для AE).
// owned/версии/список позже придут с бэкенда (entitlements). Никаких выдуманных позиций.
//
// kind: 'cep'    — CEP-расширение, ставится распаковкой в общую папку CEP/extensions
//       'script' — одиночный .jsx в ScriptUI Panels (на будущее)
// extensionFolder — имя папки внутри CEP/extensions (как в zip и в manifest)
// file — имя артефакта в хранилище
// version — берётся из ExtensionBundleVersion в CSXS/manifest.xml плагина

const CATALOG = [
  {
    id: 'motionpanel',
    name: 'Motion Panel',
    hosts: ['ae'],
    owned: true,
    kind: 'cep',
    bundleId: 'com.motionpanel.base',
    extensionFolder: 'AEMotionPanel',
    file: 'AEMotionPanel.zip',
    version: '0.1.0',
    supportUntil: '27.04.2027',
    desc: 'Панель моушн-инструментов: пресеты, редактор кривых изинга, color picker'
  },
  {
    id: 'sfxlibrary',
    name: 'MF Library',
    hosts: ['pr'],
    owned: true,
    kind: 'cep',
    bundleId: 'com.sfxlibrary.panel',
    extensionFolder: 'com.sfxlibrary.panel',
    file: 'MFLibrary.zip',
    version: '0.1.0',
    supportUntil: '27.04.2027',
    desc: 'Панель библиотеки звуков и эффектов для Premiere Pro'
  }
];

function getCatalog() {
  return CATALOG.map((s) => Object.assign({}, s));
}

module.exports = { getCatalog };
