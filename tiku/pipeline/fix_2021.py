import json
p='/workspace/tiku/math1_2021.json'; qs=json.load(open(p)); Q={q['number']:q for q in qs}
Q[2]['stem']=Q[2]['stem'].replace(r'\mathrm{df}(1,1)',r'\mathrm{d}f(1,1)')
Q[2]['options']=[{'key':'A','content':r'$\mathrm{d}x + \mathrm{d}y$'},{'key':'B','content':r'$\mathrm{d}x - \mathrm{d}y$'},
                 {'key':'C','content':r'$\mathrm{d}y$'},{'key':'D','content':r'$-\mathrm{d}y$'}]
for o,c in zip(Q[5]['options'],['$2,0$','$1,1$','$2,1$','$1,2$']): o['content']=c
Q[6]['stem']=Q[6]['stem'].replace('两两相交','两两正交')
Q[6]['review']['notes'].append('OCR 题干为「两两相交」，按原卷与解析（施密特正交化）改为「两两正交」')
Q[9]['stem']=Q[9]['stem'].replace('简单随机样本，\n\n令','简单随机样本，令')
Q[16]['stem']=Q[16]['stem'].replace('$Y$\n\n的相关系数为','$Y$ 的相关系数为')
def sub(n,items):
    Q[n]['answer']=['见各小问']
    Q[n]['sub_questions']=[{'number':i+1,'stem':s,'score':(Q[n]['score'] if len(items)==1 else None),'answer':[a]} for i,(s,a) in enumerate(items)]
sub(17,[('求极限',r'$\dfrac{1}{2}$')])
sub(18,[('求收敛域及和函数',r'收敛域 $(0,1]$；$S(x)=\begin{cases}\dfrac{1}{\mathrm{e}^x-1}+(1-x)\ln(1-x)+x,&0<x<1,\\ \dfrac{\mathrm{e}}{\mathrm{e}-1},&x=1\end{cases}$')])
sub(19,[('求 $C$ 上的点到 $xOy$ 坐标面距离的最大值',r'最大值 $66$（在点 $(-8,-2,66)$ 处取得）')])
sub(20,[('求 $I(D_1)$ 的值',r'$I(D_1)=8\pi$（$D_1=\{x^2+y^2\le4\}$）'),('计算曲线积分',r'$-\pi$')])
sub(21,[('求正交矩阵 $P$，使 $P^TAP$ 为对角矩阵',r'$P=\begin{pmatrix}-\frac{1}{\sqrt2}&\frac{1}{\sqrt6}&-\frac{1}{\sqrt3}\\\frac{1}{\sqrt2}&\frac{1}{\sqrt6}&-\frac{1}{\sqrt3}\\0&\frac{2}{\sqrt6}&\frac{1}{\sqrt3}\end{pmatrix}$，$P^TAP=\mathrm{diag}(a-1,a-1,a+2)$'),
        ('求正定矩阵 $C$，使 $C^2=(a+3)E-A$',r'$C=\dfrac13\begin{pmatrix}5&-1&1\\-1&5&1\\1&1&5\end{pmatrix}$')])
sub(22,[('求 $X$ 的概率密度',r'$f_X(x)=\begin{cases}1,&0<x<1\\0,&\text{其他}\end{cases}$'),
        ('求 $Z$ 的概率密度',r'$f_Z(z)=\begin{cases}\dfrac{2}{(z+1)^2},&z>1\\0,&z\le1\end{cases}$'),
        (r'求 $E\left(\frac{X}{Y}\right)$',r'$2\ln2-1$')])
for n in range(17,23): Q[n]['review']['notes'].append('小问划分与最终答案由资料/仓库搜索者按解析整理，请行业专家确认')
Q[6]['review']['status']='suspect'
json.dump(qs,open(p,'w'),ensure_ascii=False,indent=2)
