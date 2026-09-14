/**
 * شاشة قفل التطبيق:
 *   · القفل بالبصمة ⇐ **شاشة فارغة تمامًا** (بلا أيقونة وبلا زر وبلا نص):
 *     نكتفي بنافذة البصمة التي يُظهرها الجهاز/المتصفح نفسه (WebAuthn).
 *   · المطالبة تتم **مرة واحدة عند الدخول فقط** (عند ظهور القفل): لا إعادة طلب
 *     تلقائية ولا تذكير أثناء استخدام التطبيق — لو أُلغيت المطالبة أو فشلت
 *     يظهر الباترن، ومن يرد البصمة مرة أخرى يضغط «إعادة المحاولة بالبصمة».
 *   · البصمة غير متاحة على الجهاز أصلًا ⇐ الباترن مباشرة.
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

export function LockScreen({
  onUnlocked,
  onPromptActiveChange,
  userName,
}: {
  onUnlocked: () => void
  /** تُبلَّغ الحارس أن نافذة البصمة مفتوحة كي لا يحسبها غيابًا ويُعيد القفل */
  onPromptActiveChange?: (active: boolean) => void
  userName?: string | null
}) {
  const [config] = useState<LockConfig>(() => readLockConfig())
  const mode = effectiveLockMode(config)
  const canBiometric = mode === 'biometric' && Boolean(readCredentialId())

  const [bioMessage, setBioMessage] = useState<string | null>(null)
  /** 'prompt' = شاشة فارغة انتظارًا لنافذة الجهاز · 'pattern' = لوحة الباترن */
  const [phase, setPhase] = useState<'prompt' | 'pattern'>(canBiometric ? 'prompt' : 'pattern')
  const [patternStatus, setPatternStatus] = useState<'idle' | 'error' | 'ok'>('idle')
  const [patternError, setPatternError] = useState<string | null>(null)
  /** يزيدها المستخدم فقط (بزر إعادة المحاولة) — لا شيء يزيدها تلقائيًا */
  const [promptSeq, setPromptSeq] = useState(0)

  const doneRef = useRef(false)
  const promptActiveRef = useRef(false)

  const setPromptActive = useCallback(
    (active: boolean) => {
      promptActiveRef.current = active
      onPromptActiveChange?.(active)
    },
    [onPromptActiveChange],
  )

  const askBiometric = useCallback(() => setPromptSeq((n) => n + 1), [])

  /* مطالبة واحدة لكل حلقة قفل: عند الظهور (أو عند أول طلب صريح من المستخدم) */
  useEffect(() => {
    if (!canBiometric || phase !== 'prompt' || doneRef.current) return
    const credentialId = readCredentialId()
    if (!credentialId) {
      setPhase('pattern')
      return
    }

    let cancelled = false
    let onVisible: (() => void) | null = null

    const run = async () => {
      setPromptActive(true)
      const result = await verifyBiometric(credentialId).catch(() => ({
        ok: false as const,
        reason: 'failed' as const,
        message: 'تعذّر الوصول إلى البصمة',
      }))
      setPromptActive(false)
      if (cancelled || doneRef.current) return

      if (result.ok) {
        doneRef.current = true
        onUnlocked()
        return
      }

      // لا إعادة طلب تلقائية: نكتفي بما عرضه الجهاز، والباترن هو المخرج
      setBioMessage(
        result.reason === 'cancelled' || result.reason === 'failed'
          ? 'تعذّرت البصمة — استخدم الباترن'
          : result.message,
      )
      setPhase('pattern')
    }

    // لا نفتح نافذة البصمة والتطبيق في الخلفية (تُفتح عند الدخول فعلًا)
    if (document.visibilityState === 'visible') {
      void run()
    } else {
      onVisible = () => {
        if (document.visibilityState !== 'visible' || !onVisible) return
        document.removeEventListener('visibilitychange', onVisible)
        onVisible = null
        if (!cancelled && !doneRef.current) void run()
      }
      document.addEventListener('visibilitychange', onVisible)
    }

    return () => {
      cancelled = true
      if (onVisible) document.removeEventListener('visibilitychange', onVisible)
      if (promptActiveRef.current) setPromptActive(false)
    }
  }, [canBiometric, phase, promptSeq, onUnlocked, setPromptActive])

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

  /* ===== انتظار البصمة: شاشة فارغة تمامًا — نكتفي بنافذة الجهاز ===== */
  if (canBiometric && phase === 'prompt') {
    return (
      <div className="app-shell items-center justify-center">
        {/* للقارئ الشاشة فقط — لا شيء ظاهر على الشاشة */}
        <span className="sr-only" role="status">
          جارٍ التحقق من البصمة…
        </span>
      </div>
    )
  }

  /* ===== شاشة الباترن (أساسية، أو بعد إلغاء/تعذّر البصمة) ===== */
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
              setBioMessage(null)
              setPhase('prompt')
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
