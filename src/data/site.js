// Business details — edit these constants; they feed the footer, contact page and announcement bar.
export const site = {
  name: 'Rohi Collection',
  short: 'ROHI',
  tagline: 'Everyday fashion for men and women — thoughtfully made, honestly priced.',
  address: 'Rohi Collection Studio, Mumbai, Maharashtra, India',
  phone: '+91 98765 43210',
  email: 'care@rohicollection.in',
  hours: 'Mon – Sat, 10:00 – 19:00 IST',
  social: [{ label: 'Instagram', href: 'https://instagram.com' }, { label: 'Facebook', href: 'https://facebook.com' }, { label: 'WhatsApp', href: 'https://wa.me/919876543210' }, { label: 'YouTube', href: 'https://youtube.com' }],
  announcements: ['Fast delivery across India', 'Free shipping on orders over ₹999', '30-day easy returns', 'Customer support 10am – 7pm', 'Secure checkout'],
  nav: [{ label: 'Home', to: '/' }, { label: 'Shop', to: '/shop' }, { label: 'Collections', to: '/collections' }, { label: 'About', to: '/about' }, { label: 'Contact', to: '/contact' }],
  shopLinks: [{ label: 'All products', to: '/shop' }, { label: "Men's shirts", to: '/shop?gender=men&type=shirt' }, { label: "Men's pants", to: '/shop?gender=men&type=pant' }, { label: "Women's tops", to: '/shop?gender=women&type=tshirt' }, { label: "Women's pants", to: '/shop?gender=women&type=pant' }],
  service: [{ label: 'Contact us', to: '/contact' }, { label: 'Shipping policy', to: '/policies/shipping-policy' }, { label: 'Refund policy', to: '/policies/refund-policy' }, { label: 'Your cart', to: '/cart' }],
  legal: [{ label: 'Privacy policy', to: '/policies/privacy-policy' }, { label: 'Terms of service', to: '/policies/terms-of-service' }],
  features: [
    { icon: 'Truck', title: 'Free shipping', text: 'Free shipping on orders over ₹999' },
    { icon: 'Headset', title: 'Friendly support', text: 'We reply within one working day' },
    { icon: 'RefreshCcw', title: 'Easy returns', text: '30-day returns, no questions asked' },
    { icon: 'ShieldCheck', title: 'Secure payment', text: 'Your payment information is safe' },
  ],
  stats: [['10K+', 'Happy customers'], ['500+', 'Styles'], ['5+', 'Years in fashion'], ['1000+', 'Orders shipped weekly']],
  faq: [
    ['How long does delivery take?', 'Most orders arrive in 3–7 working days across India.'],
    ['Can I return or exchange an item?', 'Yes — unworn items can be returned or exchanged within 30 days.'],
    ['Which payment methods do you accept?', 'UPI, cards, net banking and cash on delivery on eligible pincodes.'],
  ],
}
