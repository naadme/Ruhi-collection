// Issue 2 — "the hero banner image cannot be positioned; it is not showing the
// full image because of a size issue."
//
// The hero crops every banner with `object-fit: cover`, which fills the frame
// and throws away whatever falls outside. A portrait photograph in the hero's
// wide right-hand frame therefore loses its head and its hem, and nothing in
// the admin panel could say which part to keep.
//
// These tests pin the whole path: three numbers stored per banner, applied by
// the ONE style rule the storefront and the admin preview both read, and — the
// point the owner cares most about — the uploaded photograph itself is never
// cropped, resized or rewritten. They also pin that everything else about the
// hero (order, arrows, active switches, destinations, links) is untouched.
//
// Run with `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  BANNER_POSITION, ZOOM_MAX, ZOOM_MIN,
  bannerPosition, bannerPositionStyle, clampFocusX, clampFocusY, clampZoom,
  coverSize, focusAfterDrag, focusAfterNudge, positionColumns, samePosition,
} from '../src/lib/bannerPosition.js'
import { heroSlides } from '../src/lib/heroSlider.js'
import { missingImports } from './helpers/imports.mjs'

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8')

const SQL = read('supabase/migrations/20261024120000_banner_positioning.sql')
const HERO = read('src/components/Sections.jsx')
const PANEL = read('src/admin/BannerPanel.jsx')
// The drag control itself now lives in its own module so that every image
// editor in the portal shares one control — the assertions that are about
// DRAGGING therefore read it, and the assertions that are about the banner
// panel's own save, order and switches keep reading the panel.
const BOX = read('src/admin/FrameBox.jsx')
const SLIDER = read('src/lib/heroSlider.js')

// ---- what a banner stores ---------------------------------------------------

test('a banner that has never been framed is centred and un-enlarged', () => {
  // 50 % across, 50 % down is dead centre — exactly what `object-position`
  // does on its own — so a banner saved before this existed renders the same.
  assert.deepEqual(BANNER_POSITION, { x: 50, y: 50, zoom: 1 })
  assert.deepEqual(bannerPosition({}), BANNER_POSITION)
  assert.deepEqual(bannerPosition(null), BANNER_POSITION)
  assert.deepEqual(bannerPosition(undefined), BANNER_POSITION)
  assert.deepEqual(bannerPosition({ focus_x: 'nope', focus_y: null, zoom: NaN }), BANNER_POSITION)
})

test('a framing is read from the row and clamped to what a browser can draw', () => {
  assert.deepEqual(bannerPosition({ focus_x: 20, focus_y: 80, zoom: 1.5 }), { x: 20, y: 80, zoom: 1.5 })
  assert.equal(bannerPosition({ focus_x: -40 }).x, 0, 'never left of the photograph')
  assert.equal(bannerPosition({ focus_x: 400 }).x, 100, 'never right of it')
  assert.equal(bannerPosition({ focus_y: -1 }).y, 0)
  assert.equal(bannerPosition({ focus_y: 1e9 }).y, 100)
  assert.equal(bannerPosition({ zoom: 0.2 }).zoom, ZOOM_MIN, 'a zoom below 1 would show gaps')
  assert.equal(bannerPosition({ zoom: 99 }).zoom, ZOOM_MAX, 'and one that large is a mistake')
})

test('the clamps round, so a stored value and the value it renders as agree', () => {
  // A long float would make the admin panel believe a banner had been moved
  // when it had not, and leave "Save" pressed for ever.
  assert.equal(clampFocusX(33.333333333333336), 33.33)
  assert.equal(clampFocusY('61.7'), 61.7)
  assert.equal(clampZoom(1.23456), 1.23)
  assert.equal(clampFocusX(undefined), 50)
  assert.equal(clampZoom(''), 1)
})

test('two framings compare on their numbers, not on their objects', () => {
  assert.ok(samePosition({ focus_x: 10, focus_y: 20, zoom: 1 }, { focus_x: 10, focus_y: 20, zoom: 1 }))
  assert.ok(samePosition({}, undefined), 'a banner and its own default are the same framing')
  assert.ok(!samePosition({ focus_x: 10 }, { focus_x: 11 }))
  assert.ok(!samePosition({ zoom: 1 }, { zoom: 1.2 }))
  assert.ok(samePosition({ focus_x: 50.0000001 }, {}), 'and rounding keeps a drag of a hair from counting')
})

// ---- the style the storefront draws -----------------------------------------

