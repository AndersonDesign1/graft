// Crawl a running Studio and record every API response it asks for.
// Usage: node record-studio.cjs <studio origin> <out json> <screenshot dir>
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [origin, outFile, shotDir] = process.argv.slice(2);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  const p = await ctx.newPage();
  const rec = {};
  const writes = [];
  p.on('response', async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/')) return;
    const m = r.request().method();
    let body = null;
    try { body = await r.text(); } catch {}
    const key = m + ' ' + u.pathname + u.search;
    if (m === 'GET') rec[key] = { status: r.status(), type: r.headers()['content-type'] || 'application/json', body };
    else writes.push({ key, status: r.status(), req: (r.request().postData() || '').slice(0, 300), body: (body || '').slice(0, 600) });
  });
  const go = async (hash, wait = 1200) => { await p.goto(origin + '/?branch=main#' + hash, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(wait); };
  await go('/');
  const tree = await (await fetch(origin + '/api/studio/v1/tree')).json();
  const routes = ['/', '/inbox', '/media', '/dev/branches'];
  for (const c of tree.collections) { routes.push('/c/' + c.name); for (const d of c.documents) routes.push('/c/' + c.name + '/' + d.slug); }
  // every sidebar/developer link we can find
  for (const r of routes) await go(r, r.split('/').length > 3 ? 900 : 1200);
  const more = await p.evaluate(() => [...document.querySelectorAll('a[href^="#/"]')].map(a => a.getAttribute('href').slice(1)));
  await go('/'); await p.getByText('Developer').first().click().catch(() => {}); await p.waitForTimeout(600);
  const dev = await p.evaluate(() => [...document.querySelectorAll('a[href^="#/"]')].map(a => a.getAttribute('href').slice(1)));
  for (const r of new Set([...more, ...dev])) if (!routes.includes(r)) { routes.push(r); await go(r); }
  // shots
  await go('/c/pages/home', 2500); await p.screenshot({ path: shotDir + '/studio-entry.png' });
  await go('/c/docs', 1500); await p.screenshot({ path: shotDir + '/studio-list.png' });
  await go('/c/docs/getting-started', 2500); await p.screenshot({ path: shotDir + '/studio-doc.png' });
  fs.writeFileSync(outFile, JSON.stringify(rec));
  console.log('routes', routes.length, 'GETs', Object.keys(rec).length, 'bytes', fs.statSync(outFile).size);
  console.log('non-200:', Object.entries(rec).filter(([, v]) => v.status !== 200).map(([k, v]) => v.status + ' ' + k).join('\n'));
  console.log('writes', JSON.stringify(writes).slice(0, 1500));
  console.log('distinct paths:\n' + [...new Set(Object.keys(rec).map(k => k.split('?')[0].replace(/\/(docs|pages)\/[a-z0-9-]+$/, '/$1/:slug')))].join('\n'));
  await b.close();
})();
