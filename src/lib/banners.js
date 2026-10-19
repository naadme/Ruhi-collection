// The homepage hero banner list, read from the `banners` table
// (supabase/migrations/20261019120000_home_hero_banners.sql).
//
// The hero keeps its exact layout, arrows and fade animation — this module
// only says which photos it slides between. With no rows saved, the hero
// falls back to the original category-photo slider, so the site looks and
// behaves exactly as before until the admin saves a banner.

import { supabase } from './supabase'

export const HOME_HERO_SLOT = 'home_hero'

/** Every active banner for the homepage hero, in saved order.
 *
 *  The homepage itself never throws: it renders with whatever Supabase
 *  answered — a failure simply means "use the category photos". The admin
 *  panel asks for the strict form instead (`{ strict: true }`), so a network
 *  or permission error is reported there rather than looking like an empty
 *  list the admin might then overwrite. */
export async function fetchHomeBanners({ strict = false } = {}) {
  try {
    const { data, error } = await supabase
      .from('banners')
      .select('*')
      .eq('slot', HOME_HERO_SLOT)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .retry(false)
    if (error) throw new Error(error.message || 'Could not load the homepage banners.')
    return (data || []).filter((b) => b && typeof b.image === 'string' && b.image.trim())
  } catch (e) {
    if (strict) throw e
    return []
  }
}
