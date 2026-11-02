#!/usr/bin/env python3
"""英语一整卷构建（可重复运行）：python3 pipeline/build_eng1.py <year> [--reviews]
源：src/eng1/liziak112/<year>-1/<year>-1.json（题面/答案/参考译文/范文，LICENSE 第一层"试题数据"自由使用；不取 explanation 字段）
交叉核对：src/eng1/echo/<year>/answers.json（1–45 客观题答案）
输出：english1_<year>.json（题目）、english1_<year>_passages.json（篇章）、images/english1-<year>/，
      --reviews 时写 reviews/english1_<year>.jsonl（全部 pending；已存在则不覆盖）
标记约定：完形篇章里空位写 {{n}}；翻译篇章里划线句写 <u data-q="46">…</u>；阅读 B 篇章里每条评论以 "41. 名字" 开头。
"""
import json, re, sys, os, shutil, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
year = int(sys.argv[1]); write_reviews = '--reviews' in sys.argv
SRC = f'{ROOT}/src/eng1/liziak112/{year}-1'
src = json.load(open(f'{SRC}/{year}-1.json'))
commit = open(f'{ROOT}/src/eng1/liziak112/COMMIT').read().strip() if os.path.exists(f'{ROOT}/src/eng1/liziak112/COMMIT') else None
echo_p = f'{ROOT}/src/eng1/echo/{year}/answers.json'
echo = {int(k): v for sec in json.load(open(echo_p))['answers'].values() for k, v in sec.items()} if os.path.exists(echo_p) else {}

SUP_P = f'{ROOT}/src/eng1/supplements/{year}.json'
SUP = json.load(open(SUP_P)) if os.path.exists(SUP_P) else {}
for _s in src['sections']:   # 补全源里缺失的题干
    for _g in _s['groups']:
        for _q in _g['questions']:
            if str(_q['number']) in SUP.get('stems', {}) and not (_q.get('stem') or '').strip(): _q['stem'] = SUP['stems'][str(_q['number'])]

