// main.js — Electron main process entry, Stage 3.
//
// Wires together: settings store, credential store, agent bridge, IPC
// handlers, tray icon, launch-on-login. Handles single-instance, close-to-
// tray, and clean shutdown.

const { app, BrowserWindow, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

const { SettingsStore } = require('./settings-store');
const { CredentialStore } = require('./credentials');
const { AgentBridge } = require('./agent-bridge');
const { AppTray } = require('./tray');
const { registerIpc } = require('./ipc');
const { setLaunchOnLogin, getLaunchOnLogin } = require('./auto-launch');

// ─── Single instance ──────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootApp();
}

function bootApp() {

let mainWindow = null;
let tray = null;
let settingsStore = null;
let credentialStore = null;
let agentBridge = null;
let isQuitting = false;

// ─── Resolve agent-flat path ──────────────────────────────────────
function resolveAgentFlatPath() {
  // In packaged builds, electron-builder copies agent-flat into
  // process.resourcesPath/agent-flat (see package.json -> build.extraResources).
  // In `npm start` development, look for ../agent-flat relative to this file.
  const packaged = path.join(process.resourcesPath, 'agent-flat');
  const dev = path.join(__dirname, '..', '..', 'agent-flat');
  if (fs.existsSync(packaged)) return packaged;
  if (fs.existsSync(dev)) return dev;
  console.warn('[main] agent-flat not found in either packaged or dev location.');
  console.warn('[main]   tried:', packaged);
  console.warn('[main]   tried:', dev);
  return dev;
}

// ─── Window creation ──────────────────────────────────────────────
function createMainWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    title: 'GreytHR Automation',
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    const settings = settingsStore.getSettings();
    if (!isQuitting && settings.closeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function getIconPath() {
  if (process.platform === 'win32') return path.join(__dirname, '..', 'icons', 'icon.ico');
  if (process.platform === 'darwin') return path.join(__dirname, '..', 'icons', 'icon.icns');
  return path.join(__dirname, '..', 'icons', 'icon.png');
}

// ─── Boot ─────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  console.log('[main] userData:', userData);

  settingsStore = new SettingsStore(userData);
  credentialStore = new CredentialStore();

  const agentFlatPath = resolveAgentFlatPath();
  console.log('[main] agent-flat:', agentFlatPath);

  agentBridge = new AgentBridge({
    settingsStore,
    credentialStore,
    agentFlatPath
  });
  agentBridge.on('log', (entry) => {
    // Forward to renderer if it's listening.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gta:agent-log', entry);
    }
  });
  agentBridge.on('state-change', () => {
    if (tray) tray.update();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gta:state-change');
    }
  });
  agentBridge.on('notify', ({ title, message }) => {
    try {
      new Notification({ title, body: message }).show();
    } catch (err) {
      console.warn('[main] notification failed:', err.message);
    }
  });
  agentBridge.start();

  registerIpc({
    settingsStore,
    credentialStore,
    agentBridge,
    setLaunchOnLogin,
    getLaunchOnLogin
  });

  createMainWindow();

  // Tray.
  tray = new AppTray({
    getMainWindow: () => mainWindow,
    agentBridge,
    settingsStore,
    onQuit: () => {
      isQuitting = true;
      app.quit();
    }
  });
  tray.start();

  app.on('activate', () => {
    // macOS: clicking dock icon with no windows reopens the main window.
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

// Second-instance: focus existing window instead of opening a new one.
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow();
  }
});

app.on('window-all-closed', () => {
  // We don't quit on window-close — tray keeps the app alive. Quit happens
  // explicitly via the tray's Quit menu item, which sets isQuitting=true.
});

app.on('before-quit', () => {
  isQuitting = true;
  if (agentBridge) agentBridge.stop();
  if (tray) tray.destroy();
});

} // end bootApp
