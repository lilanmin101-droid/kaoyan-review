"""2025 数一：OCR 源 src/math1/paper_2025.md 乱码太重，按题手工重建为 v0.2 JSON。
用法（在 tiku/ 下）: python3 pipeline/build_2025.py   → 写 math1_2025.json，并把 2 张解析配图放进 images/math1-2025/
题干/选项对照 TsekaLuk/Kaoyan-Math1-Papers papers/2025年数学一真题.md（与本地 md 同一文件）及公开题面
（mathtong.com 2025 数一逐题页、夜雨聆风站 2025 数一真题文本）重建；答案全部用 SymPy/数值独立验算过。
本脚本可重复运行，结果只取决于本文件内容。"""
import json, os, shutil, urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'math1_2025.json')
IMG_DIR = os.path.join(ROOT, 'images', 'math1-2025')
REPO_IMG = 'papers/images/2025年数学一真题/'
IMGS = {  # 仓库原文件名 → 用途
    'd1aac1acec58059a3d6cf16b6341ff359ed2871f9b14a50a3c79e1389f2d802b.jpg': '第 4 题积分区域 D=D1∪D2 示意图',
    'ec1f33b0c14c291197576c603a4fcdc0f2e5a3a4f9932bebe1801c67273482c9.jpg': '第 14 题有向曲线 L 与补线 L0 示意图',
}

def ensure_images():
    os.makedirs(IMG_DIR, exist_ok=True)
    for name in IMGS:
        out = os.path.join(IMG_DIR, name)
        if os.path.exists(out):
            continue
        if os.path.exists('/tmp/r25/' + name):
            shutil.copy('/tmp/r25/' + name, out)
        else:
            url = ('https://raw.githubusercontent.com/TsekaLuk/Kaoyan-Math1-Papers/HEAD/'
                   + urllib.parse.quote(REPO_IMG + name))
            urllib.request.urlretrieve(url, out)

IMG4 = 'images/math1-2025/d1aac1acec58059a3d6cf16b6341ff359ed2871f9b14a50a3c79e1389f2d802b.jpg'
IMG14 = 'images/math1-2025/ec1f33b0c14c291197576c603a4fcdc0f2e5a3a4f9932bebe1801c67273482c9.jpg'

SOURCE = {"repo": "TsekaLuk/Kaoyan-Math1-Papers",
          "files": ["papers/2025年数学一真题.md",
                    "papers/images/2025年数学一真题/（第 4、14 题解析配图）"]}

def opts(*cs):
    return [{"key": k, "content": c} for k, c in zip("ABCD", cs)]

Q = []
def add(number, stem, answer, solution, kps, options=None, subs=None, score=None, conf="high"):
    sec, typ = (("选择题", "single_choice") if number <= 10 else
                ("填空题", "fill_blank") if number <= 16 else ("解答题", "essay"))
    Q.append({
        "schema_version": "0.2", "id": f"math1-2025-{number:02d}", "exam": "math1", "year": 2025,
        "number": number, "section": sec, "type": typ, "score": score or 5,
        "stem": stem, "images": [], "options": options or [], "answer": answer,
        "sub_questions": subs or [], "solution": solution, "knowledge_points": kps,
        "source": SOURCE, "kp_confidence": conf})

def sub(n, stem, score, ans):
    return {"number": n, "stem": stem, "score": score, "answer": ans}

# ---------------- 选择题 ----------------
add(1, r"已知函数 $f(x)=\int_0^x \mathrm{e}^{t^2}\sin t\,\mathrm{d}t$，$g(x)=\int_0^x \mathrm{e}^{t^2}\,\mathrm{d}t\cdot\sin^2 x$，则",
    ["B"],
    r"""$f'(x)=\mathrm{e}^{x^2}\sin x$，$f'(0)=0$；$f''(x)=\mathrm{e}^{x^2}(2x\sin x+\cos x)$，$f''(0)=1>0$，故 $x=0$ 是 $f(x)$ 的极小值点。又 $f''(0)\neq0$，$(0,0)$ 不是曲线 $y=f(x)$ 的拐点，排除 C、D。

对 $g(x)$：$x\to0$ 时 $\int_0^x\mathrm{e}^{t^2}\mathrm{d}t=x+o(x)$，$\sin^2x=x^2+o(x^2)$，故 $g(x)=x^3+o(x^3)$，即 $g'(0)=g''(0)=0$，$g'''(0)=6\neq0$。所以 $g(x)$ 在 $x=0$ 两侧异号，$x=0$ 不是极值点；$g''(x)$ 在 $x=0$ 两侧变号，$(0,0)$ 是曲线 $y=g(x)$ 的拐点，排除 A。

故选 B。""",
    ["高等数学/一元函数微分学/单调性与极值", "高等数学/一元函数微分学/凹凸性与拐点", "高等数学/一元函数积分学/变限积分"],
    options=opts(r"$x=0$ 是 $f(x)$ 的极值点，也是 $g(x)$ 的极值点．",
                 r"$x=0$ 是 $f(x)$ 的极值点，$(0,0)$ 是曲线 $y=g(x)$ 的拐点．",
                 r"$x=0$ 是 $f(x)$ 的极值点，$(0,0)$ 是曲线 $y=f(x)$ 的拐点．",
                 r"$(0,0)$ 是曲线 $y=f(x)$ 的拐点，$(0,0)$ 也是曲线 $y=g(x)$ 的拐点．"))

