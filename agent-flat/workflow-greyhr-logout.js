'use strict';

/**
 * GreyHR Attendance Sign Out Workflow
 *
 * Daily clock-out: logs in to GreyHR and clicks the blue "Sign Out" button on
 * the `gt-attendance-info` widget on the home dashboard. This is the
 * attendance check-out, NOT an application logout — replacing the original
 * Zoho `checkout` workflow that this project previously used.
 *
 * The login workflow does not persist a session, so this workflow is
 * self-contained: it logs in, clicks attendance Sign Out, confirms the widget
 * flips from "Sign Out" to "Sign In", then closes the browser.
 *
 * Shadow DOM note: the Sign Out element is a Stencil Web Component
 * (`<gt-button>` inside `<gt-attendance-info>`) whose label lives inside the
 * component's shadow root. Light-DOM XPath selectors like
 * `//button[normalize-space()='Sign Out']` will never match. Playwright's
 * `getByRole()` and `getByText()` pierce shadow DOM, so we use those.
 *
 * Returns:
 *   { success: true, confirmed: true,        ... } on a successful sign out.
 *   { success: true, alreadySignedOut: true, ... } if the widget is already
 *     in the signed-out state when the workflow arrives.
 */

const BrowserController = require('./browser');
const logger = require('./logger');
const fs     = require('fs');
const path   = require('path');

const DEFAULT_LOGIN_URL = 'https://basiscloud.greythr.com/uas/portal/auth/login';

const USERNAME_SELECTORS = {
  css: [
    'input#username',
    'input[name="username"]',
    'input[name="email"]',
    'input[name="userId"]',
    'input[name="loginId"]',
    'input[type="email"]',
    'input[autocomplete="username"]',
    'input[placeholder*="user" i]',
    'input[placeholder*="email" i]',
    'input[placeholder*="employee" i]',
  ],
  xpath: [
    "//input[@type='email']",
    "//input[contains(translate(@placeholder,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'user')]",
    "//input[contains(translate(@placeholder,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'email')]",
  ],
};

const PASSWORD_SELECTORS = {
  css: [
    'input#password',
    'input[name="password"]',
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'input[placeholder*="password" i]',
  ],
  xpath: [
    "//input[@type='password']",
  ],
};

const SUBMIT_SELECTORS = {
  css: [
    'button[type="submit"]',
    'button#login',
    'button.login-btn',
    'button.signin-btn',
    'input[type="submit"]',
  ],
  xpath: [
    "//button[normalize-space()='Sign In']",
    "//button[normalize-space()='Login']",
    "//button[normalize-space()='Log In']",
    "//input[@type='submit']",
  ],
  text: 'Sign In',
};

