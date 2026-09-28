import usePageTitle from '../hooks/usePageTitle'
import { useParams } from 'react-router-dom'
const text = { 'privacy-policy': 'Privacy Policy', 'refund-policy': 'Refund Policy', 'shipping-policy': 'Shipping Policy', 'terms-of-service': 'Terms of Service' }
export default function Policy() {
  
  const { slug } = useParams()
  usePageTitle(text[slug] || 'Policy')
  return (<section className="max-w-[860px] mx-auto px-4 py-16"><h1 className="text-[40px] mb-8">{text[slug] || 'Policy'}</h1>
    <p className="text-[19px] leading-8 text-black/70">Our full policy text will be published here. For anything urgent, please contact us and we'll be glad to help.</p></section>)
}
