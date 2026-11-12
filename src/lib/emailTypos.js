// "Did you mean priya@gmail.com?" under the checkout's email field. A mistyped
// domain means the order confirmation never arrives, and nobody finds out.
//
// Only the big mail providers are checked, and only a one-letter slip (one
// letter wrong, missing, extra, or two letters swapped) is suggested, so a
// real company or college address is left alone. "priya@gmail" (no ".com")
// is completed too.

const PROVIDERS = [
  'gmail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com', 'rediffmail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'icloud.com',
]
// Real mail domains one letter away from a provider above: never "fixed".
const GENUINE = new Set(['mail.com', 'email.com', 'gmx.com', 'live.in', 'outlook.in', 'hotmail.co.uk', 'yahoo.co.uk'])

/** Edit distance where swapping two neighbouring letters counts as one edit. */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** The corrected address, or null when there is nothing to suggest. */
export function suggestEmail(value) {
  const email = String(value ?? '').trim()
  const at = email.lastIndexOf('@')
  if (at < 1 || at === email.length - 1) return null
  const local = email.slice(0, at)
  const domain = email.slice(at + 1).toLowerCase()
  if (PROVIDERS.includes(domain) || GENUINE.has(domain)) return null
  if (!domain.includes('.')) {
    const completed = PROVIDERS.find((p) => p === `${domain}.com`)
    return completed ? `${local}@${completed}` : null
  }
  const match = PROVIDERS.find((p) => distance(domain, p) === 1)
  return match ? `${local}@${match}` : null
}
