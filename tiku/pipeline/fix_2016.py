import json,re,sys; sys.path.insert(0,'pipeline'); from common import *
F='math1_2016.json'; qs=json.load(open(F)); Q={q['number']:q for q in qs}
for q in qs: stem_images(q)
for o in Q[2]['options']:
    o['content']=re.sub(r'\\right\$$',r'\\right.$',o['content'])
Q[13]['answer']=[a.replace('+4.$','+4$') for a in Q[13]['answer']]
Q[16]['solution']=Q[16]['solution'].replace('\\frac{C_1}{\\lambda_1} +\\frac{C_1}{\\lambda_1}','\\frac{C_1}{\\lambda_1} +\\frac{C_2}{\\lambda_2}')
s=Q[20]['solution']; i=s.find('由 $X_{1} = k_{1}\\binom'); j=s.find('得',i)
if i>=0:
    col=lambda k:r'k_{%d}\begin{pmatrix}0\\-1\\1\end{pmatrix}+\begin{pmatrix}1\\-1\\0\end{pmatrix}=\begin{pmatrix}1\\-k_{%d}-1\\k_{%d}\end{pmatrix}'%(k,k,k)
    s=s[:i]+'由 $X_{1} = '+col(1)+'$ ，$X_{2} = '+col(2)+'$ '+s[j:]
assert 'binom' not in s, s[s.find('binom')-200:s.find('binom')+100]
Q[20]['solution']=s
for n in range(15,24):
    Q[n]['solution']=fix_labels(Q[n]['solution']); Q[n]['stem']=split_stem_parts(Q[n]['stem'])
A99=r'\begin{pmatrix}2^{99}-2&1-2^{99}&2-2^{98}\\2^{100}-2&1-2^{100}&2-2^{99}\\0&0&0\end{pmatrix}'
set_subs(Q,{15:[('计算二重积分',r'$5\pi+\frac{32}{3}$')],
16:[('证明反常积分收敛','证明题'),(r'求 $\int_0^{+\infty}y(x)\,\mathrm dx$',r'$\frac{3}{k}$')],
17:[(r'计算 $I(t)$ 并求最小值',r'$I(t)=\mathrm e^{2-t}+t$，最小值 $I(2)=3$')],
18:[('计算曲面积分',r'$\frac12$')],
19:[('证明级数绝对收敛','证明题'),(r'证明 $\lim x_n$ 存在且在 $(0,2)$ 内','证明题')],
20:[(r'讨论 $a$ 并求解 $AX=B$',r'$a=-2$ 时无解；$a\ne1,-2$ 时唯一解 $X=\begin{pmatrix}1&\frac{3a}{a+2}\\0&\frac{a-4}{a+2}\\-1&0\end{pmatrix}$；$a=1$ 时无穷多解 $X=\begin{pmatrix}1&1\\-k_1-1&-k_2-1\\k_1&k_2\end{pmatrix}$，$k_1,k_2$ 任意')],
21:[(r'求 $A^{99}$','$A^{99}='+A99+'$'),(r'将 $\beta_i$ 表示为 $\alpha_1,\alpha_2,\alpha_3$ 的线性组合',r'$\beta_1=(2^{99}-2)\alpha_1+(2^{100}-2)\alpha_2$，$\beta_2=(1-2^{99})\alpha_1+(1-2^{100})\alpha_2$，$\beta_3=(2-2^{98})\alpha_1+(2-2^{99})\alpha_2$')],
22:[(r'写出 $(X,Y)$ 的概率密度',r'$f(x,y)=\begin{cases}3,&(x,y)\in D\\0,&\text{其他}\end{cases}$'),(r'$U$ 与 $X$ 是否独立','不相互独立'),(r'求 $Z=U+X$ 的分布函数',r'$F(z)=\begin{cases}0,&z<0\\\frac32z^2-z^3,&0\leqslant z<1\\\frac12+2(z-1)^{\frac32}-\frac32(z-1)^2,&1\leqslant z<2\\1,&z\geqslant2\end{cases}$')],
23:[(r'求 $T$ 的概率密度',r'$f_T(t)=\begin{cases}\frac{9t^8}{\theta^9},&0<t<\theta\\0,&\text{其他}\end{cases}$'),(r'确定 $a$',r'$a=\frac{10}{9}$')]})
json.dump(qs,open(F,'w'),ensure_ascii=False,indent=2); print('ok')
