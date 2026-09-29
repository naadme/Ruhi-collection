// Lazy handle on the Deno globals that Supabase Edge Functions provide.
//
// Everything reads through this one file so the shared modules can also be
// imported by the Node test harness (which installs a tiny `Deno` shim), and
// so a missing global degrades into "not configured" instead of an import
// crash.

export type DenoLike = {
  env: { get(name: string): string | undefined }
  serve?: (handler: (req: Request) => Response | Promise<Response>) => unknown
}

export function deno(): DenoLike | undefined {
  return (globalThis as { Deno?: DenoLike }).Deno
}

/** Wire `handler` up as the function's HTTP entrypoint when running on Deno. */
export function serve(handler: (req: Request) => Response | Promise<Response>): void {
  deno()?.serve?.(handler)
}
