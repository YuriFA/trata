// Create-category bottom-sheet container: presentation only (ref, snap
// points, header). The form and its lifecycle live in `category-form.tsx`
// (conventions forms.md §3). Unlike the account and transaction sheets, this
// one intentionally stays open after a successful create - the overview
// flow continues right in the sheet.

import { BottomSheetView } from '@gorhom/bottom-sheet'
import type { CategoryType } from '@trata/api'
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetHeader,
  BottomSheetRef,
} from '@/shared/ui/bottom-sheet'
import { CategoryForm } from './category-form'

export interface NewCategorySheetProps {
  ref: React.Ref<BottomSheetRef>
  /** Initial type for the create flow (the toggle stays user-editable). */
  defaultType?: CategoryType
  /** testID stem for the sheet (`${testID}-sheet`) and the form fields. */
  testID?: string
}

export function NewCategorySheet({
  ref,
  defaultType,
  testID = 'home-new-category',
}: NewCategorySheetProps) {
  return (
    <BottomSheet
      ref={ref}
      testID={`${testID}-sheet`}
      snapPoints={['70%', '75%']}
      stackBehavior="push"
      enableDynamicSizing
      enableBlurKeyboardOnGesture
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
    >
      <BottomSheetView testID={`${testID}-sheet`}>
        <BottomSheetHeader title="Новая категория" />
        <BottomSheetBody>
          <CategoryForm defaultType={defaultType} createTestID={testID} />
        </BottomSheetBody>
      </BottomSheetView>
    </BottomSheet>
  )
}
