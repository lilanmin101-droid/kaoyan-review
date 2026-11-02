#!/usr/bin/env python3
"""阅读题干扰项引文跨题泄题检查（只提醒，退出码恒 0；--strict 时有命中退出 1）。

同一篇文章里，某题「X 错」步骤引的英文，和同篇另一题「定位」步骤引的依据句
有 N 个以上连续词重叠（默认 6），就提示：这条干扰项引文可能把那道题的答案依据露出来了
（如 2016-37C 引了 38 题的依据句）。同一句话同时是两题的依据时也会命中，需人工判断。
默认 6 词：在 d2ad7ef 上 55 条，用户逐条看过没有误报（真泄露 2、弱提示 14、可接受 39）。
5 词以内的短引文会漏，要查就加 --n 4（d2ad7ef 上 88 条，多出来的都不是真泄露，干扰更多）。
usage: python3 tiku/pipeline/check_reading_cross_leak.py [--root TIKU] [--n 6] [--strict] [YEAR ...]
"""
import json, re, sys, os, glob
def norm(s):
    s = s.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')
    return re.findall(r"[a-z0-9']+", s.lower())
def quotes(s):
    return re.findall(r'[“"]([^”"]*[A-Za-z][^”"]*)[”"]', s)
def grams(ws, n):
    return {tuple(ws[i:i+n]) for i in range(len(ws) - n + 1)}
def check(T, Y, N):
    f = f'{T}/explanations/english1_{Y}_expert.jsonl'
    if not os.path.exists(f): return []
    Q = {q['id']: q for q in json.load(open(f'{T}/english1_{Y}.json'))}
    E = {json.loads(l)['id']: json.loads(l) for l in open(f) if l.strip()}
    by_p = {}
    for i, q in Q.items():
        if q.get('section') in ('reading_a',) and i in E: by_p.setdefault(q['passage_id'], []).append(q)
    hits = []
    for qs in by_p.values():
        loc = {}
        for q in qs:
            st = [s for s in E[q['id']]['steps'] if s.startswith('定位')]
            loc[q['number']] = set().union(*[grams(norm(x), N) for s in st for x in quotes(s)] or [set()])
        for q in qs:
            for s in E[q['id']]['steps']:
                m = re.match(r'^([A-D])\s*错', s)
                if not m: continue
                g = set().union(*[grams(norm(x), N) for x in quotes(s)] or [set()])
                for k, lg in loc.items():
                    if k == q['number'] or not (g & lg): continue
                    ov = ' '.join(sorted(g & lg)[0])
                    hits.append((q['id'], m.group(1), k, ov))
    return hits
def main(a):
    T = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); N = 6; strict = False
    while a and a[0].startswith('--'):
        if a[0] == '--root': T, a = a[1], a[2:]
        elif a[0] == '--n': N, a = int(a[1]), a[2:]
        elif a[0] == '--strict': strict, a = True, a[1:]
        else: sys.exit('unknown option ' + a[0])
    ys = a or sorted({m.group(1) for p in glob.glob(f'{T}/explanations/english1_*_expert.jsonl') if (m := re.search(r'english1_(\d{4})_expert', p))})
    tot = 0
    for y in ys:
        h = check(T, y, N); tot += len(h)
        print(f'{y} 干扰项引文与他题定位句重叠（只提醒） {len(h)}')
        for x in h: print(f'   ? {x[0]} {x[1]} → 第{x[2]}题定位句：「{x[3]} …」')
    sys.exit(1 if strict and tot else 0)
if __name__ == '__main__': main(sys.argv[1:])
