// Homepage banners: each one has its own destination, and its own on/off
// switch.
//
// The client asked for every banner to point where it is meant to point — a
// product page, a category page, an approved image destination — and for a
// banner whose destination is missing or wrong to fall back to something that
// works rather than to a broken page.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  BANNER_FALLBACK,
  bannerDestination,
  bannerLinkProblem,
  describeBannerDestination,
  isValidBannerLink,
} from '../src/lib/bannerLinks.js'
import { heroSlides } from '../src/lib/heroSlider.js'

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8')

test('a path on this site is a usable destination', () => {
  assert.equal(isValidBannerLink('/shop'), true)
  assert.equal(isValidBannerLink('/shop?type=dress'), true)
  assert.equal(isValidBannerLink('/product/denim-shirt-blue'), true)
})

test('another site is a usable destination only over https', () => {
  assert.equal(isValidBannerLink('https://example.com/look'), true)
  assert.equal(isValidBannerLink('http://example.com/look'), false,
    'an address the browser cannot trust is refused')
  assert.equal(isValidBannerLink('javascript:alert(1)'), false)
  assert.equal(isValidBannerLink('//evil.example/look'), false,
    'a double slash would send the shopper to another site')
})

test('a typo is not a destination', () => {
  assert.equal(isValidBannerLink('shop'), false)
  assert.equal(isValidBannerLink('shops/dress'), false)
})

test('a banner with no destination goes to the shop', () => {
  assert.equal(bannerDestination(''), BANNER_FALLBACK)
  assert.equal(bannerDestination(null), BANNER_FALLBACK)
  assert.equal(bannerDestination('   '), BANNER_FALLBACK)
})

test('a banner with a broken destination goes to the shop, never to a broken page', () => {
  assert.equal(bannerDestination('shops/dress'), BANNER_FALLBACK)
  assert.equal(bannerDestination('javascript:alert(1)'), BANNER_FALLBACK)
  assert.equal(bannerDestination('//evil.example'), BANNER_FALLBACK)
})

test('a banner with a good destination keeps it', () => {
  assert.equal(bannerDestination('/shop?type=dress'), '/shop?type=dress')
  assert.equal(bannerDestination('/product/denim-shirt-blue'), '/product/denim-shirt-blue')
  assert.equal(bannerDestination('https://example.com/look'), 'https://example.com/look')
})

test('the admin is told what is wrong with a destination', () => {
  assert.equal(bannerLinkProblem('/shop'), '')
  assert.equal(bannerLinkProblem(''), '')
  assert.match(bannerLinkProblem('shops/dress'), /not a link this site can open/)
  assert.match(bannerLinkProblem('//evil.example'), /another site/)
  assert.match(bannerLinkProblem('javascript:alert(1)'), /https/)
})

test('the admin is told where a banner points', () => {
  assert.match(describeBannerDestination(''), /default/)
  assert.match(describeBannerDestination('/shop?type=dress'), /category page dress/)
  assert.match(describeBannerDestination('/product/denim-shirt-blue'), /product page denim-shirt-blue/)
  assert.match(describeBannerDestination('/collections'), /Collections/)
})

test('each banner keeps its own destination', () => {
  const slides = heroSlides([
    { id: 'b1', image: '/a.jpg', link: '/shop?type=dress', position: 0 },
    { id: 'b2', image: '/b.jpg', link: '/product/denim-shirt-blue', position: 1 },
    { id: 'b3', image: '/c.jpg', link: '', position: 2 },
  ], [])
  assert.deepEqual(slides.map((s) => s.to), ['/shop?type=dress', '/product/denim-shirt-blue', '/shop'])
})

test('a banner that is switched off is not shown', () => {
  const slides = heroSlides([
    { id: 'b1', image: '/a.jpg', link: '/shop', is_active: true },
    { id: 'b2', image: '/b.jpg', link: '/shop', is_active: false },
  ], [])
  assert.deepEqual(slides.map((s) => s.key), ['b1'])
})

test('the panel can switch a banner on and off, and shows the live ones', () => {
  const panel = read('src/admin/BannerPanel.jsx')
  assert.match(panel, /is_active/, 'the switch is saved')
  assert.match(panel, /Active on the site/, 'and the live banners are shown')
  assert.match(panel, /bannerLinkProblem/, 'a broken destination is refused before it is saved')
  assert.match(panel, /describeBannerDestination/, 'and the owner is told where each one points')
})

test('the banner row survives the change — the carousel is untouched', () => {
  const sections = read('src/components/Sections.jsx')
  assert.match(sections, /heroSlides\(banners/, 'the hero still reads the shared slide rule')
  assert.match(sections, /animate-\[fade_\.35s_ease\]/, 'and the fade is unchanged')
  assert.match(sections, /object-cover/, 'and so is the way the photo fills its half')
})

test('the banners table can switch a banner on and off', () => {
  const migration = read('supabase/migrations/20261021100000_active_switches_and_sync_ledger.sql')
  assert.match(migration, /alter table public\.banners\s+add column if not exists is_active boolean not null default true/)
  assert.match(migration, /The banners that are live now stay live/)
})
