import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { installTap } from './lib/tap'
import { installUpdate } from './lib/update'

installTap()

createApp(App).mount('#app')

// PWA：生产环境注册 service worker（可加到主屏、断网能打开）
if (import.meta.env.PROD) installUpdate()
