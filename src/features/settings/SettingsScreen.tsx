import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BadgeCheck,
  ChevronLeft,
  Cloud,
  Download,
  HardDriveDownload,
  Info,
  Link2,
  Lock,
  LogOut,
  Moon,
  Palette,
  RefreshCw,
  Shield,
  Smartphone,
  Trash2,
  UserCog,
  Volume2,
  VolumeOff,
  WifiOff,
} from 'lucide-react'
import clsx from 'clsx'
import { Avatar, Button, Card, ConfirmDialog, SectionTitle, Sheet, useToast } from '@/components/ui'
import { useAuth, useIsLocalMode, useProfile } from '@/app/hooks/useAuth'
import { useDataSource } from '@/app/DataSourceProvider'
import { useAwaitingCount, useLinkRequests, useSyncState, useUnreadCount } from '@/app/hooks/useData'
import { useTheme, type ThemeMode } from '@/app/theme'
import { CURRENCIES } from '@/core/money'
import { toUserMessage } from '@/core/errors'
import { queryClient, qk } from '@/app/queryClient'
import { playFeedback, readSoundEnabled, writeSoundEnabled } from '@/core/sound'
import { readLockConfig } from '@/core/appLock'
import { DesignerContactCard } from './DesignerContactCard'
import { PushToggle } from './PushToggle'
import { CloudAccountSection } from './CloudAccountSection'

