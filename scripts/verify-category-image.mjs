// Prove the chain the admin panel uses: a photo written to a category row is
// on the live homepage at the next visit, with no code change and no
// redeployment — and that clearing it brings the site's own default back.
//
//   node scripts/verify-category-image.mjs
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { execFileSync } from 'node:child_process'

const BASE = (process.argv[2] || 'https://www.ruhi-collections.com').replace(/\/$/, '')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// No fixed debugging port: Chrome picks one and announces it (see below).
const REF = 'xhsjwhzutalckeektluj'

const ok = (m) => console.log(`  \u2713 ${m}`)
const bad = (m) => console.log(`  \u2717 ${m}`)

const sql = (statement) => {
  const token = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], { encoding: 'utf8' }).trim()
  const res = execFileSync('/usr/bin/curl', [
    '-s', '-m', '120', '-X', 'POST', `https://api.supabase.com/v1/projects/${REF}/database/query`,
    '-H', `Authorization: Bearer ${token}`, '-H', 'Content-Type: ' + 'application/json',
    '-d', JSON.stringify({ query: statement }),
  ], { encoding: 'utf8' })
  return res
}

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0',
  '--user-data-dir=/tmp/ruhi-chrome-profile2-' + process.pid, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

// Chrome picks its own port and announces it on stderr, so this script can
// never find itself talking to a browser left behind by a run that died.
let announced = ''
const spoke = new Promise((resolve) => {
  let out = ''
  chrome.stderr.on('data', (chunk) => {
    out += String(chunk)
    const m = out.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
    if (m) resolve(m[1])
  })
})
announced = await Promise.race([spoke, new Promise((r) => {
  const t = setTimeout(() => r(''), 30000)
  if (t.unref) t.unref()
})])
if (!announced) {
  console.log('Chrome did not start')
  chrome.kill()
  process.exit(1)
}
// That socket is the browser's; the tab's — the one that answers Page.* —
// is read from the target list on the port it just announced.
let wsUrl = ''
for (let i = 0; i < 20 && !wsUrl; i += 1) {
  await sleep(300)
  try {
    const list = await (await fetch(`http://127.0.0.1:${announced}/json/list`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page?.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl
  } catch { /* the target list is not up yet */ }
}
if (!wsUrl) {
  console.log('Chrome did not open a tab')
  chrome.kill()
  process.exit(1)
}
const ws = new WebSocket(wsUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(m.error.message)) : resolve(m.result)
  }
})
const send = (method, params = {}) => {
  const n = ++id
  ws.send(JSON.stringify({ id: n, method, params }))
  return new Promise((resolve, reject) => pending.set(n, { resolve, reject }))
}
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r.result.value
}
await send('Page.enable')

const homepageTile = async (label) => {
  await send('Page.navigate', { url: BASE })
  for (let i = 0; i < 60; i += 1) {
    await sleep(500)
    const ready = await evaluate('document.readyState === "complete" && !!document.querySelector("main")')
    if (ready) break
  }
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    const n = await evaluate('document.querySelectorAll(\'a[href^="/product/"]\').length')
    if (n > 0) break
  }
  return evaluate(`(() => {
    const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Shop by Category')
    const grid = heading.parentElement.querySelector('.grid')
    const link = [...grid.querySelectorAll('a')].find((a) => a.textContent.trim() === ${JSON.stringify(label)})
    return link ? { href: link.getAttribute('href'), image: link.querySelector('img')?.getAttribute('src') || '' } : null
  })()`)
}

const CHOSEN = '/images/products/stripes-dress-blue.jpg'
let failures = 0
try {
  console.log('\n1. The category photo as the site shows it now')
  const before = await homepageTile('Co-ord Sets')
  ok(`the "Co-ord Sets" tile shows ${before.image}`)

  console.log('\n2. The owner picks a different photo (the same write the admin panel makes)')
  sql(`update public.categories set image = '${CHOSEN}' where key = 'coord'`)
  const after = await homepageTile('Co-ord Sets')
  if (after.image === CHOSEN) {
    ok(`the tile now shows ${after.image} — the change is live, with no redeployment`)
  } else {
    bad(`the tile still shows ${after.image}`)
    failures += 1
  }

  console.log('\n3. The photo is in the database, and the link is unchanged')
  const stored = sql("select image from public.categories where key = 'coord'")
  if (String(stored).includes(CHOSEN)) ok(`the database holds the photo (${String(stored).trim().slice(0, 120)})`)
  else { bad('the database does not hold the photo'); failures += 1 }
  if (after.href === '/shop?type=coord') ok(`the card still points at ${after.href}`)
  else { bad(`the card points at ${after.href}`); failures += 1 }

  console.log('\n4. Clearing it brings the site’s own default back')
  sql("update public.categories set image = null where key = 'coord'")
  const reverted = await homepageTile('Co-ord Sets')
  if (reverted.image === before.image) {
    ok(`the tile shows ${reverted.image} again`)
  } else {
    bad(`the tile shows ${reverted.image}, expected ${before.image}`)
    failures += 1
  }
} finally {
  sql("update public.categories set image = null where key = 'coord'")
  chrome.kill()
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nThe category photo change is persisted and live.')
process.exit(failures ? 1 : 0)
