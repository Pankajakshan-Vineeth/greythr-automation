// credentials.js — Wraps keytar for OS keychain access.
//
// Uses macOS Keychain on Mac, Credential Manager on Windows, libsecret on
// Linux. Stores a single account: GreytHR Automation / username, with the
// password as the secret.

const SERVICE = 'GreytHR Automation';
const ACCOUNT_KEY = 'greythr-account'; // single static key for the username record
const PASSWORD_KEY_PREFIX = 'greythr-password:';

let keytar = null;
try {
  keytar = require('keytar');
} catch (err) {
  console.error('[credentials] keytar load failed:', err.message);
  console.error('[credentials] On Linux, install libsecret-1-0 (Debian/Ubuntu) or libsecret (Fedora/Arch) and rerun.');
}

class CredentialStore {
  constructor() {
    this.available = !!keytar;
  }

  async hasCredentials() {
    if (!keytar) return false;
    try {
      const username = await keytar.getPassword(SERVICE, ACCOUNT_KEY);
      if (!username) return false;
      const password = await keytar.getPassword(SERVICE, PASSWORD_KEY_PREFIX + username);
      return !!password;
    } catch (err) {
      console.error('[credentials] hasCredentials failed:', err.message);
      return false;
    }
  }

  async getUsername() {
    if (!keytar) return null;
    try {
      return await keytar.getPassword(SERVICE, ACCOUNT_KEY);
    } catch (err) {
      console.error('[credentials] getUsername failed:', err.message);
      return null;
    }
  }

  async getCredentials() {
    if (!keytar) return null;
    try {
      const username = await keytar.getPassword(SERVICE, ACCOUNT_KEY);
      if (!username) return null;
      const password = await keytar.getPassword(SERVICE, PASSWORD_KEY_PREFIX + username);
      if (!password) return null;
      return { username, password };
    } catch (err) {
      console.error('[credentials] getCredentials failed:', err.message);
      return null;
    }
  }

  async setCredentials(username, password) {
    if (!keytar) {
      throw new Error('Keychain unavailable on this system. On Linux, install libsecret.');
    }
    try {
      // If the username changed, clear the old password entry first.
      const previous = await keytar.getPassword(SERVICE, ACCOUNT_KEY);
      if (previous && previous !== username) {
        await keytar.deletePassword(SERVICE, PASSWORD_KEY_PREFIX + previous);
      }
      await keytar.setPassword(SERVICE, ACCOUNT_KEY, username);
      await keytar.setPassword(SERVICE, PASSWORD_KEY_PREFIX + username, password);
      return true;
    } catch (err) {
      console.error('[credentials] setCredentials failed:', err.message);
      throw err;
    }
  }

  async clearCredentials() {
    if (!keytar) return false;
    try {
      const username = await keytar.getPassword(SERVICE, ACCOUNT_KEY);
      if (username) {
        await keytar.deletePassword(SERVICE, PASSWORD_KEY_PREFIX + username);
      }
      await keytar.deletePassword(SERVICE, ACCOUNT_KEY);
      return true;
    } catch (err) {
      console.error('[credentials] clearCredentials failed:', err.message);
      return false;
    }
  }
}

module.exports = { CredentialStore };
