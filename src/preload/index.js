'use strict';
// Единственный мост между renderer и main. Renderer не имеет прямого доступа к Node.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getHosts: () => ipcRenderer.invoke('hosts:get'),
  getCatalog: () => ipcRenderer.invoke('catalog:get'),
  installScript: (scriptId, hostId) => ipcRenderer.invoke('script:install', { scriptId, hostId }),
  uninstallScript: (scriptId, hostId) => ipcRenderer.invoke('script:uninstall', { scriptId, hostId }),
  enableCepDebug: () => ipcRenderer.invoke('cep:enableDebug'),
  cepStatus: () => ipcRenderer.invoke('cep:status'),
  refreshReleases: () => ipcRenderer.invoke('releases:refresh'),
  releasesInfo: () => ipcRenderer.invoke('releases:info'),
  checkAppUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  onInstallProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('install:progress', handler);
    return () => ipcRenderer.removeListener('install:progress', handler);
  },
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  platform: process.platform
});
