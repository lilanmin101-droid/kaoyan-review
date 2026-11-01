#!/usr/bin/env python3
"""核对 tiku/src/ 下的原始资料与 SOURCES.md 「原卷文件清单」表是否一致（sha256 + 大小）。

用法（在任意目录）：
  python3 pipeline/verify_sources.py            # 只读核对
  python3 pipeline/verify_sources.py --fetch    # 先按 URL 下载缺失文件（只下可直接下载的），再核对
  python3 pipeline/verify_sources.py --quiet    # 只打印问题

结果分级：
  ERROR  缺失 / sha256 或大小不一致（可复现文件）
  WARN   网页存档、OCR、去标签派生文件不一致（网站会更新，sha 只作留档）；0 字节文件；表外多出的文件
退出码：有 ERROR 为 1，否则 0。
"""
import hashlib, os, re, sys, urllib.request

TIKU = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(TIKU, 'SOURCES.md')
HEADER = '原卷文件清单'
SOFT = ('[第三方网页]', '[仅OCR]', '[仅文字层]', 'sha 不保证')
NOFETCH = ('[派生]', '[仅OCR]', '[仅文字层]', '[项目自写', '0 字节')


def parse():
    rows, on = [], False
    for line in open(MANIFEST, encoding='utf-8'):
        if line.startswith('## '):
            on = HEADER in line
            continue
        if not on or not line.startswith('| `'):
            continue
        cells = [c.strip() for c in line.strip().strip('|').split(' | ')]
        if len(cells) < 5:
            continue
        path, sha, size, url = cells[0].strip('`'), cells[1].strip('`'), int(cells[2]), cells[3]
        rows.append(dict(path=path, sha=sha, size=size, url='' if url == '—' else url, note=' | '.join(cells[4:])))
    return rows


def sha256(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def fetch(r):
    dst = os.path.join(TIKU, r['path'])
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    req = urllib.request.Request(r['url'], headers={'User-Agent': 'Mozilla/5.0'})
    tmp = dst + '.part'
    with urllib.request.urlopen(req, timeout=300) as resp, open(tmp, 'wb') as f:
        while True:
            b = resp.read(1 << 20)
            if not b:
                break
            f.write(b)
    os.replace(tmp, dst)


def main():
    args = set(sys.argv[1:])
    if not os.path.exists(MANIFEST):
        sys.exit(f'找不到 {MANIFEST}')
    rows = parse()
    if not rows:
        sys.exit(f'{MANIFEST} 里没有「{HEADER}」表')
    if '--fetch' in args:
        for r in rows:
            p = os.path.join(TIKU, r['path'])
            if os.path.exists(p) or not r['url'] or any(k in r['note'] for k in NOFETCH):
                continue
            try:
                fetch(r); print(f'FETCHED {r["path"]}')
            except Exception as e:
                print(f'FETCH-FAIL {r["path"]}: {e}')
    err = warn = ok = 0
    listed = set()
    for r in rows:
        listed.add(r['path'])
        p = os.path.join(TIKU, r['path'])
        soft = any(k in r['note'] for k in SOFT)
        if not os.path.exists(p):
            tag = 'WARN ' if soft or '[派生]' in r['note'] else 'ERROR'
            print(f'{tag} 缺失     {r["path"]}  {r["url"] or "(无 URL，见备注)"}')
            err += tag == 'ERROR'; warn += tag != 'ERROR'
            continue
        size = os.path.getsize(p)
        h = sha256(p)
        if size != r['size'] or h != r['sha']:
            tag = 'WARN ' if soft else 'ERROR'
            print(f'{tag} 不一致   {r["path"]}  大小 {size}/{r["size"]}  sha {h[:12]}/{r["sha"][:12]}')
            err += tag == 'ERROR'; warn += tag != 'ERROR'
        elif size == 0:
            print(f'WARN  0 字节   {r["path"]}'); warn += 1
        else:
            ok += 1
            if '--quiet' not in args:
                print(f'OK    {r["path"]}')
    src = os.path.join(TIKU, 'src')
    for d, _, fs in os.walk(src):
        for f in fs:
            rel = os.path.relpath(os.path.join(d, f), TIKU)
            if rel not in listed:
                print(f'WARN  表外文件 {rel}（请补进清单）'); warn += 1
    print(f'\n共 {len(rows)} 条：OK {ok}，ERROR {err}，WARN {warn}')
    sys.exit(1 if err else 0)


if __name__ == '__main__':
    main()