add(2, r"已知级数：① $\sum\limits_{n=1}^{\infty}\sin\dfrac{n^3\pi}{n^2+1}$；② $\sum\limits_{n=1}^{\infty}(-1)^n\left(\dfrac{1}{\sqrt[3]{n^2}}-\tan\dfrac{1}{\sqrt[3]{n^2}}\right)$，则",
    ["B"],
    r"""①：$\dfrac{n^3}{n^2+1}=n-\dfrac{n}{n^2+1}$，故
$$\sin\frac{n^3\pi}{n^2+1}=\sin\left(n\pi-\frac{n\pi}{n^2+1}\right)=(-1)^{n-1}\sin\frac{n\pi}{n^2+1}.$$
$\sin\dfrac{n\pi}{n^2+1}\sim\dfrac{\pi}{n}$，$\sum\dfrac1n$ 发散，所以①不绝对收敛；又 $\dfrac{n}{n^2+1}$ 单调递减趋于 $0$（$n\ge1$ 时 $\dfrac{n\pi}{n^2+1}\in(0,\dfrac{\pi}{2}]$），$\sin\dfrac{n\pi}{n^2+1}$ 单调递减趋于 $0$，由莱布尼茨判别法①收敛。故①条件收敛。

②：令 $x=\dfrac{1}{\sqrt[3]{n^2}}\to0$，$x-\tan x=-\dfrac{x^3}{3}+o(x^3)$，所以
$$\left|\frac{1}{\sqrt[3]{n^2}}-\tan\frac{1}{\sqrt[3]{n^2}}\right|\sim\frac{1}{3n^2},$$
$\sum\dfrac{1}{n^2}$ 收敛，故②绝对收敛。

故选 B。""",
    ["高等数学/无穷级数/常数项级数的敛散性"],
    options=opts("①与②均条件收敛．", "①条件收敛，②绝对收敛．", "①绝对收敛，②条件收敛．", "①与②均绝对收敛．"))

add(3, r"设函数 $f(x)$ 在区间 $[0,+\infty)$ 上可导，则",
    ["D"],
    r"""A 错：取 $f(x)=\dfrac{\sin x^2}{x}\ (x>0)$，补充定义 $f(0)=0$（此时 $f'(0)=1$，$f$ 在 $[0,+\infty)$ 上可导），$\lim\limits_{x\to+\infty}f(x)=0$，但 $f'(x)=2\cos x^2-\dfrac{\sin x^2}{x^2}$，$\lim\limits_{x\to+\infty}f'(x)$ 不存在。

B 错：取 $f(x)=\sqrt{x+1}$（在 $[0,+\infty)$ 上可导），$\lim\limits_{x\to+\infty}f'(x)=\lim\limits_{x\to+\infty}\dfrac{1}{2\sqrt{x+1}}=0$，但 $\lim\limits_{x\to+\infty}f(x)=+\infty$。

C 错：取 $f(x)=\cos x$，$\lim\limits_{x\to+\infty}\dfrac{\int_0^x\cos t\,\mathrm{d}t}{x}=\lim\limits_{x\to+\infty}\dfrac{\sin x}{x}=0$，但 $\lim\limits_{x\to+\infty}\cos x$ 不存在。

D 对：设 $\lim\limits_{x\to+\infty}f(x)=A$。$f$ 可导故连续，$\int_0^xf(t)\,\mathrm{d}t$ 可导；分母 $x\to+\infty$，由 $\dfrac{\cdot}{\infty}$ 型洛必达法则
$$\lim_{x\to+\infty}\frac{\int_0^xf(t)\,\mathrm{d}t}{x}=\lim_{x\to+\infty}\frac{f(x)}{1}=A.$$
故选 D。""",
    ["高等数学/函数、极限、连续/函数极限", "高等数学/函数、极限、连续/未定式极限（洛必达、泰勒）"],
    options=opts(r"当 $\lim\limits_{x\to+\infty}f(x)$ 存在时，$\lim\limits_{x\to+\infty}f'(x)$ 存在．",
                 r"当 $\lim\limits_{x\to+\infty}f'(x)$ 存在时，$\lim\limits_{x\to+\infty}f(x)$ 存在．",
                 r"当 $\lim\limits_{x\to+\infty}\dfrac{\int_0^x f(t)\,\mathrm{d}t}{x}$ 存在时，$\lim\limits_{x\to+\infty}f(x)$ 存在．",
                 r"当 $\lim\limits_{x\to+\infty}f(x)$ 存在时，$\lim\limits_{x\to+\infty}\dfrac{\int_0^x f(t)\,\mathrm{d}t}{x}$ 存在．"))

add(4, r"设函数 $f(x,y)$ 连续，则 $\int_{-2}^{2}\mathrm{d}x\int_{4-x^2}^{4}f(x,y)\,\mathrm{d}y=$",
    ["A"],
    rf"""积分区域 $D=\{{(x,y)\mid 4-x^2\le y\le4,\ -2\le x\le2\}}$，即抛物线 $y=4-x^2$ 与直线 $y=4$、$x=\pm2$ 围成的左右两块 $D_1$（$x\le0$）、$D_2$（$x\ge0$），如图：

![]({IMG4})

对固定的 $y\in[0,4]$，由 $y\ge4-x^2$ 得 $x\le-\sqrt{{4-y}}$ 或 $x\ge\sqrt{{4-y}}$，再结合 $-2\le x\le2$：
$$D_1:\ -2\le x\le-\sqrt{{4-y}},\qquad D_2:\ \sqrt{{4-y}}\le x\le2,\qquad 0\le y\le4.$$
所以
$$\int_{{-2}}^{{2}}\mathrm{{d}}x\int_{{4-x^2}}^{{4}}f(x,y)\,\mathrm{{d}}y=\int_0^4\left[\int_{{-2}}^{{-\sqrt{{4-y}}}}f(x,y)\,\mathrm{{d}}x+\int_{{\sqrt{{4-y}}}}^{{2}}f(x,y)\,\mathrm{{d}}x\right]\mathrm{{d}}y.$$
B 的第一段上限符号错；C 的第二段上下限颠倒（差一个负号）；D 相当于要求 $f$ 关于 $x$ 为偶函数，题设无此条件。故选 A。""",
    ["高等数学/多元函数积分学/二重积分"],
    options=opts(r"$\int_0^4\left[\int_{-2}^{-\sqrt{4-y}}f(x,y)\,\mathrm{d}x+\int_{\sqrt{4-y}}^{2}f(x,y)\,\mathrm{d}x\right]\mathrm{d}y$．",
                 r"$\int_0^4\left[\int_{-2}^{\sqrt{4-y}}f(x,y)\,\mathrm{d}x+\int_{\sqrt{4-y}}^{2}f(x,y)\,\mathrm{d}x\right]\mathrm{d}y$．",
                 r"$\int_0^4\left[\int_{-2}^{-\sqrt{4-y}}f(x,y)\,\mathrm{d}x+\int_{2}^{\sqrt{4-y}}f(x,y)\,\mathrm{d}x\right]\mathrm{d}y$．",
                 r"$2\int_0^4\mathrm{d}y\int_{\sqrt{4-y}}^{2}f(x,y)\,\mathrm{d}x$．"))

