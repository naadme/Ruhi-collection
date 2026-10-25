-- Ruhi Collection — a homepage banner photograph can be framed.
--
-- The hero crops every banner with `object-fit: cover`, which fills the frame
-- and throws away whatever falls outside it. A portrait photograph in the
-- hero's wide right-hand frame therefore loses its head and its hem, and a
-- photograph the owner framed around a model's face could end up showing
-- nothing but fabric. There was no way for her to say which part of her own
-- photograph she wanted kept.
--
-- This adds three columns to `banners`, one set per banner:
--
--   * `focus_x` — how far across the crop starts, 0 (left edge of the
--     photograph) to 100 (right edge). 50 is dead centre.
--   * `focus_y` — the same, 0 (top) to 100 (bottom).
--   * `zoom`   — how much the photograph is enlarged, 1 (not at all) to 2.
--
-- They are stored as three numbers and applied with CSS on the way out. The
-- uploaded file itself is never resized, re-encoded, cropped or replaced: the
-- photograph in storage stays byte for byte what the owner uploaded, so the
-- same banner can be reframed, reset and reframed again forever, and a
-- narrower or taller layout can be given its own framing later without ever
-- going back to the original file.
--
-- All three default to the values that produce today's rendering exactly —
-- centred, not enlarged — so every banner already saved looks the same after
-- this migration as it does before it, and the hero's layout, styling, order,
-- autoplay, arrows, active switches, destinations and links are untouched.
--
-- The table's own row-level security is unchanged: the storefront still reads
-- the banners, and only an admin may write them.

begin;

alter table public.banners
  add column if not exists focus_x double precision not null default 50,
  add column if not exists focus_y double precision not null default 50,
  add column if not exists zoom   double precision not null default 1;

-- A framing outside these ranges is not a framing — it is a value the browser
-- would either ignore or blow up on. The bounds are held here as well as in
-- the admin panel (src/lib/bannerPosition.js), so nothing that reaches the
-- table can be un-renderable.
alter table public.banners
  drop constraint if exists banners_focus_x_range;
alter table public.banners
  add constraint banners_focus_x_range check (focus_x >= 0 and focus_x <= 100);

alter table public.banners
  drop constraint if exists banners_focus_y_range;
alter table public.banners
  add constraint banners_focus_y_range check (focus_y >= 0 and focus_y <= 100);

alter table public.banners
  drop constraint if exists banners_zoom_range;
alter table public.banners
  add constraint banners_zoom_range check (zoom >= 1 and zoom <= 2);

commit;
