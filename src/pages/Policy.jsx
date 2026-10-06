import usePageTitle from '../hooks/usePageTitle'
import { useParams, Link } from 'react-router-dom'
import { site } from '../data/site'

// A legal page must not claim it was updated "today" every day it is read, so
// this is a fixed value rather than `new Date()`. Bump it whenever the policy
// text below is edited.
const LAST_UPDATED = '28 September 2026'

// Written against the promises already published on this site (announcement
// bar, features and FAQ): free shipping over ₹999 and delivery in 7-10
// working days. Nothing here invents a guarantee the store has not
// already made. Keep this in sync with src/data/site.js.
const POLICIES = {
  'shipping-policy': {
    title: 'Shipping policy',
    intro: 'Where we deliver, what it costs and when to expect your order.',
    sections: [
      ['Where we deliver', [
        'We deliver across India, including metros and most smaller towns and cities served by our courier partners.',
        'At the moment we do not ship outside India.'],
      ],
      ['How much shipping costs', [
        'Shipping is free on every order of ₹999 and above.',
        'Orders below ₹999 carry a flat ₹79 shipping charge. The amount is shown in your cart and again on the checkout page before you place the order.'],
      ],
      ['When your order arrives', [
        'We usually pack and dispatch an order within 2–3 working days of it being placed.',
        'Most orders arrive within 7-10 working days from dispatch. Remote PIN codes can take a little longer.',
        'Working days are Monday to Saturday, excluding public holidays.'],
      ],
      ['Tracking your order', [
        'As soon as your order is placed you get an order reference such as RCH-A1B2C3D4, and the same reference appears on your order confirmation page and in your account.',
        'Our delivery partner calls the phone number on your order before arriving, so please keep that number reachable.'],
      ],
      ['Delayed or missing orders', [
        `If your order has not arrived within the expected window, email us at ${site.email} with your order reference and we will follow it up with the courier for you.`],
      ],
    ],
  },
  'refund-policy': {
    title: 'Refund policy',
    intro: 'Returns, exchanges and how money comes back to you.',
    sections: [
      ['Returns', [
        'Items must be in their original condition with tags attached and no signs of washing, wear, stains or perfume.'],
      ],
      ['How to start a return', [
        `Email ${site.email} with your order reference, the item you want to return and the reason.`,
        'We will reply with the return address and, where available, a pickup slot for your PIN code.',
        'Please do not send anything back before we confirm — parcels sent to the wrong address can get lost.'],
      ],
      ['Exchanges', [
        'If you would rather swap for a different size or colour, tell us in the same email and we will reserve the replacement for you, subject to stock.'],
      ],
      ['How refunds are paid', [
        'Once we receive and inspect the returned item, we refund the item price to the original payment method.',
        'Shipping charges are refunded only when the whole order is returned or when we sent the wrong item.'],
      ],
      ['Items we cannot take back', [
        'For hygiene reasons, innerwear and anything worn against the skin cannot be returned once the tag is removed.',
        'Items that are damaged after delivery, or returned without their tags, cannot be refunded.'],
      ],
      ['Cancellations', [
        'You can cancel an order before it is dispatched by contacting us with your order reference.',
        'Once an order has shipped, it needs to go through the normal return process.'],
      ],
    ],
  },
  'privacy-policy': {
    title: 'Privacy policy',
    intro: 'What we collect on this site, why we collect it and what we do with it.',
    sections: [
      ['What we collect', [
        'When you place an order: your name, email address, phone number, delivery address and the items you bought.',
        'When you contact us through the contact form: your name, email address, phone number and message.',
        'When you subscribe to the newsletter: your email address only.',
        'Automatically: your browser stores your cart, wishlist and any sign-in session in your own device’s local storage.'],
      ],
      ['How we use it', [
        'To pack and deliver what you ordered, to answer your questions, and to send you the newsletter you asked for.',
        'We do not sell, rent or trade your personal information to anyone.'],
      ],
      ['Payment details', [
        'This site does not collect or store card, UPI or net-banking credentials. Payment is made at checkout through Razorpay — a certified payment provider that handles the card and bank details entirely on its own systems and never shares them with us.'],
      ],
      ['Who holds it', [
        'Your account, orders and messages are stored securely in our Supabase database, and product photography is served by our image host.',
        'Delivery partners receive only the address and phone number needed to deliver your parcel.'],
      ],
      ['How long we keep it', [
        'Order records are kept so we can handle returns, exchanges and warranty questions. Newsletter subscriptions are kept until you unsubscribe.'],
      ],
      ['Your choices', [
        `You can ask for a copy of the information we hold about you, or ask us to delete it, by emailing ${site.email}.`,
        `To stop newsletter emails, use the unsubscribe link in any newsletter or email us and we will remove you.`],
      ],
      ['Cookies', [
        'We do not use advertising cookies. The only things stored on your device are your cart, your wishlist and your sign-in session.'],
      ],
    ],
  },
  'terms-of-service': {
    title: 'Terms of service',
    intro: 'The ground rules for using this website and buying from us.',
    sections: [
      ['Using this site', [
        'By browsing or buying on this site you agree to these terms. If you do not agree, please do not use the site.',
        'You may not use the site for anything unlawful or in a way that interferes with other customers’ access to it.'],
      ],
      ['Products and pricing', [
        'All prices are shown in Indian Rupees and include applicable taxes.',
        'We try to keep stock levels and prices accurate. If an item turns out to be unavailable after you order, we will tell you and either offer an alternative or refund you in full.'],
      ],
      ['Placing an order', [
        'An order is accepted when you receive an order reference and we confirm it. Until then, an item in your cart is not reserved.',
        'You are responsible for giving us an accurate delivery address and phone number — parcels returned because of an incorrect address may incur re-shipping charges.'],
      ],
      ['Delivery', [
        'Delivery estimates are guides, not guarantees. Public holidays, weather and courier disruptions can extend them.'],
      ],
      ['Returns', [
        'Our returns and refunds are handled under the refund policy, which forms part of these terms.'],
      ],
      ['Content and images', [
        'The photographs, text and branding on this site belong to Ruhi Womens Clothing or its licensors and may not be reproduced without permission.'],
      ],
      ['Liability', [
        'Nothing in these terms limits rights you have under Indian consumer law, which cannot be excluded.',
        'To the extent the law allows, our liability for a claim relating to an order is limited to the value of that order.'],
      ],
      ['Governing law and contact', [
        'These terms are governed by the laws of India.',
        `Questions about them can be sent to ${site.email}.`],
      ],
    ],
  },
}

