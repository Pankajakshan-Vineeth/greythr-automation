'use strict';

const { chromium } = require('playwright');
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const logger = require('./logger');

const SCREENSHOT_DIR = path.join(__dirname, 'logs', 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Default Chrome user-data-dir paths per platform
const CHROME_PROFILE_PATHS = {
  linux:  path.join(os.homedir(), '.config', 'google-chrome'),
  darwin: path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
  win32:  path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
};

/**
 * BrowserController — manages Playwright lifecycle and common page actions.
 *
 * Two launch modes (set via config.json → agent.useRealChrome):
 *
 *   useRealChrome: true  → launchPersistentContext on your real Chrome profile.
 *                          Inherits all existing logins/cookies — no password needed.
 *                          ⚠ Chrome must be fully closed before the agent runs.
 *
 *   useRealChrome: false → launches a fresh isolated Chromium.
 *                          Requires credentials in .env.
 */
class BrowserController {
  constructor(config = {}) {
    this.config  = config;
    this.browser = null;
    this.context = null;
    this.page    = null;
    this.log     = logger.workflow('Browser');
  }

  async launch(options = {}) {
    const agentCfg   = this.config.agent    || {};
    const browserCfg = (this.config.browser || {}).chromium || {};
    const useRealChrome = options.useRealChrome ?? agentCfg.useRealChrome ?? true;

    if (useRealChrome) {
      await this._launchWithRealChrome(agentCfg, browserCfg, options);
    } else {
      await this._launchFresh(agentCfg, browserCfg, options);
    }

    this.log.info('Browser launched successfully');
    return this.page;
  }

  // async _launchWithRealChrome(agentCfg, browserCfg, options) {
  //   const platform   = process.platform;
  //   const profileDir = agentCfg.chromeProfilePath
  //     || CHROME_PROFILE_PATHS[platform]
  //     || CHROME_PROFILE_PATHS['linux'];

  //   const profileName = agentCfg.chromeProfileName || 'Default';

  //   this.log.info(`Using real Chrome profile: ${profileDir} (profile: ${profileName})`);

  //   if (!fs.existsSync(profileDir)) {
  //     throw new Error(
  //       `Chrome profile not found: ${profileDir}\n` +
  //       `Make sure Google Chrome is installed, or set agent.chromeProfilePath in config.json`
  //     );
  //   }

  //   const launchArgs = [
  //     '--no-sandbox',
  //     '--disable-setuid-sandbox',
  //     '--disable-dev-shm-usage',
  //     '--disable-blink-features=AutomationControlled',
  //     '--disable-infobars',
  //     '--window-size=1280,800',
  //     `--profile-directory=${profileName}`,
  //     '--no-first-run',                          // ← add this
  //     '--no-default-browser-check',             // ← add this
  //     '--restore-last-session=false',           // ← add this (not standard but harmless)
  //     '--disable-session-crashed-bubble',       // ← add this  
  //     '--hide-crash-restore-bubble', 
  //     '--disable-features=IdentityConsistencyConsentBump,ChromeSignin',            // ← KEY one for newer Chrome
  //     ...(browserCfg.args || []),
  //   ];

  //   // launchPersistentContext opens Chrome with the real profile directory —
  //   // all saved cookies/sessions are inherited, so Zoho is already logged in.
  //   this.context = await chromium.launchPersistentContext(profileDir, {
  //     channel:    'chrome',
  //     // headless:   options.headless ?? agentCfg.headless ?? true,
  //     headless:   false,
  //     slowMo:     options.slowMo   ?? agentCfg.slowMo   ?? 150,
  //     timeout:    30000, 
  //     args:       launchArgs,
  //     ignoreDefaultArgs: ['--enable-automation'],
  //     viewport:   browserCfg.viewport || { width: 1280, height: 800 },
  //     locale:     'en-IN',
  //     timezoneId: agentCfg.timezone || 'Asia/Kolkata',
  //   });

  //   await this.context.addInitScript(() => {
  //     Object.defineProperty(navigator, 'webdriver', { get: () => false });
  //   });

  //   this.page = this.context.pages()[0] || await this.context.newPage();
  // }

  async _launchWithRealChrome(agentCfg, browserCfg, options) {
    const sessionPath = path.join(__dirname, 'logs', 'zoho-session.json');
  
    if (!fs.existsSync(sessionPath)) {
      throw new Error(
        'No saved session found at logs/zoho-session.json\n' +
        'Run: node capture-session.js to log in and save your session.'
      );
    }
  
    this.log.info('Launching with saved Zoho session...');
  
    this.browser = await chromium.launch({
      channel:  'chrome',
      headless: false,
      slowMo:   options.slowMo ?? agentCfg.slowMo ?? 150,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-first-run',
        '--disable-sync',
        '--window-size=1280,800',
        ...(browserCfg.args || []),
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
  
    this.context = await this.browser.newContext({
      storageState: sessionPath,
      viewport:     browserCfg.viewport || { width: 1280, height: 800 },
      locale:       'en-IN',
      timezoneId:   agentCfg.timezone || 'Asia/Kolkata',
    });
  
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
  
    this.page = await this.context.newPage();
    this.log.info('Browser launched with saved session');
  }

  async _launchFresh(agentCfg, browserCfg, options) {
    this.log.info('Launching fresh Chromium (isolated session)...');

    // If the desktop-app set `openMinimized: true`, start Chromium minimized
    // so it doesn't steal focus. The user can click the taskbar entry to
    // watch the run if they want. Most desktop environments honor either
    // --start-minimized or --window-position=0,-2000 (off-screen as a
    // belt-and-braces fallback for window managers that ignore the former).
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1280,800',
      ...(browserCfg.args || []),
    ];
    if (agentCfg.openMinimized) {
      launchArgs.push('--start-minimized');
    }

    this.browser = await chromium.launch({
      headless: options.headless ?? agentCfg.headless ?? true,
      slowMo:   options.slowMo   ?? agentCfg.slowMo   ?? 100,
      args: launchArgs,
    });

    this.context = await this.browser.newContext({
      viewport:   browserCfg.viewport || { width: 1280, height: 800 },
      userAgent:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale:     'en-IN',
      timezoneId: agentCfg.timezone || 'Asia/Kolkata',
      ...(options.storageState ? { storageState: options.storageState } : {}),
    });

    await this.context.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,otf}', r => r.abort());
    await this.context.route('**/analytics/**', r => r.abort());
    await this.context.route('**/tracking/**',  r => r.abort());

    this.page = await this.context.newPage();
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
  }

  async navigate(url, options = {}) {
    this.log.info(`Navigating to: ${url}`);
    await this.page.goto(url, {
      waitUntil: options.waitUntil || 'domcontentloaded',
      timeout:   options.timeout  || 60_000,    });
    this.log.info(`Page loaded: ${await this.page.title()}`);
  }

  async waitForSelector(selector, options = {}) {
    this.log.debug(`Waiting for selector: ${selector}`);
    return this.page.waitForSelector(selector, {
      timeout: options.timeout || 15_000,
      state:   options.state   || 'visible',
    });
  }

  async waitForURL(urlPattern, timeout = 15_000) {
    this.log.debug(`Waiting for URL: ${urlPattern}`);
    await this.page.waitForURL(urlPattern, { timeout });
  }

  async smartClick(cssSelector, xpathFallbacks = [], options = {}) {
    const timeout = options.timeout || 15_000;

    try {
      const el = await this.page.waitForSelector(cssSelector, { timeout, state: 'visible' });
      if (el) {
        await el.scrollIntoViewIfNeeded();
        await el.click();
        this.log.info(`Clicked via CSS: ${cssSelector}`);
        return { success: true, selector: cssSelector };
      }
    } catch (_) {
      this.log.debug(`CSS selector not found: ${cssSelector}`);
    }

    for (const xpath of xpathFallbacks) {
      try {
        const els = await this.page.$$(xpath.startsWith('//') ? `xpath=${xpath}` : xpath);
        if (els.length > 0) {
          await els[0].scrollIntoViewIfNeeded();
          await els[0].click();
          this.log.info(`Clicked via XPath: ${xpath}`);
          return { success: true, selector: xpath };
        }
      } catch (_) {
        this.log.debug(`XPath fallback not found: ${xpath}`);
      }
    }

    if (options.textFallback) {
      try {
        await this.page.getByText(options.textFallback, { exact: false }).first().click();
        this.log.info(`Clicked via text: "${options.textFallback}"`);
        return { success: true, selector: `text:${options.textFallback}` };
      } catch (_) {
        this.log.debug(`Text fallback not found: ${options.textFallback}`);
      }
    }

    return { success: false, selector: null };
  }

  async fill(selector, value, options = {}) {
    const el = await this.waitForSelector(selector, options);
    await el.click({ clickCount: 3 });
    await el.fill(value);
    this.log.debug(`Filled field: ${selector}`);
  }

  async screenshot(name = 'screenshot') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename  = `${name}-${timestamp}.png`;
    const filepath  = path.join(SCREENSHOT_DIR, filename);
    await this.page.screenshot({ path: filepath, fullPage: false });
    this.log.info(`Screenshot saved: ${filename}`);
    return filepath;
  }

  async saveSession(label = 'default') {
    const sessionPath = path.join(__dirname, 'logs', `session-${label}.json`);
    await this.context.storageState({ path: sessionPath });
    this.log.info(`Session saved: ${sessionPath}`);
    return sessionPath;
  }

  sessionPath(label = 'default') {
    return path.join(__dirname, 'logs', `session-${label}.json`);
  }

  hasSession(label = 'default') {
    return fs.existsSync(this.sessionPath(label));
  }

  async close(saveSess = false) {
    if (saveSess && this.context) await this.saveSession().catch(() => {});
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page    = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.log.info('Browser closed');
  }
}

module.exports = BrowserController;
