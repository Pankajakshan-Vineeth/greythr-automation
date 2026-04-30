'use strict';

/**
 * Generic Navigate-and-Click Workflow
 * A reusable workflow template for simple navigation + button-click tasks.
 * 
 * Workflow params:
 *   url              : required — page to navigate to
 *   waitForSelector  : optional — wait for this element before proceeding
 *   clickSelector    : optional — CSS selector to click
 *   fillFields       : optional — array of { selector, value } to fill
 *   screenshotAfter  : optional — take screenshot after completion
 */

const BrowserController = require('./browser');
const logger = require('./logger');

async function run(params, config) {
  const log = logger.workflow('navigate-click');
  const browser = new BrowserController(config);

  log.info(`Navigate & Click — target: ${params.url}`);

  await browser.launch();

  try {
    // Navigate
    await browser.navigate(params.url);

    // Optionally wait for a page element
    if (params.waitForSelector) {
      log.info(`Waiting for: ${params.waitForSelector}`);
      await browser.waitForSelector(params.waitForSelector);
    }

    // Optionally fill form fields
    if (params.fillFields && Array.isArray(params.fillFields)) {
      for (const field of params.fillFields) {
        log.info(`Filling field: ${field.selector}`);
        await browser.fill(field.selector, field.value);
      }
    }

    // Optionally click a button
    if (params.clickSelector) {
      log.info(`Clicking: ${params.clickSelector}`);
      const result = await browser.smartClick(
        params.clickSelector,
        params.fallbackSelectors || [],
        { textFallback: params.clickText }
      );
      if (!result.success) {
        log.warn(`Could not click target element: ${params.clickSelector}`);
      }
    }

    // Screenshot
    if (params.screenshotAfter) {
      await browser.screenshot('navigate-click-result');
    }

    log.info('Navigate & Click workflow completed');
    return { success: true, timestamp: new Date().toISOString() };

  } finally {
    await browser.close();
  }
}

module.exports = { run };
