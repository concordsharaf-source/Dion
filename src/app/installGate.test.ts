/**
 * اختبارات بوابة التثبيت (PWA install gatekeeper).
 *
 * الكود المُختبَر هو الملف الذي يُخدَم فعلًا للمتصفح: public/install-gate/app.js
 * (سكربت كلاسيكي بلا وحدة نمطية) — نُقيّمه داخل jsdom ونُقلّب بيئة المتصفح
 * (display-mode / iOS / معامِل ?installgate) ثم نقرأ تأثيره على DOM.
 *
 * ملاحظة ترتيب: نسخة واحدة من السكربت تُقيَّم للملف كله، لذا اختبار
 * beforeinstallprompt يأتي آخرًا (يُبقِي زر التثبيت مُفعّلًا لبقية الاختبارات).
 */

// @vitest-environment-options { "url": "https://dafatar.example.com/" }

import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const appSource = readFileSync('public/install-gate/app.js', 'utf8')
const styleSource = readFileSync('public/install-gate/style.css', 'utf8')
const indexSource = readFileSync('index.html', 'utf8')

interface GateApi {
  refresh: () => unknown
  decide: () => { mode: string; reason: string }
  isStandalone: () => boolean
  isIOS: () => boolean
  isIOSNativeBrowser: () => boolean
  isDevHost: () => boolean
  install: () => void
  skip: () => void
  config: { allowSkip: boolean; skipKey: string; queryParam: string; devHosts: string[] }
}

type WindowWithGate = Window & {
  PwaInstallGate: GateApi
  BeforeInstallPromptEvent?: unknown
  navigator: Navigator & { standalone?: boolean; platform?: string }
}

const win = window as unknown as WindowWithGate

function markup() {
  return `
    <div id="install-screen" role="dialog" aria-modal="true" aria-labelledby="install-title">
      <div class="install-card">
        <h1 id="install-title">ثبّت «دفتر الديون» أولًا</h1>
        <button type="button" id="install-button" data-action="install" hidden><span id="install-button-label">تثبيت التطبيق</span></button>
        <div id="install-ios" hidden></div>
        <div id="install-manual" hidden></div>
        <div id="install-done" hidden></div>
        <p id="install-status" role="status" aria-live="polite" hidden></p>
        <button type="button" id="install-reload" data-action="reload" hidden></button>
        <button type="button" id="install-skip" data-action="skip" hidden></button>
      </div>
    </div>
    <div id="app-content"><div id="root"></div></div>
  `
}

/** display-mode: standalone ⇐ حسب هذا المتغيّر (jsdom لا ينفّذ media queries) */
let standaloneNow = false
let userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
let platform = 'MacIntel'
let maxTouchPoints = 0

function setEnv(next: { standalone?: boolean; ua?: string; platform?: string; maxTouchPoints?: number }) {
  if (next.standalone !== undefined) standaloneNow = next.standalone
  if (next.ua !== undefined) userAgent = next.ua
  if (next.platform !== undefined) platform = next.platform
  if (next.maxTouchPoints !== undefined) maxTouchPoints = next.maxTouchPoints
}

function resetDom() {
  document.documentElement.removeAttribute('data-install-gate')
  document.body.innerHTML = markup()
  win.history.pushState({}, '', '/')
}

function id(idName: string): HTMLElement | null {
  return document.getElementById(idName)
}

function isHidden(idName: string): boolean {
  const node = id(idName)
  return node ? node.hasAttribute('hidden') : true
}

function mode(): string | undefined {
  return document.documentElement.getAttribute('data-install-gate') ?? undefined
}

beforeAll(() => {
  // jsdom بلا matchMedia: نُوفّرها بما يلزم للسكربت (ونميطر عليها standalone)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: /display-mode:\s*standalone/.test(query) && standaloneNow,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
  Object.defineProperty(window.navigator, 'userAgent', { configurable: true, get: () => userAgent })
  Object.defineProperty(window.navigator, 'platform', { configurable: true, get: () => platform })
  Object.defineProperty(window.navigator, 'maxTouchPoints', { configurable: true, get: () => maxTouchPoints })
  // لا navigator.standalone في jsdom (خاصية سفاري على iOS)
  Object.defineProperty(window.navigator, 'standalone', { configurable: true, get: () => undefined })

  resetDom()
  // نُشغّل الملف كما يُشغّله المتصفح (سكربت كلاسيكي)
  new Function(appSource)()
})

