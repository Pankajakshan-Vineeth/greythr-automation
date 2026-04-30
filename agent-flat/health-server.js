// 'use strict';

// const http   = require('http');
// const logger = require('./logger');

// /**
//  * HealthServer — lightweight HTTP server for status monitoring
//  * GET /health  → JSON status of all scheduled jobs + recent history
//  * GET /         → HTML dashboard
//  */
// class HealthServer {
//   constructor(scheduler, config) {
//     this.scheduler = scheduler;
//     this.config    = config;
//     this.server    = null;
//   }

//   start() {
//     const cfg  = this.config.healthCheck || {};
//     const port = parseInt(process.env.HEALTH_CHECK_PORT || cfg.port || 3737, 10);

//     if (!cfg.enabled) return;

//     this.server = http.createServer((req, res) => {
//       this.handleRequest(req, res);
//     });

//     this.server.listen(port, '127.0.0.1', () => {
//       logger.info(`Health check server running: http://127.0.0.1:${port}/health`);
//     });

//     this.server.on('error', (err) => {
//       logger.warn(`Health server error: ${err.message}`);
//     });
//   }

//   handleRequest(req, res) {
//     const url = req.url.split('?')[0];

//     if (url === '/health' || url === '/status') {
//       const data = {
//         status:    'running',
//         uptime:    Math.floor(process.uptime()),
//         timestamp: new Date().toISOString(),
//         jobs:      this.scheduler.status(),
//         history:   this.scheduler.getHistory(10),
//       };
//       res.writeHead(200, { 'Content-Type': 'application/json' });
//       res.end(JSON.stringify(data, null, 2));

//     } else if (url === '/') {
//       res.writeHead(200, { 'Content-Type': 'text/html' });
//       res.end(this.renderDashboard());

//     } else if (url === '/run' && req.method === 'POST') {
//       let body = '';
//       req.on('data', chunk => body += chunk);
//       req.on('end', async () => {
//         try {
//           const { id } = JSON.parse(body);
//           await this.scheduler.runNow(id);
//           res.writeHead(200, { 'Content-Type': 'application/json' });
//           res.end(JSON.stringify({ ok: true }));
//         } catch (err) {
//           res.writeHead(500, { 'Content-Type': 'application/json' });
//           res.end(JSON.stringify({ error: err.message }));
//         }
//       });

//     } else {
//       res.writeHead(404);
//       res.end('Not found');
//     }
//   }

//   renderDashboard() {
//     const jobs    = this.scheduler.status();
//     const history = this.scheduler.getHistory(20);
//     const uptime  = formatUptime(process.uptime());

//     const jobRows = jobs.map(j => `
//       <tr>
//         <td><span class="badge ${j.enabled ? 'active' : 'inactive'}">${j.enabled ? 'Active' : 'Paused'}</span></td>
//         <td><strong>${esc(j.name)}</strong><br><small>${esc(j.id)}</small></td>
//         <td>${esc(j.schedule)}</td>
//         <td><span class="status ${j.lastStatus}">${esc(j.lastStatus)}</span></td>
//         <td>${j.lastRun ? new Date(j.lastRun).toLocaleString() : '—'}</td>
//         <td><button onclick="runNow('${esc(j.id)}')">▶ Run Now</button></td>
//       </tr>
//     `).join('');

//     const historyRows = history.map(h => `
//       <tr>
//         <td>${new Date(h.firedAt).toLocaleString()}</td>
//         <td>${esc(h.name)}</td>
//         <td><span class="status ${h.status}">${esc(h.status)}</span></td>
//         <td>${h.error ? `<span class="err">${esc(h.error)}</span>` : '—'}</td>
//       </tr>
//     `).join('');

