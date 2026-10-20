// The sheet sync, shared by the payment functions.
//
// When a payment is verified the order is real, and the client's spreadsheet
// should hold it within seconds rather than whenever someone next remembers
// to press "Export". This is called straight after the payment is on file.
//
// It is best-effort BY DESIGN: a spreadsheet that cannot be reached must never
// turn a verified payment into an error the shopper sees, and it must never
// touch the order itself. The daily scheduled job is the safety net for
// anything this path could not deliver.

import { runSync } from './sheetSyncRun.ts'

/**
 * Send the new orders to the owner's spreadsheet.
 *
 * Returns the sync's own description when it worked, and '' when it did not —
 * the caller logs the failure and carries on.
 */
export async function syncSheetQuietly(): Promise<string> {
  try {
    const result = await runSync()
    if (result?.ok) return String(result.message || 'The sheet is up to date.')
    return String(result?.message || 'The sheet could not be updated.')
  } catch (error) {
    console.warn('[sheet-sync] the automatic sync did not finish:', String(error))
    return ''
  }
}
