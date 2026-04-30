// ipc.js — Wires up renderer ↔ main IPC. Mirrors the mock API surface in
// renderer/app.js. Each handler returns a promise the renderer awaits.

const { ipcMain } = require('electron');

function todayDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function registerIpc({
  settingsStore, credentialStore, agentBridge,
  setLaunchOnLogin, getLaunchOnLogin
}) {

  ipcMain.handle('gta:get-state', async () => {
    const settings = settingsStore.getSettings();
    const hasCredentials = await credentialStore.hasCredentials();
    const credentialsUsername = await credentialStore.getUsername();
    return {
      isFirstRun: settingsStore.isFirstRun(),
      settings,
      hasCredentials,
      credentialsUsername,
      holidays: settingsStore.getHolidays(),
      history: settingsStore.getHistory(),
      lifecycle: settingsStore.getLifecycle().slice(0, 30),
      pause: settingsStore.getPause(),
      sessionBypass: false, // desktop app doesn't have a session-bypass concept yet
      today: todayDateString(),
      nextSignIn: agentBridge.getNextRun('signin'),
      nextSignOut: agentBridge.getNextRun('signout'),
      todayRuns: settingsStore.getHistory().filter(h =>
        (h.firedAt || '').startsWith(todayDateString())
      ),
      missed: [], // computed lazily; not relevant in Stage 3 first cut
      agentRunning: agentBridge.isRunning()
    };
  });

  ipcMain.handle('gta:save-settings', async (_evt, patch) => {
    settingsStore.setSettings(patch);
    agentBridge.rescheduleCron();
    // Honour launchOnLogin if it was changed.
    if (typeof patch.launchOnLogin === 'boolean') {
      try { await setLaunchOnLogin(patch.launchOnLogin); } catch (_) {}
    }
    return { ok: true, settings: settingsStore.getSettings() };
  });

  ipcMain.handle('gta:toggle-automation', async (_evt, on) => {
    settingsStore.setSettings({ enabled: !!on });
    agentBridge.rescheduleCron();
    return { ok: true };
  });

  ipcMain.handle('gta:set-credentials', async (_evt, username, password) => {
    try {
      await credentialStore.setCredentials(username, password);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('gta:clear-credentials', async () => {
    await credentialStore.clearCredentials();
    return { ok: true };
  });

  ipcMain.handle('gta:run-now', async (_evt, action) => {
    const result = await agentBridge.runOnce(action, 'manual');
    return result;
  });

  ipcMain.handle('gta:test-login', async () => {
    const result = await agentBridge.runOnce('test_login', 'manual');
    if (result.ok) return { ok: true, message: 'Login test passed.' };
    return { ok: false, error: result.error || 'Test login failed.' };
  });

  ipcMain.handle('gta:add-holiday', async (_evt, date, label) => {
    return { ok: true, holidays: settingsStore.addHoliday(date, label) };
  });

  ipcMain.handle('gta:remove-holiday', async (_evt, date) => {
    return { ok: true, holidays: settingsStore.removeHoliday(date) };
  });

  ipcMain.handle('gta:pause-today', async () => {
    settingsStore.setPauseToday(todayDateString());
    return { ok: true };
  });

  ipcMain.handle('gta:pause-session', async () => {
    // Desktop app doesn't have a "session" the way the extension does;
    // treat as pause-today for simplicity.
    settingsStore.setPauseToday(todayDateString());
    return { ok: true };
  });

  ipcMain.handle('gta:pause-until', async (_evt, date) => {
    settingsStore.setPauseUntil(date);
    return { ok: true };
  });

  ipcMain.handle('gta:clear-pause', async () => {
    settingsStore.clearPause();
    return { ok: true };
  });

  ipcMain.handle('gta:complete-wizard', async () => {
    settingsStore.markFirstRunComplete();
    return { ok: true };
  });

  ipcMain.handle('gta:reset-all', async () => {
    settingsStore.reset();
    await credentialStore.clearCredentials();
    agentBridge.rescheduleCron();
    return { ok: true };
  });
}

module.exports = { registerIpc };
