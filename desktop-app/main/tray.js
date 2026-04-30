// tray.js — System tray icon with status, manual trigger, and quit.

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

class AppTray {
  constructor({ getMainWindow, agentBridge, settingsStore, onQuit }) {
    this.getMainWindow = getMainWindow;
    this.agentBridge = agentBridge;
    this.settingsStore = settingsStore;
    this.onQuit = onQuit;
    this.tray = null;
  }

  start() {
    const iconPath = this._iconPath();
    let icon;
    try {
      icon = nativeImage.createFromPath(iconPath);
      // macOS prefers smaller tray images.
      if (process.platform === 'darwin') {
        icon = icon.resize({ width: 16, height: 16 });
      }
    } catch (err) {
      console.error('[tray] icon load failed:', err.message);
      icon = nativeImage.createEmpty();
    }

    try {
      this.tray = new Tray(icon);
    } catch (err) {
      console.error('[tray] could not create Tray:', err.message);
      return;
    }
    this.tray.setToolTip('GreytHR Automation');
    this.update();

    // Click → show/hide window.
    this.tray.on('click', () => this._showWindow());

    // Refresh menu state every 30s in case the agent's running flag changed.
    setInterval(() => this.update(), 30_000);
  }

  _iconPath() {
    if (process.platform === 'win32') {
      return path.join(__dirname, '..', 'icons', 'icon.ico');
    }
    return path.join(__dirname, '..', 'icons', 'icon.png');
  }

  _showWindow() {
    const win = this.getMainWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  update() {
    if (!this.tray) return;
    const settings = this.settingsStore.getSettings();
    const running = this.agentBridge.isRunning();
    const stateLabel = running ? '● Running' : (settings.enabled ? '● Idle' : '○ Off');

    const nextSignIn = this.agentBridge.getNextRun('signin');
    const nextSignOut = this.agentBridge.getNextRun('signout');
    const nextLabel = (nextSignIn || nextSignOut)
      ? `Next: ${pickNextLabel(nextSignIn, nextSignOut)}`
      : 'No upcoming runs';

    const tpl = [
      { label: 'GreytHR Automation', enabled: false },
      { label: stateLabel, enabled: false },
      { label: nextLabel, enabled: false },
      { type: 'separator' },
      { label: 'Sign In now',  click: () => this.agentBridge.runOnce('signin', 'manual') },
      { label: 'Sign Out now', click: () => this.agentBridge.runOnce('signout', 'manual') },
      { type: 'separator' },
      { label: 'Open dashboard', click: () => this._showWindow() },
      { type: 'separator' },
      { label: 'Pause for today', click: () => {
          this.settingsStore.setPauseToday(todayDateString());
          this.update();
        }
      },
      { label: 'Clear pause', click: () => {
          this.settingsStore.clearPause();
          this.update();
        }
      },
      { type: 'separator' },
      { label: 'Quit', click: () => this.onQuit() }
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(tpl));
  }

  destroy() {
    if (this.tray) {
      try { this.tray.destroy(); } catch (_) {}
      this.tray = null;
    }
  }
}

function pickNextLabel(a, b) {
  const candidates = [a, b].filter(Boolean).map(t => new Date(t));
  if (!candidates.length) return '—';
  candidates.sort((x, y) => x - y);
  const next = candidates[0];
  return next.toLocaleString([], {
    weekday: 'short', hour: '2-digit', minute: '2-digit'
  });
}

function todayDateString() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

module.exports = { AppTray };