WM = re.compile(r'(公众号|微信|淘宝|QQ群|扫码|关注我们|www\.|\.com/)')
FIXES = [  # 明显 OCR 错误（逐条记录，报告里列出）
    (r'\bbum down\b', 'burn down'), (r'\bAi-generated\b', 'AI-generated'), (r'\bAl’s\b', 'AI’s'), (r"\bAl's\b", "AI's"),
    (r'(\d+th)- (century)', r'\1-\2'), (r'caregivers-this', 'caregivers—this'),
    (r'(?<=[a-z\)”])\.(?=[A-Z“])', '. '),
    (r'(?<=\w) +([.,;:?!])(?=\s|$|<)', r'\1'),
    (r'(?<=[a-z]),(?=[A-Za-z])', ', '),            # 「Renaissance,the」→「Renaissance, the」
    (r'(?<=[a-z])\((?=[A-Z]{2})', ' ('),
    (r'“ ([^“”\s][^“”]{0,80}?) ”', r'“\1”'),        # 「“ plant neurobiology ”」
    (r'\(\{\{(\d+)\}\}\)[ \t]*_*', r'{{\1}}'),     # 2021「({{42}}) _________」→「{{42}}」
    (r' ,(?=[a-z])', ', '), (r'\btum\b', 'turn'), (r'(?<=[a-z,]) - (?=[a-z])', '—'),
    (r'“ +(?=[A-Za-z])', '“'), (r'(?<=[a-z.,!?]) +”', '”'),            # 「intelligence(AI)」
]
# 逐年核对过原文的 OCR 修正（纯字符串替换；来源：对照原卷扫描/公开原文）
DIRECTIONS_FIX = {  # 源 directions 与原卷不符时整体替换（来源见 SOURCES.md）
    2021: 'Part B Directions: In the following text, some sentences have been removed. For Questions 41-45, choose the most suitable one from the list A-G to fit into each of the numbered blanks. There are two extra choices, which do not fit in any of the blanks. Mark your answers on the ANSWER SHEET. (10 points)',
}
YEAR_FIXES = {
    2016: [('he or she G {{17}}', 'he or she {{17}}'), ('Linkedln', 'LinkedIn'), ('\nl) describe', '\n1) describe')],
    2015: [('1）describe the picture briefly,', '1) describe the picture briefly,'), ('2）interpret its intended meaning, and', '2) interpret its intended meaning, and'),
           ('3）give your comments.', '3) give your comments.')],   # 写作要点编号统一半角
    2017: [('1） describe the pictures briefly,', '1) describe the pictures briefly,'), ('2） interpret the meaning, and', '2) interpret the meaning, and'),   # 写作要点编号统一半角
           ('3）give your comments.\nYou should write neatly on the ANSWER SHEET. (20 points)', '3) give your comments.\nYou should write neatly on the ANSWER SHEET. (20 points)\n（图题：“有书”与“读书”）'),   # 原卷图下印图题（deyideyi/Fantasia1999 版式 PDF）
           ('Oliver Twis t with th e sunlig ht of Pickwick. Th e popu lar ity of th ese', 'Oliver Twist with the sunlight of Pickwick. The popularity of these')],
    2019: [('follow any H O you find, 2 you should', 'follow any H₂O you find, you should'), ('ofAI', 'of AI'), ('rulehas', 'rule has'), ('andfair', 'and fair')],
    2020: [('traditions:the', 'traditions: the'), ('you,"said', 'you," said'), ('you,”said', 'you,” said'), ('with the Church’s teachings', 'With the Church’s teachings'), ('thin- crust', 'thin-crust'), ('coming a cross as', 'coming across as'),
           ('sponsors feelgood', 'sponsors feel good'), ('the Church to suppress. this new', 'the Church to suppress this new')],
    # 2025 以原卷扫描件为准（verify2025/yeyulingfeng_ocr.txt + 预览图；来源优先级：原卷 > 原卷版式重排 > 多源表决）。
    # 原卷误印 'Chrysanthi Gallon'、'when digital replace analog' 按原样保留，说明见 fix_english1_2025.py 的 errata（Q14、Q39）。
    2025: [('more about what they’ll Show?', 'more about what they’ll show?'),   # 原卷小写
           ('Do not use your own name in your email; use “Li Ming” instead.', 'Do not use your own name in your email; use “Li Ming” instead. (10 points)')],   # 原卷有分值
    2021: [# 写作题面按原卷扫描件（verify2021/xztu.pdf 第 15 页）
           ('Write him/her an e-mail to make', 'Write him/her an email to make'),
           ('Do not sign your own name in the email. Use', 'Do not sign your own name at the end. Use'),
           ('Do not write the address. ( 10 points)', 'Do not write the address. (10 points)'),
           ('Write an essay of 160 - 200 words based on the following picture.', 'Write an essay of 160-200 words based on the following picture.'),
           ('2) interpret the implied meaning, and\n3) give your comments.\nYou should write neatly on the ANSWER SHEET. (20 points)', '2) interpret its intended meaning, and\n3) give your comments.\nYou should write neatly on the ANSWER SHEET. (20 points)'),
           ('academic life of the institution-this was', 'academic life of the institution—this was'),
           ('doom-andgloom', 'doom-and-gloom'), ('computer-to-computeractivities', 'computer-to-computer activities'), ('AIgo ', 'AI go '),
           ('modem Western', 'modern Western'), ('providers’rights', 'providers’ rights'), ('biasfrom', 'bias from'), ('ownenergy', 'own energy'),
           ('One accounting firm, BY, uses', 'One accounting firm, EY, uses'),
           ('anti- competitive', 'anti-competitive'), ('Apple TV.Yet', 'Apple TV. Yet'),   # Text 4 录入错误（行业专家 2026-11-02 报）
           # 选项措辞按原卷扫描件（gw.xztu，含原卷原样的 deep-root / focus / Victorian’s）
           ('wellbeing', 'well-being'), ('rail travellers.', 'rail travelers.'), ('a deep-rooted belief.', 'a deep-root belief.'),
           ('focuses on trivialities.', 'focus on trivialities.'), ('the Victorians’ notion of public image', 'the Victorian’s notion of public image'),
           ('Why did most Victorians look stem in', 'Why did most Victorians look stern in'),
           # 完形按原卷扫描件：16 后无逗号、18 后有句号、Mediterranean-style 前无 a
           ('{{16}} , there are steps', '{{16}} there are steps'), ('physical and mental {{18}} The two', 'physical and mental {{18}}. The two'),
           ('following a Mediterranean-style {{20}}', 'following Mediterranean-style {{20}}'), ('as the years {{11}} .', 'as the years {{11}}.'),
           ('did not appear to be {{13}} . It', 'did not appear to be {{13}}. It')],
    2022: [('Emma Manis', 'Emma Marris'), ('“ The Case', '“The Case'), ('lberian', 'Iberian'), ('emoti ons', 'emotions'), ('competi tion', 'competition'),
           ('avant-gardesculptures', 'avant-garde sculptures'), ('isalready', 'is already'), ('whichmeant', 'which meant'), ('callsthose', 'calls those'),
           ('“ sunscreens ”', '“sunscreens”'), ('lightdamage', 'light damage'), ('likelyget', 'likely get'), ('anassistant', 'an assistant'),
           ('inmuseums', 'in museums'), ('tocollect', 'to collect'), ('how inthe future', 'how in the future'), ('tomake', 'to make')],
    2023: [('At the same time Al can also be used', 'At the same time AI can also be used'),
           ('the job. Do not Write your answer in about 100 words on the ANSWER SHEET. use your own name in the notice; use “Li Ming” instead.',
            'the job.\nWrite your answer in about 100 words on the ANSWER SHEET.\nDo not use your own name in the notice; use “Li Ming” instead. (10 points)'),
           ('Write your answer in 160-200 words on the ANSWER SHEET.', 'Write your answer in 160-200 words on the ANSWER SHEET. (20 points)'),
           ('The Bench If you’re heading', 'If you’re heading'), ('retailer in The President’s Daughter the UK', 'retailer in the UK'),
           ('Duchess of Sussex’s new children’s book, you', 'Duchess of Sussex’s new children’s book The Bench, you'),
           ('the same may be true of, the new thriller', 'the same may be true of The President’s Daughter, the new thriller'),
           ('The Bookseller The problem began', 'The problem began'), ('The trade magazine reported', 'The trade magazine The Bookseller reported'),
           ('first- ever', 'first-ever'),
           ('“ ” The word', 'The word'), ('Persian words karvan,', 'Persian words “karvan”,'), ('“sardy”', '“saray”'),
           ('“I don’t believe that the legal Prophets and Moguls, Rangers and protection would have happened in the time frame that it did without those images,” Rogues Bison and Bears 100 Years of the National Park Service. says Heather Hansen, journalist and author of, :',
            '“I don’t believe that the legal protection would have happened in the time frame that it did without those images,” says Heather Hansen, journalist and author of Prophets and Moguls, Rangers and Rogues, Bison and Bears: 100 Years of the National Park Service.')],
}
FIX_HITS = {}
PB_MAP = {}   # Part B 选项重排：源字母 → 原卷字母
def clean(t):
    if t is None: return t
    t = '\n'.join(l for l in str(t).split('\n') if not WM.search(l))
    for a, b in FIXES: t = re.sub(a, b, t)
    for a, b in YEAR_FIXES.get(year, []):
        if a in t: t = t.replace(a, b); FIX_HITS[a] = FIX_HITS.get(a, 0) + 1
    t = re.sub(r'\n[ \t]*\n(?:[ \t]*\n)+', '\n\n', t)       # 分页留下的多余空行
    return t.strip()