export function SettingsScreen() {
  const navigate = useNavigate()
  const toast = useToast()
  const ds = useDataSource()
  const profile = useProfile()
  const auth = useAuth()
  const local = useIsLocalMode()
  const theme = useTheme()
  const currencySheet = useState(false)

  const [currencyOpen, setCurrencyOpen] = currencySheet
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [sound, setSound] = useState(() => readSoundEnabled())
  // تُقرأ حالة القفل في كل عرض حتى تظهر مباشرة بعد تغييرها من شاشة الأمان
  const lockConfig = readLockConfig()
  const [busy, setBusy] = useState(false)

  const sync = useSyncState()
  const unread = useUnreadCount()
  const awaiting = useAwaitingCount()
  const requests = useLinkRequests()
  const pendingLinks = (requests.data ?? []).filter((r) => r.status === 'pending' || r.status === 'awaiting_scan').length

  const p = profile.data
  if (!p) return <div className="skeleton m-4 h-40" />

  /** تشغيل/كتم صوت إتمام العمليات — مع سماع النغمة فورًا عند التفعيل */
  function toggleSound() {
    const next = !sound
    setSound(next)
    if (next) {
      writeSoundEnabled(true)
      playFeedback('success')
      toast.show('تم تفعيل صوت إتمام العمليات')
    } else {
      playFeedback('pending')
      writeSoundEnabled(false)
      toast.show('تم كتم الأصوات', 'info')
    }
  }

  async function changeCurrency(code: string) {
    setCurrencyOpen(false)
    try {
      await auth.updateProfile({ currency: code })
      toast.show(`تم تغيير العملة إلى ${CURRENCIES[code]?.name ?? code}`)
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    }
  }

  async function resetDevice() {
    setBusy(true)
    try {
      await ds.resetUserData?.()
      queryClient.clear()
      void queryClient.invalidateQueries({ queryKey: qk.session })
      setConfirmReset(false)
      toast.show('تم مسح بيانات هذا المستخدم من الجهاز', 'info')
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    try {
      await auth.signOut()
      setConfirmSignOut(false)
      navigate('/welcome', { replace: true })
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pb-4">
      <header className="app-bar pt-safe">
        <div className="flex-1">
          <h1 className="text-[1.0625rem] font-extrabold">الإعدادات</h1>
          <p className="text-[0.6875rem] text-ink-500">{local ? 'وضع الجهاز — بلا إنترنت' : 'حساب سحابي متزامن'}</p>
        </div>
      </header>

      <div className="space-y-4 px-4 pt-3">
        {/* البطاقة الشخصية */}
        <Link to="/settings/profile" className="card flex items-center gap-3 p-4">
          <Avatar name={p.fullName} className="h-14 w-14 text-xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-extrabold">{p.fullName}</p>
            <p className="text-[0.75rem] text-ink-500">
              {p.role === 'merchant' ? 'حساب تاجر' : 'حساب عميل'} · {CURRENCIES[p.currency]?.name ?? p.currency}
            </p>
            <div className="mt-1 flex items-center gap-2 text-[0.625rem] font-bold text-brand-700 dark:text-brand-300">
              {local ? (
                <>
                  <WifiOff size={11} /> يعمل بلا إنترنت
                </>
              ) : (
                <>
                  <Cloud size={11} /> متزامن
                </>
              )}
            </div>
          </div>
          <ChevronLeft size={20} className="text-ink-400" />
        </Link>

        {/* الحساب */}
        <section>
          <SectionTitle>الحساب</SectionTitle>
          <Card className="divide-y divide-ink-200/70 p-0 dark:divide-ink-800/70">
            <RowLink to="/settings/profile" icon={<UserCog size={18} />} label="الملف الشخصي" hint="الاسم ورقم الهاتف" />
            <RowLink
              to="/settings/security"
              icon={<Shield size={18} />}
              label="الأمان"
              hint={local ? 'جلسة الجهاز' : 'كلمة المرور والجلسة'}
            />
            <RowLink
              to="/settings/security"
              icon={<Lock size={18} />}
              label="قفل التطبيق"
              hint={
                lockConfig.mode === 'off'
                  ? 'غير مفعّل — فعّله بالبصمة أو الباترن'
                  : lockConfig.mode === 'biometric'
                    ? 'مفعّل بالبصمة'
                    : 'مفعّل بالباترن'
              }
            />
            <RowLink
              to="/settings/sync"
              icon={<RefreshCw size={18} />}
              label="حالة المزامنة"
              hint={
                local
                  ? 'محلي — بلا خادم'
                  : sync.data
                    ? sync.data.pendingCount > 0
                      ? `${sync.data.pendingCount} بانتظار الإرسال`
                      : 'كل شيء مُرسل'
                    : 'جارٍ الفحص'
              }
            />
          </Card>
        </section>

        {/* التفضيلات */}
        <section>
          <SectionTitle>التفضيلات</SectionTitle>
          <Card className="divide-y divide-ink-200/70 p-0 dark:divide-ink-800/70">
            <button
              type="button"
              onClick={() => setCurrencyOpen(true)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-start"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-200/70 text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                <BadgeCheck size={18} />
              </span>
              <span className="flex-1">
                <span className="block font-bold">العملة</span>
                <span className="block text-[0.6875rem] text-ink-500">
                  {CURRENCIES[p.currency]?.name ?? p.currency} ({CURRENCIES[p.currency]?.symbol ?? p.currency})
                </span>
              </span>
              <ChevronLeft size={18} className="text-ink-400" />
            </button>

            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-200/70 text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                <Palette size={18} />
              </span>
              <span className="flex-1">
                <span className="block font-bold">المظهر</span>
                <span className="block text-[0.6875rem] text-ink-500">
                  {theme.mode === 'system' ? 'حسب النظام' : theme.mode === 'dark' ? 'داكن' : 'فاتح'}
                </span>
              </span>
              <div className="flex gap-1 rounded-xl bg-ink-200/70 p-1 dark:bg-ink-800">
                {(['system', 'light', 'dark'] as ThemeMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => theme.setMode(m)}
                    className={clsx(
                      'rounded-lg px-2.5 py-1 text-[0.6875rem] font-bold transition',
                      theme.mode === m ? 'bg-white text-brand-700 shadow-sm dark:bg-ink-950 dark:text-brand-300' : 'text-ink-500',
                    )}
                  >
                    {m === 'system' ? 'تلقائي' : m === 'dark' ? 'داكن' : 'فاتح'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-200/70 text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                <Moon size={18} />
              </span>
              <span className="flex-1">
                <span className="block font-bold">الأرقام</span>
                <span className="block text-[0.6875rem] text-ink-500">
                  {p.numerals === 'arabic' ? 'أرقام عربية (١٢٣)' : 'أرقام لاتينية (123)'}
                </span>
              </span>
              <button
                type="button"
                onClick={() =>
                  void auth.updateProfile({ numerals: p.numerals === 'arabic' ? 'latin' : 'arabic' }).catch(() => undefined)
                }
                className="rounded-xl bg-ink-200/70 px-3 py-1.5 text-[0.6875rem] font-bold text-ink-700 dark:bg-ink-800 dark:text-ink-200"
              >
                تبديل
              </button>
            </div>

            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-200/70 text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                {sound ? <Volume2 size={18} /> : <VolumeOff size={18} />}
              </span>
              <span className="flex-1">
                <span className="block font-bold">صوت إتمام العملية</span>
                <span className="block text-[0.6875rem] text-ink-500">
                  {sound ? 'نغمة قصيرة عند اكتمال كل عملية' : 'مكتوم'}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={sound}
                aria-label="صوت إتمام العملية"
                onClick={toggleSound}
                className={clsx('relative h-7 w-12 shrink-0 rounded-full transition', sound ? 'bg-brand-600' : 'bg-ink-300 dark:bg-ink-700')}
              >
                <span className={clsx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', sound ? 'start-1' : 'start-6')} />
              </button>
            </div>

            <PushToggle />
          </Card>
        </section>

        {/* الحساب السحابي (يظهر فقط إذا كانت مفاتيح المشروع مضبوطة) */}
        <CloudAccountSection />

        {/* المشاركة */}
        <section>
          <SectionTitle>المشاركة بين الطرفين</SectionTitle>
          <Card className="divide-y divide-ink-200/70 p-0 dark:divide-ink-800/70">
            <RowLink
              to="/link"
              icon={<Link2 size={18} />}
              label="مركز الربط"
              hint={pendingLinks > 0 ? `${pendingLinks} طلب` : 'ربط اختياري مع تاجر/عميل'}
              badge={pendingLinks}
            />
            <RowLink
              to="/entries?filter=awaiting_me"
              icon={<BadgeCheck size={18} />}
              label="بانتظار تأكيدي"
              hint="عمليات سجّلها الطرف الآخر"
              badge={awaiting.data ?? 0}
            />
            <RowLink
              to="/notifications"
              icon={<Info size={18} />}
              label="الإشعارات"
              hint="سجل التنبيهات"
              badge={unread.data ?? 0}
            />
          </Card>
        </section>

        {/* البيانات */}
        <section>
          <SectionTitle>البيانات</SectionTitle>
          <Card className="divide-y divide-ink-200/70 p-0 dark:divide-ink-800/70">
            <Link to="/settings/backup" className="flex items-center gap-3 px-4 py-3.5 text-start" aria-label="النسخة الاحتياطية">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-200/70 text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                <Download size={18} />
              </span>
              <span className="flex-1">
                <span className="block font-bold">النسخة الاحتياطية</span>
                <span className="block text-[0.6875rem] text-ink-500">
                  نسخة واحدة دائمًا{p.role === 'merchant' ? ' — تلقائيًا كل نهاية يوم' : ''}
                </span>
              </span>
              <ChevronLeft size={18} className="text-ink-400" />
            </Link>
            <Link
              to="/settings/privacy"
              className="flex items-center gap-3 px-4 py-3.5 text-start"
              aria-label="سياسة الخصوصية"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-200/70 text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                <Shield size={18} />
              </span>
              <span className="flex-1">
                <span className="block font-bold">الخصوصية والأمان</span>
                <span className="block text-[0.6875rem] text-ink-500">كيف نحمي بياناتك</span>
              </span>
              <ChevronLeft size={18} className="text-ink-400" />
            </Link>
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-start text-danger-600"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-danger-100 dark:bg-danger-500/20">
                <Trash2 size={18} />
              </span>
              <span className="flex-1">
                <span className="block font-bold">مسح بياناتي من هذا الجهاز</span>
                <span className="block text-[0.6875rem] text-ink-500">لا يمكن استرجاعها بعد المسح</span>
              </span>
            </button>
          </Card>
        </section>

        {/* عن التطبيق */}
        <section>
          <SectionTitle>عن التطبيق</SectionTitle>
          <Card className="divide-y divide-ink-200/70 p-0 dark:divide-ink-800/70">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
                <Smartphone size={18} />
              </span>
              <span className="flex-1">
                <span className="block font-bold">دفتر الديون</span>
                <span className="block text-[0.6875rem] text-ink-500">الإصدار 1.0.0 · يعمل بلا إنترنت</span>
              </span>
            </div>
            <div className="px-4 py-3.5 text-[0.75rem] leading-5 text-ink-500">
              دفتر بسيط لإدارة الديون والسداد. يمكنك استخدامه وحدك، أو ربط حسابك مع طرف آخر للتحقق المتبادل.
            </div>
          </Card>
        </section>

        <Button
          block
          variant="ghost"
          className="text-danger-600"
          icon={<LogOut size={17} />}
          onClick={() => setConfirmSignOut(true)}
        >
          {local ? 'تسجيل الخروج من هذا الجهاز' : 'تسجيل الخروج'}
        </Button>

        <div className="flex items-center justify-center gap-2 pb-4 text-[0.625rem] text-ink-400">
          <HardDriveDownload size={12} /> {local ? 'التخزين: IndexedDB على جهازك' : 'التخزين: خادم آمن + نسخة محلية'}
        </div>

        {/* أسفل الإعدادات: تواصل مع المصمم */}
        <DesignerContactCard />
      </div>

      {/* اختيار العملة */}
      <Sheet open={currencyOpen} onClose={() => setCurrencyOpen(false)} title="اختيار العملة">
        <div className="space-y-2 pb-2">
          {Object.values(CURRENCIES).map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => void changeCurrency(c.code)}
              className={clsx(
                'flex w-full items-center justify-between rounded-2xl border-2 px-4 py-3 text-start transition',
                p.currency === c.code
                  ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/30'
                  : 'border-transparent bg-ink-100 dark:bg-ink-900',
              )}
            >
              <span>
                <span className="block font-bold">{c.name}</span>
                <span className="block text-[0.6875rem] text-ink-500">
                  {c.code} · {c.decimals === 0 ? 'بدون كسور' : `${c.decimals} كسور`}
                </span>
              </span>
              <span className="font-mono text-lg font-bold text-ink-500">{c.symbol}</span>
            </button>
          ))}
          <p className="px-1 pt-1 text-[0.6875rem] leading-5 text-ink-500">
            العملة إعداد عرض فقط — كل الحسابات مخزّنة بأرقام دقيقة (وحدات صغرى) ولا تتأثر بتغيير العملة.
          </p>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmReset}
        title="مسح بياناتي من هذا الجهاز"
        message="سيتم حذف السجلات والعمليات والإشعارات الخاصة بحسابك على هذا الجهاز. لا يمكن التراجع. تأكد من تنزيل نسخة احتياطية إن أردت."
        confirmLabel="مسح نهائي"
        tone="danger"
        loading={busy}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => void resetDevice()}
      />

      <ConfirmDialog
        open={confirmSignOut}
        title="تسجيل الخروج"
        message={local ? 'ستحتاج إلى تسجيل الدخول مرة أخرى للوصول إلى دفترك على هذا الجهاز.' : 'سيتم الخروج من حسابك.'}
        confirmLabel="خروج"
        tone="danger"
        loading={busy}
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => void signOut()}
      />
    </div>
  )
}

function RowLink({
  to,
  icon,
  label,
  hint,
  badge = 0,
}: {
  to: string
  icon: React.ReactNode
  label: string
  hint?: string
  badge?: number
}) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-200/70 text-ink-600 dark:bg-ink-800 dark:text-ink-300">
        {icon}
      </span>
      <span className="flex-1">
        <span className="block font-bold">{label}</span>
        {hint ? <span className="block text-[0.6875rem] text-ink-500">{hint}</span> : null}
      </span>
      {badge > 0 ? (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-danger-500 px-1.5 text-[0.625rem] font-extrabold text-white">
          {badge}
        </span>
      ) : null}
      <ChevronLeft size={18} className="text-ink-400" />
    </Link>
  )
}
