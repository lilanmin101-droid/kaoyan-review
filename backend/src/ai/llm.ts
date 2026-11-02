/**
 * LLM 提供方（OpenAI 兼容接口，纯 fetch，不依赖 Nest，脚本里也能用）。
 * - DeepSeek：主模型。2026-07-24 起旧名 deepseek-chat / deepseek-reasoner 已下线，现在是 deepseek-flash（V4.1 Flash），
 *   思考模式改成请求参数 thinking:{type:enabled|disabled}（默认开启）：普通对话关、讲解生成开。
 *   .env 里还写着旧名时自动换成 deepseek-flash + 对应的 thinking（见 resolveDeepseekModel）
 * - 通义千问（DashScope 兼容模式）：交叉验证
 * 没有 Key（或 AI_MOCK=1）时 aiMode()==='mock'，调用方走原来的模拟数据，接口形状不变。
 */
export type ProviderId = 'deepseek' | 'qwen';

export interface ProviderCfg {
  id: ProviderId;
  label: string;
  keyEnv: string;
  baseUrlEnv: string;
  baseURL: string;
  apiKey: string;
  models: { chat: string; reasoner: string };
}

const env = (k: string, d = '') => (process.env[k] ?? '').trim() || d;

export function providers(): Record<ProviderId, ProviderCfg> {
  return {
    deepseek: {
      id: 'deepseek', label: 'DeepSeek', keyEnv: 'DEEPSEEK_API_KEY', baseUrlEnv: 'DEEPSEEK_BASE_URL',
      baseURL: env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, ''),
      apiKey: env('DEEPSEEK_API_KEY'),
      models: { chat: picked('deepseek', 'chat', env('DEEPSEEK_CHAT_MODEL', 'deepseek-flash')), reasoner: picked('deepseek', 'reasoner', env('DEEPSEEK_REASONER_MODEL', 'deepseek-flash')) },
    },
    qwen: {
      id: 'qwen', label: '通义千问（DashScope）', keyEnv: 'DASHSCOPE_API_KEY', baseUrlEnv: 'DASHSCOPE_BASE_URL',
      baseURL: env('DASHSCOPE_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, ''),
      apiKey: env('DASHSCOPE_API_KEY'),
      models: { chat: picked('qwen', 'chat', env('QWEN_MODEL', 'qwen-max')), reasoner: picked('qwen', 'reasoner', env('QWEN_MODEL', 'qwen-max')) },
    },
  };
}

const forcedMock = () => ['1', 'true', 'yes'].includes(env('AI_MOCK').toLowerCase());
export const isConfigured = (p: ProviderId) => !forcedMock() && !!providers()[p].apiKey;
/** 整体模式：主模型（DeepSeek）有 Key 才算 ai，否则 mock */
export const aiMode = (): 'ai' | 'mock' => (isConfigured('deepseek') ? 'ai' : 'mock');

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatOptions {
  model?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  json?: boolean;          // response_format json_object（思考模式不传）
  thinking?: boolean;      // DeepSeek 思考模式；不写 = 关（旧名 deepseek-reasoner = 开）
  timeoutMs?: number;
}
export interface ChatResult { provider: ProviderId; model: string; text: string; reasoning?: string; usage?: any; ms: number }

export class LlmError extends Error {
  constructor(public provider: ProviderId, public status: number | null, message: string) { super(message); }
}

