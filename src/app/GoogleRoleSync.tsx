import { useEffect, useRef } from 'react'
import { useDataSource } from './DataSourceProvider'
import { useProfile } from './hooks/useAuth'
import type { Role } from '@/core/domain'

/**
 * بعد عودة المستخدم من Google OAuth:
 * - نقرأ الدور المحفوظ مؤقتاً dafatar.pendingRole
 * - إن كان الملف الشخصي موجود ودوره مختلف، نحدّثه
 * - ثم نحذف المفتاح المؤقت
 * 
 * هذا يضمن أن اختيار "عميل/تاجر" قبل الضغط على Google يُطبّق حتى لو كان trigger أنشأ ملفاً افتراضياً.
 */
export function GoogleRoleSync() {
  const ds = useDataSource()
  const profile = useProfile()
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    if (!profile.data) return
    if (ds.kind !== 'supabase') return

    let pending: string | null = null
    try {
      pending = localStorage.getItem('dafatar.pendingRole')
    } catch {
      return
    }
    if (!pending) return
    if (pending !== 'customer' && pending !== 'merchant') {
      try { localStorage.removeItem('dafatar.pendingRole') } catch {}
      return
    }
    const desired = pending as Role
    if (profile.data.role === desired) {
      try { localStorage.removeItem('dafatar.pendingRole') } catch {}
      done.current = true
      return
    }
    // حدّث الدور
    done.current = true
    void ds.auth.updateProfile({ role: desired }).then(() => {
      try { localStorage.removeItem('dafatar.pendingRole') } catch {}
    }).catch(() => {
      // نعيد المحاولة لاحقاً
      done.current = false
    })
  }, [ds, profile.data])

  return null
}
