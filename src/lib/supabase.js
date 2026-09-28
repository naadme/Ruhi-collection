import { createClient } from '@supabase/supabase-js'

// Every credential comes from .env — never hardcode them here.
// Vite only exposes variables prefixed with VITE_ to the client bundle.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Fail loudly instead of letting createClient() throw a cryptic error at import
// time (which would blank the app on boot).
if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Supabase is not configured: add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to your .env file.'
  )
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey)
