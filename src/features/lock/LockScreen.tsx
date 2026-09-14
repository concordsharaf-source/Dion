/**
 * شاشة قفل التطبيق:
 *   · القفل بالبصمة ⇐ **شاشة فارغة تمامًا** (بلا أيقونة وبلا زر وبلا نص):
 *     نكتفي بنافذة البصمة التي يُظهرها الجهاز/المتصفح نفسه (WebAuthn).
 *   · إذا أُلغيت المطالبة أو لم تُقرأ البصمة ⇐ نعيد طلبها تلقائيًا (بلا ضغط أي زر،
 *     وعند كل عودة للتطبيق) حتى MAX_BIOMETRIC_ATTEMPTS محاولات.
 *   · بعد استنفاد المحاولات — أو إذا كانت البصمة غير متاحة على هذا الجهاز أصلًا —
 *     يظهر الباترن الاحتياطي حتى لا يبقى المستخدم عالقًا خارج دفتره.
 *   · القفل بالباترن وحده ⇐ لوحة الباترن مباشرة.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { PatternPad } from './PatternPad'
import {
  effectiveLockMode,
  readCredentialId,
  readLockConfig,
  verifyPattern,
  type LockConfig,
} from '@/core/appLock'
import { verifyBiometric } from '@/services/biometric'
import { Avatar } from '@/components/ui'

/** عدد مرات إعادة طلب البصمة تلقائيًا قبل إظهار الباترن */
export const MAX_BIOMETRIC_ATTEMPTS = 3

/** مهلة قصيرة بين المطالبات المتتالية حتى لا نُغرق الجهاز بالطلبات */
export const BIOMETRIC_RETRY_DELAY_MS = 600

/** أسباب تعني أن البصمة لن تنجح على هذا الجهاز — لا فائدة من إعادة الطلب */
const DEAD_END_REASONS = new Set(['unsupported', 'insecure-context', 'unavailable'])

