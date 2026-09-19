import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { Check, Copy, Link2, Link2Off, MessageCircle, QrCode, ScanLine, Share2, Timer, X } from 'lucide-react'
import { Button, Card, Chip, EmptyState, Money, SectionTitle, Sheet, Skeletons, useToast } from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import { useDataSource } from '@/app/DataSourceProvider'
import { useProfile } from '@/app/hooks/useAuth'
import { useBalanceProposals, useLinkRequests, useRelationships } from '@/app/hooks/useData'
import { queryClient, qk } from '@/app/queryClient'
import { formatCountdown, formatRelativeAr } from '@/core/datetime'
import { buildLinkUrl, secondsRemaining } from '@/core/qr'
import { toUserMessage } from '@/core/errors'
import type { LinkRequest } from '@/core/domain'

/**
 * مركز الربط — القسم الوحيد الذي يتطلب طرفين.
 * تم تحسينه: الآن يعرض رابط قابل للمشاركة عبر واتساب + نسخ الكود + مشاركة
 */
export function LinkScreen() {
  const ds = useDataSource()
  const navigate = useNavigate()
  const profile = useProfile()
  const toast = useToast()

  const isMerchant = profile.data?.role === 'merchant'
  const requests = useLinkRequests()
  const relationships = useRelationships()
  const proposals = useBalanceProposals()

  const [activeInvite, setActiveInvite] = useState<LinkRequest | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [remaining, setRemaining] = useState(0)
  const [busy, setBusy] = useState(false)

  // عدّاد صلاحية رمز QR
  useEffect(() => {
    if (!activeInvite) return
    const tick = () => {
      const left = secondsRemaining(activeInvite.expiresAt)
      setRemaining(left)
      if (left <= 0) setActiveInvite(null)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [activeInvite])

  useEffect(() => {
    if (!activeInvite) {
      setQrDataUrl('')
      setLinkUrl('')
      return
    }
    const url = buildLinkUrl(activeInvite.token)
    setLinkUrl(url)
    void QRCode.toDataURL(url, {
      width: 640,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b4d3b', light: '#ffffff' },
    }).then(setQrDataUrl)
  }, [activeInvite])

  async function createInvite() {
    setBusy(true)
    try {
      const invite = await ds.links.createInvite()
      setActiveInvite(invite)
      await queryClient.invalidateQueries({ queryKey: qk.linkRequests })
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function respond(id: string, accept: boolean) {
    setBusy(true)
    try {
      if (accept) {
        await ds.links.acceptRequest(id)
        toast.show('تم الربط — أصبحت العمليات بينكما موثّقة')
      } else {
        await ds.links.rejectRequest(id)
        toast.show('تم رفض طلب الربط', 'info')
      }
      await queryClient.invalidateQueries({ queryKey: qk.linkRequests })
      await queryClient.invalidateQueries({ queryKey: qk.relationships })
      await queryClient.invalidateQueries({ queryKey: ['parties'] })
      await queryClient.invalidateQueries({ queryKey: ['entries'] })
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.show(`تم نسخ ${label}`, 'info')
    } catch {
      // fallback
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      toast.show(`تم نسخ ${label}`, 'info')
    }
  }

  function shareViaWhatsApp() {
    if (!linkUrl || !activeInvite) return
    const text = `مرحباً! هذا رابط ربط حسابك معي في دفتر الديون:\n\n${linkUrl}\n\nأو استخدم الكود اليدوي: ${activeInvite.code}\n\nالرمز صالح 10 دقائق فقط. افتح التطبيق ← الربط ← مسح رمز QR ثم الصق الرابط أو الكود.`
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(whatsappUrl, '_blank')
  }

  async function shareLink() {
    if (!linkUrl) return
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'رابط الربط - دفتر الديون',
          text: `رابط ربط حسابك - صالح 10 دقائق. الكود: ${activeInvite?.code}`,
          url: linkUrl,
        })
        return
      } catch {
        // المستخدم ألغى أو فشل
      }
    }
    void copyToClipboard(linkUrl, 'الرابط')
  }

  const pendingRequests = (requests.data ?? []).filter((r) => r.status === 'pending')
  const myInvites = (requests.data ?? []).filter((r) => r.status === 'awaiting_scan' || new Date(r.expiresAt).getTime() > Date.now())
  const activeRelationships = (relationships.data ?? []).filter((r) => r.status === 'verified')
  const pendingProposals = (proposals.data ?? []).filter((p) => p.status === 'pending' && p.proposedBy !== profile.data?.id)

  const totalPending = pendingRequests.length + pendingProposals.length

  return (
    <div className="pb-6">
      <PageHeader title="الربط بين الطرفين" subtitle="اختياري — للتحقق المتبادل" />

      <div className="space-y-4 px-4 pt-4">
        <div className="rounded-2xl bg-brand-50 p-3.5 text-[0.75rem] leading-5 text-brand-800 dark:bg-brand-900/25 dark:text-brand-200">
          الربط اختياري تمامًا. دفترك يعمل كاملًا بدون أي ربط. عند الربط تصبح العمليات بين الطرفين
          <strong> موثّقة</strong>: أي طرف يمكنه التسجيل، لكن لا تدخل العملية في الرصيد المؤكد إلا بعد تأكيد الطرف الآخر.
        </div>

        {totalPending > 0 ? (
          <Card className="border-gold-300 bg-gold-50 dark:bg-gold-900/20">
            <p className="text-[0.8125rem] font-bold text-gold-900 dark:text-gold-100">
              لديك {totalPending} طلب بانتظار قرارك
            </p>
          </Card>
        ) : null}

        {/* التاجر: إنشاء رمز */}
        {isMerchant ? (
          <Card className="space-y-3 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-3xl bg-brand-600 text-white">
              <QrCode size={26} />
            </div>
            <p className="font-extrabold">ربط عميل بحسابه</p>
            <p className="text-[0.75rem] leading-5 text-ink-500">
              أنشئ رمز QR واعرضه للعميل أو أرسله عبر واتساب. الرمز عشوائي، صالح 10 دقائق، ويُستخدم مرة واحدة.
            </p>
            <Button block size="lg" loading={busy} onClick={() => void createInvite()}>
              إنشاء رمز ربط جديد
            </Button>
            {myInvites.length > 0 ? (
              <button
                type="button"
                onClick={() => setActiveInvite(myInvites[0])}
                className="text-[0.75rem] font-bold text-brand-600 underline"
              >
                عرض آخر رمز ({myInvites.length}) - ينتهي بعد {formatCountdown(secondsRemaining(myInvites[0].expiresAt))}
              </button>
            ) : null}
          </Card>
        ) : (
          <Card className="space-y-3 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-3xl bg-brand-600 text-white">
              <ScanLine size={26} />
            </div>
            <p className="font-extrabold">ربط حسابك بتاجر</p>
            <p className="text-[0.75rem] leading-5 text-ink-500">
              امسح رمز QR الظاهر على جهاز التاجر، أو الصق الرابط أو الكود اليدوي الذي أرسله لك. ستظهر لك بيانات التاجر قبل الموافقة.
            </p>
            <Button block size="lg" onClick={() => navigate('/link/scan')}>
              مسح رمز QR أو لصق رابط
            </Button>
          </Card>
        )}

        {/* طلبات بانتظار قراري */}
        {pendingRequests.length > 0 ? (
          <section>
            <SectionTitle>طلبات ربط بانتظارك</SectionTitle>
            <div className="space-y-2.5">
              {pendingRequests.map((r) => (
                <Card key={r.id} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gold-100 text-gold-700 dark:bg-gold-900/40 dark:text-gold-200">
                      <Link2 size={18} />
                    </span>
                    <div className="flex-1">
                      <p className="font-bold">
                        {isMerchant ? r.customerName ?? 'عميل' : r.merchantName ?? 'تاجر'}
                      </p>
                      <p className="text-[0.6875rem] text-ink-500">{formatRelativeAr(r.createdAt)} · {r.status === 'pending' ? 'بانتظار قرارك' : r.status}</p>
                    </div>
                  </div>
                  {isMerchant && r.previousBalanceMinor !== 0 ? (
                    <div className="rounded-xl bg-ink-100 px-3 py-2 text-[0.75rem] dark:bg-ink-900">
                      رصيد سابق مسجّل لدى الطرف الآخر:{' '}
                      <Money minor={r.previousBalanceMinor} currency={profile.data?.currency} className="font-bold" />
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <Button block loading={busy} icon={<Check size={17} />} onClick={() => void respond(r.id, true)}>
                      موافقة
                    </Button>
                    <Button block variant="ghost" icon={<X size={17} />} onClick={() => void respond(r.id, false)} disabled={busy}>
                      رفض
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ) : null}

        {/* اقتراحات الرصيد السابق */}
        {pendingProposals.length > 0 ? (
          <section>
            <SectionTitle>رصيد سابق يحتاج اعتمادك</SectionTitle>
            <div className="space-y-2.5">
              {pendingProposals.map((p) => {
                const rel = activeRelationships.find((r) => r.id === p.relationshipId)
                return (
                  <Card key={p.id} className="space-y-3">
                    <p className="text-[0.8125rem] font-bold">
                      يوجد رصيد سابق مسجّل بقيمة{' '}
                      <Money minor={p.amountMinor} currency={profile.data?.currency} className="font-extrabold" /> لدى{' '}
                      {rel ? (isMerchant ? rel.customerName : rel.merchantName) : 'الطرف الآخر'}
                    </p>
                    <p className="text-[0.75rem] leading-5 text-ink-500">
                      لن يُدمج تلقائيًا. إن وافقت، يُسجَّل قيد افتتاحي مشترك ويصبح جزءًا من الحساب الموثّق. وإن رفضت، يبدأ
                      الحساب المشترك من الصفر ويبقى السجل القديم محفوظًا دون احتساب.
                    </p>
                    <Button block variant="gold" onClick={() => navigate(`/link/${p.relationshipId}`)}>
                      مراجعة واعتماد
                    </Button>
                  </Card>
                )
              })}
            </div>
          </section>
        ) : null}

        {/* العلاقات القائمة */}
        <section>
          <SectionTitle>الحسابات الموثّقة</SectionTitle>
          {relationships.isLoading ? (
            <Skeletons count={2} height={78} />
          ) : activeRelationships.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Link2Off size={24} />}
                title="لا توجد حسابات موثّقة"
                hint="يمكنك استخدام التطبيق بالكامل بدون ربط. الربط يضيف فقط تأكيدًا متبادلًا للعمليات."
              />
            </Card>
          ) : (
            <div className="space-y-2.5">
              {activeRelationships.map((r) => (
                <Link key={r.id} to={`/link/${r.id}`} className="card flex items-center gap-3 p-3.5">
                  <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
                    <Link2 size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">
                      {isMerchant ? r.customerName ?? 'عميل' : r.merchantName ?? 'تاجر'}
                    </span>
                    <span className="text-[0.6875rem] text-ink-500">
                      {r.openingBalanceStatus === 'proposed'
                        ? 'رصيد سابق بانتظار الاعتماد'
                        : r.openingBalanceStatus === 'accepted'
                          ? 'الرصيد السابق معتمد'
                          : r.openingBalanceStatus === 'declined'
                            ? 'بدأ الحساب من تاريخ الربط'
                            : 'حساب موثّق'}
                    </span>
                  </span>
                  {r.openingBalanceStatus === 'proposed' ? <Chip tone="warn">بانتظار</Chip> : <Chip tone="ok">موثّق</Chip>}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* نافذة عرض رمز QR - محسّنة */}
      <Sheet
        open={activeInvite !== null}
        onClose={() => setActiveInvite(null)}
        title="رمز الربط - شاركه مع العميل"
        footer={
          <Button
            block
            variant="ghost"
            onClick={() => {
              if (activeInvite) void ds.links.cancelInvite(activeInvite.id)
              setActiveInvite(null)
              toast.show('تم إلغاء الرمز', 'info')
            }}
          >
            إلغاء الرمز
          </Button>
        }
      >
        {activeInvite ? (
          <div className="space-y-4 pb-2 text-center">
            <div className="mx-auto w-fit rounded-3xl bg-white p-3 shadow-card">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="رمز الربط" width={232} height={232} className="rounded-2xl" />
              ) : (
                <div className="skeleton h-[232px] w-[232px]" />
              )}
            </div>

            <div className="flex items-center justify-center gap-2 text-[0.8125rem] font-bold text-gold-700 dark:text-gold-300">
              <Timer size={16} />
              ينتهي بعد {formatCountdown(remaining)}
            </div>

            {/* الكود اليدوي مع نسخ */}
            <div className="rounded-2xl bg-ink-100 p-3 dark:bg-ink-900">
              <p className="text-[0.6875rem] text-ink-500">الكود اليدوي (للإدخال على جهاز العميل)</p>
              <div className="mt-2 flex items-center justify-center gap-2">
                <p className="select-all font-mono text-[1.1rem] font-bold tracking-wider" dir="ltr">
                  {activeInvite.code}
                </p>
                <Button size="sm" variant="ghost" icon={<Copy size={14} />} onClick={() => void copyToClipboard(activeInvite.code, 'الكود')}>
                  نسخ
                </Button>
              </div>
            </div>

            {/* رابط المشاركة */}
            <div className="space-y-2 rounded-2xl border border-brand-200 bg-brand-50 p-3 dark:border-brand-800 dark:bg-brand-900/20">
              <p className="text-start text-[0.6875rem] font-bold text-brand-800 dark:text-brand-200">رابط الربط (للمشاركة عبر واتساب)</p>
              <p className="break-all rounded-xl bg-white p-2.5 text-start font-mono text-[0.7rem] leading-4 text-ink-700 dark:bg-ink-900 dark:text-ink-300" dir="ltr">
                {linkUrl}
              </p>
              <div className="flex gap-2">
                <Button block size="sm" variant="soft" icon={<Copy size={14} />} onClick={() => void copyToClipboard(linkUrl, 'الرابط')}>
                  نسخ الرابط
                </Button>
                <Button block size="sm" icon={<Share2 size={14} />} onClick={() => void shareLink()}>
                  مشاركة
                </Button>
                <Button block size="sm" variant="gold" icon={<MessageCircle size={14} />} onClick={shareViaWhatsApp}>
                  واتساب
                </Button>
              </div>
            </div>

            <div className="rounded-xl bg-amber-50 p-3 text-start text-[0.6875rem] leading-5 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              <strong>كيف يستخدمه العميل؟</strong>
              <br />
              1. يفتح التطبيق ← الربط ← مسح رمز QR
              <br />
              2. يوجّه الكاميرا للـ QR، أو يلصق الرابط/الكود في الحقل الذكي أدناه
              <br />
              3. يوافق على الربط ← ثم توافق أنت من طلبات الربط
              <br />
              <br />
              <strong>ملاحظة:</strong> للربط بين جهازين مختلفين يجب تفعيل الحساب السحابي من الإعدادات أولاً.
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  )
}
