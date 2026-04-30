# ⚡ Smart Automation Agent

A personal **RPA (Robotic Process Automation)** platform built with Node.js and Playwright. Runs as a background service on your computer, executing scheduled browser workflows automatically — like clocking in/out of Zoho People every workday.

---

## Features

- **Scheduled workflows** via cron expressions (powered by `node-cron`)
- **Playwright browser automation** — headless Chromium, anti-detection headers
- **Smart selectors** — CSS primary + XPath fallbacks + text matching
- **Session persistence** — reuses saved cookies to skip login on repeat runs
- **Auto-retry** — configurable retry logic on failure
- **Desktop notifications** — native OS notifications on success/failure
- **Webhook support** — push results to Slack, Discord, or any webhook
- **Live dashboard** — web UI at `http://localhost:3737`
- **Screenshot logging** — captures before/after screenshots for debugging
- **Graceful shutdown** — handles SIGINT/SIGTERM cleanly
- **Cross-platform autostart** — setup guides for macOS, Linux, Windows, PM2

---

## Quick Start

### 1. Install

```bash
git clone <this-repo>
cd smart-automation-agent
node install.js
```

This installs npm packages, downloads Playwright's Chromium, and creates your `.env` file.

### 2. Configure credentials

Edit `.env`:
```env
ZOHO_EMAIL=your.email@company.com
ZOHO_PASSWORD=your_zoho_password
```

### 3. Review the schedule

Edit `config.json` — the default schedule is:
- **9:30 AM Mon–Fri** → Zoho Check-In
- **6:30 PM Mon–Fri** → Zoho Check-Out

### 4. Test the configuration

```bash
node agent.js --test
```

### 5. Run a manual check-in (first run)

```bash
node agent.js --run zoho-checkin
```

This verifies login and button detection work before the scheduled runs.

### 6. Start the agent

```bash
node agent.js
```

---

## Directory Structure

```
smart-automation-agent/
├── agent.js              # Main entry point & CLI
├── scheduler.js          # Cron scheduler
├── browser.js            # Playwright controller
├── workflow-runner.js    # Workflow loader & retry logic
├── health-server.js      # HTTP dashboard (port 3737)
├── notifier.js           # Desktop/webhook notifications
├── logger.js             # Winston logger
├── config.json           # ← Main configuration file
├── .env                  # ← Your credentials (not committed)
├── .env.example          # Template
├── workflows/
│   ├── zoho-attendance.js   # Zoho check-in/out
│   └── navigate-and-click.js # Generic workflow template
├── logs/
│   ├── agent.log            # Main log (last 7 days)
│   ├── errors.log           # Error log
│   └── screenshots/         # Automation screenshots
└── setup/
    ├── install.js           # Setup script
    └── autostart-guide.md   # OS-specific autostart instructions
```

---

## Configuration Reference

### `config.json`

```json
{
  "agent": {
    "headless": true,          // Run browser invisibly
    "slowMo": 150,             // MS delay between actions (more human-like)
    "maxRetries": 3,           // Retry failed workflows N times
    "retryDelay": 5000,        // Wait (ms) between retries
    "timezone": "Asia/Kolkata",
    "notificationsEnabled": true,
    "screenshotOnFailure": true
  },
  "workflows": [
    {
      "id": "my-workflow",
      "name": "Human-readable name",
      "enabled": true,
      "schedule": "30 9 * * 1-5",    // Standard cron expression
      "scheduleDescription": "Weekdays at 9:30 AM",
      "timezone": "Asia/Kolkata",
      "workflow": "zoho-attendance",  // Module name in workflows/
      "params": { ... }               // Passed to the workflow's run()
    }
  ]
}
```

### Cron Expression Reference

```
┌─── minute (0-59)
│  ┌─── hour (0-23)
│  │  ┌─── day of month (1-31)
│  │  │  ┌─── month (1-12)
│  │  │  │  ┌─── day of week (0=Sun, 1=Mon … 5=Fri, 6=Sat)
│  │  │  │  │
30  9  *  *  1-5     →  9:30 AM, Monday through Friday
30 18  *  *  1-5     →  6:30 PM, Monday through Friday
 0  8  *  *  *       →  8:00 AM every day
```

---

## CLI Reference

| Command | Description |
|---------|-------------|
| `node agent.js` | Start the scheduler (runs forever) |
| `node agent.js --run zoho-checkin` | Run a specific workflow immediately |
| `node agent.js --run zoho-checkout` | Run check-out manually |
| `node agent.js --list` | List all configured workflows |
| `node agent.js --test` | Validate config + cron expressions |
| `node agent.js --silent` | No console output (log to file only) |
| `node agent.js --help` | Show help |

---

## Writing Custom Workflows

Create a new file in `workflows/my-workflow.js`:

```javascript
'use strict';

const BrowserController = require('../browser');
const logger = require('../logger');

async function run(params, config) {
  const log = logger.workflow('my-workflow');
  const browser = new BrowserController(config);

  await browser.launch();
  try {
    await browser.navigate(params.url);
    await browser.waitForSelector(params.selector);
    await browser.smartClick(params.selector, params.fallbacks);
    await browser.screenshot('result');
    return { success: true };
  } finally {
    await browser.close();
  }
}

module.exports = { run };
```

Register it in `workflow-runner.js`:
```javascript
this.registry['my-workflow'] = './workflows/my-workflow';
```

Then add it to `config.json`:
```json
{
  "id": "my-task",
  "workflow": "my-workflow",
  "schedule": "0 10 * * *",
  "params": { "url": "https://example.com", "selector": "#submit" }
}
```

---

## Dashboard

While the agent is running, open **http://localhost:3737** to see:
- All scheduled workflows and their status
- Execution history with timestamps
- Manual "Run Now" buttons for any workflow

---

## Autostart

To make the agent start on boot, follow the guide generated at `setup/autostart-guide.md`.

**Quickest option (all platforms):**
```bash
npm install -g pm2
pm2 start agent.js --name "automation-agent"
pm2 startup   # follow the printed command
pm2 save
```

---

## Troubleshooting

**"Check-In button not found"**
- Zoho may have updated their UI. Open `logs/debug-checkin.html` in a browser to inspect the page state.
- Update the selectors in `workflows/zoho-attendance.js` or `config.json`.
- Run with `"headless": false` in `config.json` to watch the browser.

**"Zoho credentials not configured"**
- Ensure `.env` exists with `ZOHO_EMAIL` and `ZOHO_PASSWORD` set.

**Login loop / 2FA**
- Zoho MFA can block automated login. Consider using an app-specific password or disabling MFA for this account.
- If the session file exists (`logs/session-*.json`), the agent skips login on subsequent runs.

**Browser doesn't launch on Linux**
- Run `npx playwright install-deps chromium` to install system dependencies.

---

## Security Notes

- Credentials live in `.env` — never commit this file.
- Session files in `logs/session-*.json` contain cookies — treat them as sensitive.
- The health dashboard binds to `127.0.0.1` only (localhost), not exposed to the network.
- All browser traffic goes through your normal system proxy/network.
