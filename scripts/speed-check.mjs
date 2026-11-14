// The speed check every change to the shop goes through (13 Nov 2026).
//
//   npm run speed                 build, then check what every page downloads
//                                 against speed-budget.json (no network, ~5 s)
//   npm run speed:lab             …and load the product page, homepage and shop
//                                 in Lighthouse on a slow phone (~3 min)
//   npm run speed:live            Lighthouse on the live site, 5 runs per page,
//                                 compared with the live baseline: run it before
//                                 promoting a deployment and again after
//   node scripts/speed-check.mjs --save-baseline [--lab | --live]
//                                 record today's numbers in speed-baseline.json,
//                                 which later runs compare against (a live save
//                                 changes only the live numbers)
//
// Why: ads land shoppers on the product page, mostly on Android phones in
// Instagram's in-app browser, with an empty cache. Every kilobyte and every
// extra request lands on them first. This check makes the cost of a change
// visible BEFORE it ships, and stops anything that breaks the budget.
//
// The lab runs load the pages in a fresh headless Chrome with Lighthouse's
// mobile defaults, and BLOCK the GA4, Meta and Vercel analytics hits (the
// tracking scripts still load and run, so their cost is measured), so a check
// never adds a visit to the shop's reports (a run that lets a hit through stops
// with an error naming it). Lighthouse is fetched by npx on
// first use. Exit code 1 means a budget was broken.
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize, relative } from 'node:path'
import { gzipSync } from 'node:zlib'
import { checkSettings, mergeBaseline } from './speedSettings.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const args = new Set(process.argv.slice(2))
const LIVE = args.has('--live')
const LAB = args.has('--lab') || LIVE
const SAVE = args.has('--save-baseline')
const budget = JSON.parse(readFileSync(join(ROOT, 'speed-budget.json'), 'utf8'))
const baselinePath = join(ROOT, 'speed-baseline.json')
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null
// The live site runs the Meta pixel and local builds don't, so the live check has
// its own runs, limits and baseline (see speedSettings.mjs).
const check = checkSettings(budget, baseline, LIVE)
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SITE = 'https://www.ruhi-collections.com'
// Google's tag also sends a copy of every GA4 hit to www.google.com/g/collect,
// and GA4 counts those as visits: 13 Nov 2026, about 60 test visits reached the
// reports before that address was added here. tests/speedCheck.test.js keeps
// this list complete, and every lab run is checked for a hit that got through.
const BLOCK = [
  '*google-analytics.com*', '*analytics.google.com*', '*doubleclick.net*', '*google.com/g/collect*',
  '*google.com/ccm/*', '*google.com/pagead/*', '*google.com/ads/*', '*facebook.com/tr*',
  '*facebook.com/privacy_sandbox*', '*_vercel/insights*', '*vercel-insights.com*',
  '*googletagmanager.com/a?*', '*googletagmanager.com/td?*',
]
// A request that looks like a tracking hit and was answered: the run counted as a visit.
const TRACKING_HIT = /\/g\/collect|\/j\/collect|\/r\/collect|\/ccm\/collect|facebook\.com\/(tr|privacy_sandbox)|_vercel\/insights|vercel-insights\.com/

const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10
const gz = (buf) => gzipSync(buf, { level: 9 }).length
const problems = []
const notes = []
const fail = (msg) => problems.push(msg)
const row = (label, value, limit, unit = 'KB', before) => {
  const over = limit != null && value > limit
  if (over) fail(`${label}: ${value} ${unit} is over the budget of ${limit} ${unit}`)
  const delta = before == null ? '' : `  (${value - before >= 0 ? '+' : ''}${Math.round((value - before) * 10) / 10} vs baseline)`
  console.log(`  ${over ? '✗' : '✓'} ${label.padEnd(26)} ${String(value).padStart(8)} ${unit}${limit != null ? `   budget ${limit}` : ''}${delta}`)
}

