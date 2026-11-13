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
  // A/A check: both versions are the current product page (Product.jsx counts
  // a visitor when the product is on screen). Expect a 50/50 split of visitors
  // and no real difference between a and b. It proves the split, the counting
  // and the report before a real test runs.
  {
    id: 'aa_check',
    area: 'none',
    variants: ['a', 'b'],
    split: [50, 50],
    status: 'running',
    started: '2026-11-13',
    plan: { metric: 'add_to_cart', perVersion: 250, minDays: 7 },
  },
]

// Ids of tests that have ended, kept so that none is ever used again.
export const RETIRED = []
