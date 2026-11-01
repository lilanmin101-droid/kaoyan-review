import json,re,sys; sys.path.insert(0,'pipeline'); from common import *
F='math1_2018.json'; qs=json.load(open(F)); Q={q['number']:q for q in qs}
for n in range(15,24):
    Q[n]['solution']=fix_labels(Q[n]['solution']); Q[n]['stem']=split_stem_parts(Q[n]['stem'])
s=Q[20]['solution']
s=re.sub(r'令 \$\\binom\{y_1\}\{y_2\}=.*?\$',r'令 $\\begin{cases}y_1=x_1-x_2+x_3,\\\\ y_2=x_2+x_3,\\\\ y_3=x_1+ax_3,\\end{cases}$，',s,count=1,flags=re.S)
Q[20]['solution']=s
s=Q[21]['solution']; i=s.index('得\n\n$$\n\\mathbf {X} _ {1}'); j=s.index('则所求的可逆矩阵为')
v=lambda a,b:r'\begin{pmatrix}%s\\%s\\%s\end{pmatrix}'%(a,b,'0') 
xi=r'\boldsymbol{\xi}=\begin{pmatrix}-6\\2\\1\end{pmatrix}'
s=s[:i]+'得 $'+xi+r'$，' +'\n\n$$\n'+r'\boldsymbol X_1=k_1\boldsymbol\xi+\begin{pmatrix}3\\-1\\0\end{pmatrix},\quad \boldsymbol X_2=k_2\boldsymbol\xi+\begin{pmatrix}4\\-1\\0\end{pmatrix},\quad \boldsymbol X_3=k_3\boldsymbol\xi+\begin{pmatrix}4\\-1\\0\end{pmatrix},'+'\n$$\n\n'+s[j:]
Q[21]['solution']=s
P=r'$P=\begin{pmatrix}3-6k_1&4-6k_2&4-6k_3\\2k_1-1&2k_2-1&2k_3-1\\k_1&k_2&k_3\end{pmatrix}$（$k_2\neq k_3$）'
set_subs(Q,{15:[('求不定积分',r'$\frac12\mathrm e^{2x}\arctan\sqrt{\mathrm e^x-1}-\frac16(\mathrm e^x+2)\sqrt{\mathrm e^x-1}+C$')],
16:[('面积之和是否有最小值',r'存在，最小值为 $\frac{1}{\pi+4+3\sqrt3}$')],
17:[('计算曲面积分 $I$',r'$\frac{14\pi}{45}$')],
18:[('$f(x)=x$ 时求通解',r'$y=C\mathrm e^{-x}+x-1$'),('证明存在唯一 $T$ 周期解','证明题')],
19:[('证明收敛并求极限',r'$\lim_{n\to\infty}x_n=0$')],
20:[('求 $f=0$ 的解',r'$a\neq2$ 时只有零解；$a=2$ 时 $x=k(-2,-1,1)^{\mathrm T}$'),('求规范形',r'$a\neq2$ 时 $y_1^2+y_2^2+y_3^2$；$a=2$ 时 $y_1^2+y_2^2$')],
21:[('求 $a$',r'$a=2$'),('求可逆矩阵 $P$',P)],
22:[(r'求 $\operatorname{Cov}(X,Z)$',r'$\lambda$'),('求 $Z$ 的概率分布',r'$P\{Z=0\}=\mathrm e^{-\lambda}$；$P\{Z=k\}=\frac12\frac{\lambda^{|k|}}{|k|!}\mathrm e^{-\lambda},\ k=\pm1,\pm2,\dots$')],
23:[(r'求 $\hat\sigma$',r'$\hat\sigma=\frac1n\sum_{i=1}^n|X_i|$'),(r'求 $E(\hat\sigma),D(\hat\sigma)$',r'$E(\hat\sigma)=\sigma,\ D(\hat\sigma)=\frac{\sigma^2}{n}$')]})
json.dump(qs,open(F,'w'),ensure_ascii=False,indent=2); print('ok')