export function LockScreen({
  onUnlocked,
  userName,
}: {
  onUnlocked: () => void
  userName?: string | null
}) {
  const [config] = useState<LockConfig>(() => readLockConfig())
  const mode = effectiveLockMode(config)
  const canBiometric = mode === 'biometric' && Boolean(readCredentialId())

  const [bioMessage, setBioMessage] = useState<string | null>(null)
  /** في وضع البصمة نبقى على شاشة فارغة حتى تظهر رسالة «استخدم الباترن» */
  const [showPattern, setShowPattern] = useState(!canBiometric)
  const [patternStatus, setPatternStatus] = useState<'idle' | 'error' | 'ok'>('idle')
  const [patternError, setPatternError] = useState<string | null>(null)
  const [promptSeq, setPromptSeq] = useState(0)

  const askingRef = useRef(false)
  const attemptsRef = useRef(0)
  const doneRef = useRef(false)

  /** يطلب البصمة من الجهاز — بلا أي واجهة داخل التطبيق وبلا ضغط زر */
  const askBiometric = useCallback(() => setPromptSeq((n) => n + 1), [])

  useEffect(() => {
    if (!canBiometric || showPattern || doneRef.current) return
    const credentialId = readCredentialId()
    if (!credentialId) {
      setShowPattern(true)
      return
    }

    let cancelled = false
    let timer: number | null = null
    askingRef.current = true

    void (async () => {
      const result = await verifyBiometric(credentialId).catch(() => ({
        ok: false as const,
        reason: 'failed' as const,
        message: 'تعذّر الوصول إلى البصمة',
      }))
      if (cancelled || doneRef.current) return

      if (result.ok) {
        doneRef.current = true
        onUnlocked()
        return
      }

      setBioMessage(result.message)

      // البصمة غير متاحة أصلًا ⇐ الباترن مباشرة (بلا حلقة إعادة طلب)
      if (DEAD_END_REASONS.has(result.reason)) {
        setShowPattern(true)
        return
      }

      attemptsRef.current += 1
      if (attemptsRef.current >= MAX_BIOMETRIC_ATTEMPTS) {
        setBioMessage('تعذّرت البصمة — استخدم الباترن')
        setShowPattern(true)
        return
      }

      // شاشة فارغة + إعادة الطلب تلقائيًا
      timer = window.setTimeout(() => {
        timer = null
        askBiometric()
      }, BIOMETRIC_RETRY_DELAY_MS)
    })()

    return () => {
      cancelled = true
      askingRef.current = false
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [canBiometric, showPattern, promptSeq, askBiometric, onUnlocked])

  // استعداد دائم: عند العودة للتطبيق نُعيد المطالبة (الشاشة تبقى فارغة)
  useEffect(() => {
    if (!canBiometric || showPattern) return
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !askingRef.current) askBiometric()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [canBiometric, showPattern, askBiometric])

  async function submitPattern(pattern: number[]) {
    const ok = await verifyPattern(pattern)
    if (ok) {
      setPatternStatus('ok')
      doneRef.current = true
      onUnlocked()
      return
    }
    setPatternStatus('error')
    setPatternError('الباترن غير صحيح — حاول مرة أخرى')
    window.setTimeout(() => setPatternStatus('idle'), 600)
  }

  /* ===== وضع البصمة: شاشة فارغة تمامًا — نكتفي بنافذة الجهاز ===== */
  if (canBiometric && !showPattern) {
    return (
      <div className="app-shell items-center justify-center">
        {/* للقارئ الشاشة فقط — لا شيء ظاهر على الشاشة */}
        <span className="sr-only" role="status">
          جارٍ التحقق من البصمة…
        </span>
      </div>
    )
  }

  /* ===== شاشة الباترن (أساسية، أو تراجع بعد تعذّر البصمة) ===== */
  return (
    <div className="app-shell items-center justify-center px-6 pb-10 pt-14">
      <div className="mb-6 flex flex-col items-center text-center">
        <span className="grid h-16 w-16 place-items-center rounded-3xl bg-brand-600 text-white shadow-lg shadow-brand-600/25">
          <Lock size={28} />
        </span>
        <h1 className="mt-3 text-xl font-black">دفتر الديون مقفل</h1>
        <p className="mt-1 text-[0.8125rem] text-ink-500">أدخل الباترن للمتابعة</p>
        {userName ? (
          <div className="mt-3 flex items-center gap-2 rounded-full bg-ink-200/60 px-3 py-1.5 dark:bg-ink-800/60">
            <Avatar name={userName} className="h-6 w-6 text-[0.625rem]" />
            <span className="text-[0.75rem] font-bold">{userName}</span>
          </div>
        ) : null}
        {bioMessage ? (
          <p className="mt-2 text-[0.6875rem] text-ink-500" role="status">
            {bioMessage}
          </p>
        ) : null}
      </div>

      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-sm dark:bg-ink-900">
        <p className="mb-3 text-center text-[0.8125rem] font-bold">باترن الفتح</p>
        <PatternPad
          status={patternStatus}
          disabled={patternStatus === 'ok'}
          onComplete={(pattern) => void submitPattern(pattern)}
        />
        {patternError ? (
          <p className="mt-3 text-center text-[0.75rem] font-bold text-danger-600" role="alert">
            {patternError}
          </p>
        ) : (
          <p className="mt-3 text-center text-[0.6875rem] text-ink-500">
            الباترن يعمل دائمًا — حتى إن تعذّرت البصمة.
          </p>
        )}
        {canBiometric ? (
          <button
            type="button"
            onClick={() => {
              attemptsRef.current = 0
              setBioMessage(null)
              setShowPattern(false)
              askBiometric()
            }}
            className="mt-3 w-full rounded-full bg-ink-200/70 px-3 py-2 text-[0.75rem] font-bold dark:bg-ink-800"
          >
            إعادة المحاولة بالبصمة
          </button>
        ) : null}
      </div>
    </div>
  )
}

