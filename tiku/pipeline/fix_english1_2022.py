#!/usr/bin/env python3
"""english1_2022 修正层（build_eng1.py 生成后自动调用；可重复运行）。
- Q32 选项 A 连字 OCR 断开：'off er' → 'offer'
- Part B（Greg Newberry 等读者来信）源文本保留了 PDF 硬换行：段内小写/逗号后接小写的换行并成空格
"""
import json, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QF, PF = f'{ROOT}/english1_2022.json', f'{ROOT}/english1_2022_passages.json'
Q, P = json.load(open(QF)), json.load(open(PF))
n = 0
for q in Q:
    for o in q.get('options') or []:
        if 'off er' in o['content']:
            o['content'] = o['content'].replace('off er', 'offer'); n += 1
for p in P:
    if p['section'] == 'reading_b':
        t, k = re.subn(r'(?<=[a-z,])\n+(?=[a-z])', ' ', p['text'])
        p['text'] = t; n += k
assert not any('off er' in o['content'] for q in Q for o in q.get('options') or [])
json.dump(Q, open(QF, 'w'), ensure_ascii=False, indent=2)
json.dump(P, open(PF, 'w'), ensure_ascii=False, indent=2)
print('fix_english1_2022:', n, '处')