add(5, r"二次型 $f(x_1,x_2,x_3)=x_1^2+2x_1x_2+2x_1x_3$ 的正惯性指数为",
    ["B"],
    r"""配方：
$$f=x_1^2+2x_1(x_2+x_3)=(x_1+x_2+x_3)^2-(x_2+x_3)^2.$$
令 $y_1=x_1+x_2+x_3,\ y_2=x_2+x_3,\ y_3=x_3$（可逆线性变换），得 $f=y_1^2-y_2^2$，正惯性指数为 $1$。

也可用特征值验证：矩阵 $A=\begin{pmatrix}1&1&1\\1&0&0\\1&0&0\end{pmatrix}$，$|\lambda E-A|=\lambda(\lambda-2)(\lambda+1)$，特征值 $2,0,-1$，一正一负。故选 B。""",
    ["线性代数/二次型/惯性定理与规范形", "线性代数/二次型/化二次型为标准形"],
    options=opts("$0$．", "$1$．", "$2$．", "$3$．"))

add(6, r"设 $\boldsymbol{\alpha}_1,\boldsymbol{\alpha}_2,\boldsymbol{\alpha}_3,\boldsymbol{\alpha}_4$ 是 $n$ 维列向量，$\boldsymbol{\alpha}_1,\boldsymbol{\alpha}_2$ 线性无关，$\boldsymbol{\alpha}_1,\boldsymbol{\alpha}_2,\boldsymbol{\alpha}_3$ 线性相关，且 $\boldsymbol{\alpha}_1+\boldsymbol{\alpha}_2+\boldsymbol{\alpha}_4=\boldsymbol{0}$．在空间直角坐标系 $O\text{-}xyz$ 中，关于 $x,y,z$ 的方程组 $x\boldsymbol{\alpha}_1+y\boldsymbol{\alpha}_2+z\boldsymbol{\alpha}_3=\boldsymbol{\alpha}_4$ 的几何图形是",
    ["D"],
    r"""记 $A=(\boldsymbol{\alpha}_1,\boldsymbol{\alpha}_2,\boldsymbol{\alpha}_3)$，方程组即 $A(x,y,z)^{\mathrm T}=\boldsymbol{\alpha}_4$。

由 $\boldsymbol{\alpha}_1,\boldsymbol{\alpha}_2$ 线性无关、$\boldsymbol{\alpha}_1,\boldsymbol{\alpha}_2,\boldsymbol{\alpha}_3$ 线性相关得 $r(A)=2$；又 $\boldsymbol{\alpha}_4=-\boldsymbol{\alpha}_1-\boldsymbol{\alpha}_2$，增广矩阵的秩也是 $2$，方程组有解，且 $(x,y,z)=(-1,-1,0)$ 就是一个解。

解集 = 特解 + 齐次方程组 $A\boldsymbol{x}=\boldsymbol{0}$ 的解空间，后者维数为 $3-r(A)=1$，所以解集是一条直线。若直线过原点，则 $\boldsymbol{\alpha}_4=\boldsymbol{0}$，从而 $\boldsymbol{\alpha}_1+\boldsymbol{\alpha}_2=\boldsymbol{0}$，与 $\boldsymbol{\alpha}_1,\boldsymbol{\alpha}_2$ 线性无关矛盾。

故为不过原点的一条直线，选 D。""",
    ["线性代数/线性方程组/非齐次方程组的解", "线性代数/向量/线性相关与线性无关"],
    options=opts("过原点的一个平面．", "过原点的一条直线．", "不过原点的一个平面．", "不过原点的一条直线．"))

add(7, r"设 $n$ 阶矩阵 $A,B,C$ 满足 $r(A)+r(B)+r(C)=r(ABC)+2n$，给出下列四个结论：① $r(ABC)+n=r(AB)+r(C)$；② $r(AB)+n=r(A)+r(B)$；③ $r(A)=r(B)=r(C)=n$；④ $r(AB)=r(BC)=n$．其中正确结论的序号是",
    ["A"],
    r"""由 Sylvester 不等式 $r(PQ)\ge r(P)+r(Q)-n$：
$$r(ABC)\ge r(AB)+r(C)-n\ge r(A)+r(B)+r(C)-2n.$$
题设说首尾相等，所以两个不等号都取等号，即
$$r(ABC)+n=r(AB)+r(C),\qquad r(AB)+n=r(A)+r(B),$$
①②正确。

反例否定③④：取 $n=2$，$A=\begin{pmatrix}1&0\\0&0\end{pmatrix}$，$B=\begin{pmatrix}0&0\\0&1\end{pmatrix}$，$C=E$，则 $ABC=O$，$1+1+2=0+4$ 满足题设，但 $r(A)=1$、$r(AB)=0$。故选 A。""",
    ["线性代数/矩阵/矩阵的秩"],
    options=opts("①②．", "①③．", "②④．", "③④．"))

add(8, r"设二维随机变量 $(X,Y)$ 服从正态分布 $N(0,0;1,1;\rho)$，其中 $\rho\in(-1,1)$．若 $a,b$ 为满足 $a^2+b^2=1$ 的任意实数，则 $D(aX+bY)$ 的最大值为",
    ["C"],
    r"""$D(X)=D(Y)=1$，$\operatorname{Cov}(X,Y)=\rho$，所以
$$D(aX+bY)=a^2+b^2+2ab\rho=1+2ab\rho.$$
由 $|2ab|\le a^2+b^2=1$ 得 $D(aX+bY)\le1+|\rho|$；取 $a=\dfrac{1}{\sqrt2}$，$b=\dfrac{\operatorname{sgn}\rho}{\sqrt2}$（$\rho=0$ 时任取）即可取到等号。

故最大值为 $1+|\rho|$，选 C。""",
    ["概率论与数理统计/随机变量的数字特征/方差", "概率论与数理统计/随机变量的数字特征/协方差与相关系数"],
    options=opts("$1$．", "$2$．", r"$1+|\rho|$．", r"$1+\rho^2$．"))

