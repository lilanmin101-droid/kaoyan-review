#!/usr/bin/env python3
"""english1_2025 修正层（build_eng1.py 生成后自动调用；可重复运行）。
Q52 图表作文：把题面里的纯文本表格移到结构化字段 table，并渲染 images/english1-2025/q52_table.png。
表格内容按原卷扫描件（yeyulingfeng 预览/OCR 层、gw.xztu 2025 原卷）与 deyideyi、yingyuzhenti、zemengzhou 一致。
tables 字段（后端约定）：[{caption, header:[str], rows:[[str]]}]，题面用 {{table:0}} 标出表格位置；PNG 仍放 images
"""
import json, os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QF = f'{ROOT}/english1_2025.json'
Q = json.load(open(QF))
q = next(x for x in Q if x['number'] == 52)

HEAD = ['年份', '空调（台）', '洗衣机（台）', '电冰箱（台）']
ROWS = [['2014', '75.2', '83.7', '85.5'], ['2017', '96.1', '91.7', '95.3'],
        ['2020', '117.7', '96.7', '101.8'], ['2023', '145.9', '98.2', '103.4']]
CAP = '近年来全国居民平均每百户年末主要耐用消费品拥有量'
raw = '\n'.join([' '.join(HEAD)] + [' '.join(r) for r in ROWS] + [CAP])
st = q['stem'].replace(raw, '').replace('{{table:0}}', '').rstrip()
if not st.endswith('(20 points)'): st += ' (20 points)'   # 原卷有分值
assert '空调' not in st and CAP not in st, st
q['stem'] = st + '\n{{table:0}}'                       # 原卷表格在题面指令之后
assert all(len(r) == len(HEAD) for r in ROWS)
q.pop('table', None)
q['tables'] = [{'caption': CAP, 'header': HEAD, 'rows': ROWS}]   # 后端约定的字段形状
REL = 'images/english1-2025/q52_table.png'
q['images'] = [REL]
q2 = {}
for k, v in q.items():
    if k == 'tables': continue
    q2[k] = v
    if k == 'images': q2['tables'] = q['tables']
Q[Q.index(q)] = q2

# 渲染 PNG（白底黑线，类原卷三线/网格表）
os.makedirs(f'{ROOT}/images/english1-2025', exist_ok=True)
F = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
font, bold = ImageFont.truetype(F, 30, index=2), ImageFont.truetype(F.replace('Regular', 'Bold'), 30, index=2)
capf = ImageFont.truetype(F.replace('Regular', 'Bold'), 30, index=2)
colw, rowh, pad = [170, 230, 250, 250], 64, 40
W = sum(colw) + 2 * pad; H = rowh * (len(ROWS) + 1) + 2 * pad + 70
im = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(im)
x0, y0 = pad, pad
for r in range(len(ROWS) + 2):
    d.line([(x0, y0 + r * rowh), (x0 + sum(colw), y0 + r * rowh)], fill='black', width=3 if r in (0, len(ROWS) + 1) else 2)
xs = [x0]
for w in colw: xs.append(xs[-1] + w)
for x in xs: d.line([(x, y0), (x, y0 + rowh * (len(ROWS) + 1))], fill='black', width=2)
for r, row in enumerate([HEAD] + ROWS):
    for c, t in enumerate(row):
        f = bold if r == 0 else font
        bb = d.textbbox((0, 0), t, font=f)
        d.text((xs[c] + (colw[c] - (bb[2] - bb[0])) / 2, y0 + r * rowh + (rowh - (bb[3] - bb[1])) / 2 - bb[1]), t, fill='black', font=f)
bb = d.textbbox((0, 0), CAP, font=capf)
d.text(((W - (bb[2] - bb[0])) / 2, y0 + rowh * (len(ROWS) + 1) + 22), CAP, fill='black', font=capf)
im.save(f'{ROOT}/{REL}', optimize=True)

# 原卷误印：题面/篇章按原卷原样保留，在离误印最近的题目上加说明（同 2015 'Juan Carl' 的处理办法）
ERRATA = {
    'english1-2025-14': {'printed': 'Chrysanthi Gallon', 'correct': 'Chrysanthi Gallou',
                         'note': '原卷如此：完形第 3 段原卷印作 “Chrysanthi Gallon”，这位考古学家的名字应为 Chrysanthi Gallou；题面按原卷保留。'},
    'english1-2025-39': {'printed': 'when digital replace analog', 'correct': 'when digital replaces analog',
                         'note': '原卷如此：Text 4 第 4 段原卷印作 “when digital replace analog”，digital 作单数主语，应为 replaces；题面按原卷保留。'},
}
for x in Q:
    if x['id'] in ERRATA: x['errata'] = [ERRATA[x['id']]]
json.dump(Q, open(QF, 'w'), ensure_ascii=False, indent=2)
print('fix_english1_2025: Q52 table →', REL)