test('the default framing produces the markup the hero has always had', () => {
  // No transform at all: a banner that has never been moved is rendered by
  // exactly the same CSS as before this feature existed.
  const style = bannerPositionStyle(BANNER_POSITION)
  assert.equal(style.objectPosition, '50% 50%')
  assert.equal('transform' in style, false, 'a zoom of 1 adds no transform')
  assert.deepEqual(bannerPositionStyle(undefined), style, 'a row with no framing at all is the same')
})

test('a framing is drawn with object-position, and a zoom about the framed point', () => {
  const style = bannerPositionStyle({ focus_x: 25, focus_y: 75, zoom: 1.4 })
  assert.equal(style.objectPosition, '25% 75%')
  assert.equal(style.transform, 'scale(1.4)')
  // Zooming about the very point the owner framed means enlarging a
  // photograph never slides her subject back out of the picture.
  assert.equal(style.transformOrigin, '25% 75%')
})

test('the style survives a row carrying strings, as PostgREST may send them', () => {
  assert.equal(bannerPositionStyle({ focus_x: '40', focus_y: '60', zoom: '1.25' }).objectPosition, '40% 60%')
  assert.equal(bannerPositionStyle({ focus_x: '40', zoom: '1.25' }).transform, 'scale(1.25)')
})

// ---- dragging ---------------------------------------------------------------

test('coverSize is the largest size that still fills the frame', () => {
  // A 1200×1800 portrait in a 400×400 frame: the width governs, so the
  // photograph is drawn 400×600 and 200px of it hangs off the bottom.
  const drawn = coverSize(1200, 1800, 400, 400)
  assert.equal(Math.round(drawn.w), 400)
  assert.equal(Math.round(drawn.h), 600)
  // A 2:1 photograph in a 2:1 frame fits exactly — no crop, no pan room.
  assert.deepEqual(coverSize(2000, 1000, 600, 300), { w: 600, h: 300 })
  // The same photograph in a taller frame is widened by the height instead.
  assert.deepEqual(coverSize(2000, 1000, 600, 400), { w: 800, h: 400 })
  // A photograph that has not loaded yet is the box — no division by zero,
  // and no nonsense pan range.
  assert.deepEqual(coverSize(0, 0, 600, 400), { w: 600, h: 400 })
  assert.deepEqual(coverSize(1200, 1800, 0, 0), { w: 0, h: 0 })
})

// `cover` always makes ONE axis fit the frame exactly and lets the other hang
// over, so a photograph has pan room on one axis only. These two geometries
// are that pair: the same square frame, one photograph too wide for it and one
// too tall.
const TOO_WIDE = { naturalWidth: 1800, naturalHeight: 1200, boxWidth: 400, boxHeight: 400 }   // drawn 600×400: 200px across
const TOO_TALL = { naturalWidth: 1200, naturalHeight: 1800, boxWidth: 400, boxHeight: 400 }   // drawn 400×600: 200px down

test('dragging a photograph left reveals its right side, and vice versa', () => {
  // The image is grabbed and moved, so a leftward drag of 100px — the whole
  // 200px of overflow — brings its right-hand end into view.
  const dragged = focusAfterDrag({ x: 50, y: 50, zoom: 1 }, { dx: -100, dy: 0 }, TOO_WIDE)
  assert.equal(dragged.x, 100, 'dragging left by the whole overflow reaches the far edge')
  assert.equal(focusAfterDrag({ x: 50, y: 50, zoom: 1 }, { dx: -50, dy: 0 }, TOO_WIDE).x, 75)
  assert.equal(focusAfterDrag({ x: 50, y: 50, zoom: 1 }, { dx: 50, dy: 0 }, TOO_WIDE).x, 25)
  // A photograph with no room on an axis cannot be moved along it — the
  // framing stands still rather than jumping somewhere arbitrary.
  assert.equal(focusAfterDrag({ x: 20, y: 50, zoom: 1 }, { dx: 130, dy: 0 }, TOO_TALL).x, 20)
  assert.equal(focusAfterDrag({ x: 50, y: 20, zoom: 1 }, { dx: 0, dy: 130 }, TOO_WIDE).y, 20)
})

test('the tall axis works the same way, up and down', () => {
  // Dragging the photograph UP shows more of its BOTTOM, so the focus point
  // travels DOWN — the mirror of the horizontal rule.
  assert.equal(focusAfterDrag({ x: 50, y: 50, zoom: 1 }, { dx: 0, dy: -100 }, TOO_TALL).y, 100)
  assert.equal(focusAfterDrag({ x: 50, y: 50, zoom: 1 }, { dx: 0, dy: -50 }, TOO_TALL).y, 75)
  assert.equal(focusAfterDrag({ x: 50, y: 50, zoom: 1 }, { dx: 0, dy: 50 }, TOO_TALL).y, 25)
})

