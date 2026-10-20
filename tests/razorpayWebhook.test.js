// The Razorpay webhook's own test harness, run as part of the suite.
//
// scripts/test-razorpay-webhook.mjs drives the Edge Function with a stubbed
// `fetch`, so it never touches Razorpay, Supabase or the network. It prints
// its own PASS/FAIL lines rather than using node:test, so it is wrapped here:
// a non-zero exit means at least one of those checks failed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

test('the Razorpay webhook passes its own checks', () => {
  const script = path.join(process.cwd(), 'scripts/test-razorpay-webhook.mjs')
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 120000 })
  const out = `${run.stdout || ''}${run.stderr || ''}`
  assert.equal(run.status, 0, `the webhook harness reported a failure:\n${out.slice(-2000)}`)
  const summary = out.match(/(\d+) passed, (\d+) failed/)
  assert.ok(summary, `the harness did not print a summary:\n${out.slice(-1000)}`)
  const [, passed, failed] = summary
  assert.ok(Number(passed) >= 30, `expected the whole harness to run, saw ${passed} checks`)
  assert.equal(Number(failed), 0)
})