def unwrap(t):
    """PDF 硬换行 → 空格（写作题干除外）；行末连字符直接接上"""
    if t is None: return t
    t = re.sub(r'(?<=[A-Za-z])-\n(?=[a-z])', '-', t)
    return re.sub(r'[ \t]*\n[ \t]*', ' ', t)

def prose(t): return clean(unwrap(t))

def sentences(p):
    return re.split(r'(?<=[.!?”])\s+(?=[A-Z“{])', p)

SEC_MAP = {'cloze': 'use_of_english', 'reading': 'reading_a', 'translation_sentences': 'translation', 'translation': 'translation'}
SCORE = {'use_of_english': 0.5, 'reading_a': 2, 'reading_b': 2, 'translation': 2, 'writing_a': 10, 'writing_b': 20}
TYPE = {'use_of_english': 'choice', 'reading_a': 'choice', 'reading_b': 'match', 'translation': 'translation', 'writing_a': 'essay', 'writing_b': 'essay'}
KP = {'translation': ['英语/翻译/英译汉长难句拆分'], 'writing_a': ['英语/写作/小作文（书信、通知等）'], 'writing_b': ['英语/写作/大作文（图画作文）']}
RB_KP = {'matching': '信息匹配', 'headings': '小标题匹配', 'ordering': '段落排序', 'gap_fill': '七选五'}
SEC_CN = {'use_of_english': 'Section I Use of English', 'reading_a': 'Section II Part A', 'reading_b': 'Section II Part B', 'translation': 'Section II Part C', 'writing_a': 'Section III Part A', 'writing_b': 'Section III Part B'}
CLOZE_DIR = 'Directions: Read the following text. Choose the best word(s) for each numbered blank and mark A, B, C or D on the ANSWER SHEET. (10 points)'

