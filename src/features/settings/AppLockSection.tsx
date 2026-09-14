/**
 * قسم «قفل التطبيق» في الإعدادات ← الأمان:
 *   · قفل بالبصمة (WebAuthn — بصمة/وجه/رمز الجهاز) مع باترن احتياطي إلزامي
 *   · قفل بالباترن وحده
 *   · إلغاء القفل
 *
 * إن كانت البصمة غير متاحة لأي سبب، يبقى الباترن متاحًا ويعمل دائمًا.
 */

import { useEffect, useState } from 'react'
import { Fingerprint, KeyRound, Lock, ShieldCheck, Unlock } from 'lucide-react'
import { Button, Card, Chip, ConfirmDialog, SectionTitle, Sheet, useToast } from '@/components/ui'
import { PatternPad } from '@/features/lock/PatternPad'
import {
  clearPattern,
  disableLock,
  hasPattern,
  isValidPattern,
  readLockConfig,
  setPattern,
  writeCredentialId,
  writeLockMode,
  type LockConfig,
} from '@/core/appLock'
import { biometricSupport, registerBiometric, type BiometricFailure } from '@/services/biometric'

const SUPPORT_HINTS: Record<BiometricFailure, string> = {
  unsupported: 'هذا المتصفح لا يدعم البصمة. استخدم الباترن.',
  'insecure-context': 'البصمة تحتاج اتصالًا آمنًا (https). استخدم الباترن.',
  unavailable: 'لا يوجد مستشعر بصمة مُفعّل على هذا الجهاز. استخدم الباترن.',
  cancelled: 'أُلغي طلب البصمة.',
  failed: 'تعذّر التحقق بالبصمة.',
}

