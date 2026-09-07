import { registerSW } from 'virtual:pwa-register'
import { toast } from 'vue-sonner'
import i18n from '@/shared/i18n'
import { useAppUpdateStore } from '@/shared/store/use-app-update-store'

/**
 * Registers the app-shell service worker and wires the prompted update flow
 * (capability `web-pwa`): when a new build deploys, the running app shows a
 * toast offering a reload. The old version keeps serving until the user
 * accepts (or the next cold start) - never an automatic reload that would
 * destroy unsaved state mid-work. The same waiting-worker signal is also
 * mirrored into the app-update store (change `web-app-info`), so the
 * settings page's about-app card can surface a persistent update status
 * alongside this transient toast (app-writes/pages-read bridge, design D1).
 */
export function registerServiceWorker(): void {
  const update = useAppUpdateStore()
  const updateServiceWorker = registerSW({
    onNeedRefresh() {
      update.needRefresh = true
      toast.info(i18n.global.t('common.updateAvailable'), {
        duration: Infinity,
        action: {
          label: i18n.global.t('common.updateNow'),
          onClick: () => updateServiceWorker(true),
        },
      })
    },
    onOfflineReady() {
      // The shell is precached for offline use; nothing user-facing to do.
    },
  })
  // The reload closure is the toast action's exact flow: the settings card
  // accepting an update goes through the same SKIP_WAITING + reload path.
  update.setReloadToUpdate(updateServiceWorker)
}
