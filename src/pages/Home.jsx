import usePageTitle from '../hooks/usePageTitle'
import { Hero, Categories, BestSellers, OurStory, Features, Reviews, ContactStrip } from '../components/Sections'

// Homepage order: Hero → Shop by Category → Best Sellers → Our Story →
// benefits → reviews → contact/social. Each block answers a different
// question, so nothing (category, product or promise) is stated twice.
export default function Home() {
  usePageTitle('', 'Ruhi Womens Clothing — co-ord sets, dresses, tops and shirts. New arrivals, free shipping for all products and fast delivery across India.')
  return (
    <>
      <Hero />
      <Categories />
      <BestSellers />
      <OurStory />
      <Features />
      <Reviews />
      <ContactStrip />
    </>
  )
}
