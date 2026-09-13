import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

export function PageHeader({
  title,
  subtitle,
  back = true,
  actions,
}: {
  title: string
  subtitle?: string
  back?: boolean
  actions?: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <header className="app-bar pt-safe">
      {back ? (
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="رجوع"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-700 transition active:scale-95 hover:bg-ink-200/70 dark:text-ink-200 dark:hover:bg-ink-800"
        >
          <ArrowRight size={22} />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[1.0625rem] font-extrabold leading-tight">{title}</h1>
        {subtitle ? <p className="truncate text-[0.75rem] text-ink-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  )
}
