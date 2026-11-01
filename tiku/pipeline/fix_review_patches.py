import json
def patch(F,fn):
    qs=json.load(open(F)); Q={q['number']:q for q in qs}
    def R(n,a,b,cnt=1,field='solution'):
        s=Q[n][field]; c=s.count(a)
        if c==0 and b in s: return
        assert c==cnt,(F,n,a,c); Q[n][field]=s.replace(a,b)
    fn(Q,R); json.dump(qs,open(F,'w'),ensure_ascii=False,indent=2)
def p2023(Q,R):
    R(20,'(-a - x_0)^2, - a <   \\gamma_1 <   0.$','(-a - x_0)^2, - a <   \\gamma_1 <   x_0.$')
    R(20,'\\left(a - x _ {0}\\right) ^ {2}, 0 <   \\gamma_ {2} <   a.','\\left(a - x _ {0}\\right) ^ {2}, x _ {0} <   \\gamma_ {2} <   a.')
    R(20,'M = \\max \\left\\{\\left|f\'\'(\\gamma_1)\\right|,\\right\\} \\left|f\'\'(\\gamma_2)\\right|$','M = \\max \\left\\{\\left|f\'\'(\\gamma_1)\\right|, \\left|f\'\'(\\gamma_2)\\right|\\right\\}$')
def p2019(Q,R):
    R(2,'$f(x) = \\begin{cases} x & |x|, \\\\ x \\ln x, \\end{cases} \\quad x \\leqslant 0$ ,','$f(x) = \\begin{cases} x|x|, & x \\leqslant 0, \\\\ x \\ln x, & x > 0, \\end{cases}$',field='stem')
patch('math1_2023.json',p2023); patch('math1_2019.json',p2019); print('ok')
def p2018(Q,R):
    R(20,'= 2 \\left(x _ {1} - x _ {2} + x _ {3}\\right) ^ {2}','= 2 \\left(x _ {1} - \\frac {1}{2} x _ {2} + \\frac {3}{2} x _ {3}\\right) ^ {2}',2)
    R(20,'k(-2, - 1,1)^{\\mathrm{T}}$ ，其中 $k\\neq 0$','k(-2, - 1,1)^{\\mathrm{T}}$ ，其中 $k$ 为任意常数')
patch('math1_2018.json',p2018); print('ok2018')
def p2017(Q,R):
    a=Q[21]['sub_questions'][0]['answer']
    if not any('不唯一' in x for x in a): a[0]+='（$Q$ 不唯一，满足 $Q^{\\mathrm T}Q=E$ 且 $Q^{\\mathrm T}AQ=\\mathrm{diag}(-3,6,0)$ 即正确）'
patch('math1_2017.json',p2017); print('ok2017')
def p2020(Q,R):
    R(1,'\\frac{\\int_0^xf(x - t)\\mathrm{d}t}{x^n} = \\lim_{x\\to 0}\\frac{x\\int_0^xf(u)\\mathrm{d}u - \\int_0^xf(u)\\mathrm{d}u}{x^n}',
         '\\frac{\\int_0^xtf(x - t)\\mathrm{d}t}{x^n} = \\lim_{x\\to 0}\\frac{x\\int_0^xf(u)\\mathrm{d}u - \\int_0^xuf(u)\\mathrm{d}u}{x^n}')
    R(1,'\\alpha = \\int_{0}^{e^x -1}\\frac{\\sin t^2}{t}','\\alpha = \\int_{0}^{\\mathrm{e}^{x^2} -1}\\frac{\\sin t^2}{t}')
    R(5,'\\mathbf{A} = \\mathbf{B}_{t}^{-1}\\dots','\\mathbf{A} = \\mathbf{B}\\mathbf{P}_{t}^{-1}\\dots')
    R(6,'L_{1}: \\binom{x}{y}=x_{2}+t\\alpha_{1}$','L_{1}: \\left( \\begin{array}{c}x\\\\ y\\\\ z \\end{array} \\right) = \\pmb{\\alpha}_{2} + t\\pmb{\\alpha}_{1}$')
    R(7,'P(A\\overline{B}\\overline{C}) + P(\\overline{A} BC) + P(\\overline{ABC})','P(A\\overline{B}\\overline{C}) + P(\\overline{A}B\\overline{C}) + P(\\overline{A}\\,\\overline{B}C)')
    R(12,'\\int_{0}^{x^{\\frac{3}{2} y}}','\\int_{0}^{x^{\\frac{3}{2}}y}')
def p2019b(Q,R):
    R(12,'设 $\\Sigma$ 设为曲面','设 $\\Sigma$ 为曲面',field='stem')
patch('math1_2020.json',p2020); patch('math1_2019.json',p2019b); print('ok2020')
def p2019c(Q,R):
    im='images/math1-2019/q06_planes.png'  # 裁自 src/originals/math1_2019_paper.png（fjh1997/China-NPEE-math）
    if im not in (Q[6].get('images') or []): Q[6]['images']=(Q[6].get('images') or [])+[im]
patch('math1_2019.json',p2019c); print('ok2019c')
def add(Q,n,anchor,text,before=False):
    s=Q[n]['solution']
    if text in s: return
    if anchor is None: Q[n]['solution']=s.rstrip()+'\n\n'+text; return
    assert s.count(anchor)==1,(n,anchor); i=s.find(anchor)
    Q[n]['solution']=s[:i]+text+'\n\n'+s[i:] if before else s
def p2018b(Q,R):
    add(Q,4,None,r'**补充** 这里 $\frac{2x}{1+x^{2}}$ 是奇函数，在对称区间上积分为 0，故 $M=\pi$；由 $\mathrm{e}^{x}>1+x\ (x\neq 0)$ 得 $\frac{1+x}{\mathrm{e}^{x}}<1\ (x\neq 0)$，故 $N<\pi$；而 $1+\sqrt{\cos x}\geqslant 1$ 且不恒等于 1，故 $K>\pi$.')
    add(Q,5,'方法二\n',r'**补充** $r(E-M)=r(E-A)=2$ 只是相似的必要条件。本题能断定相似，是因为两个矩阵都只有特征值 1，且都只有一个约当块；严格的结论以方法二直接验证 $P^{-1}AP$ 为准.',before=True)
def p2017b(Q,R):
    add(Q,8,None,r'**补充** $X_n-X_1\sim N(0,2)$，所以 $\frac{(X_n-X_1)^2}{2}\sim\chi^2(1)$，而 $2(X_n-X_1)^2$ 不服从 $\chi^2$ 分布，故选(B).')
patch('math1_2018.json',p2018b); patch('math1_2017.json',p2017b); print('okb')
