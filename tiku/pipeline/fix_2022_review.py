import json
F='math1_2022.json'; qs=json.load(open(F)); Q={q['number']:q for q in qs}
def R(n,a,b,cnt=1,field='solution'):
    s=Q[n][field]; c=s.count(a)
    if c==0: return  # 已改过（或被后续修订覆盖）
    assert c==cnt,(n,a,c); Q[n][field]=s.replace(a,b)
# Q5 Λ
R(5,'\\pmb{P} = (\\pmb{\\xi}_{1}, \\pmb{\\xi}_{2}, \\pmb{\\xi}_{3}), \\pmb{A} =$\n\n$\\left(','\\pmb{P} = (\\pmb{\\xi}_{1}, \\pmb{\\xi}_{2}, \\pmb{\\xi}_{3}), \\boldsymbol{\\Lambda} = \\left(')
R(5,'A = P A P ^ {- 1}','A = P \\Lambda P ^ {- 1}')
R(5,'\\boldsymbol {A} = \\boldsymbol {P A P} ^ {- 1}','\\boldsymbol {A} = \\boldsymbol {P} \\boldsymbol {\\Lambda} \\boldsymbol {P} ^ {- 1}')
R(5,'与对角矩阵 $A$ 相似','与对角矩阵 $\\Lambda$ 相似',2)
R(5,'A = \\begin{pmatrix} 0 & 0 \\\\ 0 & 1 \\end{pmatrix}$ , 则','\\Lambda = \\begin{pmatrix} 0 & 0 \\\\ 0 & 1 \\end{pmatrix}$ , 则')
R(5,'**解** $(E - A)x = 0$','解 $(E - A)x = 0$')
# Q6
R(6,'$BAx = 0$ 与 $BAx = 0$ 不同解','$ABx = 0$ 与 $BAx = 0$ 不同解')
# Q10
R(10,'e ^ {\\frac {- 1}{2 (1 - \\rho^ {2})} \\left[ \\frac {(x - \\mu_ {1}) ^ {2}}{\\sigma_ {1} ^ {2}} - 2 \\rho \\frac {(x - \\mu_ {1}) (y - \\mu_ {1})}{\\sigma_ {1} \\sigma_ {2}} + \\frac {(y - \\mu_ {1}) ^ {2}}{\\sigma_ {1} ^ {2}} \\right]}',
      'e ^ {\\frac {- 1}{2 (1 - \\rho^ {2})} \\left[ \\frac {(x - \\mu_ {1}) ^ {2}}{\\sigma_ {1} ^ {2}} - 2 \\rho \\frac {(x - \\mu_ {1}) (y - \\mu_ {2})}{\\sigma_ {1} \\sigma_ {2}} + \\frac {(y - \\mu_ {2}) ^ {2}}{\\sigma_ {2} ^ {2}} \\right]}')
R(10,'\\mathrm {e} ^ {- \\frac {1}{2 \\cdot \\frac {1}{2}}} \\left[ \\frac {(x - 0) ^ {2}}{1 ^ {2}} - 2 \\cdot \\frac {\\sqrt {2}}{2} \\frac {(x - 0) (y - 0)}{1 \\cdot \\sqrt {2}} + \\frac {(y - 0) ^ {2}}{(\\sqrt {2}) ^ {2}} \\right].',
      '\\mathrm {e} ^ {- \\frac {1}{2 \\cdot \\frac {1}{2}} \\left[ \\frac {(x - 0) ^ {2}}{1 ^ {2}} - 2 \\cdot \\frac {\\sqrt {2}}{2} \\frac {(x - 0) (y - 0)}{1 \\cdot \\sqrt {2}} + \\frac {(y - 0) ^ {2}}{(\\sqrt {2}) ^ {2}} \\right]}.')
R(10,'e ^ {- \\frac {1}{2} \\left[ 1 - \\left(\\frac {\\sqrt {2}}{2}\\right) ^ {2} \\right]} \\left[ \\frac {(x - 0) ^ {2}}{1 ^ {2}} - 2 \\cdot \\frac {\\sqrt {2}}{2} \\frac {(x - 0) (\\gamma - 0)}{1 \\cdot \\sqrt {2}} + \\frac {(\\gamma - 0) ^ {2}}{(\\sqrt {2}) ^ {2}} \\right].',
      'e ^ {- \\frac {1}{2 \\left[ 1 - \\left(\\frac {\\sqrt {2}}{2}\\right) ^ {2} \\right]} \\left[ \\frac {(x - 0) ^ {2}}{1 ^ {2}} - 2 \\cdot \\frac {\\sqrt {2}}{2} \\frac {(x - 0) (y - 0)}{1 \\cdot \\sqrt {2}} + \\frac {(y - 0) ^ {2}}{(\\sqrt {2}) ^ {2}} \\right]}.')
