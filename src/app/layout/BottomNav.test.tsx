/**
 * اختبار حرس للتنقل السفلي:
 * كان الشريط يظهر «عموديًا وعشوائيًا» لأن أصناف CSS غير معرّفة (`app-nav`/`nav-item`).
 * الآن التوزيع عبر Tailwind مباشرة: شبكة من 5 أعمدة، وكل تاب أيقونة فوق التسمية.
 * هذا الاختبار يمنع رجوع الخلل.
 */

import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BottomNav } from './BottomNav'

const profileState = { role: 'merchant' as 'merchant' | 'customer' }

vi.mock('../hooks/useAuth', () => ({
  useProfile: () => ({ data: { role: profileState.role } }),
}))
vi.mock('../hooks/useData', () => ({
  useUnreadCount: () => ({ data: 0 }),
  useAwaitingCount: () => ({ data: 0 }),
}))

beforeEach(() => {
  profileState.role = 'merchant'
})

function renderNav() {
  return render(
    <MemoryRouter>
      <BottomNav />
    </MemoryRouter>,
  )
}

describe('التنقل السفلي', () => {
  it('شبكة أفقية من 5 تابات (لا تراص عمودي)', () => {
    const { container } = renderNav()
    const nav = screen.getByRole('navigation', { name: 'التنقل الرئيسي' })
    const list = nav.querySelector('ul')!

    expect(list.className).toContain('grid')
    expect(list.className).toContain('grid-cols-5')
    expect(list.children).toHaveLength(5)
    // لا أصناف غير معرّفة في CSS
    expect(container.innerHTML).not.toContain('app-nav')
    expect(container.innerHTML).not.toContain('nav-item')
  })

  it('كل تاب: أيقونة فوق التسمية داخل عمود واحد', () => {
    renderNav()
    const nav = screen.getByRole('navigation', { name: 'التنقل الرئيسي' })

    for (const label of ['الرئيسية', 'العملاء', 'العمليات', 'الإشعارات', 'الإعدادات']) {
      const link = within(nav).getByRole('link', { name: new RegExp(label) })
      expect(link.className).toContain('flex-col')
      expect(link.className).toContain('items-center')
      expect(link.querySelector('svg')).not.toBeNull()
    }
  })

  it('تسمية تاب الأطراف تتبع الدور: العملاء للتاجر والديون للعميل', () => {
    renderNav()
    expect(screen.getByRole('link', { name: /العملاء/ })).toBeInTheDocument()

    profileState.role = 'customer'
    renderNav()
    expect(screen.getAllByRole('link', { name: /الديون/ }).length).toBeGreaterThan(0)
  })
})
