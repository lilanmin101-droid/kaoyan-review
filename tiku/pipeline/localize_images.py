"""把题目/解析里引用的仓库图片下载到 tiku/images/math1-<year>/，并改写引用路径。
用法: python3 localize_images.py <json> <year>   (需要 /tmp/tree.json 仓库文件树)"""
import json,re,sys,os,urllib.request,urllib.parse
p,year=sys.argv[1],sys.argv[2]; qs=json.load(open(p))
tree=[x['path'] for x in json.load(open('/tmp/tree.json'))['tree']]
dst=f'/workspace/tiku/images/math1-{year}'; os.makedirs(dst,exist_ok=True)
def fetch(name):
    c=[t for t in tree if t.endswith('/'+name) and year in t] or [t for t in tree if t.endswith('/'+name)]
    if not c: return None
    out=os.path.join(dst,name)
    if not os.path.exists(out):
        url='https://raw.githubusercontent.com/TsekaLuk/Kaoyan-Math1-Papers/HEAD/'+urllib.parse.quote(c[0])
        urllib.request.urlretrieve(url,out)
    try:
        from PIL import Image
        w,h=Image.open(out).size
        if w<=80 and h<=80:   # 网站水印小图标（约 55x61），直接丢弃
            os.remove(out); dropped.append(name); return ''
    except Exception: pass
    return f'images/math1-{year}/{name}'
miss=[];dropped=[]
def fix(t):
    if not t: return t
    def r(m):
        new=fetch(os.path.basename(m.group(1)))
        if new=='': return ''
        if not new: miss.append(m.group(1)); return m.group(0)
        return f'![]({new})'
    return re.sub(r'!\[[^\]]*\]\(([^)]*)\)',r,t)
for q in qs:
    q['stem']=fix(q['stem']); q['solution']=fix(q['solution'])
    for o in q['options']: o['content']=fix(o['content'])
    q['images']=[x for x in (fetch(os.path.basename(i)) or i for i in q['images']) if x]
json.dump(qs,open(p,'w'),ensure_ascii=False,indent=2)
print('缺图',miss,'丢弃水印小图',dropped)
