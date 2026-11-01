import json,re
F='math1_2019.json'; qs=json.load(open(F)); Q={q['number']:q for q in qs}
# 解析缺题号 18/20：从 17、19 的解析尾部切出
s=Q[17]['solution']; i=s.index('(18)（I）'); Q[17]['solution']=s[:i].rstrip(); Q[18]['solution']=s[i+4:].strip()
s=Q[19]['solution']; i=s.index('（20）（I）'); Q[19]['solution']=s[:i].rstrip(); Q[20]['solution']=s[i+4:].strip()
for n in (18,20):
    Q[n]['solution']=re.sub(r'^（I）\*\*(解|证明)\*\*\s*',r'**\1** （I）',Q[n]['solution'])
Q[8]['options'][3]['content']=re.sub(r'\s*!\[\]\([^)]*\)','',Q[8]['options'][3]['content']).rstrip('.').strip()
v=r'\begin{pmatrix}1\\-2\\1\end{pmatrix}'
Q[13]['answer']=[f'$X=k{v}$（$k$ 为任意常数）']
Q[13]['solution']=Q[13]['solution'].replace(r'\binom{1}{-2}',v).replace('(k$ 为任意常数）','$（$k$ 为任意常数）')
Q[16]['stem']=Q[16]['stem'].replace('在点(3,4)处','在点 $(3,4)$ 处')
# 小问标号被识别进公式块
Q[21]['solution']=Q[21]['solution'].replace('$$\n(\\text {I I}) \\mathbf {A}','（Ⅱ）\n\n$$\n\\mathbf {A}')
Q[22]['solution']=Q[22]['solution'].replace('$$\n\\begin{array}{l} (\\mathrm {I I}) \\operatorname','（Ⅱ）\n\n$$\n\\begin{array}{l} \\operatorname')
Q[23]['solution']=Q[23]['solution'].replace('$\\left(\\mathrm{II}\\right)L','（Ⅱ）$L')
for n in range(15,24):
    s=Q[n]['stem']; Q[n]['stem']=re.sub(r'\s*\((I{1,3})\)\s*',lambda m:'\n\n（'+{'I':'I','II':'Ⅱ','III':'Ⅲ'}[m.group(1)]+'）',s)
    Q[n]['stem']=re.sub(r'[ \t]*；?\s{2,}（(I|Ⅱ|Ⅲ)）',r'\n\n（\1）',Q[n]['stem']).replace('\n\n\n','\n\n')
SQ={15:[('求 $y(x)$',r'$y=x\mathrm e^{-\frac{x^2}{2}}$'),('求凹凸区间及拐点',r'凸区间 $(-\infty,-\sqrt3)$、$(0,\sqrt3)$，凹区间 $(-\sqrt3,0)$、$(\sqrt3,+\infty)$；拐点 $(-\sqrt3,-\sqrt3\mathrm e^{-\frac32})$、$(0,0)$、$(\sqrt3,\sqrt3\mathrm e^{-\frac32})$')],
16:[('求 $a,b$',r'$a=b=-1$'),('求曲面面积',r'$\frac{13}{3}\pi$')],
17:[('求面积',r'$\frac12+\frac{1}{\mathrm e^{\pi}-1}$')],
18:[('证明单调递减及递推式','证明题'),(r'求 $\lim\frac{a_n}{a_{n-1}}$',r'$1$')],
19:[('求形心坐标',r'$\left(0,\frac14,\frac14\right)$')],
20:[('求 $a,b,c$',r'$a=3,\ b=2,\ c=-2$'),('证明为基并求过渡矩阵',r'$\begin{pmatrix}1&1&0\\-\frac12&0&1\\\frac12&0&0\end{pmatrix}$')],
21:[('求 $x,y$',r'$x=3,\ y=-2$'),('求可逆矩阵 $P$',r'$P=\begin{pmatrix}-1&-1&-1\\2&1&2\\0&0&4\end{pmatrix}$')],
22:[('求 $Z$ 的概率密度',r'$f_Z(z)=\begin{cases}p\mathrm e^{z},&z<0\\(1-p)\mathrm e^{-z},&z\geqslant0\end{cases}$'),('$p$ 为何值时不相关',r'$p=\frac12$'),('是否相互独立','不相互独立')],
23:[('求 $A$',r'$A=\sqrt{\frac{2}{\pi}}$'),(r'求 $\sigma^2$ 的最大似然估计量',r'$\hat\sigma^2=\frac1n\sum_{i=1}^n(X_i-\mu)^2$')]}
for n,l in SQ.items():
    q=Q[n]; single=len(l)==1
    q['sub_questions']=[{'number':k+1,'stem':a,'score':q['score'] if single else None,'answer':[b]} for k,(a,b) in enumerate(l)]
    q['answer']=['见各小问']
json.dump(qs,open(F,'w'),ensure_ascii=False,indent=2); print('ok')
