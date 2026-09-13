/**
 * حارس الخروج من التطبيق.
 *
 * القاعدة: إذا كان المستخدم في **الرئيسية** فضغط زر الرجوع (زر النظام أو زر المتصفح)
 * فذلك محاولة **خروج من التطبيق** — حتى لو وصل إلى الرئيسية من شاشة أخرى.
 * ولا يتم الخروج إلا بعد تأكيد المستخدم في **نافذة داخل التطبيق** بتصميمه (لا نافذة نظام).
 *
 * الطريقة: يُضاف مدخل وهمي في سجل التنقّل (pushState) بنفس العنوان، فيبقى المستخدم
 * داخل الصفحة ويصير الرجوع قابلًا للاعتراض. عند كل اعتراض يُعاد تسليح الحارس
 * وتظهر نافذة التأكيد. وعند الموافقة يُحاول التطبيق الخروج:
 *   1) `window.close()` — يعمل في التطبيق المثبّت والنوافذ المفتوحة برمجيًا.
 *   2) الرجوع في السجل إلى ما قبل التطبيق — يعمل في المتصفح إن وُجدت صفحة سابقة.
 *   3) إن تعذّر الأمران (التطبيق أول صفحة في تبويب) تظهر رسالة تدلّ المستخدم على الإغلاق.
 *
 * الرجوع من أي شاشة أخرى يظل تنقّلًا عاديًا داخل التطبيق.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ConfirmDialog, useToast } from '@/components/ui'
import { hasOpenOverlay } from '@/components/overlayGuard'

/** مسار الرئيسية — الرجوع منه يعني محاولة خروج */
export const EXIT_GUARD_PATH = '/'
/** مدة انتظار إغلاق النافذة قبل الاعتماد على الرجوع في السجل */
const CLOSE_TIMEOUT_MS = 120
/** مدة انتظار أخيرة قبل إظهار رسالة تعذّر الإغلاق */
const LEAVE_TIMEOUT_MS = 400

export function ExitGuard() {
  const { pathname } = useLocation()
  const onHome = pathname === EXIT_GUARD_PATH
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  /** عدد مدخلات الحارس المضافة في السجل */
  const pushes = useRef(0)
  /** الحارس مُسلَّح: يعترض الرجوع. يُطفأ فقط أثناء الخروج الفعلي */
  const armed = useRef(true)

  useEffect(() => {
    if (!onHome) {
      setOpen(false)
      return
    }

    armed.current = true

    /** يضيف مدخلًا وهميًا بنفس العنوان ليبقى الرجوع داخل المستند */
    const pushGuard = () => {
      try {
        window.history.pushState({ dafatarExitGuard: true }, '', window.location.href)
        pushes.current += 1
      } catch {
        /* سجل التنقّل غير متاح — يبقى الاعتراض على ما هو متاح */
      }
    }

    pushGuard()

    const onPop = () => {
      if (!armed.current) return
      // الرجوع من الرئيسية = محاولة خروج: نمنع الخروج ونعيد التسليح
      pushGuard()
      // نافذة مفتوحة (نموذج/تأكيد)؟ الرجوع يُغلقها أولًا — كسلوك أندرويد
      if (hasOpenOverlay()) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        return
      }
      // رجوع آخر ونافذة الخروج مفتوحة ⇒ إغلاقها
      setOpen((wasOpen) => !wasOpen)
    }

    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [onHome])

  const stay = useCallback(() => {
    setOpen(false)
    setLeaving(false)
    armed.current = true
  }, [])

  const leave = useCallback(() => {
    armed.current = false
    setLeaving(true)

    // هل غادرنا الصفحة فعلًا؟ (إغلاق نافذة أو انتقال لصفحة أخرى)
    let left = false
    const onLeave = () => {
      left = true
    }
    window.addEventListener('pagehide', onLeave, { once: true })

    // 1) إغلاق مباشر (التطبيق المثبّت على الجوال)
    try {
      window.close()
    } catch {
      /* لا يُسمح بالإغلاق المباشر */
    }

    const finish = () => {
      window.removeEventListener('pagehide', onLeave)
      setLeaving(false)
      setOpen(false)
      if (left || window.closed) return
      // تعذّر الإغلاق (التطبيق أول صفحة في التبويب) — نُعلم المستخدم
      armed.current = true
      toast.show('لا يمكن للتطبيق إغلاق نفسه هنا — أغلقه من زر الإغلاق في المتصفح', 'info')
    }

    /** 2) الخروج بالرجوع في السجل إلى ما قبل التطبيق — بمحاولات متتابعة */
    const tryLeave = (attempt: number) => {
      if (left || window.closed) return finish()
      const steps = attempt === 0 ? Math.max(1, pushes.current + 1) : 1
      pushes.current = 0
      try {
        window.history.go(-steps)
      } catch {
        /* ignore */
      }
      window.setTimeout(() => {
        if (left || window.closed) return finish()
        if (attempt < 3) {
          tryLeave(attempt + 1)
          return
        }
        finish()
      }, LEAVE_TIMEOUT_MS)
    }

    window.setTimeout(() => {
      if (left || window.closed) return finish()
      tryLeave(0)
    }, CLOSE_TIMEOUT_MS)
  }, [toast])

  return (
    <ConfirmDialog
      open={open}
      title="الخروج من التطبيق؟"
      message="أنت في الصفحة الرئيسية — الرجوع يعني إغلاق دفتر الديون. بياناتك محفوظة على جهازك ولن تُفقد."
      confirmLabel="خروج"
      cancelLabel="البقاء في التطبيق"
      tone="danger"
      loading={leaving}
      onCancel={stay}
      onConfirm={leave}
    />
  )
}
