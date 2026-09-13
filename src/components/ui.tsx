/**
 * مكتبة مكوّنات الواجهة — تصميم عربي حديث، أزرار كبيرة، لمس مريح
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'
import { formatAmount, getCurrency } from '@/core/money'
import type { EntryStatus, FinancialEntry } from '@/core/domain'

/* ============================ أزرار ============================ */

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'soft' | 'gold'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'md' | 'lg' | 'sm'
  loading?: boolean
  block?: boolean
  icon?: ReactNode
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  soft: 'btn-soft',
  gold: 'bg-gold-400 text-ink-900 hover:bg-gold-300',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  icon,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        'btn',
        VARIANTS[variant],
        size === 'lg' && 'min-h-[3.25rem] text-base',
        size === 'sm' && 'min-h-[2.25rem] px-3 text-[0.8125rem] rounded-xl',
        block && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={18} /> : icon}
      {children}
    </button>
  )
}

export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span
      className={clsx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', className)}
      style={{ width: size, height: size }}
      role="status"
      aria-label="جارٍ التحميل"
    />
  )
}

export function IconButton({
  label,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={clsx(
        'grid h-10 w-10 place-items-center rounded-full text-ink-600 transition active:scale-95',
        'hover:bg-ink-200/70 dark:text-ink-300 dark:hover:bg-ink-800',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ============================ المال ============================ */

export function Money({
  minor,
  currency = 'YER',
  numerals = 'latin',
  signed = false,
  className,
  showSymbol = true,
}: {
  minor: number
  currency?: string
  numerals?: 'latin' | 'arabic'
  signed?: boolean
  className?: string
  showSymbol?: boolean
}) {
  return (
    <span className={clsx('tnum', className)} dir="ltr" style={{ unicodeBidi: 'isolate' }}>
      {formatAmount(minor, getCurrency(currency), { numerals, signed, withSymbol: showSymbol })}
    </span>
  )
}

/* ============================ بطاقات وإطارات ============================ */

export function Card({
  children,
  className,
  as: Tag = 'div',
  ...rest
}: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'li' } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={clsx('card p-4', className)} {...rest}>
      {children}
    </Tag>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1 pb-2">
      <h2 className="text-[0.9375rem] font-bold text-ink-800 dark:text-ink-100">{children}</h2>
      {action}
    </div>
  )
}

/* ============================ الحالات ============================ */

const STATUS_STYLE: Record<EntryStatus, { label: string; className: string }> = {
  pending: { label: 'بانتظار التأكيد', className: 'bg-gold-100 text-gold-800 dark:bg-gold-900/40 dark:text-gold-200' },
  confirmed: { label: 'مؤكدة', className: 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200' },
  rejected: { label: 'مرفوضة', className: 'bg-danger-100 text-danger-700 dark:bg-danger-500/20 dark:text-danger-100' },
  cancelled: { label: 'ملغاة', className: 'bg-ink-200 text-ink-600 dark:bg-ink-800 dark:text-ink-300' },
}

export function StatusChip({ status }: { status: EntryStatus }) {
  const s = STATUS_STYLE[status]
  return <span className={clsx('chip', s.className)}>{s.label}</span>
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'info' }) {
  const tones = {
    neutral: 'bg-ink-200 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
    ok: 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200',
    warn: 'bg-gold-100 text-gold-800 dark:bg-gold-900/40 dark:text-gold-200',
    danger: 'bg-danger-100 text-danger-700 dark:bg-danger-500/20 dark:text-danger-100',
    info: 'bg-info-50 text-info-600 dark:bg-info-500/20 dark:text-info-500',
  } as const
  return <span className={clsx('chip', tones[tone])}>{children}</span>
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-3xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
        {icon}
      </div>
      <p className="text-base font-bold text-ink-800 dark:text-ink-100">{title}</p>
      {hint ? <p className="max-w-[22rem] text-sm leading-6 text-ink-500">{hint}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  )
}

export function Skeletons({ count = 3, height = 76 }: { count?: number; height?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  )
}

/* ============================ حقول الإدخال ============================ */

export function Field({
  label,
  hint,
  error,
  required,
  children,
  htmlFor,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[0.8125rem] font-bold text-ink-700 dark:text-ink-200">
        {label}
        {required ? <span className="text-danger-500"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-[0.75rem] font-semibold text-danger-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[0.75rem] text-ink-500">{hint}</p>
      ) : null}
    </div>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx('field', className)} {...rest} />
}

/* ============================ الأوراق المنبثقة (Bottom Sheet) ============================ */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'auto',
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'auto' | 'tall'
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-ink-950/50 backdrop-blur-[2px] fade-in"
      />
      <div
        ref={ref}
        tabIndex={-1}
        className={clsx(
          'sheet relative z-10 w-full max-w-[30rem] bg-ink-50 outline-none rise dark:bg-ink-950',
          size === 'tall' ? 'max-h-[92dvh]' : 'max-h-[88dvh]',
          'flex flex-col',
        )}
        style={{ animation: 'sheet-up 0.24s cubic-bezier(0.2, 0.8, 0.2, 1)' }}
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-5">
          <div className="mx-auto absolute inset-x-0 top-2 h-1 w-10 rounded-full bg-ink-300 dark:bg-ink-700" />
          <h3 className="text-base font-extrabold">{title}</h3>
          <IconButton label="إغلاق" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer ? <div className="border-t border-ink-200 px-5 py-4 pb-safe dark:border-ink-800">{footer}</div> : null}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'رجوع',
  tone = 'primary',
  loading = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: ButtonVariant
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <div className="flex gap-3">
          <Button variant="ghost" block onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone} block loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {message ? <p className="pb-3 text-sm leading-6 text-ink-600 dark:text-ink-300">{message}</p> : null}
      {children}
    </Sheet>
  )
}

/* ============================ التنبيهات السريعة (Toast) ============================ */

interface ToastItem {
  id: number
  message: string
  tone: 'ok' | 'error' | 'info'
}

interface ToastCtx {
  show: (message: string, tone?: ToastItem['tone']) => void
}

const ToastContext = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const show = useCallback((message: string, tone: ToastItem['tone'] = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, message, tone }])
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3600)
  }, [])

  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto max-w-[26rem] rounded-2xl px-4 py-3 text-sm font-bold text-white shadow-float rise',
              t.tone === 'ok' && 'bg-brand-600',
              t.tone === 'error' && 'bg-danger-500',
              t.tone === 'info' && 'bg-ink-800',
            )}
            role="status"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastCtx {
  const ctx = useContext(ToastContext)
  return ctx ?? { show: () => undefined }
}

/* ============================ مكوّنات مساعدة ============================ */

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initial = name.trim().charAt(0) || '؟'
  const palette = ['bg-brand-600', 'bg-gold-500', 'bg-info-600', 'bg-danger-500']
  const color = palette[name.length % palette.length]
  return (
    <span
      className={clsx('grid shrink-0 place-items-center rounded-2xl text-white font-extrabold', color, className)}
      aria-hidden
    >
      {initial}
    </span>
  )
}

/** وصف مختصر للعملية من منظور المستخدم */
export function entryTitle(entry: FinancialEntry, viewerId: string): string {
  const mine = entry.creatorId === viewerId
  if (entry.entryKind === 'opening') return 'رصيد سابق معتمد'
  if (entry.entryKind === 'reversal') return 'قيد عكسي'
  if (entry.entryType === 'debt') return mine ? 'دين سجّلته' : 'دين سُجّل عليك'
  return mine ? 'سداد سجّلته' : 'سداد مسجّل'
}
