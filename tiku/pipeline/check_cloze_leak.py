#!/usr/bin/env python3
"""Scan cloze (Q1-20) expert explanations for quoted text that reveals ANOTHER blank's answer.

A leak = the explanation contains another blank's answer adjacent to that blank's passage
neighbour words (e.g. "faced the possibility" when 'faced' fills blank 7), unless the same
word sequence also occurs naturally in the passage outside the blanks; or the answer word appears
inside a quoted English fragment / 本句 line while never occurring in the passage outside the blanks.
Rule 3: another blank's answer word mentioned anywhere (4+ letters, not this blank's option, not in passage).
Chinese paraphrases of another blank's answer are NOT detected; review those by hand.
usage: python3 tiku/pipeline/check_cloze_leak.py [YEAR ...]   (exit 1 on any leak)
"""
import json, re, sys, glob, os
T = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
def norm(s):
    s = s.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')
    return re.sub(r'\s+', ' ', s).lower()
def words(s):
    return re.findall(r"[a-z0-9'\-]+|\{\{\d+\}\}", norm(s))
def check(Y):
    Q = json.load(open(f'{T}/english1_{Y}.json'))
    P = {p['id']: p for p in json.load(open(f'{T}/english1_{Y}_passages.json'))}
    f = f'{T}/explanations/english1_{Y}_expert.jsonl'
    if not os.path.exists(f): return []
    E = {}
    for l in open(f):
        d = json.loads(l); E[d['id']] = d
    cl = [q for q in Q if q['section'] == 'use_of_english']
    if not cl: return []
    text = P[cl[0]['passage_id']]['text']
    W = words(text)
    answord = {}
    for q in cl:
        k = q['answer'][0]
        answord[q['number']] = norm(next(o['content'] for o in q['options'] if o['key'] == k))
    plain = ' '.join(w for w in W)  # passage with {{n}} placeholders
    pats = {}
    for n, a in answord.items():
        i = W.index('{{%d}}' % n) if '{{%d}}' % n in W else None
        if i is None: continue
        prev = [w for w in W[max(0, i-2):i] if not w.startswith('{{')]
        nxt = [w for w in W[i+1:i+3] if not w.startswith('{{')]
        ps = []
        if prev: ps.append(' '.join(prev[-1:] + [a]))
        if nxt: ps.append(' '.join([a] + nxt[:1]))
        pats[n] = [p for p in ps if p not in plain]  # skip if occurs naturally
    bad = []
    for q in cl:
        d = E.get(q['id'])
        if not d: continue
        body = ' '.join(re.findall(r"[a-z0-9'\-]+", norm(' '.join(d['steps'][:-1]) + ' ' + d.get('remember', ''))))
        for k, ps in pats.items():
            if k == q['number']: continue
            for p in ps:
                if re.search(r'(?<![a-z])' + re.escape(p) + r'(?![a-z])', body):
                    bad.append((q['id'], k, p))
        # rule 2: another blank's answer inside quoted English / 本句 text, where that word never
        # occurs in the passage outside the blanks
        st = ' '.join(d['steps'][:-1])
        quoted = norm(' | '.join(re.findall(r'[“"]([^”"]+)[”"]', st) + re.findall(r'本句：([^\n]+?)。', st)))
        for k, a in answord.items():
            if k == q['number']: continue
            if re.search(r'(?<![a-z])' + re.escape(a) + r'(?![a-z])', quoted) and \
               not re.search(r'(?<![a-z])' + re.escape(a) + r'(?![a-z])', norm(re.sub(r'\{\{\d+\}\}', ' ', text))):
                bad.append((q['id'], k, 'quoted:' + a))
        # rule 3: another blank's answer (content word, 4+ letters) mentioned anywhere in the
        # explanation, unless it is one of this blank's own options or occurs in the passage
        # outside the blanks (e.g. 2024-17 写「match / suit / complement」, suit 是 19 空答案)
        own = {norm(o['content']) for o in q['options']}
        outside = norm(re.sub(r'\{\{\d+\}\}', ' ', text))
        for k, a in answord.items():
            if k == q['number'] or len(a) < 4 or a in own: continue
            if re.search(r'(?<![a-z])' + re.escape(a) + r'(?![a-z])', body) and \
               not re.search(r'(?<![a-z])' + re.escape(a) + r'(?![a-z])', outside) and \
               not any(x[0] == q['id'] and x[1] == k for x in bad):
                bad.append((q['id'], k, 'mention:' + a))
    return bad
