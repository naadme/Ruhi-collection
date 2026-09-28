// Where a just-placed order lives so the confirmation page survives a refresh.
//
// Only the shopper's own browser ever has it: the order is written to
// sessionStorage and dropped as soon as the next one is placed. Signed-in
// customers additionally keep a permanent copy in `public.orders`, which they
// can read from their account page.
const PREFIX = 'rohi:order:'

export function saveOrder(order) {
  if (!order?.reference) return
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i)
      if (key && key.startsWith(PREFIX) && key !== PREFIX + order.reference) {
        sessionStorage.removeItem(key)
      }
    }
    sessionStorage.setItem(PREFIX + order.reference, JSON.stringify(order))
  } catch {
    /* private browsing or a full quota — the confirmation just won't survive a reload */
  }
}

export function loadOrder(reference) {
  if (!reference) return null
  try {
    const raw = sessionStorage.getItem(PREFIX + reference)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
