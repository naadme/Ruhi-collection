import usePageTitle from '../hooks/usePageTitle'
import { Hero, Categories, OurStory, Reviews, Features } from '../components/Sections'
import CollectionSection from '../components/CollectionSection'
import { collections } from '../data/products'
export default function Home() {
  usePageTitle('', 'Ruhi Womens Clothing — co-ord sets, dresses, tops and shirts. New arrivals, free shipping over ₹999 and fast delivery across India.')
  return (<><Hero /><Categories />{collections.map((c, i) => <div key={c.key}><CollectionSection c={c} />{i === 0 && <OurStory />}</div>)}<Reviews /><Features /></>)
}
