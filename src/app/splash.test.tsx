/**
 * شاشة البداية لا يجوز أن تكون طريقًا مسدودًا.
 * هذه الاختبارات تضمن ظهور رسالة واضحة وزر «إعادة المحاولة» بدل تعليق بلا نهاية.
 */

import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BootSplash, SPLASH_TIMEOUT_MS, isBootStuck } from './DataSourceProvider'

afterEach(() => {
  vi.useRealTimers()
})

describe('شاشة البداية', () => {
  it('تُقرّر متى يُعتبر الإقلاع متأخرًا', () => {
    expect(isBootStuck(0)).toBe(false)
    expect(isBootStuck(SPLASH_TIMEOUT_MS - 1)).toBe(false)
    expect(isBootStuck(SPLASH_TIMEOUT_MS)).toBe(true)
    expect(isBootStuck(20_000)).toBe(true)
  })

  it('تعرض الاسم ثم مخرجًا واضحًا بعد التأخّر — بلا شاشة ميتة', async () => {
    vi.useFakeTimers()
    render(<BootSplash />)

    expect(screen.getByText('دفتر الديون')).toBeInTheDocument()
    expect(screen.getByText('دفتر بسيط لإدارة الديون والسداد')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /إعادة المحاولة/ })).not.toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(SPLASH_TIMEOUT_MS + 50)
    })

    expect(screen.getByText(/يستغرق التطبيق وقتًا أطول من المعتاد/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /إعادة المحاولة/ })).toBeInTheDocument()
  })
})
