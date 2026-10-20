// A stand-in for src/lib/supabase.js, so the admin panel's store calls can be
// tested without a browser, a network or a real Supabase.
//
// It records every call the code under test makes, and can be told to fail —
// which is how the "nothing was saved" path is proved.
export const calls = []
export const state = {
  failUpdate: false,
  failUpload: false,
  uploadUrl: 'https://example.supabase.co/storage/v1/object/public/product-images/category-1.jpg',
}

const record = (name, args) => {
  calls.push({ name, args })
  return calls[calls.length - 1]
}

export const reset = () => {
  calls.length = 0
  state.failUpdate = false
  state.failUpload = false
}

const chain = (name, args) => {
  record(name, args)
  const self = {
    select: (...a) => { record(`${name}.select`, a); return self },
    eq: (...a) => { record(`${name}.eq`, a); return self },
    single: async () => {
      if (state.failUpdate) return { data: null, error: { message: 'permission denied for table categories' } }
      return { data: { key: 'coord', label: 'Co-ord Sets', image: 'x' }, error: null }
    },
    update: (payload) => { record(`${name}.update`, payload); return self },
    upload: async (path, file, opts) => {
      record(`${name}.upload`, [path, file?.name, opts])
      if (state.failUpload) return { error: { message: 'the file could not be stored' } }
      return { error: null }
    },
    getPublicUrl: (path) => {
      record(`${name}.getPublicUrl`, path)
      return { data: { publicUrl: state.uploadUrl } }
    },
  }
  return self
}

export const supabase = {
  from: (table) => chain(`from(${table})`),
  storage: {
    from: (bucket) => chain(`storage(${bucket})`),
  },
}
