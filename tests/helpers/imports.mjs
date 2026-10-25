// Does a source file use a name it never imported?
//
// This exists because of a bug that got all the way to a running browser:
// `Sections.jsx` called `heroFallbackSlides(...)` but had no import for it.
// `npm run build` succeeded — a bundler reads an unknown identifier as a
// global, not as an error — and the text-based tests passed too, because they
// only assert that the CALL is present. The homepage then failed at runtime
// behind its error boundary, with nothing to say so until it was opened.
//
// The rule checked here: if a name appears in the BODY of a file (outside its
// imports), that file must import it. Nothing in these files defines these
// names locally, so a use without an import can only ever be a mistake.
//
// Comments and string literals are stripped first. Without that, a comment
// that names the module it is talking about — "src/lib/bannerPosition.js" —
// reads as a use of `bannerPosition`, and an import path reads as a use of
// whatever the path is called. Neither is code.
//
// Import statements are removed as whole statements: a multi-line
// `import { a, b, c } from '...'` is one statement, and simply dropping lines
// that start with "import" would leave its continuation lines looking like
// uses.

/** `//` comments, but never the `//` of a `https://` address. */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

/** String literals, so a name inside one is not mistaken for code. */
const stripStrings = (src) =>
  src
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')

/** The file with its import statements removed, as whole statements. */
const stripImports = (src) =>
  src
    .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*['"];?\s*$/gm, '')
    .replace(/^\s*import\s+[^'"\n]*['"][^'"]*['"];?\s*$/gm, '')

/** The names a file imports, as a Set. */
export const importedNames = (source) => {
  const names = new Set()
  const src = stripComments(String(source))
  for (const m of src.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"][^'"]*['"]/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim()
      if (name) names.add(name)
    }
  }
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) names.add(m[1])
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|\s)/g)) names.add(m[1])
  return names
}

/**
 * Every name in `candidates` that the file USES must also be IMPORTED by it.
 *
 * Returns the offending names, so a test can assert an empty list and report
 * exactly what is missing.
 */
export const missingImports = (source, candidates) => {
  const clean = stripComments(String(source))
  const have = importedNames(clean)
  const body = stripStrings(stripImports(clean))
  return candidates.filter((name) =>
    new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`).test(body) && !have.has(name))
}
