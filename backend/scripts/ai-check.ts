/** npm run ai:check —— 看哪些模型配置好了；有 Key 的先预检 GET /models（模型名对不对），再各发一次 1 token 的测试请求。
 *  任何一步失败退出码 1，并说明该改哪个环境变量（scripts/key-preflight.sh 第一步用它） */
import { loadEnv } from './env';
loadEnv();
import { aiStatus, chat, isConfigured, preflightModels, ProviderId, providers } from '../src/ai/llm';

async function main() {
  const st = aiStatus();
  console.log(`AI 模式：${st.mode}${st.forced_mock ? '（AI_MOCK=1 强制模拟）' : ''}　时区 APP_TZ=${process.env.APP_TZ || 'Asia/Shanghai（默认）'}`);
  let mastra = 'ok';
  try { require('@mastra/core/agent'); require('@mastra/core/tools'); } catch (e: any) { mastra = `加载失败：${e.message}`; }
  console.log(`Mastra：${mastra}（@mastra/core ${require('@mastra/core/package.json').version}）`);
  let bad = 0;
  const hints: string[] = [];
  // 1) 预检 /models：Key 是否有效、配置的模型名在不在列表里（后端启动时也做同一件事）
  const pre = await preflightModels('check');
  for (const id of Object.keys(pre) as ProviderId[]) {
    const d = pre[id]!, c = providers()[id];
    if (d.error) {
      bad++;
      hints.push(/HTTP 401|HTTP 403/.test(d.error) ? `${c.keyEnv} 无效或没权限（/models 返回 ${d.error.slice(0, 8)}）：去控制台重新复制 Key` : `${c.label} /models 预检失败（${d.error.slice(0, 120)}）：检查 ${c.baseUrlEnv}=${c.baseURL} 能不能从这台机器访问`);
    } else if (d.missing.length) {
      bad++;
      hints.push(`${c.label}：配置的模型 ${d.missing.join(', ')} 不在 /models 列表里（运行时会自动改用 ${d.chat}）；请把 ${id === 'deepseek' ? 'DEEPSEEK_CHAT_MODEL / DEEPSEEK_REASONER_MODEL' : 'QWEN_MODEL'} 改成列表里有的名字`);
    }
  }
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
        hints.push(`${c.label} 模型 ${model} 测试调用失败：${String(e.message).slice(0, 160)}`);
      }
    }
  }
  const ready = st.providers.every((p) => p.configured);
  console.log(ready ? '两个模型都配置好了：Agent、讲解生成与交叉验证都可用。' : 'Agent 需要 DEEPSEEK_API_KEY；讲解生成（ai:explain）需要 DEEPSEEK_API_KEY + DASHSCOPE_API_KEY。');
  if (hints.length) console.log(`\n要处理：\n${hints.map((h) => `  ✗ ${h}`).join('\n')}`);
  else if (st.providers.some((p) => p.configured)) console.log('\nai:check 通过 ✓');
  process.exit(bad ? 1 : 0);
}
main();
