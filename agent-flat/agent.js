#!/usr/bin/env node
'use strict';

/**
 * Smart Automation Agent — Main Entry Point
 * ─────────────────────────────────────────
 * Usage:
 *   node agent.js                      Start the agent (scheduler mode)
 *   node agent.js --test               Dry-run: validate config and print schedule
 *   node agent.js --run <workflow-id>  Run a specific workflow immediately
 *   node agent.js --silent             Run without console output (log to file only)
 *   node agent.js --list               List all configured workflows
 */

require('dotenv').config();

const fs             = require('fs');
const path           = require('path');
const logger         = require('./logger');
const Scheduler      = require('./scheduler');
const HealthServer   = require('./health-server');
const WorkflowRunner = require('./workflow-runner');

// ─── Load & validate config ────────────────────────────────

function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');

  if (!fs.existsSync(configPath)) {
    logger.error('config.json not found. Please create it from the example.');
    process.exit(1);
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    // Strip // comments (not valid JSON but convenient for users)
    const clean = raw
    return JSON.parse(clean);
  } catch (err) {
    logger.error(`Failed to parse config.json: ${err.message}`);
    process.exit(1);
  }
}

// ─── CLI argument parsing ──────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    test:     args.includes('--test'),
    list:     args.includes('--list'),
    silent:   args.includes('--silent'),
    run:      args.includes('--run') ? args[args.indexOf('--run') + 1] : null,
    help:     args.includes('--help') || args.includes('-h'),
  };
}

// ─── Print banner ──────────────────────────────────────────

function printBanner(config) {
  const name = config.agent?.name || 'Smart Automation Agent';
  const tz   = config.agent?.timezone || 'Asia/Kolkata';

  console.log(`
\x1b[1m\x1b[36m
  ╔═══════════════════════════════════════════╗
  ║        ⚡ ${name.padEnd(32)}║
  ║           Personal RPA Platform           ║
  ╚═══════════════════════════════════════════╝
\x1b[0m`);
  console.log(`  \x1b[90mNode.js ${process.version}  •  PID ${process.pid}  •  TZ: ${tz}\x1b[0m\n`);
}

// ─── Graceful shutdown ─────────────────────────────────────

function setupGracefulShutdown(scheduler, healthServer) {
  const shutdown = (signal) => {
    logger.info(`Received ${signal} — shutting down gracefully…`);
    scheduler.stopAll();
    healthServer.stop();
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}`, { stack: err.stack });
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
  });
}

// ─── Help text ─────────────────────────────────────────────

function printHelp() {
  console.log(`
  Smart Automation Agent

  Usage:
    node agent.js                       Start scheduler (runs indefinitely)
    node agent.js --run <id>            Run a specific workflow now
    node agent.js --list                List all configured workflows
    node agent.js --test                Validate config without running
    node agent.js --silent              Suppress console output
    node agent.js --help                Show this help

  Examples:
    node agent.js --run zoho-checkin    Manually trigger the Zoho Check-In
    node agent.js --run zoho-checkout   Manually trigger the Zoho Check-Out

  Config:
    Edit config.json to add/modify workflows
    Copy .env.example to .env and add your credentials
  `);
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  const args   = parseArgs();
  const config = loadConfig();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  printBanner(config);
  logger.info('Agent starting…');

  // ── --list mode ─────────────────────────────────────────
  if (args.list) {
    const workflows = config.workflows || [];
    logger.section('Configured Workflows');
    for (const w of workflows) {
      const status = w.enabled ? '\x1b[32m✔ enabled\x1b[0m' : '\x1b[90m○ disabled\x1b[0m';
      console.log(`  ${status}  \x1b[1m${w.name}\x1b[0m`);
      console.log(`         ID: ${w.id}  •  Schedule: ${w.scheduleDescription || w.schedule}`);
      console.log(`         ${w.description || ''}\n`);
    }
    process.exit(0);
  }

  // ── --test mode ─────────────────────────────────────────
  if (args.test) {
    logger.section('Configuration Test');
    const enabled = (config.workflows || []).filter(w => w.enabled);
    logger.info(`Config valid ✓  (${enabled.length} workflows enabled)`);

    const runner = new WorkflowRunner(config);
    logger.info(`Registered workflow types: ${runner.list().join(', ')}`);

    // Validate cron expressions
    const cron = require('node-cron');
    for (const w of enabled) {
      const valid = cron.validate(w.schedule);
      logger.info(`  [${valid ? '✓' : '✗'}] ${w.id}: cron "${w.schedule}" — ${valid ? 'valid' : 'INVALID'}`);
    }

    logger.info('Test complete — no workflows were executed');
    process.exit(0);
  }

  // ── --run mode (manual trigger) ─────────────────────────
  if (args.run) {
    const workflowId = args.run;
    const def = (config.workflows || []).find(w => w.id === workflowId);

    if (!def) {
      logger.error(`Workflow not found: "${workflowId}"`);
      logger.info('Available IDs: ' + (config.workflows || []).map(w => w.id).join(', '));
      process.exit(1);
    }

    logger.info(`Manual trigger: "${def.name}"`);

    try {
      const runner = new WorkflowRunner(config);
      const result = await runner.execute(def);
      logger.info('Workflow result:', result);
      process.exit(0);
    } catch (err) {
      logger.error(`Workflow failed: ${err.message}`);
      process.exit(1);
    }
  }

  // ── Scheduler mode (default) ─────────────────────────────
  logger.info('Starting in scheduler mode…');

  const scheduler    = new Scheduler(config);
  const healthServer = new HealthServer(scheduler, config);

  scheduler.start();
  healthServer.start();

  setupGracefulShutdown(scheduler, healthServer);

  logger.info('Agent is running. Press Ctrl+C to stop.');
  logger.info('Dashboard: http://127.0.0.1:3737');

  // Keep process alive
  process.stdin.resume();
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
