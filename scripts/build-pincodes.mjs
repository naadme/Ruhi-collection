// Builds public/data/pincodes/<NN>.json, checkout's PIN code → city and state
// list (src/lib/pincodes.js), from India Post's All India Pincode Directory:
// the CSV published by the Department of Posts on data.gov.in (Government
// Open Data Licence – India), one row per post office.
//
//   node scripts/build-pincodes.mjs <path to the directory CSV>
//
// The CSV itself is not kept in the repository. For each PIN the most common
// district among its post offices becomes the city, and the most common state
// the state, written exactly as in INDIAN_STATES (src/lib/checkout.js). Rows
// whose state can't be matched are left out and listed, so those PINs fall
// back to the City and State boxes at checkout. So are PINs starting with 9
// (the Army Postal Service, not street addresses) and India Post's own
// "TEST OFFICE" row (999999).
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INDIAN_STATES } from '../src/lib/checkout.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'pincodes')

// Older spellings and ampersands in the directory → the names checkout uses.
const STATE_ALIASES = {
  'andaman & nicobar islands': 'Andaman and Nicobar Islands',
  'andaman and nicobar': 'Andaman and Nicobar Islands',
  'dadra & nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'daman & diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'the dadra and nagar haveli and daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'dadra & nagar haveli & daman & diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'jammu & kashmir': 'Jammu and Kashmir',
  'pondicherry': 'Puducherry',
  'orissa': 'Odisha',
  'uttaranchal': 'Uttarakhand',
  'chattisgarh': 'Chhattisgarh',
  'new delhi': 'Delhi',
  'nct of delhi': 'Delhi',
}
const STATES = new Map(INDIAN_STATES.map((s) => [s.toLowerCase(), s]))

export function stateName(raw) {
  const key = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!key) return null
  return STATES.get(key) || STATE_ALIASES[key] || STATES.get(key.replace(/&/g, 'and')) || null
}

/** "BENGALURU URBAN" → "Bengaluru Urban"; "24 PARAGANAS NORTH" → "24 Paraganas North". */
export function cityName(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
    .replace(/(^|[\s(\-/.])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())
}

/** One CSV line → fields (quotes and doubled quotes handled). */
export function csvFields(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1 }
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

const mostCommon = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]

/** PIN → "City|State" for every PIN in the CSV text, plus what was left out. */
export function buildPincodes(csvText) {
  const lines = csvText.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const header = csvFields(lines[0]).map((h) => h.trim().toLowerCase())
  const col = (...names) => names.map((n) => header.indexOf(n)).find((i) => i >= 0)
  const iPin = col('pincode')
  const iOffice = col('officename')
  const iDistrict = col('district', 'districtname')
  const iState = col('statename', 'state')
  if ([iPin, iDistrict, iState].some((i) => i === undefined)) {
    throw new Error(`Unexpected columns: ${header.join(', ')}`)
  }
  const byPin = new Map()
  const unmatched = new Map()
  let rows = 0
  for (const line of lines.slice(1)) {
    const f = csvFields(line)
    const pin = String(f[iPin] ?? '').trim()
    if (!/^[1-9][0-9]{5}$/.test(pin)) continue
    rows += 1
    if (pin.startsWith('9') || /\btest office\b/i.test(f[iOffice] ?? '')) continue
    const state = stateName(f[iState])
    if (!state) { unmatched.set(f[iState], (unmatched.get(f[iState]) || 0) + 1); continue }
    const city = cityName(f[iDistrict])
    if (!city) continue
    const entry = byPin.get(pin) || { cities: new Map(), states: new Map() }
    entry.cities.set(city, (entry.cities.get(city) || 0) + 1)
    entry.states.set(state, (entry.states.get(state) || 0) + 1)
    byPin.set(pin, entry)
  }
  const pins = {}
  for (const [pin, e] of [...byPin.entries()].sort()) pins[pin] = `${mostCommon(e.cities)}|${mostCommon(e.states)}`
  return { pins, rows, unmatched: Object.fromEntries(unmatched) }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const source = process.argv[2]
  if (!source) { console.error('Usage: node scripts/build-pincodes.mjs <directory CSV>'); process.exit(1) }
  const { pins, rows, unmatched } = buildPincodes(readFileSync(source, 'utf8'))
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const groups = {}
  for (const [pin, value] of Object.entries(pins)) (groups[pin.slice(0, 2)] ||= {})[pin] = value
  for (const [prefix, map] of Object.entries(groups)) writeFileSync(join(OUT, `${prefix}.json`), JSON.stringify(map))
  const files = readdirSync(OUT)
  const bytes = files.reduce((n, name) => n + readFileSync(join(OUT, name)).length, 0)
  console.log(JSON.stringify({ rows, pins: Object.keys(pins).length, files: files.length, bytes, unmatched }, null, 2))
}
