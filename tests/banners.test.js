import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Homepage hero banners (feature D). Nothing here reaches Supabase: the
// migration and the handful of source files that decide what a visitor sees
// are read as text, in the same style as tests/coupons.test.js.

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const SQL = read('supabase/migrations/20261019120000_home_hero_banners.sql');
const BANNERS = read('src/lib/banners.js');
const HERO = read('src/components/Sections.jsx');
const PANEL = read('src/admin/BannerPanel.jsx');
const DASHBOARD = read('src/admin/Dashboard.jsx');

test('the migration creates the banners table with the single hero slot', () => {
  assert.match(SQL, /create table if not exists public\.banners \(/);
  assert.match(SQL, /slot\s+text not null default 'home_hero' check \(slot = 'home_hero'\)/);
  assert.match(SQL, /image\s+text not null check \(char_length\(btrim\(image\)\) between 1 and 2000\)/);
  assert.match(SQL, /position\s+integer not null default 0/);
});

test('row level security is enabled and the public may only READ banners', () => {
  assert.match(SQL, /alter table public\.banners enable row level security/);
  // everyone sees the homepage slides
  assert.match(SQL, /create policy "public can view banners"[\s\S]{0,80}for select[\s\S]{0,40}using \(true\)/);
  // but no browser role is handed blanket write access
  assert.match(SQL, /revoke all on table public\.banners from anon/);
  assert.match(SQL, /grant\s+select on table public\.banners to anon/);
});

test('every write to banners is gated on being an admin', () => {
  for (const verb of ['insert', 'update', 'delete']) {
    const policy = new RegExp(
      `create policy "admins can (?:create|update|delete) banners"[\\s\\S]{0,120}for ${verb}[\\s\\S]{0,160}is_admin\\(\\)`,
    );
    assert.match(SQL, policy, `the ${verb} policy must require is_admin()`);
  }
  // an insert also needs the check side, not just the using side
  assert.match(SQL, /for insert to authenticated\s+with check \(public\.is_admin\(\)\)/);
});

test('the migration cannot alter or destroy existing shop data', () => {
  // This one runs FIRST in production, so it must be additive and nothing else.
  for (const forbidden of [
    /alter table public\.(?!banners)/,
    /drop table/i,
    /truncate/i,
    /delete from/i,
    /\bupdate\s+public\.(?!banners)/i,
    /insert into public\.(?!banners)/i,
  ]) {
    assert.ok(!forbidden.test(SQL), `banners migration must not contain ${forbidden}`);
  }
  // it must not reach into the storage policies another feature depends on
  assert.ok(!SQL.includes('storage.buckets'), 'no bucket may be created');
  assert.ok(!SQL.includes('on storage.objects'), 'no storage policy may be changed');
});

test('the migration is safe to run twice', () => {
  assert.match(SQL, /create table if not exists public\.banners/);
  assert.match(SQL, /drop trigger if exists set_banners_updated_at/);
  assert.match(SQL, /drop policy if exists "public can view banners"/);
  assert.match(SQL, /drop policy if exists "admins can create banners"/);
  assert.match(SQL, /drop policy if exists "admins can update banners"/);
  assert.match(SQL, /drop policy if exists "admins can delete banners"/);
});

test('a visitor with no banners gets the original category slider, never an error', () => {
  // The homepage asks non-strictly: a missing table, a network failure and an
  // empty table are all just "no banners saved" — the hero renders as always.
  assert.match(BANNERS, /fetchHomeBanners\(\{ strict = false \} = \{\}\)/);
  assert.match(BANNERS, /export const HOME_HERO_SLOT = 'home_hero'/);
  // ...and the hero falls back to the stocked category list when empty
  assert.match(HERO, /heroSlides\(banners/, 'the slide list comes from the shared rule');
  assert.match(HERO, /stockedCategoryTiles\(categories, products\)/, 'the fallback is still the stocked categories');
});

test('the admin panel asks for the strict answer, and reports a real failure', () => {
  // `strict` is what separates "the table does not exist yet" (an error the
  // admin must see) from "there are no banners" (an empty, editable list).
  assert.match(PANEL, /fetchHomeBanners\(\{ strict: true \}\)/);
  assert.match(PANEL, /state\.error/);
});

test('banner images go to the existing bucket, and only admins reach the panel', () => {
  // Reusing `product-images` means no bucket and no storage policy change.
  assert.match(PANEL, /const bucket = 'product-images'/);
  assert.match(PANEL, /home-banner-\$\{Date\.now\(\)\}/);
  // the panel is mounted behind the admin dashboard, never on a public route
  assert.match(DASHBOARD, /section === 'banners' && <BannerPanel/);
});
