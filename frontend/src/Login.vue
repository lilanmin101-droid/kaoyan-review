<script setup lang="ts">
import { ref } from 'vue'
import { api, token, ApiError } from './lib/api'
import { toast } from './lib/toast'
import { afterLogin } from './lib/offline'
const emit = defineEmits<{ done: [] }>()
const username = ref(''), password = ref(''), err = ref(''), mode = ref<'login' | 'register'>('login'), busy = ref(false)
function explain(e: unknown) {
  if (!(e instanceof ApiError)) return '现在没网，连上再试'
  if (mode.value === 'register' && e.status === 409) return '这个账号已经被注册了，换一个，或者直接登录'
  if (mode.value === 'login' && (e.status === 401 || e.status === 404)) return '账号或密码不对'
  if (e.status === 400) return e.message || '账号或密码格式不对'
  return e.message
}
async function submit() {
  err.value = ''
  if (!username.value.trim() || !password.value) { err.value = '账号和密码都要填'; return }
  busy.value = true
  try {
    const r = await api<{ access_token: string }>(`/auth/${mode.value}`, { method: 'POST', body: JSON.stringify({ username: username.value.trim(), password: password.value }) }, { noReload: true })
    token.set(r.access_token)
    toast(mode.value === 'register' ? `注册成功，欢迎你，${username.value.trim()}` : '已登录，接着上次的进度')
    emit('done')
    afterLogin()
  } catch (e) { err.value = explain(e) } finally { busy.value = false }
}
</script>
<template>
  <div class="login">
    <div class="wm big">研习</div>
    <p class="sub">{{ mode === 'login' ? '登录后继续上次的进度' : '注册一个账号' }}</p>
    <input v-model="username" placeholder="账号" autocomplete="username" />
    <input v-model="password" type="password" placeholder="密码" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" @keyup.enter="submit" />
    <p v-if="err" class="err">{{ err }}</p>
    <span class="next" :class="{ dim: busy }" @click="!busy && submit()">{{ busy ? '请稍候…' : mode === 'login' ? '登录' : '注册' }}</span>
    <span class="switch" @click="mode = mode === 'login' ? 'register' : 'login'; err = ''">{{ mode === 'login' ? '没有账号？注册' : '已有账号？登录' }}</span>
  </div>
</template>
