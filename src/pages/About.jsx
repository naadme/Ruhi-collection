import { Link } from 'react-router-dom'
import Img from '../components/Img'
import { usePageImage } from '../lib/pageImages'
import usePageTitle from '../hooks/usePageTitle'
export default function About() {
  usePageTitle('About', 'The story behind Ruhi Womens Clothing — thoughtfully made everyday fashion, checked for fabric, stitching and fit before it ships.')
  // The three photographs this page shows are managed from the portal's
  // "Page images" section (src/admin/PageImagesPanel.jsx). Until one is saved
  // there, the same photograph and framing as before are used.
  const hero = usePageImage('about_hero')
  const first = usePageImage('about_a')
  const second = usePageImage('about_b')
  return (
    <>
      <section className="relative overflow-hidden h-[70vh] min-h-[440px] bg-neutral-300">
        <Img src={hero.image} style={hero.style} alt="Ruhi Womens Clothing studio" loading="eager" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/35" />
        <div className="relative h-full max-w-page mx-auto px-4 md:px-12 flex flex-col justify-end pb-14 text-white">
          <p className="tracking-[.3em] text-sm">ABOUT RUHI WOMENS CLOTHING</p>
          <h1 className="font-serif font-bold text-[54px] md:text-[112px] leading-[.95] mt-4 max-w-[900px]">Dressed well, every single day.</h1></div>
      </section>
      <section className="max-w-[1200px] mx-auto px-4 md:px-7 py-20 md:py-28 grid md:grid-cols-[1fr_1.4fr] gap-10 md:gap-20">
        <h2 className="font-serif text-[40px] md:text-[56px] leading-tight">Simple pieces, made with care.</h2>
        <div className="text-[21px] leading-9 text-black/70 space-y-6">
          <p>Ruhi Womens Clothing began with a simple idea: good clothes should not be complicated or expensive. We design Tops & tees, Co-ord sets and Dresses that fit properly, feel soft on the skin and hold their colour wash after wash.</p>
          <p>Every piece is checked for fabric, stitching and fit before it ships. We keep our range focused so each style earns its place in your wardrobe — from office days to weekends away.</p></div>
      </section>
      <section className="max-w-page mx-auto px-4 md:px-7 grid md:grid-cols-12 gap-4 items-start">
        <div className="md:col-span-7 w-full aspect-[4/3] overflow-hidden">
          <Img src={first.image} style={first.style} alt="" className="w-full h-full object-cover" />
        </div>
        <div className="md:col-span-5 w-full aspect-[4/5] overflow-hidden md:mt-24">
          <Img src={second.image} style={second.style} alt="" className="w-full h-full object-cover" />
        </div>
      </section>
      <section className="bg-[#FDF7F3] py-20 text-center px-4"><h2 className="font-serif text-[40px] md:text-[56px]">Find your next favourite.</h2>
        <Link to="/shop" className="inline-block bg-brand-yellow font-bold text-xl px-12 py-5 rounded-lg mt-8">Shop now</Link></section>
    </>
  )
}
