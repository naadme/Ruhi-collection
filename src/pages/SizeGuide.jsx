import usePageTitle from '../hooks/usePageTitle'
import { SizeChartPanel } from '../components/SizeChart'

// Every size chart in one place, linked from the footer and from the chart on
// each product page (src/lib/sizeCharts.js holds the numbers).
export default function SizeGuide() {
  usePageTitle('Size guide')
  return (
    <section className="max-w-[760px] mx-auto px-4 py-12 md:py-16">
      <h1 className="text-[36px] md:text-[40px]">Size guide</h1>
      <p className="text-black/60 mt-2 text-[16px]">
        Measure yourself and pick the size whose measurements are closest to yours.
      </p>

      <h2 className="text-[22px] mt-10 mb-3">Tops, T-shirts, shirts, kurtas &amp; dresses</h2>
      <SizeChartPanel type="tops" showAllRows />

      <h2 className="text-[22px] mt-10 mb-3">Jeans, trousers &amp; pants</h2>
      <SizeChartPanel type="trousers" showAllRows />

      <p className="text-black/60 mt-10 text-[15px]">
        Co-ord sets and nightsuits come in one size for the whole set: check the top chart for the top and the
        bottom chart for the pant. Each product page shows the right chart under <b className="font-medium">Size chart</b>.
      </p>
    </section>
  )
}
