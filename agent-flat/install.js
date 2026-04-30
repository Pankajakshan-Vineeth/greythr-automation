#!/usr/bin/env node
'use strict';

/**
 * Setup script — installs dependencies and validates the environment
 */

const { execSync, exec } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const colors = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
};

const c = (color, text) => `${colors[color]}${text}${colors.reset}`;

console.log(`
${c('bold', c('cyan', '  ⚡ Smart Automation Agent — Setup'))}
  ${'─'.repeat(40)}
`);

let hasErrors = false;

// ── Step 1: Check Node version ──────────────────────────────
step('Checking Node.js version');
const nodeMajor = parseInt(process.version.slice(1).split('.')[0], 10);
if (nodeMajor < 18) {
  fail(`Node.js 18+ required. You have ${process.version}`);
  hasErrors = true;
} else {
  ok(`Node.js ${process.version}`);
}

// ── Step 2: Install npm packages ────────────────────────────
step('Installing npm dependencies');
try {
  execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
  ok('npm packages installed');
} catch (err) {
  fail('npm install failed: ' + err.message);
  hasErrors = true;
}

// ── Step 3: Install Playwright browsers ─────────────────────
step('Installing Playwright Chromium browser');
try {
  execSync('npx playwright install chromium', { cwd: ROOT, stdio: 'inherit' });
  ok('Chromium installed');
} catch (err) {
  fail('Playwright browser install failed: ' + err.message);
  hasErrors = true;
}

// ── Step 4: Create .env from template ───────────────────────
step('Setting up environment file');
const envPath    = path.join(ROOT, '.env');
const exampleEnv = path.join(ROOT, '.env.example');

if (!fs.existsSync(envPath)) {
  fs.copyFileSync(exampleEnv, envPath);
  ok('.env created from .env.example');
  warn('⚠  Edit .env and add your Zoho credentials before running!');
} else {
  ok('.env already exists');
}

// ── Step 5: Create logs directory ───────────────────────────
const logsDir = path.join(ROOT, 'logs', 'screenshots');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
ok('Logs directory ready');

// ── Step 6: Generate platform-specific autostart guide ──────
step('Generating autostart configuration');
generateAutostartGuide(ROOT);
ok('Autostart guide written to autostart-guide.md');

// ── Summary ──────────────────────────────────────────────────
console.log(`\n  ${'─'.repeat(40)}`);
if (hasErrors) {
  console.log(`  ${c('red', c('bold', '✖ Setup completed with errors. Fix the issues above before running.'))}`);
} else {
  console.log(`  ${c('green', c('bold', 'Setup complete!'))}\n`);
  console.log(`  Next steps:`);
  console.log(`  ${c('dim', '1.')} Edit ${c('cyan', '.env')} and add your Zoho credentials`);
  console.log(`  ${c('dim', '2.')} Review ${c('cyan', 'config.json')} and adjust schedules/workflows`);
  console.log(`  ${c('dim', '3.')} Test: ${c('cyan', 'node agent.js --test')}`);
  console.log(`  ${c('dim', '4.')} Run:  ${c('cyan', 'node agent.js')}`);
  console.log(`  ${c('dim', '5.')} Manual check-in: ${c('cyan', 'node agent.js --run zoho-checkin')}`);
  console.log(`\n  Dashboard: ${c('cyan', 'http://localhost:3737')} (when running)\n`);
}

// ── Helpers ──────────────────────────────────────────────────

function step(msg)  { console.log(`\n  ${c('cyan', '→')} ${msg}…`); }
function ok(msg)    { console.log(`    ${c('green', '✔')} ${msg}`); }
function fail(msg)  { console.log(`    ${c('red', '✖')} ${msg}`); }
function warn(msg)  { console.log(`    ${c('yellow', '!')} ${msg}`); }

function generateAutostartGuide(root) {
  const platform = process.platform;
  const agentPath = path.join(root, 'agent.js');
  const guidePath = path.join(root, 'autostart-guide.md');

  const guide = `# Autostart Guide — Smart Automation Agent

This guide shows how to make the agent start automatically when your computer boots.

---

## macOS — LaunchAgent (Recommended)

Create \`~/Library/LaunchAgents/com.automation-agent.plist\`:

\`\`\`xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.automation-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${agentPath}</string>
    <string>--silent</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${root}</string>
  <key>StandardOutPath</key>
  <string>${root}/logs/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${root}/logs/stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
\`\`\`

Then run:
\`\`\`bash
launchctl load ~/Library/LaunchAgents/com.automation-agent.plist
launchctl start com.automation-agent
\`\`\`

To stop: \`launchctl stop com.automation-agent\`
To unload: \`launchctl unload ~/Library/LaunchAgents/com.automation-agent.plist\`

---

## Linux — systemd User Service

Create \`~/.config/systemd/user/automation-agent.service\`:

\`\`\`ini
[Unit]
Description=Smart Automation Agent
After=network.target graphical-session.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${process.execPath} ${agentPath} --silent
WorkingDirectory=${root}
Restart=on-failure
RestartSec=10
Environment=DISPLAY=:0
EnvironmentFile=${root}/.env

[Install]
WantedBy=default.target
\`\`\`

Then run:
\`\`\`bash
systemctl --user daemon-reload
systemctl --user enable automation-agent
systemctl --user start automation-agent
systemctl --user status automation-agent
\`\`\`

View logs: \`journalctl --user -u automation-agent -f\`

---

## Windows — Task Scheduler

Run in PowerShell as Administrator:

\`\`\`powershell
$trigger = New-ScheduledTaskTrigger -AtLogon
$action  = New-ScheduledTaskAction \`
  -Execute "${process.execPath}" \`
  -Argument "${agentPath} --silent" \`
  -WorkingDirectory "${root}"
$settings = New-ScheduledTaskSettingsSet \`
  -ExecutionTimeLimit 0 \`
  -RestartCount 3 \`
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask \`
  -TaskName "SmartAutomationAgent" \`
  -Trigger $trigger \`
  -Action $action \`
  -Settings $settings \`
  -RunLevel Highest \`
  -Force
\`\`\`

Or use **pm2** (cross-platform, recommended):

\`\`\`bash
npm install -g pm2
pm2 start ${agentPath} --name "automation-agent"
pm2 startup          # generates autostart command
pm2 save             # saves the process list
\`\`\`

---

## Cross-Platform — PM2 (Easiest)

\`\`\`bash
npm install -g pm2
cd ${root}
pm2 start agent.js --name "automation-agent" --log logs/pm2.log
pm2 startup                              # follow the printed command
pm2 save
pm2 monit                                # live dashboard
\`\`\`

**Useful PM2 commands:**
- \`pm2 list\`            — show all managed processes
- \`pm2 logs automation-agent\`  — tail logs
- \`pm2 restart automation-agent\`
- \`pm2 stop automation-agent\`
- \`pm2 delete automation-agent\`

---

## Verifying It Works

Once the agent is running, open: http://localhost:3737

You should see the live dashboard with all scheduled workflows.
`;

  fs.writeFileSync(guidePath, guide, 'utf8');
}
