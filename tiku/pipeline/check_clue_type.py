#!/usr/bin/env python3
"""完形（英一 Q1-20）专家讲解的线索类型校验。

标准（tiku/explanation_review_standard_en.md 第 4 条）只有四类：
  上下文复现、逻辑连接、固定搭配、词义辨析
讲解 steps 里以「标签：」开头的步骤视为标注；标签可带括号细分，如「逻辑连接（转折）」。
- 错误（退出码 1）：标签不是四类之一，也不是 本句/排除/答案 这类结构标签，
  例如「上下文呼应」「逻辑关系（因果）」「因果」「转折」。
- 错误（退出码 1）：整题没有任何四类标签。
usage: python3 tiku/pipeline/check_clue_type.py [--root TIKU_DIR] [YEAR ...]
"""
import json, re, sys, os, glob
STD = ('上下文复现', '逻辑连接', '固定搭配', '词义辨析')
STRUCT = ('本句', '排除', '答案', '原文', '注', '提示', '译文', '句意')
LABEL = re.compile(r'^\s*([^：:，。,\s“"]{1,12}?(?:[（(][^）)]{0,10}[）)])?)\s*[：:]')
def base(lbl):
    return re.sub(r'[（(].*$', '', lbl).strip()
def check(T, Y):
    f = f'{T}/explanations/english1_{Y}_expert.jsonl'
    if not os.path.exists(f): return [], []
    err, warn = [], []
    for l in open(f):
        d = json.loads(l)
        n = int(d['id'].rsplit('-', 1)[1])
        if not 1 <= n <= 20: continue
        has = False
        for i, s in enumerate(d.get('steps', [])):
            m = LABEL.match(s)
            if not m: continue
            lb = m.group(1); b = base(lb)
            if b in STD: has = True
            elif b in STRUCT or any(b.startswith(x) for x in STRUCT): pass
            else: err.append((d['id'], i, f'非标准线索类型:{lb}'))
        if not has: err.append((d['id'], -1, '未标四类线索类型'))
    return err, warn
def main(a):
    T = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    if a[:1] == ['--root']: T, a = a[1], a[2:]
    years = a or sorted({m.group(1) for p in glob.glob(f'{T}/explanations/english1_*_expert.jsonl') if (m := re.search(r'english1_(\d{4})_expert', p))})
    bad = 0
    for Y in years:
        e, w = check(T, Y)
        if not e and not w and not os.path.exists(f'{T}/explanations/english1_{Y}_expert.jsonl'): continue
        print(f'{Y} 错误 {len(e)}（非标准标签 {sum(1 for x in e if x[1]>=0)}，未标 {sum(1 for x in e if x[1]<0)}）')
        for x in e: print('   !', x)
        for x in w: print('   ?', x)
        bad += len(e)
    sys.exit(1 if bad else 0)
if __name__ == '__main__': main(sys.argv[1:])
