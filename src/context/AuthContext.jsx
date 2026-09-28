import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

// Session + authorisation for the /admin dashboard.
// Signing in is *not* enough to be an admin: `public.admins` is an allowlist
// row, so a customer who registers through Supabase Auth gains nothing.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  // Re-check the allowlist whenever the signed-in identity changes.
  useEffect(() => {
    if (!user) { setIsAdmin(false); return }
    let alive = true
    supabase.from('admins').select('user_id').eq('user_id', user.id).maybeSingle()
      .then(({ data, error }) => { if (alive) setIsAdmin(!error && !!data) })
    return () => { alive = false }
  }, [user])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session ?? null)
      setUser(data.session?.user ?? null)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null)
      setUser(s?.user ?? null)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  const signIn = useCallback(async (email, password) => {
    setBusy(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) return { error: error.message }
      setSession(data.session); setUser(data.session?.user ?? null)
      return { ok: true }
    } catch (e) {
      return { error: e?.message || 'Unable to sign in right now.' }
    } finally { setBusy(false) }
  }, [])

  // Customer self-registration. This grants nothing but a session: admin rights
  // still require an `admins` allowlist row, which is provisioned by the owner.
  const signUp = useCallback(async (email, password) => {
    setBusy(true)
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
      if (error) return { error: error.message }
      // GoTrue answers with a user that has no identities when the address is
      // already registered but unconfirmed — surface that instead of a fake success.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return { error: 'An account already exists for this email. Try signing in instead.' }
      }
      if (!data.session) return { ok: true, needsConfirmation: true }
      setSession(data.session); setUser(data.session?.user ?? null)
      return { ok: true }
    } catch (e) {
      return { error: e?.message || 'Unable to create the account right now.' }
    } finally { setBusy(false) }
  }, [])

  const signOut = useCallback(async () => {
    setBusy(true)
    try { await supabase.auth.signOut() } finally { setBusy(false) }
  }, [])

  return (
    <Ctx.Provider value={{ ready, session, user, isAdmin, busy, signIn, signUp, signOut }}>
      {children}
    </Ctx.Provider>
  )
}