add(9, r"设 $X_1,X_2,\cdots,X_{20}$ 是来自总体 $B(1,0.1)$ 的简单随机样本．令 $T=\sum\limits_{i=1}^{20}X_i$，利用泊松分布近似表示二项分布的方法可得 $P\{T\leqslant1\}\approx$",
    ["C"],
    r"""$T\sim B(20,0.1)$，$\lambda=np=2$，用泊松分布 $P(2)$ 近似：
$$P\{T\leqslant1\}\approx\frac{2^0}{0!}\mathrm{e}^{-2}+\frac{2^1}{1!}\mathrm{e}^{-2}=\frac{3}{\mathrm{e}^2}.$$
故选 C。""",
    ["概率论与数理统计/随机变量及其分布/离散型随机变量与常见分布"],
    options=opts(r"$\dfrac{1}{\mathrm{e}^2}$．", r"$\dfrac{2}{\mathrm{e}^2}$．", r"$\dfrac{3}{\mathrm{e}^2}$．", r"$\dfrac{4}{\mathrm{e}^2}$．"))

_R = r"\left\{(X_1,X_2,\cdots,X_n)\,\middle|\,\overline{X}>1+%s Z_{\alpha}\right\}"
add(10, r"设 $X_1,X_2,\cdots,X_n$ 为来自正态总体 $N(\mu,2)$ 的简单随机样本．记 $\overline{X}=\dfrac{1}{n}\sum\limits_{i=1}^{n}X_i$，$Z_{\alpha}$ 表示标准正态分布的上侧 $\alpha$ 分位数．假设检验问题 $H_0:\mu\leqslant1$，$H_1:\mu>1$ 的显著性水平为 $\alpha$ 的检验的拒绝域为",
    ["D"],
    r"""总体方差 $\sigma^2=2$ 已知，用 $Z$ 检验，检验统计量
$$Z=\frac{\overline{X}-1}{\sigma/\sqrt n}=\frac{\overline{X}-1}{\sqrt{2/n}}.$$
右侧检验的拒绝域为 $Z>Z_{\alpha}$，即 $\overline{X}>1+\sqrt{\dfrac{2}{n}}\,Z_{\alpha}$。注意 $N(\mu,2)$ 中的 $2$ 是方差，标准差为 $\sqrt2$。故选 D。""",
    ["概率论与数理统计/假设检验/正态总体的假设检验"],
    options=opts("$" + _R % r"\frac{2}{n}" + "$．", "$" + _R % r"\frac{\sqrt2}{n}" + "$．",
                 "$" + _R % r"\frac{2}{\sqrt n}" + "$．", "$" + _R % r"\sqrt{\frac{2}{n}}\," + "$．"),
    conf="high")

# ---------------- 填空题 ----------------
add(11, r"$\lim\limits_{x\to0^{+}}\dfrac{x^x-1}{\ln x\cdot\ln(1-x)}=$______．",
    ["$-1$"],
    r"""$x\to0^+$ 时 $x\ln x\to0$，故 $x^x-1=\mathrm{e}^{x\ln x}-1\sim x\ln x$；又 $\ln(1-x)\sim-x$。于是
$$\lim_{x\to0^+}\frac{x^x-1}{\ln x\cdot\ln(1-x)}=\lim_{x\to0^+}\frac{x\ln x}{\ln x\cdot(-x)}=-1.$$""",
    ["高等数学/函数、极限、连续/未定式极限（洛必达、泰勒）", "高等数学/函数、极限、连续/无穷小与无穷大及其比较"])

add(12, r"已知函数 $f(x)=\begin{cases}0, & 0\leqslant x<\dfrac{1}{2},\\[2mm] x^2, & \dfrac{1}{2}\leqslant x\leqslant1\end{cases}$ 的傅里叶级数为 $\sum\limits_{n=1}^{\infty}b_n\sin n\pi x$，$S(x)$ 为 $\sum\limits_{n=1}^{\infty}b_n\sin n\pi x$ 的和函数，则 $S\left(-\dfrac{7}{2}\right)=$______．",
    [r"$\dfrac{1}{8}$"],
    r"""正弦级数对应把 $f$ 在 $[0,1]$ 上作奇延拓、再以 $2$ 为周期延拓，$S(x)$ 是周期为 $2$ 的奇函数。于是
$$S\left(-\frac72\right)=S\left(-\frac72+4\right)=S\left(\frac12\right).$$
$x=\dfrac12$ 是 $f$ 的跳跃间断点，$f\left(\dfrac12^-\right)=0$，$f\left(\dfrac12^+\right)=\dfrac14$，由狄利克雷收敛定理
$$S\left(\frac12\right)=\frac{1}{2}\left(0+\frac14\right)=\frac18.$$""",
    ["高等数学/无穷级数/傅里叶级数"])

add(13, r"已知函数 $u(x,y,z)=xy^2z^3$，向量 $\boldsymbol{n}=(2,2,-1)$，则 $\left.\dfrac{\partial u}{\partial\boldsymbol{n}}\right|_{(1,1,1)}=$______．",
    ["$1$"],
    r"""$\dfrac{\partial u}{\partial x}=y^2z^3$，$\dfrac{\partial u}{\partial y}=2xyz^3$，$\dfrac{\partial u}{\partial z}=3xy^2z^2$，在 $(1,1,1)$ 处梯度为 $(1,2,3)$。

$\boldsymbol{n}$ 的单位向量为 $\boldsymbol{n}^{\circ}=\left(\dfrac23,\dfrac23,-\dfrac13\right)$，所以
$$\left.\frac{\partial u}{\partial\boldsymbol{n}}\right|_{(1,1,1)}=1\cdot\frac23+2\cdot\frac23+3\cdot\left(-\frac13\right)=1.$$""",
    ["高等数学/多元函数微分学/方向导数与梯度"])

