// Edit-category bottom-sheet container: presentation only (ref, snap
// points, header, dismiss-on-success). The form and its lifecycle live in
// `category-form.tsx` (conventions forms.md §3); the edit mode prefills
// from the passed record and writes through `useUpdateCategory`.

import { BottomSheetView } from '@gorhom/bottom-sheet'
import type { Category } from '@trata/api'
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetHeader,
  BottomSheetRef,
} from '@/shared/ui/bottom-sheet'
import { CategoryForm } from './category-form'

export interface EditCategorySheetProps {
  ref: React.Ref<BottomSheetRef>
  /** The category being edited; the sheet is rendered only when it is set. */
  category: Category | undefined
}

export function EditCategorySheet({ ref, category }: EditCategorySheetProps) {
  if (!category) return null

  const handleSuccess = () => {
    // TODO(sheet-dismiss): see the matching TODO in
    // pages/accounts/ui/new-account-sheet.tsx - imperative dismiss after
    // a successful create needs investigation (Expo Go e2e).
    if (ref && typeof ref !== 'function') ref.current?.dismiss()
  }

  return (
    <BottomSheet ref={ref} testID="category-edit-sheet" snapPoints={['75%']} stackBehavior="push">
      <BottomSheetView testID="category-edit-sheet">
        <BottomSheetHeader title="Редактировать категорию" />
        <BottomSheetBody>
          <CategoryForm category={category} onSuccess={handleSuccess} />
        </BottomSheetBody>
      </BottomSheetView>
    </BottomSheet>
  )
}