/** 一次非流式对话补全 */
export async function chat(p: ProviderId, o: ChatOptions): Promise<ChatResult> {
  const cfg = providers()[p];
  if (!isConfigured(p)) throw new LlmError(p, null, `${cfg.keyEnv} 未配置`);
  const want = o.model || cfg.models.chat;
  const { model, thinking } = p === 'deepseek' ? resolveDeepseekModel(want, o.thinking) : { model: want, thinking: false };
  const body: any = { model, messages: o.messages, stream: false };
  if (p === 'deepseek') body.thinking = { type: thinking ? 'enabled' : 'disabled' };
  if (o.maxTokens) body.max_tokens = o.maxTokens;
  if (o.temperature != null && !thinking) body.temperature = o.temperature;
  if (o.json && !thinking) body.response_format = { type: 'json_object' };
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? Number(env('AI_TIMEOUT_MS', '120000')));
  try {
    const r = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    if (!r.ok) throw new LlmError(p, r.status, `${cfg.label} HTTP ${r.status}: ${txt.slice(0, 300)}`);
    const j = JSON.parse(txt);
    const m = j.choices?.[0]?.message ?? {};
    return { provider: p, model: j.model || model, text: m.content ?? '', reasoning: m.reasoning_content, usage: j.usage, ms: Date.now() - t0 };
  } catch (e: any) {
    if (e instanceof LlmError) throw e;
    throw new LlmError(p, null, `${cfg.label} 调用失败：${e.name === 'AbortError' ? '超时' : e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 旧模型名（2026-07-24 已下线）→ deepseek-flash；thinking：调用方指定优先，否则旧名 reasoner = 开，其余关 */
export function resolveDeepseekModel(model: string, thinking?: boolean): { model: string; thinking: boolean } {
  const legacy: Record<string, boolean> = { 'deepseek-chat': false, 'deepseek-reasoner': true };
  const ids = discovered.deepseek?.ids;
  // 预检拿到了 /models 列表：列表里有的名字照用（不信记忆里的「已下线」）；没有才换
  if (ids?.length && ids.includes(model)) return { model, thinking: thinking ?? legacy[model] ?? false };
  if (model in legacy) {
    const to = ids?.length && !ids.includes('deepseek-flash') ? discovered.deepseek!.chat : 'deepseek-flash';
    return { model: to, thinking: thinking ?? legacy[model] };
  }
  if (ids?.length) return { model: discovered.deepseek!.chat, thinking: thinking ?? false };
  return { model, thinking: thinking ?? false };
}

// ───────────── 模型名预检：启动时 / gen:explanations 开始前调一次提供方的 GET /models ─────────────
// 不信记忆里的模型名：有 Key 时按返回的列表挑默认模型和映射；配置的模型不在列表里就打一行清楚的日志并改用列表里的。
// 没 Key（或 AI_MOCK=1）不调，照旧用配置 / 内置默认名。
export interface Discovered { ids: string[]; chat: string; reasoner: string; configured: { chat: string; reasoner: string }; missing: string[]; checked_at: string; error?: string }
const discovered: Partial<Record<ProviderId, Discovered>> = {};
function picked(p: ProviderId, role: 'chat' | 'reasoner', configured: string) {
  const d = discovered[p];
  if (!d || d.error || !d.ids.length) return configured;
  return d.ids.includes(configured) ? configured : d[role];
}
const PREFER: Record<ProviderId, { chat: RegExp[]; reasoner: RegExp[] }> = {
  deepseek: { chat: [/^deepseek-flash$/, /flash/, /^deepseek-chat$/, /chat/, /^deepseek-v\d/], reasoner: [/^deepseek-flash$/, /flash/, /reason/, /think/, /^deepseek-chat$/] },
  qwen: { chat: [/^qwen-max$/, /^qwen-max/, /^qwen-plus/, /^qwen3?-/, /^qwen/], reasoner: [/^qwen-max$/, /^qwen-max/, /^qwen-plus/, /^qwen/] },
};
export function pickModel(p: ProviderId, role: 'chat' | 'reasoner', ids: string[], configured: string): string {
  if (ids.includes(configured)) return configured;
  for (const re of PREFER[p][role]) { const m = ids.filter((x) => re.test(x)).sort()[0]; if (m) return m; }
  return ids[0] ?? configured;
}
export async function preflightModels(who = 'startup', log: (s: string) => void = (s) => console.log(s)): Promise<Partial<Record<ProviderId, Discovered>>> {
  for (const p of ['deepseek', 'qwen'] as ProviderId[]) {
    delete discovered[p];
    const cfg = providers()[p];
    if (!isConfigured(p)) { log(`[ai:${who}] ${cfg.label}：没配 ${cfg.keyEnv}，不预检模型名，照旧用 ${cfg.models.chat}${cfg.models.reasoner !== cfg.models.chat ? ` / ${cfg.models.reasoner}` : ''}（mock / 兜底）`); continue; }
    const conf = { chat: p === 'deepseek' ? env('DEEPSEEK_CHAT_MODEL', 'deepseek-flash') : env('QWEN_MODEL', 'qwen-max'), reasoner: p === 'deepseek' ? env('DEEPSEEK_REASONER_MODEL', 'deepseek-flash') : env('QWEN_MODEL', 'qwen-max') };
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), Number(env('AI_PREFLIGHT_TIMEOUT_MS', '8000')));
    try {
      const r = await fetch(`${cfg.baseURL}/models`, { signal: ctl.signal, headers: { authorization: `Bearer ${cfg.apiKey}` } });
      const txt = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
      const j = JSON.parse(txt);
      const ids: string[] = (Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : []).map((x: any) => String(x?.id ?? x)).filter(Boolean);
      if (!ids.length) throw new Error('/models 返回的列表是空的');
      const chatM = pickModel(p, 'chat', ids, conf.chat), reasM = pickModel(p, 'reasoner', ids, conf.reasoner);
      const missing = [...new Set([conf.chat, conf.reasoner])].filter((m) => !ids.includes(m) && !(p === 'deepseek' && m in { 'deepseek-chat': 1, 'deepseek-reasoner': 1 } && ids.includes('deepseek-flash')));
      discovered[p] = { ids, chat: chatM, reasoner: reasM, configured: conf, missing, checked_at: new Date().toISOString() };
      log(`[ai:${who}] ${cfg.label}：/models 返回 ${ids.length} 个（${ids.slice(0, 8).join(', ')}${ids.length > 8 ? ', …' : ''}）；用 chat=${chatM} reasoner=${reasM}`);
      for (const m of missing) log(`[ai:${who}] ⚠ ${cfg.label}：配置的模型「${m}」不在 /models 列表里，已改用「${m === conf.reasoner && m !== conf.chat ? reasM : chatM}」。请检查 ${p === 'deepseek' ? 'DEEPSEEK_CHAT_MODEL / DEEPSEEK_REASONER_MODEL' : 'QWEN_MODEL'}`);
    } catch (e: any) {
      discovered[p] = { ids: [], chat: conf.chat, reasoner: conf.reasoner, configured: conf, missing: [], checked_at: new Date().toISOString(), error: e?.name === 'AbortError' ? '超时' : String(e?.message ?? e) };
      log(`[ai:${who}] ⚠ ${cfg.label}：预检 /models 失败（${discovered[p]!.error}），照旧用配置的 ${conf.chat}`);
    } finally { clearTimeout(timer); }
  }
  return { ...discovered };
}
export const discoveredModels = () => ({ ...discovered });

/** 从模型输出里取 JSON（容忍 ```json 代码块和前后废话） */
export function parseJsonLoose<T = any>(text: string): T {
  const s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(s); } catch { /* fallthrough */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error('模型输出不是 JSON');
}

/** 给 Mastra Agent 用的模型配置（Mastra 自带 OpenAI 兼容路由，不需要额外 SDK） */
export function mastraModel(p: ProviderId, model?: string) {
  const cfg = providers()[p];
  // 注意：deepseek-flash 默认开思考模式；带 tools 的多轮请求要回传 reasoning_content，Mastra（OpenAI 兼容路由）不回传 → 第二轮 400。
  // 所以 Agent 调用一律带 mastraProviderOptions('deepseek')，显式关掉思考模式（用 fake-llm FAKE_LLM_THINKING=1 复现过，见 scripts/key-preflight.sh）
  const id = model || cfg.models.chat;
  return { providerId: cfg.id, modelId: p === 'deepseek' ? resolveDeepseekModel(id).model : id, url: cfg.baseURL, apiKey: cfg.apiKey };
}

/** 传给 agent.stream/generate 的 providerOptions：DeepSeek 关思考模式（会被原样并进请求体 thinking:{type:'disabled'}） */
export function mastraProviderOptions(p: ProviderId): Record<string, Record<string, any>> {
  return p === 'deepseek' ? { [providers()[p].id]: { thinking: { type: 'disabled' } } } : {};
}

/** 给 /health 和 ai:check 看的配置摘要（不含 Key 本身） */
export function aiStatus() {
  const ps = providers();
  return {
    mode: aiMode(),
    forced_mock: forcedMock(),
    providers: (Object.values(ps)).map((c) => ({
      id: c.id, label: c.label, key_env: c.keyEnv, configured: isConfigured(c.id), base_url: c.baseURL, models: c.models,
      preflight: discovered[c.id] ? { checked_at: discovered[c.id]!.checked_at, model_count: discovered[c.id]!.ids.length, missing: discovered[c.id]!.missing, error: discovered[c.id]!.error ?? null } : null,
    })),
  };
}
