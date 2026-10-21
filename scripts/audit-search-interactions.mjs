// The search box, driven the way a shopper drives it, on the live site.
//
//   node scripts/audit-search-interactions.mjs [https://www.ruhi-collections.com]
//
// It proves the things the colour audit does not: that the search is
// submitted by pressing Enter AND by clicking the magnifier, that the term
// can be cleared, that upper-case and half-typed terms behave, that a search
// with no results says so, and that the search covers every category.
//
// Nothing is written: the script only reads the pages it visits.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = (process.argv[2] || 'https://www.ruhi-collections.com').replace(/\/$/, '')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// ---- a small, honest harness ---------------------------------------------
let failures = 0
let checks = 0
const ok = (name, detail = '') => {
  checks += 1
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
}
const bad = (name, detail = '') => {
  checks += 1
  failures += 1
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}
const expect = (name, actual, want) => {
  const same = JSON.stringify(actual) === JSON.stringify(want)
  if (same) ok(name, typeof want === 'string' ? want : '')
  else bad(name, `wanted ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
}
const section = (title) => console.log(`\n--- ${title} ---`)

// ---- the browser ----------------------------------------------------------
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=0', '--user-data-dir=/tmp/ruhi-chrome-searchui-' + process.pid, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })

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
if (!announced) { console.log('Chrome did not start'); chrome.kill(); process.exit(1) }

let wsUrl = ''
for (let i = 0; i < 20 && !wsUrl; i += 1) {
  await sleep(300)
  try {
    const list = await (await fetch(`http://127.0.0.1:${announced}/json/list`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page?.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl
  } catch { /* the target list is not up yet */ }
}
if (!wsUrl) { console.log('Chrome did not open a tab'); chrome.kill(); process.exit(1) }

const ws = new WebSocket(wsUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
const exceptions = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(m.error.message)) : resolve(m.result)
  }
  if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '')
  }
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
const key = async (k, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk })
}
/** Enter, the way a keyboard sends it: a key down, the character it
 *  produces, and the key up. Without the character step a form never sees
 *  the submission, and the test would be measuring the browser, not the site. */
const pressEnter = async () => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
}
/** Select everything in the focused box (⌘A on a Mac). */
const selectAll = async () => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 4, commands: ['SelectAll'] })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 4 })
}
const type = async (text) => { await send('Input.insertText', { text }) }
/** The search overlay: the form and the list of suggestions that sits beside
 *  it, both inside the same panel. */
const OVERLAY = `document.querySelector('form[role="search"]')?.parentElement`
/** Wait until the catalogue has arrived: the box says "Loading products…"
 *  until it has, and a shopper cannot be shown a suggestion before then. */
const waitForCatalogue = async () => {
  await waitFor(`(() => {
    const panel = ${OVERLAY};
    if (!panel) return false;
    return !/Loading products/i.test(panel.innerText);
  })()`, 60)
}
const waitFor = async (expression, tries = 40) => {
  for (let i = 0; i < tries; i += 1) {
    const v = await evaluate(expression)
    if (v) return v
    await sleep(300)
  }
  return null
}
await send('Page.enable')
await send('Runtime.enable')

console.log(`\nThe search box on ${BASE}\n`)

