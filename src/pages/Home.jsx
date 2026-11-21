import usePageTitle from '../hooks/usePageTitle'
import HomeModern from '../components/home/HomeModern'

// The homepage (redesign, 21 Nov 2026): the shop-first "Modern" design the
// owner chose — category chips, an auto-moving 3:4 hero with the rating just
// under it, bestsellers, a category bento, "Everything under ₹1000", shop by
// colour, newest styles, published reviews and Instagram/WhatsApp. The page's
// code is its own file, fetched on demand (src/lib/homePage.js), so product
// pages, where the ads land, don't download it.
export default function Home() {
  usePageTitle('', 'Ruhi Womens Clothing — co-ord sets, dresses, tops and shirts. New arrivals, free shipping for all products and fast delivery across India.')
  return <HomeModern />
}
