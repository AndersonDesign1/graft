// Screenshot each /lab page one section at a time and print section heights.
// Usage: node shoot-sections.cjs <out-dir> <json array of {v,theme,w,h,dpr,max,motion}>
// v is the page under /lab (landing, a, b, c, map). LAB_ORIGIN overrides the dev server.
const { chromium } = require('playwright');
const out = process.argv[2];
const jobs = JSON.parse(process.argv[3]);
(async () => {
  const b = await chromium.launch();
  for (const j of jobs) {
    const w = j.w || 1440, h = j.h || 900;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: j.dpr || 1, colorScheme: j.theme || 'dark', reducedMotion: j.motion ? 'no-preference' : 'reduce' });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
    await p.addInitScript((t) => { try { if (t) sessionStorage.setItem('graft-lab-theme', t); } catch {} }, j.theme);
    await p.goto('' + (process.env.LAB_ORIGIN || 'http://127.0.0.1:4321') + '/lab/' + j.v, { waitUntil: 'networkidle' });
    await p.addStyleTag({ content: 'astro-dev-toolbar{display:none!important}' }); await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(1800);
    const info = await p.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sections: [...document.querySelectorAll('main > section, footer.closing')].map(s => Math.round(s.getBoundingClientRect().height)),
      live: [...document.querySelectorAll('[data-studio]')].map(f => f.dataset.live || 'no'),
    }));
    console.log(j.v, w, j.theme, JSON.stringify(info), errs.length ? 'ERR ' + errs.join(' | ') : '');
    const tops = await p.evaluate(() => [...document.querySelectorAll('main > section, footer.closing')].map(s => Math.round(s.getBoundingClientRect().top + scrollY)));
    let i = 0;
    for (const top of tops) {
      await p.evaluate((y) => scrollTo(0, y), top);
      await p.waitForTimeout(1500);
      await p.screenshot({ path: `${out}/${j.v}-${w}-${j.theme}-${i++}.png` });
      if (j.max && i >= j.max) break;
    }
    await ctx.close();
  }
  await b.close();
})();