add(14, r"已知有向曲线 $L$ 是沿抛物线 $y=1-x^2$ 从点 $(1,0)$ 到点 $(-1,0)$ 的一段，则曲线积分 $\int_L(y+\cos x)\,\mathrm{d}x+(2x+\cos y)\,\mathrm{d}y=$______．",
    [r"$\dfrac{4}{3}-2\sin1$"],
    rf"""补有向线段 $L_0$：沿 $x$ 轴从 $(-1,0)$ 到 $(1,0)$。$L$ 与 $L_0$ 合成逆时针闭曲线，围成区域 $D:\ -1\le x\le1,\ 0\le y\le1-x^2$，如图：

![]({IMG14})

记 $P=y+\cos x$，$Q=2x+\cos y$，$\dfrac{{\partial Q}}{{\partial x}}-\dfrac{{\partial P}}{{\partial y}}=2-1=1$。由格林公式
$$\oint_{{L+L_0}}P\,\mathrm{{d}}x+Q\,\mathrm{{d}}y=\iint_D1\,\mathrm{{d}}\sigma=\int_{{-1}}^{{1}}(1-x^2)\,\mathrm{{d}}x=\frac43.$$
在 $L_0$ 上 $y=0$，$\mathrm{{d}}y=0$：$\int_{{L_0}}P\,\mathrm{{d}}x+Q\,\mathrm{{d}}y=\int_{{-1}}^{{1}}\cos x\,\mathrm{{d}}x=2\sin1$。

所以 $\int_L(y+\cos x)\,\mathrm{{d}}x+(2x+\cos y)\,\mathrm{{d}}y=\dfrac43-2\sin1$。""",
    ["高等数学/多元函数积分学/第二类曲线积分与格林公式"])

add(15, r"设矩阵 $A=\begin{pmatrix}4&2&-3\\a&3&-4\\b&5&-7\end{pmatrix}$，若方程组 $A^2\boldsymbol{x}=\boldsymbol{0}$ 与 $A\boldsymbol{x}=\boldsymbol{0}$ 不同解，则 $a-b=$______．",
    ["$-4$"],
    r"""$A\boldsymbol{x}=\boldsymbol{0}$ 的解都是 $A^2\boldsymbol{x}=\boldsymbol{0}$ 的解。若 $A$ 可逆，则 $A^2$ 也可逆，两方程组都只有零解，必同解。所以不同解时 $|A|=0$。又二阶子式 $\begin{vmatrix}2&-3\\3&-4\end{vmatrix}=1\neq0$，故 $r(A)\geqslant 2$，$|A|=0$ 时 $r(A)=2$。

作 $r_3-r_1-r_2$：
$$|A|=\begin{vmatrix}4&2&-3\\a&3&-4\\b-a-4&0&0\end{vmatrix}=(b-a-4)\begin{vmatrix}2&-3\\3&-4\end{vmatrix}=b-a-4.$$
令 $|A|=0$ 得 $a-b=-4$。

补充（说明条件确实可以满足）：$\operatorname{tr}A=0$，$|\lambda E-A|=\lambda^3+(3b-2a-17)\lambda+(a-b+4)$。两方程组不同解还要求 $r(A^2)<r(A)$，即 $0$ 为重特征值，需再有 $3b-2a-17=0$，得 $a=5,\ b=9$，此时 $A^3=O$，$r(A)=2$，$r(A^2)=1$，确实不同解，且 $a-b=-4$。""",
    ["线性代数/线性方程组/方程组的公共解与同解", "线性代数/行列式/行列式的性质与计算"])

add(16, r"设 $A,B$ 为两个随机事件，且 $A$ 与 $B$ 相互独立，已知 $P(A)=2P(B)$，$P(A\cup B)=\dfrac{5}{8}$，则在事件 $A,B$ 至少有一个发生的条件下，$A,B$ 中恰有一个发生的概率为______．",
    [r"$\dfrac{4}{5}$"],
    r"""设 $P(B)=p$，则 $P(A)=2p$，由独立性 $P(AB)=2p^2$。
$$P(A\cup B)=3p-2p^2=\frac58\ \Rightarrow\ 16p^2-24p+5=0\ \Rightarrow\ (4p-1)(4p-5)=0,$$
$p\le1$，故 $p=\dfrac14$，$P(A)=\dfrac12$，$P(AB)=\dfrac18$。

恰有一个发生的概率 $P(A\bar B\cup\bar AB)=P(A)+P(B)-2P(AB)=\dfrac12+\dfrac14-\dfrac14=\dfrac12$。它是 $A\cup B$ 的子事件，所以
$$P(A\bar B\cup\bar AB\mid A\cup B)=\frac{1/2}{5/8}=\frac45.$$""",
    ["概率论与数理统计/随机事件和概率/条件概率与乘法公式", "概率论与数理统计/随机事件和概率/事件的独立性"])

