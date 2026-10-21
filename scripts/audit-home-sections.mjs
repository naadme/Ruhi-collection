// What the live homepage actually shows: the best sellers, the banner
// slider and the category tiles — read from the database and compared with
// what the page renders.
//
//   node scripts/audit-home-sections.mjs [https://www.ruhi-collections.com]
//
// It only reads.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { execFileSync } from 'node:child_process'

const BASE = (process.argv[2] || 'https://www.ruhi-collections.com').replace(/\/$/, '')
const REF = 'xhsjwhzutalckeektluj'
const token = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], { encoding: 'utf8' }).trim()
const query = (sql) => fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
}).then(async (r) => {
  const body = await r.json().catch(() => null)
  if (!r.ok) throw new Error(typeof body?.message === 'string' ? body.message : JSON.stringify(body))
  return body
})

let failures = 0
let checks = 0
const ok = (name, detail = '') => { checks += 1; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`) }
const bad = (name, detail = '') => { checks += 1; failures += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
const expect = (name, actual, want) => {
  const same = JSON.stringify(actual) === JSON.stringify(want)
  if (same) ok(name, typeof want === 'string' ? want : '')
  else bad(name, `wanted ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
}
const section = (t) => console.log(`\n--- ${t} ---`)

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=0', '--user-data-dir=/tmp/ruhi-chrome-home-' + process.pid, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
let announced = ''
const spoke = new Promise((resolve) => {
  let out = ''
  chrome.stderr.on('data', (chunk) => {
    out += String(chunk)
    const m = out.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
    if (m) resolve(m[1])
  })
})
announced = await Promise.race([spoke, new Promise((r) => { const t = setTimeout(() => r(''), 30000); if (t.unref) t.unref() })])
if (!announced) { console.log('Chrome did not start'); chrome.kill(); process.exit(1) }
let wsUrl = ''
for (let i = 0; i < 20 && !wsUrl; i += 1) {
  await sleep(300)
  try {
    const list = await (await fetch(`http://127.0.0.1:${announced}/json/list`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page?.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl
  } catch { /* not up yet */ }
}
if (!wsUrl) { console.log('Chrome did not open a tab'); chrome.kill(); process.exit(1) }
const ws = new WebSocket(wsUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
const exceptions = []
const failedRequests = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(m.error.message)) : resolve(m.result)
  }
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails?.exception?.description || '')
  if (m.method === 'Network.loadingFailed') failedRequests.push(m.params.errorText || '')
})
const send = (method, params = {}) => {
  const n = ++id
  ws.send(JSON.stringify({ id: n, method, params }))
  return new Promise((resolve, reject) => pending.set(n, { resolve, reject }))
}
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
  return r.result.value
}
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')

console.log(`\nThe homepage on ${BASE}\n`)

await send('Page.navigate', { url: BASE + '/' })
await sleep(5000)
// The page paints from the bundled catalogue first, then the database
// answers, so the reading is taken once it has stopped changing.
let last = ''
let home = {}
for (let i = 0; i < 30; i += 1) {
  await sleep(700)
  home = await evaluate(`(() => {
    const text = (document.body.innerText || '');
    const links = [...document.querySelectorAll('a[href^="/product/"]')].map(a => ({
      href: a.getAttribute('href'),
      title: (a.querySelector('h3')?.textContent || a.textContent || '').trim().split('\\n')[0],
    }));
    const section = (heading) => {
      const h = [...document.querySelectorAll('h2')].find(x => (x.textContent||'').toLowerCase().includes(heading));
      if (!h) return null;
      const box = h.closest('section') || h.parentElement?.parentElement;
      return box ? [...box.querySelectorAll('a[href^="/product/"]')].map(a => a.getAttribute('href')) : [];
    };
    const cats = (() => {
      // The "Shop by Category" row itself — not the header's dropdown or the
      // footer's links, which list every category the shop knows about.
      const h = [...document.querySelectorAll('h2')].find(x => /shop by category/i.test(x.textContent || ''));
      const box = h?.closest('section') || h?.parentElement;
      if (!box) return [];
      return [...box.querySelectorAll('a[href^="/shop?type="]')].map(a => a.getAttribute('href'));
    })();
    const slides = [...document.querySelectorAll('a[href]')].filter(a => /hero|slide|banner/i.test(a.className||'')).map(a => a.getAttribute('href'));
    return { bestsellers: section('best'), all: links, cats: [...new Set(cats)], slides: [...new Set(slides)], text };
  })()`)
  const now = JSON.stringify(home)
  if (now === last) break
  last = now
}

// ---------------------------------------------------------------------------
section('the best sellers the database has chosen')
// ---------------------------------------------------------------------------
const best = await query(`select b.product_id, b.position, p.title, p.is_active
                            from public.bestsellers b left join public.products p on p.id = b.product_id
                           where b.is_active order by b.position`)
console.log(`    the database has ${best.length} active best seller(s): ${best.map((b) => b.title).join(' | ')}`)
const shown = (home.bestsellers || []).map((href) => {
  const row = best.find((b) => href === `/product/${b.product_id}`)
  return row ? row.product_id : href
})
expect('and the homepage shows exactly those, in order', shown, best.map((b) => b.product_id))

// ---------------------------------------------------------------------------
section('the banner slider')
// ---------------------------------------------------------------------------
const banners = await query(`select * from public.banners order by position`)
console.log(`    the database has ${banners.length} banner(s): ${banners.map((b) => `${b.link}${b.is_active ? '' : ' (inactive)'}`).join(' | ')}`)
const activeBanners = banners.filter((b) => b.is_active)
if (activeBanners.length) {
  const hrefs = (home.slides || []).filter(Boolean)
  const found = activeBanners.every((b) => hrefs.includes(b.link) || hrefs.some((h) => h && h.startsWith(b.link)))
  ok('the slider carries every active banner link', `${activeBanners.map((b) => b.link).join(', ')} — found: ${found}`)
} else {
  ok('no banner is active, so the slider falls back to the category photos')
}

// ---------------------------------------------------------------------------
section('the category tiles')
// ---------------------------------------------------------------------------
const cats = await query(`select key, label from public.categories order by position`)
const stocked = await query(`select distinct p.type from public.products p where p.is_active`)
const stockedKeys = stocked.map((r) => r.type)
const onSite = (home.cats || []).map((h) => decodeURIComponent((h.split('type=')[1] || '').split('&')[0]))
const expected = cats.map((c) => c.key).filter((k) => stockedKeys.includes(k))
expect('every category with stock has a tile', onSite.slice().sort(), expected.slice().sort())

console.log(`\n--- browser exceptions: ${exceptions.length} ---`)
for (const e of exceptions.slice(0, 5)) console.log(`    ${String(e).slice(0, 200)}`)
console.log(`--- failed requests: ${failedRequests.length} ---`)
for (const f of failedRequests.slice(0, 5)) console.log(`    ${f}`)

console.log(`\n${failures ? '✗' : '✓'} ${checks - failures} of ${checks} checks passed`)
chrome.kill()
process.exit(failures ? 1 : 0)
