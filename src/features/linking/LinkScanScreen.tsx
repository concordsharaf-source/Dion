import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
import { Camera, CameraOff, Check, Keyboard, Link2, ShieldCheck, X } from 'lucide-react'
import { Button, Card, Field, Input, Money, useToast } from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import { useDataSource, useDataSourceKind } from '@/app/DataSourceProvider'
import { useProfile } from '@/app/hooks/useAuth'
import { queryClient, qk } from '@/app/queryClient'
import { formatCountdown } from '@/core/datetime'
import { parseLinkPayload, secondsRemaining } from '@/core/qr'
import { toUserMessage } from '@/core/errors'
import type { LinkPreview } from '@/data/port'

/**
 * مسح رمز الربط (العميل): يُعرض اسم التاجر فقط ثم يقرر العميل الموافقة.
 * بعد الموافقة يبقى الربط معلّقًا حتى يوافق التاجر أيضًا (موافقة الطرفين).
 * يدعم الإدخال اليدوي للرمز عند عدم توفر الكاميرا.
 */
export function LinkScanScreen() {
  const ds = useDataSource()
  const dataSourceKind = useDataSourceKind()
  const navigate = useNavigate()
  const toast = useToast()
  const profile = useProfile()

  const [token, setToken] = useState<string | null>(null)
  const [preview, setPreview] = useState<LinkPreview | null>(null)
  const [code, setCode] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraSupported, setCameraSupported] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scannerRef = useRef<IScannerControls | null>(null)
  const stopRef = useRef(false)

  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia)
    setCameraSupported(supported)
  }, [])

  // كاميرا + مسح مستمر
  useEffect(() => {
    if (!cameraOn || !cameraSupported) return
    let timer = 0
    stopRef.current = false

    async function start() {
      try {
        const reader = new BrowserQRCodeReader()
        if (!videoRef.current) return
        scannerRef.current = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } }, audio: false },
          videoRef.current,
          (result) => {
            if (result && !stopRef.current) {
              stopRef.current = true
              void loadPreview(result.getText())
            }
          },
        )
      } catch {
        setError('لم نتمكن من تشغيل الكاميرا. أدخل الرمز يدويًا.')
        setCameraOn(false)
      }
    }
    void start()

    return () => {
      stopRef.current = true
      window.clearTimeout(timer)
      scannerRef.current?.stop()
      scannerRef.current = null
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, cameraSupported])

  async function loadPreview(raw: string) {
    setBusy(true)
    setError('')
    try {
      if (dataSourceKind === 'local') {
        setError('الربط بين جهازين غير مُفعّل في هذه النسخة. إعداد الخدمة السحابية مطلوب أولًا من صاحب التطبيق.')
        return
      }
      const parsed = parseLinkPayload(raw.trim())
      if (!parsed) {
        setError('الرمز غير صالح أو منتهي الصلاحية. اطلب من التاجر إنشاء رمز جديد.')
        return
      }
      const result = await ds.links.previewInvite(parsed)
      setToken(parsed)
      setPreview(result)
      setCameraOn(false)
    } catch (e) {
      setError(toUserMessage(e))
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
              className={cameraOn ? 'h-full w-full object-cover' : 'hidden'}
              aria-label="مشهد الكاميرا"
            />
            {!cameraOn ? (
              <div className="grid h-full w-full place-items-center text-center text-ink-300">
                <div className="px-6">
                  {cameraSupported ? <Camera size={34} className="mx-auto" /> : <CameraOff size={34} className="mx-auto" />}
                  <p className="mt-3 text-[0.8125rem] leading-6">
                    {cameraSupported
                      ? 'وجّه الكاميرا نحو رمز QR الظاهر على جهاز التاجر'
                      : ' المسح بالكاميرا غير مدعوم في هذا المتصفح — استخدم إدخال الرمز يدويًا'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="pointer-events-none absolute inset-8 rounded-3xl border-4 border-white/70" />
            )}
          </div>

          {cameraSupported ? (
            <Button block variant={cameraOn ? 'ghost' : 'soft'} onClick={() => setCameraOn((v) => !v)}>
              {cameraOn ? 'إيقاف الكاميرا' : 'تشغيل الكاميرا والمسح'}
            </Button>
          ) : null}
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center gap-2 text-[0.8125rem] font-bold">
            <Keyboard size={17} /> إدخال الرمز يدويًا
          </div>
          <Field label="الرمز الظاهر عند التاجر" hint="مثال: 7K9M-2XQP" error={error || undefined}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              dir="ltr"
              autoCapitalize="characters"
              className="text-center font-mono text-lg tracking-[0.3em]"
            />
          </Field>
          <Button block loading={busy} disabled={code.trim().length < 6} onClick={() => void loadPreview(code)}>
            متابعة
          </Button>
        </Card>

        <Card className="space-y-3">
          <Field label="أو الصق رابط الربط" hint="إن وصلك الرابط على واتساب أو رسالة">
            <Input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              dir="ltr"
              placeholder="https://.../#/link/scan?t=..."
            />
          </Field>
          <Button variant="soft" block disabled={!link.trim()} loading={busy} onClick={() => void loadPreview(link)}>
            قراءة الرابط
          </Button>
        </Card>

        <p className="px-1 pb-6 text-[0.6875rem] leading-5 text-ink-500">
          لا نطلب أي بيانات مالية هنا. يُعرض اسم التاجر فقط ثم تقرر. الرمز عشوائي، صالح 10 دقائق، ويُستخدم مرة واحدة فقط.
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
