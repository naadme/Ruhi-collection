import { site } from '../data/site'
export default function AnnouncementBar() {
  const row = [...site.announcements, site.announcements[0]]
  return (
    <div className="bg-brand-green text-white overflow-hidden h-[50px] flex items-center text-[15px] font-ui font-medium">
      <div className="marquee flex whitespace-nowrap w-max">
        {[0, 1].map((k) => <div key={k} className="flex">{row.map((t, i) => <span key={i} className="px-6 flex items-center gap-12">{t}<span className="opacity-70">·</span></span>)}</div>)}
      </div>
    </div>
  )
}
