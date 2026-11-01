/**
 * 建议消息（kind=proposal）的标题 / 详情按状态生成：
 * pending「教练想做 N 处改动，等你确认后才执行：想…」；confirmed「已在 11-02 的计划里加了「…」」；
 * 部分确认「已改 k 处：…；没改 m 处：…」；dismissed「已忽略，计划没改」。读的时候也套用，库里的老数据一样显示对。
 */
/** 「想在 11-02 的计划里加「X」」→「已在 11-02 的计划里加了「X」」；老数据的过去时「在…加了…」→「已在…加了…」 */
export function doneSummary(x: string) {
  const s = x.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^想在 (\S+) 的计划里加「(.+)」$/))) return `已在 ${m[1]} 的计划里加了「${m[2]}」`;
  if ((m = s.match(/^想：(.+)$/))) return `已执行：${m[1]}`;
  if ((m = s.match(/^想(.+)$/))) return `已${m[1]}`;
  if (/^已/.test(s)) return s;
  if (/^在 /.test(s)) return `已${s}`;
  return `已执行：${s}`;
}
/** 没执行的那几处：去掉「想」，不说「已」 */
export function plainSummary(x: string) {
  const s = x.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^想在 (\S+) 的计划里加「(.+)」$/))) return `在 ${m[1]} 的计划里加「${m[2]}」`;
  if ((m = s.match(/^想：?(.+)$/))) return m[1];
  if ((m = s.match(/^在 (\S+) 的计划里加了「(.+)」$/))) return `在 ${m[1]} 的计划里加「${m[2]}」`;
  return s;
}
const split = (s: string) => s.split('；').map((x) => x.trim()).filter(Boolean);

/** 建议消息的显示：status（pending / confirmed / dismissed）+ 按状态的标题、详情 */
export function proposalView(p: any, fallback: { headline?: string | null; details?: string | null } = {}) {
  const v = proposalText(p, fallback);
  return { status: p && Array.isArray(p.items) ? (['confirmed', 'dismissed'].includes(p.status) ? p.status : 'pending') : null, ...v } as { status: string | null; headline: string | null; details: string | null };
}
function proposalText(p: any, fallback: { headline?: string | null; details?: string | null } = {}) {
  if (!p || !Array.isArray(p.items)) return { headline: fallback.headline ?? null, details: fallback.details ?? null };
  const items: string[][] = p.items.map((it: any) => split(String(it.summary ?? '')));
  const n = items.length;
  if (p.status === 'pending') {
    return { headline: `教练想做 ${n} 处改动，等你确认后才执行：${items.flat().join('；')}`.slice(0, 300),
      details: '你在「我的」里选了「先问我」，这些改动还没执行。点确认才会改；不需要就忽略。' };
  }
  if (p.status === 'dismissed') {
    return { headline: '已忽略，计划没改', details: `原来的建议：${items.flat().map(plainSummary).join('；')}。` };
  }
  const applied = new Set<number>(Array.isArray(p.applied_items) ? p.applied_items : items.map((_, k) => k));
  const yes = items.filter((_, k) => applied.has(k)).flat().map(doneSummary);
  const no = items.filter((_, k) => !applied.has(k)).flat().map(plainSummary);
  if (!no.length) return { headline: yes.join('；').slice(0, 300), details: '你确认后已经改好了；不想要的话可以在「教练改动记录」里撤回。' };
  if (!yes.length) return { headline: '计划没改：你没选要执行的改动', details: `没执行：${no.join('；')}。` };
  return { headline: `已改 ${yes.length} 处：${yes.join('；')}；没改 ${no.length} 处：${no.join('；')}`.slice(0, 300),
    details: `你只确认了其中 ${yes.length} 处，已经改好；另外 ${no.length} 处（${no.join('；')}）没执行，计划里没有。` };
}