# ---- rule 4: Chinese paraphrase leaks (统筹者 2026-11-02 要求) ----
# 4a 同篇其他空答案的中文释义出现在本空讲解里。释义来自两处：那一空讲解里紧跟答案词的
#    “中文”引号，和 ECDICT（../data/ecdict/ecdict.csv，不进 git，后端 import:vocab 会下载）。
#    本空自己选项的释义里也有的词不算。会有误报，结果标 suspect，需要人工看。
# 4a 只提醒，不影响退出码；4b 算泄题，退出码 1。
# 4b 讲解引用了带别的空（___）的英文原句，后面紧跟（中文译文）：译文必然把那个空填出来了。
CJK = re.compile(r'[\u4e00-\u9fff]{2,4}')
_EC = None
def ecdict(words):
    global _EC
    if _EC is None:
        _EC = {}
        cands = [os.environ.get('ECDICT_CSV'), os.path.join(T, '..', 'data', 'ecdict', 'ecdict.csv')]
        try:  # 在 git worktree 里跑时，去主工作区（后端已下好的那份）找
            import subprocess
            gc = subprocess.run(['git', '-C', T, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                                capture_output=True, text=True).stdout.strip()
            if gc: cands.append(os.path.join(os.path.dirname(gc), 'data', 'ecdict', 'ecdict.csv'))
        except Exception:
            pass
        f = next((c for c in cands if c and os.path.exists(c)), '')
        if not f:
            print('  (没有 data/ecdict/ecdict.csv，也没设 ECDICT_CSV，规则 4a 只用讲解里的释义)', file=sys.stderr)
            return set()
        import csv
        csv.field_size_limit(10**8)
        for r in csv.DictReader(open(f, encoding='utf-8')):
            _EC[r['word'].lower()] = r
    out = set()
    for w in words:
        r = _EC.get(w) if _EC else None
        if not r: continue
        lem = [x[2:] for x in (r.get('exchange') or '').split('/') if x.startswith('0:')]
        for t in [r.get('translation') or ''] + [(_EC.get(l) or {}).get('translation') or '' for l in lem]:
            t = re.sub(r'\[[^\]]*\]|（[^）]*）|\([^)]*\)', ' ', t)
            for seg in re.split(r'[,，;；、\n/]|\\n', t):
                seg = re.sub(r'^[a-z]+\.\s*', '', seg.strip())
                if re.fullmatch(r'[\u4e00-\u9fff]{2,4}', seg): out.add(seg)
    return out
def glosses_in(expl, word):
    return set(re.findall(re.escape(word) + r'\s*[“"]([\u4e00-\u9fff]{2,6})', expl, re.I))
def check_cn(Y):
    Q = json.load(open(f'{T}/english1_{Y}.json'))
    f = f'{T}/explanations/english1_{Y}_expert.jsonl'
    if not os.path.exists(f): return []
    E = {json.loads(l)['id']: json.loads(l) for l in open(f) if l.strip()}
    cl = [q for q in Q if q['section'] == 'use_of_english']
    def ans(q):
        k = q['answer'][0]; return next(o['content'] for o in q['options'] if o['key'] == k)
    G = {}
    for q in cl:
        a = ans(q).lower()
        g = ecdict(a.split()) if ' ' not in a else set()
        d = E.get(q['id'])
        if d: g |= glosses_in(' '.join(d['steps']), a)
        G[q['number']] = g
    bad = []
    for q in cl:
        d = E.get(q['id'])
        if not d: continue
        body = ' '.join(d['steps'][:-1]) + ' ' + d.get('remember', '')
        own = set()
        for o in q['options']:
            own |= ecdict(o['content'].lower().split()) | glosses_in(body, o['content'])
        for k, g in G.items():
            if k == q['number']: continue
            for t in sorted(g - own):
                if t in body:
                    bad.append((q['id'], k, 'suspect-cn:' + t)); break
        for m in re.finditer(r'[“"]([^”"]*___[^”"]*)[”"]\s*[（(]([^）)]*[\u4e00-\u9fff][^）)]*)[）)]', body):
            if not body.startswith('本句') or m.start() > 0:
                bad.append((q['id'], '?', 'suspect-cn-gloss:' + m.group(2)[:20]))
    return bad
if __name__ == '__main__':
    ys = sys.argv[1:] or sorted({re.search(r'english1_(\d{4})_expert', f).group(1) for f in glob.glob(f'{T}/explanations/english1_[0-9][0-9][0-9][0-9]_expert.jsonl')})
    allbad = []
    for y in ys:
        cn = check_cn(y)
        b = check(y) + [x for x in cn if x[2].startswith('suspect-cn-gloss')]; allbad += b
        warn = [x for x in cn if not x[2].startswith('suspect-cn-gloss')]
        print(y, 'leaks', len(b), '| 中文释义疑似（只提醒，不影响退出码，需人工看）', len(warn))
        for x in b: print('  ', x)
        for x in warn: print('   ?', x)
    sys.exit(1 if allbad else 0)
