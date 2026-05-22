// agent-bridge.js — Drives GreytHR automation by require()-ing the
// workflow-*.js files from agent-flat at runtime and calling their .run()
// methods. We do not fork or copy those files — they remain the single
// source of truth for selectors, the OAuth login flow, and the shadow-DOM
// attendance click. The desktop app owns scheduling, credential delivery,
// notifications, and history.
//
// agent-flat's workflows expect:
//   await workflow.run(params, config)
// where params = { url?, username, password }
// and   config = BrowserController config (we pass a minimal default).

const path = require('path');
const cron = require('node-cron');
const { EventEmitter } = require('events');

class AgentBridge extends EventEmitter {
  constructor({ settingsStore, credentialStore, agentFlatPath }) {
    super();
    this.settingsStore = settingsStore;
    this.credentialStore = credentialStore;
    this.agentFlatPath = agentFlatPath;
    this.cronJobs = [];
    this.running = false;
    this.lastRunAt = null;
  }

  _log(text, level = 'info') {
    const entry = { at: new Date().toISOString(), level, text };
    console.log(`[agent-bridge] ${text}`);
    this.emit('log', entry);
  }

  // Lazy-load workflow on demand. Throws a clear error if not findable.
  _loadWorkflow(name) {
    const filePath = path.join(this.agentFlatPath, name);
    try {
      // Bust the cache so a re-read picks up changes during dev.
      delete require.cache[require.resolve(filePath)];
      return require(filePath);
    } catch (err) {
      throw new Error(
        `Could not load ${name} from ${this.agentFlatPath}: ${err.message}. ` +
        `Make sure agent-flat is installed alongside the app.`
      );
    }
  }

  start() {
    this._log('AgentBridge starting');
    this.rescheduleCron();
    // Catch up on schedules that already passed earlier today within a 2-hour
    // window — covers the "app started after the alarm should have fired" case.
    // Non-blocking: defer to next tick so start() returns immediately.
    setImmediate(() => { this._catchUpMissed().catch(() => {}); });
    this._log('AgentBridge started');
  }

  stop() {
    this._clearCron();
    this._log('AgentBridge stopped');
  }

  _clearCron() {
    for (const job of this.cronJobs) {
      try { job.stop(); } catch (_) {}
    }
    this.cronJobs = [];
  }

  rescheduleCron() {
    this._clearCron();
    const settings = this.settingsStore.getSettings();
    if (!settings.enabled) {
      this._log('automation disabled — no cron jobs registered');
      return;
    }
    const dows = settings.days
      .map((on, i) => on ? String(i) : null)
      .filter(Boolean)
      .join(',');
    if (!dows) {
      this._log('no days enabled — no cron jobs registered');
      return;
    }
    for (const action of ['signin', 'signout']) {
      const timeStr = action === 'signin' ? settings.signInTime : settings.signOutTime;
      const [hh, mm] = timeStr.split(':').map(n => parseInt(n, 10));
      const pattern = `${mm} ${hh} * * ${dows}`;
      try {
        const job = cron.schedule(pattern, () => this._handleAlarm(action), {
          scheduled: true,
          timezone: settings.timezone
        });
        this.cronJobs.push(job);
        this._log(`cron registered: ${action} at ${timeStr} (${pattern}, tz=${settings.timezone})`);
      } catch (err) {
        this._log(`cron registration failed for ${action}: ${err.message}`, 'error');
      }
    }
  }

  async _handleAlarm(action) {
    this._log(`alarm fired for ${action}`);
    await this.runOnce(action, 'alarm');
  }

