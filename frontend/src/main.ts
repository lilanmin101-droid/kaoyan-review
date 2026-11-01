import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { installTap } from './lib/tap'

installTap()

createApp(App).mount('#app')
