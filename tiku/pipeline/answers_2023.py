import json,re
p='/workspace/tiku/math1_2023.json'; qs=json.load(open(p)); Q={q['number']:q for q in qs}
def sq(n,stem,ans): return {"number":n,"stem":stem,"score":None,"answer":[ans]}
Q[17]['sub_questions']=[sq(1,r"求 $y(x)$",r"$y(x)=x(2-\ln x)$"),sq(2,r"求 $f(x)=\int_1^x y(t)\,\mathrm{d}t$ 在 $(0,+\infty)$ 上的最大值",r"最大值 $f(e^2)=\dfrac{1}{4}e^4-\dfrac{5}{4}$")]
Q[18]['sub_questions']=[sq(1,"求极值",r"$(0,0)$、$(1,1)$ 不是极值点；极小值 $f\left(\frac23,\frac{10}{27}\right)=-\dfrac{4}{729}$，无极大值")]
Q[19]['sub_questions']=[sq(1,"计算曲面积分 $I$",r"$I=\dfrac{5\pi}{4}$")]
Q[20]['sub_questions']=[sq(1,r"若 $f(0)=0$，证明存在 $\xi\in(-a,a)$，使得 $f''(\xi)=\frac{1}{a^2}[f(a)+f(-a)]$","证明题，证明见解析"),sq(2,r"若 $f(x)$ 在 $(-a,a)$ 内取得极值，证明存在 $\eta\in(-a,a)$，使得 $|f''(\eta)|\ge\frac{1}{2a^2}|f(a)-f(-a)|$","证明题，证明见解析")]
Q[21]['sub_questions']=[sq(1,r"求可逆变换 $x=Py$ 将 $f$ 化为 $g$",r"$P=\begin{pmatrix}1&-1&1\\0&1&0\\0&0&1\end{pmatrix}$（答案不唯一）"),sq(2,r"是否存在正交变换 $x=Qy$ 将 $f$ 化为 $g$",r"不存在，因为 $\operatorname{tr}A=5\ne\operatorname{tr}B=3$，$A$ 与 $B$ 不相似")]
Q[22]['sub_questions']=[sq(1,"求 $X$ 与 $Y$ 的方差",r"$D(X)=D(Y)=\dfrac13$"),sq(2,"$X$ 与 $Y$ 是否相互独立",r"不相互独立"),sq(3,r"求 $Z=X^2+Y^2$ 的概率密度",r"$f_Z(z)=\begin{cases}2z,&0<z<1,\\0,&\text{其他}\end{cases}$")]
for n in range(17,23): Q[n]['answer']=["见各小问"]
# 题干修正（对照解析推导）
Q[19]['stem']=Q[19]['stem'].replace(r"x z d z d y",r"x z d z d x").replace("xz \\cos y dzdy","xz\\cos y\\,dz\\,dx")
Q[19]['stem']=re.sub(r"x z \\cos y d z d y",r"x z \\cos y d z d x",Q[19]['stem'])
Q[19]['review']['notes'].append("题干第二项 OCR 为 dzdy，按解析中高斯公式对 y 求偏导（$-xz\\sin y$）改为 $dz\\,dx$，请行业专家确认")
Q[20]['stem']=Q[20]['stem'].replace(r"(1) 若 $f(x) = 0$",r"(I) 若 $f(0) = 0$")
Q[20]['review']['notes'].append("小问 (I) 条件 OCR 为 $f(x)=0$，按解析（$f(x)=f'(0)x+\\dots$）改为 $f(0)=0$，请行业专家确认")
for n in (19,20): Q[n]['review']['status']='suspect'
for n in (17,22): Q[n]['stem']=Q[n]['stem'].replace("(1) ","(I) ",1)
json.dump(qs,open(p,'w'),ensure_ascii=False,indent=2)
print(Q[19]['stem'])