async function run(params, config) {
  const log     = logger.workflow('greyhr-logout');
  const browser = new BrowserController(config);

  const loginUrl = params.loginUrl || params.url || DEFAULT_LOGIN_URL;
  const username = params.username || process.env.GREYHR_USERNAME;
  const password = params.password || process.env.GREYHR_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'GreyHR credentials not configured.\n' +
      'Set GREYHR_USERNAME and GREYHR_PASSWORD in .env, or pass them as params in config.json.'
    );
  }

  log.section('Starting GreyHR Attendance Sign Out');

  log.info('Step 1/5 — Launching browser');
  await browser.launch({
    useRealChrome: false,
    headless: false,
    slowMo: 50
  });

  const debugDir = path.join(__dirname, 'logs');
  const shotDir  = path.join(debugDir, 'screenshots');
  const snapshot = async (label) => {
    try {
      const ts       = new Date().toISOString().replace(/[:.]/g, '-');
      const pngPath  = path.join(shotDir,  `greyhr-logout-${label}-${ts}.png`);
      const htmlPath = path.join(debugDir, `greyhr-logout-${label}-${ts}.html`);
      await browser.page.screenshot({ path: pngPath, fullPage: true }).catch(() => {});
      const html  = await browser.page.content().catch(() => '');
      if (html) fs.writeFileSync(htmlPath, html);
      const title = await browser.page.title().catch(() => '');
      log.info(
        `Debug snapshot [${label}] -> url=${browser.page.url()} ` +
        `title="${title}" png=${path.basename(pngPath)} html=${path.basename(htmlPath)}`
      );
    } catch (err) {
      log.warn(`Failed to capture debug snapshot [${label}]: ${err.message}`);
    }
  };

  try {
    log.info(`Step 2/5 — Navigating to ${loginUrl}`);
    await browser.navigate(loginUrl);
    await browser.page.waitForLoadState('domcontentloaded');

    log.info('Step 3/5 — Logging in');
    await smartFill(browser.page, log, 'username', USERNAME_SELECTORS, username);
    await smartFill(browser.page, log, 'password', PASSWORD_SELECTORS, password);

    let clicked = false;
    for (const css of SUBMIT_SELECTORS.css) {
      const result = await browser.smartClick(css, SUBMIT_SELECTORS.xpath, {
        textFallback: SUBMIT_SELECTORS.text,
        timeout: 4000,
      });
      if (result.success) { clicked = true; break; }
    }
    if (!clicked) {
      log.warn('No submit button matched any selector — submitting via Enter key');
      await browser.page.keyboard.press('Enter');
    }

    log.info('Step 4/5 — Waiting for post-login redirect to settle on the dashboard');
    try {
      // GreyHR uses an OAuth bounce: login form → idp-*.greythr.com/auth/callback
      // → basiscloud.greythr.com (dashboard). Wait for the FINAL hop, not just the
      // first redirect — otherwise we'll fire the logout URL while still on the
      // callback page and end up logging out before the session is fully established.
      await browser.page.waitForURL(
        u => {
          const url = u.toString();
          if (url.includes('/auth/login'))    return false;
          if (url.includes('/auth/callback')) return false;
          if (/idp-[^./]+\.greythr\.com/i.test(url)) return false;
          return true;
        },
        { timeout: 30_000 }
      );
      // Give the dashboard a moment to actually paint before we tear it down.
      try {
        await browser.page.waitForLoadState('networkidle', { timeout: 15_000 });
      } catch (_) {
        await browser.page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
      }
      log.info(`Logged in → ${browser.page.url()}`);
    } catch (_) {
      log.warn('Dashboard did not finish loading within timeout — proceeding to attempt logout anyway');
    }

    // Capture the dashboard so the attendance widget is recorded before we
    // mutate it.
    await snapshot('dashboard');

    log.info('Step 5/5 — Clicking attendance Sign Out on gt-attendance-info');

    const signOutCandidates = [
      // Primary: matches the actual DOM on GreytHR's current build —
      // <button class="btn btn-primary btn-medium">Sign Out</button>.
      // Playwright's :has-text pierces shadow DOM and matches the visible
      // copy when both Sign In and Sign Out buttons are present in the
      // DOM at the same time (one hidden via CSS).
      {
        label: 'css: button.btn-primary:has-text("Sign Out")',
        locator: () => browser.page.locator('button.btn-primary:has-text("Sign Out")').first(),
      },
      {
        label: 'css: gt-attendance-info gt-button[shade="primary"]',
        locator: () => browser.page.locator('gt-attendance-info gt-button[shade="primary"]').first(),
      },
      {
        label: 'role: button name=/^sign out$/i',
        locator: () => browser.page.getByRole('button', { name: /^sign out$/i }).first(),
      },
      {
        label: 'text: "Sign Out"',
        locator: () => browser.page.getByText('Sign Out', { exact: false }).first(),
      },
    ];

    let signOutClicked     = false;
    let matchedSelector    = null;
    for (const candidate of signOutCandidates) {
      try {
        const loc = candidate.locator();
        await loc.waitFor({ state: 'visible', timeout: 25_000 });
        await loc.click();
        signOutClicked  = true;
        matchedSelector = candidate.label;
        log.info(`Sign Out clicked via [${candidate.label}]`);
        break;
      } catch (err) {
        log.debug(`Sign Out candidate did not match: ${candidate.label} (${err.message.split('\n')[0]})`);
      }
    }

    if (!signOutClicked) {
      // Already-signed-out detection: if the widget is showing "Sign In",
      // treat this as a no-op success rather than a failure.
      let alreadySignedOut = false;
      try {
        await browser.page
          .locator('button.btn-primary:has-text("Sign In")')
          .first()
          .waitFor({ state: 'visible', timeout: 8_000 });
        alreadySignedOut = true;
      } catch (_) { /* not signed out — real failure */ }

      if (alreadySignedOut) {
        log.info('Attendance widget already shows "Sign In" — nothing to do');
        return {
          success:          true,
          alreadySignedOut: true,
          finalUrl:         browser.page.url(),
          timestamp:        new Date().toISOString(),
        };
      }

      await snapshot('signout-not-found');
      throw new Error('Could not locate the attendance Sign Out button on the dashboard');
    }

    // Confirm the click landed by waiting for the widget label to flip from
    // "Sign Out" to "Sign In". The page does not navigate, so do not check URL.
    let confirmed = false;
    try {
      await browser.page
        .getByRole('button', { name: /^sign in$/i })
        .first()
        .waitFor({ timeout: 10_000 });
      confirmed = true;
      log.info('Sign Out confirmed — widget flipped to "Sign In"');
    } catch (_) {
      log.warn('Did not see the widget flip to "Sign In" within 10s — verify manually');
    }

    await snapshot('signed-out');

    return {
      success:         true,
      confirmed,
      matchedSelector,
      finalUrl:        browser.page.url(),
      timestamp:       new Date().toISOString(),
    };

  } catch (err) {
    log.error(`GreyHR attendance sign out failed: ${err.message}`);
    if (config.agent?.screenshotOnFailure) {
      await browser.screenshot('error-greyhr-logout').catch(() => {});
      try {
        const html = await browser.page.content();
        fs.writeFileSync(
          path.join(__dirname, 'logs', 'debug-greyhr-logout.html'),
          html
        );
      } catch (_) {}
    }
    throw err;
  } finally {
    await browser.close();
  }
}

async function smartFill(page, log, fieldLabel, selectors, value) {
  for (const css of selectors.css) {
    try {
      const el = await page.waitForSelector(css, { timeout: 3000, state: 'visible' });
      if (el) {
        await el.click({ clickCount: 3 });
        await el.fill(value);
        log.info(`Filled ${fieldLabel} via CSS: ${css}`);
        return css;
      }
    } catch (_) {
      log.debug(`CSS selector not found for ${fieldLabel}: ${css}`);
    }
  }

  for (const xp of selectors.xpath) {
    try {
      const els = await page.$$(xp.startsWith('//') ? `xpath=${xp}` : xp);
      if (els.length > 0) {
        await els[0].click({ clickCount: 3 });
        await els[0].fill(value);
        log.info(`Filled ${fieldLabel} via XPath: ${xp}`);
        return xp;
      }
    } catch (_) {
      log.debug(`XPath fallback not found for ${fieldLabel}: ${xp}`);
    }
  }

  throw new Error(`Could not locate ${fieldLabel} field on the GreyHR login page`);
}

module.exports = { run };
