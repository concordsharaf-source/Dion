import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { App } from './app/App'
import { registerAppServiceWorker } from './app/pwa'

// تحديث تلقائي: أي تغيير منشور يظهر من أول تحديث للصفحة (بلا مسح كاش يدوي)
registerAppServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