// ---------------------------------------------------------------------------
section('1. the search box opens from the header')
// ---------------------------------------------------------------------------
await send('Page.navigate', { url: BASE + '/' })
await sleep(2500)
const opened = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button[aria-label="Search"]')]
    .find(b => !b.closest('form'));
  if (!btn) return false;
  btn.click();
  return true;
})()`)
expect('the header has a search button', opened, true)
const box = await waitFor(`(() => { const i = document.querySelector('#site-search'); return i ? { found: true } : null })()`)
expect('and it opens a search box', box?.found, true)

// ---------------------------------------------------------------------------
section('2. typing offers suggestions, and they are the right products')
// ---------------------------------------------------------------------------
await evaluate(`document.querySelector('#site-search').focus()`)
await type('blue')
await sleep(600)
await waitForCatalogue()
await sleep(800)
const suggestions = await evaluate(`(() => {
  const panel = document.querySelector('form[role="search"]')?.parentElement;
  const list = panel?.querySelector('ul');
  const items = list ? [...list.querySelectorAll('a[href^="/product/"]')].map(a => ({
    title: (a.querySelector('span')?.textContent || '').trim(),
    href: a.getAttribute('href'),
  })) : [];
  return { items, empty: (document.querySelector('form[role="search"]')?.innerText || '') };
})()`)
ok(`typing "blue" offers ${suggestions.items.length} suggestion(s)`, suggestions.items.slice(0, 3).map((i) => i.title).join(' | '))
expect('the suggestions are not empty', suggestions.items.length > 0, true)
expect('every suggestion is a product link', suggestions.items.every((i) => i.href?.startsWith('/product/')), true)

// ---------------------------------------------------------------------------
section('3. pressing Enter runs the search')
// ---------------------------------------------------------------------------
await pressEnter()
await sleep(3000)
const afterEnter = await evaluate(`({ url: location.pathname + location.search,
  cards: [...new Set([...document.querySelectorAll('a[href^="/product/"] h3')].map(h => h.textContent.trim()))] })`)
expect('Enter goes to the shop page', afterEnter.url.startsWith('/shop?q=blue'), true)
ok(`${afterEnter.cards.length} product(s) came back for "blue"`)
const catalogue = await evaluate(`(async () => {
  const res = await fetch('https://xhsjwhzutalckeektluj.supabase.co/rest/v1/products?select=title,colour&limit=500');
  const rows = await res.json();
  return Object.fromEntries(rows.map(r => [r.title, r.colour]));
})()`)
const notBlue = afterEnter.cards.filter((t) => {
  const c = String(catalogue?.[t] ?? '').toLowerCase()
  return c && !c.includes('blue')
})
expect('and every one of them is a blue product', notBlue, [])

// ---------------------------------------------------------------------------
section('4. the magnifier runs the search too')
// ---------------------------------------------------------------------------
await send('Page.navigate', { url: BASE + '/' })
await sleep(2500)
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button[aria-label="Search"]')].find(b => !b.closest('form'));
  btn.click(); return true;
})()`)
await waitFor(`document.querySelector('#site-search') ? true : null`)
await evaluate(`document.querySelector('#site-search').focus()`)
await type('dress')
await sleep(1000)
const clicked = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('form[role="search"] button[aria-label="Search"]')][0];
  if (!btn) return false;
  btn.click();
  return true;
})()`)
expect('the magnifier is there', clicked, true)
await sleep(3000)
const afterIcon = await evaluate(`({ url: location.pathname + location.search,
  cards: [...new Set([...document.querySelectorAll('a[href^="/product/"] h3')].map(h => h.textContent.trim()))] })`)
expect('and it runs the search', afterIcon.url.startsWith('/shop?q=dress'), true)
ok(`${afterIcon.cards.length} product(s) came back for "dress"`)

// ---------------------------------------------------------------------------
section('5. upper-case, half-typed, and nonsense terms')
// ---------------------------------------------------------------------------
const searchFrom = async (term) => {
  await send('Page.navigate', { url: `${BASE}/shop?q=${encodeURIComponent(term)}` })
  let last = ''
  let out = {}
  for (let i = 0; i < 40; i += 1) {
    await sleep(600)
    out = await evaluate(`(() => {
      const cards = [...new Set([...document.querySelectorAll('a[href^="/product/"] h3')].map(h => h.textContent.trim()))];
      const text = (document.querySelector('main') || document.body).innerText || '';
      return { cards, text: text.replace(/\\s+/g, ' ') };
    })()`)
    const now = JSON.stringify(out)
    if (now === last) break
    last = now
  }
  return out
}
const lower = await searchFrom('blue')
const upper = await searchFrom('BLUE')
expect('"BLUE" finds the same products as "blue"', upper.cards, lower.cards)
const partial = await searchFrom('blu')
ok(`"blu" (half-typed) finds ${partial.cards.length} product(s)`)
expect('every one of them is blue', partial.cards.filter((t) => {
  const c = String(catalogue?.[t] ?? '').toLowerCase()
  return c && !c.includes('blue')
}), [])
const nonsense = await searchFrom('zzzqqqxx')
expect('a search that matches nothing returns nothing', nonsense.cards, [])
expect('and it says so', /Nothing matches|No results|no products/i.test(nonsense.text), true)

// ---------------------------------------------------------------------------
section('6. the term can be cleared')
// ---------------------------------------------------------------------------
await send('Page.navigate', { url: BASE + '/' })
await sleep(2500)
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button[aria-label="Search"]')].find(b => !b.closest('form'));
  btn.click(); return true;
})()`)
await waitFor(`document.querySelector('#site-search') ? true : null`)
await evaluate(`document.querySelector('#site-search').focus()`)
await type('blue')
await sleep(600)
await waitForCatalogue()
await sleep(800)
const beforeClear = await evaluate(`document.querySelector('#site-search').value`)
expect('the box holds what was typed', beforeClear, 'blue')
// Clearing the text the way a shopper does: select it and delete it.
await selectAll()
await key('Backspace', 'Backspace', 8)
await sleep(800)
const cleared = await evaluate(`(() => {
  const i = document.querySelector('#site-search');
  const panel = document.querySelector('form[role="search"]')?.parentElement;
  const list = panel?.querySelector('ul');
  return { value: i ? i.value : null, suggestions: list ? list.querySelectorAll('a').length : 0 };
})()`)
expect('the box is empty again', cleared.value, '')
expect('and the suggestions are gone', cleared.suggestions, 0)

// ---------------------------------------------------------------------------
section('7. the Clear button puts the whole catalogue back')
// ---------------------------------------------------------------------------
// The Clear button lives on the shop page, so the search is run there first.
await send('Page.navigate', { url: `${BASE}/shop?q=blue` })
await sleep(3500)
const clearedPage = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Clear');
  if (!btn) return { found: false };
  btn.click();
  return { found: true };
})()`)
expect('the shop page offers a Clear button', clearedPage.found, true)
await sleep(3000)
const afterClear = await evaluate(`({ url: location.pathname + location.search,
  cards: [...new Set([...document.querySelectorAll('a[href^="/product/"] h3')].map(h => h.textContent.trim()))] })`)
expect('and it takes the search away', afterClear.url, '/shop')
expect('and every product is back', afterClear.cards.length > lower.cards.length, true)

// ---------------------------------------------------------------------------
section('8. a search covers every category')
// ---------------------------------------------------------------------------
await send('Page.navigate', { url: `${BASE}/shop?type=dress&q=blue` })
await sleep(3500)
const withCategory = await evaluate(`(() => {
  const cards = [...new Set([...document.querySelectorAll('a[href^="/product/"] h3')].map(h => h.textContent.trim()))];
  const sel = [...document.querySelectorAll('select')].map(s => s.value);
  return { cards, sel };
})()`)
expect('the category filter does not narrow a search', withCategory.cards, lower.cards)
expect('and the Type box reads "All"', withCategory.sel.includes(''), true)

// ---------------------------------------------------------------------------
console.log(`\n--- browser exceptions: ${exceptions.length} ---`)
for (const e of exceptions.slice(0, 5)) console.log(`    ${String(e).slice(0, 200)}`)

console.log(`\n${failures ? '✗' : '✓'} ${checks - failures} of ${checks} checks passed`)
chrome.kill()
process.exit(failures ? 1 : 0)
