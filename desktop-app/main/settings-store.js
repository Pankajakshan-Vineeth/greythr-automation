// settings-store.js — Persists app settings, holidays, history, lifecycle
// events to a JSON file inside Electron's userData directory.
// Schema mirrors the extension's chrome.storage.local layout where it makes
// sense, so the agent-flat workflows see the same shape.

const fs = require('fs');
const path = require('path');

const HISTORY_LIMIT = 30;
const LIFECYCLE_LIMIT = 200;

const DEFAULT_SETTINGS = {
  enabled: false,
  signInTime: '09:30',
  signOutTime: '18:30',
  // Sun=0..Sat=6. Default Mon-Fri.
  days: [false, true, true, true, true, true, false],
  jitterMinutes: 4,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
  skipIfDone: true,
  retryAttempts: 2,
  notifyOnSuccess: false,
  notifyOnFailure: true,
  launchOnLogin: true,
  closeToTray: true,
  // openMinimized: when true, the automation browser launches minimized to
  // the taskbar so it doesn't grab focus. Default true — visible-but-quiet
  // is the right behaviour for non-technical users. Click the taskbar icon
  // to watch the run if needed.
  openMinimized: true
};

class SettingsStore {
  constructor(userDataDir) {
    this.userDataDir = userDataDir;
    this.configPath = path.join(userDataDir, 'config.json');
    this._cache = null;
    this._ensureDir();
    this._load();
  }

  _ensureDir() {
    try { fs.mkdirSync(this.userDataDir, { recursive: true }); } catch (_) {}
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.configPath, 'utf8');
      this._cache = JSON.parse(raw);
    } catch (err) {
      // First run, missing file, or corrupt — start clean.
      this._cache = {
        settings: { ...DEFAULT_SETTINGS },
        holidays: [],
        history: [],
        lifecycle: [],
        pause: { pauseUntil: null, pauseToday: null },
        installedAt: new Date().toISOString(),
        firstRunComplete: false
      };
      this._save();
    }
    // Ensure shape: merge defaults so a partial config from an older version
    // doesn't break things.
    this._cache.settings = { ...DEFAULT_SETTINGS, ...(this._cache.settings || {}) };
    this._cache.holidays = this._cache.holidays || [];
    this._cache.history  = this._cache.history  || [];
    this._cache.lifecycle = this._cache.lifecycle || [];
    this._cache.pause = this._cache.pause || { pauseUntil: null, pauseToday: null };
    if (!this._cache.installedAt) this._cache.installedAt = new Date().toISOString();
    if (typeof this._cache.firstRunComplete !== 'boolean') this._cache.firstRunComplete = false;
  }

  _save() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this._cache, null, 2), 'utf8');
    } catch (err) {
      console.error('[settings-store] save failed:', err.message);
    }
  }

  getAll() {
    return JSON.parse(JSON.stringify(this._cache));
  }

  getSettings() {
    return { ...this._cache.settings };
  }

  setSettings(patch) {
    this._cache.settings = { ...this._cache.settings, ...patch };
    this._save();
    return this.getSettings();
  }

  getHolidays() {
    return [...this._cache.holidays];
  }

  addHoliday(date, label) {
    this._cache.holidays.push({ date, label });
    this._cache.holidays.sort((a, b) => a.date.localeCompare(b.date));
    this._save();
    return this.getHolidays();
  }

  removeHoliday(date) {
    this._cache.holidays = this._cache.holidays.filter(h => h.date !== date);
    this._save();
    return this.getHolidays();
  }

  getHistory() {
    return [...this._cache.history];
  }

  appendHistory(entry) {
    this._cache.history.unshift(entry);
    if (this._cache.history.length > HISTORY_LIMIT) {
      this._cache.history.length = HISTORY_LIMIT;
    }
    this._save();
  }

  getPause() {
    return { ...this._cache.pause };
  }

  setPauseToday(date) {
    this._cache.pause.pauseToday = date;
    this._save();
  }

  setPauseUntil(date) {
    this._cache.pause.pauseUntil = date;
    this._save();
  }

  clearPause() {
    this._cache.pause = { pauseUntil: null, pauseToday: null };
    this._save();
  }

  appendLifecycle(event, detail) {
    this._cache.lifecycle.unshift({
      at: new Date().toISOString(),
      event,
      detail: detail || null
    });
    if (this._cache.lifecycle.length > LIFECYCLE_LIMIT) {
      this._cache.lifecycle.length = LIFECYCLE_LIMIT;
    }
    this._save();
  }

  getLifecycle() {
    return [...this._cache.lifecycle];
  }

  isFirstRun() {
    return !this._cache.firstRunComplete;
  }

  markFirstRunComplete() {
    this._cache.firstRunComplete = true;
    this._save();
  }

  reset() {
    this._cache = {
      settings: { ...DEFAULT_SETTINGS },
      holidays: [],
      history: [],
      lifecycle: [],
      pause: { pauseUntil: null, pauseToday: null },
      installedAt: this._cache.installedAt, // preserve install time across resets
      firstRunComplete: false
    };
    this._save();
  }

  // For diagnostics / sharing config with agent-flat via env var.
  getConfigPath() {
    return this.configPath;
  }
}

module.exports = { SettingsStore, DEFAULT_SETTINGS };
