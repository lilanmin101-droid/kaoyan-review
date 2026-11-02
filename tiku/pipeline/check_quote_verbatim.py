#!/usr/bin/env python3
"""英一阅读 A / 新题型（Q21-45）专家讲解的英文引文逐字校验。

讲解 steps 里“…”中的英文引文，必须逐字出现在本题所属 passage（或本题题干、选项、新题型选项）中。
比对前只做这些归一化：弯引号/直引号、各类破折号、连续空白视为相同；首字母大小写不计；
引文首尾标点不计；引文内的 … 或 ... 视为省略，拆成几段分别比对。
误报过滤规则：
  ① 引文中的 ___ 空位或（N）/(N) 题号空位当通配符，可对应原文的 {{N}} 或任意短文本；
  ② 引文里紧跟的中文括注（如 “booby prize（安慰奖）”）先去掉再比对；
     去掉后不含英文字母的引号内容（纯中文引号）不算英文引文，不校验。
段号校验：形如「第N段第M句：“…”」「第N段：“…”」的定位引文，若原文能找到但不在本题库 passage
  的第 N 段（按空行分段），记为段号不符。
句号校验：形如「第N段第M句：“…”」的定位引文，引文开头必须落在第 N 段第 M 句。计数口径（split_sents）：
  按本题库 passage 文本分句，句末 . ! ? （可带后引号/括号）后接空白和大写字母、数字或引号处断句；
  缩写不断句（U.S.、Ms.、Dr.、v.、e.g. 等，以及单个大写字母加点的人名缩写如 Karen R.）；
  新题型的段首编号标题（如 “41.”）不算句；空位 {{N}} 不算句，但空位前后各自断句（空位相当于一个被抽走的句子），
  紧挨空位且自身没有句末标点的引导语（如 In addition, {{41}}）算在被抽走的那句里，也不计数；
  没有句号的小标题（如 Better hiring practices）并入下一句。
退出码：0 = 全过；1 = 有不符。
usage: python3 tiku/pipeline/check_quote_verbatim.py [--root TIKU_DIR] [--all] [YEAR ...]
  --all  同时校验完形（Q1-20），默认只查 Q21-45
"""
import json, re, sys, os, glob

CJK = re.compile(r'[\u3400-\u9fff]')
ANNOT = re.compile(r'[（(][^）)]*[\u3400-\u9fff][^）)]*[）)]')
GAP = re.compile(r'_{2,}|[（(]\s*\d{1,2}\s*[）)]')
ELL = re.compile(r'…+|\.\s?\.\s?\.')
EDGE = ' \t.,;:!?\'"-'


def norm(s):
    s = (s.replace('\u2019', "'").replace('\u2018', "'").replace('\u201c', '"').replace('\u201d', '"')
         .replace('\u2014', '-').replace('\u2013', '-').replace('\u2012', '-').replace('\u00a0', ' '))
    return re.sub(r'\s+', ' ', s).strip()


def quotes(step):
    """取最外层 “…” 引文，支持嵌套弯引号。"""
    out, depth, start = [], 0, None
    for i, ch in enumerate(step):
        if ch == '\u201c':
            if depth == 0: start = i + 1
            depth += 1
        elif ch == '\u201d' and depth:
            depth -= 1
            if depth == 0: out.append(step[start:i])
    return out


def piece_regex(p):
    parts = GAP.split(p)
    rx = r'(?:\{\{\d+\}\}|[^.]{1,40}?)'.join(re.escape(x) for x in parts)
    # 首字母大小写不计
    m = re.match(r'([A-Za-z])', p)
    if m and parts[0].startswith(m.group(1)):
        c = m.group(1)
        rx = f'[{c.lower()}{c.upper()}]' + rx[1:]
    return rx


def check_quote(q, hay):
    """返回 None（通过/不校验）或第一段对不上的文本。"""
    q = ANNOT.sub('', q)
    if not re.search(r'[A-Za-z]{2,}', q): return None  # 纯中文引号
    if CJK.search(q):
        # 中文转述（可夹英文词），不算英文引文；只校验其中嵌套的英文引文
        for sub in quotes(q):
            r = check_quote(sub, hay)
            if r: return r
        return None
    pieces = [norm(x).strip(EDGE) for x in ELL.split(q)]
    pieces = [x for x in pieces if re.search(r'[A-Za-z]', x)]
    for p in pieces:
        if not re.search(piece_regex(p), hay): return p
    return None


PARA_REF = re.compile(r'第(\d+)段(?:第\d+句)?[：:]\s*\u201c')
SENT_REF = re.compile(r'第(\d+)段第(\d+)句[：:]\s*\u201c')
ABBR = re.compile(r'(?:\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs?|e\.g|i\.e|a\.m|p\.m|Inc|Corp|Ltd|Gov|Sen|Rep)|\b[A-Z])\.$')
HEAD = re.compile(r'\d{1,2}\.\s+')
BLANK = re.compile(r'\{\{\d+\}\}')


