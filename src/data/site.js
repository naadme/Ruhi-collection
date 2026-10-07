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
  email: 'ruhicollections2026@gmail.com',
  hours: 'Mon – Sat, 10:00 – 19:00 IST',
  // The single source for every WhatsApp link on the site: the footer, the
  // contact page and the homepage contact strip all render this `href`.
  // +91 90466 51272 → 919046651272 (country code, no spaces or '+').
  social: [{ label: 'Instagram', href: 'https://www.instagram.com/ruhi_fashions_/' }, { label: 'WhatsApp', href: 'https://wa.me/919046651272' }],
  announcements: ['Fast delivery across India', 'Free shipping for all products', 'Customer support 10am – 7pm', 'Secure checkout'],
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
  // Three benefits only, so the strip renders as one even row. Every order is
  // paid online at checkout, so there is no delivery-time payment card.
  features: [
    { icon: 'Truck', title: 'Free shipping', text: 'Free shipping for all products' },
    { icon: 'Headset', title: 'Friendly customer support', text: 'Friendly, helpful support — we reply within one working day' },
    { icon: 'Zap', title: 'Fast delivery', text: 'Fast delivery across India' },
  ],
  faq: [
    ['How long does delivery take?', 'Most orders arrive in 7-10 working days across India.'],
    ['Which payment methods do you accept?', 'Pay securely online at checkout with UPI, cards, net banking or wallets.'],
  ],
}
