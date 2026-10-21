// The dashboard's "Categories" section — the categories the whole storefront
// lists, added, renamed and removed from one place.
//
// It is the same manager the product editor opens as a modal, standing on its
// own: the list, the create form, the messages and the rules are one set of
// code, so a category behaves the same however it is reached.
//
// Only an owner sees this section — the database's own row-level security
// allows nothing but an admin to write a category, so a product manager would
// only ever see buttons that fail.

import { useCategories } from '../context/CategoriesContext'
import { CategoryManagerPanel } from './CategoryManager.jsx'

export default function CategoriesPanel({ notify }) {
  const { categories, reload } = useCategories()

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] md:text-[40px] font-bold tracking-tight leading-none">Categories</h1>
          <p className="text-black/55 mt-2 text-[15px]">
            The categories shoppers filter and search by. A new category is on the site straight away — it needs no
            code change and no redeployment — and it is given its own Product ID code so the products in it are
            numbered properly.
          </p>
        </div>
      </div>

      <div className="mt-8 max-w-[760px]">
        <CategoryManagerPanel
          categories={categories}
          onSaved={async (row) => {
            // The storefront reads the categories from the database, so a
            // reload here puts the new category in front of the very next
            // visitor.
            await reload()
            if (row?.label) notify('success', `“${row.label}” is on the site now.`)
          }}
        />
      </div>
    </div>
  )
}
