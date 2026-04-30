// auto-launch.js — Cross-platform launch-on-login.
//
// On macOS and Windows: app.setLoginItemSettings is built into Electron.
// On Linux: Electron's setLoginItemSettings is a no-op, so we use the
//   auto-launch npm package which writes a .desktop autostart entry.

const { app } = require('electron');

let AutoLaunch = null;
try {
  AutoLaunch = require('auto-launch');
} catch (err) {
  console.warn('[auto-launch] package not installed; Linux launch-on-login disabled.');
}

let linuxAutoLauncher = null;
function getLinuxAutoLauncher() {
  if (linuxAutoLauncher) return linuxAutoLauncher;
  if (!AutoLaunch) return null;
  linuxAutoLauncher = new AutoLaunch({
    name: 'GreytHR Automation',
    path: app.getPath('exe')
  });
  return linuxAutoLauncher;
}

async function setLaunchOnLogin(enabled) {
  if (process.platform === 'linux') {
    const launcher = getLinuxAutoLauncher();
    if (!launcher) return false;
    try {
      const isEnabled = await launcher.isEnabled();
      if (enabled && !isEnabled) await launcher.enable();
      if (!enabled && isEnabled) await launcher.disable();
      return true;
    } catch (err) {
      console.error('[auto-launch] linux toggle failed:', err.message);
      return false;
    }
  }

  // macOS + Windows: native API.
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      openAsHidden: true // start in tray, no foreground window
    });
    return true;
  } catch (err) {
    console.error('[auto-launch] setLoginItemSettings failed:', err.message);
    return false;
  }
}

async function getLaunchOnLogin() {
  if (process.platform === 'linux') {
    const launcher = getLinuxAutoLauncher();
    if (!launcher) return false;
    try { return await launcher.isEnabled(); }
    catch (_) { return false; }
  }
  try { return app.getLoginItemSettings().openAtLogin; }
  catch (_) { return false; }
}

module.exports = { setLaunchOnLogin, getLaunchOnLogin };
