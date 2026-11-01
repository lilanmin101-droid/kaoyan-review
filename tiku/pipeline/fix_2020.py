import json,re
F='math1_2020.json'; qs=json.load(open(F)); Q={q['number']:q for q in qs}
Q[1]['stem']=Q[1]['stem'].rstrip(' （(')
o=Q[3]['options']
if len(o)==3:
    c,d=o[2]['content'].split('存在',1)[0]+'存在', o[2]['content'].split('存在',1)[1]
    o[2]['content']=c.strip(); o.append({'key':'D','content':d.strip()})
Q[3]['stem']=Q[3]['stem'].replace('在点(0，0）处','在点 $(0,0)$ 处').replace(', - 1\\right)\\bigg|_{(0,0)}$ 非零',', - 1\\right)\\bigg|_{(0,0)}$ ，非零')
Q[8]['options'][2]['content']='$1 - \\Phi (0.2)$'
Q[22]['stem']=re.sub(r'服从标准正态分布[，,]\s*$','服从标准正态分布.',Q[22]['stem'])
# Q20 (II) OCR 把 2x2 矩阵识别成 binom，按原解法重写
s=Q[20]['solution']; i=s.index('（Ⅱ）')
Q[20]['solution']=s[:i]+r'''（Ⅱ）由 $0\boldsymbol{E}-\boldsymbol{A}\to\begin{pmatrix}1&-2\\0&0\end{pmatrix}$ 得 $\boldsymbol{A}$ 的属于 $\lambda_1=0$ 的特征向量 $\boldsymbol{\alpha}_1=\begin{pmatrix}2\\1\end{pmatrix}$；

由 $5\boldsymbol{E}-\boldsymbol{A}\to\begin{pmatrix}2&1\\0&0\end{pmatrix}$ 得 $\boldsymbol{A}$ 的属于 $\lambda_2=5$ 的特征向量 $\boldsymbol{\alpha}_2=\begin{pmatrix}-1\\2\end{pmatrix}$.

令 $\boldsymbol{Q}_1=\frac{1}{\sqrt5}\begin{pmatrix}2&-1\\1&2\end{pmatrix}$，则 $\boldsymbol{Q}_1^{\mathrm T}\boldsymbol{A}\boldsymbol{Q}_1=\begin{pmatrix}0&0\\0&5\end{pmatrix}$.

由 $0\boldsymbol{E}-\boldsymbol{B}=\begin{pmatrix}-4&-2\\-2&-1\end{pmatrix}\to\begin{pmatrix}1&\frac12\\0&0\end{pmatrix}$ 得 $\boldsymbol{B}$ 的属于 $\lambda_1=0$ 的特征向量 $\boldsymbol{\beta}_1=\begin{pmatrix}-1\\2\end{pmatrix}$；

由 $5\boldsymbol{E}-\boldsymbol{B}\to\begin{pmatrix}1&-2\\0&0\end{pmatrix}$ 得 $\boldsymbol{B}$ 的属于 $\lambda_2=5$ 的特征向量 $\boldsymbol{\beta}_2=\begin{pmatrix}2\\1\end{pmatrix}$.

令 $\boldsymbol{Q}_2=\frac{1}{\sqrt5}\begin{pmatrix}-1&2\\2&1\end{pmatrix}$，则 $\boldsymbol{Q}_2^{\mathrm T}\boldsymbol{B}\boldsymbol{Q}_2=\begin{pmatrix}0&0\\0&5\end{pmatrix}$.

由 $\boldsymbol{Q}_1^{\mathrm T}\boldsymbol{A}\boldsymbol{Q}_1=\boldsymbol{Q}_2^{\mathrm T}\boldsymbol{B}\boldsymbol{Q}_2$ 得 $\boldsymbol{B}=(\boldsymbol{Q}_1\boldsymbol{Q}_2^{\mathrm T})^{\mathrm T}\boldsymbol{A}(\boldsymbol{Q}_1\boldsymbol{Q}_2^{\mathrm T})$，所求正交矩阵为

$$
\boldsymbol{Q}=\boldsymbol{Q}_1\boldsymbol{Q}_2^{\mathrm T}=\frac15\begin{pmatrix}2&-1\\1&2\end{pmatrix}\begin{pmatrix}-1&2\\2&1\end{pmatrix}=\frac15\begin{pmatrix}-4&3\\3&4\end{pmatrix}.
$$'''
# Q23: 删除源文件尾部重复乱码块，补回两行公式
s=Q[23]['solution']; s=s[:s.index('\n\n$$\n\\begin{array}{l} F _ {Y}')]
s=s.replace('（Ⅱ） $T$ 的概率密度为\n','（Ⅱ） $T$ 的概率密度为\n\n$$\nf(t)=F\'(t)=\\begin{cases}\\dfrac{mt^{m-1}}{\\theta^m}\\mathrm{e}^{-\\left(\\frac{t}{\\theta}\\right)^m}, & t>0,\\\\ 0, & \\text{其他},\\end{cases}\n$$\n\n似然函数为 ')
s=s.replace('= 0$ 得\n','= 0$ 得\n\n$$\n\\hat\\theta^m=\\frac1n\\sum_{i=1}^n t_i^m,\n$$\n')
Q[23]['solution']=s
SQ={15:[('求函数的极值',r'$(0,0)$ 不是极值点；极小值 $f\left(\frac16,\frac1{12}\right)=-\frac1{216}$')],
16:[('计算曲线积分 $I$',r'$\pi$')],
17:[('证明收敛并求和函数',r'$S(x)=\frac{2}{\sqrt{1-x}}-2,\ |x|<1$')],
18:[('计算曲面积分 $I$',r'$\frac{14}{3}\pi$')],
19:[('证明存在 $\\xi$ 使 $|f\'(\\xi)|\\geqslant M$','证明题'),('若 $|f\'(x)|\\leqslant M$，证明 $M=0$','证明题')],
20:[('求 $a,b$',r'$a=4,\ b=1$'),('求正交矩阵 $Q$',r'$\boldsymbol{Q}=\frac15\begin{pmatrix}-4&3\\3&4\end{pmatrix}$')],
21:[('证明 $P$ 可逆','证明题'),('求 $P^{-1}AP$ 并判断 $A$ 能否对角化',r'$P^{-1}AP=\begin{pmatrix}0&6\\1&-1\end{pmatrix}$，$A$ 相似于对角矩阵')],
22:[('求 $(X_1,Y)$ 的分布函数',r'$F(x,y)=\begin{cases}\frac12\Phi(x)\Phi(y)+\frac12\Phi(x),&x<y\\ \frac12\Phi(x)\Phi(y)+\frac12\Phi(y),&x\geqslant y\end{cases}$'),('（Ⅱ）','证明题')],
23:[('求 $P\\{T>t\\}$ 与 $P\\{T>s+t\\mid T>s\\}$',r'$P\{T>t\}=\mathrm e^{-(t/\theta)^m}$，$P\{T>s+t\mid T>s\}=\mathrm e^{(s/\theta)^m-((s+t)/\theta)^m}$'),('求 $\\theta$ 的最大似然估计值',r'$\hat\theta=\sqrt[m]{\frac1n\sum_{i=1}^n t_i^m}$')]}
for n,l in SQ.items():
    q=Q[n]; single=len(l)==1
    q['sub_questions']=[{'number':k+1,'stem':a,'score':q['score'] if single else None,'answer':[b]} for k,(a,b) in enumerate(l)]
    q['answer']=['见各小问']
Q[22]['sub_questions'][1]['stem']=r'证明 $Y$ 服从标准正态分布'
sq=Q[20]['sub_questions'][1]; sq['answer']=[sq['answer'][0]+'（答案不唯一：$Q$ 的各列可同时取反等，满足 $Q^{\\mathrm T}Q=E$ 且 $Q^{\\mathrm T}AQ=\\begin{pmatrix}4&2\\\\2&1\\end{pmatrix}$ 即正确）']
json.dump(qs,open(F,'w'),ensure_ascii=False,indent=2); print('ok')