def split_sents(para):
    """按计数口径把一段（已 norm）切成句子，返回 [(start, end)]，不含标题和空位。"""
    cuts = []  # 不计数区间
    m = HEAD.match(para)
    if m: cuts.append((0, m.end()))
    cuts += [(b.start(), b.end()) for b in BLANK.finditer(para)]
    bounds = {0, len(para)}
    for a, b in cuts: bounds |= {a, b}
    for e in re.finditer(r'[.!?]["\')]?(?=\s+["\'(]?[A-Z0-9])', para):
        if para[e.start()] == '.' and ABBR.search(para[:e.start() + 1]): continue
        bounds.add(e.end())
    bounds = sorted(bounds); out = []
    blank_starts = {c0 for c0, _ in cuts[1 if m else 0:]}
    for a, b in zip(bounds, bounds[1:]):
        if any(a >= c0 and b <= c1 for c0, c1 in cuts): continue
        seg = para[a:b]
        if not re.search(r'[A-Za-z]', seg): continue
        # 紧挨空位、自身没有句末标点的引导语（如 In addition, {{41}}）属于被抽走的那句，不单独计数
        if b in blank_starts and not re.search(r'[.!?]["\')]?\s*["\']?\s*$', seg): continue
        out.append((a, b))
    return out


def sent_of(q, para):
    """引文首段在该段的第几句（1 起），找不到返回 None。"""
    q = ANNOT.sub('', q)
    if CJK.search(q): return None
    pcs = [x for x in (norm(x).strip(EDGE) for x in ELL.split(q)) if re.search(r'[A-Za-z]', x)]
    if not pcs: return None
    m = re.search(piece_regex(pcs[0]), para)
    if not m: return None
    for k, (a, b) in enumerate(split_sents(para), 1):
        if a <= m.start() < b: return k
    return None


def para_of(q, paras):
    q = ANNOT.sub('', q)
    if CJK.search(q): return set()
    pcs = [x for x in (norm(x).strip(EDGE) for x in ELL.split(q)) if re.search(r'[A-Za-z]', x)]
    hit = set()
    for pc in pcs:
        hit |= {k + 1 for k, p in enumerate(paras) if re.search(piece_regex(pc), p)}
    return hit


def check(T, Y, lo):
    f = f'{T}/explanations/english1_{Y}_expert.jsonl'
    if not os.path.exists(f): return None
    P = {p['id']: p for p in json.load(open(f'{T}/english1_{Y}_passages.json'))}
    Q = {q['id']: q for q in json.load(open(f'{T}/english1_{Y}.json'))}
    err, n = [], 0
    for ln, l in enumerate(open(f), 1):
        d = json.loads(l)
        num = int(d['id'].rsplit('-', 1)[1])
        if not lo <= num <= 45: continue
        q = Q.get(d['id'])
        if not q: err.append((d['id'], -1, '题库里没有这题', '')); continue
        pas = P.get(q.get('passage_id') or '', {})
        texts = [pas.get('text', ''), q.get('stem') or '']
        texts += [o.get('content', '') for o in q.get('options') or []]
        texts += [(o.get('content') or o.get('text') or '') if isinstance(o, dict) else str(o) for o in pas.get('options') or []]
        hay = '\n'.join(norm(t) for t in texts)
        paras = [norm(p) for p in pas.get('text', '').split('\n\n') if p.strip()]
        for i, s in enumerate(d.get('steps', [])):
            if s.startswith('答案'): continue
            for qt in quotes(s):
                r = check_quote(qt, hay)
                if r is None:
                    if not CJK.search(ANNOT.sub('', qt)): n += 1
                    continue
                err.append((d['id'], i, '原文找不到', r[:120]))
            for m in PARA_REF.finditer(s):
                qs = quotes(s[m.end() - 1:])
                if not qs: continue
                pn = int(m.group(1)); hit = para_of(qs[0], paras)
                if hit and pn not in hit:
                    err.append((d['id'], i, f'段号不符：写第{pn}段，原文在第{"、".join(map(str, sorted(hit)))}段', qs[0][:60]))
            for m in SENT_REF.finditer(s):
                qs = quotes(s[m.end() - 1:])
                pn, sn = int(m.group(1)), int(m.group(2))
                if not qs or pn > len(paras): continue
                k = sent_of(qs[0], paras[pn - 1])
                if k is not None and k != sn:
                    err.append((d['id'], i, f'句号不符：写第{pn}段第{sn}句，按口径是第{k}句', qs[0][:60]))
    return err, n


def main(a):
    T = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    lo = 21
    if '--all' in a: a = [x for x in a if x != '--all']; lo = 1
    if a[:1] == ['--root']: T, a = a[1], a[2:]
    years = a or sorted({m.group(1) for p in glob.glob(f'{T}/explanations/english1_*_expert.jsonl') if (m := re.search(r'english1_(\d{4})_expert', p))})
    bad = 0
    for Y in years:
        r = check(T, Y, lo)
        if r is None: continue
        e, n = r
        print(f'{Y} 英文引文 {n + len(e)} 条，不符 {len(e)}')
        for x in e: print('   !', x)
        bad += len(e)
    print('全过' if not bad else f'共 {bad} 处不符')
    sys.exit(1 if bad else 0)


if __name__ == '__main__': main(sys.argv[1:])
