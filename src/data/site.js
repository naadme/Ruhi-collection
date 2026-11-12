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
  // The same number for tapping: `tel:` needs the country code to dial
  // correctly from anywhere, and wa.me wants it without the '+'.
  phoneHref: 'tel:+919046651272',
  whatsappNumber: '919046651272',
  email: 'ruhicollections2026@gmail.com',
  // When someone answers WhatsApp and the phone (the owner, 12 Nov 2026).
  // `supportHours` is the short form on checkout's "Chat with us" button.
  supportHours: '9 AM – 9 PM',
  hours: '9 AM – 9 PM IST',
  // Who sells: the trade name on the GST registration, shown under Pay at
  // checkout and in the footer (the owner's choice, 12 Nov 2026).
  seller: { name: 'Ruhi Collections', city: 'Bengaluru', gstin: '29CMOPN3041A1Z6' },
  // The single source for every WhatsApp link on the site: the footer, the
  // contact page and the homepage contact strip all render this `href`.
  // +91 90466 51272 → 919046651272 (country code, no spaces or '+').
  social: [{ label: 'Instagram', href: 'https://www.instagram.com/ruhi_fashions_/' }, { label: 'WhatsApp', href: 'https://wa.me/919046651272' }],
  // Top USP strip — the three client-approved messages, shown exactly as
  // written (the marquee repeats them for a seamless loop).
  // Support hours changed to 9am - 9pm on 12 Nov 2026 (the owner).
  announcements: ['Secure Customer Support (9am - 9pm)', 'Fast & Free delivery across India', 'Everything under ₹1000'],
  nav: [
    { label: 'Home', to: '/' },
    // The catalogue branch renders as a dropdown in the header (and as a nested
    // list in the mobile drawer). Each child deep-links into the shop's own
    // filters, so no extra routes or pages are needed.
    {
      label: 'Catalogue', to: '/collections',
      // "All Products" leads the list (same destination as the shop page),
      // followed by one deep link per category.
      children: [{ label: 'All Products', to: '/shop' }, ...TYPES.map(typeLink)],
    },
    { label: 'About', to: '/about' },
    { label: 'Contact', to: '/contact' },
  ],
  shopLinks: [{ label: 'All products', to: '/shop' }, ...TYPES.map(typeLink)],
  service: [
    { label: 'Contact us', to: '/contact' },
    { label: 'Shipping policy', to: '/policies/shipping-policy' },
    { label: 'Returns & refunds', to: '/policies/refund-policy' },
    { label: 'Size guide', to: '/size-guide' },
    { label: 'Your cart', to: '/cart' },
    { label: 'Wishlist', to: '/wishlist' },
    { label: 'Your account', to: '/account' },
  ],
  legal: [{ label: 'Privacy policy', to: '/policies/privacy-policy' }, { label: 'Terms of service', to: '/policies/terms-of-service' }],
  // Three benefits only, so the strip renders as one even row. Every order is
  // paid online at checkout, so there is no delivery-time payment card.
  // All three now carry a short description line under the heading.
  features: [
    { icon: 'Headset', title: 'Secure Customer Support', text: '9am - 9pm' },
    { icon: 'Truck', title: 'Fast & Free Delivery', text: 'Across India' },
    { icon: 'IndianRupee', title: 'All Products', text: 'under ₹1000' },
  ],
  faq: [
    ['How long does delivery take?', 'Most orders arrive in 7-10 working days across India.'],
    ['Which payment methods do you accept?', 'Pay securely online at checkout with UPI, cards, net banking or wallets.'],
    ['Can I return an item?', 'Yes, within 5 days of delivery if it arrives damaged or faulty, is not what you ordered, or is not as shown on our website. An unboxing video is required, so please record one when you open your parcel. See our return & refund policy for details.'],
  ],
}
