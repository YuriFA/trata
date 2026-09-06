import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'
import { DESKTOP_PRESENTATION_KEY } from '@/shared/lib/presentation'
import { DIALOG_FORM_FOOTER_CLASS, ResponsiveDialog } from '.'

afterEach(() => {
  document.body.innerHTML = ''
})

function mountDialog(desktop: boolean, extraProps: Record<string, unknown> = {}) {
  const Host = defineComponent({
    setup() {
      const open = ref(true)
      return () =>
        h(
          ResponsiveDialog,
          {
            open: open.value,
            'onUpdate:open': (value: boolean) => (open.value = value),
            'data-testid': 'responsive-dialog',
            ...extraProps,
          },
          {
            title: () => 'Overlay title',
            default: () => h('div', { 'data-testid': 'responsive-dialog-body' }, 'Overlay body'),
            footer: () =>
              h('span', { 'data-testid': 'responsive-dialog-footer' }, 'Overlay footer'),
          },
        )
    },
  })

  return mountWithProviders(Host, {
    repositories: {},
    global: {
      provide: {
        [DESKTOP_PRESENTATION_KEY]: ref(desktop),
      },
    },
  })
}

const content = () => document.querySelector('[data-slot="dialog-content"]')
const drawerContent = () => document.querySelector('[data-slot="drawer-content"]')
const surface = () => content() ?? drawerContent()
const header = () => surface()?.querySelector('header')
const footerBand = () =>
  document.querySelector('[data-testid="responsive-dialog-footer"]')?.parentElement
// The dialog's only scrolling region: the closest ancestor of the body slot
// content that carries overflow-y-auto (the body wrapper itself on desktop,
// the DrawerContent scroll wrapper on mobile).
const scrollRegion = () => {
  let node = document.querySelector<HTMLElement>('[data-testid="responsive-dialog-body"]')
  while (node && !node.className.includes('overflow-y-auto')) node = node.parentElement
  return node
}

describe('ResponsiveDialog', () => {
  it('renders the desktop dialog presentation when pinned to desktop', async () => {
    mountDialog(true)
    await flushPromises()

    expect(content()).not.toBeNull()
    expect(drawerContent()).toBeNull()
    expect(document.querySelector('[data-testid="responsive-dialog-body"]')?.textContent).toBe(
      'Overlay body',
    )
  })

  it('renders the mobile drawer presentation when pinned to mobile', async () => {
    mountDialog(false)
    await flushPromises()

    expect(drawerContent()).not.toBeNull()
    expect(content()).toBeNull()
    expect(document.querySelector('[data-testid="responsive-dialog-body"]')?.textContent).toBe(
      'Overlay body',
    )
  })

  it('borders the header and the footer band by default (settings design language)', async () => {
    mountDialog(true)
    await flushPromises()

    expect(header()?.className).toContain('border-b')
    expect(footerBand()?.className).toContain('border-t')
  })

  it('keeps the mobile drawer footer bordered by default', async () => {
    mountDialog(false)
    await flushPromises()

    expect(header()?.className).toContain('border-b')
    expect(footerBand()?.className).toContain('border-t')
  })

  it('drops the hairlines on opt-out (plain header, unbordered footer)', async () => {
    mountDialog(true, { headerVariant: 'plain', borderedFooter: false })
    await flushPromises()

    expect(header()?.className).not.toContain('border-b')
    expect(footerBand()?.className).not.toContain('border-t')
  })

  it('pins the header and footer band outside the desktop scroll region', async () => {
    mountDialog(true)
    await flushPromises()

    const region = scrollRegion()
    expect(region).not.toBeNull()
    expect(region?.className).toContain('min-h-0')
    expect(region?.contains(document.querySelector('[data-testid="responsive-dialog-body"]'))).toBe(
      true,
    )
    expect(region?.contains(header() ?? null)).toBe(false)
    expect(region?.contains(footerBand() ?? null)).toBe(false)
  })

  it('pins the drawer header and footer band outside the scroll region', async () => {
    mountDialog(false)
    await flushPromises()

    const region = scrollRegion()
    expect(region).not.toBeNull()
    expect(region?.contains(document.querySelector('[data-testid="responsive-dialog-body"]'))).toBe(
      true,
    )
    expect(region?.contains(header() ?? null)).toBe(false)
    expect(region?.contains(footerBand() ?? null)).toBe(false)
  })

  it('keeps geometry on the sections - no negative-margin breakouts', async () => {
    for (const desktop of [true, false]) {
      mountDialog(desktop)
      await flushPromises()

      const body = document.querySelector('[data-slot="dialog-body"]')
      const slotWrapper = document.querySelector(
        '[data-testid="responsive-dialog-body"]',
      )?.parentElement
      const sections = [
        surface()?.className,
        header()?.className,
        body?.className,
        slotWrapper?.className,
        footerBand()?.className,
      ]
      const offenders = sections.flatMap((cls) =>
        (cls ?? '')
          .split(' ')
          .filter((c) => c.startsWith('-m'))
          .map((c) => `${desktop ? 'desktop' : 'mobile'}: ${c}`),
      )
      expect(offenders).toEqual([])
      // Sticky physics invariant: the scroll container must not own bottom
      // padding (a stuck band would float above it); the slot wrapper does.
      expect(body?.className.split(' ')).not.toContain('pb-6')
      expect(slotWrapper?.className.split(' ')).toContain('pb-6')
      // Desktop panel padding is neutralized (sections own it); the drawer
      // panel never had any.
      const panelClass = (content() ?? drawerContent())?.className ?? ''
      expect(panelClass).not.toMatch(/(^|\s)p-6(\s|$)/)
      expect(panelClass.includes('p-0')).toBe(desktop)

      document.body.innerHTML = ''
    }
  })

  it('drops all body padding on the flush variant - sticky scrollport stays flush with the header', async () => {
    mountDialog(true, { bodyVariant: 'flush' })
    await flushPromises()

    const body = document.querySelector('[data-slot="dialog-body"]')
    expect(body?.className).not.toContain('px-6')
    expect(body?.className).not.toContain('pt-4')
  })

  it('keeps the in-body form footer sticky so it stays visible while the body scrolls', () => {
    expect(DIALOG_FORM_FOOTER_CLASS).toContain('sticky bottom-0')
    expect(DIALOG_FORM_FOOTER_CLASS).toContain('bg-card')
  })
})
