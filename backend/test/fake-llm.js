/**
 * 假的 OpenAI 兼容模型服务（只给本地测试用，不联网）：
 *   FAKE_LLM_PORT=4020 node test/fake-llm.js
 *   DEEPSEEK_API_KEY=fake DEEPSEEK_BASE_URL=http://127.0.0.1:4020 DASHSCOPE_API_KEY=fake DASHSCOPE_BASE_URL=http://127.0.0.1:4020 ...
 * 行为（按请求内容脚本化）：
 * - 带 tools：依次调用 getProfile → getWrongQuestions → updateDailyPlan，然后给一句总结
 * - 讲解生成（含「任务：讲解」）：返回分步 JSON，final_answer 取【参考答案】
 * - 独立解答（含「任务：独立解答」）：选择题一律答 C（用来制造一致/不一致两种情况）
 * - 判等（含「任务：判断等价」）：字符串去空格后比较
 * - 批改（含「阅卷老师」）：返回批改 JSON，分数给满分的一半
 * - 其他：返回 "ok"
 * - GET /models：返回 FAKE_LLM_MODELS（逗号分隔，默认 deepseek-flash,deepseek-chat,qwen-max,qwen-plus），给启动 / 讲解预生成的模型名预检用
 * - FAKE_LLM_THINKING=1：模拟 DeepSeek 思考模式——请求没写 thinking:{type:"disabled"} 时，带 tool_calls 的回复附 reasoning_content，
 *   下一轮里 assistant 的 tool_calls 消息没回传 reasoning_content 就报 400（和真 DeepSeek 一样），用来提前发现多轮工具调用的 400
 * - GET /__calls：返回收到的调用记录（预检脚本核对用）
 */
const http = require('http');
const port = Number(process.env.FAKE_LLM_PORT || 4020);
const calls = [];

function reply(req) {
  const msgs = req.messages || [];
  const text = msgs.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  if (req.tools?.length) {
    const toolMsgs = msgs.filter((m) => m.role === 'tool');
    const n = toolMsgs.length;
    const call = (name, args) => ({ tool_calls: [{ id: `call_${n}_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    if (n === 0) return call('getProfile', {});
    if (n === 1) return call('getWrongQuestions', { limit: 3 });
    if (n === 2) {
      let ids = [];
      try { ids = JSON.parse(toolMsgs[1].content).items.map((i) => i.question_id); } catch {}
      return call('updateDailyPlan', { why_changed: '【假模型】先把到期错题重做一遍', add_tasks: [{ kind: ids.length ? 'redo_wrong' : 'practice', title: ids.length ? `重做 ${ids.length} 道错题（假模型）` : '基础练习（假模型）', payload: { question_ids: ids }, estimated_minutes: 20 }] });
    }
    return { content: '【假模型】已经把错题排进明天的计划了。' };
  }
  if (text.includes('任务：讲解')) {
    const ans = (text.match(/【参考答案】([^\n]*)/) || [])[1]?.trim() || '?';
    return { content: JSON.stringify({ steps: [{ n: 1, title: '读题', text: '看清题目考什么。' }, { n: 2, title: '关键一步', text: '用对应的定理化简。' }, { n: 3, title: '得出答案', text: `所以答案是 ${ans}。` }], final_answer: ans, key_points: ['假模型'] }) };
  }
  if (text.includes('阅卷老师')) { // 翻译 / 作文批改（eval:grading、POST /answers/:id/grade）：按满分给一半，格式和真模型要求的 JSON 一样
    const max = Number((text.match(/满分 (\d+) 分/) || [])[1] || 2);
    return { content: JSON.stringify({ band: max === 2 ? null : 3, score: Math.round(max) / 2, band_reason: '【假模型】按一半给分', points_hit: [], points_missed: [], errors: [], suggestions: ['【假模型】多检查语法'] }) };
  }
  if (text.includes('任务：审核证明')) return { content: JSON.stringify({ valid: true, issues: [] }) };
  if (text.includes('任务：独立解答')) return { content: JSON.stringify({ final_answer: 'C', brief: '假模型一律选 C' }) };
  if (text.includes('任务：判断等价')) {
    const a = (text.match(/【答案A】([^\n]*)/) || [])[1]?.replace(/\s|\$/g, '');
    const b = (text.match(/【答案B】([^\n]*)/) || [])[1]?.replace(/\s|\$/g, '');
    return { content: JSON.stringify({ equivalent: !!a && a === b, why: '假模型字符串比较' }) };
  }
  return { content: 'ok' };
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = req.url.split('?')[0];
    if (url === '/__calls') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(calls)); }
    if (req.headers.authorization !== 'Bearer fake') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"bad key"}}'); }
    if (req.method === 'GET' && url.endsWith('/models')) {
      const ids = (process.env.FAKE_LLM_MODELS || 'deepseek-flash,deepseek-chat,qwen-max,qwen-plus').split(',').map((x) => x.trim()).filter(Boolean);
      calls.push({ get: '/models' });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data: ids.map((id) => ({ id, object: 'model', owned_by: 'fake' })) }));
    }
    if (!url.endsWith('/chat/completions')) { res.writeHead(404); return res.end('{}'); }
    let r;
    try { r = JSON.parse(body || '{}'); } catch { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"bad json"}}'); }
    const thinking = process.env.FAKE_LLM_THINKING === '1' && r.thinking?.type !== 'disabled';
    if (thinking) {
      const lost = (r.messages || []).some((m) => m.role === 'assistant' && m.tool_calls?.length && !m.reasoning_content);
      if (lost) {
        calls.push({ model: r.model, status: 400, reason: 'missing reasoning_content' });
        console.log(JSON.stringify(calls[calls.length - 1]));
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Missing `reasoning_content` field in the assistant message (fake-llm thinking mode)', type: 'invalid_request_error' } }));
      }
    }
    const out = reply(r);
    if (thinking && out.tool_calls) out.reasoning_content = '（假模型的思考过程）';
    calls.push({ model: r.model, tools: (r.tools || []).length, stream: !!r.stream, thinking: r.thinking?.type ?? null, out: Object.keys(out) });
    console.log(JSON.stringify(calls[calls.length - 1]));
    const id = 'chatcmpl-fake-' + calls.length;
    const finish = out.tool_calls ? 'tool_calls' : 'stop';
    if (!r.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: r.model,
        choices: [{ index: 0, message: { role: 'assistant', content: out.content ?? null, tool_calls: out.tool_calls, ...(out.reasoning_content ? { reasoning_content: out.reasoning_content } : {}) }, finish_reason: finish }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (delta, fin = null, extra = {}) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: r.model, choices: [{ index: 0, delta, finish_reason: fin }], ...extra })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (out.reasoning_content) send({ reasoning_content: out.reasoning_content });
    if (out.tool_calls) send({ tool_calls: out.tool_calls.map((t, i) => ({ index: i, ...t })) });
    else for (const ch of out.content.match(/.{1,8}/gs) || []) send({ content: ch });
    send({}, finish);
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
}).listen(port, '127.0.0.1', () => console.log(`fake llm on http://127.0.0.1:${port}`));
