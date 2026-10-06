// Business details — edit these constants; they feed the footer, contact page and announcement bar.
// Shipping charges live in src/lib/pricing.js and must match the database rule
// in supabase/migrations/20260928181500_orders_and_checkout.sql.
import { TYPES } from './products'

// Every category link (header dropdown, footer shop list) is generated from the
// catalogue's own TYPES, so the navigation, the footer and the shop's Type
// filter can never disagree about what a category is called.
const typeLink = (t) => ({ label: t.label, to: `/shop?type=${t.key}` })

export const site = {
  name: 'Ruhi Womens Clothing',
  short: 'RUHI',
  tagline: 'Everyday fashion for women — thoughtfully made, honestly priced.',
  // No physical outlet — Ruhi Collection sells online only, so the site
  // publishes contact channels (phone, email, socials) and never a street
  // address.
  phone: '9046651272',
  email: 'himabindu.nalli123@gmail.com',
  hours: 'Mon – Sat, 10:00 – 19:00 IST',
  social: [{ label: 'Instagram', href: 'https://www.instagram.com/ruhi_fashions_/' }, { label: 'Facebook', href: 'https://facebook.com' }, { label: 'WhatsApp', href: 'https://wa.me/919876543210' }, { label: 'YouTube', href: 'https://youtube.com' }],
  announcements: ['Fast delivery across India', 'Free shipping on orders over ₹999', '30-day easy returns', 'Customer support 10am – 7pm', 'Secure checkout'],
  nav: [
    { label: 'Home', to: '/' },
    // The catalogue branch renders as a dropdown in the header (and as a nested
    // list in the mobile drawer). Each child deep-links into the shop's own
    // filters, so no extra routes or pages are needed.
    {
      label: 'Catalogue', to: '/collections',
      children: TYPES.map(typeLink),
    },
    { label: 'About', to: '/about' },
    { label: 'Contact', to: '/contact' },
  ],
  shopLinks: [{ label: 'All products', to: '/shop' }, ...TYPES.map(typeLink)],
  service: [
    { label: 'Contact us', to: '/contact' },
    { label: 'Shipping policy', to: '/policies/shipping-policy' },
    { label: 'Refund policy', to: '/policies/refund-policy' },
    { label: 'Your cart', to: '/cart' },
    { label: 'Wishlist', to: '/wishlist' },
    { label: 'Your account', to: '/account' },
  ],
  legal: [{ label: 'Privacy policy', to: '/policies/privacy-policy' }, { label: 'Terms of service', to: '/policies/terms-of-service' }],
  // Payment badges shown in the footer. Only list methods the store actually
  // accepts — see README.md: these assume the Razorpay account is connected,
  // while 'COD' is always available.
  payments: ['COD', 'UPI', 'Cards'],
  features: [
    { icon: 'Truck', title: 'Free shipping', text: 'Free shipping on orders over ₹999' },
    { icon: 'Headset', title: 'Friendly support', text: 'We reply within one working day' },
    { icon: 'RefreshCcw', title: 'Easy returns', text: '30-day returns, no questions asked' },
    { icon: 'ShieldCheck', title: 'Pay on delivery', text: 'Cash on delivery across India' },
  ],
  stats: [['30', 'Day easy returns'], ['₹999', 'Free shipping over'], ['3–7', 'Working day delivery'], ['COD', 'Pay on delivery']],
  faq: [
    ['How long does delivery take?', 'Most orders arrive in 3–7 working days across India.'],
    ['Can I return or exchange an item?', 'Yes — unworn items can be returned or exchanged within 30 days.'],
    ['Which payment methods do you accept?', 'Cash on delivery across India, or pay securely online at checkout with UPI, cards, net banking or wallets.'],
  ],
}
