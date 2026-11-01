#!/usr/bin/env bash
# 第 17 轮回归（对侧端口跑，AI_FAKE=1）：模考分数拆分（英一 raw / excluded_points、数一机判 vs 解答题）；400 文案（question_id 类型、items 不是数组、坏 JSON、太大）；
# 每日复盘「还没有…记录」时态；/plans/today、/words/today 的 expires_at
#   BASE=http://localhost:3017/api/v1 bash scripts/test-r17.sh
set -euo pipefail
PW="${TEST_PW:-$(openssl rand -hex 12)}"
B=${BASE:-http://localhost:3017/api/v1}
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
ok() { python3 -c "import sys,json;d=json.load(sys.stdin);r=eval(sys.argv[1]);print('ok  ' if r else 'FAIL', sys.argv[2] if len(sys.argv)>2 else sys.argv[1]);sys.exit(0 if r else print(json.dumps(d,ensure_ascii=False)[:1500]) or 1)" "$@"; }
login() { local u="r17_$1_$RANDOM$RANDOM" tz=${2:-Asia/Shanghai}
  curl -sf -XPOST $B/auth/register -H 'content-type: application/json' -d "{\"username\":\"$u\",\"password\":\"$PW\",\"exam_date\":\"2026-12-19\",\"timezone\":\"$tz\"}" >/dev/null
  curl -sf -XPOST $B/auth/login -H 'content-type: application/json' -d "{\"username\":\"$u\",\"password\":\"$PW\"}" | j "d['access_token']"; }
c() { local t=$1 n=$2; shift 2; curl -sf -H "authorization: Bearer $t" -H 'content-type: application/json' -H "X-Debug-Now: $n" "$@"; }
cs() { local t=$1 n=$2; shift 2; curl -s -H "authorization: Bearer $t" -H 'content-type: application/json' -H "X-Debug-Now: $n" "$@"; }
S=2026-11-02T10:00:00+08:00
at() { python3 -c "import datetime as D,sys;print((D.datetime.fromisoformat('$S')+D.timedelta(minutes=float(sys.argv[1]))).isoformat())" "$1"; }
key() { c $1 $S "$B/questions/$2?include_answer=true" | j "json.dumps(d['answer'])"; }
SPLIT="['score','max_score','objective_score','objective_max','subjective_self_raw','subjective_self_score','subjective_excluded_points','subjective_excluded_count','subjective_max','subjective_ai_score']"
# 列表项 / 详情顶层 / result 三处拆分一致，且 objective + raw == score
same3() { local t=$1 e=$2 now=$3; python3 - "$(c $t $now $B/exams)" "$(c $t $now $B/exams/$e)" "$SPLIT" "$e" <<'PY'
import json,sys
l=[x for x in json.loads(sys.argv[1])['items'] if x['id']==sys.argv[4]][0]; d=json.loads(sys.argv[2]); r=d['result']; K=[k for k in eval(sys.argv[3]) if k not in ('score','max_score')]
print('   列表:', json.dumps({k:l[k] for k in eval(sys.argv[3])},ensure_ascii=False))
ok=all(l[k]==d[k]==r[k] for k in K) and abs(l['objective_score']+l['subjective_self_raw']-l['score'])<0.01 and abs(l['subjective_self_raw']-l['subjective_excluded_points']-l['subjective_self_score'])<0.01
print('ok  ' if ok else 'FAIL','列表 / 详情顶层 / result 同一份；objective + raw == score；raw − excluded_points == self_score'); sys.exit(0 if ok else 1)
PY
}

echo "== 1) 英一 2024：两道作文字数太少（自评 full）→ score 含它们，self_score 不含"
T=$(login en); E=$(c $T $S -XPOST $B/exams -d '{"exam":"english1","year":2024}' | j "d['id']")
K1=$(key $T english1-2024-01)
c $T "$(at 60)" -XPUT $B/exams/$E/progress -d "{\"idempotency_key\":\"e1\",\"client_seq\":1,\"answers\":[{\"question_id\":\"english1-2024-01\",\"answer\":$K1},{\"question_id\":\"english1-2024-46\",\"answer\":[\"这是一段足够长的译文，用来测试翻译自评的字数线是否通过，内容并不重要只是凑够字数而已。\"]},{\"question_id\":\"english1-2024-51\",\"answer\":[\"Dear Sir, thanks.\"]},{\"question_id\":\"english1-2024-52\",\"answer\":[\"The chart is interesting.\"]}]}" >/dev/null
c $T "$(at 90)" -XPOST $B/exams/$E/submit -d '{"self_ratings":{"english1-2024-46":"full","english1-2024-51":"full","english1-2024-52":"full"}}' >/dev/null
c $T "$(at 91)" $B/exams/$E | ok "(lambda p: d['objective_max']==60 and d['subjective_max']==40 and d['objective_score']==p['english1-2024-01']['got']>0 and d['subjective_excluded_count']==2 and d['subjective_excluded_points']==p['english1-2024-51']['got']+p['english1-2024-52']['got']>0 and d['subjective_self_score']==p['english1-2024-46']['got'] and d['result']['score']==d['objective_score']+d['subjective_self_raw'])({x['question_id']:x for x in d['result']['per_question']})" "英一：excluded 2 题、excluded_points = 两道作文自评分、self_score 只剩翻译"
same3 $T $E "$(at 91)"

echo "== 2) 数一：机判（选择 + 填空）vs 解答题自评，满分按卷子现算"
T2=$(login m); E=$(c $T2 $S -XPOST $B/exams -d '{"exam":"math1","year":2024}' | j "d['id']")
c $T2 "$(at 1)" $B/exams/$E | ok "d['objective_max']==80 and d['subjective_max']==70 and d['objective_score'] is None and d['subjective_self_raw'] is None" "数一 2024 进行中：80 / 70，分数 null"
K1=$(key $T2 math1-2024-01); K11=$(key $T2 math1-2024-11)
c $T2 "$(at 60)" -XPUT $B/exams/$E/progress -d "{\"idempotency_key\":\"m1\",\"client_seq\":1,\"answers\":[{\"question_id\":\"math1-2024-01\",\"answer\":$K1},{\"question_id\":\"math1-2024-11\",\"answer\":$K11},{\"question_id\":\"math1-2024-17\",\"answer\":[\"解：略\"]},{\"question_id\":\"math1-2024-18\",\"answer\":[\"解：略\"]}]}" >/dev/null
c $T2 "$(at 90)" -XPOST $B/exams/$E/submit -d '{"self_ratings":{"math1-2024-17":"full","math1-2024-18":"approach_ok_calc_wrong","math1-2024-19":"no_idea","math1-2024-20":"no_idea","math1-2024-21":"no_idea","math1-2024-22":"no_idea"}}' >/dev/null
c $T2 "$(at 91)" $B/exams/$E | ok "d['objective_max']==80 and d['subjective_max']==70 and d['objective_score']==10 and d['subjective_self_raw']>0 and d['subjective_excluded_points']==0 and d['subjective_excluded_count']==0 and d['subjective_self_score']==d['subjective_self_raw']" "数一 2024 交卷：客观 10（2 题对）/80，解答题自评 /70，没有字数线 excluded=0"
same3 $T2 $E "$(at 91)"
T3=$(login m17); E=$(c $T3 $S -XPOST $B/exams -d '{"exam":"math1","year":2017}' | j "d['id']")
c $T3 "$(at 1)" $B/exams | ok "d['items'][0]['objective_max']==56 and d['items'][0]['subjective_max']==94 and d['items'][0]['objective_score'] is None" "数一 2017：56 / 94"
c $T3 "$(at 1)" -XPOST $B/exams -d '{"question_ids":["math1-2024-01","math1-2024-02"],"duration_minutes":10}' >/dev/null 2>&1 || true

echo "== 3) 400 / 413 文案"
T6=$(login er)
chk() { local name=$1 st=$2 field=$3 code=$4 msg=$5; shift 5; local hc; hc=$(cs $T6 $S -o /tmp/r17_e -w '%{http_code}' "$@")
  python3 -c "import json,sys;d=json.load(open('/tmp/r17_e'));ok=sys.argv[1]==sys.argv[2] and d.get('field')==(None if sys.argv[3]=='null' else sys.argv[3]) and d.get('code')==sys.argv[4] and d.get('message')==sys.argv[5] and d.get('statusCode')==int(sys.argv[2]);print('ok  ' if ok else 'FAIL','$name', sys.argv[1], json.dumps(d,ensure_ascii=False));sys.exit(0 if ok else 1)" "$hc" "$st" "$field" "$code" "$msg"; }
chk "question_id 是数字" 400 question_id bad_question_id "question_id 应为字符串" -XPOST $B/answers -d '{"question_id":5,"answer":["A"]}'
chk "缺 question_id" 400 question_id missing_question_id "缺少 question_id" -XPOST $B/answers -d '{"answer":["A"]}'
chk "items 不是数组" 400 items bad_items "items 应为数组" -XPOST $B/answers -d '{"items":"x"}'
chk "坏 JSON（answers）" 400 null invalid_json "请求格式不对" -XPOST $B/answers -d '{"question_id":'
chk "坏 JSON（登录，没 token 也一样）" 400 null invalid_json "请求格式不对" -XPOST $B/auth/login -d '{bad'
python3 -c "import json;print(json.dumps({'question_id':'math1-2024-01','answer':['x'*(2*1024*1024)]}))" > /tmp/r17_big.json
chk "请求体太大" 413 null payload_too_large "请求体太大了，拆成几次再传" -XPOST $B/answers --data-binary @/tmp/r17_big.json
c $T6 $S -XPOST $B/answers -d '{"items":[{"question_id":5},{"question_id":"math1-2024-01","answer":["A"]}]}' | ok "d['items'][0]['reason']=='bad_question_id' and d['items'][1]['status']=='recorded'" "批量里 question_id 是数字 → rejected bad_question_id"

echo "== 4) 每日复盘时态（11-04 23:00 复盘）"
TA=$(login rv0); c $TA 2026-11-04T23:00:00+08:00 -XPOST $B/agent/jobs/run -d '{"job":"nightly","force":true}' >/dev/null
TB=$(login rv5); K=$(key $TB math1-2024-01)
c $TB 2026-11-04T21:00:00+08:00 -XPOST $B/answers -d "{\"question_id\":\"math1-2024-01\",\"answer\":$K}" >/dev/null
c $TB 2026-11-04T23:00:00+08:00 -XPOST $B/agent/jobs/run -d '{"job":"nightly","force":true}' >/dev/null
rv() { c $1 "$2" $B/agent/messages | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps([m for m in d['items'] if m.get('kind')=='review'][0]['details'],ensure_ascii=False))"; }
for t in TA TB; do for n in 2026-11-04T23:30:00+08:00 2026-11-05T10:00:00+08:00 2026-11-11T10:00:00+08:00; do echo "   $t @ $n: $(rv ${!t} $n)"; done; done
rv $TA 2026-11-04T23:30:00+08:00 | ok "d=='今天（11-04）还没有作答记录。'" "当天：还没有作答记录"
rv $TA 2026-11-05T10:00:00+08:00 | ok "d=='昨天（11-04）没有作答记录。'" "第二天：没有作答记录"
rv $TB 2026-11-04T23:30:00+08:00 | ok "d.endswith('还没有学习时长记录。') and d.startswith('今天（11-04）做了 1 题')" "当天：还没有学习时长记录"
rv $TB 2026-11-05T10:00:00+08:00 | ok "d=='昨天（11-04）做了 1 题，对 1 题，没有学习时长记录。'" "第二天：没有学习时长记录"
rv $TB 2026-11-11T10:00:00+08:00 | ok "d.startswith('11-04（周三）做了 1 题') and '还没' not in d" "一周后"

echo "== 5) /plans/today、/words/today 的 expires_at（= 离线题包同一个 helper）"
for p in "2026-11-02T02:05:00+08:00 2026-11-01 2026-11-01T20:00:00.000Z" "2026-11-02T04:01:00+08:00 2026-11-02 2026-11-02T20:00:00.000Z" "2026-11-02T23:59:00+08:00 2026-11-02 2026-11-02T20:00:00.000Z"; do
  set -- $p
  c $T6 $1 $B/plans/today | ok "d['study_date']=='$2' and d['expires_at']=='$3' and d['timezone']=='Asia/Shanghai'" "plans/today 上海 $1 → $3"
  c $T6 $1 $B/words/today | ok "d['study_date']=='$2' and d['expires_at']=='$3'" "words/today 上海 $1 → $3"
  c $T6 $1 $B/offline/pack | ok "d['expires_at']=='$3'" "offline/pack 同值"; done
TL=$(login la America/Los_Angeles)
c $TL 2026-11-02T02:05:00+08:00 $B/plans/today | ok "d['study_date']=='2026-11-01' and d['expires_at']=='2026-11-02T12:00:00.000Z' and d['timezone']=='America/Los_Angeles'" "plans/today 洛杉矶 → 11-02T12:00Z"
c $TL 2026-11-02T02:05:00+08:00 $B/words/today | ok "d['expires_at']=='2026-11-02T12:00:00.000Z'" "words/today 洛杉矶"
echo "R17 OK"
