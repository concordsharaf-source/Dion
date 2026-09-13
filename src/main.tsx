import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { App } from './app/App'
import { registerAppServiceWorker } from './app/pwa'
import { primeAudio } from './core/sound'

// تحديث تلقائي: أي تغيير منشور يظهر من أول تحديث للصفحة (بلا مسح كاش يدوي)
registerAppServiceWorker()

// المتصفحات تمنع الصوت قبل أول تفاعل — نُهيّئ المحرّك عند أول لمسة أو مفتاح
const prime = () => primeAudio()
window.addEventListener('pointerdown', prime, { once: true, passive: true })
window.addEventListener('keydown', prime, { once: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
