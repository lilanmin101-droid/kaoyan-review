// 离线题包 / 补传的纯函数单测：npm run test:offline
import { assetUrls, clampAnsweredAt, isValidClientId, packVersion, stableJson, stepsText } from '../src/offline/offline';
import { checkItem } from '../src/answers/answers.controller';
import { studyDate } from '../src/common/time';
let fail = 0;
const eq = (name: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};
const now = new Date('2026-11-04T12:00:00Z');
eq('不带 answered_at → 现在', clampAnsweredAt(undefined, now), { at: now, clamped: null });
eq('过去 2 小时 → 原样', clampAnsweredAt('2026-11-04T10:00:00Z', now).at.toISOString(), '2026-11-04T10:00:00.000Z');
eq('未来 → 夹到现在', clampAnsweredAt('2026-11-05T00:00:00Z', now).clamped, { from: '2026-11-05T00:00:00Z', to: '2026-11-04T12:00:00.000Z', reason: 'future' });
eq('8 天前 → 夹到 7 天前', clampAnsweredAt('2026-10-27T12:00:00Z', now).clamped?.to, '2026-10-28T12:00:00.000Z');
eq('正好 7 天前 → 不夹', clampAnsweredAt('2026-10-28T12:00:00Z', now).clamped, null);
eq('乱写 → bad_answered_at', clampAnsweredAt('昨天', now).error, 'bad_answered_at');
eq('带时区偏移的客户端时间', studyDate(clampAnsweredAt('2026-11-04T03:30:00+08:00', now).at, 'Asia/Shanghai'), '2026-11-03');
// X-Debug-Now=2026-11-04T20:00+08:00 当「现在」：不带 answered_at → 学习日 11-04
eq('debug now 记到 11-04', studyDate(clampAnsweredAt(null, new Date('2026-11-04T20:00:00+08:00')).at, 'Asia/Shanghai'), '2026-11-04');
eq('client_id uuid', isValidClientId('8c1f6a2e-3b4d-4e5f-9a0b-1c2d3e4f5a6b'), true);
eq('client_id 前端 uid()', isValidClientId('mhj3k2x9a7q'), true);
eq('client_id 老写法 c1', isValidClientId('c1'), true);
eq('client_id 空格 / 太长', [isValidClientId('a b'), isValidClientId('x'.repeat(129)), isValidClientId(''), isValidClientId(12)], [false, false, false, false]);
eq('版本：键顺序无关', packVersion({ a: 1, b: [1, { c: 2, d: 3 }] }), packVersion({ b: [1, { d: 3, c: 2 }], a: 1 }));
eq('版本：内容变了就变', packVersion({ a: 1 }) === packVersion({ a: 2 }), false);
eq('版本 16 位 hex', /^[0-9a-f]{16}$/.test(packVersion({})), true);
eq('stableJson undefined 键忽略', stableJson({ a: undefined, b: 1 }), '{"b":1}');
eq('图片：images + Markdown，去重、外链不要', assetUrls('/api/v1/assets/', ['images/a.png'], '见图 ![](images/a.png) 和 ![x](./images/b.jpg "t") ![](https://x.com/c.png)', [{ text: '![](images/d.svg)' }]),
  ['/api/v1/assets/images/a.png', '/api/v1/assets/images/b.jpg', '/api/v1/assets/images/d.svg']);
eq('图片：已经是完整路径不重复拼', assetUrls('/api/v1/assets/eng1/', ['/api/v1/assets/eng1/x.png']), ['/api/v1/assets/eng1/x.png']);
eq('讲解步骤拼文本', [stepsText([{ text: 'A' }, { text: 'B' }]), stepsText([]), stepsText(null)], ['A\n\nB', null, null]);
eq('checkItem 正常', checkItem({ question_id: 'q', answer: ['A'], client_id: 'abc12345', source: 'offline_pack', answered_at: '2026-11-04T10:00:00Z' }), null);
eq('checkItem 各种坏', [checkItem({}), checkItem({ question_id: 'q', source: 'x' }), checkItem({ question_id: 'q', client_id: 'a b' }), checkItem({ question_id: 'q', answer: 'A' }), checkItem({ question_id: 'q', answered_at: 'nope' }), checkItem({ question_id: 'q', self_rating: 'meh' })],
  ['missing_question_id', 'bad_source', 'bad_client_id', 'bad_answer', 'bad_answered_at', 'bad_self_rating']);
console.log(fail ? `\n${fail} FAILED` : '\nALL OK');
process.exit(fail ? 1 : 0);
