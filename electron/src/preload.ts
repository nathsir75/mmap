import { contextBridge, ipcRenderer } from 'electron';

console.log('[Electron][Preload] loaded ✅');

contextBridge.exposeInMainWorld('mmReader', {
  ping: () => ipcRenderer.invoke('mm:ping'),
});