// The shop's A/B tests. How they work, and the rules for adding one, are in
// src/lib/experiments.js; the plan and the playbook are in
// AB_Testing_Plan_2026-11-13.html in the Ruhi Collections folder.
//
// One entry per test:
//
//   id        lower case letters, digits and _, at most 20 characters. Never
//             reused (see RETIRED): returning visitors and GA4 still hold the
//             old test's versions under that name.
//   area      the part of the site it changes. Only one running test per area,
//             so two tests never change the same thing at once.
//   variants  'a' is always the current site; 'b' (and 'c') the new versions.
//   split     the share of visitors per version, in %, adding up to 100.
//             Fixed for the whole test: changing it mid-test skews the result.
//   status    'draft'    only browsers that ask with ?ab=<id>:<version> see it
//             'running'  visitors are split and counted
//             'stopped'  everyone sees 'a' again; nothing is counted
//             'shipped'  everyone sees `winner` until its code is cleaned up
//   started   the day it went live (YYYY-MM-DD, India time), for the report.
//   plan      written BEFORE the test starts and not changed after: the one
//             GA4 event that decides it (or 'paid_order'), how many visitors
//             each version needs (from the plan's calculator) and the fewest
//             days it runs (whole weeks). The report reads it.
//
// Say what a test changes, and why, in a comment above it: this file ships to
// every visitor, so words here cost download time.
//
// To change a running test, stop it and start a new one with a new id.

export const EXPERIMENTS = [
  // Express delivery by air (live 19 Nov 2026) against the shop before it,
  // for the 20–24 Nov drop: does offering Express cost paid orders?
  // a: the shop as it is, offering Express while the dashboard switch is on.
  // b: the shop before Express: no Express line on the product and cart pages,
  //    one free-delivery line at checkout.
  // A visitor counts once a product, the cart page or checkout is on screen,
  // also while Express is paused; the report splits the on and paused hours
  // (src/hooks/useExpressOffer.js).
  {
    id: 'express_offer',
    area: 'delivery',
    variants: ['a', 'b'],
    split: [50, 50],
    status: 'running',
    started: '2026-11-25',
    plan: { metric: 'paid_order', perVersion: 2600, minDays: 56 },
  },
]

// Ids of tests that have ended, kept so that none is ever used again.
// aa_check: the A/A check, 13–25 Nov 2026; it passed (insights log 24, 25).
export const RETIRED = ['aa_check']
