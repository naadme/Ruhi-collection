import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import ProductGrid from './ProductGrid'
import { useProducts } from '../context/ProductsContext'
export default function CollectionSection({ c }) {
  const { products, loading, source } = useProducts()
  const [tab, setTab] = useState(c.tabs[0][0])
  const visible = products.filter((p) => p.type === tab).slice(0, 4)
  // Several of these sections share a page, so the tab/panel ids must be unique.
  const uid = useId()
  const panelId = `${uid}-panel`
  return (
    <section className="max-w-page mx-auto px-4 md:px-7 pt-8 pb-10">
      <h2 className="text-center text-[30px] md:text-[34px] font-normal tracking-wide">{c.title}</h2>
      <p className="text-center text-[20px] text-black/60 mt-4">{c.subtitle}</p>
      <div className="flex justify-center mt-16 border-b border-black/15" role="tablist" aria-label={`${c.title} categories`}>
        {c.tabs.map(([k, l]) => (
          <button
            key={k} type="button" role="tab" id={`${uid}-tab-${k}`}
            aria-selected={tab === k} aria-controls={panelId}
            onClick={() => setTab(k)}
            className={`px-6 py-3 text-[17px] font-ui border-b-[3px] -mb-px ${tab === k ? 'border-black text-black' : 'border-transparent text-black/50'}`}
          >{l}</button>
        ))}
      </div>
      <div className="mt-10" id={panelId} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`}>
        <ProductGrid
          items={visible}
          loading={loading && source !== 'database'}
          empty={{
            title: 'Nothing here yet',
            body: 'This category is empty for now — browse everything instead.',
          }}
        />
      </div>
      <div className="text-center mt-14"><Link to={`/shop?type=${tab}`} className="btn-outline">View All Products</Link></div>
    </section>
  )
}
