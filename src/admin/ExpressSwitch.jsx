import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { EXPRESS_DAYS, EXPRESS_FEE_PER_ITEM, inr } from '../lib/pricing'

// The dashboard's switch for Express delivery by air (19 Nov 2026), at the top
// of the Orders section. The owner pauses Express for a festival rush or
// courier trouble and turns it back on afterwards. While it is off, shoppers
// see only free delivery (product page, cart, checkout) and the database
// refuses an Express order; orders already placed stay Express.
//
// It reads and writes `public.shop_settings` with the owner's own session:
// anyone may read the switch, and only an admin may change it (RLS).
export default function ExpressSwitch({ notify }) {
  const [state, setState] = useState({ loading: true, on: null, error: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    supabase.from('shop_settings').select('express_delivery').limit(1).then(({ data, error }) => {
      if (!alive) return
      const on = data?.[0]?.express_delivery
      if (error || typeof on !== 'boolean') {
        setState({ loading: false, on: null, error: error ? 'The Express switch could not be read.' : 'The Express switch is not set up yet.' })
      } else {
        setState({ loading: false, on, error: '' })
      }
    })
    return () => { alive = false }
  }, [])

  const flip = async () => {
    const next = !state.on
    if (!next && !window.confirm('Pause Express delivery?\n\nShoppers will only see free delivery until you turn Express back on. Orders already placed stay Express.')) return
    setBusy(true)
    const { data, error } = await supabase
      .from('shop_settings').update({ express_delivery: next }).eq('id', true).select('express_delivery')
    setBusy(false)
    const saved = data?.[0]?.express_delivery
    if (error || saved !== next) {
      notify('error', 'Nothing was changed — your session may have expired. Sign in again and retry.')
      return
    }
    setState({ loading: false, on: saved, error: '' })
    notify('success', saved ? 'Express delivery is on again.' : 'Express delivery is paused.')
  }

  if (state.loading) return null
  if (state.error) {
    return <p className="adm-express-switch adm-express-switch--unknown">{state.error}</p>
  }
  return (
    <div className={`adm-express-switch ${state.on ? 'adm-express-switch--on' : 'adm-express-switch--off'}`}>
      <p className="min-w-0">
        <b>Express delivery by air: {state.on ? 'ON' : 'PAUSED'}</b>
        <span className="block text-[13px]">
          {state.on
            ? `Shoppers can choose it at checkout: ${inr(EXPRESS_FEE_PER_ITEM)} per item, arrives in ${EXPRESS_DAYS} days.`
            : 'Shoppers only see free delivery until you turn it back on.'}
        </span>
      </p>
      <button type="button" onClick={flip} disabled={busy} className="adm-express-switch-btn">
        {busy && <Loader2 size={14} className="animate-spin" />}
        {state.on ? 'Pause Express' : 'Turn Express back on'}
      </button>
    </div>
  )
}