passages, questions = [], []
pid = lambda s: f'english1-{year}-P-{s}'
base_source = {'repo': 'LIziak112/structured-kaoyan-english', 'commit': commit, 'files': [f'data/{year}-1/{year}-1.json'], 'license': '题面/答案/参考译文/范文：仓库 LICENSE.md 第一层（试题数据，自由使用）；未取解析字段（CC BY-NC）'}
img_dir = f'{ROOT}/images/english1-{year}'; os.makedirs(img_dir, exist_ok=True)
text_no = 0
for s in src['sections']:
    title = s['title']
    if 'Part B' in title and 'Reading' in title and year in DIRECTIONS_FIX: s['instructions'] = DIRECTIONS_FIX[year]
    for g in s['groups']:
        gt = g['type']
        if 'Part B' in title and 'Reading' in title: sec = 'reading_b'
        elif gt == 'writing': sec = 'writing_a' if 'Part A' in title else 'writing_b'
        else: sec = SEC_MAP[gt]
        paras = [prose(p) for p in g.get('passage') or []]
        images = []
        for im in g.get('images', []) or []:
            fn = os.path.basename(im).replace(f'{year}-1-', '')
            shutil.copy(f'{SRC}/{im}', f'{img_dir}/{fn}'); images.append(f'images/english1-{year}/{fn}')
        P = None
        if sec == 'use_of_english':
            P = {'id': pid('cloze'), 'section': sec, 'title': 'Section I Use of English', 'directions': CLOZE_DIR, 'text': '\n\n'.join(paras), 'images': []}
        elif sec == 'reading_a':
            text_no += 1
            paras[0] = re.sub(r'^Text\s*\d+\s*', '', paras[0])
            P = {'id': pid(f'text{text_no}'), 'section': sec, 'title': f'Text {text_no}', 'directions': clean(s.get('instructions')), 'text': '\n\n'.join(paras), 'images': []}
        elif sec == 'reading_b':
            opts_b = [{'key': k, 'content': prose(v)} for k, v in (g.get('options') or {}).items()]
            if SUP.get('partb_order'):   # 源选项顺序与原卷不同 → 按原卷顺序重排（按内容关键词匹配），答案跟着内容走
                kws = SUP['partb_order']; keys = [o['key'] for o in opts_b]
                new = [next(o for o in opts_b if kw in o['content']) for kw in kws]
                assert len({id(o) for o in new}) == len(opts_b) == len(kws), 'Part B 选项重排失败'
                PB_MAP.update({o['key']: keys[i] for i, o in enumerate(new)})
                opts_b = [{'key': keys[i], 'content': o['content']} for i, o in enumerate(new)]
            if g.get('order'):
                order_txt = ' → '.join(o['given'] if 'given' in o else f"({o['number']})" for o in g['order'])
                body = [f'段落顺序：{order_txt}', '可选段落见 options（已给定位置的段落也在其中）。']
                subtype = 'ordering'
            elif paras:
                body = paras
                avg = sum(len(o['content']) for o in opts_b) / max(1, len(opts_b))
                subtype = None
            else:
                body = [f"{q['number']}. {clean(q['stem'])}" for q in g['questions']]
                subtype = 'matching'
            d = (s.get('instructions') or '').lower()   # 题型按 directions 原文判定
            subtype = ('ordering' if 'wrong order' in d else 'headings' if 'subheading' in d else
                       'gap_fill' if 'sentences have been removed' in d else 'matching' if re.search(r'opinion|comment|statement', d) else None)
            assert subtype, f'无法从 directions 判定新题型：{d[:120]}'
            P = {'id': pid('partb'), 'section': sec, 'title': 'Part B', 'directions': prose(s.get('instructions')), 'text': '\n\n'.join(body), 'images': images,
                 'options': opts_b, 'subtype': subtype}
        elif sec == 'translation':
            nums = iter([int(q['number']) for q in g['questions']])
            txt = re.sub(r'\(\d{2}\)\s*<u>', '<u>', '\n\n'.join(paras))
            txt = re.sub(r'[ \t]*<u>\s*', ' <u>', txt)
            txt = re.sub(r'(^|\n) <u>', r'\1<u>', txt).lstrip()   # 段首划线句不加空格，保留分段
            txt = re.sub(r'\s*</u>', '</u>', txt)
            txt = re.sub(r'<u>', lambda m: f'<u data-q="{next(nums)}">', txt)
            P = {'id': pid('translation'), 'section': sec, 'title': 'Part C', 'directions': clean(s.get('instructions')), 'text': txt, 'images': []}
        if P: passages.append(P)
        for q in g['questions']:
            n = int(q['number']); ans = clean(q.get('answer'))
            if sec == 'reading_b' and PB_MAP: ans = PB_MAP[ans]
            Q = {'schema_version': '0.2', 'id': f'english1-{year}-{n:02d}', 'exam': 'english1', 'year': year, 'number': n,
                 'section': sec, 'type': TYPE[sec], 'score': float(q.get('score') or SCORE[sec]) if sec.startswith('writing') else SCORE[sec],
                 'passage_id': P['id'] if P else None, 'stem': None, 'images': [], 'options': [], 'answer': [ans], 'sub_questions': [],
                 'solution': None, 'knowledge_points': list(KP.get(sec, [])), 'source': dict(base_source)}
            if sec == 'use_of_english':
                sent = next(x for p in paras for x in sentences(p) if '{{%d}}' % n in x)
                sent = sent.replace('{{%d}}' % n, f'（{n}）______')
                Q['stem'] = re.sub(r'\{\{(\d+)\}\}', r'（\1）______', sent)
            elif sec == 'reading_b':
                st = P['subtype']
                if q.get('stem'):
                    Q['stem'] = prose(q['stem']) if '\n' not in q['stem'][:40] else clean(q['stem'].split('\n', 1)[0]) + '\n' + prose(q['stem'].split('\n', 1)[1])
                elif st == 'ordering':
                    Q['stem'] = f"根据段落顺序 {P['text'].split('：', 1)[1].splitlines()[0]}，选出第（{n}）处的段落。"
                else:
                    tag = '{{%d}}' % n
                    i = next(k for k, p in enumerate(paras) if tag in p)
                    ctx = paras[i] if paras[i].strip() != tag else (paras[i] + '\n\n' + (paras[i + 1] if i + 1 < len(paras) else ''))
                    ctx = re.sub(r'\{\{(\d+)\}\}', r'（\1）______', ctx)
                    Q['stem'] = (f'选出第（{n}）处的小标题：\n\n' if st == 'headings' else f'选出填入第（{n}）处的选项：\n\n') + ctx
                Q['knowledge_points'] = [f'英语/阅读理解B（新题型）/{RB_KP[st]}']
            elif sec == 'translation':
                Q['stem'] = prose(q['stem'])
                m = re.search(r'<u data-q="%d">(.*?)</u>' % n, P['text'], re.S)
                assert m and m.group(1).strip() == Q['stem'], f'第 {n} 题划线句和 stem 不一致'
            elif sec.startswith('writing'):
                Q['stem'] = re.sub(r'\n([\u4e00-\u9fff]{2,12})$', r'\n（图题：\1）', clean(q['stem'])); Q['images'] = images
            else:
                Q['stem'] = prose(q['stem'])
            opts = q.get('options') or (P and P.get('options') and {o['key']: o['content'] for o in P['options']})
            if opts: Q['options'] = [{'key': k, 'content': prose(v)} for k, v in opts.items()]
            order = SUP.get('option_order', {}).get(str(n))
            if order:   # 源选项顺序与原卷不同 → 按原卷顺序重排，答案跟着内容走
                old = {o['key']: o['content'] for o in Q['options']}
                new = [next(c for c in old.values() if c.startswith(pref)) for pref in order]
                assert len(set(new)) == len(old), f'第 {n} 题选项重排失败'
                Q['answer'] = ['ABCD'[new.index(old[ans])]]
                Q['options'] = [{'key': 'ABCD'[i], 'content': c} for i, c in enumerate(new)]
                ans = Q['answer'][0]; Q['source']['option_order_from'] = SUP['_sources']
            if sec in ('translation', 'writing_a', 'writing_b'):
                Q['source']['answer_note'] = '参考译文/范文为专家参考答案（取自 LIziak112 源仓库），不是考试院发布的标准答案；考试院只公布评分标准'
                Q = {k: v for kv in Q.items() for k, v in ([kv, ('answer_source', 'expert')] if kv[0] == 'answer' else [kv])}
            elif echo:
                Q['source']['answer_crosscheck'] = {'repo': 'Echo1LZJY/echo-kaoyan-english-skill', 'answer': echo.get(n), 'agree': echo.get(n) == ans}
            questions.append(Q)

