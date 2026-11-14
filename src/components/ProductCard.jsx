import { memo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Heart } from 'lucide-react'
import Img from './Img'
import { inr } from '../lib/pricing'
import { productHref } from '../lib/productLinks'
import { useWishlist } from '../context/WishlistContext'
import { useCategories } from '../context/CategoriesContext'
import { imageFramingStyle } from '../lib/imageFraming'
import { useRatings } from '../context/RatingsContext'
import { RatingPill } from './Stars'
import { newEventId, trackSafely } from '../lib/tracking'
import { cartEvent, viewedItem } from '../lib/trackingItems'
import { useItemList } from './ItemList'
// The second photo that fades in on hover is for a mouse only. On a touch
// screen (every phone, including Instagram's and Facebook's in-app browsers)
// iOS treats the first tap on a link whose hover reveals new content as the
// hover — the photo swaps and the page does not open until a second tap. So a
// touch screen gets one photo and no swap: one tap opens the product, and the
// second photo is never downloaded.
const canHover = typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(hover: hover) and (pointer: fine)').matches)
// Grids rebuild their `items` array on every render, so without this each card
// would re-render whenever any sibling's parent re-rendered. Wishlist changes
// still reach every card — a context update is never blocked by memo().
// `priority`: this card opens the first screen of a listing (the shop's first
// row), so its photo is the one the page waits for: fetched at once and first.
function ProductCard({ product: p, priority = false }) {
  const { has, toggle } = useWishlist(); const fav = has(p.id)
  const { typeLabel } = useCategories()
  // GA4 (src/components/ItemList.jsx): the list this card sits in learns when
  // the card has been on screen and when it is opened.
  const list = useItemList()
  const listRef = useCallback((el) => list?.register(p.id, el), [list, p.id])
  const save = () => {
    // add_to_wishlist for a save, not for taking one back: the colour on the
    // card, in its first size, as view_item describes a product before a size
    // is chosen.
    if (!fav) {
      trackSafely(() => cartEvent('add_to_wishlist', [viewedItem(p, p.id, null, { category: typeLabel(p.type) })], { eventId: newEventId() }))
    }
    toggle(p.id)
  }
  const off = p.compare ? Math.round((1 - p.price / p.compare) * 100) : 0
  // The design's published reviews, every colour together
  // (src/context/RatingsContext.jsx); null — and nothing drawn — until it has
  // one. The numbers typed into the product editor are never shown.
  const rating = useRatings().ratingFor(p)
  // A price is only rendered once the client has actually set it: an unset
  // price would otherwise read as "₹0", which looks broken, not unfinished.
  const priced = p.price > 0
  // The link is the product's OWN route — the row whose photograph, price and
  // sizes this card shows (src/lib/productLinks.js). One rule, used by every
  // card on the site, so a card can never advertise one product and open
  // another.
  //
  // A card with no id has no page of its own and is rendered WITHOUT a link:
  // it must never fall back to the shop listing, which is what made a card
  // open the category page instead of its product.
  const href = productHref(p)
  const swap = canHover && Boolean(p.hover) && p.hover !== p.image
  const card = (
    <>
      <div className="relative aspect-[3/4] overflow-hidden bg-neutral-100">
        <Img src={p.image} style={imageFramingStyle(p.image_framing, p.image)} alt={p.title} {...(priority ? { loading: 'eager', fetchpriority: 'high' } : {})} sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 300px" className={`absolute inset-0 w-full h-full object-cover${swap ? ' transition-opacity duration-500 group-hover:opacity-0' : ''}`} />
        {swap && <Img src={p.hover} style={imageFramingStyle(p.image_framing, p.hover)} alt="" sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 300px" className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100" />}
        {p.badge && <span className="absolute top-2 left-1 bg-brand-badge text-white text-[10px] font-bold px-1.5 py-[3px] rounded-sm font-ui">{p.badge}</span>}
        {rating && <RatingPill rating={rating} className="absolute bottom-2 left-2" />}
      </div>
      <h3 className="text-[19px] md:text-[21px] leading-snug mt-2 pr-1 group-hover:underline underline-offset-2">{p.title}</h3>
      {priced && <p className="font-ui font-bold text-[17px] flex flex-wrap gap-x-3 items-baseline"><span className="text-red-600">{inr(p.price)}</span>
        {p.compare && <><s className="text-gray-400 font-normal">{inr(p.compare)}</s><span className="text-green-700 font-semibold">{off}% off</span></>}</p>}
    </>
  )
  return (
    <div className="group relative" ref={list ? listRef : undefined}>
      {href ? <Link to={href} onClick={list ? () => list.select(p.id) : undefined} className="block">{card}</Link> : <div className="block">{card}</div>}
      {/* The heart is a sibling of the link, never a child of it: tapping it
          saves the product and does not open its page. */}
      <button onClick={save} aria-label={fav ? `Remove ${p.title} from wishlist` : `Add ${p.title} to wishlist`} aria-pressed={fav} className="absolute top-2 right-2 w-9 h-9 rounded-full bg-white/90 grid place-items-center hover:scale-105 transition">
        <Heart size={18} strokeWidth={1.6} fill={fav ? '#C08576' : 'none'} stroke={fav ? '#C08576' : '#4A2C23'} /></button>
    </div>
  )
}
export default memo(ProductCard)
