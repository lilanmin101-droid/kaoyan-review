#!/usr/bin/env python3
"""英语一真题词汇表（2015–2025）：从题库 JSON 的英文原文统计每个词元的出现次数、年份、真题原句。
来源文本：各年 passages 的 text（完形/新题型空格用正确选项回填）、阅读题干与选项、新题型选项、写作题面。
不含：参考译文、范文、解析（专家/中文内容）。
词形还原：ECDICT exchange 字段（0: 原形；p/d/i/3/s/r/t 变形）。去停用词、数字、专有名词（语料里只以大写形式出现且不在句首的词）。
用法：python3 pipeline/build_vocab.py → vocab/english1_exam_vocab.json, vocab/english1_exam_vocab_summary.md, vocab/english1_new_words.csv
"""
import csv, json, os, re, sys, html, collections, unicodedata
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ECD = '/workspace/kaoyan/data/ecdict/ecdict.csv'
YEARS = range(2015, 2026)
csv.field_size_limit(10**9)

STOP = set("""a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves
also just may might must shall will would can could yet still even ever every many much one two three four five six seven eight nine ten first second third etc mr mrs ms dr vs per via s t ll re ve d m o e g i.e e.g yes oh ok
a b c d e f g h j k l n p q r u v w x y z""".split())

