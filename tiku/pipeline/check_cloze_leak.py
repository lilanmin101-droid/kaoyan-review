#!/usr/bin/env python3
"""Scan cloze (Q1-20) expert explanations for quoted text that reveals ANOTHER blank's answer.

A leak = the explanation contains another blank's answer adjacent to that blank's passage
neighbour words (e.g. "faced the possibility" when 'faced' fills blank 7), unless the same
word sequence also occurs naturally in the passage outside the blanks; or the answer word appears
inside a quoted English fragment / 本句 line while never occurring in the passage outside the blanks.
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
    return bad
if __name__ == '__main__':
    ys = sys.argv[1:] or sorted({re.search(r'english1_(\d{4})_expert', f).group(1) for f in glob.glob(f'{T}/explanations/english1_[0-9][0-9][0-9][0-9]_expert.jsonl')})
    allbad = []
    for y in ys:
        b = check(y); allbad += b
        print(y, 'leaks', len(b))
        for x in b: print('  ', x)
    sys.exit(1 if allbad else 0)