# ---------------- 解答题 ----------------
add(17, r"（本题满分 10 分）" "\n\n" r"计算 $\displaystyle\int_0^1\frac{1}{(x+1)(x^2-2x+2)}\,\mathrm{d}x$．",
    [r"$\dfrac{3}{10}\ln2+\dfrac{\pi}{10}$"],
    r"""部分分式：设 $\dfrac{1}{(x+1)(x^2-2x+2)}=\dfrac{A}{x+1}+\dfrac{Bx+C}{x^2-2x+2}$，比较系数得 $A=\dfrac15,\ B=-\dfrac15,\ C=\dfrac35$，即
$$\frac{1}{(x+1)(x^2-2x+2)}=\frac15\left(\frac{1}{x+1}-\frac{x-3}{x^2-2x+2}\right).$$
又 $x-3=\dfrac12(2x-2)-2$，$x^2-2x+2=(x-1)^2+1$，所以
$$\int_0^1\frac{x-3}{x^2-2x+2}\,\mathrm{d}x=\frac12\ln(x^2-2x+2)\Big|_0^1-2\arctan(x-1)\Big|_0^1=-\frac12\ln2-\frac{\pi}{2}.$$
因此
$$\int_0^1\frac{\mathrm{d}x}{(x+1)(x^2-2x+2)}=\frac15\left[\ln2+\frac12\ln2+\frac{\pi}{2}\right]=\frac{3}{10}\ln2+\frac{\pi}{10}.$$""",
    ["高等数学/一元函数积分学/不定积分", "高等数学/一元函数积分学/定积分的概念与性质"],
    subs=[sub(1, r"计算 $\int_0^1\frac{1}{(x+1)(x^2-2x+2)}\,\mathrm{d}x$", 10, [r"$\dfrac{3}{10}\ln2+\dfrac{\pi}{10}$"])],
    score=10)

add(18, r"（本题满分 12 分）" "\n\n" r"已知函数 $f(u)$ 在区间 $(0,+\infty)$ 内具有 2 阶导数，记 $g(x,y)=f\left(\dfrac{x}{y}\right)$．若 $g(x,y)$ 满足 $x^2\dfrac{\partial^2g}{\partial x^2}+xy\dfrac{\partial^2g}{\partial x\partial y}+y^2\dfrac{\partial^2g}{\partial y^2}=1$，且 $g(x,x)=1$，$\left.\dfrac{\partial g}{\partial x}\right|_{(x,x)}=\dfrac{2}{x}$，求 $f(u)$．",
    [r"$f(u)=\dfrac12\ln^2u+2\ln u+1$"],
    r"""令 $u=\dfrac xy$，则
$$\frac{\partial g}{\partial x}=\frac1yf'(u),\quad \frac{\partial g}{\partial y}=-\frac{x}{y^2}f'(u),$$
$$\frac{\partial^2g}{\partial x^2}=\frac{1}{y^2}f'',\quad \frac{\partial^2g}{\partial x\partial y}=-\frac{x}{y^3}f''-\frac{1}{y^2}f',\quad \frac{\partial^2g}{\partial y^2}=\frac{x^2}{y^4}f''+\frac{2x}{y^3}f'.$$
代入方程：
$$\frac{x^2}{y^2}f''-\frac{x^2}{y^2}f''-\frac xyf'+\frac{x^2}{y^2}f''+\frac{2x}{y}f'=u^2f''(u)+uf'(u)=1.$$
即 $uf''+f'=\dfrac1u$，也就是 $\left(uf'(u)\right)'=\dfrac1u$，积分得 $uf'(u)=\ln u+C_1$。

由 $\left.\dfrac{\partial g}{\partial x}\right|_{(x,x)}=\dfrac1xf'(1)=\dfrac2x$ 得 $f'(1)=2$，故 $C_1=2$，$f'(u)=\dfrac{\ln u}{u}+\dfrac2u$。再积分：$f(u)=\dfrac12\ln^2u+2\ln u+C_2$；由 $g(x,x)=f(1)=1$ 得 $C_2=1$。

所以 $f(u)=\dfrac12\ln^2u+2\ln u+1\ (u>0)$。""",
    ["高等数学/多元函数微分学/复合函数与隐函数求导", "高等数学/常微分方程/可降阶的高阶方程"],
    subs=[sub(1, r"求 $f(u)$", 12, [r"$f(u)=\dfrac12\ln^2u+2\ln u+1$"])],
    score=12)

add(19, r"（本题满分 12 分）" "\n\n" r"设函数 $f(x)$ 在区间 $(a,b)$ 内可导．证明：导函数 $f'(x)$ 在 $(a,b)$ 内严格单调增加的充分必要条件是：对 $(a,b)$ 内任意的 $x_1,x_2,x_3$，当 $x_1<x_2<x_3$ 时，$\dfrac{f(x_2)-f(x_1)}{x_2-x_1}<\dfrac{f(x_3)-f(x_2)}{x_3-x_2}$．",
    ["证明题，证明见解析"],
    r"""记 $k(s,t)=\dfrac{f(t)-f(s)}{t-s}$（$s\neq t$）。

**必要性。** 设 $f'$ 严格单调增加，$x_1<x_2<x_3$。由拉格朗日中值定理，存在 $\xi_1\in(x_1,x_2)$，$\xi_2\in(x_2,x_3)$，使
$$k(x_1,x_2)=f'(\xi_1),\qquad k(x_2,x_3)=f'(\xi_2).$$
因 $\xi_1<\xi_2$，$f'(\xi_1)<f'(\xi_2)$，即 $k(x_1,x_2)<k(x_2,x_3)$。

**充分性。** 设条件成立。先说明：对 $x_1<x_2<x_3$，
$$k(x_1,x_2)<k(x_1,x_3)<k(x_2,x_3).\tag{*}$$
这是因为 $k(x_1,x_3)=\lambda k(x_1,x_2)+(1-\lambda)k(x_2,x_3)$，其中 $\lambda=\dfrac{x_2-x_1}{x_3-x_1}\in(0,1)$，而 $k(x_1,x_2)<k(x_2,x_3)$。

任取 $a<p<q<b$，令 $m=\dfrac{p+q}{2}$。

- 由 (*) 左半，对 $p<t<m$ 有 $k(p,t)<k(p,m)$；令 $t\to p^+$ 得 $f'(p)\le k(p,m)$。
- 由 (*) 右半，对 $m<s<q$ 有 $k(m,q)<k(s,q)$；令 $s\to q^-$ 得 $k(m,q)\le f'(q)$。
- 由题设，$k(p,m)<k(m,q)$。

于是 $f'(p)\le k(p,m)<k(m,q)\le f'(q)$，即 $f'(p)<f'(q)$。由 $p<q$ 的任意性，$f'(x)$ 在 $(a,b)$ 内严格单调增加。

综上，充要性得证。""",
    ["高等数学/一元函数微分学/微分中值定理", "高等数学/一元函数微分学/导数与微分的概念"],
    subs=[sub(1, r"证明 $f'(x)$ 在 $(a,b)$ 内严格单调增加的充要条件是差商不等式对任意 $x_1<x_2<x_3$ 成立", None, ["证明题，证明见解析"])],
    score=12)

