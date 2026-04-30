"use strict";

/**
 * GreyHR Login Workflow
 *
 * Navigates to the GreyHR portal, smart-detects the username and password
 * fields on the login form, fills them with credentials from config / .env,
 * and clicks the Sign In / Login button using a CSS → XPath → text fallback
 * strategy (mirrors the existing selector logic used by smartClick()).
 *
 * Closes the browser immediately after the login action is triggered.
 * All cross-cutting concerns (retry, screenshots on failure, logging,
 * scheduling, notifications, dashboard) are handled by the existing
 * runner / scheduler / notifier — this file only owns the page actions.
 */

const BrowserController = require("./browser");
const logger = require("./logger");
const fs = require("fs");
const path = require("path");

const DEFAULT_URL = "https://basiscloud.greythr.com/uas/portal/auth/login";

const USERNAME_SELECTORS = {
  css: [
    "input#username",
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
    "//label[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'user')]/following::input[1]",
    "//label[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'email')]/following::input[1]",
  ],
};

const PASSWORD_SELECTORS = {
  css: [
    "input#password",
    'input[name="password"]',
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'input[placeholder*="password" i]',
  ],
  xpath: [
    "//input[@type='password']",
    "//label[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'password')]/following::input[1]",
  ],
};

const SUBMIT_SELECTORS = {
  css: [
    'button[type="submit"]',
    "button#login",
    "button.login-btn",
    "button.signin-btn",
    'input[type="submit"]',
  ],
  xpath: [
    "//button[normalize-space()='Sign In']",
    "//button[normalize-space()='Login']",
    "//button[normalize-space()='Log In']",
    "//button[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'sign in')]",
    "//button[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'login')]",
    "//input[@type='submit']",
  ],
  text: "Sign In",
};

