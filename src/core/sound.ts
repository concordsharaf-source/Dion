/**
 * أصوات الإتمام — بلا أي ملف صوتي: نُولّد النغمة داخل الجهاز عبر Web Audio.
 * خفيفة، تعمل بلا إنترنت، وتُحترم فيها حالة الكتم التي يختارها المستخدم.
 */

export type FeedbackSound = 'success' | 'pending' | 'error'

export interface Tone {
  /** التردد بالهرتز */
  freq: number
  /** وقت البدء من لحظة التشغيل (ثانية) */
  at: number
  /** مدة النغمة (ثانية) */
  duration: number
  type: OscillatorType
  gain: number
}

export const SOUND_ENABLED_KEY = 'dafatar.sound'
export const SOUND_CHANGE_EVENT = 'dafatar:sound-changed'

/** اكتمال العملية: نغمتان صاعدتان قصيرتان */
const SUCCESS: Tone[] = [
  { freq: 660, at: 0, duration: 0.12, type: 'triangle', gain: 0.16 },
  { freq: 990, at: 0.11, duration: 0.18, type: 'triangle', gain: 0.16 },
]

/** بانتظار تأكيد الطرف الآخر: نغمتان متساويتان هادئتان */
const PENDING: Tone[] = [
  { freq: 520, at: 0, duration: 0.1, type: 'sine', gain: 0.14 },
  { freq: 520, at: 0.16, duration: 0.14, type: 'sine', gain: 0.14 },
]

/** فشل العملية: نغمة واحدة منخفضة */
const ERROR: Tone[] = [{ freq: 196, at: 0, duration: 0.3, type: 'sawtooth', gain: 0.12 }]

/** خطة النغمات لكل نوع — دالة نقية قابلة للاختبار */
export function tonePlan(kind: FeedbackSound): Tone[] {
  switch (kind) {
    case 'success':
      return SUCCESS
    case 'pending':
      return PENDING
    case 'error':
      return ERROR
  }
}

/** هل الأصوات مفعّلة؟ (افتراضيًا نعم، ويُحترم اختيار المستخدم) */
export function readSoundEnabled(): boolean {
  try {
    const stored = window.localStorage.getItem(SOUND_ENABLED_KEY)
    return stored === null ? true : stored === '1'
  } catch {
    return true
  }
}

export function writeSoundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(SOUND_ENABLED_KEY, enabled ? '1' : '0')
    window.dispatchEvent(new Event(SOUND_CHANGE_EVENT))
  } catch {
    /* تخزين غير متاح — نتجاهل */
  }
}

let context: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!ctor) return null
  if (!context) {
    try {
      context = new ctor()
    } catch {
      return null
    }
  }
  if (context.state === 'suspended') void context.resume().catch(() => undefined)
  return context
}

/** يُهيّئ محرّك الصوت عند أول لمسة من المستخدم (شرط المتصفحات لتشغيل الصوت) */
export function primeAudio(): void {
  void getContext()
}

/** نبضة اهتزاز خفيفة على الأجهزة المدعومة (أندرويد) */
function haptic(kind: FeedbackSound): void {
  try {
    if (kind === 'error') navigator.vibrate?.([12, 60, 12])
    else navigator.vibrate?.(14)
  } catch {
    /* غير مدعوم */
  }
}

/**
 * يُشغّل صوت إتمام العملية. لا يرمي أي خطأ أبدًا:
 * الصوت رفاهية، ويجب ألا يُفشل عملية مالية.
 */
export function playFeedback(kind: FeedbackSound): void {
  if (!readSoundEnabled()) return
  haptic(kind)
  try {
    const audio = getContext()
    if (!audio) return
    const start = audio.currentTime
    for (const tone of tonePlan(kind)) {
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      const from = start + tone.at
      oscillator.type = tone.type
      oscillator.frequency.setValueAtTime(tone.freq, from)
      gain.gain.setValueAtTime(0.0001, from)
      gain.gain.exponentialRampToValueAtTime(tone.gain, from + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, from + tone.duration)
      oscillator.connect(gain)
      gain.connect(audio.destination)
      oscillator.start(from)
      oscillator.stop(from + tone.duration + 0.03)
    }
  } catch {
    /* نتجاهل أي فشل في الصوت */
  }
}