assert [q['number'] for q in questions] == list(range(1, 53)), '题号不是 1–52'
assert not [q for q in questions if not q['answer'][0]], '有题缺答案'
if '--dry' in sys.argv:
    os.makedirs('/tmp/eng1dry', exist_ok=True); json.dump({'q': questions, 'p': passages}, open(f'/tmp/eng1dry/{year}.json', 'w'), ensure_ascii=False, indent=1)
else: json.dump(questions, open(f'{ROOT}/english1_{year}.json', 'w'), ensure_ascii=False, indent=2)
if '--dry' not in sys.argv: json.dump(passages, open(f'{ROOT}/english1_{year}_passages.json', 'w'), ensure_ascii=False, indent=2)
_fx = f'{ROOT}/pipeline/fix_english1_{year}.py'
if '--dry' not in sys.argv and os.path.exists(_fx):   # 原卷核对修正层
    import subprocess; subprocess.run([sys.executable, _fx], check=True)
    questions = json.load(open(f'{ROOT}/english1_{year}.json'))
# 专家自写参考译文/范文覆盖层（行业专家写在 explanations/english1_translations_expert.jsonl，统筹者定：写完一年就替换题库 answer）
_tx = f'{ROOT}/explanations/english1_translations_expert.jsonl'
if '--dry' not in sys.argv and os.path.exists(_tx):
    _ex = {}
    for _l in open(_tx, encoding='utf-8'):
        if _l.strip(): _r = json.loads(_l); _ex[_r['id']] = _r   # 同一 id 以最后一行为准
    _hit = 0
    for q in questions:
        r = _ex.get(q['id'])
        if not r: continue
        a = r['answer'] if isinstance(r['answer'], list) else [r['answer']]
        assert a and all(isinstance(x, str) and x.strip() for x in a), f"{q['id']} 专家答案为空"
        q['answer'] = a; q['answer_source'] = 'expert'
        q['source']['answer_note'] = f"参考译文/范文由行业专家自写（{r.get('at','')}），不是考试院标准答案（考试院只公布评分标准）；不再使用 LIziak112 的参考译文/范文"
        _hit += 1
    if _hit:
        json.dump(questions, open(f'{ROOT}/english1_{year}.json', 'w'), ensure_ascii=False, indent=2)
    print(f'专家译文/范文覆盖: {_hit} 题')