test('a drag is measured from where the finger went down, so it cannot drift', () => {
  // Each drag of 40px from the SAME starting framing is computed against that
  // framing, not against the last event — which is what makes a drag feel
  // like holding a photograph rather than like pushing a heavy object.
  const origin = { x: 50, y: 50, zoom: 1 }
  const one = focusAfterDrag(origin, { dx: -40, dy: 0 }, TOO_WIDE)
  const many = focusAfterDrag(origin, { dx: -400, dy: 0 }, TOO_WIDE)
  assert.ok(one.x > origin.x, 'the single drag moved the framing')
  assert.ok(many.x > one.x, 'and a longer drag moved it further — from the same origin')
  // The origin itself is never written to, so nothing accumulates.
  assert.deepEqual(origin, { x: 50, y: 50, zoom: 1 })
  // A drag that runs past the end stops at the end rather than overshooting.
  assert.equal(many.x, 100, 'and a drag past the end stops at the end')
})

test('a drag can never put the framing outside the photograph', () => {
  assert.deepEqual(focusAfterDrag({ x: 50, y: 50, zoom: 1 }, { dx: -4000, dy: 0 }, TOO_WIDE), { x: 100, y: 50, zoom: 1 })
  assert.deepEqual(focusAfterDrag({ x: 50, y: 50, zoom: 1 }, { dx: 4000, dy: 0 }, TOO_WIDE), { x: 0, y: 50, zoom: 1 })
  assert.deepEqual(focusAfterDrag({ x: 50, y: 50, zoom: 1 }, { dx: 0, dy: 4000 }, TOO_TALL), { x: 50, y: 0, zoom: 1 })
  // A photograph that has not loaded yet holds still instead of dividing by
  // zero and flinging the framing to an edge.
  const blank = { naturalWidth: 0, naturalHeight: 0, boxWidth: 400, boxHeight: 400 }
  assert.deepEqual(focusAfterDrag({ x: 30, y: 70, zoom: 1 }, { dx: -99, dy: 99 }, blank), { x: 30, y: 70, zoom: 1 })
})

test('zooming gives the photograph more room to pan, and stays in bounds', () => {
  // At zoom 1 the photograph is drawn 600×400 in a 400×400 frame: 200px of
  // horizontal overflow. At zoom 2 it is drawn 1200×800, so the same 50px of
  // finger travel covers half as much of it — the way a magnified print under
  // a mount really behaves.
  const half = focusAfterDrag({ x: 50, y: 50, zoom: 1 }, { dx: -50, dy: 0 }, TOO_WIDE)
  const zoomed = focusAfterDrag({ x: 50, y: 50, zoom: 2 }, { dx: -50, dy: 0 }, TOO_WIDE)
  assert.equal(half.x, 75)
  assert.ok(Math.abs(zoomed.x - 50) < Math.abs(half.x - 50), 'the magnified drag travels less far')
  // And an extreme drag at any zoom still lands inside the photograph.
  for (const zoom of [ZOOM_MIN, 1.5, ZOOM_MAX]) {
    assert.deepEqual(focusAfterDrag({ x: 50, y: 50, zoom }, { dx: -9999, dy: 0 }, TOO_WIDE), { x: 100, y: 50, zoom })
    assert.deepEqual(focusAfterDrag({ x: 50, y: 50, zoom }, { dx: 9999, dy: 0 }, TOO_WIDE), { x: 0, y: 50, zoom })
  }
})

test('arrow keys do what a drag does, for anyone who does not use a pointer', () => {
  const start = { focus_x: 50, focus_y: 50, zoom: 1 }
  // Right is the direction a rightward drag moves the PHOTOGRAPH, so the
  // focus point travels LEFT.
  assert.equal(focusAfterNudge(start, 1, 0).x, 49)
  assert.equal(focusAfterNudge(start, -1, 0).x, 51)
  assert.equal(focusAfterNudge(start, 0, 1).y, 49)
  assert.equal(focusAfterNudge(start, 0, -1000).y, 100)
  assert.deepEqual(focusAfterNudge(undefined, 0, 0), BANNER_POSITION, 'a row with no framing nudges from the centre')
})

test('the framing is written as the three columns the migration adds', () => {
  assert.deepEqual(positionColumns({ focus_x: 12.5, focus_y: 88, zoom: 1.3 }), { focus_x: 12.5, focus_y: 88, zoom: 1.3 })
  assert.deepEqual(positionColumns(undefined), { focus_x: 50, focus_y: 50, zoom: 1 }, 'a new banner is saved centred')
})

