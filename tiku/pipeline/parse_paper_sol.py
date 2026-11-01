"""数一 2015–2021：题干取 paper_<y>.md，答案+解析取 sol_<y>.md。
用法: python3 parse_paper_sol.py <year>   输出 /workspace/tiku/math1_<year>.json（大题小问需另行补充）"""
import re,json,sys
Y=int(sys.argv[1]); base='/workspace/tiku/src/math1/'
P=open(f'{base}paper_{Y}.md').read().replace('\r','')
S=open(f'{base}sol_{Y}.md').read().replace('\r','')
N=22 if Y>=2021 else 23
NC,NF=(10,6) if Y>=2021 else (8,6)
PT=5 if Y>=2021 else 4
def kind(n):
    if n<=NC: return 'single_choice','选择题',PT
    if n<=NC+NF: return 'fill_blank','填空题',PT
    return 'essay','解答题',None
# ---- paper split (OCR 常丢左括号或十位数字)
lines=P.split('\n'); st={}; want=1
for i,l in enumerate(lines):
    m=re.match(r'^\s*(?:#\s*)?[（(]?\s*(\d{1,2})\s*[)）]',l)
    if not m: continue
    n=int(m.group(1))
    if n==want or (11<=want<=NC+NF and n==want%10):
        st[want]=i; want+=1
        if want>N: break
miss=[n for n in range(1,N+1) if n not in st]
if miss: print('题干缺题号',miss)
def pbody(n):
    a=st[n]; b=st.get(n+1,len(lines))
    t='\n'.join(lines[a:b])
    t=re.sub(r'^\s*(?:#\s*)?[（(]?\s*\d{1,2}\s*[)）]\s*','',t,count=1)
    t=re.split(r'\n\s*#?\s*[二三]、',t)[0]
    return t.strip()
# ---- sol split: 任意位置的「（n）【」，按顺序找
pos={}; cur=0
for n in range(1,N+1):
    m=re.compile(r'[（(]\s*%d\s*[)）]\s*【'%n).search(S,cur)
    if m: pos[n]=m.start(); cur=m.end()
smiss=[n for n in range(1,N+1) if n not in pos]
if smiss: print('解析缺题号',smiss)
def sbody(n):
    a=pos[n]; nxt=[pos[k] for k in range(n+1,N+1) if k in pos]
    t=S[a:(nxt[0] if nxt else len(S))]
    t=re.sub(r'^[（(]\s*\d{1,2}\s*[)）]\s*','',t)
    t=re.split(r'\n\s*#\s*[二三]、',t)[0]
    return t.strip()
def norm_opt_markers(s):
    s=re.sub(r'\$\s*\\mathrm\{\(([A-D])\)\}\s*','(\\1) $',s)
    s=re.sub(r'\$\s*\\left\(\s*\\math(?:rm|bf)\s*\{\s*([A-D])\s*\}\s*\\right\)\s*','(\\1) $',s)
    s=re.sub(r'\$\s*\(\s*\\math(?:rm|bf)\s*\{\s*([A-D])\s*\}\s*\)\s*','(\\1) $',s)
    s=re.sub(r'[（(]\s*([A-D])\s*[)）]','(\\1)',s)
    return s
def clean_opt(c):
    c=c.strip(); c=re.sub(r'^\$\s*\$\s*','',c).strip()
    c=re.sub(r'(?<!\\right)\s*[.．。]\s*\$$','$',c); c=re.sub(r'\$\s*[.．。]$','$',c); c=re.sub(r'\s*[.．。]$','',c).strip()
    if re.fullmatch(r'-?\d+(\.\d+)?',c): c=f'${c}$'
    return c
def tidy_stem(s,typ):
    s=re.sub(r'\s*[（(]\s*[)）]?\s*[.．]?\s*$','',s); s=re.sub(r'=\s*[.．]\s*\$?$',lambda m:'=$' if m.group(0).endswith('$') else '=',s)
    s=re.sub(r'\s*\(\\quad\)\s*\$$','$',s); s=re.sub(r'\s*=\s*\(\s*\)\s*\$$','=$',s); s=re.sub(r'=\s*\(\)\$$','=$',s)
    s=re.sub(r'\s*\\underline\s*\{\s*\{?\s*\\q?quad\s*\}?\s*\}\s*','',s); s=re.sub(r'\s*\\_\s*(?=\$|$)','',s); s=re.sub(r'\s*_{3,}\s*','',s)
    s=re.sub(r'\s*[.．]$','',s) if typ=='fill_blank' else s
    return s.strip()
def cut_solution(t):
    t=re.sub(r'^【\s*答案\s*】[^\n]*\n?','',t).strip()
    t=re.sub(r'【\s*解\s*】\s*','**解** ',t); t=re.sub(r'【\s*证(?:明)?\s*】\s*','**证明** ',t)
    t=re.sub(r'【\s*(?:分析|评注|注)\s*】\s*',lambda m:'**'+m.group(0).strip('【】 ')+'** ',t)
    t=re.sub(r'\n\s*#\s*\S*真题解析\s*$','',t)
    return t.strip()
qs=[]
for n in range(1,N+1):
    typ,sec,score=kind(n)
    body=pbody(n) if n in st else ''
    sol=sbody(n) if n in pos else ''
    notes=[]
    if typ=='essay':
        m=re.match(r'^[（(]\s*本题满分\s*(\d+)\s*分\s*[)）]\s*',body)
        if m: score=int(m.group(1)); body=body[m.end():]
        else: notes.append('未读到本题满分')
    options=[]; stem=body; answer=[]
    am=re.search(r'【\s*答案\s*】\s*([^\n【]*)',sol)
    araw=am.group(1).strip() if am else ''
    if typ=='single_choice':
        h=norm_opt_markers(body)
        parts=re.split(r'(?:^|\n|\s)\(([A-D])\)\s*',h)
        stem=parts[0]
        for k,c in zip(parts[1::2],parts[2::2]): options.append({'key':k,'content':clean_opt(c)})
        a=re.search(r'[A-D]',araw); answer=[a.group(0)] if a else []
    elif typ=='fill_blank':
        a=re.sub(r'^应填\s*','',araw); a=re.sub(r'\s*[.．。]\s*$','',a).strip()
        if a and '$' not in a: a=f'${a}$'
        answer=[a] if a else []
    else: answer=['见各小问']
    stem=tidy_stem(stem,typ)
    qs.append({'schema_version':'0.2','id':f'math1-{Y}-{n:02d}','exam':'math1','year':Y,'number':n,
      'section':sec,'type':typ,'score':score,'stem':stem,'images':[],'options':options,'answer':answer,
      'sub_questions':[],'solution':cut_solution(sol),'knowledge_points':[],
      'source':{'repo':'TsekaLuk/Kaoyan-Math1-Papers','files':[f'paper_{Y}.md',f'sol_{Y}.md']},
      'review':{'status':'pending','notes':notes,'checked_by':[]}})
json.dump(qs,open(f'/workspace/tiku/math1_{Y}.json','w'),ensure_ascii=False,indent=2)
for q in qs:
    sel=re.findall(r'应\s*选\s*[（(]?\s*([A-D])',q['solution'])
    flag='' if q['type']!='single_choice' or (sel and sel[-1]==q['answer'][0]) else ' <<答案/解析不一致?'
    print(q['number'],q['score'],q['answer'],len(q['options']),'|',q['stem'][-45:].replace('\n',' '),flag)
