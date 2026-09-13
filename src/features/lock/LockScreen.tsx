/**
 * شاشة قفل التطبيق:
 *   · إذا كان القفل بالبصمة: تظهر علامة «المطالبة بالبصمة» وتُطلَب البصمة تلقائيًا
 *     فور ظهور الشاشة (وبلا ضغط أي زر)، وتُعاد المحاولة عند العودة للتطبيق.
 *   · إذا تعذّرت البصمة لأي سبب (غير متاحة، إلغاء، فشل) ⇐ يظهر الباترن مباشرة.
 *   · الباترن متاح دائمًا كخيار احتياطي.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Fingerprint, KeyRound, Lock, RefreshCw } from 'lucide-react'
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

type BioState = 'idle' | 'asking' | 'failed'

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

  const [bioState, setBioState] = useState<BioState>(canBiometric ? 'asking' : 'idle')
  const [bioMessage, setBioMessage] = useState<string | null>(null)
  const [showPattern, setShowPattern] = useState(!canBiometric)
  const [patternStatus, setPatternStatus] = useState<'idle' | 'error' | 'ok'>('idle')
  const [patternError, setPatternError] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)
  const askingRef = useRef(false)

  /** يطلب البصمة تلقائيًا — بلا أي زر */
  const askBiometric = useCallback(async () => {
    const credentialId = readCredentialId()
    if (!canBiometric || !credentialId || askingRef.current) return
    askingRef.current = true
    setBioState('asking')
    setBioMessage(null)
    try {
      const result = await verifyBiometric(credentialId)
      if (result.ok) {
        setBioState('idle')
        onUnlocked()
        return
      }
      // تعذّرت البصمة لأي سبب ⇐ الباترن فورًا
      setBioState('failed')
      setBioMessage(result.message)
      setShowPattern(true)
    } catch {
      setBioState('failed')
      setBioMessage('تعذّر الوصول إلى البصمة — استخدم الباترن')
      setShowPattern(true)
    } finally {
      askingRef.current = false
    }
  }, [canBiometric, onUnlocked])

  // مطالبة تلقائية عند ظهور الشاشة
  useEffect(() => {
    if (!canBiometric) return
    void askBiometric()
  }, [canBiometric, askBiometric])

  // استعداد دائم: إذا عاد المستخدم للتطبيق، نعيد المطالبة تلقائيًا
  useEffect(() => {
    if (!canBiometric) return
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !askingRef.current) void askBiometric()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [canBiometric, askBiometric])

  async function submitPattern(pattern: number[]) {
    const ok = await verifyPattern(pattern)
    if (ok) {
      setPatternStatus('ok')
      onUnlocked()
      return
    }
    setPatternStatus('error')
    setAttempts((n) => n + 1)
    setPatternError('الباترن غير صحيح — حاول مرة أخرى')
    window.setTimeout(() => setPatternStatus('idle'), 600)
  }

  return (
    <div className="app-shell items-center justify-center px-6 pb-10 pt-14">
      <div className="mb-6 flex flex-col items-center text-center">
        <span className="grid h-16 w-16 place-items-center rounded-3xl bg-brand-600 text-white shadow-lg shadow-brand-600/25">
          <Lock size={28} />
        </span>
        <h1 className="mt-3 text-xl font-black">دفتر الديون مقفل</h1>
        <p className="mt-1 text-[0.8125rem] text-ink-500">
          {canBiometric ? 'افتح ببصمة إصبعك' : 'أدخل الباترن للمتابعة'}
        </p>
        {userName ? (
          <div className="mt-3 flex items-center gap-2 rounded-full bg-ink-200/60 px-3 py-1.5 dark:bg-ink-800/60">
            <Avatar name={userName} className="h-6 w-6 text-[0.625rem]" />
            <span className="text-[0.75rem] font-bold">{userName}</span>
          </div>
        ) : null}
      </div>

      {/* علامة المطالبة بالبصمة — استعداد تلقائي */}
      {canBiometric ? (
        <div className="mb-5 flex flex-col items-center text-center">
          <button
            type="button"
            onClick={() => void askBiometric()}
            aria-label="فتح بالبصمة"
            className="relative grid h-24 w-24 place-items-center rounded-full bg-brand-50 text-brand-700 transition active:scale-95 dark:bg-brand-900/30 dark:text-brand-200"
          >
            {bioState === 'asking' ? (
              <span className="absolute inset-0 animate-ping rounded-full bg-brand-400/30" aria-hidden="true" />
            ) : null}
            <Fingerprint size={44} className={bioState === 'asking' ? 'animate-pulse' : ''} />
          </button>
          <p className="mt-2 text-[0.75rem] font-bold text-ink-600 dark:text-ink-300">
            {bioState === 'asking'
              ? 'ضع إصبعك على مستشعر البصمة…'
              : bioState === 'failed'
                ? 'تعذّرت البصمة — استخدم الباترن أدناه'
                : 'انقر للفتح بالبصمة'}
          </p>
          {bioMessage && bioState === 'failed' ? (
            <p className="mt-1 text-[0.6875rem] text-ink-500" role="status">
              {bioMessage}
            </p>
          ) : null}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void askBiometric()}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink-200/70 px-3 py-1.5 text-[0.75rem] font-bold dark:bg-ink-800"
            >
              <RefreshCw size={14} /> إعادة محاولة البصمة
            </button>
            {!showPattern ? (
              <button
                type="button"
                onClick={() => setShowPattern(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-ink-200/70 px-3 py-1.5 text-[0.75rem] font-bold dark:bg-ink-800"
              >
                <KeyRound size={14} /> استخدام الباترن
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showPattern ? (
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
              {attempts >= 3 ? ' — إن نسيت الباترن، سجّل الخروج من الإعدادات بعد فتح الجهاز.' : ''}
            </p>
          ) : (
            <p className="mt-3 text-center text-[0.6875rem] text-ink-500">
              إن تعذّرت البصمة لأي سبب، الباترن يعمل دائمًا.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
