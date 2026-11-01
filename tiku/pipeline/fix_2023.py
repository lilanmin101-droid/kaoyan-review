import json
p='/tmp/m23.json'; qs=json.load(open(p)); Q={q['number']:q for q in qs}
def opts(*c): return [{"key":k,"content":v} for k,v in zip("ABCD",c)]
def M(r): return r"$\begin{pmatrix}"+r"\\ ".join(" & ".join(x) for x in r)+r"\end{pmatrix}$"
Q[6]['options']=opts(M([["1","1","a"],["0","2","2"],["0","0","3"]]),M([["1","1","a"],["1","2","0"],["a","0","3"]]),M([["1","1","a"],["0","2","0"],["0","0","2"]]),M([["1","1","a"],["0","2","2"],["0","0","2"]]))
Q[6]['review']={"status":"pending","notes":["OCR 把四个矩阵顺序打乱了，按解析里对 A–D 的描述重排（A 三个不同特征值，B 实对称，C、D 特征值 1,2,2）"],"checked_by":[]}
Q[7]['options']=opts(r"$k\begin{pmatrix}3\\ 3\\ 4\end{pmatrix},\ k\in\mathbb{R}$",r"$k\begin{pmatrix}3\\ 5\\ 10\end{pmatrix},\ k\in\mathbb{R}$",r"$k\begin{pmatrix}-1\\ 1\\ 2\end{pmatrix},\ k\in\mathbb{R}$",r"$k\begin{pmatrix}1\\ 5\\ 8\end{pmatrix},\ k\in\mathbb{R}$")
Q[7]['review']={"status":"suspect","notes":["OCR 把选项标号认成了 (3)(-1)(1)，C 选项还丢了一行；C 按残留补成 $k(-1,1,2)^T$，原卷是扫描件没有文字层，请用户对照确认 C","资料验算答案 D：$3\\alpha_1-\\alpha_2=\\beta_1-\\beta_2=(1,5,8)^T$"],"checked_by":[]}
Q[9]['options']=opts(r"$\dfrac{S_1^2}{S_2^2}\sim F(n,m)$",r"$\dfrac{S_1^2}{S_2^2}\sim F(n-1,m-1)$",r"$\dfrac{2S_1^2}{S_2^2}\sim F(n,m)$",r"$\dfrac{2S_1^2}{S_2^2}\sim F(n-1,m-1)$")
Q[9]['review']={"status":"pending","notes":["C、D 选项标号 OCR 丢失，按顺序补回"],"checked_by":[]}
for q in qs:
    q['stem']=re.sub(r'则\s*[（(]\s*$','则',q['stem'].rstrip())
    if q['stem'].endswith('（') or q['stem'].endswith('('): q['stem']=q['stem'][:-1].rstrip()
json.dump(qs,open(p,'w'),ensure_ascii=False,indent=2)
