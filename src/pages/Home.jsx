import usePageTitle from '../hooks/usePageTitle'
import { Hero, Categories, OurStory, Reviews, Features } from '../components/Sections'
import CollectionSection from '../components/CollectionSection'
import { collections } from '../data/products'
export default function Home() {
  usePageTitle('')
  return (<><Hero /><Categories />{collections.map((c, i) => <div key={c.key}><CollectionSection c={c} />{i === 0 && <OurStory />}</div>)}<Reviews /><Features /></>)
}
