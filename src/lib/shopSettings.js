// The shop's switches (public.shop_settings, 19 Nov 2026). Today there is one:
// whether Express delivery by air is on. The owner pauses it from the
// dashboard's Orders section (src/admin/ExpressSwitch.jsx) for a festival rush
// or courier trouble, and while it is paused the database refuses an Express
// order (create_order).
//
// It is read once per visit. On the product page, the cart and checkout an
// anonymous visitor's copy comes from the read index.html started with the
// catalogue (src/boot/earlyStart.js), so no page waits for it. If it cannot be
// read at all, Express shows as on: the database still refuses it while it is
// paused, with a message that says so, and checkout falls back to free
// delivery.
import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { takeEarly } from './earlyData.js'

let express = null // true / false once known
let reading = null // the read in flight

/** The switch from a `shop_settings` answer; anything unreadable counts as on. */
export function expressFromRows(rows) {
  const row = Array.isArray(rows) ? rows[0] : null
  return typeof row?.express_delivery === 'boolean' ? row.express_delivery : true
}

async function readExpress() {
  const early = takeEarly('settings')
  try {
    if (early) return expressFromRows(await early)
    const { data, error } = await supabase.from('shop_settings').select('express_delivery').limit(1)
    return error ? true : expressFromRows(data)
  } catch {
    return true
  }
}

/** Whether Express delivery is on, read once per visit. */
export function expressDeliveryOn() {
  if (express !== null) return Promise.resolve(express)
  if (!reading) reading = readExpress().then((on) => { express = on; return on })
  return reading
}

/** Whether to offer Express: on until the switch has been read, then its value. */
export function useExpressDelivery() {
  const [on, setOn] = useState(express ?? true)
  useEffect(() => {
    let alive = true
    expressDeliveryOn().then((value) => { if (alive) setOn(value) })
    return () => { alive = false }
  }, [])
  return on
}
