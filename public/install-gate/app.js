/* =============================================================================
   بوابة التثبيت (PWA Install Gatekeeper) — JavaScript قياسي بلا أي مكتبة
   -----------------------------------------------------------------------------
   1) كشف حالة التطبيق: standalone؟ (display-mode: standalone / navigator.standalone)
        · نعم  ⇒ إظهار #app-content وإخفاء #install-screen
        · لا   ⇒ إخفاء #app-content وإظهار #install-screen
   2) أندرويد/سطح المكتب (كروم، إيدج، بريف): يلتقط beforeinstallprompt ويربطه
      بزر «تثبيت التطبيق» داخل #install-screen.
   3) iOS Safari (آيفون/آيباد): لا يوجد beforeinstallprompt ⇒ يُخفى الزر وتظهر
      ثلاث خطوات: «مشاركة» ← «إضافة إلى الشاشة الرئيسية» ← «إضافة» ثم الفتح من
      الشاشة الرئيسية.

   مبادئ أمان التجربة:
   · أي استثناء/فشل ⇒ التطبيق يعمل (البوابة وسيلة، لا سدّ باب الدفتر).
   · إعادة التصنيف تحدث عند «الدخول» فقط (فتح الصفحة، الرجوع للتبويب، تغيّر
     display-mode، نجاح التثبيت) — لا نوافذ منبثقة ولا تذكير أثناء الاستخدام.
   · المفاتيح: ?installgate=off  (تجاهل البوابة)  · ?installgate=force (اختبارها)
   ============================================================================= */

