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
  // аккаунт и лицензия
  authState: () => ipcRenderer.invoke('auth:state'),
  authSignup: (email, password, key) => ipcRenderer.invoke('auth:signup', { email, password, key }),
  authLogin: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
  authRedeem: (key) => ipcRenderer.invoke('auth:redeem', { key }),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  licenseEnsure: () => ipcRenderer.invoke('license:ensure'),
  licenseDevices: () => ipcRenderer.invoke('license:devices'),
  platform: process.platform
});
