// Screenshot sites screen by screen and print their type and color values.
// Usage: node capture-sites.cjs <out-dir> <json array of {name,url,w,h,max,wait,scheme}>
const { chromium } = require('playwright');
const out = process.argv[2];
const targets = JSON.parse(process.argv[3]);
(async () => {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const browser = await chromium.launch();
  for (const t of targets) {
    try {
      const ctx = await browser.newContext({
        viewport: { width: t.w || 1440, height: t.h || 900 }, deviceScaleFactor: 1,
        colorScheme: t.scheme || 'dark', ignoreHTTPSErrors: false,
        proxy: t.url.includes('127.0.0.1') ? undefined : proxy,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      });
      const page = await ctx.newPage();
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(t.wait || 4000);
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      const info = await page.evaluate(() => {
        const cs = (el) => { const s = getComputedStyle(el); return { font: s.fontFamily.slice(0, 60), size: s.fontSize, weight: s.fontWeight, lh: s.lineHeight, ls: s.letterSpacing, color: s.color }; };
        const h1 = document.querySelector('h1'); const h2 = document.querySelector('h2'); const p = document.querySelector('main p, p');
        const b = getComputedStyle(document.body);
        return { title: document.title, bodyBg: b.backgroundColor, bodyFont: b.fontFamily.slice(0, 60), h1Text: h1 && h1.innerText.slice(0, 120), h1: h1 && cs(h1), h2Text: h2 && h2.innerText.slice(0, 100), h2: h2 && cs(h2), p: p && cs(p),
          h2s: [...document.querySelectorAll('h2')].map(e => e.innerText.replace(/\s+/g, ' ').slice(0, 70)).slice(0, 24),
          canvases: document.querySelectorAll('canvas').length, videos: document.querySelectorAll('video').length, sections: document.querySelectorAll('section').length };
      });
      console.log(JSON.stringify({ name: t.name, total, ...info }));
      const n = Math.min(t.max || 7, Math.ceil(total / (t.h || 900)));
      for (let i = 0; i < n; i++) {
        await page.evaluate((y) => window.scrollTo(0, y), i * (t.h || 900));
        await page.waitForTimeout(900);
        await page.screenshot({ path: `${out}/${t.name}-${i}.png` });
      }
      await ctx.close();
    } catch (e) { console.log(JSON.stringify({ name: t.name, error: String(e).slice(0, 300) })); }
  }
  await browser.close();
})();
