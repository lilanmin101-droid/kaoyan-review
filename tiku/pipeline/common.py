import re
R={'I':'I','II':'Ⅱ','III':'Ⅲ'}
def fix_labels(s):
    s=re.sub(r'\$\s*\\left\(\s*\\mathrm\{\s*(I{1,3})\s*\}\s*\\right\)\s*',lambda m:'（'+R[m.group(1)]+'）$',s)
    s=re.sub(r'\$\s*\(\s*\\mathrm\s*\{\s*(I{1,3})\s*\}\s*\)\s*',lambda m:'（'+R[m.group(1)]+'）$',s)
    s=re.sub(r'\$\$\n(?:\\begin\{array\}\{l\}\s*)?\((?:\\mathrm|\\text)\s*\{\s*(I)\s*(I)?\s*(I)?\s*\}\)\s*',lambda m:'（'+R[''.join(g for g in m.groups() if g)]+'）\n\n$$\n'+('\\begin{array}{l} ' if 'array' in m.group(0) else ''),s)
    s=s.replace('（Ⅱ）$$','（Ⅱ）\n\n$$')
    return s.replace('$ $','$\u2009$') if False else s
def split_stem_parts(s):
    s=re.sub(r'\s*\((I{1,3})\)\s*',lambda m:'\n\n（'+R[m.group(1)]+'）',s)
    s=re.sub(r'[ \t]*\s{2,}（(I|Ⅱ|Ⅲ)）',r'\n\n（\1）',s)
    return re.sub(r'\n{3,}','\n\n',s)
def set_subs(Q,SQ):
    for n,l in SQ.items():
        q=Q[n]; single=len(l)==1
        q['sub_questions']=[{'number':k+1,'stem':a,'score':q['score'] if single else None,'answer':[b]} for k,(a,b) in enumerate(l)]
        q['answer']=['见各小问']
def stem_images(q):
    imgs=re.findall(r'!\[[^\]]*\]\(([^)]+)\)',q['stem'])
    if imgs:
        q['images']=list(dict.fromkeys((q.get('images') or [])+imgs))
        q['stem']=re.sub(r'\s*!\[[^\]]*\]\([^)]+\)\s*','\n\n',q['stem']).strip()
