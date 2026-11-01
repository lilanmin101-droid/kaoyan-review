"""2022 数一：sol_2022.md 题干+答案+解析写在一起（题号 3/4/5 丢失，按行号补）。"""
import re,json
L=open('/workspace/tiku/src/math1/sol_2022.md').read().split('\n')
starts={1:7,2:41,3:73,4:109,5:135}
for i,l in enumerate(L,1):
    m=re.match(r'^(\d{1,2}) ',l)
    if m and 6<=int(m.group(1))<=22 and int(m.group(1)) not in starts: starts[int(m.group(1))]=i
END=1079
def block(n):
    a=starts[n]; b=starts.get(n+1,END)
    return L[a-1:b-1]
def cut_solution(t):
    t=re.split(r'\n#\s*(?:拓展|[一二三]、)',t)[0]
    if '【例】' in t:
        pre=t.split('【例】')[0].rstrip().split('\n\n')
        if pre and re.search(r'出现过|出题思路',pre[-1]): pre=pre[:-1]
        t='\n\n'.join(pre)
    t=re.sub(r'^分析\s*','**分析** ',t,flags=re.M)
    t=re.sub(r'^解\s*(?=[（(]|\S)','**解** ',t,flags=re.M)
    t=re.sub(r'^证\s+','**证明** ',t,flags=re.M)
    t=re.sub(r'^注\s+','**注** ',t,flags=re.M)
    return t.strip()
def norm_opt_markers(s):
    s=re.sub(r'\$\s*\\mathrm\{\(([A-D])\)\}\s*','(\\1) $',s)
    s=re.sub(r'\$\s*\(\\math(?:rm|bf)\s*\{\s*([A-D])\s*\}\)\s*','(\\1) $',s)
    return s
def clean_opt(c):
    c=c.strip()
    c=re.sub(r'\$\s*\$','',c).strip()
    c=re.sub(r'\s*[.．。]\s*\$$','$',c); c=re.sub(r'\$\s*[.．。]$','$',c); c=re.sub(r'[.．。]$','',c).strip()
    if re.fullmatch(r'-?\d+(\.\d+)?',c): c=f'${c}$'
    if '$' not in c and re.search(r'[A-Za-z]',c):
        c=re.sub(r'([A-Za-z0-9_^{}\\]+)',r'$\1$',c)
    return c
ans_tab={1:'B',2:'B',3:'D',4:'A',5:'A',6:'C',7:'C',8:'C',9:'A',10:'D'}
qs=[]
for n in range(1,23):
    lines=block(n); txt='\n'.join(lines)
    if n==6: txt=txt.replace('\n$\\left( \\begin{array}{ll}AB','\n(D) $\\left( \\begin{array}{ll}AB')
    if n==9:
        txt=txt.replace('$\\left(\\mathrm{C}\\right)','(C) $').replace('\n$\\frac{\\mu_2 - \\mu_1^2}{\\sqrt{n}','\n(D) $\\frac{\\mu_2 - \\mu_1^2}{\\sqrt{n}')
    txt=re.sub(r'^\d{1,2} ','',txt,count=1)
    if n<=10: typ,sec,score='single_choice','选择题',5
    elif n<=16: typ,sec,score='fill_blank','填空题',5
    else: typ,sec,score='essay','解答题',(10 if n==17 else 12)
    m=re.search(r'^答案\s',txt,re.M); s=re.search(r'^(分析|解|证)\s',txt,re.M)
    head_end=min(x.start() for x in (m,s) if x)
    head=txt[:head_end].strip()
    sol=txt[s.start():] if s else ''
    options=[]; stem=head; answer=[]
    if typ=='single_choice':
        h=norm_opt_markers(head)
        parts=re.split(r'(?:^|\n|\s)\(([A-D])\)\s*',h)
        stem=parts[0].strip()
        for k,c in zip(parts[1::2],parts[2::2]): options.append({'key':k,'content':clean_opt(c)})
        stem=re.sub(r'[（(]\s*[)）]?\s*$','',stem).strip()
        stem=re.sub(r'\s*\(\\quad\)\s*\$$','$',stem).strip()
        answer=[ans_tab[n]]
    elif typ=='fill_blank':
        a=re.search(r'^答案\s*(?:应填)?\s*(.+)$',txt,re.M).group(1).strip()
        a=re.sub(r'[.．。]$','',a).strip()
        if '$' not in a: a=f'${a}$'
        answer=[a]
        stem=re.sub(r'\s*\\underline\{\\quad\}\s*|\s*_{3,}\s*','',stem); stem=re.sub(r'\s*[.．]$','',stem).strip()
    qs.append({'schema_version':'0.2','id':f'math1-2022-{n:02d}','exam':'math1','year':2022,'number':n,
      'section':sec,'type':typ,'score':score,'stem':stem,'images':[],'options':options,'answer':answer,
      'sub_questions':[],'solution':cut_solution(sol),'knowledge_points':[],
      'source':{'repo':'TsekaLuk/Kaoyan-Math1-Papers','files':['sol_2022.md']},
      'review':{'status':'pending','notes':[],'checked_by':[]}})