export default function Policy() {
  const { slug } = useParams()
  const policy = POLICIES[slug]
  usePageTitle(policy ? policy.title : 'Policy')

  if (!policy) {
    return (
      <section className="max-w-[860px] mx-auto px-4 py-16 text-center">
        <h1 className="text-[40px]">Page not found</h1>
        <p className="text-black/65 mt-3">That policy doesn't exist. Try one of the links below.</p>
        <div className="flex flex-wrap gap-3 justify-center mt-8">
          {Object.entries(POLICIES).map(([key, value]) => (
            <Link key={key} to={`/policies/${key}`} className="btn-outline">{value.title}</Link>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className="max-w-[860px] mx-auto px-4 py-16">
      <p className="text-[14px] text-black/50 uppercase tracking-[.18em] font-ui">Legal</p>
      <h1 className="text-[40px] mt-3">{policy.title}</h1>
      <p className="text-[19px] text-black/70 mt-3">{policy.intro}</p>
      <p className="text-[14px] text-black/45 mt-2">Last updated {LAST_UPDATED}</p>

      <div className="mt-10 space-y-9">
        {policy.sections.map(([heading, paragraphs]) => (
          <section key={heading}>
            <h2 className="text-[24px] font-medium font-ui">{heading}</h2>
            <div className="mt-3 space-y-3">
              {paragraphs.map((p, i) => (
                <p key={i} className="text-[18px] leading-8 text-black/70">{p}</p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-12 border-t border-black/10 pt-6 text-[17px] text-black/70">
        Questions? <Link to="/contact" className="underline underline-offset-2">Contact us</Link> or email{' '}
        <a href={`mailto:${site.email}`} className="underline underline-offset-2">{site.email}</a>.
      </div>
    </section>
  )
}
