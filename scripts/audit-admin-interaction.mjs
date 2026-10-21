// Drive the admin panels the way the owner would, in a real browser, and
// report what actually happened on screen.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const URL_ = process.argv[2] || 'http://localhost:5199/audit-harness.html'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9363

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/ruhi-chrome-audit2', 'about:blank'], { stdio: 'ignore' })

let wsUrl = ''
for (let i = 0; i < 40 && !wsUrl; i += 1) {
  await sleep(500)
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page?.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl
  } catch { /* starting */ }
}
const ws = new WebSocket(wsUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(m.error.message)) : resolve(m.result)
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '')
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push('[console] ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
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
await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: URL_ })
await sleep(9000)

const report = (name, value) => console.log(`  ${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)

console.log('\n--- the banners panel ---')
// The destination picker the owner chooses from.
const destinations = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="banners"]');
  const selects = [...panel.querySelectorAll('select')];
  const picker = selects[selects.length - 1];
  if (!picker) return 'no picker';
  const options = [...picker.options].map(o => o.textContent.trim());
  return { total: options.length, first: options.slice(0, 6), categories: options.filter(o => o.includes('(category)')), products: options.filter(o => o.includes('(product)')).length };
})()`)
report('the destination menu', destinations)

// Pick a category destination and prove the banner row takes it.
const picked = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="banners"]');
  const selects = [...panel.querySelectorAll('select')];
  const picker = selects[selects.length - 1];
  const opt = [...picker.options].find(o => o.value.startsWith('/shop?type='));
  if (!opt) return 'no category option';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(picker, opt.value);
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  return opt.value;
})()`)
report('picked', picked)
await sleep(700)
const after = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="banners"]');
  const input = [...panel.querySelectorAll('input[type="text"]')][0];
  return { link: input ? input.value : null, note: (panel.innerText.match(/The category page[^\\n]*/) || [''])[0] };
})()`)
report('the banner row now says', after)

console.log('\n--- the best sellers panel ---')
const bestsellers = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="bestsellers"]');
  const available = [...panel.querySelectorAll('h2')].find(h => h.textContent.includes('Available designs'));
  const addButtons = [...panel.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Add');
  return {
    hasAvailableHeading: !!available,
    candidates: addButtons.length,
    heading: (panel.innerText.match(/On the homepage \\([^)]*\\)/) || [''])[0],
  };
})()`)
report('before adding', bestsellers)

const added = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="bestsellers"]');
  const addButtons = [...panel.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Add');
  if (!addButtons.length) return 'no candidates';
  addButtons[0].click();
  return 'clicked';
})()`)
report('adding a design', added)
await sleep(800)
const afterAdd = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="bestsellers"]');
  return {
    heading: (panel.innerText.match(/On the homepage \\([^)]*\\)/) || [''])[0],
    rows: panel.querySelectorAll('li').length,
    shows: (panel.innerText.match(/Showing on the homepage/g) || []).length,
  };
})()`)
report('after adding', afterAdd)

// Switch that design off and prove it says so and keeps its place.
const toggled = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="bestsellers"]');
  const eye = [...panel.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('Hide '));
  if (!eye) return 'no toggle';
  eye.click();
  return eye.getAttribute('aria-label');
})()`)
report('switching it off', toggled)
await sleep(800)
const afterToggle = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="bestsellers"]');
  return {
    hidden: (panel.innerText.match(/Hidden — keeps its place/g) || []).length,
    showing: (panel.innerText.match(/Showing on the homepage/g) || []).length,
    heading: (panel.innerText.match(/On the homepage \\([^)]*\\)/) || [''])[0],
  };
})()`)
report('after switching off', afterToggle)

console.log('\n--- the category photos panel ---')
const cats = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="category-images"]');
  const rows = [...panel.querySelectorAll('li')];
  return {
    rows: rows.length,
    images: rows.filter(r => r.querySelector('img')).length,
    labels: rows.map(r => (r.querySelector('p.font-semibold') || {}).textContent).filter(Boolean),
    saysDefault: (panel.innerText.match(/The site’s default photo/g) || []).length,
  };
})()`)
report('the categories and their pictures', cats)

const pickedCat = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="category-images"]');
  const row = panel.querySelector('li');
  const select = row.querySelector('select');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  const opt = [...select.options].find(o => o.value);
  setter.call(select, opt.value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return opt.value;
})()`)
report('picked a photo for the first category', pickedCat)
await sleep(800)
const catAfter = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="category-images"]');
  const row = panel.querySelector('li');
  const img = row.querySelector('img');
  return { src: img ? img.getAttribute('src') : null, text: (row.innerText.match(/Your photo[^\\n]*/) || [''])[0] };
})()`)
report('the row now shows', catAfter)

console.log(`\n--- exceptions/errors during the whole run: ${errors.length} ---`)
for (const e of errors.slice(0, 10)) console.log(`  ${String(e).slice(0, 300)}`)

chrome.kill()
process.exit(0)