  // Catch up on any schedule whose scheduled time today is in the past by
  // <= 2 hours. Called once from start() so an app that launches a few minutes
  // after a missed alarm still does the right thing.
  // Guards (in order): in-progress, automation off, paused, day disabled, holiday,
  // and a per-action recent-history check so a quick app restart doesn't double-fire.
  async _catchUpMissed() {
    if (this.running) {
      this._log('catch-up: skipped, a run is already in progress');
      return;
    }
    const skipCheck = this._shouldSkip();
    if (skipCheck.skip) {
      this._log(`catch-up: skipped (${skipCheck.reason})`);
      return;
    }

    const settings = this.settingsStore.getSettings();
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const now = new Date();
    const todayStr = todayDateString();
    const history = this.settingsStore.getHistory();

    // Collect first, fire second — so two missed actions run sequentially rather
    // than racing each other into the busy-check in runOnce().
    const toFire = [];
    for (const action of ['signin', 'signout']) {
      const timeStr = action === 'signin' ? settings.signInTime : settings.signOutTime;
      const [hh, mm] = timeStr.split(':').map(n => parseInt(n, 10));
      const scheduled = new Date(now);
      scheduled.setHours(hh, mm, 0, 0);

      const diffMs = now.getTime() - scheduled.getTime();
      if (diffMs <= 0) continue;             // still in the future today
      if (diffMs > TWO_HOURS_MS) continue;   // missed too long ago

      // Skip if a run for this action already happened today within the 2-hour
      // window — covers the case where the app restarts shortly after a catch-up.
      const ranRecently = history.some(h =>
        h.action === action &&
        h.firedAt &&
        h.firedAt.startsWith(todayStr) &&
        (now.getTime() - new Date(h.firedAt).getTime()) <= TWO_HOURS_MS
      );
      if (ranRecently) continue;

      toFire.push({ action, timeStr });
    }

    for (const { action, timeStr } of toFire) {
      this._log(`catch-up: missed ${action} at ${timeStr}, firing now`);
      await this.runOnce(action, 'catch-up');
    }
  }