// ------------------------------------------------------------------ build
const measuredAt = new Date().toISOString()
const results = LIVE ? { measuredAt, live: {} } : { measuredAt, files: {}, chunks: {}, lab: {} }
let outDir = null
if (!LIVE) {
  outDir = mkdtempSync(join(tmpdir(), 'ruhi-speed-'))
  console.log('Building the shop…')
  execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit' })

  const html = readFileSync(join(outDir, 'index.html'), 'utf8')
  const entry = [...html.matchAll(/<script type="module"[^>]*src="(\/assets\/[^"]+)"/g)].map((m) => m[1])
  const preloads = [...html.matchAll(/<link rel="modulepreload"[^>]*href="(\/assets\/[^"]+)"/g)].map((m) => m[1])
  const styles = [...html.matchAll(/<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+)"/g)].map((m) => m[1])
  const size = (p) => gz(readFileSync(join(outDir, p)))
  const main = entry.find((p) => /\/index-/.test(p))
  const vendor = preloads.find((p) => /\/vendor-/.test(p))
  results.files = {
    html: kb(gz(Buffer.from(html))),
    mainScript: main ? kb(size(main)) : 0,
    vendorScript: vendor ? kb(size(vendor)) : 0,
    css: kb(styles.reduce((t, p) => t + size(p), 0)),
  }
  results.files.firstLoadTotal = kb(gz(Buffer.from(html)) + [...new Set([...entry, ...preloads, ...styles])].reduce((t, p) => t + size(p), 0))

  console.log('\nWhat every page downloads first (compressed):')
  for (const [key, value] of Object.entries(results.files)) row(key, value, budget.files[key], 'KB', baseline?.files?.[key])

  console.log('\nCode loaded only when needed:')
  for (const file of readdirSync(join(outDir, 'assets')).filter((f) => f.endsWith('.js'))) {
    const name = file.replace(/-[A-Za-z0-9_-]{8}\.js$/, '')
    if (name === 'index' || name === 'vendor') continue
    results.chunks[name] = kb(size(`/assets/${file}`))
    row(name, results.chunks[name], budget.chunks[name] ?? budget.chunks._default, 'KB', baseline?.chunks?.[name])
  }

  // Anything the page asks another site for before the app runs is paid by
  // every visitor; a new one needs the owner's OK (and a speed reason).
  const origins = [...new Set([...html.matchAll(/https:\/\/[a-z0-9.-]+/gi)].map((m) => m[0].toLowerCase()))]
  // "https://*.supabase.co" allows one label in place of the star.
  const allowed = (o) => budget.pageOrigins.some((a) => a.includes('*') ? new RegExp(`^${a.replace(/[.]/g, '\\.').replace('*', '[a-z0-9-]+')}$`).test(o) : a === o)
  const strangers = origins.filter((o) => !allowed(o))
  console.log(`\nOther sites the page itself contacts: ${origins.length ? origins.join(', ') : 'none'}`)
  for (const o of strangers) fail(`the page now contacts ${o} — a new third party needs the owner's OK and its speed cost in the pull request`)
  // An external script in <head> without async/defer/type=module stops the page from drawing.
  const head = html.slice(0, html.indexOf('</head>'))
  for (const m of head.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"[^>]*>/g)) {
    if (!/\b(async|defer)\b|type="module"/.test(m[1] + m[0])) fail(`render-blocking script in <head>: ${m[2]}`)
  }

  // Photographs shipped with the site.
  const publicImages = []
  const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(jpe?g|png|webp|avif|gif)$/i.test(f)) publicImages.push([relative(join(ROOT, 'public'), p), statSync(p).size]) } }
  if (existsSync(join(ROOT, 'public'))) walk(join(ROOT, 'public'))
  const heavy = publicImages.filter(([, s]) => kb(s) > budget.publicImageMaxKB)
  for (const [p, s] of heavy) fail(`public/${p} is ${kb(s)} KB (limit ${budget.publicImageMaxKB} KB): resize it before adding`)
}

// -------------------------------------------------------------------- lab
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

async function serve(dir) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
    let file = join(dir, path)
    if (!existsSync(file) || statSync(file).isDirectory()) {
      if (path.startsWith('/assets/') || extname(path)) { res.writeHead(404); res.end(); return }
      file = join(dir, 'index.html')
    }
    const type = types[extname(file)] || 'application/octet-stream'
    let body = readFileSync(file)
    const headers = { 'content-type': type }
    if (/text|javascript|json|svg/.test(type)) { body = gzipSync(body, { level: 9 }); headers['content-encoding'] = 'gzip' }
    res.writeHead(200, headers)
    res.end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, base: `http://127.0.0.1:${server.address().port}` }
}

// Headless Chrome occasionally drops a run ("Target closed"); one retry, then give up.
async function lighthouse(url) {
  try { return await lighthouseOnce(url) } catch (first) {
    console.log(`  (Lighthouse run failed, retrying once: ${String(first.message).slice(0, 120)})`)
    return lighthouseOnce(url)
  }
}

// Asynchronous on purpose: the local copy of the site is served by this same
// process, which must keep answering while Lighthouse loads it.
const run = (cmd, argv, env) => new Promise((resolve) => {
  const child = spawn(cmd, argv, { env, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d })
  child.on('close', (status) => resolve({ status, stderr }))
})

