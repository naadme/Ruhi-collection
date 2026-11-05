// The shop's size charts, and which one each category uses.
//
// Two charts, both body measurements in inches as supplied by the owner
// (5 Nov 2026):
//   * tops — anything worn on the upper body (tops, T-shirts, shirts, kurtas,
//     dresses): bust, waist, hip, shoulder and armhole;
//   * bottoms — jeans, trousers, pants, cargos: waist.
// A set (co-ord set, nightsuit) has a top and a bottom, so it shows both.

export const SIZE_CHARTS = {
  tops: {
    key: 'tops',
    label: 'Top',
    columns: [
      { key: 'bust', label: 'Bust' },
      { key: 'waist', label: 'Waist' },
      { key: 'hip', label: 'Hip' },
      { key: 'shoulder', label: 'Shoulder' },
      { key: 'armhole', label: 'Armhole' },
    ],
    rows: [
      { size: 'XS', bust: 34, waist: 28, hip: 36, shoulder: 14, armhole: 16 },
      { size: 'S', bust: 36, waist: 30, hip: 38, shoulder: 15, armhole: 17 },
      { size: 'M', bust: 38, waist: 32, hip: 40, shoulder: 15, armhole: 18 },
      { size: 'L', bust: 40, waist: 34, hip: 42, shoulder: 15.5, armhole: 19 },
      { size: 'XL', bust: 42, waist: 36, hip: 44, shoulder: 16, armhole: 20 },
      { size: 'XXL', bust: 44, waist: 38, hip: 46, shoulder: 16, armhole: 21 },
      { size: 'XXXL', bust: 46, waist: 40, hip: 48, shoulder: 16.5, armhole: 22 },
      { size: 'XXXXL', bust: 48, waist: 42, hip: 50, shoulder: 17, armhole: 23 },
    ],
    howTo: [
      ['Bust', 'around the fullest part of your chest'],
      ['Waist', 'around your natural waistline'],
      ['Hip', 'around the fullest part of your hips'],
    ],
  },
  bottoms: {
    key: 'bottoms',
    label: 'Bottom',
    columns: [{ key: 'waist', label: 'Waist' }],
    rows: [
      { size: 'S', waist: 30 },
      { size: 'M', waist: 32 },
      { size: 'L', waist: 34 },
      { size: 'XL', waist: 36 },
      { size: 'XXL', waist: 38 },
    ],
    howTo: [['Waist', 'around where you wear your jeans or trousers']],
  },
}

// Category key (the product's `type`) → charts, in the order they are shown.
const BY_CATEGORY = {
  tops: ['tops'],
  dress: ['tops'],
  trousers: ['bottoms'],
  coord: ['tops', 'bottoms'],
  'winter-wear': ['tops', 'bottoms'],
}

/** The charts for a category. A category added later shows both, so a
 *  shopper always has a chart rather than none. */
export function chartsFor(type) {
  return (BY_CATEGORY[type] || ['tops', 'bottoms']).map((key) => SIZE_CHARTS[key])
}

const norm = (s) => String(s || '').trim().toUpperCase()

/**
 * The rows to show for a product: only its own sizes when the chart has a row
 * for every one of them (so "XS" is not shown for a design made in M–XL),
 * otherwise the whole chart — an unknown size label never hides the chart.
 */
export function rowsFor(chart, sizes = []) {
  const wanted = [...new Set(sizes.map(norm).filter(Boolean))]
  if (!wanted.length) return chart.rows
  const rows = chart.rows.filter((r) => wanted.includes(norm(r.size)))
  return rows.length === wanted.length ? rows : chart.rows
}

/** Inches → centimetres, to one decimal place where it matters. */
export function toCm(inches) {
  return Math.round(inches * 2.54 * 10) / 10
}