//     return `<!DOCTYPE html>
// <html lang="en">
// <head>
// <meta charset="UTF-8">
// <meta name="viewport" content="width=device-width,initial-scale=1">
// <title>Automation Agent Dashboard</title>
// <style>
//   * { box-sizing: border-box; margin: 0; padding: 0; }
//   body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e2e8f0; min-height: 100vh; }
//   header { background: linear-gradient(135deg, #1a1f2e 0%, #16213e 100%); padding: 24px 32px; border-bottom: 1px solid #2d3748; }
//   header h1 { font-size: 1.5rem; font-weight: 700; color: #63b3ed; }
//   header p  { font-size: 0.875rem; color: #718096; margin-top: 4px; }
//   .meta { display: flex; gap: 24px; margin-top: 12px; }
//   .meta span { font-size: 0.8rem; color: #4a5568; }
//   .meta b { color: #a0aec0; }
//   main { padding: 32px; max-width: 1100px; margin: 0 auto; }
//   h2 { font-size: 1rem; font-weight: 600; color: #a0aec0; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 16px; margin-top: 32px; }
//   table { width: 100%; border-collapse: collapse; background: #1a1f2e; border-radius: 8px; overflow: hidden; }
//   th { text-align: left; padding: 12px 16px; font-size: 0.75rem; font-weight: 600; color: #4a5568; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #2d3748; }
//   td { padding: 12px 16px; border-bottom: 1px solid #1e2434; font-size: 0.875rem; vertical-align: middle; }
//   tr:last-child td { border-bottom: none; }
//   tr:hover td { background: #1e2434; }
//   .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; }
//   .badge.active   { background: #1a3a2a; color: #48bb78; }
//   .badge.inactive { background: #2d3748; color: #718096; }
//   .status { font-weight: 600; }
//   .status.success { color: #48bb78; }
//   .status.error   { color: #fc8181; }
//   .status.running { color: #f6ad55; }
//   .status.never\ run { color: #4a5568; }
//   .err { color: #fc8181; font-size: 0.8rem; }
//   button { background: #2b6cb0; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: background 0.2s; }
//   button:hover { background: #3182ce; }
//   small { color: #4a5568; font-size: 0.75rem; }
//   .refresh { float: right; font-size: 0.8rem; color: #4a5568; }
// </style>
// </head>
// <body>
// <header>
//   <h1>⚡ Smart Automation Agent</h1>
//   <p>Personal RPA Dashboard</p>
//   <div class="meta">
//     <span>Uptime: <b>${uptime}</b></span>
//     <span>Node: <b>${process.version}</b></span>
//     <span>PID: <b>${process.pid}</b></span>
//     <span>Updated: <b id="ts">${new Date().toLocaleTimeString()}</b></span>
//   </div>
// </header>
// <main>
//   <h2>Scheduled Workflows</h2>
//   <table>
//     <thead><tr><th>Status</th><th>Workflow</th><th>Schedule</th><th>Last Run</th><th>Last At</th><th>Action</th></tr></thead>
//     <tbody>${jobRows || '<tr><td colspan="6" style="color:#4a5568;text-align:center;padding:24px">No workflows scheduled</td></tr>'}</tbody>
//   </table>

//   <h2>Execution History <span class="refresh"><a href="/" style="color:#4a5568;text-decoration:none">↻ Refresh</a></span></h2>
//   <table>
//     <thead><tr><th>Time</th><th>Workflow</th><th>Status</th><th>Error</th></tr></thead>
//     <tbody>${historyRows || '<tr><td colspan="4" style="color:#4a5568;text-align:center;padding:24px">No runs yet</td></tr>'}</tbody>
//   </table>
// </main>
// <script>
//   async function runNow(id) {
//     if (!confirm('Run "' + id + '" now?')) return;
//     const res = await fetch('/run', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({id}) });
//     const data = await res.json();
//     if (data.ok) { alert('Workflow triggered! Check logs for results.'); location.reload(); }
//     else alert('Error: ' + data.error);
//   }
//   setInterval(() => {
//     document.getElementById('ts').textContent = new Date().toLocaleTimeString();
//   }, 1000);
// </script>
// </body>
// </html>`;
//   }

//   stop() {
//     if (this.server) {
//       this.server.close();
//       logger.info('Health server stopped');
//     }
//   }
// }

// function formatUptime(seconds) {
//   const h = Math.floor(seconds / 3600);
//   const m = Math.floor((seconds % 3600) / 60);
//   const s = Math.floor(seconds % 60);
//   return [h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(' ');
// }

// function esc(str) {
//   return String(str || '')
//     .replace(/&/g, '&amp;')
//     .replace(/</g, '&lt;')
//     .replace(/>/g, '&gt;')
//     .replace(/"/g, '&quot;');
// }

// module.exports = HealthServer;

'use strict';

const http   = require('http');
const { exec } = require('child_process');
const logger = require('./logger');

/**
 * HealthServer — HTTP server for status monitoring + extension control
 *
 * GET  /health         → JSON status
 * GET  /               → HTML dashboard
 * POST /run            → trigger a workflow by ID
 * POST /agent/start    → start the PM2 zoho-agent process
 * POST /agent/stop     → stop the PM2 zoho-agent process
 */
class HealthServer {
  constructor(scheduler, config) {
    this.scheduler = scheduler;
    this.config    = config;
    this.server    = null;
  }

