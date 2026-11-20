// The sold-out parts of the shop (20 Nov 2026) that most visitors never meet,
// each its own file fetched on demand (Ruhi_Speed_Framework.md, rule 4):
//
//   * the block a sold-out page shows instead of its buy buttons
//     (src/components/SoldOutBlock.jsx), fetched as soon as the product on
//     screen has any sold-out size (src/pages/Product.jsx);
//   * basket lines that sold out after they were added
//     (src/components/SoldOutCartLines.jsx);
//   * the page for a style we stopped selling (src/components/NoLongerAvailable.jsx).
import { pageChunk } from './pageChunk'

export const soldOutBlock = pageChunk(() => import('../components/SoldOutBlock'))
export const soldOutCartLines = pageChunk(() => import('../components/SoldOutCartLines'))
export const noLongerAvailable = pageChunk(() => import('../components/NoLongerAvailable'))