# ---- ECDICT：词表 + 变形→原形 ----
ky, known, lemma_of, TAGS = set(), set(), {}, {}
EXT = {'p', 'd', 'i', '3', 's', 'r', 't'}
with open(ECD, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        w = r['word']
        if not re.fullmatch(r"[A-Za-z][A-Za-z'\-]*", w or ''): continue
        lw = w.lower(); known.add(lw)
        TAGS.setdefault(lw, (r['tag'] or '').split())
        if 'ky' in (r['tag'] or '').split(): ky.add(lw)
        ex = dict(x.split(':', 1) for x in (r['exchange'] or '').split('/') if ':' in x)
        for k, v in ex.items():
            if k in EXT and v and v.lower() != lw and re.fullmatch(r"[a-z'\-]+", v.lower()):
                lemma_of.setdefault(v.lower(), lw)       # 原形行列出的变形
        if '0' in ex and ex.get('1') and set(ex['1']) & EXT:
            lemma_of[lw] = ex['0'].lower()               # 变形行指回原形（以此为准）
# 原形要么在 ky 里，要么在 ECDICT 里；避免 'better'→'good'、'data'→'datum' 这类可争议的映射
KEEP = {'according', 'data', 'media', 'news', 'means', 'species', 'series', 'better', 'best', 'worse', 'worst', 'less', 'least', 'more', 'most', 'further', 'others', 'lives', 'goods', 'arms', 'savings', 'earnings', 'politics', 'economics', 'physics', 'ethics', 'statistics', 'humanities'}
def lemma(w):
    if w in KEEP or (w in ky and w not in lemma_of): return w
    l = lemma_of.get(w)
    if l and (l in known): return l
    return w

def N(t):
    t = unicodedata.normalize('NFKC', html.unescape(t or ''))
    t = re.sub(r'<[^>]+>', '', t)
    for a, b in [('’', "'"), ('‘', "'"), ('“', '"'), ('”', '"')]: t = t.replace(a, b)
    return t

def fill(text, ans):  # {{n}} → 正确选项内容
    return re.sub(r'\{\{(\d+)\}\}', lambda m: ans.get(int(m.group(1)), ' '), text)

def sentences(t):
    t = re.sub(r'\s+', ' ', t).strip()
    return [s.strip() for s in re.split(r'(?<=[.!?])["\')\]]?\s+(?=["\'(\[]?[A-Z0-9])', t) if s.strip()]

# ---- 语料 ----
units, seen = [], set()   # (year, passage_id, question_id, sentence)
for y in YEARS:
    Q = json.load(open(f'{ROOT}/english1_{y}.json')); P = json.load(open(f'{ROOT}/english1_{y}_passages.json'))
    ans = {}
    for q in Q:
        a = q.get('answer') or []
        a = a[0] if isinstance(a, list) and a else a
        if isinstance(a, str) and q.get('options'):
            c = next((o['content'] for o in q['options'] if o['key'] == a), None)
            if c and q['section'] in ('use_of_english',) or (c and q['section'] == 'reading_b' and len(c.split()) < 25): ans[q['number']] = N(c)
    def add(text, pid=None, qid=None):
        for s in sentences(N(text)):
            k = re.sub(r'\W+', ' ', s.lower()).strip()
            if len(k) < 3 or k in seen: continue
            seen.add(k); units.append((y, pid, qid, s))
    for p in P:
        if p['section'] in ('translation', 'use_of_english', 'reading_a', 'reading_b'):
            add(fill(p.get('text') or '', ans), pid=p['id'])
    for q in Q:
        sec = q['section']
        if sec == 'use_of_english': continue
        stem = re.sub(r'\{\{\d+\}\}|_{2,}|（\d+）', ' ', q.get('stem') or '')
        stem = re.sub(r'^\d+\.\s*Directions:\s*', '', stem)
        if re.search(r'[\u4e00-\u9fff]', stem): stem = re.sub(r'[^\x00-\x7f’‘“”—–]+', ' ', stem)
        if sec in ('reading_a', 'writing_a', 'writing_b'): add(stem, pid=q.get('passage_id'), qid=q['id'])
        if sec in ('reading_a', 'reading_b'):
            for o in q.get('options') or []: add(o['content'], pid=q.get('passage_id'), qid=q['id'])

# ---- 专有名词判定 ----
lower_seen, cap_noninitial = collections.Counter(), collections.Counter()
TOK = re.compile(r"(?<![0-9])[A-Za-z]+(?:'[a-z]+)?(?![0-9A-Za-z])")
for _, _, _, s in units:
    for i, m in enumerate(TOK.finditer(s)):
        w = m.group(0)
        if w[0].islower(): lower_seen[w.lower()] += 1
        elif i > 0 and not w.isupper(): cap_noninitial[w.lower()] += 1
def proper(w_raw, i):
    lw = w_raw.lower()
    if w_raw[0].islower(): return False
    if w_raw.isupper() and len(w_raw) > 1: return True          # 缩写：RSC、AI、MPA
    if lower_seen[lw]: return False                               # 语料里也有小写用法
    if i == 0: return lw not in known                              # 句首：查词典
    return True

stats = collections.defaultdict(lambda: {'count': 0, 'years': set(), 'forms': collections.Counter(), 'ex': []})
dropped = collections.Counter(); total_tokens = 0
for y, pid, qid, s in units:
    nw = len(s.split())
    for i, m in enumerate(TOK.finditer(s)):
        raw = m.group(0); w = raw.lower()
        if w.endswith("'s"): w = w[:-2]
        if "'" in w: dropped['contraction'] += 1; continue
        if w in STOP: dropped['stopword'] += 1; continue
        if proper(raw, i): dropped['proper'] += 1; continue
        l = lemma(w)
        if l not in known: dropped['unknown'] += 1; continue
        if l in STOP: dropped['stopword'] += 1; continue
        total_tokens += 1
        st = stats[l]; st['count'] += 1; st['years'].add(y); st['forms'][w] += 1
        st['ex'].append((y, pid, qid, s, nw))

def pick(ex):
    out, yrs, used = [], set(), set()
    good = [e for e in ex if 8 <= e[4] <= 45] or ex
    for pass_ in (0, 1):
        for e in sorted(good, key=lambda e: (-e[0], abs(e[4] - 20))):
            if len(out) == 3: break
            if e[3] in used: continue
            if pass_ == 0 and e[0] in yrs: continue
            out.append(e); yrs.add(e[0]); used.add(e[3])
    return [{'sentence': e[3], 'year': e[0], 'question_id': e[2], 'passage_id': e[1]} for e in out]

rows = []
for l, st in stats.items():
    rows.append({'word': l, 'frequency': st['count'], 'years': sorted(st['years']), 'year_count': len(st['years']),
                 'forms': dict(st['forms'].most_common()), 'in_word_bank': l in ky, 'ecdict_tags': TAGS.get(l, []), 'level': ('ky' if l in ky else 'basic' if set(TAGS.get(l, [])) & {'zk', 'gk'} else 'cet' if set(TAGS.get(l, [])) & {'cet4', 'cet6'} else 'beyond'), 'examples': pick(st['ex'])})
rows.sort(key=lambda r: (-r['frequency'], r['word']))
os.makedirs(f'{ROOT}/vocab', exist_ok=True)
meta = {'source': 'english1 2015–2025 题库 JSON（/workspace/tiku/english1_<year>.json 与 _passages.json）',
        'lemmatizer': 'ECDICT exchange', 'word_bank': 'ECDICT tag=ky（与后端 words 表同源）',
        'excluded': '停用词、数字、专有名词/缩写、ECDICT 未收录的词；不含参考译文/范文',
        'examples_shape': '[{sentence, year, question_id, passage_id}]（question_id/passage_id 可能为 null）'}
json.dump({'meta': meta, 'words': rows}, open(f'{ROOT}/vocab/english1_exam_vocab.json', 'w'), ensure_ascii=False, indent=1)

bank_hit = [r for r in rows if r['in_word_bank']]
tok_bank = sum(r['frequency'] for r in bank_hit)
new = [r for r in rows if not r['in_word_bank']]
with open(f'{ROOT}/vocab/english1_new_words.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['word', 'level', 'frequency', 'year_count', 'years', 'example'])
    for r in new: w.writerow([r['word'], r['level'], r['frequency'], r['year_count'], ' '.join(map(str, r['years'])), r['examples'][0]['sentence'] if r['examples'] else ''])
S = [f'# 英语一真题词汇统计（2015–2025）', '',
     f'- 句子单元 {len(units)}，计入词次 {total_tokens}，词元 {len(rows)}',
     f'- 剔除：' + '，'.join(f'{k} {v}' for k, v in dropped.most_common()),
     f'- 词库（ECDICT ky，{len(ky)} 词）在真题中出现的：{len(bank_hit)} 个（{len(bank_hit)/len(ky):.1%}）',
     f'- 真题词次被词库覆盖：{tok_bank}/{total_tokens}（{tok_bank/total_tokens:.1%}）；真题词元被词库覆盖：{len(bank_hit)}/{len(rows)}（{len(bank_hit)/len(rows):.1%}）',
     f'- 不在词库的词元：{len(new)} 个；其中出现 ≥3 次的 {sum(r["frequency"]>=3 for r in new)} 个，跨 ≥2 年的 {sum(r["year_count"]>=2 for r in new)} 个', '',
     '- 不在词库的词元按 ECDICT 标签分：' + '，'.join(f'{k} {v}' for k, v in collections.Counter(r['level'] for r in new).most_common()) + '（basic = 中考/高考词，词库 ky 标签本身不含这些基础词；cet = 四六级；beyond = 都不在）', '',
     '## 不在词库、也不是中考/高考基础词、出现最多的 40 个', '', '| 词 | 级别 | 次数 | 年数 | 例句 |', '|---|---|---|---|---|']
for r in sorted([r for r in new if r['level'] != 'basic'], key=lambda r: (-r['frequency'], -r['year_count']))[:40]:
    S.append(f"| {r['word']} | {r['level']} | {r['frequency']} | {r['year_count']} | {r['examples'][0]['sentence'][:90] if r['examples'] else ''} |")
S += ['', '## 词库内出现最多的 20 个', '', ', '.join(f"{r['word']}({r['frequency']})" for r in bank_hit[:20])]
open(f'{ROOT}/vocab/english1_exam_vocab_summary.md', 'w').write('\n'.join(S) + '\n')
print('\n'.join(S))
