# 统筹者：核对状态只认 reviews/*.jsonl，题库文件不保留 review 栏。每次清洗流程最后跑一次。
import json,glob
for F in sorted(glob.glob('/workspace/tiku/*_[0-9][0-9][0-9][0-9].json')):
    qs=json.load(open(F)); n=sum(1 for q in qs if q.pop('review',None) is not None)
    if n: json.dump(qs,open(F,'w'),ensure_ascii=False,indent=2); print(F,n)
