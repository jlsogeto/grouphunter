const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;
const FB_EMAIL = process.env.FB_EMAIL;
const FB_PASSWORD = process.env.FB_PASSWORD;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'FB Scraper running', version: '1.0.0' });
});

app.post('/scrape', async (req, res) => {
  const { groupUrl, limit = 20 } = req.body;

  if (!groupUrl) return res.status(400).json({ error: 'groupUrl is required' });
  if (!FB_EMAIL || !FB_PASSWORD) return res.status(400).json({ error: 'FB_EMAIL and FB_PASSWORD required' });

  let browser;
  try {
    console.log('[FBScraper] Starting browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-accelerated-2d-canvas','--no-first-run','--no-zygote','--disable-gpu','--window-size=1280,900']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });

    console.log('[FBScraper] Logging in...');
    await loginToFacebook(page, FB_EMAIL, FB_PASSWORD);

    const membersUrl = groupUrl.includes('/members') ? groupUrl : `${groupUrl.replace(/\/$/, '')}/members`;
    console.log(`[FBScraper] Navigating to: ${membersUrl}`);
    await page.goto(membersUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(3000);

    console.log('[FBScraper] Collecting members...');
    const members = await collectMembers(page, limit);
    await browser.close();

    if (members.length === 0) {
      return res.status(404).json({ error: 'No members found. Group may be private or URL is incorrect.' });
    }

    console.log(`[FBScraper] Done. ${members.length} members collected.`);
    res.json({ success: true, count: members.length, groupUrl, members });

  } catch (err) {
    if (browser) await browser.close();
    console.error('[FBScraper] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function loginToFacebook(page, email, password) {
  await page.goto('https://www.facebook.com/', { waitUntil: 'networkidle2' });
  try {
    await page.waitForSelector('[data-testid="cookie-policy-manage-dialog-accept-button"]', { timeout: 3000 });
    await page.click('[data-testid="cookie-policy-manage-dialog-accept-button"]');
    await delay(1000);
  } catch (e) {}

  await page.waitForSelector('#email', { timeout: 10000 });
  await page.type('#email', email, { delay: 80 });
  await page.waitForSelector('#pass', { timeout: 5000 });
  await page.type('#pass', password, { delay: 80 });
  await page.click('[name="login"]');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });

  const url = page.url();
  if (url.includes('login') || url.includes('checkpoint')) {
    throw new Error('Facebook login failed. Check credentials or account needs verification.');
  }
  console.log('[FBScraper] Login successful');
  await delay(2000);
}

async function collectMembers(page, limit) {
  const members = new Map();
  let previousCount = 0;
  let noChangeCount = 0;

  while (members.size < limit && noChangeCount < 3) {
    const extracted = await page.evaluate(() => {
      const results = [];
      const selectors = [
        '[data-visualcompletion="ignore-dynamic"] a[href*="/user/"]',
        'a[href*="facebook.com/"][role="link"]',
        '[data-testid="group_member_list"] a',
        'div[class*="member"] a',
      ];
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const href = el.href || '';
          const name = el.innerText?.trim();
          const profileUrl = href.split('?')[0];
          if (name && name.length > 2 && name.length < 60 && profileUrl.includes('facebook.com') && !profileUrl.includes('/groups/') && !profileUrl.includes('/pages/') && !profileUrl.includes('javascript')) {
            results.push({ name, profileUrl });
          }
        });
        if (results.length > 0) break;
      }
      return results;
    });

    extracted.forEach(m => {
      if (m.profileUrl && !members.has(m.profileUrl)) members.set(m.profileUrl, m);
    });

    console.log(`[FBScraper] ${members.size} members so far...`);
    if (members.size === previousCount) { noChangeCount++; } else { noChangeCount = 0; previousCount = members.size; }

    await page.evaluate(() => window.scrollBy(0, 1200));
    await delay(2000);
  }

  return Array.from(members.values()).slice(0, limit);
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

app.listen(PORT, () => console.log(`FB Scraper running on port ${PORT}`));
