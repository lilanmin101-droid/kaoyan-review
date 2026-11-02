import * as fs from 'fs';
import * as path from 'path';

/**
 * 只读加载 tiku/explanations/<科目>_<年份>_expert.jsonl（行业专家写的分步参考讲解，非官方解析）。
 * 每行：{id, steps: string[], remember?, by?, source?, verified?, at?}；同一 id 出现多次取最后一行。
 * english1_translations_expert.jsonl 是参考译文/范文（{id, answer}），给题库覆盖 answer 用，不是讲解，不读。
 * 按文件名+mtime+大小缓存，文件追加/新增后下一次请求自动重新读取，不需要重启。
 */
/** 分步讲解文件：math1_2024_expert.jsonl、english1_2025_expert.jsonl。译文文件不匹配这条 */
export const EXPERT_FILE_RE = /^[a-z0-9]+_\d{4}_expert\.jsonl$/;
/** 专家讲解对学生显示的出处，所有地方（讲解、思路、错题 PDF、mock、openapi）统一用这一句 */
export const EXPERT_LABEL = '行业专家参考解答（非官方解析）';

export interface ExpertExplanation { id: string; steps: string[]; remember?: string; by?: string; source?: string; verified?: string; at?: string; file: string }

let cache: { key: string; map: Map<string, ExpertExplanation> } | null = null;

export function explanationsDir() {
  return process.env.EXPLANATIONS_DIR || path.join(process.env.ASSETS_DIR || '/workspace/kaoyan/tiku', 'explanations');
}

export function expertExplanations(): Map<string, ExpertExplanation> {
  const dir = explanationsDir();
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => EXPERT_FILE_RE.test(f)).sort(); } catch { files = []; }
  const key = files.map((f) => { try { const st = fs.statSync(path.join(dir, f)); return `${f}:${st.mtimeMs}:${st.size}`; } catch { return f; } }).join('|');
  if (cache && cache.key === key) return cache.map;
  const map = new Map<string, ExpertExplanation>();
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line);
        const steps = Array.isArray(d.steps) ? d.steps.map((s: any) => (typeof s === 'string' ? s : s?.text ?? '')).filter((s: string) => s.trim()) : [];
        if (d.id && steps.length) map.set(d.id, { ...d, steps, file: f });
      } catch { /* 跳过坏行 */ }
    }
  }
  cache = { key, map };
  return map;
}