async function run(params, config) {
  const log = logger.workflow("greyhr-login");
  const browser = new BrowserController(config);

  const url = params.url || DEFAULT_URL;
  const username = params.username || process.env.GREYHR_USERNAME;
  const password = params.password || process.env.GREYHR_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "GreyHR credentials not configured.\n" +
        "Set GREYHR_USERNAME and GREYHR_PASSWORD in .env, or pass them as params in config.json.",
    );
  }

  log.section("Starting GreyHR Login");

  // ── Step 1: Launch ──────────────────────────────────────
  // Force a fresh isolated Chromium — the real-Chrome path requires a saved
  // session, which doesn't apply to a from-scratch login flow.
  log.info("Step 1/5 — Launching browser");
  await browser.launch({
    useRealChrome: false,
    headless: false,
    slowMo: 50
  });

  try {
    // ── Step 2: Navigate ─────────────────────────────────
    log.info(`Step 2/5 — Navigating to ${url}`);
    await browser.navigate(url);
    await browser.page.waitForLoadState("domcontentloaded");

    // ── Step 3: Detect & fill credentials ────────────────
    log.info("Step 3/5 — Detecting login fields");
    await browser.screenshot("before-greyhr-login").catch(() => {});

    await smartFill(
      browser.page,
      log,
      "username",
      USERNAME_SELECTORS,
      username,
    );
    await smartFill(
      browser.page,
      log,
      "password",
      PASSWORD_SELECTORS,
      password,
    );

    // ── Step 4: Click Sign In ────────────────────────────
    log.info("Step 4/5 — Clicking Sign In");
    let clicked = false;
    for (const css of SUBMIT_SELECTORS.css) {
      const result = await browser.smartClick(css, SUBMIT_SELECTORS.xpath, {
        textFallback: SUBMIT_SELECTORS.text,
        timeout: 4000,
      });
      if (result.success) {
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      log.warn(
        "No submit button matched any selector — submitting via Enter key",
      );
      await browser.page.keyboard.press("Enter");
    }

    // ── Step 5: Confirm login was triggered ──────────────

    log.info("Step 5/5 — Waiting for dashboard to fully load");
    // const startUrl = browser.page.url();
    let confirmed = false;
    try {
      await browser.page.waitForURL(
        (u) => {
          const url = u.toString();
          if (url.includes("/auth/login")) return false;
          if (url.includes("/auth/callback")) return false;
          if (/idp-[^./]+\.greythr\.com/i.test(url)) return false;
          return true;
        },
        { timeout: 30_000 },
      );
      try {
        await browser.page.waitForLoadState("networkidle", { timeout: 15_000 });
      } catch (_) {
        await browser.page
          .waitForLoadState("domcontentloaded", { timeout: 5_000 })
          .catch(() => {});
      }
      confirmed = true;
      log.info(`Dashboard reached → ${browser.page.url()}`);
    } catch (_) {
      log.warn("Dashboard did not load within timeout — verify manually");
    }


    if (!confirmed) {
      log.warn("Dashboard did not load — skipping attendance Sign In");
      return {
        success: true,
        confirmed: false,
        finalUrl: browser.page.url(),
        timestamp: new Date().toISOString(),
      };
    }

    // ── Step 6: Click attendance Sign In on gt-attendance-info ──
    log.info("Step 6/6 — Clicking attendance Sign In on gt-attendance-info");

    const signInCandidates = [
      // Primary: matches the actual DOM on GreytHR's current build —
      // <button class="btn btn-primary btn-medium">Sign In</button>.
      // Playwright's :has-text pierces shadow DOM and matches the visible
      // copy when both Sign In and Sign Out buttons are present in the
      // DOM at the same time (one hidden via CSS).
      {
        label: 'css: button.btn-primary:has-text("Sign In")',
        locator: () =>
          browser.page.locator('button.btn-primary:has-text("Sign In")').first(),
      },
      {
        label: 'css: gt-attendance-info gt-button[shade="primary"]',
        locator: () =>
          browser.page
            .locator('gt-attendance-info gt-button[shade="primary"]')
            .first(),
      },
      {
        label: "role: button name=/^sign in$/i",
        locator: () =>
          browser.page.getByRole("button", { name: /^sign in$/i }).first(),
      },
      {
        label: 'text: "Sign In"',
        locator: () =>
          browser.page.getByText("Sign In", { exact: false }).first(),
      },
    ];

    let signInClicked = false;
    let matchedSelector = null;
    for (const candidate of signInCandidates) {
      try {
        const loc = candidate.locator();
        await loc.waitFor({ state: "visible", timeout: 25_000 });
        await loc.click();
        signInClicked = true;
        matchedSelector = candidate.label;
        log.info(`Sign In clicked via [${candidate.label}]`);
        break;
      } catch (err) {
        log.debug(
          `Sign In candidate did not match: ${candidate.label} (${err.message.split("\n")[0]})`,
        );
      }
    }

    if (!signInClicked) {
      // Already-signed-in detection: if widget shows "Sign Out", treat as no-op success
      let alreadySignedIn = false;
      try {
        await browser.page
          .locator('button.btn-primary:has-text("Sign Out")')
          .first()
          .waitFor({ state: "visible", timeout: 8_000 });
        alreadySignedIn = true;
      } catch (_) {}

      if (alreadySignedIn) {
        log.info(
          'Attendance widget already shows "Sign Out" — already signed in',
        );
        return {
          success: true,
          alreadySignedIn: true,
          finalUrl: browser.page.url(),
          timestamp: new Date().toISOString(),
        };
      }

      throw new Error(
        "Could not locate the attendance Sign In button on the dashboard",
      );
    }

    // Confirm the click landed by waiting for the widget to flip to "Sign Out"
    let attendanceConfirmed = false;
    try {
      await browser.page
        .getByRole("button", { name: /^sign out$/i })
        .first()
        .waitFor({ timeout: 10_000 });
      attendanceConfirmed = true;
      log.info('Sign In confirmed — widget flipped to "Sign Out"');
    } catch (_) {
      log.warn(
        'Did not see widget flip to "Sign Out" within 10s — verify manually',
      );
    }

    return {
      success: true,
      confirmed: true,
      attendanceConfirmed,
      matchedSelector,
      finalUrl: browser.page.url(),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    log.error(`GreyHR login failed: ${err.message}`);
    if (config.agent?.screenshotOnFailure) {
      await browser.screenshot("error-greyhr-login").catch(() => {});
      try {
        const html = await browser.page.content();
        fs.writeFileSync(
          path.join(__dirname, "logs", "debug-greyhr-login.html"),
          html,
        );
      } catch (_) {}
    }
    throw err;
  } finally {
    // Close the browser immediately after the login step, regardless of outcome.
    await browser.close();
  }
}

/**
 * Try a list of CSS selectors, then XPath fallbacks, to locate an input
 * field and fill it. Mirrors the strategy used by browser.smartClick().
 */
async function smartFill(page, log, fieldLabel, selectors, value) {
  for (const css of selectors.css) {
    try {
      const el = await page.waitForSelector(css, {
        timeout: 3000,
        state: "visible",
      });
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
      const els = await page.$$(xp.startsWith("//") ? `xpath=${xp}` : xp);
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

  throw new Error(
    `Could not locate ${fieldLabel} field on the GreyHR login page`,
  );
}

module.exports = { run };
