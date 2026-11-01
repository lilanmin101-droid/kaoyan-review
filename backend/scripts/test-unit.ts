/**
 * npm run test:unit —— 纯函数单测（不连库、不起服务）：中文数量解析、时区/日界、去重键、预算解析。
 * 也被 npm run eval:agent 先跑一遍。
 */
import { parseBudgetMinutes, parseCnNumber, parseCount, parseWrongFilter, quantityIntent } from '../src/agent/coach.service';
import { proposalTargetDate, proposalView } from '../src/agent/proposal-view';
import { badPunct, clause, dayGreeting, hasLeak, laterToday, minutesText, textProblem } from '../src/agent/coach.service';
import { isDupItem, addSeenTask, addSeenItem, dupSources, newSeen, jobReason, skipReason } from '../src/agent/jobs.service';
import { composeWhy, whyOf } from '../src/plans/plans.service';
import { validateErrata, cleanErrata } from './import-questions';
import { normalizeCommand } from '../src/agent/agent.controller';
import { EXPLICIT_DAY_RE, planDedupeKey, nextQuantity, taskQuantity } from '../src/agent/agent-tools.service';
import { isValidTz } from '../src/common/user-time.service';
import { appendNote, bareDates, earlyNote, nestQuotes, renderDates, toPlaceholders, wantsEarlyNote, withEarlyNote, badDayLabels, dayLabel, DAY_START_HOUR, localDate, relativeDay, startOfLocalDay, startOfStudyDay, studyDate, studyDaySql, weekOf } from '../src/common/time';
import { coachFrequency, inQuiet, minutesUntilQuietEnds, quietHours, UserInputError, validateSettingsPatch } from '../src/common/reminders';
import { streakOf } from '../src/auth/me-stats.service';
import { intentSummary } from '../src/agent/jobs.service';
import { normalizeHttpError } from '../src/common/http-error.filter';
import { applyReviews, scorePlan, subScoreMissingProblems, subScoresSourceFor, subScoresSourceOf } from './import-questions';
import { fixLemmas, isBasic, mergeExamples } from './import-vocab';
import { resolveScoreByWhole } from '../src/common/grading';
import { assertedLetters, estimateTokens, normEvidence, qualityCheck } from '../src/ai/explanation-gen';
import { questionText } from '../src/ai/explain';
import { gapSentenceMatch } from '../src/ai/explanation-gen';
import { hasPhraseInPassage, parseRecurrence } from '../src/ai/cloze-recurrence';
import { generatorMessages, PROMPT_VERSION } from '../src/ai/explain';
import { pickModel, resolveDeepseekModel } from '../src/ai/llm';
import { questionKind } from '../src/agent/coach-answers';
import { selfGradeCheck, selfGradeFields } from '../src/exams/self-grade-check';
import { countUnits } from '../src/english/ai-grader';
import { referenceAnswer } from '../src/questions/reference-answer';
import { tickSeconds, HEARTBEAT_CAP_SECONDS } from '../src/exams/exams.service';
import { parseGenArgs } from './gen-explanations';

let fail = 0, pass = 0;
export function eq(name: string, got: any, want: any) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