dis = [(q['number'], q['answer'][0], q['source']['answer_crosscheck']['answer']) for q in questions if 'answer_crosscheck' in q['source'] and not q['source']['answer_crosscheck']['agree']]
print('逐年 OCR 修正命中:', FIX_HITS, '未命中:', [a for a, _ in YEAR_FIXES.get(year, []) if a not in FIX_HITS])
print(f'english1_{year}.json: {len(questions)} 题, passages {len(passages)}, 两源答案不一致: {dis}')
if write_reviews:
    rp = f'{ROOT}/reviews/english1_{year}.jsonl'
    if os.path.exists(rp): print('reviews 已存在，不覆盖'); sys.exit()
    from zoneinfo import ZoneInfo
    _now = datetime.datetime.now(ZoneInfo('America/Los_Angeles'))  # 盒子时钟是 CST，不用本地时间
    at = _now.strftime('%Y-%m-%dT%H:%M') + _now.strftime('%z')[:3] + ':' + _now.strftime('%z')[3:]
    with open(rp, 'w') as f:
        for q in questions:
            if 'answer_crosscheck' in q['source']:
                note = '答案两源一致（LIziak112 / Echo1LZJY），待核题面' if q['source']['answer_crosscheck']['agree'] else f"两源答案不一致：{q['answer'][0]} vs {q['source']['answer_crosscheck']['answer']}"
            else:
                note = '参考译文/范文为专家参考（LIziak112），待核题面与参考答案'
            if str(q['number']) in SUP.get('notes', {}): note = SUP['notes'][str(q['number'])]
            elif SUP.get('option_order', {}).get(str(q['number'])): note = SUP['note']
            elif str(q['number']) in SUP.get('stems', {}): note += '；题干源缺失，已按公开原卷文本补全（见 src/eng1/supplements）'
            f.write(json.dumps({'id': q['id'], 'status': 'pending', 'by': '资料/仓库搜索者', 'at': at, 'note': note}, ensure_ascii=False) + '\n')
    print('wrote', rp)
