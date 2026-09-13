import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui'
import { ContactImportButton } from './ContactImportButton'

function renderButton() {
  const onPick = vi.fn()
  const view = render(
    <ToastProvider>
      <ContactImportButton onPick={onPick} />
    </ToastProvider>,
  )
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
  return { onPick, input, ...view }
}

const VCARD_ONE = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:أحمد محمد', 'TEL;TYPE=CELL:+967771234567', 'END:VCARD'].join('\n')

const VCARD_MANY = [
  'BEGIN:VCARD',
  'FN:بقالة النور',
  'TEL;TYPE=CELL:771111111',
  'END:VCARD',
  'BEGIN:VCARD',
  'FN:سوق الأمانة',
  'TEL;TYPE=CELL:733222111',
  'END:VCARD',
].join('\n')

describe('زر استيراد جهات الاتصال', () => {
  it('يعرض الزر بجوار حقل الهاتف مع مدخل ملف مخفي', () => {
    const { input } = renderButton()
    expect(screen.getByRole('button', { name: 'استيراد من جهات الاتصال' })).toBeInTheDocument()
    expect(input).toBeInTheDocument()
    expect(input.accept).toContain('.vcf')
  })

  it('يستورد الاسم والرقم مباشرة من ملف vCard فيه جهة واحدة', async () => {
    const user = userEvent.setup()
    const { onPick, input } = renderButton()

    await user.upload(input, new File([VCARD_ONE], 'contact.vcf', { type: 'text/vcard' }))

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1))
    expect(onPick).toHaveBeenCalledWith({ name: 'أحمد محمد', phone: '+967771234567' })
    expect(await screen.findByText('تم استيراد جهة الاتصال')).toBeInTheDocument()
  })

  it('يعرض قائمة للاختيار حين يحتوي الملف عدة جهات اتصال', async () => {
    const user = userEvent.setup()
    const { onPick, input } = renderButton()

    await user.upload(input, new File([VCARD_MANY], 'contacts.vcf', { type: 'text/vcard' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('بقالة النور')).toBeInTheDocument()
    expect(onPick).not.toHaveBeenCalled()

    await user.click(screen.getByText('سوق الأمانة'))

    await waitFor(() => expect(onPick).toHaveBeenCalledWith({ name: 'سوق الأمانة', phone: '733222111' }))
  })

  it('يعرض رسالة واضحة حين لا يحتوي الملف على أرقام', async () => {
    const user = userEvent.setup()
    const { onPick, input } = renderButton()

    await user.upload(input, new File(['مرحبا بالعالم'], 'contacts.csv', { type: 'text/csv' }))

    expect(await screen.findByText('لم يُعثر على اسم أو رقم هاتف في الملف')).toBeInTheDocument()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('يقرأ ملف CSV من Google Contacts', async () => {
    const user = userEvent.setup()
    const { onPick, input } = renderButton()
    const csv = 'Name,Phone 1 - Value\nسعيد علي,+967733222111'

    await user.upload(input, new File([csv], 'contacts.csv', { type: 'text/csv' }))

    await waitFor(() => expect(onPick).toHaveBeenCalledWith({ name: 'سعيد علي', phone: '+967733222111' }))
  })
})
