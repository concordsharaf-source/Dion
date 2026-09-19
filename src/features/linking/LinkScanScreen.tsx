import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, CameraOff, Check, Copy, Keyboard, Link2, ShieldCheck, X, Zap } from 'lucide-react'
import { Button, Card, Field, Input, Money, useToast } from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import { useDataSource } from '@/app/DataSourceProvider'
import { useProfile } from '@/app/hooks/useAuth'
import { queryClient, qk } from '@/app/queryClient'
import { formatCountdown } from '@/core/datetime'
import { parseLinkPayload, secondsRemaining } from '@/core/qr'
import { toUserMessage } from '@/core/errors'
import type { LinkPreview } from '@/data/port'
import jsQR from 'jsqr'

/**
 * مسح رمز الربط (العميل): يُعرض اسم التاجر فقط ثم يقرر العميل الموافقة.
 * بعد الموافقة يبقى الربط معلّقًا حتى يوافق التاجر أيضًا (موافقة الطرفين).
 * يدعم الإدخال اليدوي للرمز عند عدم توفر الكاميرا.
 * 
 * تم إصلاحه: الآن يدعم كل المتصفحات عبر jsQR كـ fallback لـ BarcodeDetector
 */
export function LinkScanScreen() {
  const ds = useDataSource()
  const navigate = useNavigate()
  const toast = useToast()
  const profile = useProfile()

  const [token, setToken] = useState<string | null>(null)
  const [preview, setPreview] = useState<LinkPreview | null>(null)
  const [smartInput, setSmartInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraSupported, setCameraSupported] = useState(false)
  const [scanFeedback, setScanFeedback] = useState('')

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const stopRef = useRef(false)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const supported =
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia)
    setCameraSupported(supported)
  }, [])

  // كاميرا + مسح مستمر مع fallback قوي
  useEffect(() => {
    if (!cameraOn) return
    let detector: any = null
    stopRef.current = false
    setScanFeedback('جاري تشغيل الكاميرا...')

    async function initDetector() {
      try {
        // @ts-ignore
        if ('BarcodeDetector' in window) {
          // @ts-ignore
          const BD = (window as any).BarcodeDetector
          const formats = await BD.getSupportedFormats?.() ?? ['qr_code']
          if (formats.includes('qr_code')) {
            detector = new BD({ formats: ['qr_code'] })
          }
        }
      } catch {
        detector = null
      }
    }

    async function start() {
      await initDetector()
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
          setScanFeedback('وجّه الكاميرا نحو رمز QR')
        }

        const canvas = canvasRef.current
        const video = videoRef.current
        if (!canvas || !video) return
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return

        let frameCount = 0
        const loop = async () => {
          if (stopRef.current || !videoRef.current || !canvasRef.current) return
          const v = videoRef.current
          const c = canvasRef.current
          if (v.readyState !== v.HAVE_ENOUGH_DATA) {
            rafRef.current = window.setTimeout(() => void loop(), 100) as unknown as number
            return
          }

          // كل 3 إطارات نحاول المسح لتوفير البطارية
          frameCount++
          if (frameCount % 3 === 0) {
            try {
              // أولاً: جرّب BarcodeDetector إن وُجد (أسرع)
              if (detector) {
                try {
                  const found = (await detector.detect(v)) as { rawValue: string }[]
                  if (found.length > 0 && found[0].rawValue) {
                    stopRef.current = true
                    setScanFeedback('تم العثور على الرمز!')
                    void loadPreview(found[0].rawValue)
                    return
                  }
                } catch {
                  // تجاهل وجرّب jsQR
                }
              }

              // ثانياً: jsQR fallback (يعمل على كل المتصفحات)
              const width = v.videoWidth
              const height = v.videoHeight
              if (width > 0 && height > 0) {
                c.width = width
                c.height = height
                ctx.drawImage(v, 0, 0, width, height)
                const imageData = ctx.getImageData(0, 0, width, height)
                const code = jsQR(imageData.data, width, height, {
                  inversionAttempts: 'attemptBoth',
                })
                if (code?.data) {
                  stopRef.current = true
                  setScanFeedback('تم العثور على الرمز!')
                  void loadPreview(code.data)
                  return
                }
              }
            } catch {
              /* تجاهل إطار فاشل */
            }
          }

          if (!stopRef.current) {
            rafRef.current = window.setTimeout(() => void loop(), 150) as unknown as number
          }
        }
        void loop()
      } catch (err) {
        console.error('Camera error', err)
        setError('لم نتمكن من تشغيل الكاميرا. تأكد من السماح للتطبيق باستخدام الكاميرا، أو أدخل الرمز يدويًا.')
        setCameraOn(false)
        setScanFeedback('')
      }
    }
    void start()

    return () => {
      stopRef.current = true
      window.clearTimeout(rafRef.current)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn])

  async function loadPreview(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) {
      setError('الرجاء إدخال الرمز أو الرابط')
      return
    }
    setBusy(true)
    setError('')
    try {
      const parsed = parseLinkPayload(trimmed)
      if (!parsed) {
        setError('الرمز غير صالح. تأكد من نسخ الرابط كاملاً أو إدخال الكود اليدوي بشكل صحيح (مثال: ABCD-EFGH-IJKL). اطلب من التاجر إنشاء رمز جديد إن انتهت صلاحيته.')
        return
      }
      const result = await ds.links.previewInvite(parsed)
      setToken(parsed)
      setPreview(result)
      setCameraOn(false)
      setScanFeedback('')
    } catch (e) {
      const msg = toUserMessage(e)
      // تحسين رسائل الخطأ الشائعة
      if (msg.includes('link_expired') || msg.includes('انتهت')) {
        setError('انتهت صلاحية هذا الرمز (10 دقائق). اطلب من التاجر إنشاء رمز جديد.')
      } else if (msg.includes('link_used') || msg.includes('مستخدم')) {
        setError('هذا الرمز تم استخدامه من قبل. اطلب رمزاً جديداً.')
      } else if (msg.includes('self_link')) {
        setError('لا يمكنك ربط حسابك بنفسك.')
      } else if (msg.includes('already_linked')) {
        setError('أنت مرتبط بهذا التاجر مسبقاً.')
      } else if (msg.includes('not_found') || msg.includes('غير موجود')) {
        setError('الرمز غير موجود. قد يكون في وضع محلي - الربط بين جهازين يحتاج تفعيل الحساب السحابي من الإعدادات.')
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  async function respond(accept: boolean) {
    if (!token) return
    setBusy(true)
    setError('')
    try {
      if (accept) {
        await ds.links.claimInvite(token)
        toast.show('تم إرسال طلب الربط — يكتمل الربط بعد موافقة التاجر أيضًا')
      } else {
        toast.show('لم تتم الموافقة — لم يُنشأ أي ربط', 'info')
      }
      await queryClient.invalidateQueries({ queryKey: qk.linkRequests })
      await queryClient.invalidateQueries({ queryKey: qk.relationships })
      navigate('/link', { replace: true })
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (preview && token) {
    const left = secondsRemaining(preview.expiresAt)
    return (
      <div>
        <PageHeader title="تأكيد الربط" subtitle="موافقة الطرفين مطلوبة" />
        <div className="space-y-4 px-4 pt-4">
          <Card className="space-y-3 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-3xl bg-brand-600 text-white">
              <Link2 size={26} />
            </div>
            <p className="text-[0.8125rem] text-ink-500">طلب ربط مع</p>
            <p className="text-xl font-extrabold">{preview.merchantName || 'تاجر'}</p>

            <div className="space-y-1.5 text-start">
              <InfoRow label="ينتهي الرمز بعد" value={formatCountdown(left)} />
              {preview.alreadyLinked ? <InfoRow label="الحالة" value="مرتبط بالفعل" /> : null}
            </div>
          </Card>

          {preview.previousBalanceMinor !== 0 ? (
            <div className="rounded-2xl border border-gold-300 bg-gold-50 p-3.5 text-[0.75rem] leading-5 text-gold-900 dark:bg-gold-900/20 dark:text-gold-100">
              لدى التاجر رصيد سابق مسجّل لك بقيمة{' '}
              <Money minor={preview.previousBalanceMinor} currency={profile.data?.currency} className="font-extrabold" />.
              لن يُدمج تلقائيًا: ستراجع القيمة بعد الربط وتوافق أو ترفض، وإن رفضت يبدأ الحساب المشترك من تاريخ الربط.
            </div>
          ) : null}

          <div className="flex items-start gap-2.5 rounded-2xl bg-ink-200/50 p-3.5 text-[0.75rem] leading-5 text-ink-600 dark:bg-ink-900 dark:text-ink-300">
            <ShieldCheck size={17} className="mt-0.5 shrink-0" />
            <span>
              بعد الربط: أي عملية يسجّلها أيٌّ منكما تظهر للطرف الآخر، ولا تُحتسب في الرصيد حتى يؤكّدها الطرف الآخر. لا
              يستطيع من سجّل العملية تأكيدها بنفسه.
            </span>
          </div>

          {error ? (
            <p className="text-center text-[0.8125rem] font-bold text-danger-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="space-y-2">
            <Button block size="lg" loading={busy} icon={<Check size={18} />} onClick={() => void respond(true)}>
              موافقة وإرسال الطلب
            </Button>
            <Button block variant="ghost" icon={<X size={18} />} disabled={busy} onClick={() => void respond(false)}>
              لا أوافق
            </Button>
            <Button
              block
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPreview(null)
                setToken(null)
                setError('')
                setSmartInput('')
              }}
            >
              مسح رمز آخر
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="مسح رمز الربط" />
      <div className="space-y-4 px-4 pt-4">
        <Card className="space-y-3">
          <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-ink-950">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={cameraOn ? 'h-full w-full object-cover' : 'hidden'}
              aria-label="مشهد الكاميرا"
            />
            <canvas ref={canvasRef} className="hidden" />
            {!cameraOn ? (
              <div className="grid h-full w-full place-items-center text-center text-ink-300">
                <div className="px-6">
                  {cameraSupported ? <Camera size={34} className="mx-auto" /> : <CameraOff size={34} className="mx-auto" />}
                  <p className="mt-3 text-[0.8125rem] leading-6">
                    {cameraSupported
                      ? 'اضغط تشغيل الكاميرا ووجّهها نحو رمز QR الظاهر على جهاز التاجر'
                      : 'المسح بالكاميرا غير مدعوم في هذا المتصفح — استخدم الإدخال الذكي أدناه'}
                  </p>
                  {cameraSupported && (
                    <p className="mt-2 flex items-center justify-center gap-1.5 text-[0.6875rem] text-ink-400">
                      <Zap size={12} /> يعمل الآن على جميع المتصفحات (Chrome, Safari, Firefox)
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="pointer-events-none absolute inset-8 rounded-3xl border-4 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
                <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-4">
                  <span className="rounded-full bg-black/70 px-3 py-1.5 text-[0.6875rem] font-bold text-white backdrop-blur">
                    {scanFeedback || 'جاري البحث عن رمز QR...'}
                  </span>
                </div>
              </>
            )}
          </div>

          {cameraSupported ? (
            <Button block variant={cameraOn ? 'ghost' : 'soft'} onClick={() => setCameraOn((v) => !v)}>
              {cameraOn ? 'إيقاف الكاميرا' : 'تشغيل الكاميرا والمسح التلقائي'}
            </Button>
          ) : null}
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center gap-2 text-[0.8125rem] font-bold">
            <Keyboard size={17} /> إدخال ذكي (كود أو رابط)
          </div>
          <p className="text-[0.6875rem] leading-5 text-ink-500">
            الصق هنا أي شيء وصلك من التاجر: الرابط الكامل، أو الكود اليدوي مثل ABCD-EFGH، أو حتى التوكن نفسه. النظام يتعرف تلقائياً.
          </p>
          <Field label="الصق الرابط أو الكود هنا" error={error || undefined}>
            <div className="relative">
              <Input
                value={smartInput}
                onChange={(e) => setSmartInput(e.target.value)}
                placeholder="https://.../#/link/scan?t=... أو ABCD-EFGH-IJKL"
                dir="ltr"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="pe-10 font-mono text-[0.875rem]"
              />
              {smartInput && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText()
                      setSmartInput(text)
                    } catch {
                      // fallback: لا شيء
                    }
                  }}
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
                  title="لصق من الحافظة"
                >
                  <Copy size={16} />
                </button>
              )}
            </div>
          </Field>
          <Button block loading={busy} disabled={!smartInput.trim()} onClick={() => void loadPreview(smartInput)}>
            فحص ومتابعة
          </Button>
          {error && error.includes('السحابي') && (
            <div className="rounded-xl bg-amber-50 p-3 text-[0.75rem] leading-5 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              <strong>ملاحظة مهمة:</strong> أنت تعمل في الوضع المحلي. للربط بين جهازين مختلفين يجب تفعيل الحساب السحابي:
              <br />
              الإعدادات ← الحساب السحابي ← أضف بريدك الإلكتروني
            </div>
          )}
        </Card>

        <p className="px-1 pb-6 text-[0.6875rem] leading-5 text-ink-500">
          لا نطلب أي بيانات مالية هنا. يُعرض اسم التاجر فقط ثم تقرر. الرمز عشوائي، صالح 10 دقائق، ويُستخدم مرة واحدة فقط.
          <br />
          <br />
          <strong>تم إصلاح المسح:</strong> الآن يعمل على جميع المتصفحات (Safari على iPhone، Chrome، Firefox) باستخدام تقنيتين: BarcodeDetector السريع + jsQR كاحتياطي.
        </p>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-ink-100 px-3 py-2 text-[0.75rem] dark:bg-ink-900">
      <span className="text-ink-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}
