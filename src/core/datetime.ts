/**
 * التواريخ والأوقات بالعربية — بلا اعتماد على Intl للحصول على نتائج ثابتة
 */

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
]

const DAYS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

export function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

export function isValidDate(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false
  const t = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(t) && !Number.isNaN(new Date(t).getTime())
}

/** 13 سبتمبر 2026 */
export function formatDateAr(value: string | number | Date): string {
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getDate()} ${MONTHS_AR[d.getMonth()]} ${d.getFullYear()}`
}

/** الأحد، 13 سبتمبر */
export function formatDayAndMonth(value: string | number | Date): string {
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return '—'
  return `${DAYS_AR[d.getDay()]}، ${d.getDate()} ${MONTHS_AR[d.getMonth()]}`
}

/** 8:47 م */
export function formatTimeAr(value: string | number | Date): string {
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return ''
  const h24 = d.getHours()
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m} ${h24 < 12 ? 'ص' : 'م'}`
}

export function formatDateTimeAr(value: string | number | Date): string {
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return '—'
  return `${formatDateAr(d)} · ${formatTimeAr(d)}`
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function todayISO(): string {
  return new Date().toISOString()
}

export function startOfToday(): Date {
  return startOfDay(new Date())
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000)
}

/** اليوم · أمس · منذ 5 دقائق · 13 سبتمبر */
export function formatRelativeAr(value: string | number | Date, now: Date = new Date()): string {
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return '—'

  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000)
  if (seconds < 0) return formatDateAr(d)
  if (seconds < 45) return 'الآن'
  if (seconds < 90) return 'منذ دقيقة'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `منذ ${minutes} دقيقة`
  const hours = Math.floor(minutes / 60)
  if (hours < 24 && diffDays(now, d) === 0) return `منذ ${hours} ساعة`

  const days = diffDays(now, d)
  if (days === 1) return 'أمس'
  if (days === 2) return 'قبل يومين'
  if (days <= 7) return `قبل ${days} أيام`
  if (days <= 30) return `قبل ${Math.floor(days / 7)} أسابيع`
  return formatDateAr(d)
}

/** تسمية مجموعة زمنية في سجل العمليات */
export function dayGroupLabel(value: string | number | Date, now: Date = new Date()): string {
  const d = toDate(value)
  const days = diffDays(now, d)
  if (days === 0) return 'اليوم'
  if (days === 1) return 'أمس'
  if (days < 7) return DAYS_AR[d.getDay()]
  return formatDateAr(d)
}

/** أول لحظة في الشهر الحالي */
export function startOfMonth(value: Date = new Date()): string {
  const d = new Date(value.getFullYear(), value.getMonth(), 1)
  return d.toISOString()
}

/** الوقت المنقضي بصيغة 09:32 (لعدّاد صلاحية QR) */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}
