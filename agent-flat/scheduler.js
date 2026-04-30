'use strict';

const cron           = require('node-cron');
const logger         = require('./logger');
const WorkflowRunner = require('./workflow-runner');
const notifier       = require('./notifier');

/**
 * Scheduler — registers node-cron jobs for all enabled workflows in config
 */
class Scheduler {
  constructor(config) {
    this.config  = config;
    this.runner  = new WorkflowRunner(config);
    this.jobs    = new Map();   // jobId → { task, definition }
    this.history = [];          // Execution history (last 100)
    this.log     = logger.workflow('Scheduler');
  }

  // ─── Start ────────────────────────────────────────────────

  start() {
    const workflows = this.config.workflows || [];
    const enabled   = workflows.filter(w => w.enabled !== false);

    this.log.section('Scheduling Workflows');
    this.log.info(`Found ${workflows.length} workflow(s), ${enabled.length} enabled`);

    for (const def of enabled) {
      this.schedule(def);
    }

    if (this.jobs.size === 0) {
      this.log.warn('No workflows are enabled. Edit config.json to enable them.');
    }

    this.printSchedule();
  }

  // ─── Schedule a single workflow ───────────────────────────

  schedule(def) {
    if (!cron.validate(def.schedule)) {
      this.log.error(`Invalid cron expression for "${def.id}": ${def.schedule}`);
      return;
    }

    const timezone = def.timezone || this.config.agent?.timezone || 'Asia/Kolkata';

    const task = cron.schedule(
      def.schedule,
      () => this.fire(def),
      {
        scheduled: true,
        timezone,
      }
    );

    this.jobs.set(def.id, { task, definition: def });
    this.log.info(`Scheduled: [${def.id}] "${def.name}" — ${def.scheduleDescription || def.schedule} (${timezone})`);
  }

  // ─── Fire a workflow ──────────────────────────────────────

  async fire(def) {
    const fireTime = new Date().toISOString();
    this.log.info(`⏰ Cron triggered: "${def.name}"`);

    const record = {
      id:        def.id,
      name:      def.name,
      firedAt:   fireTime,
      status:    'running',
      result:    null,
      error:     null,
    };

    // Keep last 100 runs
    this.history.unshift(record);
    if (this.history.length > 100) this.history.pop();

    try {
      const result = await this.runner.execute(def);
      record.status = 'success';
      record.result = result;

      await notifier.notify({
        title:   `${def.name}`,
        message: `Completed at ${new Date().toLocaleTimeString()}`,
        type:    'success',
      }, this.config);

    } catch (err) {
      record.status = 'error';
      record.error  = err.message;

      this.log.error(`Workflow "${def.name}" ultimately failed: ${err.message}`);

      await notifier.notify({
        title:   `❌ ${def.name} Failed`,
        message: err.message,
        type:    'error',
      }, this.config);
    }
  }

  // ─── Manual trigger ───────────────────────────────────────

  async runNow(workflowId) {
    const job = this.jobs.get(workflowId);
    if (!job) {
      // Try finding in config directly (even if disabled)
      const def = (this.config.workflows || []).find(w => w.id === workflowId);
      if (!def) throw new Error(`Workflow not found: ${workflowId}`);
      return this.fire(def);
    }
    return this.fire(job.definition);
  }

  // ─── Controls ─────────────────────────────────────────────

  pause(workflowId) {
    const job = this.jobs.get(workflowId);
    if (job) { job.task.stop(); this.log.info(`Paused: ${workflowId}`); }
  }

  resume(workflowId) {
    const job = this.jobs.get(workflowId);
    if (job) { job.task.start(); this.log.info(`Resumed: ${workflowId}`); }
  }

  stopAll() {
    for (const [id, { task }] of this.jobs) {
      task.stop();
      this.log.info(`Stopped: ${id}`);
    }
    this.jobs.clear();
  }

  // ─── Status ───────────────────────────────────────────────

  status() {
    const jobs = [];
    for (const [id, { definition }] of this.jobs) {
      const lastRun = this.history.find(h => h.id === id);
      jobs.push({
        id,
        name:        definition.name,
        schedule:    definition.scheduleDescription || definition.schedule,
        enabled:     definition.enabled,
        lastStatus:  lastRun?.status ?? 'never run',
        lastRun:     lastRun?.firedAt ?? null,
      });
    }
    return jobs;
  }

  printSchedule() {
    console.log('\n');
    console.log('  \x1b[1m\x1b[36m━━━━ Active Schedule ━━━━\x1b[0m');
    for (const s of this.status()) {
      const badge = s.enabled ? '\x1b[32m●\x1b[0m' : '\x1b[90m○\x1b[0m';
      console.log(`  ${badge} \x1b[1m${s.name}\x1b[0m`);
      console.log(`    \x1b[90m${s.schedule}\x1b[0m`);
    }
    console.log('');
  }

  getHistory(limit = 20) {
    return this.history.slice(0, limit);
  }
}

module.exports = Scheduler;
