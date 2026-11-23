'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('medidorPanel', {
  read: () => ipcRenderer.invoke('panel:read'),
  act: (action) => ipcRenderer.invoke('panel:action', action),
  settingsRead: () => ipcRenderer.invoke('panel:settings-read'),
  settingsSave: (values) => ipcRenderer.invoke('panel:settings-save', values),
  onNavigate: (callback) => {
    if (typeof callback === 'function') ipcRenderer.on('panel:navigate', (_event, page) => callback(page));
  },
  onUpdate: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('panel:update', (_event, state) => callback(state));
  },
});
