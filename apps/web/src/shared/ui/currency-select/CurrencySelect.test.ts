import { afterEach, describe, expect, it } from 'vitest'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'
import i18n from '@/shared/i18n'
import { CurrencySelect } from '.'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('CurrencySelect', () => {
  it('renders the trigger label and name as separate spans (whitespace comes from the flex gap)', () => {
    const wrapper = mountWithProviders(CurrencySelect, {
      props: { modelValue: 'RUB' },
    })

    const value = wrapper.find('[data-slot=select-value]')
    const spans = value.findAll('span')
    expect(spans).toHaveLength(2)
    const [labelSpan, nameSpan] = spans
    expect(labelSpan?.text()).toBe('RUB · ₽')
    expect(nameSpan?.text()).toBe(i18n.global.t('currencyNames.RUB'))
  })

  it('falls back to the placeholder text when nothing is selected', () => {
    const wrapper = mountWithProviders(CurrencySelect, {
      props: { modelValue: undefined, placeholder: 'Выберите валюту' },
    })

    const value = wrapper.find('[data-slot=select-value]')
    expect(value.text()).toBe('Выберите валюту')
    expect(value.find('span.font-semibold').exists()).toBe(false)
  })
})
