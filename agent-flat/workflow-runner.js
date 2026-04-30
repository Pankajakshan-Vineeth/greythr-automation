'use strict';

const path   = require('path');
const logger = require('./logger');

/**
 * WorkflowRunner — loads and executes named workflow modules
 * with retry logic and timing instrumentation.
 */
class WorkflowRunner {
  constructor(config) {
    this.config = config;

    // Registry maps workflow IDs → module paths
    this.registry = {
      'greyhr-login':       './workflow-greyhr-login',
      'greyhr-logout':      './workflow-greyhr-logout',
      'navigate-and-click': './workflow-navigate-and-click',
    };
  }

  /**
   * Execute a workflow definition from config
   */
  async execute(workflowDef) {
    const log = logger.workflow(workflowDef.id);
    const maxRetries = this.config.agent?.maxRetries ?? 3;
    const retryDelay = this.config.agent?.retryDelay ?? 5000;

    log.info(`▶ Starting workflow: "${workflowDef.name}"`);
    const startTime = Date.now();

    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          log.warn(`Retry ${attempt}/${maxRetries} after ${retryDelay / 1000}s…`);
          await sleep(retryDelay);
        }

        const result = await this.runOnce(workflowDef, log);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        log.info(`Workflow completed in ${elapsed}s`, { result });
        return { ...result, attempts: attempt, duration: elapsed };

      } catch (err) {
        lastError = err;
        log.error(`Attempt ${attempt} failed: ${err.message}`);

        if (attempt === maxRetries) {
          log.error(`All ${maxRetries} attempts failed for "${workflowDef.name}"`);
        }
      }
    }

    throw lastError;
  }

  /**
   * Single execution attempt
   */
  async runOnce(workflowDef, log) {
    const moduleName = workflowDef.workflow;

    if (!this.registry[moduleName]) {
      throw new Error(`Unknown workflow: "${moduleName}". Available: ${Object.keys(this.registry).join(', ')}`);
    }

    const modulePath = path.resolve(__dirname, this.registry[moduleName]);

    // Clear require cache for hot-reload during development
    if (process.env.NODE_ENV === 'development') {
      delete require.cache[require.resolve(modulePath)];
    }

    const workflowModule = require(modulePath);

    if (typeof workflowModule.run !== 'function') {
      throw new Error(`Workflow module "${moduleName}" must export a run() function`);
    }

    return workflowModule.run(workflowDef.params || {}, this.config);
  }

  /**
   * Register a custom workflow at runtime
   */
  register(name, modulePath) {
    this.registry[name] = modulePath;
    logger.info(`Registered custom workflow: ${name}`);
  }

  /**
   * List all registered workflows
   */
  list() {
    return Object.keys(this.registry);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = WorkflowRunner;
