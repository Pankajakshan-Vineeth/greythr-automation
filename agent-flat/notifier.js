'use strict';

const logger = require('./logger');

/**
 * Notifier — desktop notifications + optional webhook
 * Gracefully degrades if node-notifier is unavailable
 */

let nodeNotifier;
try {
  nodeNotifier = require('node-notifier');
} catch (_) {
  // optional dependency
}

async function notify({ title, message, type = 'info' }, config = {}) {
  const agentCfg = config.agent || {};

  if (!agentCfg.notificationsEnabled) return;

  // 1. Desktop notification
  if (nodeNotifier) {
    try {
      nodeNotifier.notify({
        title:   title,
        message: message,
        icon:    type === 'error' ? undefined : undefined,
        sound:   type === 'error',
        timeout: 8,
      });
    } catch (err) {
      logger.debug(`Desktop notification failed: ${err.message}`);
    }
  }

  // 2. Webhook (Slack, Discord, custom)
  const webhookUrl = process.env.SLACK_WEBHOOK_URL || process.env.NOTIFICATION_WEBHOOK;
  if (webhookUrl) {
    try {
      const axios = require('axios');
      const emoji = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
      await axios.post(webhookUrl, {
        text: `${emoji} *${title}*\n${message}`,
      }, { timeout: 5000 });
    } catch (err) {
      logger.debug(`Webhook notification failed: ${err.message}`);
    }
  }
}

module.exports = { notify };
