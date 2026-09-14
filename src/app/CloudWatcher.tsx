import { useEffect, useRef } from 'react'
import { useDataSource } from './DataSourceProvider'
import { useProfile } from './hooks/useAuth'
import { useToast } from '@/components/ui'
import { queryClient } from './queryClient'
import { clearPendingTransfer, readPendingTransfer, takeCloudNotice } from '@/services/cloudLink'

/**
 * جسر الحساب السحابي:
 *   1) يعرض رسالة الربط/التأكيد بعد إعادة التحميل (الرسائل العابرة تضيع معها).
 *   2) ينقل دفتر الجهاز إلى الحساب السحابي إن بقي نقلٌ معلّق (بعد تأكيد البريد،
 *      أو بعد انقطاع الشبكة أثناء الربط). الدمج بلا حذف وبلا تكرار.
 */
export function CloudWatcher() {
  const ds = useDataSource()
  const profile = useProfile()
  const toast = useToast()

  const noticeShown = useRef(false)
  useEffect(() => {
    if (noticeShown.current) return
    noticeShown.current = true
    const notice = takeCloudNotice()
    if (notice) toast.show(notice, 'ok')
  }, [toast])

  const running = useRef(false)
  useEffect(() => {
    if (ds.kind !== 'supabase' || !profile.data || running.current) return
    const payload = readPendingTransfer()
    if (!payload || !ds.restore) return
    running.current = true
    void (async () => {
      try {
        const result = await ds.restore!(payload)
        clearPendingTransfer()
        await queryClient.invalidateQueries()
        toast.show(`نُقل دفترك إلى حسابك السحابي: ${result.parties} طرفًا و${result.entries} عملية`, 'ok')
      } catch {
        // نحاول مرة أخرى في المرة القادمة — النسخة محفوظة على الجهاز
        running.current = false
      }
    })()
  }, [ds, profile.data, toast])

  return null
}