  // The single entry point for any workflow run, alarm-driven or manual.
  async runOnce(action, trigger) {
    if (this.running) {
      this._log(`runOnce ${action} ignored — another run is in progress`, 'warn');
      return { ok: false, error: 'busy' };
    }
    this.running = true;
    this.lastRunAt = new Date().toISOString();
    this.emit('state-change', { running: true, action });

    const runId = mkRunId();
    const startedAt = new Date().toISOString();
    let result = null;

    try {
      // Skip checks (only apply to alarm-triggered runs; manual always runs).
      const skipCheck = this._shouldSkip();
      if (skipCheck.skip && trigger === 'alarm') {
        this.settingsStore.appendHistory({
          id: runId, firedAt: startedAt, action,
          status: 'skipped', trigger, reason: skipCheck.reason
        });
        this.settingsStore.appendLifecycle('run_skipped', { runId, reason: skipCheck.reason });
        this._log(`skipped: ${skipCheck.reason}`);
        result = { ok: true, skipped: true, reason: skipCheck.reason };
        return result;
      }

      const credentials = await this.credentialStore.getCredentials();
      if (!credentials) {
        this.settingsStore.appendHistory({
          id: runId, firedAt: startedAt, action,
          status: 'failure', trigger,
          error: 'No credentials saved.'
        });
        this.emit('notify', {
          title: 'GreytHR automation',
          message: 'Cannot run: no credentials saved.'
        });
        result = { ok: false, error: 'no_credentials' };
        return result;
      }

      // Choose which workflow file to run.
      let workflowFile;
      if (action === 'signin' || action === 'test_login') {
        workflowFile = 'workflow-greyhr-login.js';
      } else if (action === 'signout') {
        workflowFile = 'workflow-greyhr-logout.js';
      } else {
        throw new Error('Unknown action: ' + action);
      }

      const workflow = this._loadWorkflow(workflowFile);
      const params = {
        username: credentials.username,
        password: credentials.password
      };
      // BrowserController config:
      //   headless:false — always visible. Headless triggers GreytHR's
      //     anti-bot CAPTCHA and gives users no visibility into runs.
      //   openMinimized ← user setting. When true, the window opens
      //     minimized to the taskbar so it doesn't steal focus. When false,
      //     the window opens normally on top of everything.
      //   useRealChrome:false → fresh Chromium each run, no profile lock
      //     conflict with the user's everyday Chrome.
      const settings = this.settingsStore.getSettings();
      const browserConfig = {
        agent: {
          useRealChrome: false,
          headless: false,
          slowMo: 50,
          openMinimized: !!settings.openMinimized
        }
      };
      this._log(`browser mode: ${settings.openMinimized ? 'minimized' : 'visible'}`);

      this._log(`running ${workflowFile}`);
      const workflowResult = await workflow.run(params, browserConfig);

      // Workflows now signal idempotent runs via outcome: 'already_done'.
      // Absence of outcome means a real click happened — default to 'done'.
      const outcome = (workflowResult && workflowResult.outcome === 'already_done')
        ? 'already_done'
        : 'done';

      const durationMs = Date.now() - new Date(startedAt).getTime();
      this.settingsStore.appendHistory({
        id: runId, firedAt: startedAt, action,
        status: 'success', result: outcome, trigger, durationMs
      });
      this.settingsStore.appendLifecycle('run_result', { runId, status: 'success', result: outcome });
      this._log(`${action} ${outcome === 'already_done' ? 'already done' : 'succeeded'} in ${durationMs}ms`);

      if (settings.notifyOnSuccess && action !== 'test_login') {
        this.emit('notify', {
          title: 'GreytHR ' + (action === 'signin' ? 'Sign In' : 'Sign Out'),
          message: 'Done at ' + new Date().toLocaleTimeString()
        });
      }
      result = { ok: true, runId };
    } catch (err) {
      const errMsg = err && err.message ? err.message : String(err);
      this._log(`${action} failed: ${errMsg}`, 'error');
      this.settingsStore.appendHistory({
        id: runId, firedAt: startedAt, action,
        status: 'failure', trigger, error: errMsg
      });
      this.settingsStore.appendLifecycle('run_result', { runId, status: 'failure', error: errMsg });
      const settings = this.settingsStore.getSettings();
      if (settings.notifyOnFailure) {
        this.emit('notify', {
          title: 'GreytHR ' +
            (action === 'signin' ? 'Sign In' :
             action === 'signout' ? 'Sign Out' : 'Test') + ' failed',
          message: errMsg.slice(0, 120)
        });
      }
      result = { ok: false, error: errMsg };
    } finally {
      this.running = false;
      this.emit('state-change', { running: false });
    }

    return result;
  }

  _shouldSkip() {
    const settings = this.settingsStore.getSettings();
    if (!settings.enabled) return { skip: true, reason: 'automation_off' };
    const today = todayDateString();
    const pause = this.settingsStore.getPause();
    if (pause.pauseToday === today) return { skip: true, reason: 'paused_today' };
    if (pause.pauseUntil && today <= pause.pauseUntil) return { skip: true, reason: 'paused_until' };
    const dow = new Date().getDay();
    if (!settings.days[dow]) return { skip: true, reason: 'day_disabled' };
    const holidays = this.settingsStore.getHolidays();
    if (holidays.some(h => h.date === today)) return { skip: true, reason: 'holiday' };
    return { skip: false };
  }

  isRunning() {
    return this.running;
  }

  // Compute the next fire time for a given action, considering settings.
  getNextRun(action) {
    const settings = this.settingsStore.getSettings();
    if (!settings.enabled) return null;
    const timeStr = action === 'signin' ? settings.signInTime : settings.signOutTime;
    const [hh, mm] = timeStr.split(':').map(n => parseInt(n, 10));
    const now = new Date();
    for (let i = 0; i < 8; i++) {
      const c = new Date(now);
      c.setDate(now.getDate() + i);
      c.setHours(hh, mm, 0, 0);
      if (c <= now) continue;
      if (!settings.days[c.getDay()]) continue;
      return c.toISOString();
    }
    return null;
  }
}

function mkRunId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

module.exports = { AgentBridge };
