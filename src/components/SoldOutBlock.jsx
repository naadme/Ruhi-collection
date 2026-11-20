import { useCallback, useEffect, useMemo, useState } from 'react'
import Img from './Img'
import ProductCard from './ProductCard'
import ItemList, { useItemList } from './ItemList'
import { useProducts } from '../context/ProductsContext'
import { useRatings } from '../context/RatingsContext'
import { fetchBestsellers } from '../lib/bestsellers'
import { pickActive, pickId } from '../lib/bestsellerRules'
import { crossPromotion } from '../lib/crossPromotion'
import { imageFramingStyle } from '../lib/imageFraming'
import { productHref } from '../lib/productLinks'
import { LISTS } from '../lib/itemLists'

// What a sold-out page sells instead (20 Nov 2026, proposal section 5). It
// takes the buy buttons' place, right after the sizes, so it is the first
// thing the shopper meets: the same set in other colours that are in stock
// (in her size, if she picked one), then similar sets in her size. The rules
// are in src/lib/crossPromotion.js.
//
// Loaded on demand (src/lib/soldOutBlock.js). Its clicks are GA4 list events
// under their own list name, "Sold out – similar" (owner's OK, 20 Nov 2026).

// The owner's best-seller picks order the similar styles. One read per
// visit, started the moment this file arrives — the product page fetches it
// as soon as the product on screen has a sold-out size — so it has usually
// answered before the block is shown. Until it answers (2 s at most) the
// block shows a placeholder, so nothing reshuffles in front of her and the
// block's GA4 list is the same list from its first view.
const PICKS_WAIT_MS = 2000
let picksOnce = null
const ownerPicks = () => {
  if (!picksOnce) {
    picksOnce = fetchBestsellers()
      .then((rows) => rows.filter(pickActive).map(pickId).filter(Boolean))
      .catch(() => [])
  }
  return picksOnce
}
ownerPicks()

function ColourTile({ colour, href, label, onPick }) {
  // The tile is a product in the block's GA4 list, like the cards below it.
  const list = useItemList()
  const ref = useCallback((el) => list?.register(colour.id, el), [list, colour.id])
  return (
    <a
      ref={ref}
      href={href}
      onClick={(e) => {
        e.preventDefault()
        list?.select(colour.id)
        onPick(colour)
      }}
      className="shrink-0 w-[76px] text-center"
    >
      <span className="block w-[76px] aspect-[3/4] overflow-hidden rounded-lg bg-neutral-100">
        {colour.image && (
          <Img src={colour.image} style={imageFramingStyle(colour.image_framing, colour.image)} alt="" sizes="76px" className="w-full h-full object-cover" />
        )}
      </span>
      <span className="block mt-1 text-[13px] leading-tight">{label}</span>
    </a>
  )
}

export default function SoldOutBlock({ design, shown, colour, size, colourOut, designOut, onPick }) {
  const { listable } = useProducts()
  const { ratingFor } = useRatings()

  const [picks, setPicks] = useState(null)
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => { if (alive) setPicks((p) => p || []) }, PICKS_WAIT_MS)
    ownerPicks().then((ids) => { if (alive) setPicks(ids) })
    return () => { alive = false; clearTimeout(timer) }
  }, [])

  const { colours, similar } = useMemo(
    () => crossPromotion({ design, currentId: shown.id, size, listable, picks: picks || [], rating: ratingFor }),
    [design, shown.id, size, listable, picks, ratingFor],
  )
  // The tiles as GA4 items: the design's name, the tile's own colour.
  const tiles = useMemo(() => colours.map((c) => ({ ...c, title: design.title, colour: c.color || c.colour })), [colours, design.title])
  const tracked = useMemo(() => [...tiles, ...similar], [tiles, similar])
  const sized = (path) => (size ? `${path}?size=${encodeURIComponent(size)}` : path)

  const heading = designOut
    ? 'This style is sold out'
    : colourOut
      ? `${colour || 'This colour'} is sold out`
      : `${colour ? `${colour} is sold out` : 'Sold out'} in ${size}`

  return (
    <section aria-labelledby="sold-out-heading" className="mt-7 border border-black/15 rounded-xl p-4">
      <h2 id="sold-out-heading" className="text-[18px] font-bold">{heading}</h2>
      {!picks ? (
        <div className="grid grid-cols-2 gap-x-1 gap-y-6 animate-pulse mt-3" aria-hidden="true">
          {[0, 1].map((i) => <div key={i} className="aspect-[3/4] bg-neutral-200" />)}
        </div>
      ) : (
        <ItemList list={LISTS.soldOutSimilar} products={tracked}>
          {tiles.length > 0 && (
            <>
              <p className="text-sm text-black/60 mt-3 mb-2">
                {size ? `Same style · in stock in ${size}` : `Same style · ${tiles.length} ${tiles.length === 1 ? 'colour' : 'colours'} in stock`}
              </p>
              <div className="flex gap-3 overflow-x-auto -mx-4 px-4 pb-1">
                {tiles.map((c) => (
                  <ColourTile key={c.id} colour={c} href={sized(productHref(c))} label={c.colour} onPick={onPick} />
                ))}
              </div>
            </>
          )}

          <p className="text-sm text-black/60 mt-5 mb-2">{size ? `Similar styles in ${size}` : 'Similar styles in stock'}</p>
          {similar.length ? (
            <div className="grid grid-cols-2 gap-x-1 gap-y-6">
              {similar.map((x) => <ProductCard key={x.id} product={x} to={sized(productHref(x))} />)}
            </div>
          ) : (
            <p className="text-[15px] text-black/60">{size ? `Nothing similar is in stock in ${size} right now.` : 'Nothing similar is in stock right now.'}</p>
          )}
        </ItemList>
      )}
    </section>
  )
}