export function AppLockSection({ userName }: { userName?: string | null }) {
  const toast = useToast()
  const [config, setConfig] = useState<LockConfig>(() => readLockConfig())
  const [support, setSupport] = useState<{ supported: boolean; reason?: BiometricFailure } | null>(null)

  const [patternOpen, setPatternOpen] = useState(false)
  const [patternStep, setPatternStep] = useState<'create' | 'confirm'>('create')
  const [firstPattern, setFirstPattern] = useState<number[]>([])
  const [patternStatus, setPatternStatus] = useState<'idle' | 'error' | 'ok'>('idle')
  const [patternError, setPatternError] = useState<string | null>(null)
  /** بعد إنشاء الباترن الاحتياطي نُكمل تفعيل البصمة تلقائيًا */
  const [continueToBiometric, setContinueToBiometric] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)

  const refresh = () => setConfig(readLockConfig())

  useEffect(() => {
    let alive = true
    void biometricSupport().then((result) => {
      if (alive) setSupport(result)
    })
    return () => {
      alive = false
    }
  }, [])

  function openPatternSheet(continueToBio = false) {
    setPatternStep('create')
    setFirstPattern([])
    setPatternStatus('idle')
    setPatternError(null)
    setContinueToBiometric(continueToBio)
    setPatternOpen(true)
  }

  async function enableBiometric() {
    if (!hasPattern()) {
      toast.show('أنشئ باترن احتياطيًا أولًا — يعمل إن تعذّرت البصمة', 'info')
      openPatternSheet(true)
      return
    }
    setBusy(true)
    try {
      const result = await registerBiometric(userName ?? 'دفتر الديون')
      if (!result.ok) {
        toast.show(SUPPORT_HINTS[result.reason] ?? result.message, 'error')
        return
      }
      writeCredentialId(result.value.credentialId, result.value.label)
      writeLockMode('biometric')
      refresh()
      toast.show('تم تفعيل قفل التطبيق بالبصمة')
    } finally {
      setBusy(false)
    }
  }

  async function onPatternComplete(pattern: number[]) {
    if (patternStep === 'create') {
      setFirstPattern(pattern)
      setPatternStep('confirm')
      setPatternStatus('idle')
      setPatternError(null)
      return
    }
    if (pattern.join('-') !== firstPattern.join('-')) {
      setPatternStatus('error')
      setPatternError('الباترنان غير متطابقين — أعد المحاولة')
      setPatternStep('create')
      setFirstPattern([])
      window.setTimeout(() => setPatternStatus('idle'), 600)
      return
    }
    setPatternStatus('ok')
    await setPattern(pattern)
    refresh()
    if (continueToBiometric) {
      setPatternOpen(false)
      setContinueToBiometric(false)
      await enableBiometric()
      return
    }
    if (readLockConfig().mode === 'off') writeLockMode('pattern')
    refresh()
    setPatternOpen(false)
    toast.show('تم تعيين الباترن')
  }

  const statusLabel =
    config.mode === 'off'
      ? 'غير مفعّل'
      : config.mode === 'biometric'
        ? config.hasBiometric
          ? 'مفعّل — بصمة (مع باترن احتياطي)'
          : 'مفعّل — بصمة بلا تفعيل، يعمل بالباترن'
        : 'مفعّل — باترن'

  return (
    <section>
      <SectionTitle>قفل التطبيق</SectionTitle>
      <Card className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
            <Lock size={20} />
          </span>
          <div className="flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[0.875rem] font-bold">حماية الدفتر عند الفتح</p>
              <Chip tone={config.mode === 'off' ? 'neutral' : 'ok'}>{statusLabel}</Chip>
            </div>
            <p className="mt-1 text-[0.75rem] leading-5 text-ink-600 dark:text-ink-300">
              عند الدخول إلى التطبيق تبقى الشاشة فارغة وتظهر نافذة البصمة التي يُظهرها جهازك فقط (بلا أزرار ولا نصوص
              داخل التطبيق). تُطلب البصمة مرة واحدة عند الدخول فقط — لا تذكير ولا مطالبات وأنت تستخدم التطبيق. وإن
              أُلغيت المطالبة أو تعذّرت يظهر الباترن، وزر «إعادة المحاولة بالبصمة» متاح متى شئت.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Button
            block
            icon={<Fingerprint size={17} />}
            loading={busy}
            onClick={() => void enableBiometric()}
            disabled={support?.supported === false}
          >
            {config.hasBiometric ? 'تحديث تفعيل البصمة' : 'تفعيل القفل بالبصمة'}
          </Button>
          {support?.supported === false ? (
            <p className="text-center text-[0.6875rem] font-semibold text-gold-700 dark:text-gold-300">
              {SUPPORT_HINTS[support.reason ?? 'unsupported']}
            </p>
          ) : null}

          <Button
            block
            variant="soft"
            icon={<KeyRound size={17} />}
            onClick={() => openPatternSheet(false)}
          >
            {hasPattern() ? 'تغيير الباترن الاحتياطي' : 'قفل بالباترن (بلا بصمة)'}
          </Button>

          {config.mode !== 'off' ? (
            <Button
              block
              variant="ghost"
              className="text-danger-600"
              icon={<Unlock size={17} />}
              onClick={() => setConfirmOff(true)}
            >
              إلغاء قفل التطبيق
            </Button>
          ) : null}
        </div>

        <p className="flex items-start gap-2 text-[0.6875rem] leading-5 text-ink-500">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          البصمة تُعالَج داخل جهازك فقط (WebAuthn)، ولا تُخزَّن أي بيانات بصمة في التطبيق أو على أي خادم. الباترن
          يُخزَّن مُشفَّرًا (PBKDF2).
        </p>
      </Card>

      <Sheet
        open={patternOpen}
        onClose={() => setPatternOpen(false)}
        title={patternStep === 'create' ? 'ارسم باترن الفتح' : 'أعد رسم الباترن للتأكيد'}
      >
        <div className="pb-2">
          {continueToBiometric ? (
            <p className="mb-3 rounded-xl bg-brand-50 px-3 py-2 text-[0.75rem] font-semibold text-brand-800 dark:bg-brand-900/25 dark:text-brand-200">
              هذا الباترن يعمل إن تعذّرت البصمة لأي سبب. بعد حفظه سنطلب تفعيل البصمة.
            </p>
          ) : null}
          <PatternPad status={patternStatus} onComplete={(p) => void onPatternComplete(p)} />
          {patternError ? (
            <p className="mt-3 text-center text-[0.75rem] font-bold text-danger-600" role="alert">
              {patternError}
            </p>
          ) : null}
          {!isValidPattern(firstPattern) && patternStep === 'confirm' ? null : null}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmOff}
        title="إلغاء قفل التطبيق"
        message="سيصبح الدفتر مفتوحًا لأي شخص يفتح التطبيق على هذا الجهاز. بياناتك تبقى كما هي."
        confirmLabel="إلغاء القفل"
        tone="danger"
        onCancel={() => setConfirmOff(false)}
        onConfirm={() => {
          disableLock()
          clearPattern()
          refresh()
          setConfirmOff(false)
          toast.show('تم إلغاء قفل التطبيق')
        }}
      />
    </section>
  )
}