afterEach(() => {
  setEnv({ standalone: false, ua: userAgent, platform: 'MacIntel', maxTouchPoints: 0 })
  window.sessionStorage.clear()
})

describe('كشف حالة التطبيق', () => {
  it('في وضع المتصفح: data-install-gate=gate والتطبيق مخفيّ وغير قابل للتركيز', () => {
    resetDom()
    win.PwaInstallGate.refresh()

    expect(mode()).toBe('gate')
    expect(win.PwaInstallGate.decide().reason).toBe('browser')
    expect(id('app-content')?.getAttribute('aria-hidden')).toBe('true')
    expect(id('app-content')?.hasAttribute('inert')).toBe(true)
  })

  it('في وضع standalone: التطبيق يظهر والبوابة تُغلق (display-mode)', () => {
    resetDom()
    setEnv({ standalone: true })
    win.PwaInstallGate.refresh()

    expect(mode()).toBe('app')
    expect(win.PwaInstallGate.isStandalone()).toBe(true)
    expect(id('app-content')?.hasAttribute('aria-hidden')).toBe(false)
    expect(id('app-content')?.hasAttribute('inert')).toBe(false)
  })

  it('iOS: navigator.standalone يُعادل وضع التطبيق المثبّت', () => {
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, get: () => true })
    resetDom()
    win.PwaInstallGate.refresh()

    expect(win.PwaInstallGate.isStandalone()).toBe(true)
    expect(mode()).toBe('app')
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, get: () => undefined })
  })

  it('معامِلا ?installgate=off و ?installgate=force يحسمان القرار', () => {
    resetDom()
    win.history.pushState({}, '', '/?installgate=off')
    win.PwaInstallGate.refresh()
    expect(mode()).toBe('app')
    expect(win.PwaInstallGate.decide().reason).toBe('param')

    win.history.pushState({}, '', '/?installgate=force')
    win.PwaInstallGate.refresh()
    expect(mode()).toBe('gate')

    win.history.pushState({}, '', '/')
    win.PwaInstallGate.refresh()
    expect(mode()).toBe('gate')
  })
})