;(function (global) {
  'use strict'

  var doc = global.document

  var CONFIG = {
    /** false ⇒ البوابة صارمة كما هو مطلوب: لا مخرج في وضع المتصفح */
    allowSkip: false,
    /** يُخزَّن في sessionStorage بعد «المتابعة دون تثبيت» حتى لا نُعاود منع التحميل */
    skipKey: 'dafatar.install-gate-skip',
    queryParam: 'installgate',
    /** كل display-mode يُعدّ «تطبيقًا مثبتًا مفتوحًا من أيقونته» */
    standaloneDisplayModes: ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'],
    /** مدة السماح قبل إعادة التحميل التلقائي بعد قبول التثبيت (مللي ثانية) */
    reloadAfterAcceptMs: 1200,
    /** مضيفات تُعامل كمضيف تطوير (يظهر فيها مخرج «المتابعة في المتصفح») */
    devHosts: []
  }

  var IDS = {
    gate: 'install-screen',
    app: 'app-content',
    button: 'install-button',
    buttonLabel: 'install-button-label',
    ios: 'install-ios',
    manual: 'install-manual',
    done: 'install-done',
    status: 'install-status',
    reload: 'install-reload',
    skip: 'install-skip'
  }

  /** الحدث المؤجَّل من beforeinstallprompt — لا يُستخدم إلا مرة واحدة */
  var deferredPrompt = null
  var installed = false
  var listenersBound = false

  /* ================================ أدوات ================================ */

  function el(id) {
    return doc.getElementById(id)
  }

  function mediaMatches(query) {
    try {
      return typeof global.matchMedia === 'function' && global.matchMedia(query).matches === true
    } catch (e) {
      return false
    }
  }

  function store(key, value) {
    try {
      var s = global.sessionStorage
      if (value === null) s.removeItem(key)
      else s.setItem(key, value)
    } catch (e) {
      /* وضع تصفح خاص/محجوب — نتجاهل بهدوء */
    }
  }

  function read(key) {
    try {
      return global.sessionStorage.getItem(key)
    } catch (e) {
      return null
    }
  }

  function queryFlag() {
    try {
      return new URLSearchParams(global.location.search).get(CONFIG.queryParam)
    } catch (e) {
      return null
    }
  }

  function onMediaChange(query, handler) {
    try {
      var mql = global.matchMedia(query)
      if (!mql) return
      if (typeof mql.addEventListener === 'function') mql.addEventListener('change', handler)
      else if (typeof mql.addListener === 'function') mql.addListener(handler)
    } catch (e) {
      /* متصفح قديم بلا matchMedia — لا مشكلة: نُصنّف عند كل دخول */
    }
  }

  /* ============================ 1) كشف الحالة ============================ */

  /** هل التطبيق مفتوح كنسخة مثبّتة (standalone)؟ */
  function isStandalone() {
    if (global.navigator && global.navigator.standalone === true) return true // iOS
    var modes = CONFIG.standaloneDisplayModes
    for (var i = 0; i < modes.length; i += 1) {
      if (mediaMatches('(display-mode: ' + modes[i] + ')')) return true
    }
    return false
  }

  /** iOS (بما فيه iPadOS 13+ الذي يُبلّغ عن نفسه كـ MacIntel) */
  function isIOS() {
    var nav = global.navigator || {}
    var platform = nav.platform || ''
    var maxTouch = nav.maxTouchPoints || 0
    if (/iPad|iPhone|iPod/.test(platform)) return true
    if (platform === 'MacIntel' && maxTouch > 1) return true
    return /iPad|iPhone|iPod/.test(nav.userAgent || '')
  }

  /**
   * سفاري على iOS — لا يدعم beforeinstallprompt نهائيًا (كل متصفحات iOS محرّكها
   * WebKit، لذا نميّز سفاري بوسم Version/…Safari ونستبعد CriOS/FxiOS/…
   * والمتصفحات داخل التطبيقات التي لا تحمل الوسم).
   */
  function isIOSNativeBrowser() {
    var ua = (global.navigator && global.navigator.userAgent) || ''
    var otherEngine = /CriOS|FxiOS|EdgiOS|OPiOS|Android|Chrome\//.test(ua)
    var safariToken = /Version\/[\d._]+/.test(ua) && /Safari/.test(ua)
    return isIOS() && safariToken && !otherEngine
  }

  /** هل المتصفح يوفّر حدث التثبيت القياسي؟ */
  function supportsBeforeInstallPrompt() {
    return typeof global.BeforeInstallPromptEvent === 'function'
  }

  /** مضيف تطوير؟ (منفذ Vite/Preview أو مضيف في CONFIG.devHosts) */
  function isDevHost() {
    var loc = global.location || {}
    var host = loc.host || loc.hostname || ''
    var list = CONFIG.devHosts || []
    for (var i = 0; i < list.length; i += 1) {
      if (host === list[i]) return true
    }
    return host === '' || /^localhost(:\d+)?$/.test(host) || /^127\.0\.0\.1(:\d+)?$/.test(host) || /:\d*(5173|4173)$/.test(host) || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(host)
  }

  /** القرار النهائي: 'gate' (وضع المتصفح) أم 'app' (تطبيق مثبّت/تجاوز) */
  function decide() {
    var flag = queryFlag()
    if (flag === 'off' || flag === 'skip') return { mode: 'app', reason: 'param' }
    if (flag === 'force') return { mode: 'gate', reason: 'force' }
    if (isStandalone()) return { mode: 'app', reason: 'standalone' }
    if (read(CONFIG.skipKey) === '1') return { mode: 'app', reason: 'skipped' }
    return { mode: 'gate', reason: 'browser' }
  }

  /* ====================== 2) + 3) رسم شاشة التثبيت ====================== */

  function setNode(node, visible) {
    if (!node) return
    if (visible) node.removeAttribute('hidden')
    else node.setAttribute('hidden', '')
  }

  function say(message) {
    var status = el(IDS.status)
    if (!status) return
    status.textContent = message || ''
    setNode(status, Boolean(message))
  }

  function apply() {
    var root = doc.documentElement
    var decision = decide()
    var gating = decision.mode === 'gate'

    root.setAttribute('data-install-gate', gating ? 'gate' : 'app')

    var gate = el(IDS.gate)
    var app = el(IDS.app)
    if (gating) {
      if (app) {
        app.setAttribute('aria-hidden', 'true')
        app.setAttribute('inert', '')
        try {
          app.inert = true
        } catch (e) {}
      }
      if (gate && typeof gate.focus === 'function') {
        try {
          gate.setAttribute('tabindex', '-1')
        } catch (e) {}
      }
    } else if (app) {
      app.removeAttribute('aria-hidden')
      app.removeAttribute('inert')
      try {
        app.inert = false
      } catch (e) {}
    }

    if (!gating) return decision

    renderPanel()
    return decision
  }

  /** أي لوحة نعرض: زر التثبيت (كروم/إيدج/بريف) أم خطوات iOS أم دليل يدوي */
  function renderPanel() {
    var button = el(IDS.button)
    var label = el(IDS.buttonLabel)
    var manual = el(IDS.manual)
    var ios = el(IDS.ios)
    var done = el(IDS.done)
    var reload = el(IDS.reload)

    var canInstall = Boolean(deferredPrompt) || supportsBeforeInstallPrompt()
    var showIosSteps = isIOS() && !canInstall
    var nativeIos = isIOSNativeBrowser()

    setNode(button, Boolean(deferredPrompt))
    setNode(ios, showIosSteps)
    setNode(manual, !canInstall && !showIosSteps)
    setNode(done, installed)
    setNode(reload, installed || (showIosSteps && nativeIos))
    setNode(el(IDS.skip), CONFIG.allowSkip || isDevHost())

    if (label) label.textContent = installed ? 'متابعة التثبيت' : 'تثبيت التطبيق'

    if (installed) {
      say('تم التثبيت — افتح الدفتر من أيقونته في الشاشة الرئيسية.')
      return
    }
    if (deferredPrompt) {
      say('تثبيت لمسة واحدة: بياناتك تبقى على جهازك.')
      return
    }
    if (showIosSteps) {
      say(nativeIos ? 'على سفاري: الخطوات بالأسفل تعمل مباشرة.' : 'من متصفح النظام (سفاري) تُضاف الأيقونة إلى الشاشة الرئيسية.')
      return
    }
    if (isDevHost()) {
      say('وضع تطوير: لا manifest/service worker ⇒ لا beforeinstallprompt. جرّب npm run build && npm run preview.')
      return
    }
    say('هذا المتصفح لا يعرض زر التثبيت — استخدم القائمة اليدوية بالأسفل.')
  }

  /* ==================== 2) ربط beforeinstallprompt ==================== */

  function captureBeforeInstallPrompt(event) {
    // نمنع الشريط/البانر الافتراضي للمتصفح ونمسك الحدث لزرّنا
    if (typeof event.preventDefault === 'function') event.preventDefault()
    deferredPrompt = event
    renderPanel()
  }

  function installNow() {
    if (!deferredPrompt || typeof deferredPrompt.prompt !== 'function') return
    var button = el(IDS.button)
    if (button) button.setAttribute('disabled', '')
    say('جارٍ عرض نافذة التثبيت…')

    try {
      var result = deferredPrompt.prompt()
      if (result && typeof result.then === 'function') {
        result
          .then(function (choice) {
            var outcome = (choice && choice.outcome) || 'unknown'
            deferredPrompt = null
            if (outcome === 'accepted') {
              installed = true
              say('قُبل التثبيت — سيُفتح التطبيق من الشاشة الرئيسية.')
              global.setTimeout(function () {
                apply()
              }, CONFIG.reloadAfterAcceptMs)
            } else {
              say('أُلغي طلب التثبيت — يمكنك المحاولة مرة أخرى في أي وقت.')
            }
          })
          .catch(function () {
            say('تعذّر إكمال التثبيت — استخدم القائمة اليدوية.')
          })
          .then(function () {
            if (button) button.removeAttribute('disabled')
            renderPanel()
          })
      } else {
        deferredPrompt = null
        if (button) button.removeAttribute('disabled')
        renderPanel()
      }
    } catch (e) {
      if (button) button.removeAttribute('disabled')
      say('تعذّر إكمال التثبيت — استخدم القائمة اليدوية.')
    }
  }

  function skipGate() {
    store(CONFIG.skipKey, '1')
    apply()
  }

  /** معالج واحد مفوّض: أي نقرة على [data-action] داخل البوابة */
  function handleClick(event) {
    var target = event && event.target
    if (!target || typeof target.closest !== 'function') return
    var action = target.closest('[data-action]')
    if (!action || !action.getAttribute) return
    switch (action.getAttribute('data-action')) {
      case 'install':
        installNow()
        break
      case 'skip':
        skipGate()
        break
      case 'reload':
        global.location.reload()
        break
      default:
        break
    }
  }

  function bind() {
    if (listenersBound) return
    listenersBound = true

    // 1) الحدث القياسي (كروم/إيدج/بريف على أندرويد وويندوز وماك)
    global.addEventListener('beforeinstallprompt', captureBeforeInstallPrompt)

    // نجاح التثبيت من أي طريق (الزر، قائمة المتصفح، iOS A2HS عند دعم الحدث)
    global.addEventListener('appinstalled', function onAppInstalled() {
      installed = true
      deferredPrompt = null
      apply()
    })

    // 2) أزرار البوابة (تثبيت / تجاوز / تحديث) — بتفويض الأحداث على document
    doc.addEventListener('click', handleClick)

    // 3) إعادة التصنيف عند «الدخول» فقط — لا أثناء الاستخدام
    var recheck = function () {
      apply()
    }
    doc.addEventListener('visibilitychange', recheck)
    global.addEventListener('pageshow', recheck)
    global.addEventListener('focus', recheck)

    // تغيّر وضع العرض (تثبيت ناجح، فتح من الأيقونة…) يُحدّث الحالة فورًا
    onMediaChange('(display-mode: standalone)', recheck)
    onMediaChange('(display-mode: minimal-ui)', recheck)
    onMediaChange('(display-mode: fullscreen)', recheck)
  }

  /* ================================ إقلاع ================================ */

  function boot() {
    apply()
    bind()
  }

  /*
   * الإقلاع فوريًا: مستمِعاتنا على document لا تحتاج DOM مكتملًا، والتحكّم البصري
   * تقوده خاصية <html> التي يضبطها مصنّف index.html. وإن كان التحليل لم يكتمل
   * نُعيد الإقلاع على DOMContentLoaded لنلحق العناصر (inert/aria-hidden) — بلا سباق.
   */
  boot()
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true })

  // واجهة للاختبار والتحكّم من التطبيق نفسه (React) عند الحاجة
  global.PwaInstallGate = {
    config: CONFIG,
    decide: decide,
    apply: apply,
    refresh: apply,
    install: installNow,
    skip: skipGate,
    isStandalone: isStandalone,
    isIOS: isIOS,
    isIOSNativeBrowser: isIOSNativeBrowser,
    supportsBeforeInstallPrompt: supportsBeforeInstallPrompt,
    isDevHost: isDevHost,
    hasPrompt: function () {
      return Boolean(deferredPrompt)
    },
    isInstalled: function () {
      return installed
    }
  }
})(typeof window !== 'undefined' ? window : this)
