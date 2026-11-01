"""解析「题干+答案+解析写在一起」的文件（2023 sol、2025 paper）为 v0.2 JSON。
用法: python3 parse_inline.py <year> <src.md> <out.json>"""
import re, json, sys
year=int(sys.argv[1]); src=open(sys.argv[2]).read(); out=sys.argv[3]
src=src.replace('\r','')
# 题号行：(n) / （n） / n. / n． 开头，n 递增 1..22
lines=src.split('\n'); starts={}; want=1
for i,l in enumerate(lines):
    m=re.match(r'^\s*(?:#\s*)?(?:[（(]\s*(\d{1,2})\s*[)）]|(\d{1,2})\s*[.．、])\s*',l)
    if m:
        n=int(m.group(1) or m.group(2))
        if n==want: starts[n]=i; want+=1
        if want>22: break
def section_cut(t): return re.split(r'\n#\s*[一二三四]、',t)[0]
qs=[]
for n in range(1,23):
    if n not in starts: print('缺题号',n); continue
    end=starts.get(n+1,len(lines))
    body='\n'.join(lines[starts[n]:end])
    body=re.sub(r'^\s*(?:#\s*)?(?:[（(]\s*\d{1,2}\s*[)）]|\d{1,2}\s*[.．、])\s*','',body,count=1)
    body=section_cut(body).strip()
    notes=[]
    m=re.search(r'【\s*答案\s*】',body); s=re.search(r'【\s*(?:解析|解|分析|详解)\s*】',body)
    cut=min([x.start() for x in (m,s) if x] or [len(body)])
    stem_all=body[:cut].strip()
    ans_txt=''
    if m:
        after=body[m.end():]; e=re.search(r'【\s*(?:解析|解|分析|详解)\s*】',after)
        ans_txt=(after[:e.start()] if e else after.split('\n\n')[0]).strip()
    sol=body[s.start():].strip() if s else None
    if sol: sol=re.sub(r'^【\s*(?:解析|解|分析|详解)\s*】\s*','',sol)
    if n<=10: typ,sec,score='single_choice','选择题',5
    elif n<=16: typ,sec,score='fill_blank','填空题',5
    else:
        typ,sec='essay','解答题'; sm=re.search(r'满分\s*(\d+)',stem_all); score=int(sm.group(1)) if sm else (10 if n==17 else 12)
        stem_all=re.sub(r'^[（(]\s*本题满分\s*\d+\s*分\s*[)）]\s*','',stem_all)
    stem=stem_all; options=[]
    if typ=='single_choice':
        pat=r'(?:^|\n|\s)(?:\$\s*\\mathrm\s*\{\s*([A-D])\s*\}\s*\.\s*(?:\\mathrm\s*\{\s*~\s*\})?\s*|[（(]\s*([A-D])\s*[)）]\s*|([A-D])\s*[.．、]\s*)'
        ms=list(re.finditer(pat,stem_all))
        # 取第一组 A..D 依次出现
        seq=[];want_k='A'
        for x in ms:
            k=x.group(1) or x.group(2) or x.group(3)
            if k==want_k: seq.append(x); want_k=chr(ord(want_k)+1)
            if want_k>'D': break
        if seq:
            stem=stem_all[:seq[0].start()].strip()
            for j,x in enumerate(seq):
                e=seq[j+1].start() if j+1<len(seq) else len(stem_all)
                c=stem_all[x.end():e].strip()
                if x.group(1): c='$'+c   # 补回被吃掉的 $
                options.append({'key':x.group(1) or x.group(2) or x.group(3),'content':c})
        if len(options)!=4: notes.append(f'选项只识别到 {len(options)} 个')
        a=re.findall(r'[A-D]',ans_txt); answer=a[:1]
    else:
        answer=[ans_txt] if ans_txt else []
    stem=re.sub(r'[（(]\s*[)）]\s*$|[（(]\s*\\quad\s*[)）]','',stem).strip()
    if not answer and typ!='essay': notes.append('缺答案')
    qs.append({"schema_version":"0.2","id":f"math1-{year}-{n:02d}","exam":"math1","year":year,"number":n,
      "section":sec,"type":typ,"score":score,"stem":stem,"images":re.findall(r'!\[[^\]]*\]\((.*?)\)',stem_all),
      "options":options,"answer":answer,"sub_questions":[],"solution":sol,"knowledge_points":[],
      "source":{"repo":"TsekaLuk/Kaoyan-Math1-Papers","files":[sys.argv[2].split('/')[-1]]},
      "review":{"status":"suspect" if notes else "pending","notes":notes,"checked_by":[]}})
json.dump(qs,open(out,'w'),ensure_ascii=False,indent=2)
print(year,len(qs),'题')
for q in qs: print(q['number'],q['type'][:4],q['answer'][:1] if q['type']!='essay' else '-', len(q['options']),'|',q['stem'][:50].replace('\n',' '),'|',q['review']['notes'])
