/**
 * لوحة الباترن (3×3) — تُستخدم في الإنشاء والفتح:
 *   · سحب متصل (كأندرويد) على الأجهزة اللمسية
 *   · أو نقر النقاط واحدة بعد أخرى ثم «تأكيد» (للوصولية وللاختبارات)
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { MIN_PATTERN_LENGTH } from '@/core/appLock'

const DOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8]
/** إحداثيات مراكز النقاط داخل مساحة 300×300 */
const CENTERS = DOTS.map((i) => ({ x: 50 + (i % 3) * 100, y: 50 + Math.floor(i / 3) * 100 }))
const HIT_RADIUS = 42

export function PatternPad({
  onComplete,
  status = 'idle',
  disabled = false,
  minLength = MIN_PATTERN_LENGTH,
}: {
  onComplete: (pattern: number[]) => void
  /** idle: عادي · error: اهتزاز/أحمر · ok: أخضر */
  status?: 'idle' | 'error' | 'ok'
  disabled?: boolean
  minLength?: number
}) {
  const [pattern, setPattern] = useState<number[]>([])
  const [dragging, setDragging] = useState(false)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  /** أُكمل الباترن الحالي بالفعل (بانتظار رد الأب) */
  const [done, setDone] = useState(false)
  const padRef = useRef<HTMLDivElement>(null)

  const reset = useCallback(() => {
    setPattern([])
    setDragging(false)
    setPointer(null)
    setDone(false)
  }, [])

  /** بداية باترن جديد (يُفرغ الباترن السابق إن كان مكتملًا) */
  const startFresh = useCallback(() => {
    if (!done) return
    setPattern([])
    setDone(false)
  }, [done])

  // إعادة التهيئة عند كل تغيّر في الحالة (خطأ ⇒ ابدأ من جديد)
  useEffect(() => {
    if (status === 'error' || status === 'ok') reset()
  }, [status, reset])

  const toggle = (index: number) => {
    if (disabled || done) return
    setPattern((current) => {
      if (current.includes(index)) return current.filter((n) => n !== index)
      return [...current, index]
    })
  }

  const finish = () => {
    if (disabled || done) return
    setDragging(false)
    if (pattern.length >= minLength) {
      setDone(true)
      onComplete(pattern)
      return
    }
    setPointer(null)
  }

  /** أقرب نقطة لإحداثيات المؤشر (للسحب) */
  const nearestDot = (clientX: number, clientY: number): number | null => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    const scale = rect.width / 300
    const x = (clientX - rect.left) / scale
    const y = (clientY - rect.top) / scale
    let best: { index: number; distance: number } | null = null
    CENTERS.forEach((center, index) => {
      const distance = Math.hypot(center.x - x, center.y - y)
      if (distance <= HIT_RADIUS && (!best || distance < best.distance)) best = { index, distance }
    })
    return best ? (best as { index: number }).index : null
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || disabled) return
    const rect = padRef.current?.getBoundingClientRect()
    if (rect && rect.width > 0) {
      const scale = rect.width / 300
      setPointer({ x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale })
    }
    const hit = nearestDot(event.clientX, event.clientY)
    if (hit !== null) setPattern((current) => (current.includes(hit) ? current : [...current, hit]))
  }

  const onPointerUp = () => {
    if (!dragging || done) return
    // عند رفع الإصبع يكتمل الباترن تلقائيًا إن كان طويلًا بما يكفي
    setDragging(false)
    setPointer(null)
    if (pattern.length >= minLength) finish()
  }

  const centerOf = (index: number) => CENTERS[index]!
  const lineColor = status === 'error' ? '#dc2626' : status === 'ok' ? '#16a34a' : '#0f9d6e'

  return (
    <div className="select-none">
      <div
        ref={padRef}
        role="group"
        aria-label="لوحة الباترن"
        className="relative mx-auto aspect-square w-full max-w-[17rem] touch-none"
        onPointerDown={(event) => {
          if (disabled || done) return
          startFresh()
          setDragging(true)
          const rect = padRef.current?.getBoundingClientRect()
          if (rect && rect.width > 0) {
            const scale = rect.width / 300
            setPointer({ x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale })
          }
          const hit = nearestDot(event.clientX, event.clientY)
          if (hit !== null) setPattern((current) => (current.includes(hit) ? current : [...current, hit]))
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <svg viewBox="0 0 300 300" className="h-full w-full">
          {pattern.slice(1).map((dot, i) => {
            const from = centerOf(pattern[i]!)
            const to = centerOf(dot)
            return (
              <line
                key={`${pattern[i]}-${dot}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={lineColor}
                strokeWidth={8}
                strokeLinecap="round"
                opacity={0.85}
              />
            )
          })}
          {dragging && pointer && pattern.length > 0 ? (
            <line
              x1={centerOf(pattern[pattern.length - 1]!).x}
              y1={centerOf(pattern[pattern.length - 1]!).y}
              x2={pointer.x}
              y2={pointer.y}
              stroke={lineColor}
              strokeWidth={6}
              strokeLinecap="round"
              opacity={0.45}
            />
          ) : null}
          {DOTS.map((index) => {
            const { x, y } = centerOf(index)
            const active = pattern.includes(index)
            return (
              <circle
                key={index}
                cx={x}
                cy={y}
                r={active ? 16 : 12}
                fill={active ? lineColor : 'transparent'}
                stroke={active ? lineColor : 'currentColor'}
                strokeWidth={active ? 4 : 3}
                className={active ? '' : 'text-ink-300 dark:text-ink-700'}
              />
            )
          })}
        </svg>

        {/* نقاط قابلة للنقر (وصولية + استخدام باللمس المتقطّع) */}
        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
          {DOTS.map((index) => (
            <button
              key={index}
              type="button"
              disabled={disabled}
              aria-label={`نقطة ${index + 1}`}
              aria-pressed={pattern.includes(index)}
              onClick={() => toggle(index)}
              className="h-full w-full rounded-full"
            />
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-2 text-[0.75rem] font-semibold text-ink-500">
        <span>
          {pattern.length === 0
            ? 'اسحب إصبعك على النقاط أو انقرها'
            : `${pattern.length} نقاط${pattern.length < minLength ? ` — ${minLength - pattern.length} على الأقل` : ''}`}
        </span>
        {pattern.length > 0 ? (
          <button type="button" onClick={reset} className="font-bold text-brand-700 dark:text-brand-300">
            مسح
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={finish}
        disabled={disabled || done || pattern.length < minLength}
        className="btn btn-primary mt-3 h-11 w-full text-[0.9375rem] font-extrabold disabled:opacity-50"
      >
        تأكيد الباترن
      </button>
    </div>
  )
}