// ---- the photograph is never touched ----------------------------------------

test('the migration adds numbers and never rewrites a photograph', () => {
  assert.match(SQL, /add column if not exists focus_x/, 'additive — an existing banner keeps everything it had')
  assert.match(SQL, /add column if not exists focus_y/)
  assert.match(SQL, /add column if not exists zoom/)
  for (const forbidden of [
    /drop table/i, /truncate/i, /delete from/i, /drop column/i,
    /alter table public\.(?!banners)/, /\bupdate\s+public\.(?!banners)/i, /insert into public\.(?!banners)/i,
    /storage\.buckets/, /on storage\.objects/,
  ]) {
    assert.ok(!forbidden.test(SQL), `the positioning migration must not contain ${forbidden}`)
  }
})

test('the default framing is the rendering every banner already has', () => {
  // This is what makes the migration safe to run on a shop with four live
  // banners: the centre, un-enlarged, is what `object-fit: cover` does with
  // no instruction at all.
  assert.match(SQL, /focus_x double precision not null default 50/)
  assert.match(SQL, /focus_y double precision not null default 50/)
  assert.match(SQL, /zoom\s+double precision not null default 1/)
  // And the bounds are held in the database too, so nothing un-renderable can
  // ever be stored.
  assert.match(SQL, /check \(focus_x >= 0 and focus_x <= 100\)/)
  assert.match(SQL, /check \(focus_y >= 0 and focus_y <= 100\)/)
  assert.match(SQL, /check \(zoom >= 1 and zoom <= 2\)/)
})

// ---- the storefront and the panel agree -------------------------------------