export function runUnitTests() {
  fail = 0; pass = 0;
  // 数量：一道=1、两道=2、数字照用；没说数量 → null（调用方默认 3）
  for (const [t, n] of [['帮我加一道重做错题', 1], ['帮我加道重做错题', 1], ['加两道错题', 2], ['来二道', 2], ['重做 3 道错题', 3], ['给我十道题', 10],
    ['再来十二道', 12], ['二十道', 20], ['做 5 题', 5], ['今天只有一小时', null], ['错题太多了，先清错题', null], ['把错题都排到周末', null]] as const)
    eq(`parseCount(${t})`, parseCount(t), n);
  for (const [x, n] of [['一', 1], ['两', 2], ['十', 10], ['十一', 11], ['三十', 30], ['九十九', 99], ['7', 7], ['abc', null]] as const) eq(`parseCnNumber(${x})`, parseCnNumber(x), n);
  for (const [t, n] of [['今天只有一小时', 60], ['只有40分钟', 40], ['一个半小时', 90], ['半小时', 30], ['帮我加一道重做错题', null]] as const) eq(`parseBudgetMinutes(${t})`, parseBudgetMinutes(t), n);
  // 明确说了别的日子才允许排到别的日子
  for (const [t, v] of [['今天只有一小时', false], ['帮我加一道重做错题', false], ['明天先做错题', true], ['周六组一套卷', true], ['排到 11-07', true], ['8号做', true]] as const)
    eq(`EXPLICIT_DAY_RE(${t})`, EXPLICIT_DAY_RE.test(t), v);
  // 时区：Intl 校验；同一时刻不同时区的「今天」；日界换算（含夏令时结束当天 2026-11-01 洛杉矶 25 小时）
  for (const [z, v] of [['America/Los_Angeles', true], ['Asia/Shanghai', true], ['UTC', true], ['Mars/Olympus', false], ['', false], ['../etc', false]] as const) eq(`isValidTz(${z})`, isValidTz(z), v);
  const t = new Date('2026-11-01T16:30:00Z'); // 洛杉矶 11-01 08:30；上海 11-02 00:30
  eq('localDate LA', localDate(t, 'America/Los_Angeles'), '2026-11-01');
  eq('localDate Shanghai', localDate(t, 'Asia/Shanghai'), '2026-11-02');
  eq('startOfLocalDay Shanghai', startOfLocalDay('2026-11-02', 'Asia/Shanghai').toISOString(), '2026-11-01T16:00:00.000Z');
  eq('startOfLocalDay LA (PDT)', startOfLocalDay('2026-11-01', 'America/Los_Angeles').toISOString(), '2026-11-01T07:00:00.000Z');
  eq('startOfLocalDay LA (PST)', startOfLocalDay('2026-11-02', 'America/Los_Angeles').toISOString(), '2026-11-02T08:00:00.000Z');
  // 去重键：同意图 + 同日期 + 同任务（类型 + 题目集合/数量）；题目顺序无关；日期或数量不同就不是同一个
  const k = (d: string, ids: string[]) => planDedupeKey(d, { kind: 'redo_wrong', title: `重做 ${ids.length} 道错题`, payload: { question_ids: ids } });
  eq('dedupeKey 顺序无关', k('2026-11-01', ['b', 'a']) === k('2026-11-01', ['a', 'b']), true);
  eq('dedupeKey 日期不同', k('2026-11-01', ['a']) === k('2026-11-02', ['a']), false);
  eq('dedupeKey 数量不同', k('2026-11-01', ['a']) === k('2026-11-01', ['a', 'b']), false);
  // 数量语义：增量词 → add；只有数量 → set；都没有 → null
  for (const [t, v] of [
    ['加两道重做错题', { mode: 'add', quantity: 2 }], ['再来 2 道', { mode: 'add', quantity: 2 }], ['再加两道重做错题', { mode: 'add', quantity: 2 }],
    ['多做三道错题', { mode: 'add', quantity: 3 }], ['补 4 道', { mode: 'add', quantity: 4 }], ['追加一道', { mode: 'add', quantity: 1 }], ['帮我加一道重做错题', { mode: 'add', quantity: 1 }],
    ['再来点错题', { mode: 'add', quantity: 3 }], ['今天重做 5 道错题', { mode: 'set', quantity: 5 }], ['重做两道', { mode: 'set', quantity: 2 }],
    ['今天只有一小时', null], ['一个半小时', null], ['先清错题', null], ['背 20 个词', null],
  ] as const) eq(`quantityIntent(${t})`, JSON.stringify(quantityIntent(t)), JSON.stringify(v));
  eq('nextQuantity add 3+2', nextQuantity(3, 'add', 2), 5);
  eq('nextQuantity set 3→5（不叠加）', nextQuantity(3, 'set', 5), 5);
  eq('nextQuantity set 5→5', nextQuantity(5, 'set', 5), 5);
  eq('taskQuantity ids', taskQuantity({ payload: { question_ids: ['a', 'b', 'a'] } }), 2);
  eq('taskQuantity count', taskQuantity({ payload: { count: 4 } }), 4);
  eq('taskQuantity 标题', taskQuantity({ title: '重做 3 道错题', payload: {} }), 3);
  eq('normalizeCommand 忽略空格标点', normalizeCommand('再加 两道，重做错题！') === normalizeCommand('再加两道重做错题'), true);
  eq('dedupeKey 不看原句', planDedupeKey('2026-11-01', { kind: 'practice', title: '基础练习 5 题', payload: { count: 5 } }), 'plan_add|2026-11-01|practice|基础练习 5 题|5');
  // 「我的」：免打扰 quiet_hours / coach_frequency / 设置校验 / 连续天数
  const qh = { start: '22:30', end: '08:00' };
  eq('inQuiet 跨零点 23:00', inQuiet(23 * 60, qh), true);
  eq('inQuiet 跨零点 07:59', inQuiet(7 * 60 + 59, qh), true);
  eq('inQuiet 08:00 不算', inQuiet(8 * 60, qh), false);
  eq('inQuiet 白天时段 12:00–14:00 13:00', inQuiet(13 * 60, { start: '12:00', end: '14:00' }), true);
  eq('23:00 → 排到 08:00（540 分钟后）', minutesUntilQuietEnds(23 * 60, qh), 540);
  eq('01:00 → 排到 08:00（420 分钟后）', minutesUntilQuietEnds(60, qh), 420);
  eq('不在免打扰 → 0', minutesUntilQuietEnds(12 * 60, qh), 0);
  eq('coachFrequency 默认 normal', coachFrequency({}), 'normal');
  eq('coachFrequency 非法值当 normal', coachFrequency({ coach_frequency: 'x' }), 'normal');
  eq('quietHours 读设置', quietHours({ quiet_hours: qh }), qh);
  const bad = (b: any) => { try { validateSettingsPatch(b); return 'ok'; } catch (e) { return e instanceof UserInputError && !/[a-z_]{3,}|null/i.test(e.message) && !!e.code ? 'rejected' : 'threw'; } };
  eq('settings 平铺字段 + trim', validateSettingsPatch({ target_school: ' 浙大 ', target_score: 400, exam_date: '2026-12-19', coach_frequency: 'ask', quiet_hours: qh, timezone: 'America/Los_Angeles' }),
    { timezone: 'America/Los_Angeles', target_school: '浙大', target_score: 400, exam_date: '2026-12-19', coach_frequency: 'ask', quiet_hours: qh });
  const msg = (b: any) => { try { validateSettingsPatch(b); return null; } catch (e: any) { return [e.message, e.field, e.code]; } };
  eq('400 文案：目标分', msg({ target_score: 501 }), ['目标分填 0–500 之间的整数', 'target_score', 'invalid_target_score']);
  eq('400 文案：考试日期', msg({ exam_date: '2026/12/19' }), ['考试日期格式不对', 'exam_date', 'invalid_exam_date']);
  eq('400 文案：免打扰', msg({ quiet_hours: { start: '11pm', end: '7' } }), ['免打扰时间要写成 23:00 这样', 'quiet_hours', 'invalid_quiet_hours']);
  eq('400 文案：拼错字段', msg({ targetScore: 1 }), ['有一项设置暂时不支持，请刷新页面后再试', 'targetScore', 'unknown_field']);
  eq('settings null 清空', validateSettingsPatch({ quiet_hours: null, target_score: null }), { target_score: null, quiet_hours: null });
  for (const [name, b] of [['target_score 501', { target_score: 501 }], ['target_score 小数', { target_score: 400.5 }], ['target_score 字符串', { target_score: '400' }],
    ['exam_date 2026-02-30', { exam_date: '2026-02-30' }], ['coach_frequency low', { coach_frequency: 'low' }], ['quiet_hours 25:00', { quiet_hours: { start: '25:00', end: '08:00' } }],
    ['quiet_hours 首尾相同', { quiet_hours: { start: '08:00', end: '08:00' } }], ['timezone 乱写', { timezone: 'Mars/Base' }], ['未知字段', { goals: {} }], ['空对象', {}]] as const)
    eq(`settings 校验 ${name} → 400`, bad(b), 'rejected');
  eq('streak 今天学了', streakOf(new Set(['2026-10-30', '2026-10-31', '2026-11-01']), '2026-11-01'), { streak: 3, includes_today: true });
  eq('streak 今天还没学从昨天数', streakOf(new Set(['2026-10-30', '2026-10-31']), '2026-11-01'), { streak: 2, includes_today: false });
  eq('streak 断了', streakOf(new Set(['2026-10-29']), '2026-11-01'), { streak: 0, includes_today: false });
  // 第 8 轮：建议文案「想…」（还没执行）；404/409 统一形状
  eq('建议：加任务', intentSummary(['在 11-02 的计划里加了「做 5 道基础题热身」', '更新了 11-02 计划的说明']), '想在 11-02 的计划里加「做 5 道基础题热身」');
  eq('建议：改数量', intentSummary(['11-02「重做错题」已从 3 道加到 5 道']), '想把 11-02 的「重做错题」从 3 道加到 5 道');
  eq('建议：只有说明', intentSummary(['更新了 11-02 计划的说明']), '想更新 11-02 计划的说明');
  eq('建议：切阶段', intentSummary(['复习阶段从「基础」切到「强化」']), '想把复习阶段从「基础」切到「强化」');
  eq('409 形状', normalizeHttpError(409, { message: '这条已经撤回过了', code: 'already_undone' }), { message: '这条已经撤回过了', code: 'already_undone', statusCode: 409, error: 'Conflict' , field: null });
  eq('400 只有 message → 补 field/code', normalizeHttpError(400, { message: 'cursor 无效', error: 'Bad Request', statusCode: 400 }), { message: 'cursor 无效', error: 'Bad Request', statusCode: 400, field: null, code: 'bad_request' });
  eq('400 带 field/code 原样', normalizeHttpError(400, { message: '缺少 question_id', field: 'question_id', code: 'missing_question_id' }), { message: '缺少 question_id', field: 'question_id', code: 'missing_question_id', statusCode: 400, error: 'Bad Request' });
  // 第 17 轮：body-parser 的英文错误 → 中文
  eq('坏 JSON → 请求格式不对', normalizeHttpError(400, { message: "Expected property name or '}' in JSON at position 1 (line 1 column 2)", error: 'Bad Request', statusCode: 400 }), { statusCode: 400, error: 'Bad Request', message: '请求格式不对', field: null, code: 'invalid_json' });
  eq('坏 JSON（老 Node 文案）', (normalizeHttpError(400, { message: 'Unexpected token } in JSON at position 9' }) as any).code, 'invalid_json');
  eq('自己写的中文 400 不被当成坏 JSON', (normalizeHttpError(400, { message: '缺少 question_id', code: 'missing_question_id', field: 'question_id' }) as any).code, 'missing_question_id');
  { const { normalizeBodyParserError } = require('../src/common/http-error.filter');
    eq('body-parser 坏 JSON', normalizeBodyParserError({ type: 'entity.parse.failed', status: 400, message: 'Unexpected token' }), { status: 400, body: { statusCode: 400, error: 'Bad Request', message: '请求格式不对', field: null, code: 'invalid_json' } });
    eq('body-parser 太大', normalizeBodyParserError({ type: 'entity.too.large', status: 413, message: 'request entity too large' })!.body.code, 'payload_too_large');
    eq('别的异常不管', normalizeBodyParserError(new Error('x')), null); }
  eq('413 → 中文', normalizeHttpError(413, { statusCode: 413, message: 'request entity too large' }), { statusCode: 413, message: '请求体太大了，拆成几次再传', error: 'Payload Too Large', field: null, code: 'payload_too_large' });
  { const { checkItem } = require('../src/answers/answers.controller');
    eq('question_id 类型', [checkItem({}), checkItem({ question_id: '' }), checkItem({ question_id: null }), checkItem({ question_id: 5 }), checkItem({ question_id: ['a'] }), checkItem({ question_id: 'math1-2024-01' })],
      ['missing_question_id', 'missing_question_id', 'missing_question_id', 'bad_question_id', 'bad_question_id', null]); }
  // 第 17 轮：每日复盘的「还没有…记录」按那天过没过换时态
  { const d1 = toPlaceholders('今天（11-04）做了 5 题，对 1 题、错 4 题，还没有学习时长记录。', '2026-11-04')!, d2 = toPlaceholders('今天（11-04）还没有作答记录。', '2026-11-04')!;
    eq('复盘占位符', [d1, d2], ['{{date:2026-11-04}}做了 5 题，对 1 题、错 4 题，{{dyt:2026-11-04|还没有学习时长记录|没有学习时长记录}}。', '{{date:2026-11-04}}{{dyt:2026-11-04|还没有作答记录|没有作答记录}}。']);
    eq('复盘占位符幂等', [toPlaceholders(d1, '2026-11-04'), toPlaceholders(d2, '2026-11-05')], [d1, d2]);
    eq('复盘当天 / 第二天 / 一周后', [renderDates(d2, '2026-11-04'), renderDates(d2, '2026-11-05'), renderDates(d1, '2026-11-05'), renderDates(d1, '2026-11-11')],
      ['今天（11-04）还没有作答记录。', '昨天（11-04）没有作答记录。', '昨天（11-04）做了 5 题，对 1 题、错 4 题，没有学习时长记录。', '11-04（周三）做了 5 题，对 1 题、错 4 题，没有学习时长记录。']);
    eq('复盘 bareDates', bareDates(d2), '11-04还没有作答记录。');
    eq('只有往后看的日期（|plan）不换时态', toPlaceholders('明天（11-05）先做一组 5 道基础题，还没有作答记录。', '2026-11-04'), '{{date:2026-11-05|plan}}先做一组 5 道基础题，还没有作答记录。');
    eq('扫描：过去那天还写「还没有」', [badDayLabels('昨天（11-04）还没有作答记录。', '2026-11-05').length > 0, badDayLabels('11-04（周三）做了 5 题，还没有学习时长记录。', '2026-11-11').length > 0, badDayLabels(renderDates(d1, '2026-11-11'), '2026-11-11')], [true, true, []]); }
  eq('404 英文 → 中文', (normalizeHttpError(404, { message: 'Cannot GET /x', error: 'Not Found', statusCode: 404 }) as any).code, 'not_found');
  // 修饰错题的时间词 = 筛选（今天 2026-11-01 周日）；排期词不算
  const wf = (t: string) => { const r = parseWrongFilter(t, '2026-11-01'); return r && [r.from, r.to, r.label]; };
  eq('筛：昨天的错题', wf('昨天的错题帮我排 1 道'), ['2026-10-31', '2026-10-31', '昨天']);
  eq('筛：今天做错的题', wf('今天做错的题明天帮我排 1 道'), ['2026-11-01', '2026-11-01', '今天']);
  eq('筛：上周的错题', wf('上周的错题排 2 道'), ['2026-10-19', '2026-10-25', '上周']);
  eq('筛：最近三天的错题', wf('最近三天的错题再做一遍'), ['2026-10-30', '2026-11-01', '最近 3 天']);
  eq('排期：昨天加 1 道错题', wf('昨天加 1 道错题'), null);
  eq('排期：明天排 3 道错题', wf('明天排 3 道错题'), null);
  // 建议消息标题按状态
  const it = (x: string) => ({ tool: 'updateDailyPlan', input: {}, summary: x });
  eq('建议 confirmed', proposalView({ status: 'confirmed', items: [it('想在 11-02 的计划里加「A」')], applied_items: [0] }).headline, '已在 11-02 的计划里加了「A」');
  eq('建议 dismissed', proposalView({ status: 'dismissed', items: [it('想在 11-02 的计划里加「A」')] }).headline, '已忽略，计划没改');
  eq('建议 部分确认', proposalView({ status: 'confirmed', items: [it('想在 11-02 的计划里加「A」'), it('想在 11-02 的计划里加「B」')], applied_items: [1] }).headline,
    '已改 1 处：已在 11-02 的计划里加了「B」；没改 1 处：在 11-02 的计划里加「A」');
  eq('建议 老数据过去时', proposalView({ status: 'confirmed', items: [it('在 10-31 的计划里加了「A」')] }).headline, '已在 10-31 的计划里加了「A」');
  // 过期建议（读时算）：目标日早于读者的学习日 → expired，标题以「已」开头，不再说「等你确认」
  {
    const pr = { status: 'pending', items: [{ tool: 'updateDailyPlan', input: { date: '2026-11-05' }, summary: '想在 {{date:2026-11-05}} 的计划里加「做 5 道基础题热身」' }] };
    eq('建议 目标日', proposalTargetDate(pr, '2026-11-04'), '2026-11-05');
    eq('建议 目标日（没日期 → 生成日 +1）', proposalTargetDate({ status: 'pending', items: [{ tool: 'switchPhase', input: {}, summary: '想切到强化阶段' }] }, '2026-11-04'), '2026-11-05');
    eq('建议 当天还没过期', proposalView(pr, { date: '2026-11-04' }, '2026-11-05').status, 'pending');
    const v = proposalView(pr, { date: '2026-11-04' }, '2026-11-12');
    eq('建议 过期 status', v.status, 'expired');
    eq('建议 过期标题', v.headline, '已过期，计划没动。原本想在 {{date:2026-11-05}} 的计划里加「做 5 道基础题热身」。');
    eq('建议 过期不说等你确认', /等你确认|还没执行/.test(`${v.headline}${v.details}`), false);
    // 第 13 轮：details 不能括号套括号（日期渲染出来自带（），模板再套一层成了「建议的日子（11-03（周二））」）
    eq('建议 过期详情渲染', ['2026-11-06', '2026-11-08', '2026-11-12'].map((d) => renderDates(v.details!, d).split('，')[0]),
      ['建议安排在昨天（11-05）', '建议安排在周四（11-05）', '建议安排在11-05（周四）']);
    eq('建议 过期详情没有括号套括号', ['2026-11-06', '2026-11-12'].map((d) => badDayLabels(renderDates(v.details!, d), d)), [[], []]);
    eq('建议 已确认不判过期', proposalView({ ...pr, status: 'confirmed', applied_items: [0] }, { date: '2026-11-04' }, '2026-11-12').status, 'confirmed');
    eq('建议 不给 today 不判过期', proposalView(pr, { date: '2026-11-04' }).status, 'pending');
  }
  eq('自然周 周一', weekOf('2026-11-02').label, '11-02–11-08');
  eq('自然周 周日', weekOf('2026-11-08').label, '11-02–11-08');
  eq('自然周 跨月', weekOf('2026-11-01').label, '10-26–11-01');
  // 小问分值来源：题目自带 official / kp_tags 补的 estimated（条目可改）/ 平均拆 even_split / 没分值 null
  eq('subScoresSourceOf 默认 estimated', [subScoresSourceOf(), subScoresSourceOf('official'), subScoresSourceOf(undefined, 'official'), subScoresSourceOf('bogus')], ['estimated', 'official', 'official', 'estimated']);
  eq('subScoresSourceFor', [
    subScoresSourceFor([{ score: 10 }], [{ score: 10 }]),
    subScoresSourceFor([{ score: 5 }, { score: 7 }], [{}, {}]),
    subScoresSourceFor([{ score: 5 }, { score: 7 }], [{}, {}], 'official'),
    subScoresSourceFor(scorePlan({ score: 12, sub_questions: [{ number: 1 }, { number: 2 }] }).subs, [{}, {}]),
    subScoresSourceFor([{ score: null }], [{}]),
  ], ['official', 'estimated', 'official', 'even_split', null]);
  // 计分方式优先级：kp_tags 明写 score_by_whole=true > kp_tags 明写 sub_scores > kp_tags score_by_whole=false > 题目 JSON > 自动识别证明题
  const proof2 = { type: 'essay', sub_questions: [{ stem: '证明 A' }, { stem: '证明 B' }] }, calc2 = { type: 'essay', sub_questions: [{ stem: '求 a' }, { stem: '求 b' }] };
  eq('resolveScoreByWhole', [
    resolveScoreByWhole({ q: proof2 }), resolveScoreByWhole({ q: proof2, tagSubScores: [5, 5] }), resolveScoreByWhole({ q: calc2, tagScoreByWhole: true, tagSubScores: [5, 5] }),
    resolveScoreByWhole({ q: proof2, tagScoreByWhole: false }), resolveScoreByWhole({ q: calc2, jsonScoreByWhole: true }), resolveScoreByWhole({ q: calc2 }),
  ].map((r) => `${r.score_by_whole}/${r.source}`), ['true/auto_proof', 'false/kp_tags.sub_scores', 'true/kp_tags.score_by_whole', 'false/kp_tags.score_by_whole', 'true/question_json', 'false/auto_proof']);
  // 小问缺分值：整题计分的题不提醒；按小问计分且有小问没分值才提醒
  const miss = (q: any) => subScoreMissingProblems(q).map((x) => `${x.type}@${x.field}`);
  eq('subScoreMissingProblems', [
    miss({ ...proof2 }), miss({ ...calc2, score_by_whole: true }), miss({ ...proof2, score_by_whole: false, sub_questions: [{ stem: '证明 A', score: 5 }, { stem: '证明 B' }] }),
    miss({ ...calc2, score_by_whole: false, sub_questions: [{ score: 5 }, { score: 5 }] }), miss({ type: 'essay', sub_questions: [{ stem: '求 a' }] }),
  ], [[], [], ['sub_question_score_missing@sub_questions[1]'], [], ['sub_question_score_missing@sub_questions[0]']]);
  // 校对记录的答案：只认最新一条（at 排序，同一时间取文件里靠后的）；最新的不带 answer → 用题目文件的答案，旧记录的 answer 作废
  const rv = (line: number, at: string, answer?: string[]) => ({ id: 'q', status: 'confirmed', by: '用户', at, atMs: Date.parse(at), line, answer } as any);
  const ar = (recs: any[]) => { const q: any = { id: 'q', answer: ['$\\frac{11}{9}$'] }; const r = applyReviews(q, recs)!; return [q.answer[0], r.answerChanged, r.answerTo ?? null]; };
  eq('applyReviews 最新一条不带 answer → 用题目文件答案', ar([rv(1, '2026-11-01T05:00-08:00', ['A']), rv(2, '2026-11-01T05:10-08:00', ['11/9']), rv(3, '2026-11-01T07:51-08:00')]), ['$\\frac{11}{9}$', false, null]);
  eq('applyReviews 最新一条带 answer → 改写', ar([rv(1, '2026-11-01T05:00-08:00'), rv(2, '2026-11-01T05:10-08:00', ['11/9'])]), ['11/9', true, ['11/9']]);
  eq('applyReviews 同一时间取文件里靠后的', ar([rv(2, '2026-11-01T05:10-08:00'), rv(1, '2026-11-01T05:10-08:00', ['11/9'])]), ['$\\frac{11}{9}$', false, null]);
  eq('applyReviews 按 at 排序而不是文件顺序', ar([rv(1, '2026-11-01T06:00-08:00', ['B']), rv(2, '2026-11-01T05:00-08:00')]), ['B', true, ['B']]);
  // 真题例句合并：保留已有，同句去重，优先补没有的年份，最多 5 条，带 passage_id
  const ex = (y: number, n = 0) => ({ sentence: `s${y}-${n}`, year: y, question_id: null, passage_id: `english1-${y}-P-text1` });
  eq('mergeExamples', mergeExamples([{ sentence: 'old', year: 2015, question_id: 'q' }], [ex(2025), ex(2025, 1), ex(2024), ex(2023), ex(2022), { ...ex(2015), sentence: 'OLD ' }])
    .map((e) => `${e.sentence}/${e.passage_id ?? '-'}`), ['old/-', 's2025-0/english1-2025-P-text1', 's2024-0/english1-2024-P-text1', 's2023-0/english1-2023-P-text1', 's2022-0/english1-2022-P-text1']);
  eq('isBasic', [isBasic(['zk', 'gk'], 3000, null), isBasic(['gk', 'ky'], 5897, 4000), isBasic(['ky'], 137, null), isBasic(['ky', 'cet6'], null, 1200), isBasic(['cet6'], null, null)], [true, false, true, true, false]);
  eq('fixLemmas number≠numb', fixLemmas([{ word: 'numb', frequency: 23, years: [2017], forms: { number: 23 }, examples: [{ sentence: 'a number of', year: 2017 }] }]).map((v) => [v.word, v.frequency, v.examples?.length]), [['numb', 0, 0], ['number', 23, 1]]);
  eq('mergeExamples 幂等', JSON.stringify(mergeExamples(mergeExamples(null, [ex(2025), ex(2024)]), [ex(2025), ex(2024)])), JSON.stringify(mergeExamples(null, [ex(2025), ex(2024)])));
  // 去重窗口：明天排过的同一知识点练习，今天也不再提；窗口外的不算
  {
    const seen = newSeen('2026-11-01', '2026-11-08');
    addSeenTask(seen, '2026-11-02', { kind: 'practice', title: '练 3 道「函数的幂级数展开」', payload: { kp_path: 'math/x/函数的幂级数展开' } });
    addSeenTask(seen, '2026-11-20', { kind: 'practice', title: '练 3 道「B」', payload: { kp_path: 'math/x/B' } });
    const item = (date: string, kp: string) => ({ tool: 'updateDailyPlan', input: { date, add_tasks: [{ kind: 'practice', title: 'x', payload: { kp_path: kp } }] } });
    eq('去重：明天已排 → 今天重复', isDupItem(seen, item('2026-11-01', 'math/x/函数的幂级数展开')), true);
    eq('去重：窗口外的不算', isDupItem(seen, item('2026-11-01', 'math/x/B')), false);
    addSeenTask(seen, '2026-11-02', { kind: 'redo_wrong', title: '重做', payload: { question_ids: ['q1', 'q2'] } });
    eq('去重：重做题目被明天覆盖', isDupItem(seen, { tool: 'updateDailyPlan', input: { date: '2026-11-01', add_tasks: [{ kind: 'redo_wrong', title: 'r', payload: { question_ids: ['q2'] } }] } }), true);
  }
  // 任务 reason：按真实设置；测试触发不提频率
  for (const job of ['nightly', 'weekly', 'midday', 'phase_check', 'proposal'] as const) {
    for (const freq of ['less', 'normal', 'more', 'ask']) {
      const r = jobReason(job, { freq }), f = jobReason(job, { freq, forced: true });
      if (/「多」/.test(r) && freq !== 'more') eq(`reason ${job}/${freq} 冒用「多」`, r, '不该提「多」');
      if (/「少」/.test(r) && freq !== 'less') eq(`reason ${job}/${freq} 冒用「少」`, r, '不该提「少」');
      if (/先问我/.test(r) && freq !== 'ask') eq(`reason ${job}/${freq} 冒用「先问我」`, r, '不该提「先问我」');
      if (/提醒频率|先问我|「多」|「少」/.test(f) || !f.endsWith('（测试触发）')) eq(`forced reason ${job}/${freq}`, f, '中性 +（测试触发）');
    }
  }
  eq('reason midday/more', jobReason('midday', { freq: 'more' }), '提醒频率选了「多」：中午看一眼进度');
  eq('reason midday/ask', jobReason('midday', { freq: 'ask' }), '中午看一眼今天的进度');
  eq('reason nightly/less', /「少」/.test(jobReason('nightly', { freq: 'less' })), true);
  // 学习时长 / 漏值
  eq('时长 null', minutesText(null), '还没有学习时长记录');
  eq('时长 NaN', minutesText(NaN), '还没有学习时长记录');
  eq('时长 12', minutesText(12), '约 12 分钟');
  eq('漏值检查', [hasLeak('约 null 分钟'), hasLeak('undefined 道'), hasLeak('NaN%'), hasLeak('约 12 分钟')], [true, true, true, false]);
  // 时间词按当地时间
  eq('当地时间说法', [laterToday(7), laterToday(14), laterToday(20)], ['今天', '今天下午', '今晚']);
  eq('当地时间开头', [dayGreeting(2), dayGreeting(7), dayGreeting(12), dayGreeting(15), dayGreeting(23)], ['夜深了', '早上好', '中午了', '下午好', '晚上好']);
  eq('标点连用', [badPunct('排 5 道基础题」。，这次'), badPunct('好，。'), badPunct('好。。'), badPunct('好；。'), badPunct('真的？！'), badPunct('……然后。'), badPunct('「a」，b。')], [true, true, true, true, false, false, false]);
  eq('文字检查', [textProblem('约 null 分钟'), textProblem('a。，b'), textProblem('正常。')], ['leak', 'punct', null]);
  eq('去句尾标点', [clause('上次：排 5 道基础题」。'), clause('好的，')], ['上次：排 5 道基础题」', '好的']);
  {
    const seen = newSeen('2026-11-01', '2026-11-08');
    const redo = { tool: 'updateDailyPlan', input: { date: '2026-11-01', add_tasks: [{ kind: 'redo_wrong', title: 'r', payload: { question_ids: ['q1'] } }] } };
    const kp = { tool: 'updateDailyPlan', input: { date: '2026-11-01', add_tasks: [{ kind: 'practice', title: 'k', payload: { kp_path: 'a/b' } }] } };
    addSeenItem(seen, redo, 'dismissed');
    addSeenTask(seen, '2026-11-02', { kind: 'practice', title: 'k', payload: { kp_path: 'a/b' } });
    eq('去重原因：忽略过', dupSources(seen, redo), ['dismissed']);
    eq('去重原因：计划里有', dupSources(seen, kp), ['planned']);
    eq('跳过文案：只忽略过', skipReason([['dismissed']]), { code: 'dismissed', text: '没有新的建议：这条你已经忽略过了，不再提' });
    eq('跳过文案：只计划里有', skipReason([['planned']]).code, 'planned');
    eq('跳过文案：混合', skipReason([['dismissed'], ['planned']]), { code: 'mixed', text: '没有新的建议：1 条你已经忽略过了，1 条计划里已经有了，都不再提' });
    eq('跳过文案：什么都没有', skipReason([]), { code: 'nothing', text: '没有新的建议：计划里该有的都有了，这次不打扰你' });
    eq('强制中午不说中午', /中午/.test(jobReason('midday', { freq: 'ask', forced: true })), false);
  }
  // why_changed 按任务拼，后来的不覆盖前面的
  eq('why 按任务', composeWhy('先重做 1 道。', [{ why_changed: '加 5 道基础题热身。', status: 'todo', updated_at: '2026-11-01T01:00:00Z' }, { why_changed: '先重做 1 道。', status: 'todo', updated_at: '2026-11-01T02:00:00Z' }]), '先重做 1 道。加 5 道基础题热身。');
  eq('why 老数据', composeWhy('老说明', [{ status: 'todo', changed_by_agent: true }]), '老说明');
  eq('why 空计划不带别的日子', [composeWhy('是从今天做错的题里挑的。', []), whyOf('x', []).latest], [null, null]);
  eq('why latest 和 all 一致', whyOf(null, [{ why_changed: 'a。', status: 'todo', updated_at: '2026-11-01T01:00:00Z' }, { why_changed: 'b。', status: 'todo', updated_at: '2026-11-01T02:00:00Z' }]), { all: 'b。a。', latest: 'b。' });
  eq('why 跳过的不算', composeWhy(null, [{ why_changed: 'a', status: 'skipped' }]), null);
  // 学习日：当地 04:00 换天（第 10 轮 N3）
  eq('DAY_START_HOUR=4', DAY_START_HOUR, 4);
  eq('上海 11-02 00:04 → 学习日 11-01', studyDate(new Date('2026-11-01T16:04:00Z'), 'Asia/Shanghai'), '2026-11-01');
  eq('上海 11-02 03:59 → 11-01；04:00 → 11-02', [studyDate(new Date('2026-11-01T19:59:00Z'), 'Asia/Shanghai'), studyDate(new Date('2026-11-01T20:00:00Z'), 'Asia/Shanghai')], ['2026-11-01', '2026-11-02']);
  eq('洛杉矶 11-02 02:00 → 11-01', studyDate(new Date('2026-11-02T10:00:00Z'), 'America/Los_Angeles'), '2026-11-01');
  eq('洛杉矶 夏令时结束那天 01:30 → 前一天', studyDate(new Date('2026-11-01T08:30:00Z'), 'America/Los_Angeles'), '2026-10-31');
  eq('上海学习日开始 = 当地 04:00', startOfStudyDay('2026-11-02', 'Asia/Shanghai').toISOString(), '2026-11-01T20:00:00.000Z');
  eq('studyDaySql', studyDaySql('a.at', '$2'), "((a.at AT TIME ZONE $2) - interval '4 hours')::date");
  eq('relativeDay', ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', null].map((d) => relativeDay(d as any, '2026-11-01')), ['前天', '昨天', '今天', '明天', '后天', null, null]);
  eq('dayLabel', [dayLabel('2026-11-02', '2026-11-01'), dayLabel('2026-11-01', '2026-11-01'), dayLabel('2026-11-20', '2026-11-01')], ['明天（11-02）', '今天（11-01）', '11-20（周五）']);
  // 第 11 轮：日期占位符 / 渲染 / 引号层级 / 凌晨说明
  eq('toPlaceholders', toPlaceholders('在 11-02 的计划里加了；今天（11-01）；周三（11-04）；11-20（周五）；本周（10-26–11-01）；凌晨 4 点前还算 11-01 这一天；math1-2024-01；2026-11-01；ab12-05', '2026-11-01'),
    '在 {{date:2026-11-02}} 的计划里加了；{{date:2026-11-01}}；{{date:2026-11-04}}；{{date:2026-11-20}}；{{week:2026-10-26|本周}}；凌晨 4 点前还算 11-01 这一天；math1-2024-01；2026-11-01；ab12-05');
  eq('toPlaceholders 跨年', [toPlaceholders('明天（01-01）', '2026-12-31'), toPlaceholders('12-31', '2027-01-01')], ['{{date:2027-01-01}}', '{{date:2026-12-31}}']);
  eq('toPlaceholders 幂等', toPlaceholders('{{date:2026-11-02}}', '2026-11-01'), '{{date:2026-11-02}}');
  eq('renderDates', ['2026-11-02', '2026-11-03', '2026-11-10'].map((d) => renderDates('想在 {{date:2026-11-02}} 的计划里加「x」', d)), ['想在今天（11-02）的计划里加「x」', '想在昨天（11-02）的计划里加「x」', '想在11-02（周一）的计划里加「x」']);
  // round12 P1/P3：两边空格都去掉；{{date:D|plan}} 时态
  eq('toPlaceholders |plan', [toPlaceholders('明天（11-02）先重做 1 道到期错题。', '2026-11-01'), toPlaceholders('{{date:2026-11-02}}先做', '2026-11-01'), toPlaceholders('明天（11-02）的计划', '2026-11-01')],
    ['{{date:2026-11-02|plan}}先重做 1 道到期错题。', '{{date:2026-11-02|plan}}先做', '{{date:2026-11-02}}的计划']);
  eq('renderDates |plan', ['2026-11-01', '2026-11-02', '2026-11-10'].map((d) => renderDates('{{date:2026-11-02|plan}}先重做 1 道到期错题。', d)),
    ['明天（11-02）先重做 1 道到期错题。', '今天（11-02）先重做 1 道到期错题。', '11-02（周一）当天计划重做 1 道到期错题。']);
  eq('badDayLabels 日期后空格 + 漏出的占位符', badDayLabels('在11-02（周一） 的计划；明天（11-03） 先做；{{date:2026-11-02}}', '2026-11-02'), ['（周一） 的', '11-03） 先', '{{date:2026-11-02}}']);
  eq('questionKind', ['那今天的单词还背吗', '今天还要做什么', '错题还剩几道', '离考试还有几天', '我这周进度怎么样', '今天只有一小时', '今天单词少背点', '帮我把错题排到明天', '今天只有一小时，单词还背吗', '今天能不能少练点？'].map((t) => questionKind(t)),
    ['words', 'todo', 'wrong_left', 'exam_days', 'week', null, null, null, 'words', null]);
  eq('selfGradeCheck', [selfGradeCheck({ exam: 'english1', section: 'writing_a', type: 'essay' }, ['  ']), selfGradeCheck({ exam: 'english1', section: 'writing_b', type: 'essay' }, ['I think so.']),
    selfGradeCheck({ exam: 'english1', section: 'translation', type: 'essay', answer: ['one two three four five six seven eight nine ten'] }, ['a b c']), selfGradeCheck({ exam: 'math1', section: null, type: 'essay' }, ['x'])],
    [{ kind: 'writing_a', unanswered: true, word_count: 0, min_words: 50 }, { kind: 'writing_b', unanswered: false, word_count: 3, min_words: 80 }, { kind: 'translation', unanswered: false, word_count: 3, min_words: 3 }, null]);
  // 英一翻译是英译汉：作答和参考译文都按「汉字 + 英文词」数（和前端一致），参考译文是中文时 min_words 不再是 0
  eq('countUnits', [countUnits('社会在战后面临问题'), countUnits('The war ended.'), countUnits('GDP 增长了 5%'), countUnits('')], [9, 3, 4, 0]);
  {
    const tq = { exam: 'english1', section: 'translation', type: 'essay', answer: ['战争结束后，社会面临着入学率低、教育资源匮乏的问题，政府不得不重新规划整个教育体系并投入大量资金。'] };
    const c = selfGradeCheck(tq, ['The war ended.'])!;
    eq('selfGradeCheck 中文参考译文', [c.word_count, c.min_words > 10], [3, true]);
    eq('selfGradeFields 翻译字数太少评 full → word_count_low', selfGradeFields(tq, ['The war ended.'], 'full')!.self_grade_flags, ['word_count_low']);
    eq('selfGradeFields 中文译文够字数', selfGradeFields(tq, [tq.answer[0]], 'full')!.self_grade_flags, []);
    eq('selfGradeFields 没作答', selfGradeFields(tq, [], 'no_idea'), { word_count: 0, min_words: c.min_words, unanswered: true, self_grade_flags: [] });
    eq('selfGradeFields 作文仍数英文词', selfGradeFields({ exam: 'english1', section: 'writing_a', type: 'essay' }, ['亲爱的 Li Ming'], 'full'), { word_count: 2, min_words: 50, unanswered: false, self_grade_flags: ['word_count_low'] });
  }
  eq('pickModel', [pickModel('deepseek', 'chat', ['deepseek-v4-flash', 'deepseek-v4-pro'], 'deepseek-chat'), pickModel('deepseek', 'chat', ['deepseek-flash'], 'deepseek-flash'), pickModel('qwen', 'chat', ['qwen-plus', 'qwen-max-latest'], 'qwen-max')],
    ['deepseek-v4-flash', 'deepseek-flash', 'qwen-max-latest']);
  eq('renderDates 周X', [renderDates('{{date:2026-11-04}}', '2026-11-01'), renderDates('{{date:2026-11-03}}', '2026-11-01')], ['周三（11-04）', '后天（11-03）']);
  eq('nestQuotes', [nestQuotes('「已在明天（11-02）的计划里加了「练 3 道「变限积分」」」'), nestQuotes('加了「a」和「b」'), nestQuotes('「a『b』」')], ['「已在明天（11-02）的计划里加了『练 3 道变限积分』」', '加了「a」和「b」', '「a『b』」']);
  eq('earlyNote', [earlyNote(0, '2026-11-01'), earlyNote(3, '2026-11-01'), earlyNote(4, '2026-11-02')], ['凌晨 4 点前还算 11-01 这一天。', '凌晨 4 点前还算 11-01 这一天。', null]);
  eq('wantsEarlyNote', [wantsEarlyNote('好的', '今天只有一小时'), wantsEarlyNote('已记为粗心', '这题是手滑'), wantsEarlyNote('凌晨 4 点前还算 11-01 这一天。', '今天')], [true, false, false]);
  eq('withEarlyNote / appendNote', [withEarlyNote('已压到 60 分钟', 0, '2026-11-01', '今天只有一小时'), withEarlyNote('已压到 60 分钟', 5, '2026-11-02', '今天只有一小时'), appendNote('好。', null)],
    ['已压到 60 分钟。凌晨 4 点前还算 11-01 这一天。', '已压到 60 分钟', '好。']);
  eq('badDayLabels：今天说成明天的日期', badDayLabels('今天（11-02）的计划里已经有「x」；明天（11-02）', '2026-11-01'), ['今天（11-02）']);
  eq('badDayLabels：跨年', badDayLabels('明天（01-01）', '2026-12-31'), []);
  eq('badDayLabels：括号套括号', badDayLabels('建议的日子（11-03（周二））已经过去了；还有 3 天（从今天（11-02）算）；（2 分待自评）', '2026-11-02'), ['（11-03（周二））', '（从今天（11-02）算）']);
  eq('renderDates 兜底：（{{date}}）去掉外层括号', renderDates('建议的日子（{{date:2026-11-03}}）已经过去了', '2026-11-12'), '建议的日子11-03（周二）已经过去了');
  // 第 14 轮：周 / 倒计时时态（8 天后读旧周报）
  { const ph = toPlaceholders('本周（11-02–11-08）做了 3 题，当前阶段：基础，距考试 47 天。这周（11-02–11-08）', '2026-11-08') as string;
    eq('周/倒计时 占位符', ph, '{{week:2026-11-02|本周}}做了 3 题，{{wkt:2026-11-02|当前阶段|当时阶段}}：基础，{{countdown:47|asof=2026-11-08|距考试}}。{{week:2026-11-02|这周}}');
    eq('周/倒计时 渲染', ['2026-11-08', '2026-11-16'].map((d) => renderDates(ph, d)), ['本周（11-02–11-08）做了 3 题，当前阶段：基础，距考试 47 天。这周（11-02–11-08）', '那周（11-02–11-08）做了 3 题，当时阶段：基础，当时距考试 47 天。那周（11-02–11-08）']);
    eq('周/倒计时 幂等', toPlaceholders(ph, '2026-11-16'), ph);
    eq('离考试（…）还有', renderDates(toPlaceholders('离考试（2026-12-19，周六）还有 47 天', '2026-11-02') as string, '2026-11-10'), '当时离考试（2026-12-19，周六）还有 47 天');
    eq('扫描：旧周报', badDayLabels('本周（11-02–11-08）…距考试 47 天', '2026-11-16', '2026-11-02'), ['本周（11-02–11-08）', '距考试 47 天']);
    eq('扫描：当周写那周', badDayLabels('那周（11-02–11-08）', '2026-11-04'), ['那周（11-02–11-08）']); }
  // 第 15 轮（E1/E2）：周报 11-04（周三）生成、考试 12-19；当周读倒计时现算，周过了才「当时」；「下周重点」下周开始后改「当时定的下周重点」
  { const head = toPlaceholders('下周重点：补「变限积分」。', '2026-11-04') as string;
    const det = toPlaceholders('本周（11-02–11-08）做了 12 题，正确率 50%。当前阶段：强化，距考试 45 天。', '2026-11-04') as string;
    eq('E2 下周占位符', head, '{{nextweek:2026-11-09|下周重点}}：补「变限积分」。');
    eq('E2 旧写法也换', toPlaceholders('下周重点补「变限积分」。', '2026-11-04'), '{{nextweek:2026-11-09|下周重点}}：补「变限积分」。');
    eq('E2 幂等', toPlaceholders(head, '2026-11-12'), head);
    const R = (d: string) => [renderDates(head, d), renderDates(det, d)];
    eq('E1 当周（11-05）', R('2026-11-05'), ['下周重点：补「变限积分」。', '本周（11-02–11-08）做了 12 题，正确率 50%。当前阶段：强化，距考试 44 天。']);
    eq('E1 周日（11-08）', R('2026-11-08')[1], '本周（11-02–11-08）做了 12 题，正确率 50%。当前阶段：强化，距考试 41 天。');
    eq('E1 周过了（11-09）', R('2026-11-09'), ['当时定的下周重点：补「变限积分」。', '那周（11-02–11-08）做了 12 题，正确率 50%。当时阶段：强化，当时距考试 45 天。']);
    eq('E1/E2 8 天后（11-12）', R('2026-11-12'), ['当时定的下周重点：补「变限积分」。', '那周（11-02–11-08）做了 12 题，正确率 50%。当时阶段：强化，当时距考试 45 天。']);
    eq('扫描：当周现算不报错', badDayLabels(R('2026-11-05')[1], '2026-11-05', '2026-11-04'), []);
    eq('扫描：没周的旧复盘仍要「当时」', badDayLabels('距考试 45 天', '2026-11-05', '2026-11-04'), ['距考试 45 天']);
    eq('撤回成裸文字', bareDates(head), '下周重点：补「变限积分」。');
    for (const d of ['2026-11-05', '2026-11-09', '2026-11-12']) eq(`E1/E2 ${d} 无问题`, R(d).flatMap((t) => badDayLabels(t, d)), []); }
  // 第 16 轮（G1）：周报里「当前阶段」「还没有…记录」按那周时态：当周现在时，周过了「当时阶段」「没有…记录」
  { const det = toPlaceholders('本周（11-02–11-08）还没有作答记录，也还没有学习时长记录。当前阶段：基础，距考试 45 天。', '2026-11-04') as string;
    eq('G1 占位符', det, '{{week:2026-11-02|本周}}{{wkt:2026-11-02|还没有作答记录，也还没有学习时长记录|没有作答记录，也没有学习时长记录}}。{{wkt:2026-11-02|当前阶段|当时阶段}}：基础，{{countdown:45|asof=2026-11-04|距考试}} 天。'.replace(' 天。', '。'));
    eq('G1 幂等', toPlaceholders(det, '2026-11-12'), det);
    eq('G1 当周（11-05）', renderDates(det, '2026-11-05'), '本周（11-02–11-08）还没有作答记录，也还没有学习时长记录。当前阶段：基础，距考试 44 天。');
    eq('G1 周日（11-08 晚）', renderDates(det, '2026-11-08'), '本周（11-02–11-08）还没有作答记录，也还没有学习时长记录。当前阶段：基础，距考试 41 天。');
    eq('G1 周过了（11-09）', renderDates(det, '2026-11-09'), '那周（11-02–11-08）没有作答记录，也没有学习时长记录。当时阶段：基础，当时距考试 45 天。');
    const d2 = toPlaceholders('本周（11-02–11-08）做了 10 题，正确率 20%，还没有学习时长记录。最需要补的：极限。当前阶段：基础，距考试 45 天。', '2026-11-04') as string;
    eq('G1 只缺时长（11-12）', renderDates(d2, '2026-11-12'), '那周（11-02–11-08）做了 10 题，正确率 20%，没有学习时长记录。最需要补的：极限。当时阶段：基础，当时距考试 45 天。');
    eq('G1 撤回成裸文字', bareDates(d2), '本周（11-02–11-08）做了 10 题，正确率 20%，还没有学习时长记录。最需要补的：极限。当前阶段：基础，距考试 45 天。');
    eq('G1 没有周的文字不动', toPlaceholders('今天还没有作答记录。当前阶段：基础', '2026-11-04'), '今天还没有作答记录。当前阶段：基础');
    eq('G1 扫描：那周还写现在时', badDayLabels('那周（11-02–11-08）还没有学习时长记录。当前阶段：基础', '2026-11-09'), ['还没有学习时长记录', '当前阶段']);
    for (const d of ['2026-11-05', '2026-11-09', '2026-11-12']) eq(`G1 ${d} 无问题`, badDayLabels(renderDates(d2, d), d), []); }
  eq('renderDates 兜底：（{{date}}、{{date}}）', renderDates('最近两次复盘（{{date:2026-10-30}}、{{date:2026-10-31}}）你都没打开', '2026-11-12'), '最近两次复盘10-30（周五）、10-31（周六）你都没打开');
  // 模考计时：心跳间隔封顶 120 秒；调试时间往回拨（last_tick_at 在「现在」之后）不倒扣
  // 第 14 轮：模考按墙上时钟
  { const { examClock } = require('../src/exams/exam-clock');
    const st = '2026-11-02T00:00:00Z', base = { duration_seconds: 10800, started_at: st };
    eq('墙钟：30 分钟不发心跳也走', examClock(base, Date.parse('2026-11-02T00:30:00Z')).remaining_seconds, 9000);
    eq('墙钟：181 分钟到点', examClock(base, Date.parse('2026-11-02T03:01:00Z')).remaining_seconds, 0);
    const pl = [{ start: '2026-11-02T00:10:00Z', end: '2026-11-02T00:20:00Z' }, { start: '2026-11-02T00:40:00Z', end: null }];
    const c = examClock({ ...base, pause_log: pl }, Date.parse('2026-11-02T00:50:00Z'));
    eq('暂停不计时、次数不限', [c.elapsed_seconds, c.pause_count, c.paused_seconds, c.paused_now], [1800, 2, 1200, true]);
    const g = examClock(base, Date.parse('2026-11-02T01:00:00Z'), [[Date.parse('2026-11-02T00:50:00Z'), Date.parse('2026-11-02T01:30:00Z')]]);
    eq('停机补时只算考试期间', g.elapsed_seconds, 3000);
    eq('老场次：基线 + 从上线起算', examClock({ ...base, clock_origin: '2026-11-02T02:00:00Z', clock_baseline_seconds: 600 }, Date.parse('2026-11-02T02:10:00Z')).elapsed_seconds, 1200);
    eq('5xx 补时', examClock({ ...base, error_credit_seconds: 60 }, Date.parse('2026-11-02T00:10:00Z')).elapsed_seconds, 540); }
  // 第 15 轮：非连续作答 / 暂停超过 24 小时
  { const { nonContinuous, pausedTooLongSince } = require('../src/exams/exam-clock');
    eq('非连续：暂停 16 分钟 / 15 分钟 / 跨 04:00 不暂停（第 16 轮起不算）', [nonContinuous(960), nonContinuous(900), nonContinuous(0)], [true, false, false]);
    const log = [{ start: '2026-11-02T00:10:00Z', end: null }];
    eq('暂停 25 小时 → 冻结在暂停那一刻', [pausedTooLongSince(log, Date.parse('2026-11-03T01:10:00Z')), pausedTooLongSince(log, Date.parse('2026-11-03T00:00:00Z')), pausedTooLongSince([{ start: '2026-11-02T00:10:00Z', end: '2026-11-02T00:20:00Z' }], Date.parse('2026-11-05T00:00:00Z'))],
      [Date.parse('2026-11-02T00:10:00Z'), null, null]); }
  // 第 16 轮：模考列表分数拆分（英语客观 / 主观自评，字数太少的自评不计）
  { const { scoreSplit } = require('../src/exams/exam-summary');
    const per = [{ objective: true, score: 40, got: 30 }, { objective: true, score: 20, got: 10 }, { objective: false, score: 15, got: 9 }, { objective: false, score: 10, got: 6, self_grade_flags: ['word_count_low'] }, { objective: false, score: 15, got: 7.5, self_grade_flags: [] }];
    const N = { subjective_ai_score: null };
    eq('英一拆分：raw 含字数太少的、score = 客观 + raw', scoreSplit(per, 62.5), { objective_score: 40, objective_max: 60, subjective_self_score: 16.5, subjective_self_raw: 22.5, subjective_excluded_points: 6, subjective_excluded_count: 1, subjective_max: 40, ...N });
    { const x = scoreSplit(per, 62.5); eq('不变式 objective + raw == score', x.objective_score + x.subjective_self_raw, 62.5); }
    // 用户复测的那场：客观 0.5、自评 32（两道字数太少共 12）→ score 32.5
    { const p2 = [{ objective: true, score: 60, got: 0.5 }, { objective: false, score: 10, got: 8 }, { objective: false, score: 20, got: 12 }, { objective: false, score: 10, got: 6, self_grade_flags: ['word_count_low'] }, { objective: false, score: 0, got: 6, self_grade_flags: ['word_count_low'] }];
      const x = scoreSplit(p2, 32.5); eq('复测样例', [x.objective_score, x.subjective_self_score, x.subjective_self_raw, x.subjective_excluded_points, x.subjective_excluded_count, x.objective_score + x.subjective_self_raw], [0.5, 20, 32, 12, 2, 32.5]); }
    const math = [...Array(10)].map(() => ({ objective: true, score: 5, got: 5 })).concat([...Array(6)].map(() => ({ objective: true, score: 5, got: 0 })), [...Array(6)].map((_, i) => ({ objective: false, score: [10, 12, 12, 12, 12, 12][i], got: 6 })));
    eq('数一 2024：客观 80（选择 + 填空）、解答题自评 70，没有字数线', scoreSplit(math, 86), { objective_score: 50, objective_max: 80, subjective_self_score: 36, subjective_self_raw: 36, subjective_excluded_points: 0, subjective_excluded_count: 0, subjective_max: 70, ...N });
    eq('全是客观题 → subjective_* 全 null', scoreSplit([{ objective: true, score: 2, got: 2 }], 2), { objective_score: 2, objective_max: 2, subjective_self_score: null, subjective_self_raw: null, subjective_excluded_points: null, subjective_excluded_count: null, subjective_max: null, ...N });
    eq('全是自评题 → objective_* null', scoreSplit([{ objective: false, score: 20, got: 10 }], 10).objective_max, null);
    eq('没交卷：只给满分', scoreSplit(null, null, { objective_max: 56, subjective_max: 94 }), { objective_score: null, objective_max: 56, subjective_self_score: null, subjective_self_raw: null, subjective_excluded_points: null, subjective_excluded_count: null, subjective_max: 94, ...N });
    const { isObjectiveType } = require('../src/exams/exam-summary');
    eq('机判题型', ['single_choice', 'multiple_choice', 'fill_blank', 'match', 'essay', 'translation'].map(isObjectiveType), [true, true, true, true, false, false]); }
  eq('tickSeconds', [tickSeconds('2026-11-02T00:00:00Z', Date.parse('2026-11-02T00:00:30Z')), tickSeconds('2026-11-02T00:00:00Z', Date.parse('2026-11-02T01:00:00Z')),
    tickSeconds('2026-11-02T00:10:00Z', Date.parse('2026-11-02T00:00:00Z')), tickSeconds(null, Date.now())], [30, HEARTBEAT_CAP_SECONDS, 0, 0]);
  eq('errata 合格', validateErrata([{ printed: 'a', correct: 'b', note: 'n' }]).length, 0);
  eq('errata 不是数组', validateErrata({}).map((x) => x.type), ['errata_invalid']);
  eq('errata 缺 correct / 多字段', validateErrata([{ printed: 'a' }, { printed: 'a', correct: 'b', x: 1 }]).map((x) => x.field), ['errata[0]', 'errata[1]']);
  eq('errata 原样入库、坏的丢掉', cleanErrata([{ printed: 'a', correct: 'b' }, { printed: '' }]), [{ printed: 'a', correct: 'b' }]);
  // ── 讲解预生成质检（gen:explanations）──
  {
    const passage = { text: 'First paragraph opens here. The author argues that “plants can learn.”\n\nSecond paragraph {{3}} more detail. Nothing else here.' };
    const q: any = { id: 'english1-2099-03', exam: 'english1', year: 2099, number: 3, type: 'choice', section: 'reading_a', score: 2, stem: 'What does the author argue?', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }, { key: 'C', text: 'c' }, { key: 'D', text: 'd' }], answer: ['C'], sub_questions: null, solution: null, knowledge_points: [], passage, errata: [{ printed: 'leran', correct: 'learn', note: '原卷如此：leran 应为 learn' }] };
    const long = '这一步讲清楚为什么，对照原文逐句分析，排除干扰项，确认作者态度。'.repeat(3);
    const mk = (fin: string, last: string, ev: any = { paragraph: 1, sentence_index: 2, location: '第1段第2句', quote: 'The author argues that "plants can learn."' }) =>
      ({ steps: [{ n: 1, title: '定位', text: `定位：第1段第2句。${long}` }, { n: 2, title: '排除', text: `A、B、D 与原文不符，不选 A。${long}` }, { n: 3, title: '结论', text: last }], full_text: '', final_answer: { official: 'C', primary: fin, verifier: 'C' }, generated: { evidence: ev } });
    const codes = (r: any) => qualityCheck(q, r).failures.map((f) => f.code);
    eq('QC 通过（弯引号证据句、「不选 A」不算断言）', codes(mk('C', '综上，答案：C。')), []);
    eq('QC final_answer 字母不符', codes(mk('B', '综上，答案：B。')), ['final_answer_mismatch', 'answer_letter_conflict']);
    eq('QC 讲解里把别的字母说成答案', codes(mk('C', '所以选 D。')), ['answer_letter_conflict']);
    eq('QC NaN / null', codes(mk('C', '结果是 NaN，答案：C')), ['bad_text']);
    eq('QC 证据句不在原文', codes(mk('C', '答案：C', { quote: 'Plants never learn anything at all.' })), ['evidence_not_in_passage']);
    eq('QC 没有证据句', codes(mk('C', '答案：C', null)), ['evidence_missing']);
    eq('QC 完形空位 {{n}} 归一化后能匹配', codes(mk('C', '答案：C', { paragraph: 2, quote: 'Second paragraph ____ more detail.' })), []);
    // v3：完形允许空格所在句（填了答案 / 写成 ____）；新题型不变；完形专家「上下文复现」要点出来
    {
      const cp = { text: 'Phones {{2}} on batteries, and batteries can die faster than we realize. You should be able to {{14}} gaps in the tree line due to roads.\n\nHead toward these {{16}} to find a way out. Keep going.' };
      const rec = parseRecurrence('breaks 复现 gaps in the tree line');
      const cq: any = { ...q, id: 'english1-2099-16', number: 16, section: 'use_of_english', stem: 'Head toward these （16）______ to find a way out.', answer: ['D'], options: [{ key: 'A', content: 'posts' }, { key: 'B', content: 'links' }, { key: 'C', content: 'shades' }, { key: 'D', content: 'breaks' }], passage: cp, errata: [], recurrence: rec };
      const cmk = (quote: string, extra = '') => ({ ...mk('D', `综上，答案：D。${extra}`, { paragraph: 2, sentence_index: 1, location: '第2段第1句', quote }), final_answer: { official: 'D', primary: 'D', verifier: 'D' } });
      const cc = (r: any, qq: any = cq) => qualityCheck(qq, r).failures.map((f) => f.code).filter((c) => c !== 'answer_letter_conflict');
      eq('QC v3 完形：空格句填了答案 + 点出复现 → 通过', cc(cmk('Head toward these breaks to find a way out.', '上文 “gaps in the tree line” 复现。')), []);
      eq('QC v3 完形：空格写成 ____ 也行', cc(cmk('Head toward these ____ to find a way out.', 'breaks 复现上文 gaps in the tree line。')), []);
      eq('QC v3 完形：没点出复现 → recurrence_missing', cc(cmk('Head toward these breaks to find a way out.')), ['recurrence_missing']);
      eq('QC v3 完形：没有专家标注不查复现', cc(cmk('Head toward these breaks to find a way out.'), { ...cq, recurrence: null }), []);
      eq('QC v3 完形：编的句子照样不行', cc(cmk('Head toward the big breaks in order to escape.', 'gaps in the tree line')), ['evidence_not_in_passage']);
      eq('QC v3 新题型：拿空位（选项原文）当证据仍不行', cc(cmk('Head toward these breaks to find a way out.'), { ...cq, section: 'reading_b', type: 'match', recurrence: null }), ['evidence_not_in_passage']);
      eq('gapSentenceMatch 段落 / 至少 4 个原文词', [gapSentenceMatch(cp.text, 'Head toward these breaks to find a way out.'), gapSentenceMatch(cp.text, 'these breaks to')], [{ paragraph: 2, sentence: 1 }, null]);
      eq('parseRecurrence', [parseRecurrence('way 呼应 Which ... is downhill / head downhill').cues, parseRecurrence('In contrast 对照 majority were willing vs only five of the 30').cues, rec.answer_term],
        [[['Which', 'is downhill'], ['head downhill']], [['majority were willing'], ['only five of the 30']], 'breaks']);
      eq('hasPhraseInPassage 复现词句跨空格', [hasPhraseInPassage('less likely to come {{8}} with a cold', 'come down with a cold'), hasPhraseInPassage('the {{3}} of', 'decide on')], [true, false]);
      const gm = generatorMessages(cq).map((m) => m.content).join('\n');
      eq('完形提示词带专家复现 + v3', [PROMPT_VERSION, gm.includes('【上下文复现（行业专家标注）】breaks 复现 gaps in the tree line'), gm.includes('空格所在的那句'), generatorMessages({ ...cq, section: 'reading_b', type: 'match' }).map((m) => m.content).join('').includes('新题型空位本身不算证据')], ['explain-v3', true, true, true]);
    }
    eq('QC 段落号不对只警告', qualityCheck(q, mk('C', '答案：C', { paragraph: 2, quote: 'The author argues that "plants can learn."' })).warnings.map((w) => w.code), ['evidence_paragraph_mismatch']);
    eq('QC 太短 / 步数', codes({ steps: [{ n: 1, text: '答案：C' }], full_text: '', final_answer: { official: 'C', primary: 'C', verifier: 'C' }, generated: { evidence: mk('C', '').generated.evidence } }), ['step_count', 'too_short']);
    eq('QC 原卷误印没写「原卷如此」→ 警告', qualityCheck(q, mk('C', '原文 leran，答案：C')).warnings.map((w) => w.code), ['errata_not_marked']);
    eq('assertedLetters', [assertedLetters('故选 B；正确答案为（C）；不选 A；选项D错误'), assertedLetters('答案：G')], [['B', 'C'], ['G']]);
    eq('normEvidence', normEvidence('It’s  “fine” {{12}} — ok'), `it's "fine" - ok`);
    const tr: any = { ...q, id: 'english1-2099-47', type: 'translation', section: 'translation', answer: ['参考译文。'], options: null, passage: null };
    eq('QC 开放题不比字母、不要证据', qualityCheck(tr, { steps: [{ n: 1, text: '拆主干：'.padEnd(150, '析') }, { n: 2, text: '参考译文：参考译文。'.padEnd(80, '译') }], full_text: '', final_answer: { official: '参考译文。', primary: '参考译文。', verifier: '' } }).failures.map((f) => f.code), []);
    const qt = questionText(q);
    eq('questionText 带文章分段和误印', [qt.includes('[第2段] Second paragraph {{3}}'), qt.includes('原卷如此：leran 应为 learn')], [true, true]);
    eq('estimateTokens 中英', [estimateTokens('你好'), estimateTokens('abcdefghij')], [2, 3]);
    eq('resolveDeepseekModel 旧名映射', [resolveDeepseekModel('deepseek-reasoner'), resolveDeepseekModel('deepseek-chat'), resolveDeepseekModel('deepseek-flash', true)],
      [{ model: 'deepseek-flash', thinking: true }, { model: 'deepseek-flash', thinking: false }, { model: 'deepseek-flash', thinking: true }]);
    const ga = parseGenArgs(['--subject', 'english1', '--year', '2015-2025', '--dry-run', '--concurrency', '5']);
    eq('gen:explanations 参数', [ga.subject, ga.years, ga.dry, ga.force, ga.concurrency, parseGenArgs(['--year', '2022']).years], ['english1', [2015, 2025], true, false, 5, [2022, 2022]]);
    eq('referenceAnswer', [referenceAnswer({ type: 'translation', answer: ['译文'] }), referenceAnswer({ type: 'essay', answer: ['Dear', 'Sir'] }), referenceAnswer({ type: 'choice', answer: ['C'] }), referenceAnswer({ type: 'match', answer: ['E'] }), referenceAnswer({ type: 'fill_blank', answer: ['1'] }), referenceAnswer({ type: 'essay', answer: [] })],
      ['译文', 'Dear\n\nSir', null, null, null, null]);
  }
  // 第 16 轮：英语一专家讲解（tiku/explanations/english1_<year>_expert.jsonl，格式同数学）——小 fixture：加载、优先级、热加载、包版本
  { const fs = require('fs'), os = require('os'), path = require('path');
    const { expertExplanations, EXPERT_LABEL } = require('../src/ai/expert-explanations');
    const { officialSolution } = require('../src/ai/explain');
    const { packVersion, stepsText } = require('../src/offline/offline');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expl-')), prev = process.env.EXPLANATIONS_DIR;
    process.env.EXPLANATIONS_DIR = dir;
    try {
      fs.writeFileSync(path.join(dir, 'math1_2099_expert.jsonl'), JSON.stringify({ id: 'math1-2099-01', steps: ['数学一步'] }) + '\n');
      const q = (id: string, section: string, type: string) => ({ id, exam: 'english1', year: 2099, number: Number(id.slice(-2)), section, type, solution: null, answer: ['A'], sub_questions: null, review_status: 'confirmed' });
      const qs = [q('english1-2099-01', 'use_of_english', 'choice'), q('english1-2099-21', 'reading_a', 'choice'), q('english1-2099-41', 'reading_b', 'match'), q('english1-2099-46', 'translation', 'translation'), q('english1-2099-52', 'writing_b', 'essay')];
      const before = qs.map((x) => officialSolution(x as any));
      eq('英一专家：文件没来之前 pending', before.every((x) => x === null), true);
      const v0 = packVersion({ questions: qs.map((x, i) => ({ id: x.id, explanation_status: before[i] ? 'ready' : 'pending', solution: stepsText(before[i]?.steps) })) });
      fs.writeFileSync(path.join(dir, 'english1_2099_expert.jsonl'), qs.map((x) => JSON.stringify({ id: x.id, steps: [`${x.section} 第一步`, '第二步'], remember: '记住' })).join('\n') + '\n');
      const after = qs.map((x) => officialSolution(x as any));
      eq('英一专家：完形 / 阅读 / 新题型 / 翻译 / 作文都读到（不只数学，热加载不用重启）', after.map((x) => x?.kind), ['expert', 'expert', 'expert', 'expert', 'expert']);
      eq('英一专家：出处一句', after[3]?.label, EXPERT_LABEL);
      eq('英一专家：步骤 + 下次记住', after[4]?.steps.map((x: any) => x.text), ['writing_b 第一步', '第二步', '**下次记住**：记住']);
      eq('英一专家：数学文件照常', expertExplanations().has('math1-2099-01'), true);
      const v1 = packVersion({ questions: qs.map((x, i) => ({ id: x.id, explanation_status: after[i] ? 'ready' : 'pending', solution: stepsText(after[i]?.steps) })) });
      eq('英一专家：包版本跟着变', v0 !== v1, true);
    } finally { if (prev == null) delete process.env.EXPLANATIONS_DIR; else process.env.EXPLANATIONS_DIR = prev; fs.rmSync(dir, { recursive: true, force: true }); } }
  // 第 16 轮：题包 expires_at = 用户时区下一个 04:00
  { const { studyDayEnd } = require('../src/common/time');
    const E = (at: string, tz: string) => [studyDate(new Date(at), tz), studyDayEnd(new Date(at), tz).toISOString()];
    eq('过期：02:05+08（学习日 11-01）', E('2026-11-02T02:05:00+08:00', 'Asia/Shanghai'), ['2026-11-01', '2026-11-01T20:00:00.000Z']);
    eq('过期：04:01+08', E('2026-11-02T04:01:00+08:00', 'Asia/Shanghai'), ['2026-11-02', '2026-11-02T20:00:00.000Z']);
    eq('过期：23:59+08', E('2026-11-02T23:59:00+08:00', 'Asia/Shanghai'), ['2026-11-02', '2026-11-02T20:00:00.000Z']);
    eq('过期：洛杉矶用户同一时刻 02:05+08（当地 11-01 10:05，冬令时）', E('2026-11-02T02:05:00+08:00', 'America/Los_Angeles'), ['2026-11-01', '2026-11-02T12:00:00.000Z']);
    eq('过期：洛杉矶夏令时结束当天凌晨 01:30', E('2026-11-01T01:30:00-07:00', 'America/Los_Angeles'), ['2026-10-31', '2026-11-01T12:00:00.000Z']);
    eq('过期：伦敦 03:59', E('2026-11-02T03:59:00Z', 'Europe/London'), ['2026-11-01', '2026-11-02T04:00:00.000Z']); }
  console.log(`UNIT ${fail ? 'FAILED' : 'OK'}: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

if (require.main === module) { const r = runUnitTests(); process.exitCode = r.fail ? 1 : 0; }
