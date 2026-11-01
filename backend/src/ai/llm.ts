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
      models: { chat: env('DEEPSEEK_CHAT_MODEL', 'deepseek-flash'), reasoner: env('DEEPSEEK_REASONER_MODEL', 'deepseek-flash') },
    },
    qwen: {
      id: 'qwen', label: '通义千问（DashScope）', keyEnv: 'DASHSCOPE_API_KEY', baseUrlEnv: 'DASHSCOPE_BASE_URL',
      baseURL: env('DASHSCOPE_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, ''),
      apiKey: env('DASHSCOPE_API_KEY'),
      models: { chat: env('QWEN_MODEL', 'qwen-max'), reasoner: env('QWEN_MODEL', 'qwen-max') },
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
  if (model in legacy) return { model: 'deepseek-flash', thinking: thinking ?? legacy[model] };
  return { model, thinking: thinking ?? false };
}

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
  // 注意：deepseek-flash 默认开思考模式；带 tools 的多轮请求要回传 reasoning_content，Mastra 是否回传要接上 Key 后实测（见 deploy/README）
  const id = model || cfg.models.chat;
  return { providerId: cfg.id, modelId: p === 'deepseek' ? resolveDeepseekModel(id).model : id, url: cfg.baseURL, apiKey: cfg.apiKey };
}

/** 给 /health 和 ai:check 看的配置摘要（不含 Key 本身） */
export function aiStatus() {
  const ps = providers();
  return {
    mode: aiMode(),
    forced_mock: forcedMock(),
    providers: (Object.values(ps)).map((c) => ({
      id: c.id, label: c.label, key_env: c.keyEnv, configured: isConfigured(c.id), base_url: c.baseURL, models: c.models,
    })),
  };
}
