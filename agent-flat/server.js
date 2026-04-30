'use strict';
require('dotenv').config();
const http = require('http');
const { exec } = require('child_process');

const PM2 = '/home/bcs490/.nvm/versions/node/v22.19.0/bin/pm2';
const PORT = 3737;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url.split('?')[0];

  if (url === '/health' && req.method === 'GET') {
    exec(`${PM2} jlist`, (err, stdout) => {
      const list = JSON.parse(stdout || '[]');
      const agent = list.find(p => p.name === 'zoho-agent');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'running',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        jobs: agent ? [{ id: 'zoho-agent', name: 'Zoho Agent', lastStatus: agent.pm2_env.status }] : [],
        history: [],
      }));
    });
    return;
  }

  if (url === '/agent/start' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, action: 'start' }));
    setTimeout(() => exec(`${PM2} start zoho-agent || ${PM2} restart zoho-agent`), 300);
    return;
  }

  if (url === '/agent/stop' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, action: 'stop' }));
    setTimeout(() => exec(`${PM2} stop zoho-agent --no-autorestart`), 300);
    return;
  }

  if (url === '/run' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { id } = JSON.parse(body);
      exec(`${PM2} trigger zoho-agent run ${id}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Control server running on http://127.0.0.1:${PORT}`);
});
