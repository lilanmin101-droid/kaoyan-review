/** npm run ai:check —— 看哪些模型配置好了；有 Key 的各发一次 1 token 的测试请求 */
import { loadEnv } from './env';
loadEnv();
import { aiStatus, chat, isConfigured, ProviderId, providers } from '../src/ai/llm';

async function main() {
  const st = aiStatus();
  console.log(`AI 模式：${st.mode}${st.forced_mock ? '（AI_MOCK=1 强制模拟）' : ''}　时区 APP_TZ=${process.env.APP_TZ || 'Asia/Shanghai（默认）'}`);
  let mastra = 'ok';
  try { require('@mastra/core/agent'); require('@mastra/core/tools'); } catch (e: any) { mastra = `加载失败：${e.message}`; }
  console.log(`Mastra：${mastra}（@mastra/core ${require('@mastra/core/package.json').version}）`);
  let bad = 0;
  for (const id of Object.keys(providers()) as ProviderId[]) {
    const c = providers()[id];
    const head = `- ${c.label}  ${c.keyEnv}=${c.apiKey ? `已配置（…${c.apiKey.slice(-4)}）` : '未配置'}  ${c.baseUrlEnv}=${c.baseURL}  模型 ${[...new Set(Object.values(c.models))].join(' / ')}`;
    if (!isConfigured(id)) { console.log(`${head}\n    → 跳过测试调用，Agent 走规则版，讲解/思路只给题库内容（专家/官方）或「生成中」`); continue; }
    for (const model of [...new Set(Object.values(c.models))]) {
      try {
        const r = await chat(id, { model, messages: [{ role: 'user', content: '回复 ok' }], maxTokens: 1, timeoutMs: 30000 });
        console.log(`${head}\n    → ${model} 调用成功（${r.ms} ms，返回模型 ${r.model}，usage ${JSON.stringify(r.usage ?? {})}）`);
      } catch (e: any) {
        bad++;
        console.log(`${head}\n    → ${model} 调用失败：${e.message}`);
      }
    }
  }
  const ready = st.providers.every((p) => p.configured);
  console.log(ready ? '两个模型都配置好了：Agent、讲解生成与交叉验证都可用。' : 'Agent 需要 DEEPSEEK_API_KEY；讲解生成（ai:explain）需要 DEEPSEEK_API_KEY + DASHSCOPE_API_KEY。');
  process.exit(bad ? 1 : 0);
}
main();
