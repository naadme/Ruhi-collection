import { Link } from 'react-router-dom'
import Img from '../components/Img'
import { img } from '../data/images'
import { site } from '../data/site'
import usePageTitle from '../hooks/usePageTitle'
export default function About() {
  usePageTitle('About', 'The story behind Rohi Collection — thoughtfully made everyday fashion for men and women, checked for fabric, stitching and fit before it ships.')
  return (
    <>
      <section className="relative h-[70vh] min-h-[440px] bg-neutral-300">
        <Img src={img.aboutHero} alt="Rohi Collection studio" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/35" />
        <div className="relative h-full max-w-page mx-auto px-4 md:px-12 flex flex-col justify-end pb-14 text-white">
          <p className="tracking-[.3em] text-sm">ABOUT ROHI COLLECTION</p>
          <h1 className="font-serif font-bold text-[54px] md:text-[112px] leading-[.95] mt-4 max-w-[900px]">Dressed well, every single day.</h1></div>
      </section>
      <section className="max-w-[1200px] mx-auto px-4 md:px-7 py-20 md:py-28 grid md:grid-cols-[1fr_1.4fr] gap-10 md:gap-20">
        <h2 className="font-serif text-[40px] md:text-[56px] leading-tight">Simple pieces, made with care.</h2>
        <div className="text-[21px] leading-9 text-black/70 space-y-6">
          <p>Rohi Collection began with a simple idea: good clothes should not be complicated or expensive. We design shirts, tees and pants that fit properly, feel soft on the skin and hold their colour wash after wash.</p>
          <p>Every piece is checked for fabric, stitching and fit before it ships. We keep our range focused so each style earns its place in your wardrobe — from office days to weekends away.</p></div>
      </section>
      <section className="max-w-page mx-auto px-4 md:px-7 grid md:grid-cols-12 gap-4 items-start">
        <Img src={img.aboutA} alt="" className="md:col-span-7 w-full aspect-[4/3] object-cover" />
        <Img src={img.aboutB} alt="" className="md:col-span-5 w-full aspect-[4/5] object-cover md:mt-24" />
      </section>
      <section className="max-w-[1200px] mx-auto px-4 md:px-7 py-24 grid grid-cols-2 md:grid-cols-4 gap-10 text-center">{site.stats.map(([n, l]) => (
        <div key={l}><p className="font-serif font-bold text-[56px] md:text-[72px] text-brand-green leading-none">{n}</p><p className="mt-3 text-lg text-black/70">{l}</p></div>))}</section>
      <section className="bg-[#f4f1ea] py-20 text-center px-4"><h2 className="font-serif text-[40px] md:text-[56px]">Find your next favourite.</h2>
        <Link to="/shop" className="inline-block bg-brand-yellow font-bold text-xl px-12 py-5 rounded-lg mt-8">Shop now</Link></section>
    </>
  )
}
