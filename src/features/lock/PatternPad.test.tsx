/**
 * اختبار لوحة الباترن — يمنع تكرار الخلل الذي كان يعلّق المستخدم:
 * بعد إكمال الباترن الأول كان النقر لا يعمل، فلا يستطيع إدخال باترن التأكيد.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PatternPad } from './PatternPad'

async function draw(user: ReturnType<typeof userEvent.setup>, dots: string[]) {
  for (const dot of dots) await user.click(screen.getByRole('button', { name: dot }))
  await user.click(screen.getByRole('button', { name: 'تأكيد الباترن' }))
}

describe('لوحة الباترن', () => {
  it('تُكمل الباترن ثم تسمح بباترن ثانٍ (إنشاء ثم تأكيد)', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<PatternPad onComplete={onComplete} />)

    await draw(user, ['نقطة 1', 'نقطة 2', 'نقطة 3', 'نقطة 6'])
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenLastCalledWith([0, 1, 2, 5])

    // باترن ثانٍ: يجب أن يعمل بلا أي عودة أو إعادة تركيب
    await draw(user, ['نقطة 1', 'نقطة 2', 'نقطة 3', 'نقطة 6'])
    expect(onComplete).toHaveBeenCalledTimes(2)
    expect(onComplete).toHaveBeenLastCalledWith([0, 1, 2, 5])
  })

  it('باترن ثانٍ مختلف يُرسَل كما هو (لا يبقى الباترن الأول)', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<PatternPad onComplete={onComplete} />)

    await draw(user, ['نقطة 1', 'نقطة 2', 'نقطة 3', 'نقطة 6'])
    await draw(user, ['نقطة 7', 'نقطة 8', 'نقطة 9', 'نقطة 5'])
    expect(onComplete).toHaveBeenLastCalledWith([6, 7, 8, 4])
  })

  it('لا يُرسل باترن أقصر من 4 نقاط', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<PatternPad onComplete={onComplete} />)

    await user.click(screen.getByRole('button', { name: 'نقطة 1' }))
    await user.click(screen.getByRole('button', { name: 'نقطة 2' }))
    expect(screen.getByRole('button', { name: 'تأكيد الباترن' })).toBeDisabled()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('زر «مسح» يفرّغ النقاط', async () => {
    const user = userEvent.setup()
    render(<PatternPad onComplete={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'نقطة 1' }))
    await user.click(screen.getByRole('button', { name: 'مسح' }))
    expect(screen.getByRole('button', { name: 'تأكيد الباترن' })).toBeDisabled()
  })
})
