// The dashboard's ONE "Categories" section — the categories the whole
// storefront lists, and the photograph each one shows, side by side.
//
// It used to be two neighbouring tabs ("Categories" and "Category images"),
// which meant every category change had to be made twice over in two places:
// rename here, then hunt for the same row in the other tab to change its
// picture. Both halves are the SAME rows of the same `categories` table, so
// they now stand in one place: the manager (create, rename, delete) first,
// and under it the photographs — upload, choose, switch on or off, save.
//
// The two halves remain the very same components the product editor and the
// dashboard used before: `CategoryManagerPanel` is the manager the product
// editor opens as a modal, and `CategoryImagesPanel` is the photo list, driven
// by the same rules — so a category behaves the same however it is reached.
// Only an owner sees this section: the database's own row-level security
// allows nothing but an admin to write a category.
//
// NOTE: nothing here deletes a product or an image. Removing a category is
// refused while any product uses it, and choosing a different photograph
// never removes the file it replaces.

import { useCallback, useState } from 'react'
import { useCategories } from '../context/CategoriesContext'
import { CategoryManagerPanel } from './CategoryManager.jsx'
import CategoryImagesPanel from './CategoryImagesPanel.jsx'

export default function CategoriesPanel({ notify }) {
  const { categories, reload } = useCategories()
  // Bumped after every change the manager makes, so the photograph list
  // beside it re-reads the same rows. A category added or renamed in THIS
  // section must appear there without the owner refreshing the page.
  const [revision, setRevision] = useState(0)

  const onSaved = useCallback(async () => {
    // The storefront reads the categories from the database, so a reload here
    // puts the new category in front of the very next visitor.
    await reload()
    setRevision((n) => n + 1)
  }, [reload])

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] md:text-[40px] font-bold tracking-tight leading-none">Categories</h1>
          <p className="text-black/55 mt-2 text-[15px]">
            The categories shoppers filter and search by, and the photograph each one shows in the
            “Shop by Category” row. A new category is on the site straight away — it needs no code change and no
            redeployment — and it is given its own two-digit number so the Product IDs of the products in it are
            numbered properly.
          </p>
        </div>
      </div>

      <div className="mt-8 max-w-[760px]">
        {/* The manager says what happened in its own words, under the form —
            so the message is read where the owner is looking. */}
        <CategoryManagerPanel categories={categories} onSaved={onSaved} />
      </div>

      {/* The photographs are the same rows the manager just edited, so they
          sit directly under it: the name and the picture of a category are
          managed in one place, in one pass. */}
      <div className="mt-10 border-t border-black/10 pt-8">
        <CategoryImagesPanel notify={notify} revision={revision} />
      </div>
    </div>
  )
}
