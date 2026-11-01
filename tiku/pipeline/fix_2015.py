import json,re,sys; sys.path.insert(0,'pipeline'); from common import *
F='math1_2015.json'; qs=json.load(open(F)); Q={q['number']:q for q in qs}
# Q1 的 f''(x) 图被 OCR 放到了第 2 题题干后面，挪回第 1 题
img=re.search(r'!\[[^\]]*\]\(([^)]+)\)',Q[2]['stem'])
if img:
    Q[2]['stem']=re.sub(r'\s*!\[[^\]]*\]\([^)]+\)\s*','',Q[2]['stem']).strip()
    Q[1]['images']=list(dict.fromkeys((Q[1].get('images') or [])+[img.group(1)]))
for q in qs: stem_images(q)
# Q4 选项 C、D 粘连
o=Q[4]['options']
if len(o)==3:
    c,d=o[2]['content'].split('\n\n',1)
    o[2]['content']=re.sub(r'\.\$$','$',c.strip()); o.append({'key':'D','content':d.strip()})
# Q17 驻点方程组的解识别坏了
s=Q[17]['solution']; i=s.find('解得\n\n$$\n\\left\\{ \\begin{array}{l} x = 1,'); j=s.find('$$',i+8)+2
if i>=0:
    s=s[:i]+r'解得四个点 $(1,1)$，$(-1,-1)$，$(2,-1)$，$(-1,2)$'+s[j:]
Q[17]['solution']=s
# Q20 坐标向量 binom 截断成两行
Q[20]['solution']=Q[20]['solution'].replace('\\binom {x _ {1}} {x _ {2}} = C \\binom {- 1} {0} (C \\text {为 任 意 常 数}).',
  '\\begin{pmatrix} x_1 \\\\ x_2 \\\\ x_3 \\end{pmatrix} = C \\begin{pmatrix} -1 \\\\ 0 \\\\ 1 \\end{pmatrix}，\\text{即 } \\xi = -C\\alpha_1 + C\\alpha_3 \\ (C \\text{为任意非零常数}).')
for n in range(15,24):
    Q[n]['solution']=fix_labels(Q[n]['solution']); Q[n]['stem']=split_stem_parts(Q[n]['stem'])
set_subs(Q,{15:[(r'求 $a,b,k$',r'$a=-1$，$b=-\frac12$，$k=-\frac13$')],
16:[(r'求 $f(x)$',r'$f(x)=\frac{8}{4-x}$')],
17:[('求最大方向导数','$3$')],
18:[('利用导数定义证明乘积求导公式','证明题'),(r'写出 $f(x)$ 的求导公式',r"$f'(x)=u_1'u_2\cdots u_n+u_1u_2'\cdots u_n+\cdots+u_1u_2\cdots u_n'$")],
19:[('计算曲线积分',r'$\frac{\sqrt2}{2}\pi$')],
20:[(r'证明 $\beta_1,\beta_2,\beta_3$ 为一个基','证明题'),(r'求 $k$ 及所有 $\xi$',r'$k=0$，$\xi=C(\alpha_3-\alpha_1)$，$C$ 为任意非零常数')],
21:[(r'求 $a,b$',r'$a=4$，$b=5$'),(r'求可逆矩阵 $P$',r'$P=\begin{pmatrix}2&-3&-1\\1&0&-1\\0&1&1\end{pmatrix}$，$P^{-1}AP=\mathrm{diag}(1,1,5)$（$P$ 不唯一）')],
22:[(r'求 $Y$ 的概率分布',r'$P\{Y=k\}=(k-1)\left(\frac18\right)^2\left(\frac78\right)^{k-2}$，$k=2,3,\cdots$'),(r'求 $E(Y)$','$16$')],
23:[(r'求 $\theta$ 的矩估计量',r'$\hat\theta=2\overline X-1$'),(r'求 $\theta$ 的最大似然估计量',r'$\hat\theta=\min\{X_1,\cdots,X_n\}$')]})
json.dump(qs,open(F,'w'),ensure_ascii=False,indent=2); print('ok')
qs=json.load(open(F)); Q={q['number']:q for q in qs}
Q[2]['stem']=re.sub(r'\s*[（(]\s*[)）]\s*$','',Q[2]['stem'])
for q in qs: q['stem']=q['stem'].strip()
json.dump(qs,open(F,'w'),ensure_ascii=False,indent=2)
