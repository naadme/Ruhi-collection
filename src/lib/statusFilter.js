// The All / Active / Inactive filter that the three admin panels which switch
// things on and off share.
//
// The rules live here, apart from the panels, so they can be tested without a
// browser: what counts as "active", what each filter shows, and how many of
// each there are.
//
// One rule for every panel:
//
//   * an item is ACTIVE unless it says otherwise — `is_active` is `false` for
//     switched off, and absent (or true) for switched on. A row that predates
//     the switch is therefore active, which is how it behaved before;
//   * "Active" shows the switched-on items, "Inactive" the switched-off ones,
//     and "All" shows both — in the order they were given, because filtering
//     never reorders anything.

/** The three filters, in the order they are shown. */
export const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

/** The filter a panel starts on. */
export const DEFAULT_STATUS = 'all'

/** Is this item switched on? Anything that is not explicitly off is on. */
export const isActiveItem = (item) => item?.is_active !== false

/** Is this item switched off? */
export const isInactiveItem = (item) => !isActiveItem(item)

/**
 * The items a filter shows.
 *
 * An unknown filter is treated as "All" rather than as "nothing" — a stale
 * value in the URL must never leave a panel looking empty.
 */
export const filterByStatus = (items, status = DEFAULT_STATUS) => {
  const list = Array.isArray(items) ? items : []
  if (status === 'active') return list.filter(isActiveItem)
  if (status === 'inactive') return list.filter(isInactiveItem)
  return list
}

/** How many items each filter would show. */
export const countByStatus = (items) => {
  const list = Array.isArray(items) ? items : []
  return {
    all: list.length,
    active: list.filter(isActiveItem).length,
    inactive: list.filter(isInactiveItem).length,
  }
}

/** Is this one of the three filters? */
export const isStatusValue = (value) => STATUS_FILTERS.some((f) => f.value === value)
