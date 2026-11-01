import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { installTap } from './lib/tap'

installTap()

createApp(App).mount('#app')

// PWA：生产环境注册 service worker（可加到主屏、断网能打开）
if ('serviceWorker' in navigator && import.meta.env.PROD) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))
