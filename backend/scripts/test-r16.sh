#!/usr/bin/env bash
# 第 16 轮回归（对侧端口跑，AI_FAKE=1）：周报「当时阶段 / 没有…记录」+ 新的一周今日卡片不放旧周报；暂停超时自动交卷 remaining=0；
# 模考列表分数拆分（英一客观 / 主观自评）；400 统一 code/field；题包 expires_at；（EXPL_DIR 给了时）英语一专家讲解热加载
#   BASE=http://localhost:3016/api/v1 [EXPL_DIR=侧服务的 EXPLANATIONS_DIR] bash scripts/test-r16.sh
set -euo pipefail
PW="${TEST_PW:-$(openssl rand -hex 12)}"
B=${BASE:-http://localhost:3016/api/v1}
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
ok() { python3 -c "import sys,json;d=json.load(sys.stdin);r=eval(sys.argv[1]);print('ok  ' if r else 'FAIL', sys.argv[2] if len(sys.argv)>2 else sys.argv[1]);sys.exit(0 if r else print(json.dumps(d,ensure_ascii=False)[:1500]) or 1)" "$@"; }
login() { local u="r16_$1_$RANDOM$RANDOM" tz=${2:-Asia/Shanghai}
  curl -sf -XPOST $B/auth/register -H 'content-type: application/json' -d "{\"username\":\"$u\",\"password\":\"$PW\",\"exam_date\":\"2026-12-19\",\"timezone\":\"$tz\"}" >/dev/null
  curl -sf -XPOST $B/auth/login -H 'content-type: application/json' -d "{\"username\":\"$u\",\"password\":\"$PW\"}" | j "d['access_token']"; }
c() { local t=$1 n=$2; shift 2; curl -sf -H "authorization: Bearer $t" -H 'content-type: application/json' -H "X-Debug-Now: $n" "$@"; }
cs() { local t=$1 n=$2; shift 2; curl -s -H "authorization: Bearer $t" -H 'content-type: application/json' -H "X-Debug-Now: $n" "$@"; }

echo "== G1/G2 周报时态 + 今日卡片（11-04 20:00 生成，没作答）"
T=$(login wk)
c $T 2026-11-04T20:00:00+08:00 -XPOST $B/agent/jobs/run -d '{"job":"weekly","force":true}' >/dev/null
wk() { c $T "$1" $B/agent/messages | python3 -c "
import sys,json;d=json.load(sys.stdin);w=[m for m in d['items'] if m.get('kind')=='weekly'][0]
print(json.dumps({'headline':w.get('headline') or w.get('text'),'details':w.get('details')},ensure_ascii=False))"; }
pt() { c $T "$1" $B/plans/today | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps((d.get('tips') or {}).get('weekly'),ensure_ascii=False))"; }
for at in 2026-11-05T10:00:00+08:00 2026-11-09T10:00:00+08:00; do echo "-- 读 $at: $(wk $at)"; done
wk 2026-11-05T10:00:00+08:00 | ok "d['details']=='本周（11-02–11-08）还没有作答记录，也还没有学习时长记录。当前阶段：基础，距考试 44 天。'" "当周 11-05：现在时"
wk 2026-11-09T10:00:00+08:00 | ok "d['details']=='那周（11-02–11-08）没有作答记录，也没有学习时长记录。当时阶段：基础，当时距考试 45 天。' and d['headline'].startswith('当时定的下周重点：')" "周过了 11-09：当时阶段 / 没有…记录"
pt 2026-11-08T23:00:00+08:00 | ok "d is not None and '本周（11-02–11-08）' in d['details']" "11-08 23:00 今日卡片还有本周周报"
pt 2026-11-09T03:30:00+08:00 | ok "d is not None" "11-09 03:30（还算 11-08 学习日）还有"
pt 2026-11-09T10:00:00+08:00 | ok "d is None" "11-09 10:00 新的一周没写周报 → 今日卡片不放旧周报"
c $T 2026-11-15T21:30:00+08:00 -XPOST $B/agent/jobs/run -d '{"job":"weekly","force":true}' >/dev/null
pt 2026-11-15T22:00:00+08:00 | ok "d is not None and '本周（11-09–11-15）' in d['details']" "新一周写了周报 → 今日卡片放新的"

echo "== 暂停超过 24 小时自动交卷：remaining_seconds=0（详情 / 心跳 409 / 列表）"
S=2026-11-02T10:00:00+08:00
at() { python3 -c "import datetime as D,sys;print((D.datetime.fromisoformat('$S')+D.timedelta(minutes=float(sys.argv[1]))).isoformat())" "$1"; }
T3=$(login p25); E=$(c $T3 $S -XPOST $B/exams -d '{"exam":"math1","year":2024}' | j "d['id']")
c $T3 "$(at 30)" -XPOST $B/exams/$E/pause >/dev/null
code=$(cs $T3 "$(at 1530)" -o /tmp/r16_body -w '%{http_code}' -XPUT $B/exams/$E/progress -d '{"idempotency_key":"a2","client_seq":2,"answers":[]}')
python3 -c "import json,sys;d=json.load(open('/tmp/r16_body'));ok=sys.argv[1]=='409' and d['auto_submit_reason']=='paused_too_long' and d['remaining_seconds']==0;print('ok  ' if ok else 'FAIL','心跳 → 409 remaining_seconds=0');sys.exit(0 if ok else 1)" "$code"
c $T3 "$(at 1531)" $B/exams/$E | ok "d['auto_submit_reason']=='paused_too_long' and d['remaining_seconds']==0 and d['elapsed_seconds']==1800" "详情 remaining_seconds=0（elapsed 冻结 30 分钟）"
c $T3 "$(at 1531)" $B/exams | ok "d['items'][0]['remaining_seconds']==0" "列表 remaining_seconds=0"
TU=$(login tu); E=$(c $TU $S -XPOST $B/exams -d '{"exam":"math1","year":2024}' | j "d['id']")
c $TU "$(at 200)" $B/exams/$E | ok "d['auto_submit_reason']=='time_up' and d['remaining_seconds']==0" "到点自动交卷同样 0"

echo "== 模考列表分数拆分（英一 2024：客观 60 / 主观自评 40，字数太少不计）"
T5=$(login en); E=$(c $T5 $S -XPOST $B/exams -d '{"exam":"english1","year":2024}' | j "d['id']")
LONG=$(python3 -c "print(' '.join(['The chart shows that more young people choose to read books online every year, and this trend reflects changes in technology.']*8))")
c $T5 "$(at 60)" -XPUT $B/exams/$E/progress -d "{\"idempotency_key\":\"e1\",\"client_seq\":1,\"answers\":[{\"question_id\":\"english1-2024-01\",\"answer\":[\"A\"]},{\"question_id\":\"english1-2024-46\",\"answer\":[\"这是一段足够长的译文，用来测试翻译自评的字数线是否通过，内容并不重要只是凑够字数而已。\"]},{\"question_id\":\"english1-2024-51\",\"answer\":[\"Dear Sir, thanks.\"]},{\"question_id\":\"english1-2024-52\",\"answer\":[\"$LONG\"]}]}" >/dev/null
c $T5 "$(at 90)" -XPOST $B/exams/$E/submit -d '{"self_ratings":{"english1-2024-46":"full","english1-2024-51":"full","english1-2024-52":"approach_ok_calc_wrong"}}' > /tmp/r16_en.json
python3 - "$(c $T5 "$(at 91)" $B/exams)" <<'PY'
import json,sys
v=json.load(open('/tmp/r16_en.json')); it=json.loads(sys.argv[1])['items'][0]
per={p['question_id']:p for p in v['result']['per_question']}
obj=sum(p['got'] or 0 for p in per.values() if p['objective'])
sub=sum(p['got'] or 0 for q,p in per.items() if not p['objective'] and 'word_count_low' not in (p.get('self_grade_flags') or []))
print('   列表项:', json.dumps({k:it[k] for k in ['score','max_score','objective_score','objective_max','subjective_self_score','subjective_max','subjective_excluded_count','subjective_ai_score']}))
ok=it['objective_max']==60 and it['subjective_max']==40 and it['subjective_excluded_count']==1 and per['english1-2024-51']['self_grade_flags']==['word_count_low'] \
  and it['objective_score']==obj and it['subjective_self_score']==sub and sub>0 and it['subjective_ai_score'] is None and abs(it['score']-(obj+sub+(per['english1-2024-51']['got'] or 0)))<0.01
print('ok  ' if ok else 'FAIL','英一拆分：客观 60 / 主观 40、小作文字数太少不计（excluded=1）、subjective_ai_score 预留 null'); sys.exit(0 if ok else 1)
PY
c $T3 "$(at 1531)" $B/exams | ok "(lambda x: x['exam']=='math1' and x['objective_max']+x['subjective_max']==x['max_score'] and x['objective_max'] in (56,80) and x['subjective_excluded_count']==0 and x['subjective_excluded_points']==0 and (x['score'] is None or x['objective_score']+x['subjective_self_raw']==x['score']))(d['items'][0])" "数一：第 17 轮起按卷子拆（选择+填空 / 解答题自评），excluded=0"

echo "== 400 统一格式（answers）"
T6=$(login er)
chk400() { local name=$1 field=$2 code=$3; shift 3; local hc; hc=$(cs $T6 $S -o /tmp/r16_400 -w '%{http_code}' "$@")
  python3 -c "import json,sys;d=json.load(open('/tmp/r16_400'));ok=sys.argv[1]=='400' and d.get('field')==(None if sys.argv[2]=='null' else sys.argv[2]) and d.get('code')==sys.argv[3] and d.get('statusCode')==400 and d.get('error')=='Bad Request' and d.get('message');print('ok  ' if ok else 'FAIL','$name', sys.argv[1], json.dumps(d,ensure_ascii=False));sys.exit(0 if ok else 1)" "$hc" "$field" "$code"; }
chk400 "缺 question_id" question_id missing_question_id -XPOST $B/answers -d '{"answer":["A"]}'
chk400 "self_rating 不对" self_rating bad_self_rating -XPOST $B/answers -d '{"question_id":"math1-2024-01","self_rating":"x"}'
chk400 "client_id 不对" client_id bad_client_id -XPOST $B/answers -d '{"question_id":"math1-2024-01","answer":["A"],"client_id":"有 空格"}'
chk400 "source 不对" source bad_source -XPOST $B/answers -d '{"question_id":"math1-2024-01","answer":["A"],"source":"x"}'
chk400 "answer 不是数组" answer bad_answer -XPOST $B/answers -d '{"question_id":"math1-2024-01","answer":"A"}'
chk400 "answered_at 不对" answered_at bad_answered_at -XPOST $B/answers -d '{"question_id":"math1-2024-01","answer":["A"],"answered_at":"昨天"}'
chk400 "批量空" items empty_items -XPOST $B/answers -d '{"items":[]}'
chk400 "year 格式" year invalid_year "$B/answers?year=20"
chk400 "question_ids 空" question_ids invalid_question_ids "$B/answers?question_ids=,"
chk400 "批改 id 格式" id invalid_id -XPOST $B/answers/not-a-uuid/grade -d '{}'
chk400 "模考 cursor（兜底 code）" null bad_request "$B/exams?cursor=xx"

echo "== 题包 expires_at = 用户时区下一个 04:00"
for p in "2026-11-02T02:05:00+08:00 2026-11-01 2026-11-01T20:00:00.000Z" "2026-11-02T04:01:00+08:00 2026-11-02 2026-11-02T20:00:00.000Z" "2026-11-02T23:59:00+08:00 2026-11-02 2026-11-02T20:00:00.000Z"; do
  set -- $p; c $T6 $1 $B/offline/pack | ok "d['timezone']=='Asia/Shanghai' and d['study_date']=='$2' and d['expires_at']=='$3'" "上海 $1 → $2 / $3"; done
TL=$(login la America/Los_Angeles)
c $TL 2026-11-02T02:05:00+08:00 $B/offline/pack | ok "d['timezone']=='America/Los_Angeles' and d['study_date']=='2026-11-01' and d['expires_at']=='2026-11-02T12:00:00.000Z'" "洛杉矶用户同一时刻 → 11-01 / 2026-11-02T12:00Z（当地 04:00）"

if [ -n "${EXPL_DIR:-}" ]; then
  echo "== 英语一专家讲解（侧服务 EXPLANATIONS_DIR=$EXPL_DIR 是 tiku/explanations 的副本；临时挪走 english1_2025 测热加载，测完放回）"
  N=2026-11-02T10:00:00+08:00; F="$EXPL_DIR/english1_2025_expert.jsonl"
  c $T6 $N $B/offline/pack > /tmp/r16_p0.json
  ok "len(d['questions'])>0 and all(q['exam']=='english1' and q['explanation_status']=='ready' and q['explanation']['source']=='expert' and q['explanation']['source_label']=='行业专家参考解答（非官方解析）' and len(q['explanation']['steps'])>=2 and q['solution'] for q in d['questions'])" "题包：英一题全部 ready（expert，标签对）" < /tmp/r16_p0.json
  for id in english1-2025-01 english1-2025-21 english1-2025-36 english1-2025-41 english1-2025-46 english1-2025-51 english1-2025-52; do
    c $T6 $N "$B/questions/$id" | ok "d['explanation']['source']=='expert' and d['explanation']['source_label']=='行业专家参考解答（非官方解析）'" "题目详情 $id：expert"
    c $T6 $N "$B/questions/$id/hint?step=9" | ok "d['source']=='expert' and d['status']=='expert' and d['has_more'] is False and d['hints'][-1]['text'].startswith('**下次记住**')" "讲解步骤 $id"; done
  mv "$F" "$F.off"; trap 'mv -f "$F.off" "$F" 2>/dev/null || true' EXIT
  c $T6 $N $B/offline/pack | python3 -c "import sys,json;d=json.load(sys.stdin);d['_v0']=json.load(open('/tmp/r16_p0.json'))['version'];print(json.dumps(d))" \
    | ok "d['version']!=d['_v0'] and all(q['explanation_status']=='pending' for q in d['questions'] if q['year']==2025)" "挪走文件、不重启：2025 题变 pending、包版本变"
  mv "$F.off" "$F"
  c $T6 $N $B/offline/pack | python3 -c "import sys,json;d=json.load(sys.stdin);d['_v0']=json.load(open('/tmp/r16_p0.json'))['version'];print(json.dumps(d))" \
    | ok "d['version']==d['_v0'] and all(q['explanation_status']=='ready' for q in d['questions'])" "放回文件、不重启：恢复 ready、版本回到原值"
fi
echo "R16 OK"
