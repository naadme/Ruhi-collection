import usePageTitle from '../hooks/usePageTitle'
import { Hero, Categories, OurStory, Reviews, Features } from '../components/Sections'
import CollectionSection from '../components/CollectionSection'
import { collections } from '../data/products'
export default function Home() {
  usePageTitle('', 'Ruhi Womens Clothing — everyday shirts, T-shirts and pants for men and women. New arrivals, free shipping over ₹999 and 30-day easy returns.')
  return (<><Hero /><Categories />{collections.map((c, i) => <div key={c.key}><CollectionSection c={c} />{i === 0 && <OurStory />}</div>)}<Reviews /><Features /></>)
}
