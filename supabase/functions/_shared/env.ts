import { deno } from './deno.ts'

/**
 * Read a server-side environment variable.
 *
 * These only ever exist inside the Edge Function runtime: nothing here is part
 * of the Vite bundle, so `RAZORPAY_KEY_SECRET` can never reach a browser.
 */
export function env(name: string): string | undefined {
  const value = deno()?.env.get(name)
  return value && value.length > 0 ? value : undefined
}

/**
 * Signals a misconfigured function. The message is a machine key that the
 * handler turns into a friendly sentence — it is never rendered raw, and it
 * never contains a secret.
 */
export class MissingConfigError extends Error {
  readonly missing: string[]

  constructor(missing: string[]) {
    super(`missing-config:${missing.join(',')}`)
    this.name = 'MissingConfigError'
    this.missing = missing
  }
}

/** Fetch a required variable or throw {@link MissingConfigError}. */
export function requireEnv(name: string): string {
  const value = env(name)
  if (value === undefined) throw new MissingConfigError([name])
  return value
}
