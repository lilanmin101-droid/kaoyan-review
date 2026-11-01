import * as fs from 'fs';
import * as path from 'path';

/**
 * 完形「上下文复现」证据（行业专家标注）：只读 <ASSETS_DIR>/english1_<年份>_kp_tags.json 的 evidence 字段，
 * 形如 {"english1-2019-16": {"英语/完形填空/上下文复现": "breaks 复现 gaps in the tree line"}}。
 * 讲解提示词里带上它（要求讲解点出这处复现），质检核对 quote / 讲解步骤里有没有出现复现的词句。
 * 按文件 mtime + 大小缓存，专家改了文件下一次调用自动重读。
 */
export interface ClozeRecurrence {
  /** 专家原文，如「breaks 复现 gaps in the tree line」 */
  note: string;
  /** 答案那一侧（第一段英文），如 breaks */
  answer_term: string;
  /** 复现 / 呼应的词句：每个候选是若干片段（原文写 "Which ... is downhill" → 两段都要出现），候选之间任一命中即可 */
  cues: string[][];
}

const cache = new Map<string, { key: string; map: Map<string, string> }>();

function tikuDir() { return process.env.ASSETS_DIR || '/workspace/kaoyan/tiku'; }

function loadYear(exam: string, year: number): Map<string, string> {
  const f = path.join(tikuDir(), `${exam}_${year}_kp_tags.json`);
  let key = '';
  try { const st = fs.statSync(f); key = `${st.mtimeMs}:${st.size}`; } catch { return new Map(); }
  const hit = cache.get(f);
  if (hit && hit.key === key) return hit.map;
  const map = new Map<string, string>();
  try {
    const ev = JSON.parse(fs.readFileSync(f, 'utf8'))?.evidence ?? {};
    for (const [id, v] of Object.entries<any>(ev)) {
      const note = typeof v === 'string' ? v : v && typeof v === 'object' ? (v['英语/完形填空/上下文复现'] ?? Object.values(v).find((x) => typeof x === 'string')) : null;
      if (typeof note === 'string' && note.trim()) map.set(id, note.trim());
    }
  } catch { /* 坏文件当作没有 */ }
  cache.set(f, { key, map });
  return map;
}

/** 把专家的一句标注拆成：答案词 + 复现词句候选 */
export function parseRecurrence(note: string): ClozeRecurrence {
  // 按中文字符 / 中文标点切出英文片段
  const segs = String(note).split(/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+/).map((s) => s.trim()).filter((s) => /[A-Za-z0-9]/.test(s));
  const [answer_term = '', ...rest] = segs;
  const cues: string[][] = [];
  for (const seg of rest) {
    for (const alt of seg.split(/\s*\/\s*|\s+vs\.?\s+|\s*,\s*|\s*;\s*/i)) {
      const parts = alt.split(/\s*(?:\.{3}|…)\s*/).map((x) => x.replace(/^[\s'"“”‘’]+|[\s'"“”‘’.]+$/g, '').trim()).filter((x) => x.replace(/[^A-Za-z0-9]/g, '').length >= 3);
      if (parts.length) cues.push(parts);
    }
  }
  return { note: String(note).trim(), answer_term, cues };
}

/** 题目 → 专家复现标注（没有返回 null）。q.recurrence 显式给了（含 null）就用它（单测注入） */
export function clozeRecurrence(q: { id: string; exam: string; year: number; section?: string | null; recurrence?: ClozeRecurrence | null }): ClozeRecurrence | null {
  if (q.recurrence !== undefined) return q.recurrence;
  if (q.section !== 'use_of_english') return null;
  const note = loadYear(q.exam, Number(q.year)).get(q.id);
  return note ? parseRecurrence(note) : null;
}

/** 比对用：小写、只留字母数字和撇号 / 连字符，空白归一 */
export const tokensOf = (s: string) => ` ${String(s ?? '').replace(/\{\{\d+\}\}/g, ' ').replace(/[‘’`´]/g, "'").toLowerCase().replace(/[^a-z0-9'\-]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
/** 片段是否出现在文本里（整词；允许常见词尾变化 s / es / ed / d / ing） */
export function hasPhrase(text: string, phrase: string): boolean {
  const t = tokensOf(text), p = tokensOf(phrase).trim();
  if (!p) return false;
  if (t.includes(` ${p} `)) return true;
  const words = p.split(' ');
  const stem = (w: string) => w.replace(/(ing|ed|es|s|d)$/, '');
  const re = new RegExp(` ${words.map((w) => `${escapeRe(w.length > 4 ? stem(w) : w)}[a-z]{0,3}`).join(' ')} `);
  return re.test(t);
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 讲解文本里有没有点出这个复现候选（讲解引原句时空格写成 ____ 也认，同原文规则） */
export const cueHit = (text: string, cue: string[]) => cue.every((part) => hasPhraseInPassage(text, part));
/**
 * 片段在带空格的完形原文里出现：原文的空格 {{n}} 可以顶替片段里的词（如 "come down with a cold" 对 "come {{8}} with a cold"），
 * 但至少一半的词要原样出现（整段都落在空格里的不算）
 */
export function hasPhraseInPassage(passage: string, phrase: string): boolean {
  if (hasPhrase(passage, phrase)) return true;
  const GAP = 'qqgapqq';
  const t = tokensOf(String(passage ?? '').replace(/\{\{\d+\}\}/g, ` ${GAP} `));
  const words = tokensOf(phrase).trim().split(' ').filter(Boolean);
  if (words.length < 2) return false;
  const re = new RegExp(` ${words.map((w) => `(${escapeRe(w.length > 4 ? w.replace(/(ing|ed|es|s|d)$/, '') : w)}[a-z]{0,3}|${GAP})`).join(' ')} `, 'g');
  for (const m of t.matchAll(re)) {
    const literal = m.slice(1).filter((x) => x !== GAP).length;
    if (literal >= Math.ceil(words.length / 2)) return true;
  }
  return false;
}
/** 原文里真的有的复现候选（专家写的是概括、或复现词本身是别的空的答案时可能一个都没有 → 质检不强求） */
export const cuesInPassage = (r: ClozeRecurrence, passage: string) => r.cues.filter((c) => c.every((part) => hasPhraseInPassage(passage, part)));