json.dump(qs,open('/workspace/tiku/math1_2022.json','w'),ensure_ascii=False,indent=2)
for q in qs[:16]:
    print(q['number'],'|',q['stem'][-60:],'|',[o['content'] for o in q['options']],q['answer'])
# ---- 大题小问与最终答案（来自解析与答案速查，已手核）
qs=json.load(open('/workspace/tiku/math1_2022.json')); Q={q['number']:q for q in qs}
def single(n,stem,ans):
    Q[n]['answer']=['见各小问']; Q[n]['sub_questions']=[{'number':1,'stem':stem,'score':Q[n]['score'],'answer':ans}]
single(17,'求曲线 $y=y(x)$ 的渐近线',['$y(x)=2x+\\mathrm{e}^{1-\\sqrt{x}}$，渐近线为 $y=2x$（斜渐近线，也是唯一的渐近线）'])
single(18,'计算 $I$',['$I=2\\pi-2$'])
single(19,'计算 $I$',['$I=0$'])
single(20,'证明充分必要条件',['证明题，证明见解析'])
single(22,'求 $\\theta$ 的最大似然估计量 $\\hat{\\theta}$，并求 $D(\\hat{\\theta})$',
  ['$\\hat{\\theta}=\\dfrac{2\\sum_{i=1}^{n}X_i+\\sum_{j=1}^{m}Y_j}{2(m+n)}$，$D(\\hat{\\theta})=\\dfrac{\\theta^2}{m+n}$'])
Q[21]['stem']='设二次型 $f(x_{1}, x_{2}, x_{3}) = \\sum_{i=1}^{3} \\sum_{j=1}^{3} ijx_{i}x_{j}$.\n\n(I) 写出 $f(x_{1},x_{2},x_{3})$ 对应的矩阵；\n\n(II) 求正交变换 $x = Qy$ 将 $f(x_{1},x_{2},x_{3})$ 化为标准形；\n\n(III) 求 $f(x_{1},x_{2},x_{3}) = 0$ 的解.'
Q[21]['answer']=['见各小问']
Q[21]['sub_questions']=[
 {'number':1,'stem':'写出 $f$ 对应的矩阵','score':None,'answer':['$A=\\begin{pmatrix}1&2&3\\\\2&4&6\\\\3&6&9\\end{pmatrix}$']},
 {'number':2,'stem':'求正交变换 $x=Qy$ 将 $f$ 化为标准形','score':None,'answer':['$Q=\\begin{pmatrix}\\frac{1}{\\sqrt{14}}&-\\frac{2}{\\sqrt5}&-\\frac{3}{\\sqrt{70}}\\\\\\frac{2}{\\sqrt{14}}&\\frac{1}{\\sqrt5}&-\\frac{6}{\\sqrt{70}}\\\\\\frac{3}{\\sqrt{14}}&0&\\frac{5}{\\sqrt{70}}\\end{pmatrix}$，标准形 $14y_1^2$']},
 {'number':3,'stem':'求 $f(x_1,x_2,x_3)=0$ 的解','score':None,'answer':['$x=k_1(-2,1,0)^T+k_2(-3,0,1)^T$，$k_1,k_2$ 为任意常数']}]
json.dump(qs,open('/workspace/tiku/math1_2022.json','w'),ensure_ascii=False,indent=2)
