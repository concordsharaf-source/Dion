import { afterEach, describe, expect, it } from 'vitest'
import { SOUND_CHANGE_EVENT, SOUND_ENABLED_KEY, playFeedback, readSoundEnabled, tonePlan, writeSoundEnabled } from './sound'

afterEach(() => {
  localStorage.clear()
})

describe('صوت إتمام العملية', () => {
  it('نغمة الإتمام صاعدة ونغمة الانتظار نغمتان متساويتان والخطأ نغمة منخفضة', () => {
    const success = tonePlan('success')
    expect(success).toHaveLength(2)
    expect(success[1]!.freq).toBeGreaterThan(success[0]!.freq)

    const pending = tonePlan('pending')
    expect(pending).toHaveLength(2)
    expect(pending[0]!.freq).toBe(pending[1]!.freq)
    expect(pending[1]!.at).toBeGreaterThan(pending[0]!.at)

    const error = tonePlan('error')
    expect(error).toHaveLength(1)
    expect(error[0]!.freq).toBeLessThan(success[0]!.freq)
  })

  it('كل نغمة لها تردد ومدة ومستوى صوت صالح', () => {
    for (const kind of ['success', 'pending', 'error'] as const) {
      for (const tone of tonePlan(kind)) {
        expect(tone.freq).toBeGreaterThan(0)
        expect(tone.duration).toBeGreaterThan(0)
        expect(tone.gain).toBeGreaterThan(0)
        expect(tone.gain).toBeLessThanOrEqual(1)
        expect(tone.at).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('الصوت مفعّل افتراضيًا ويمكن كتمه', () => {
    expect(readSoundEnabled()).toBe(true)

    writeSoundEnabled(false)
    expect(localStorage.getItem(SOUND_ENABLED_KEY)).toBe('0')
    expect(readSoundEnabled()).toBe(false)

    writeSoundEnabled(true)
    expect(readSoundEnabled()).toBe(true)
  })

  it('يُبلّغ بقية الواجهة عند تغيير الإعداد', () => {
    let changed = 0
    const listener = () => {
      changed += 1
    }
    window.addEventListener(SOUND_CHANGE_EVENT, listener)
    writeSoundEnabled(false)
    writeSoundEnabled(true)
    window.removeEventListener(SOUND_CHANGE_EVENT, listener)
    expect(changed).toBe(2)
  })

  it('لا يرمي أي خطأ إن لم يتوفر محرّك الصوت في المتصفح', () => {
    expect(() => playFeedback('success')).not.toThrow()
    writeSoundEnabled(false)
    expect(() => playFeedback('error')).not.toThrow()
  })
})