  start() {
    const cfg  = this.config.healthCheck || {};
    const port = parseInt(process.env.HEALTH_CHECK_PORT || cfg.port || 3737, 10);

    if (!cfg.enabled) return;

    this.server = http.createServer((req, res) => {
      // Allow Chrome extension (localhost) to call us
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      this.handleRequest(req, res);
    });

    this.server.listen(port, '127.0.0.1', () => {
      logger.info(`Health check server running: http://127.0.0.1:${port}/health`);
    });

    this.server.on('error', (err) => {
      logger.warn(`Health server error: ${err.message}`);
    });
  }

  handleRequest(req, res) {
    const url = req.url.split('?')[0];

    // ── GET /health ───────────────────────────────────────────
    if ((url === '/health' || url === '/status') && req.method === 'GET') {
      const data = {
        status:    'running',
        uptime:    Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        jobs:      this.scheduler.status(),
        history:   this.scheduler.getHistory(10),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
      return;
    }

    // ── GET / — HTML dashboard ────────────────────────────────
    if (url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(this.renderDashboard());
      return;
    }

    // ── POST /run — trigger a workflow ─────────────────────────
    if (url === '/run' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { id } = JSON.parse(body);
          await this.scheduler.runNow(id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // ── POST /agent/start — start PM2 zoho-agent ─────────────
    if (url === '/agent/start' && req.method === 'POST') {
      runPM2Command('start', res);
      return;
    }

    // ── POST /agent/stop — stop PM2 zoho-agent ───────────────
    if (url === '/agent/stop' && req.method === 'POST') {
      runPM2Command('stop', res);
      return;
    }

    // ── 404 ───────────────────────────────────────────────────
    res.writeHead(404);
    res.end('Not found');
  }

  stop() {
    if (this.server) {
      this.server.close();
      logger.info('Health server stopped');
    }
  }

  renderDashboard() {
    const jobs    = this.scheduler.status();
    const history = this.scheduler.getHistory(20);
    const uptime  = formatUptime(process.uptime());

    const jobRows = jobs.map(j => `
      <tr>
        <td><span class="badge ${j.enabled ? 'active' : 'inactive'}">${j.enabled ? 'Active' : 'Paused'}</span></td>
        <td><strong>${esc(j.name)}</strong><br><small>${esc(j.id)}</small></td>
        <td>${esc(j.schedule)}</td>
        <td><span class="status ${j.lastStatus}">${esc(j.lastStatus)}</span></td>
        <td>${j.lastRun ? new Date(j.lastRun).toLocaleString() : '—'}</td>
        <td><button onclick="runNow('${esc(j.id)}')">▶ Run Now</button></td>
      </tr>
    `).join('');

    const historyRows = history.map(h => `
      <tr>
        <td>${new Date(h.firedAt).toLocaleString()}</td>
        <td>${esc(h.name)}</td>
        <td><span class="status ${h.status}">${esc(h.status)}</span></td>
        <td>${h.error ? `<span class="err">${esc(h.error)}</span>` : '—'}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Automation Agent Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e2e8f0; min-height: 100vh; }
  header { background: linear-gradient(135deg, #1a1f2e 0%, #16213e 100%); padding: 24px 32px; border-bottom: 1px solid #2d3748; }
  header h1 { font-size: 1.5rem; font-weight: 700; color: #63b3ed; }
  header p  { font-size: 0.875rem; color: #718096; margin-top: 4px; }
  .meta { display: flex; gap: 24px; margin-top: 12px; }
  .meta span { font-size: 0.8rem; color: #4a5568; }
  .meta b { color: #a0aec0; }
  .controls { display: flex; gap: 10px; margin-top: 16px; }
  .ctrl-btn { padding: 8px 18px; border-radius: 6px; border: none; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: 0.2s; }
  .ctrl-btn.start { background: #22543d; color: #48bb78; }
  .ctrl-btn.stop  { background: #742a2a; color: #fc8181; }
  .ctrl-btn:hover { opacity: 0.85; transform: translateY(-1px); }
  main { padding: 32px; max-width: 1100px; margin: 0 auto; }
  h2 { font-size: 1rem; font-weight: 600; color: #a0aec0; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 16px; margin-top: 32px; }
  table { width: 100%; border-collapse: collapse; background: #1a1f2e; border-radius: 8px; overflow: hidden; }
  th { text-align: left; padding: 12px 16px; font-size: 0.75rem; font-weight: 600; color: #4a5568; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #2d3748; }
  td { padding: 12px 16px; border-bottom: 1px solid #1e2434; font-size: 0.875rem; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #1e2434; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; }
  .badge.active   { background: #1a3a2a; color: #48bb78; }
  .badge.inactive { background: #2d3748; color: #718096; }
  .status { font-weight: 600; }
  .status.success { color: #48bb78; }
  .status.error   { color: #fc8181; }
  .status.running { color: #f6ad55; }
  .status.never\ run { color: #4a5568; }
  .err { color: #fc8181; font-size: 0.8rem; }
  button { background: #2b6cb0; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: background 0.2s; }
  button:hover { background: #3182ce; }
  small { color: #4a5568; font-size: 0.75rem; }
</style>
</head>
<body>
<header>
  <h1>⚡ Smart Automation Agent</h1>
  <p>Personal RPA Dashboard</p>
  <div class="meta">
    <span>Uptime: <b>${uptime}</b></span>
    <span>Node: <b>${process.version}</b></span>
    <span>PID: <b>${process.pid}</b></span>
  </div>
  <div class="controls">
    <button class="ctrl-btn start" onclick="agentControl('start')">▶ Start Agent</button>
    <button class="ctrl-btn stop"  onclick="agentControl('stop')">⏹ Stop Agent</button>
  </div>
</header>
<main>
  <h2>Scheduled Workflows</h2>
  <table>
    <thead><tr><th>Status</th><th>Workflow</th><th>Schedule</th><th>Last Run</th><th>Last At</th><th>Action</th></tr></thead>
    <tbody>${jobRows || '<tr><td colspan="6" style="color:#4a5568;text-align:center;padding:24px">No workflows scheduled</td></tr>'}</tbody>
  </table>

  <h2>Execution History</h2>
  <table>
    <thead><tr><th>Time</th><th>Workflow</th><th>Status</th><th>Error</th></tr></thead>
    <tbody>${historyRows || '<tr><td colspan="4" style="color:#4a5568;text-align:center;padding:24px">No runs yet</td></tr>'}</tbody>
  </table>
</main>
<script>
  async function runNow(id) {
    if (!confirm('Run "' + id + '" now?')) return;
    const res = await fetch('/run', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({id}) });
    const data = await res.json();
    if (data.ok) { alert('Triggered!'); location.reload(); }
    else alert('Error: ' + data.error);
  }
  async function agentControl(action) {
    const res = await fetch('/agent/' + action, { method: 'POST' });
    const data = await res.json();
    alert(data.ok ? (action === 'start' ? '✅ Agent started!' : '⏸ Agent stopped!') : 'Error: ' + data.error);
    location.reload();
  }
</script>
</body>
</html>`;
  }
}

// ── PM2 control helper ────────────────────────────────────────
// function runPM2Command(action, res) {
//   const PM2 = process.env.PM2_PATH || '/home/bcs490/.nvm/versions/node/v22.19.0/bin/pm2';
//   const cmd = action === 'start'
//     ? `${PM2} start zoho-agent 2>/dev/null || ${PM2} restart zoho-agent 2>/dev/null`
//     : `${PM2} stop zoho-agent --no-autorestart`;

//     exec(cmd, { env: { ...process.env, PATH: process.env.PATH + ':/usr/local/bin:/usr/bin:/bin' } }, (err, stdout, stderr) => {    if (err) {
//       logger.warn(`PM2 ${action} error: ${err.message}`);
//       res.writeHead(500, { 'Content-Type': 'application/json' });
//       res.end(JSON.stringify({ ok: false, error: err.message }));
//     } else {
//       logger.info(`PM2 ${action} success`);
//       res.writeHead(200, { 'Content-Type': 'application/json' });
//       res.end(JSON.stringify({ ok: true, action }));
//     }
//   });
// }

function runPM2Command(action, res) {
  const PM2 = process.env.PM2_PATH || '/home/bcs490/.nvm/versions/node/v22.19.0/bin/pm2';
  const cmd = action === 'start'
    ? `${PM2} start zoho-agent 2>/dev/null || ${PM2} restart zoho-agent 2>/dev/null`
    : `${PM2} stop zoho-agent --no-autorestart`;

  // Send response FIRST before stop kills this process
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, action }));

  // Then execute after a short delay so response is sent
  setTimeout(() => {
    exec(cmd, {
      env: { ...process.env, PATH: process.env.PATH + ':/home/bcs490/.nvm/versions/node/v22.19.0/bin' }
    }, (err, stdout, stderr) => {
      if (err) logger.warn(`PM2 ${action} error: ${err.message}`);
      else logger.info(`PM2 ${action} success`);
    });
  }, 300);
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(' ');
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = HealthServer;
