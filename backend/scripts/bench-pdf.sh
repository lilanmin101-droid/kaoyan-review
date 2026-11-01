#!/usr/bin/env bash
# PDF 导出计时（对 :3000）：建用户 → 2017 数一整卷交卷 + 全部自评 → 打开成绩页/错题本 → report.pdf / export.pdf 各请求 N 次
# 服务端 PDF_CACHE=0 可以关掉缓存，测纯渲染耗时
set -euo pipefail
PW="${TEST_PW:-$(openssl rand -hex 12)}"  # 测试号密码：TEST_PW 或每次随机生成（不要写死在仓库里）
B=${B:-http://localhost:3000/api/v1}; N=${N:-5}
U=bench_$RANDOM$RANDOM
J() { python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }
curl -sf -XPOST $B/auth/register -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"$PW\"}" >/dev/null
T=$(curl -sf -XPOST $B/auth/login -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"$PW\"}" | J "print(d['access_token'])")
H=(-H "authorization: Bearer $T" -H 'content-type: application/json' -H "X-Timezone: America/Los_Angeles")
Q() { printf 'math1-2017-%02d' "$1"; }
E=$(curl -sf "${H[@]}" -XPOST $B/exams -d '{"exam":"math1","year":2017}' | J "print(d['id'])")
curl -sf "${H[@]}" -XPUT $B/exams/$E/progress -d "{\"idempotency_key\":\"k1\",\"client_seq\":1,\"answers\":[{\"question_id\":\"$(Q 1)\",\"answer\":[\"A\"]},{\"question_id\":\"$(Q 2)\",\"answer\":[\"B\"]}]}" >/dev/null
SR="{\"$(Q 15)\":\"full\",\"$(Q 16)\":\"no_idea\",\"$(Q 17)\":\"full\",\"$(Q 18)\":\"no_idea\",\"$(Q 19)\":{\"1\":\"full\",\"2\":\"no_idea\"},\"$(Q 20)\":{\"1\":\"full\",\"2\":\"no_idea\"},\"$(Q 21)\":\"no_idea\",\"$(Q 22)\":{\"1\":\"full\",\"2\":\"full\"},\"$(Q 23)\":{\"1\":\"full\",\"2\":\"no_idea\",\"3\":\"no_idea\"}}"
curl -sf "${H[@]}" -XPOST $B/exams/$E/submit -d "{\"self_ratings\":$SR}" >/dev/null
curl -sf "${H[@]}" "$B/exams/$E" >/dev/null; curl -sf "${H[@]}" "$B/wrong-questions" >/dev/null
# 用户在成绩页上看一会儿再点导出（默认 2 秒；THINK=0 = 交卷后立刻点）
sleep ${THINK:-2}
t() { curl -s -o /tmp/bench.pdf -w '%{time_total}' "${H[@]}" "$1"; }
for name in "report:$B/exams/$E/report.pdf" "export:$B/wrong-questions/export.pdf"; do
  url=${name#*:}; ts=()
  for i in $(seq 1 $N); do ts+=("$(t "$url")"); done
  head -c 4 /tmp/bench.pdf | grep -q '%PDF' || { echo "$name: not a PDF"; exit 1; }
  echo "${name%%:*}  $(stat -c %s /tmp/bench.pdf) bytes  times(s): ${ts[*]}"
done
curl -s -o /tmp/r.html "${H[@]}" "$B/exams/$E/report.pdf?format=html"; echo "html-only report saved /tmp/r.html"
