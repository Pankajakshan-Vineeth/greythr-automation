// preload.js — Bridges the renderer to the main process via contextBridge.
// All access to OS state (filesystem, keychain, child processes) is mediated
// through ipcRenderer.invoke. The renderer cannot reach Node directly.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gta', {
  // State + settings
  getState:           ()                  => ipcRenderer.invoke('gta:get-state'),
  saveSettings:       (patch)             => ipcRenderer.invoke('gta:save-settings', patch),
  toggleAutomation:   (on)                => ipcRenderer.invoke('gta:toggle-automation', on),

  // Credentials
  setCredentials:     (username, password) => ipcRenderer.invoke('gta:set-credentials', username, password),
  clearCredentials:   ()                  => ipcRenderer.invoke('gta:clear-credentials'),

  // Runs
  runNow:             (action)            => ipcRenderer.invoke('gta:run-now', action),
  testLogin:          ()                  => ipcRenderer.invoke('gta:test-login'),

  // Holidays
  addHoliday:         (date, label)       => ipcRenderer.invoke('gta:add-holiday', date, label),
  removeHoliday:      (date)              => ipcRenderer.invoke('gta:remove-holiday', date),

  // Pause
  pauseToday:         ()                  => ipcRenderer.invoke('gta:pause-today'),
  pauseSession:       ()                  => ipcRenderer.invoke('gta:pause-session'),
  pauseUntil:         (date)              => ipcRenderer.invoke('gta:pause-until', date),
  clearPause:         ()                  => ipcRenderer.invoke('gta:clear-pause'),

  // Wizard / reset
  completeWizard:     ()                  => ipcRenderer.invoke('gta:complete-wizard'),
  resetAll:           ()                  => ipcRenderer.invoke('gta:reset-all'),

  // Subscriptions
  onAgentLog:         (cb) => {
    const listener = (_evt, entry) => cb(entry);
    ipcRenderer.on('gta:agent-log', listener);
    return () => ipcRenderer.removeListener('gta:agent-log', listener);
  },
  onStateChange:      (cb) => {
    const listener = () => cb();
    ipcRenderer.on('gta:state-change', listener);
    return () => ipcRenderer.removeListener('gta:state-change', listener);
  }
});
