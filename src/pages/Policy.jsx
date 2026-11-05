import usePageTitle from '../hooks/usePageTitle'
import { useParams, Link } from 'react-router-dom'
import { site } from '../data/site'

// A legal page must not claim it was updated "today" every day it is read, so
// this is a fixed value rather than `new Date()`. Bump it whenever the policy
// text below is edited.
const LAST_UPDATED = '28 September 2026'

// Written against the promises already published on this site (announcement
// bar, features and FAQ): free shipping for all products and delivery in 7-10
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
        'Shipping is free on every order, whatever the order value — there is no minimum spend and nothing extra to pay for delivery.',
        'The cart and the checkout page both show what you will pay before you place the order, so there are no surprises at payment.'],
      ],
      ['When your order arrives', [
        'We usually pack and dispatch an order within 2–3 working days of it being placed.',
        'Most orders arrive within 7-10 working days from dispatch. Remote PIN codes can take a little longer.',
        'Working days are Monday to Saturday, excluding public holidays.'],
      ],
      ['Tracking your order', [
        'As soon as your order is placed you get an order ID such as 01102601, and the same ID appears on your order confirmation page and in your account.',
        'Our delivery partner calls the phone number on your order before arriving, so please keep that number reachable.'],
      ],
      ['Delayed or missing orders', [
        `If your order has not arrived within the expected window, email us at ${site.email} with your order reference and we will follow it up with the courier for you.`],
      ],
    ],
  },
  'refund-policy': {
    title: 'Return & refund policy',
    intro: 'Received something damaged, faulty or not what you ordered? Tell us within 5 days of delivery and we will put it right.',
    // The owner's rules (5 Nov 2026): returns within 5 days of delivery, for a
    // damaged or wrong item only, with an unboxing video. "Not as shown" is
    // included because India's Consumer Protection (E-Commerce) Rules 2020 do
    // not let a seller refuse goods that are not as advertised.
    updated: '5 November 2026',
    sections: [
      ['When you can return an item', [
        'You can ask for a return within 5 days of delivery if the item:',
        '• arrived damaged or faulty — for example torn, stained, or with broken stitching or a broken zip;',
        '• is not what you ordered — a different product, colour or size; or',
        '• is clearly different from how it is shown and described on our website.'],
      ],
      ['Unboxing video — required', [
        'To accept a return we need a video of you opening the parcel. Please record one for every order: it only takes a minute.',
        'The video should show the sealed parcel with its shipping label, the parcel being opened in one continuous recording without cuts, and the item and the problem clearly.',
        'Return requests without an unboxing video cannot be accepted.'],
      ],
      ['How to ask for a return', [
        `Within 5 days of delivery, WhatsApp us on +91 ${site.phone} or email ${site.email} with your order ID (for example 01102601), a short note on what is wrong, photos of the item and your unboxing video.`,
        'We reply within one working day.',
        'Please do not send anything back before we confirm — we will arrange a pickup where our courier serves your PIN code, or share the return address with you.'],
      ],
      ['Replacement or refund', [
        'Once your return is approved, you choose: a replacement of the same item (if it is in stock), or a full refund.',
        'The item should come back unused and unwashed, with its tags and original packaging.'],
      ],
      ['How refunds are paid', [
        'Refunds go back to the original payment method — the same UPI app, card, bank account or wallet you paid with — once the returned item reaches us and is checked.',
        'Banks and UPI apps usually take 5–7 working days to show the refund in your account.'],
      ],
      ['What we cannot take back', [
        'Returns for a change of mind, or because the size or fit is not right — please check the Size chart on each product page before ordering.',
        'Items that have been worn, washed or altered, or returned without their tags.',
        'Requests made more than 5 days after delivery, or without an unboxing video.'],
      ],
      ['Cancellations', [
        'You can cancel an order before it is dispatched by contacting us with your order ID, and you get a full refund.',
        'Once an order has shipped, it can only be returned under this policy.'],
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
        'Our returns and refunds are handled under the return & refund policy, which forms part of these terms.'],
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
      <p className="text-[14px] text-black/45 mt-2">Last updated {policy.updated || LAST_UPDATED}</p>

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