add(20, r"（本题满分 12 分）" "\n\n" r"设 $\Sigma$ 是由直线 $\begin{cases}x=0,\\y=0\end{cases}$ 绕直线 $\begin{cases}x=t,\\y=t,\\z=t\end{cases}$（$t$ 为参数）旋转一周得到的曲面，$\Sigma_1$ 是 $\Sigma$ 介于平面 $x+y+z=0$ 与平面 $x+y+z=1$ 之间部分的外侧，计算曲面积分" "\n\n" r"$$I=\iint_{\Sigma_1}x\,\mathrm{d}y\mathrm{d}z+(y+1)\,\mathrm{d}z\mathrm{d}x+(z+2)\,\mathrm{d}x\mathrm{d}y.$$",
    [r"$-\dfrac{2\sqrt3}{3}\pi$"],
    r"""**曲面方程。** $z$ 轴与旋转轴（方向 $(1,1,1)$）交于原点，夹角满足 $\cos\theta=\dfrac{1}{\sqrt3}$，所以 $\Sigma$ 是以原点为顶点、以直线 $x=y=z$ 为轴、半顶角为 $\theta$ 的圆锥面：点 $(x,y,z)$ 在 $\Sigma$ 上当且仅当
$$\frac{|x+y+z|}{\sqrt3\sqrt{x^2+y^2+z^2}}=\frac{1}{\sqrt3}\iff xy+yz+zx=0.$$

**补面。** $\Sigma_1$ 是锥面上 $0\le x+y+z\le1$ 的部分。补平面片 $\Sigma_2$：平面 $x+y+z=1$ 被锥面截得的圆盘，取上侧（法向 $\boldsymbol n=\frac{1}{\sqrt3}(1,1,1)$）。$\Sigma_1$（外侧）与 $\Sigma_2$ 围成圆锥体 $\Omega$，取外侧。

圆锥高 $h$ = 原点到平面 $x+y+z=1$ 的距离 $=\dfrac{1}{\sqrt3}$；底面上的点满足 $x+y+z=1$ 且 $xy+yz+zx=0$，故 $x^2+y^2+z^2=1$，底面半径 $r=\sqrt{1-\frac13}=\sqrt{\frac23}$。所以
$$V=\frac13\pi r^2h=\frac13\pi\cdot\frac23\cdot\frac{1}{\sqrt3}=\frac{2\sqrt3}{27}\pi.$$

**高斯公式。** 散度 $=1+1+1=3$，
$$\iint_{\Sigma_1+\Sigma_2}=3V=\frac{2\sqrt3}{9}\pi.$$

**补面上的积分。** 在 $\Sigma_2$ 上 $x+y+z=1$，
$$\iint_{\Sigma_2}=\iint_{\Sigma_2}\frac{x+(y+1)+(z+2)}{\sqrt3}\,\mathrm{d}S=\frac{4}{\sqrt3}\cdot\pi r^2=\frac{4}{\sqrt3}\cdot\frac{2\pi}{3}=\frac{8\sqrt3}{9}\pi.$$

所以
$$I=\frac{2\sqrt3}{9}\pi-\frac{8\sqrt3}{9}\pi=-\frac{2\sqrt3}{3}\pi.$$""",
    ["高等数学/多元函数积分学/第二类曲面积分与高斯公式", "高等数学/向量代数与空间解析几何/曲面与空间曲线"],
    subs=[sub(1, r"计算 $I=\iint_{\Sigma_1}x\,\mathrm{d}y\mathrm{d}z+(y+1)\,\mathrm{d}z\mathrm{d}x+(z+2)\,\mathrm{d}x\mathrm{d}y$", 12, [r"$-\dfrac{2\sqrt3}{3}\pi$"])],
    score=12)

