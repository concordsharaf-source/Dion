import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Store, User } from 'lucide-react'
import { Button, Card, Field, Input, useToast } from '@/components/ui'
import { useAuth } from '@/app/hooks/useAuth'
import { CURRENCIES, DEFAULT_CURRENCY } from '@/core/money'
import { toUserMessage } from '@/core/errors'
import type { Role } from '@/core/domain'
import { useDataSourceKind } from '@/app/DataSourceProvider'
import { consumePendingRoute } from '@/app/pendingRoute'

/** إتمام الإعداد: الاسم والدور (والعملة) — خطوة واحدة فقط */
export function SetupScreen() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const kind = useDataSourceKind()
  const auth = useAuth()

  const initialRole = (params.get('role') as Role | null) ?? 'customer'
  const [role, setRole] = useState<Role>(initialRole)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (name.trim().length < 2) {
      setError('أدخل الاسم')
      return
    }
    setError('')
    setBusy(true)
    try {
      if (kind === 'local') {
        await auth.quickStart({ fullName: name.trim(), role })
        await auth.updateProfile({ currency })
      } else {
        await auth.createProfile({ fullName: name.trim(), role, currency })
      }
      toast.show('تم إنشاء الدفتر بنجاح')
      navigate(consumePendingRoute(), { replace: true })
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col px-5 pt-safe">
      <div className="py-6 text-center">
        <h1 className="text-xl font-extrabold">مرحبًا بك في دفترك</h1>
        <p className="mt-1 text-[0.8125rem] text-ink-500">خطوة واحدة وتبدأ التسجيل</p>
      </div>

      <div className="space-y-4">
        <Card className="space-y-4">
          <Field label="الاسم" required error={error || undefined} htmlFor="fullname">
            <Input
              id="fullname"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={role === 'merchant' ? 'مثال: متجر النور' : 'مثال: أحمد محمد'}
              maxLength={60}
              autoComplete="name"
            />
          </Field>

          <Field label="نوع الحساب">
            <div className="grid grid-cols-2 gap-3" role="radiogroup">
              {(
                [
                  { value: 'customer', label: 'عميل', icon: User },
                  { value: 'merchant', label: 'تاجر', icon: Store },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={role === opt.value}
                  onClick={() => setRole(opt.value)}
                  className={
                    'flex items-center justify-center gap-2 rounded-2xl border-2 py-3 text-sm font-extrabold transition ' +
                    (role === opt.value
                      ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200'
                      : 'border-ink-200 text-ink-600 dark:border-ink-800 dark:text-ink-300')
                  }
                >
                  <opt.icon size={18} />
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="العملة" hint="يمكن تغييرها لاحقًا من الإعدادات">
            <select className="field" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {Object.values(CURRENCIES).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.symbol})
                </option>
              ))}
            </select>
          </Field>
        </Card>

        <p className="px-1 text-[0.75rem] leading-5 text-ink-500">
          {kind === 'local'
            ? 'يُحفظ الدفتر على هذا الجهاز. لا تحتاج بريدًا إلكترونيًا ولا إنترنت، ولا ربطًا بأي طرف آخر.'
            : 'سيُنشأ ملفك الشخصي في حسابك السحابي وتبدأ التسجيل فورًا.'}
        </p>
      </div>

      <div className="mt-auto space-y-3 pb-8 pt-6">
        <Button block size="lg" loading={busy} onClick={submit}>
          ابدأ الآن
        </Button>
        <Button variant="ghost" block onClick={() => navigate(-1)} disabled={busy}>
          رجوع
        </Button>
      </div>
    </div>
  )
}