test('the hero draws a banner through the one framing rule', () => {
  assert.match(HERO, /bannerPositionStyle\(cur\.position\)/, 'the hero applies the shared style')
  assert.match(HERO, /<Img[^>]*style=\{bannerPositionStyle/, 'to the photograph itself, not to a wrapper')
  // And nothing else about the hero moved.
  assert.match(HERO, /animate-\[fade_\.35s_ease\]/, 'the fade is untouched')
  assert.match(HERO, /aria-label="Show previous photo"/, 'the arrows are untouched')
  assert.match(HERO, /aria-label="Show next photo"/)
})

test('the hero’s slide rule carries each banner’s own framing through', () => {
  assert.match(SLIDER, /position: bannerPosition\(row\)/, 'read defensively, per banner')
  // The parts of the rule the owner did NOT ask to change.
  // `b` is switched off, so it is not a slide at all — the owner keeps it in
  // the panel and the site does not show it, exactly as before.
  const slides = heroSlides(
    [
      { id: 'a', image: '/a.jpg', link: '/shop?type=dress', is_active: true, focus_x: 10, focus_y: 90, zoom: 1.5 },
      { id: 'b', image: '/b.jpg', link: '/product/x', is_active: false },
      { id: 'c', image: '/c.jpg', link: '', is_active: true },
    ],
    [{ key: 'tops', image: '/t.jpg', to: '/shop?type=tops', label: 'Tops' }],
  )
  assert.deepEqual(slides.map((s) => s.to), ['/shop?type=dress', '/shop', '/shop?type=tops'],
    'destinations, active switches and the fallback order are exactly as before')
  assert.deepEqual(slides[0].position, { x: 10, y: 90, zoom: 1.5 }, 'and each banner keeps its own framing')
  assert.deepEqual(slides[1].position, BANNER_POSITION, 'a banner never framed is centred')
  assert.equal(slides[2].position, undefined, 'a fallback category photo is drawn as it always was')
})

test('the panel saves, compares and previews the framing — and only that', () => {
  assert.match(PANEL, /\.\.\.positionColumns\(rows\[i\]\)/, 'every save writes the framing')
  assert.match(PANEL, /focus_x, focus_y, zoom/, 'and reads it straight back')
  assert.match(PANEL, /!samePosition\(r, original\[i\]\)/, 'a drag is a change worth saving')
  assert.match(PANEL, /onFraming=/, 'the preview hands the framing back')
  // The preview draws with the storefront's own rule — there is no second
  // implementation that could drift away from what shoppers see.
  assert.match(BOX, /bannerPositionStyle\(framing\)/)
  assert.match(PANEL, /<FrameBox\b[\s\S]{0,400}?onDrag=\{onFraming\}/, 'and hands what it drew back to the panel')
  // Nothing else the owner relies on was disturbed.
  assert.match(PANEL, /slot: HOME_HERO_SLOT/, 'the slot is unchanged')
  assert.match(PANEL, /position: i/, 'the order is still the row order')
  assert.match(PANEL, /is_active: rows\[i\]\.is_active !== false/, 'and so is the on/off switch')
  assert.match(PANEL, /image: String\(rows\[i\]\.image\)\.trim\(\)/, 'the photograph is still just its address')
})

test('the panel offers both homepage shapes, because they crop differently', () => {
  // The hero is half the screen from `md` up and a full-width phone below it:
  // a photograph framed for one is cropped by the other, so the owner is shown
  // both and both are draggable.
  const desktop = PANEL.match(/label="Desktop"[\s\S]{0,260}?boxWidth=\{(\d+)\}[\s\S]{0,80}?ratio="(\d+)\s*\/\s*(\d+)"/)
  const phone = PANEL.match(/label="Phone"[\s\S]{0,260}?boxWidth=\{(\d+)\}[\s\S]{0,80}?ratio="(\d+)\s*\/\s*(\d+)"/)
  assert.ok(desktop && phone, 'both shapes are offered')
  assert.ok(Number(desktop[1]) > Number(phone[1]), 'and the desktop one really is wider')

  // A preview drawn at some convenient rectangle instead of the real one would
  // show the owner a slice of her photograph she will never see, and hide the
  // top and bottom she will — so the previews are pinned to the hero's own
  // CSS. The phone frame is as tall as the hero is below `md`, and the desktop
  // frame as tall as it is from `lg` up.
  const phoneTall = HERO.match(/overflow-hidden h-\[(\d+)px\]/)
  const desktopTall = HERO.match(/lg:h-\[(\d+)px\]/)
  assert.ok(phoneTall && desktopTall, 'the hero still declares its two heights')
  assert.equal(phone[3], phoneTall[1], `the phone preview matches the hero's ${phoneTall[1]}px`)
  assert.equal(desktop[3], desktopTall[1], `the desktop preview matches the hero's ${desktopTall[1]}px`)
  assert.equal(phone[2], '390', 'a phone is about as wide as it is tall')
  assert.ok(Number(desktop[2]) / Number(desktop[3]) > 0.9, 'and half a laptop screen is wider than tall')
  assert.notEqual(phone[3], desktop[3], 'the two really are different shapes')

  // Dragging, and a way back, for someone who is not a designer. The pointer
  // handling is the shared control's job; the buttons around it are the panel's.
  assert.match(BOX, /onPointerDown/)
  assert.match(BOX, /onPointerMove/)
  assert.match(BOX, /onPointerCancel/)
  assert.match(BOX, /focusAfterNudge\(/, 'arrow keys do what a drag does')
  assert.match(PANEL, /Centre it/, 'and one button puts the photograph back')
  assert.match(PANEL, /type="range"/, 'zoom is a slider, not a number to type')
  assert.match(PANEL, new RegExp(`min=\\{ZOOM_MIN\\}[\\s\\S]{0,80}max=\\{ZOOM_MAX\\}`), 'the slider cannot leave the safe range')
})

test('the panel never re-uploads, resizes or replaces a photograph to frame it', () => {
  // The whole point for the owner: the file she uploaded is the file that
  // stays. Framing is three numbers beside it.
  for (const [file, source] of [['BannerPanel.jsx', PANEL], ['FrameBox.jsx', BOX]]) {
    assert.ok(!/canvas|toDataURL|createImageBitmap|ImageBitmap|sharp/.test(source), `${file}: no pixels are ever recomputed`)
  }
  // The only upload in the panel is the one she presses.
  assert.equal((PANEL.match(/\.upload\(/g) || []).length, 1, 'one upload path, and it is the Replace button')
  assert.match(PANEL, /Only the columns|image: String\(rows\[i\]\.image\)\.trim\(\)/)
})

test('every file that frames a banner imports what it uses', () => {
  // A missing import builds cleanly — a bundler reads an unknown identifier as
  // a global — and passes any test that only greps for the CALL. The page then
  // dies behind its error boundary with the build green and the tests green,
  // which is exactly how `heroFallbackSlides` once shipped unimported.
  const named = [
    'bannerPosition', 'bannerPositionStyle', 'focusAfterDrag', 'focusAfterNudge',
    'positionColumns', 'samePosition', 'coverSize', 'BANNER_POSITION',
    'ZOOM_MIN', 'ZOOM_MAX', 'bannerPositionStyle',
  ]
  for (const [file, source] of [['BannerPanel.jsx', PANEL], ['FrameBox.jsx', BOX], ['Sections.jsx', HERO], ['heroSlider.js', SLIDER]]) {
    const missing = missingImports(source, named)
    assert.deepEqual(missing, [], `${file} uses but does not import: ${missing.join(', ')}`)
  }
})