ANS21b = r"$\boldsymbol\alpha=(k_1,k_2,k_3)^{\mathrm T}$，$\boldsymbol\beta=(2k_3-k_1-k_2)(1,1,1)^{\mathrm T}$，其中 $k_1,k_2,k_3$ 为任意常数且 $k_1+k_2\neq2k_3$"
add(21, r"（本题满分 12 分）" "\n\n" r"设矩阵 $A=\begin{pmatrix}0&-1&2\\-1&0&2\\-1&-1&a\end{pmatrix}$，已知 $1$ 是 $A$ 的特征多项式的重根．" "\n\n" r"（1）求 $a$ 的值；" "\n\n" r"（2）求所有满足 $A\boldsymbol\alpha=\boldsymbol\alpha+\boldsymbol\beta$，$A^2\boldsymbol\alpha=\boldsymbol\alpha+2\boldsymbol\beta$ 的非零列向量 $\boldsymbol\alpha,\boldsymbol\beta$．",
    ["见各小问"],
    r"""（1）
$$|\lambda E-A|=\begin{vmatrix}\lambda&1&-2\\1&\lambda&-2\\1&1&\lambda-a\end{vmatrix}=(\lambda-1)\left[\lambda^2+(1-a)\lambda+4-a\right].$$
$1$ 是重根，故 $1$ 是二次因式的根：$1+(1-a)+4-a=0$，$a=3$。此时 $|\lambda E-A|=(\lambda-1)^3$。

（2）$a=3$ 时 $A-E=\begin{pmatrix}-1&-1&2\\-1&-1&2\\-1&-1&2\end{pmatrix}=\begin{pmatrix}1\\1\\1\end{pmatrix}(-1,-1,2)$，且 $(-1,-1,2)\begin{pmatrix}1\\1\\1\end{pmatrix}=0$，所以 $(A-E)^2=O$。

由第一式 $\boldsymbol\beta=(A-E)\boldsymbol\alpha$。代入第二式：$A^2\boldsymbol\alpha=A(\boldsymbol\alpha+\boldsymbol\beta)=\boldsymbol\alpha+\boldsymbol\beta+A\boldsymbol\beta$，与 $\boldsymbol\alpha+2\boldsymbol\beta$ 比较得 $A\boldsymbol\beta=\boldsymbol\beta$，即 $(A-E)^2\boldsymbol\alpha=\boldsymbol0$，这对任意 $\boldsymbol\alpha$ 都成立。所以两式等价于 $\boldsymbol\beta=(A-E)\boldsymbol\alpha$，$\boldsymbol\alpha$ 任意。

设 $\boldsymbol\alpha=(k_1,k_2,k_3)^{\mathrm T}$，则 $\boldsymbol\beta=(2k_3-k_1-k_2)(1,1,1)^{\mathrm T}$。要求 $\boldsymbol\beta\neq\boldsymbol0$（此时 $\boldsymbol\alpha$ 自然非零），即 $k_1+k_2\neq2k_3$。

所求为：$\boldsymbol\alpha=(k_1,k_2,k_3)^{\mathrm T}$，$\boldsymbol\beta=(2k_3-k_1-k_2)(1,1,1)^{\mathrm T}$，$k_1,k_2,k_3$ 为任意常数且 $k_1+k_2\neq2k_3$。

（等价写法：$\boldsymbol\beta=k(1,1,1)^{\mathrm T}$，$\boldsymbol\alpha=c_1(2,0,1)^{\mathrm T}+c_2(0,2,1)^{\mathrm T}+(-k,0,0)^{\mathrm T}$，$k\neq0$，$c_1,c_2$ 任意。）""",
    ["线性代数/特征值与特征向量/特征值与特征向量的计算", "线性代数/线性方程组/非齐次方程组的解"],
    subs=[sub(1, r"求 $a$ 的值", None, ["$a=3$"]),
          sub(2, r"求所有满足 $A\boldsymbol\alpha=\boldsymbol\alpha+\boldsymbol\beta$，$A^2\boldsymbol\alpha=\boldsymbol\alpha+2\boldsymbol\beta$ 的非零列向量 $\boldsymbol\alpha,\boldsymbol\beta$", None, [ANS21b])],
    score=12)

add(22, r"（本题满分 12 分）" "\n\n" r"投保人的损失事件发生时，保险公司的赔付额 $Y$ 与投保人的损失额 $X$ 的关系为 $Y=\begin{cases}0, & X\leqslant100,\\ X-100, & X>100.\end{cases}$ 设损失事件发生时，投保人的损失额 $X$ 的概率密度为 $f(x)=\begin{cases}\dfrac{2\times100^2}{(100+x)^3}, & x>0,\\ 0, & x\leqslant0.\end{cases}$" "\n\n" r"（1）求 $P\{Y>0\}$ 及 $EY$；" "\n\n" r"（2）这种损失事件在一年内发生的次数记为 $N$，保险公司在一年内就这种损失事件产生的理赔次数记为 $M$．假设 $N$ 服从参数为 $8$ 的泊松分布，在 $N=n\ (n\geqslant1)$ 的条件下，$M$ 服从二项分布 $B(n,p)$，其中 $p=P\{Y>0\}$，求 $M$ 的概率分布．",
    ["见各小问"],
    r"""（1）
$$P\{Y>0\}=P\{X>100\}=\int_{100}^{+\infty}\frac{2\times100^2}{(100+x)^3}\,\mathrm{d}x=\left.-\frac{100^2}{(100+x)^2}\right|_{100}^{+\infty}=\frac{100^2}{200^2}=\frac14.$$
令 $t=100+x$：
$$EY=\int_{100}^{+\infty}(x-100)\frac{2\times100^2}{(100+x)^3}\,\mathrm{d}x=2\times100^2\int_{200}^{+\infty}\left(\frac{1}{t^2}-\frac{200}{t^3}\right)\mathrm{d}t=2\times100^2\left(\frac{1}{200}-\frac{1}{400}\right)=50.$$

（2）$p=\dfrac14$，$P\{N=n\}=\dfrac{8^n}{n!}\mathrm{e}^{-8}$。$N=0$ 时 $M=0$，与 $B(0,p)$ 的约定一致。对 $m=0,1,2,\cdots$，由全概率公式
$$P\{M=m\}=\sum_{n=m}^{\infty}\frac{8^n\mathrm{e}^{-8}}{n!}\cdot\frac{n!}{m!(n-m)!}\left(\frac14\right)^m\left(\frac34\right)^{n-m}=\frac{2^m\mathrm{e}^{-8}}{m!}\sum_{j=0}^{\infty}\frac{6^j}{j!}=\frac{2^m}{m!}\mathrm{e}^{-2}.$$
即 $M$ 服从参数为 $2$ 的泊松分布：$P\{M=m\}=\dfrac{2^m}{m!}\mathrm{e}^{-2}$，$m=0,1,2,\cdots$。""",
    ["概率论与数理统计/随机变量及其分布/随机变量函数的分布", "概率论与数理统计/随机变量的数字特征/数学期望", "概率论与数理统计/随机事件和概率/全概率公式与贝叶斯公式"],
    subs=[sub(1, r"求 $P\{Y>0\}$ 及 $EY$", None, [r"$P\{Y>0\}=\dfrac14$，$EY=50$"]),
          sub(2, r"求 $M$ 的概率分布", None, [r"$M\sim P(2)$，$P\{M=m\}=\dfrac{2^m}{m!}\mathrm{e}^{-2}$，$m=0,1,2,\cdots$"])],
    score=12)

if __name__ == '__main__':
    assert len(Q) == 22 and [q['number'] for q in Q] == list(range(1, 23))
    assert sum(q['score'] for q in Q) == 150, sum(q['score'] for q in Q)
    ensure_images()
    json.dump(Q, open(OUT, 'w'), ensure_ascii=False, indent=2)
    print('写出', OUT, len(Q), '题；图片', sorted(os.listdir(IMG_DIR)))
