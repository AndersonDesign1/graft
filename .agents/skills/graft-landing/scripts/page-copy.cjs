// Print a page's headings and the first paragraph after each, in order.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const url of process.argv.slice(2)) {
    try {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
      const p = await ctx.newPage();
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(5000);
      for (let y = 0; y < 12; y++) { await p.mouse.wheel(0, 1400); await p.waitForTimeout(350); }
      const rows = await p.evaluate(() => { const out = []; const seen = new Set();
        for (const el of document.querySelectorAll('main h1, main h2, main h3, main p, h1, h2, h3, section p, a[class*="button" i], button')) {
          const t = el.innerText && el.innerText.replace(/\s+/g, ' ').trim(); if (!t || t.length < 3 || t.length > 260 || seen.has(t)) continue; seen.add(t);
          const r = el.getBoundingClientRect(); if (r.width === 0) continue; out.push([Math.round(r.top + scrollY), el.tagName, t]); }
        return out.sort((a, c) => a[0] - c[0]).slice(0, 90).map(r => r[1] + ': ' + r[2]); });
      console.log('\n=== ' + url + '\n' + rows.join('\n'));
      await ctx.close();
    } catch (e) { console.log('\n=== ' + url + ' FAILED ' + String(e).slice(0, 200)); }
  }
  await b.close();
})();
