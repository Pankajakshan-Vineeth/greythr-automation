const fs = require('fs');
const config = {
  agent: {
    name: 'Smart Automation Agent',
    timezone: 'Asia/Kolkata',
    headless: true,
    slowMo: 150,
    screenshotOnFailure: true,
    maxRetries: 3,
    retryDelay: 5000,
    notificationsEnabled: true,
    useRealChrome: true,
    chromeProfilePath: '',
    chromeProfileName: 'Default'
  },
  workflows: [
    {
      id: 'zoho-checkin',
      name: 'Zoho People - Daily Check-In',
      description: 'Check-In weekdays 9:30 AM',
      enabled: true,
      schedule: '30 9 * * 1-5',
      scheduleDescription: 'Weekdays at 9:30 AM',
      timezone: 'Asia/Kolkata',
      workflow: 'zoho-attendance',
      params: {
        action: 'checkin',
        url: 'https://people.zoho.in/home',
        buttonSelector: '[data-action=checkin]',
        fallbackSelectors: [
          '//button[contains(text(),"Check In")]',
          '//button[contains(text(),"Check-In")]',
          '//span[contains(text(),"Check In")]/..'
        ]
      }
    },
    {
      id: 'zoho-checkout',
      name: 'Zoho People - Daily Check-Out',
      description: 'Check-Out weekdays 6:30 PM',
      enabled: true,
      schedule: '30 18 * * 1-5',
      scheduleDescription: 'Weekdays at 6:30 PM',
      timezone: 'Asia/Kolkata',
      workflow: 'zoho-attendance',
      params: {
        action: 'checkout',
        url: 'https://people.zoho.in/home',
        buttonSelector: '[data-action=checkout]',
        fallbackSelectors: [
          '//button[contains(text(),"Check Out")]',
          '//button[contains(text(),"Check-Out")]',
          '//span[contains(text(),"Check Out")]/..'
        ]
      }
    }
  ],
  browser: { chromium: { args: [], viewport: { width: 1280, height: 800 } } },
  logging: { level: 'info', maxFiles: 7, maxSize: '10m' },
  healthCheck: { enabled: true, port: 3737, endpoint: '/health' }
};

fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
console.log('config.json written OK');