describe('iOS Safari — تعليمات «إضافة إلى الشاشة الرئيسية»', () => {
  it('يُخفي زر التثبيت ويعرض الخطوات الثلاث', () => {
    resetDom()
    setEnv({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/605.1.15', platform: 'iPhone' })
    win.PwaInstallGate.refresh()

    expect(win.PwaInstallGate.isIOS()).toBe(true)
    expect(win.PwaInstallGate.isIOSNativeBrowser()).toBe(true)
    expect(isHidden('install-button')).toBe(true)
    expect(isHidden('install-ios')).toBe(false)
    expect(id('install-status')?.textContent).toContain('سفاري')
  })

  it('آيباد 13+ (يُبلّغ MacIntel مع لمس متعدد) يُحسب iOS', () => {
    resetDom()
    setEnv({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 })
    win.PwaInstallGate.refresh()

    expect(win.PwaInstallGate.isIOS()).toBe(true)
  })

  it('متصفح داخل تطبيق على iOS (بلا Safari في UA) لا يأخذ خطوات سفاري', () => {
    resetDom()
    setEnv({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', platform: 'iPhone' })
    win.PwaInstallGate.refresh()

    expect(win.PwaInstallGate.isIOSNativeBrowser()).toBe(false)
    expect(isHidden('install-ios')).toBe(false) // الخطوات تبقى المرجع، لكن بلا وعد «سفاري مباشرة»
    expect(id('install-reload')?.hasAttribute('hidden')).toBe(true)
  })
})

describe('المتصفحات بلا beforeinstallprompt والتجاوزات', () => {
  it('سطح مكتب بلا دعم التثبيت: الدليل اليدوي، وبلا رابط تجاوز (البوابة صارمة)', () => {
    resetDom()
    setEnv({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0', platform: 'Win32' })
    win.PwaInstallGate.refresh()

    expect(isHidden('install-manual')).toBe(false)
    expect(isHidden('install-ios')).toBe(true)
    expect(isHidden('install-button')).toBe(true)
    expect(win.PwaInstallGate.config.allowSkip).toBe(false)
    expect(isHidden('install-skip')).toBe(true)
  })

  it('زر «المتابعة دون تثبيت» يحرر التطبيق حتى إعادة الفتح (sessionStorage)', () => {
    resetDom()
    setEnv({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', platform: 'Win32' })
    win.PwaInstallGate.refresh()
    expect(mode()).toBe('gate')

    // في وضع الاستضافة الحقيقي لا يظهر الرابط (allowSkip=false) ⇒ نستدعي القرار يدويًا
    window.sessionStorage.setItem(win.PwaInstallGate.config.skipKey, '1')
    win.PwaInstallGate.refresh()
    expect(mode()).toBe('app')
    expect(win.PwaInstallGate.decide().reason).toBe('skipped')

    window.sessionStorage.removeItem(win.PwaInstallGate.config.skipKey)
    win.PwaInstallGate.refresh()
    expect(mode()).toBe('gate')
  })

  it('في مضيف تطوير يظهر مخرج التجاوز حتى لا تُغلق البوابة على المطوّر', () => {
    resetDom()
    setEnv({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', platform: 'Win32' })
    expect(win.PwaInstallGate.isDevHost()).toBe(false)
    win.PwaInstallGate.refresh()
    expect(isHidden('install-skip')).toBe(true)

    win.PwaInstallGate.config.devHosts = [window.location.host]
    win.PwaInstallGate.refresh()
    expect(win.PwaInstallGate.isDevHost()).toBe(true)
    expect(isHidden('install-skip')).toBe(false)
    expect(id('install-status')?.textContent).toContain('npm run preview')

    win.PwaInstallGate.config.devHosts = []
    win.PwaInstallGate.refresh()
    expect(isHidden('install-skip')).toBe(true)
  })
})

describe('ربط beforeinstallprompt بزر التثبيت', () => {
  it('يُخفي الحدث المؤجَّل الزرَ ويُمكّنه، والنقر يستدعي prompt()', async () => {
    resetDom()
    setEnv({ ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' })

    const promptMock = vi.fn(() => Promise.resolve({ outcome: 'accepted' }))
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, {
      preventDefault: () => {},
      prompt: promptMock,
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    })

    expect(isHidden('install-button')).toBe(true)
    window.dispatchEvent(event)
    expect(isHidden('install-button')).toBe(false)

    id('install-button')?.click()
    await vi.waitFor(() => expect(promptMock).toHaveBeenCalledTimes(1))

    // بعد القبول: لوحة «تم التثبيت» + حالة توجّه المستخدم للأيقونة، والمؤجَّل استُهلك
    await vi.waitFor(() => expect(isHidden('install-done')).toBe(false))
    expect(id('install-status')?.textContent).toContain('تم التثبيت')
    expect(id('install-status')?.textContent).toContain('الشاشة الرئيسية')

    // لا يُعاد استخدام الحدث المؤجَّل (المتصفح يسمح باستخدامه مرة واحدة)
    id('install-button')?.click()
    await new Promise((resolve) => window.setTimeout(resolve, 30))
    expect(promptMock).toHaveBeenCalledTimes(1)
  })
})

describe('الملفات الثابتة (ما يحتاجه HTML/CSS كي تعمل البوابة)', () => {
  it('index.html يحمل الستايل والسكربت ويغلّف التطبيق بـ #app-content', () => {
    expect(indexSource).toContain('/install-gate/style.css')
    expect(indexSource).toContain('<script src="/install-gate/app.js"></script>')
    expect(indexSource).toContain('<div id="app-content">')
    expect(indexSource).toContain('<div id="install-screen"')
    // التصنيف يسبق أول رسم، وReact يُحمَّل بعده
    expect(indexSource.indexOf('data-install-gate')).toBeLessThan(indexSource.indexOf('/src/main.tsx'))
    expect(indexSource.indexOf('/install-gate/app.js')).toBeLessThan(indexSource.indexOf('/src/main.tsx'))
  })

  it('index.html يعرض خطوات iOS الثلاث ونص «إضافة إلى الشاشة الرئيسية»', () => {
    expect(indexSource).toContain('مشاركة')
    expect(indexSource).toContain('إضافة إلى الشاشة الرئيسية')
    expect(indexSource.match(/install-step-num/g)).toHaveLength(3)
  })

  it('style.css يُظهر البوابة ويخفي التطبيق في وضع gate فقط', () => {
    expect(styleSource).toContain("html[data-install-gate='gate'] #app-content")
    expect(styleSource).toContain('display: none !important')
    expect(styleSource).toContain("html[data-install-gate='gate'] #install-screen")
    // بلا JS (أو قبله): لا بوابة ولا إغلاق للتطبيق ⇒ القاعدة الافتراضية آمنة
    expect(styleSource).toMatch(/#install-screen\s*\{\s*display:\s*none/)
  })
})