# Q14
R(14,'\\frac{n!}{n^n} i^n$ 的收敛半径为e','\\frac{n!}{n^n} t^n$ 的收敛半径为e')
R(14,'**解** $-\\mathrm{e} < \\mathrm{e}^{-x}','解 $-\\mathrm{e} < \\mathrm{e}^{-x}')
# Q13
R(13,'**解** $\\left\\{ \\begin{array}{l} 2x - x^2 - y^2','解 $\\left\\{ \\begin{array}{l} 2x - x^2 - y^2')
# Q16
R(16,'\n# 三个事件的和事件概率公式','\n**三个事件的和事件概率公式**')
# Q7
o=Q[7]['options'][1]; o['content']=o['content'].replace('\\mathbb{R}','\\mathbf{R}')
json.dump(qs,open(F,'w'),ensure_ascii=False,indent=2); print('ok')
# 行业专家 2022 大题解析修订
qs=json.load(open(F)); Q={q['number']:q for q in qs}
R(17,'由于函数 $y(x) = 2x + \\mathrm{e}^{1 - \\sqrt{x}}$ 在 $[0, +\\infty)$ 上没有无定义的点，故','由于函数 $y(x) = 2x + \\mathrm{e}^{1 - \\sqrt{x}}$ 的定义域为 $[0,+\\infty)$ ，且 $x \\to 0^{+}$ 时 $y \\to \\mathrm{e}$ 为有限值，故')
R(19,'\\\\ = \\iint_ {z} (2 x z - 4 x z)','\\\\ = \\iint_ {\\Sigma} (2 x z - 4 x z)')
R(20,'(b - a) - f ^ {\\prime} \\left(\\frac {a + b}{2}\\right) \\int_ {a} ^ {b} (x - \\frac {a + b}{2}) d x \\\\ + \\frac {1}{2} f ^ {\\prime \\prime} (\\xi) \\int_ {a} ^ {b} \\left(x - \\frac {a + b}{2}\\right) ^ {2} \\mathrm {d} x.',
      '(b - a) + f ^ {\\prime} \\left(\\frac {a + b}{2}\\right) \\int_ {a} ^ {b} (x - \\frac {a + b}{2}) d x \\\\ + \\frac {1}{2} \\int_ {a} ^ {b} f ^ {\\prime \\prime} (\\xi) \\left(x - \\frac {a + b}{2}\\right) ^ {2} \\mathrm {d} x.')
R(20,'(b - a) + \\frac {1}{2} f ^ {\\prime \\prime} (\\xi) \\int_ {a} ^ {b} \\left(x - \\frac {a + b}{2}\\right) ^ {2} \\mathrm {d} x.\n$$',
      '(b - a) + \\frac {1}{2} \\int_ {a} ^ {b} f ^ {\\prime \\prime} (\\xi) \\left(x - \\frac {a + b}{2}\\right) ^ {2} \\mathrm {d} x.\n$$\n\n（这里 $\\xi$ 随 $x$ 变化，所以 $f\'\'(\\xi)$ 留在积分号内。）')
json.dump(qs,open(F,'w'),ensure_ascii=False,indent=2); print('ok2')
# 用户复查通过后：Q5/6/10/14 review 栏改 confirmed；Q17 定义域措辞
qs=json.load(open(F)); Q={q['number']:q for q in qs}
for n in (5,6,10,14):
    Q[n]['review']={'status':'confirmed','notes':['解析已按复查意见修订，用户复查通过'],'checked_by':['用户']}
R(17,'由于函数 $y(x) = 2x + \\mathrm{e}^{1 - \\sqrt{x}}$ 的定义域为 $[0,+\\infty)$ ，且 $x \\to 0^{+}$ 时 $y \\to \\mathrm{e}$ 为有限值，故',
      '由于方程中含 $\\frac{1}{2\\sqrt{x}}$ ，解的定义域为 $(0,+\\infty)$ ，且 $x \\to 0^{+}$ 时 $y \\to \\mathrm{e}$ ，是有限值，故')
json.dump(qs,open(F,'w'),ensure_ascii=False,indent=2); print('ok3')
