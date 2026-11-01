import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
const API = process.env.API_TARGET ?? 'http://localhost:3000'
const proxy = { '/api': { target: API, changeOrigin: true } }
export default defineConfig({ base: './', plugins: [vue()], server: { proxy, host: true }, preview: { proxy, host: true } })
