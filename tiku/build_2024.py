import re, json
B=open("x_2024年数学(一)真题及参考答案.md").read()
A=open("m1_2024.md").read()
def norm(s):
    s=re.sub(r'\\(mathrm|mathbf|pmb|mathsf|operatorname\*?)\s*','',s)
    s=re.sub(r'[\s{}$（）().。，,;；\\]','',s)
    return s
# version A answers in order
ansA=[m.strip() for m in re.findall(r'【答案】(.*)',A)]
# split B into questions
parts=re.split(r'\n(?=【(\d+)】)',B)
qs={}
i=1
while i<len(parts):
    n=int(parts[i]); body=parts[i+1]; i+=2
    body=re.split(r'\n# ',body)[0]
    qs[n]=body
out=[]
for n in range(1,23):
    body=qs.get(n,'')
    m=re.search(r'【答案】(.*?)(?:\n|$)',body,re.S)
    ansB=m.group(1).strip() if m else ''
    stem_all=body.split('【答案】')[0]
    stem_all=re.sub(r'^【\d+】','',stem_all).strip()
    notes=[]
    if n<=10: sec,typ,score="选择题","single_choice",5
    elif n<=16: sec,typ,score="填空题","fill_blank",5
    else:
        sec,typ="解答题","essay"; sm=re.search(r'本题满分\s*(\d+)',stem_all); score=int(sm.group(1)) if sm else (10 if n==17 else 12)
    options=[]; stem=stem_all
    if typ=="single_choice":
        segs=re.split(r'（([A-D])）',stem_all)
        stem=segs[0].strip()
        for k in range(1,len(segs),2): options.append({"key":segs[k],"content":segs[k+1].strip()})
        keys=[o['key'] for o in options]
        if keys!=list("ABCD"): notes.append(f"选项标记不全，只识别到 {''.join(keys) or '无'}")
        a=re.findall(r'[A-D]',ansB); answer=a[:1]
    else:
        answer=[ansB] if ansB else []
    aA=ansA[n-1] if n-1<len(ansA) else ''
    if not ansB: notes.append("主版本缺答案")
    if not aA: notes.append("对照版本缺答案")
    elif ansB and norm(aA)!=norm(ansB):
        notes.append(f"两个版本答案写法不一致：主版本「{ansB[:60]}」，对照版本「{aA[:60]}」")
    junk=re.findall(r'(?<![\\a-zA-Z])[a-zA-Z](?:\s[a-zA-Z0-9−→]){3,}',stem_all)
    if junk or '−' in stem_all or '→' in stem_all: notes.append("题干里有疑似公式识别残片，需对照原卷")
    if '![' in stem_all: notes.append("含图片，需确认图片已随题保存")
    out.append({"schema_version":"0.2","id":f"math1-2024-{n:02d}","exam":"math1","year":2024,"number":n,
      "section":sec,"type":typ,"score":score,"stem":stem,"images":re.findall(r'!\[\]\((.*?)\)',stem_all),
      "options":options,"answer":answer,"sub_questions":[],"solution":None,"knowledge_points":[],
      "source":{"repo":"TsekaLuk/Kaoyan-Math1-Papers","files":["papers/2024年数学(一)真题及参考答案.md","papers/2024考研数学一真题+答案.md"]},
      "review":{"status":"suspect" if notes else "pending","notes":notes,"checked_by":[]}})
json.dump(out,open("math1_2024.json","w"),ensure_ascii=False,indent=2)
s=sum(1 for q in out if q['review']['status']=='suspect')
print("total",len(out),"suspect",s)
for q in out: print(q['number'],q['review']['status'],q['answer'][:1],'|','；'.join(q['review']['notes'])[:160])