async function lighthouseOnce(url) {
  const out = join(mkdtempSync(join(tmpdir(), 'ruhi-lh-')), 'report.json')
  const argv = ['-y', `lighthouse@${check.lighthouse}`, url, '--quiet', '--only-categories=performance',
    '--chrome-flags=--headless=new --no-first-run --no-default-browser-check --disable-extensions',
    ...BLOCK.map((p) => `--blocked-url-patterns=${p}`), '--output=json', `--output-path=${out}`]
  const done = await run('npx', argv, { ...process.env, CHROME_PATH: CHROME })
  if (done.status !== 0 || !existsSync(out)) throw new Error(`Lighthouse failed for ${url}: ${(done.stderr || '').slice(-400)}`)
  const r = JSON.parse(readFileSync(out, 'utf8'))
  rmSync(out, { force: true })
  const a = r.audits
  const leaked = (a['network-requests']?.details?.items || []).filter((q) => q.statusCode > 0 && TRACKING_HIT.test(q.url))
  if (leaked.length) {
    throw new Error(`A tracking hit was not blocked, so this run reached the shop's reports. Add its address to BLOCK in scripts/speed-check.mjs:\n  ${[...new Set(leaked.map((q) => q.url.split('?')[0]))].join('\n  ')}`)
  }
  return {
    score: Math.round((r.categories.performance.score || 0) * 100),
    lcpMs: Math.round(a['largest-contentful-paint'].numericValue),
    fcpMs: Math.round(a['first-contentful-paint'].numericValue),
    tbtMs: Math.round(a['total-blocking-time'].numericValue),
    cls: Math.round((a['cumulative-layout-shift'].numericValue || 0) * 1000) / 1000,
    kb: kb(a['total-byte-weight'].numericValue),
  }
}

if (LAB) {
  const { server, base } = LIVE ? { server: null, base: SITE } : await serve(outDir)
  const priorDate = (LIVE ? check.prior?.measuredAt : baseline?.measuredAt)?.slice(0, 10)
  console.log(`\nLighthouse, slow phone, ${check.runs} runs each (median) — ${LIVE ? 'LIVE site' : 'this build'}${check.prior ? `, compared with the ${check.mode} baseline${priorDate ? ` of ${priorDate}` : ''}` : ''}:`)
  try {
    for (const [name, path] of Object.entries(check.pages)) {
      const runs = []
      for (let i = 0; i < check.runs; i++) runs.push(await lighthouse(base + path))
      const m = Object.fromEntries(Object.keys(runs[0]).map((k) => [k, median(runs.map((r) => r[k]))]))
      results[check.mode][name] = m
      const before = check.prior?.[name]
      console.log(`  ${name} (${path}): score ${m.score}, ${m.kb} KB`)
      row(`  ${name} LCP`, m.lcpMs, check.max.lcpMs, 'ms', before?.lcpMs)
      row(`  ${name} FCP`, m.fcpMs, check.max.fcpMs, 'ms', before?.fcpMs)
      row(`  ${name} TBT`, m.tbtMs, check.max.tbtMs, 'ms', before?.tbtMs)
      row(`  ${name} CLS`, m.cls, check.max.cls, '', before?.cls)
      if (before && m.lcpMs > before.lcpMs + check.toleranceMs) fail(`${name}: LCP ${m.lcpMs} ms is slower than the ${check.mode} baseline ${before.lcpMs} ms`)
      if (m.lcpMs > check.goal.lcpMs) notes.push(`${name}: LCP ${m.lcpMs} ms — the goal is ${check.goal.lcpMs} ms`)
    }
  } finally {
    server?.close()
  }
}

if (outDir) rmSync(outDir, { recursive: true, force: true })

// --------------------------------------------------------------- verdict
if (SAVE) {
  writeFileSync(baselinePath, `${JSON.stringify(mergeBaseline(baseline, results, LIVE), null, 2)}\n`)
  console.log(`\nSaved as the new baseline: ${relative(ROOT, baselinePath)}`)
}
for (const n of notes) console.log(`  · ${n}`)
if (problems.length) {
  console.log(`\n✗ Speed budget broken (${problems.length}):`)
  for (const p of problems) console.log(`  - ${p}`)
  console.log('\nFix it, or get the owner\'s OK and raise the limit in speed-budget.json in the same pull request, with the reason.')
  process.exit(1)
}
console.log('\n✓ Within the speed budget.')
