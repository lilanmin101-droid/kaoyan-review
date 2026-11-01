import json,re,sys; sys.path.insert(0,'pipeline'); from common import *
F='math1_2017.json'; qs=json.load(open(F)); Q={q['number']:q for q in qs}
for q in qs: stem_images(q)
Q[4]['stem']=re.sub(r'\s*则\s*\(\s*\)\s*$','则',Q[4]['stem']).replace('10 (单位: $m$ )','10（单位：$\\mathrm{m}$）').replace('\n\n$v = v_{1}(t)$',' $v = v_{1}(t)$')
for n in range(15,24):
    Q[n]['solution']=fix_labels(Q[n]['solution']); Q[n]['stem']=split_stem_parts(Q[n]['stem'])
v=r'k\begin{pmatrix}1\\2\\-1\end{pmatrix}+\begin{pmatrix}1\\1\\1\end{pmatrix}'
Q[20]['solution']=re.sub(r'\$X = k\\binom\{1\}\{2\} \+ \\binom\{1\}\{1\}\$',lambda m:'$X='+v+'$',Q[20]['solution'])
assert 'binom' not in Q[20]['solution'], Q[20]['solution'][-200:]
Qm=r'\begin{pmatrix}\frac1{\sqrt3}&-\frac1{\sqrt2}&\frac1{\sqrt6}\\-\frac1{\sqrt3}&0&\frac2{\sqrt6}\\\frac1{\sqrt3}&\frac1{\sqrt2}&\frac1{\sqrt6}\end{pmatrix}'
set_subs(Q,{15:[(r'求 $\frac{dy}{dx}\big|_{x=0},\frac{d^2y}{dx^2}\big|_{x=0}$',r"$\frac{\mathrm dy}{\mathrm dx}\big|_{x=0}=f_1'(1,1)$，$\frac{\mathrm d^2y}{\mathrm dx^2}\big|_{x=0}=f_1'(1,1)+f_{11}''(1,1)-f_2'(1,1)$")],
16:[('求极限',r'$\frac14$')],
17:[('求极值',r'极小值 $y(-1)=0$，极大值 $y(1)=1$')],
18:[('证明至少一个实根','证明题'),('证明至少两个不同实根','证明题')],
19:[('求投影曲线方程',r'$\begin{cases}(x-1)^2+y^2=1\\z=0\end{cases}$'),('求质量 $M$',r'$64$')],
20:[(r'证明 $r(A)=2$','证明题'),(r'求 $Ax=\beta$ 的通解','$x='+v+'$，$k$ 为任意常数')],
21:[(r'求 $a$ 及正交矩阵 $Q$',r'$a=2$，$Q='+Qm+r'$，标准形 $-3y_1^2+6y_2^2$')],
22:[(r'求 $P\{Y\leqslant E(Y)\}$',r'$\frac49$'),(r'求 $Z$ 的概率密度',r'$f_Z(z)=\begin{cases}z,&0<z<1\\z-2,&2<z<3\\0,&\text{其他}\end{cases}$')],
23:[(r'求 $Z_1$ 的概率密度',r'$f(z)=\begin{cases}\frac{2}{\sqrt{2\pi}\sigma}\mathrm e^{-\frac{z^2}{2\sigma^2}},&z>0\\0,&z\leqslant0\end{cases}$'),('求矩估计量',r'$\hat\sigma=\sqrt{\frac{\pi}{2}}\,\overline Z$'),('求最大似然估计量',r'$\hat\sigma=\sqrt{\frac1n\sum_{i=1}^nZ_i^2}$')]})
json.dump(qs,open(F,'w'),ensure_ascii=False,indent=2); print('ok')
