import { useEffect } from 'react'
import { expose, variantOf } from '../lib/experiments'

/**
 * The version of A/B test `id` this visitor sees: 'a' is the current site,
 * 'b' (or 'c') the new version (src/lib/experimentList.js).
 *
 * The visitor is counted in the test once `active` is true. Pass the moment
 * they reach the part of the site the test changes, and make it the SAME
 * moment for every version (the product has loaded, say), never "the new
 * block is on screen": a version that shows its block later would count fewer
 * visitors and skew the result.
 *
 *   const fit = useExperiment('pdp_fit', { active: Boolean(product) })
 *   {fit === 'b' ? <FitBlock /> : null}
 *
 * Costs nothing to load: the version is worked out in the browser, at once.
 * Keep a new version's code small and in the main file. A version loaded on
 * demand would make its visitors wait, and the test would measure the wait.
 */
export default function useExperiment(id, { active = true } = {}) {
  const variant = variantOf(id)
  useEffect(() => {
    if (active) expose(id)
  }, [id, active])
  return variant
}
