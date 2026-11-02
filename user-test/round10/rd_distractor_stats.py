# 用法: [RD_YEARS=2015-2019] python3 rd_distractor_stats.py <最少英文词数,如1> <tiku 目录> [98题id的json(键即id)]；统计阅读A干扰项 类型/引文/逐字
import json,re,collections,sys,os
Y0,Y1=map(int,os.environ.get('RD_YEARS','2020-2025').split('-'))
MINW=int(sys.argv[1])
T=sys.argv[2] if len(sys.argv)>2 else 'tiku'
TYPES=['无中生有','偷换概念','以偏概全','正反颠倒','答非所问','过度推断','张冠李戴']
per98=set(json.load(open(sys.argv[3])) if len(sys.argv)>3 else set())
def norm(s):
    s=s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"').replace('—','-').replace('–','-')
    return re.sub(r'\s+',' ',s).strip().lower()
st=collections.Counter(); notype=[]; noq=collections.Counter(); miss=[]; locmiss=[]; bare=[]
for y in range(Y0,Y1+1):
    Q={q['id']:q for q in json.load(open(f'{T}/english1_{y}.json'))}
    P={p['id']:p for p in json.load(open(f'{T}/english1_{y}_passages.json'))}
    E={json.loads(l)['id']:json.loads(l) for l in open(f'{T}/explanations/english1_{y}_expert.jsonl')}
    for k,q in Q.items():
        if q['section']!='reading_a': continue
        grp='98' if k in per98 else '22'
        nt=norm(P[q['passage_id']]['text'])
        for s in E[k]['steps']:
            if not re.match(r'^[A-D] 错',s): continue
            st[grp]+=1
            head=re.match(r'^[A-D] 错：([^。，,；]{2,8})',s)
            if not any(t in (head.group(1) if head else '') for t in TYPES): notype.append((grp,k,s[0]))
            qs=[m.group(1) for m in re.finditer(r'[“"]([^“”"]*[A-Za-z0-9][^“”"]*)[”"]',s) if not re.search(r'[\u4e00-\u9fff]',m.group(1)) and len(m.group(1).split())>=MINW]
            if not qs: noq[(grp,k)]+=1
            if not re.search(r'第\d+(?:[、，,和至–-]\d+)*段',s): locmiss.append((grp,k,s[0]))
            if not qs and not re.search(r'[A-Za-z]+(?: [A-Za-z’\']+){2,}',s): bare.append((grp,k,s[0]))
            for x in qs:
                for p in re.split(r'\s*(?:…|\.\.\.)\s*',x):
                    pn=norm(p).rstrip('.,;:?!')
                    if pn and pn not in nt: miss.append((grp,k,s[0],p))
print(st)
print('notype',len(notype),collections.Counter(g for g,_,_ in notype)); print([x for x in notype if x[0]=='22'])
print('noquote distractors',sum(noq.values()),'items',len(noq)); print(sorted(noq.items()))
print('quote miss',len(miss)); [print(m) for m in miss]
print('no paragraph locator',len(locmiss),locmiss)
print('no quoted and no bare English (>=3 words)',len(bare),bare)
