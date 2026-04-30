'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');
const readline = require('readline');

const SESSION_PATH = path.join(__dirname, 'logs', 'zoho-session.json');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

(async () => {
  console.log('\n🔐 Zoho Session Capture\n');

  const email = await ask('Enter your Zoho email: ');

  const browser = await chromium.launch({
    channel:  'chrome',
    headless: false,
    args: ['--no-sandbox', '--no-first-run', '--disable-sync', '--window-size=1280,800'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });

  const page = await context.newPage();

  console.log('\n📋 Opening Zoho login...');
  await page.goto('https://accounts.zoho.in/signin');

  // Enter email
  await page.waitForSelector('#login_id', { timeout: 15000 });
  await page.fill('#login_id', email);
  await page.click('#nextbtn');

  console.log(' Email entered. Waiting for OneAuth prompt...');
  console.log('📱 Please approve the login on your OneAuth app.\n');

  // Wait for successful redirect to Zoho People (up to 2 minutes for OneAuth approval)
  try {
    await page.waitForURL('**/people.zoho.in/**', { timeout: 120000 });
  } catch {
    // Maybe it landed elsewhere, navigate manually
    await page.goto('https://people.zoho.in/home');
    await page.waitForTimeout(3000);
  }

  console.log('Logged in! URL:', page.url());

  // Save session
  fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
  await context.storageState({ path: SESSION_PATH });

  const session = JSON.parse(fs.readFileSync(SESSION_PATH));
  const zohoCookies = session.cookies.filter(c => c.domain.includes('zoho'));
  console.log(`\n Session saved! Zoho cookies: ${zohoCookies.length}`);
  console.log(`Saved to: ${SESSION_PATH}`);
  console.log('\nYou can now run: node agent.js --run zoho-checkin\n');

  await browser.close();
  process.exit(0);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
