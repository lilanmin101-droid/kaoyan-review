import { ref } from 'vue'
export const toastMsg = ref('')
let t: number | undefined
export function toast(m: string) { toastMsg.value = m; clearTimeout(t); t = window.setTimeout(() => (toastMsg.value = ''), 2600) }
