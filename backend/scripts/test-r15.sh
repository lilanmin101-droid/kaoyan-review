#!/usr/bin/env bash
# 第 15 轮回归（对侧端口跑，AI_FAKE=1）：E1/E2 周报时态（当周 / 周过了 / 8 天后）+ 模考非连续作答 / 暂停超过 24 小时自动交卷
#   BASE=http://localhost:3015/api/v1 bash scripts/test-r15.sh
set -euo pipefail
PW="${TEST_PW:-$(openssl rand -hex 12)}"
B=${BASE:-http://localhost:3015/api/v1}
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
ok() { python3 -c "import sys,json;d=json.load(sys.stdin);r=eval(sys.argv[1]);print('ok  ' if r else 'FAIL', sys.argv[2] if len(sys.argv)>2 else sys.argv[1]);sys.exit(0 if r else print(json.dumps(d,ensure_ascii=False)[:1200]) or 1)" "$@"; }
login() { local u="r15_$1_$RANDOM$RANDOM"
  curl -sf -XPOST $B/auth/register -H 'content-type: application/json' -d "{\"username\":\"$u\",\"password\":\"$PW\",\"exam_date\":\"2026-12-19\",\"timezone\":\"Asia/Shanghai\"}" >/dev/null
  curl -sf -XPOST $B/auth/login -H 'content-type: application/json' -d "{\"username\":\"$u\",\"password\":\"$PW\"}" | j "d['access_token']"; }
# c TOKEN DEBUG_NOW curl参数…（-sf）；cs 同上但不加 -f（要看 409 的 body）
c() { local t=$1 n=$2; shift 2; curl -sf -H "authorization: Bearer $t" -H 'content-type: application/json' -H 'X-Timezone: Asia/Shanghai' -H "X-Debug-Now: $n" "$@"; }
cs() { local t=$1 n=$2; shift 2; curl -s -H "authorization: Bearer $t" -H 'content-type: application/json' -H 'X-Timezone: Asia/Shanghai' -H "X-Debug-Now: $n" "$@"; }

echo "== E1/E2 周报时态（11-04 20:00 生成，考试 12-19）"
T=$(login wk)
c $T 2026-11-04T20:00:00+08:00 -XPOST $B/agent/jobs/run -d '{"job":"weekly","force":true}' >/dev/null
wk() { c $T "$1" $B/agent/messages | python3 -c "
import sys,json;d=json.load(sys.stdin);w=[m for m in d['items'] if m.get('kind')=='weekly'][0]
print(json.dumps({'headline':w.get('headline') or w.get('text'),'details':w.get('details')},ensure_ascii=False))"; }
pt() { c $T "$1" $B/plans/today | python3 -c "import sys,json;d=json.load(sys.stdin);w=(d.get('tips') or {}).get('weekly') or {};print(json.dumps({'headline':w.get('headline') or w.get('text'),'details':w.get('details')},ensure_ascii=False))"; }
for at in 2026-11-05T10:00:00+08:00 2026-11-09T10:00:00+08:00 2026-11-12T10:00:00+08:00; do echo "-- 读 $at"; wk $at; echo "   /plans/today: $(pt $at)"; done
wk 2026-11-05T10:00:00+08:00 | ok "d['headline'].startswith('下周重点：') and '本周（11-02–11-08）' in d['details'] and '距考试 44 天' in d['details'] and '当时' not in d['details']" "当周 11-05：本周 + 距考试 44 天（现算）"
pt 2026-11-05T10:00:00+08:00 | ok "'距考试 44 天' in d['details'] and '当时' not in d['details']" "当周 /plans/today tips.weekly 同口径"
wk 2026-11-09T10:00:00+08:00 | ok "d['headline'].startswith('当时定的下周重点：') and '那周（11-02–11-08）' in d['details'] and '当时距考试 45 天' in d['details']" "周过了 11-09：那周 + 当时距考试 45 天 + 当时定的下周重点"
wk 2026-11-12T10:00:00+08:00 | ok "d['headline'].startswith('当时定的下周重点：') and '那周（11-02–11-08）' in d['details'] and '当时距考试 45 天' in d['details'] and '{{' not in json.dumps(d)" "8 天后 11-12"

echo "== 模考：非连续作答 / 暂停超过 24 小时"
S=2026-11-02T10:00:00+08:00
at() { python3 -c "import datetime as D,sys;print((D.datetime.fromisoformat('$S')+D.timedelta(minutes=float(sys.argv[1]))).isoformat())" "$1"; }
newexam() { c $1 $S -XPOST $B/exams -d '{"exam":"math1","year":2024}' | j "d['id']"; }
# 1) 暂停 16 分钟 → non_continuous
T1=$(login p16); E=$(newexam $T1)
c $T1 $S $B/exams/$E | ok "d['non_continuous'] is False and d['pause_warn_seconds']==600 and d['non_continuous_pause_seconds']==900 and d['counts_in_trend'] is False and d['auto_submit_reason'] is None" "开考：常量都在、连续"
c $T1 "$(at 10)" -XPOST $B/exams/$E/pause | ok "d['status']=='paused' and d['paused_at'] is not None and d['paused_at'].startswith('2026-11-02T02:10')" "暂停：paused_at=暂停那一刻"
c $T1 "$(at 12)" $B/exams/$E | ok "d['paused_at'].startswith('2026-11-02T02:10')" "刷新后详情仍带 paused_at"
c $T1 "$(at 13)" $B/exams | ok "d['items'][0]['paused_at'].startswith('2026-11-02T02:10')" "列表也带 paused_at"
c $T1 "$(at 26)" -XPOST $B/exams/$E/resume |  ok "d['paused_seconds']==960 and d['non_continuous'] is True and d['paused_at'] is None" "暂停 16 分钟 → non_continuous（进行中就标）"
c $T1 "$(at 40)" -XPOST $B/exams/$E/submit -d '{}' | ok "d['status']=='submitted' and d['non_continuous'] is True and d['result']['non_continuous'] is True and d['counts_in_trend'] is False and d['result']['score'] is not None" "交卷：分数照常、non_continuous、不计趋势"
# 1b) 暂停 15 分钟整 → 仍连续
T1b=$(login p15); E=$(newexam $T1b)
c $T1b "$(at 10)" -XPUT $B/exams/$E/progress -d '{"idempotency_key":"h1","client_seq":1,"state":"paused"}' | ok "d['status']=='paused' and d['paused_at'].startswith('2026-11-02T02:10')" "心跳带 state=paused 也给 paused_at"
 c $T1b "$(at 25)" -XPOST $B/exams/$E/resume >/dev/null
c $T1b "$(at 40)" -XPOST $B/exams/$E/submit -d '{}' | ok "d['non_continuous'] is False and d['counts_in_trend'] is True" "暂停正好 15 分钟 → 连续、计趋势"
E15=$E
# 2) 跨 04:00（第 16 轮起不算非连续；整场归开考那天的学习日）
T2=$(login x04); E=$(c $T2 2026-11-03T03:30:00+08:00 -XPOST $B/exams -d '{"exam":"math1","year":2024}' | j "d['id']")
c $T2 2026-11-03T04:10:00+08:00 -XPOST $B/exams/$E/submit -d '{}' | ok "d['non_continuous'] is False and d['counts_in_trend'] is True and d['started_date']=='2026-11-02' and d['submitted_date']=='2026-11-02'" "03:30 开考 04:10 交卷、没暂停 → 连续、计趋势、归 11-02 学习日"
c $T2 2026-11-03T04:11:00+08:00 "$B/exams?trend=1" | ok "len(d['items'])==1 and d['items'][0]['submitted_date']=='2026-11-02'" "进 trend=1，submitted_date=开考学习日"
# 3) 暂停 25 小时 → 按暂停那一刻自动交卷
T3=$(login p25); E=$(newexam $T3)
c $T3 "$(at 20)" -XPUT $B/exams/$E/progress -d '{"idempotency_key":"a1","client_seq":1,"answers":[{"question_id":"math1-2024-01","answer":["A"]}]}' >/dev/null
c $T3 "$(at 30)" -XPOST $B/exams/$E/pause >/dev/null
c $T3 "$(at 1440)" $B/exams/$E | ok "d['status']=='paused'" "暂停 23.7 小时：还是 paused"
PAUSE_AT=$(at 30)
c $T3 "$(at 1530)" $B/exams/$E | ok "d['status']=='submitted' and d['auto_submitted'] is True and d['auto_submit_reason']=='paused_too_long' and d['elapsed_seconds']==1800 and d['remaining_seconds']==0 and d['non_continuous'] is True and abs(__import__('datetime').datetime.fromisoformat(d['submitted_at'].replace('Z','+00:00')).timestamp()-__import__('datetime').datetime.fromisoformat('$PAUSE_AT').timestamp())<1 and 'math1-2024-01' in d['progress']['answers']" "暂停 25 小时读：自动交卷，submitted_at=暂停那一刻，elapsed 冻结 30 分钟"
for ep in "POST /exams/$E/resume" "POST /exams/$E/pause" "POST /exams/$E/submit" "POST /exams/$E/abandon"; do
  set -- $ep; code=$(cs $T3 "$(at 1531)" -o /tmp/r15_body -w '%{http_code}' -X$1 $B$2 -d '{}')
  python3 -c "import json,sys;d=json.load(open('/tmp/r15_body'));ok=sys.argv[1]=='409' and d['code']=='exam_auto_submitted' and d['auto_submitted'] is True and d['auto_submit_reason']=='paused_too_long' and d.get('remaining_seconds')==0;print('ok  ' if ok else 'FAIL', '$ep →', sys.argv[1], d.get('code'), d.get('auto_submit_reason'));sys.exit(0 if ok else 1)" "$code"; done
code=$(cs $T3 "$(at 1531)" -o /tmp/r15_body -w '%{http_code}' -XPUT $B/exams/$E/progress -d '{"idempotency_key":"a2","client_seq":2,"answers":[]}')
python3 -c "import json,sys;d=json.load(open('/tmp/r15_body'));ok=sys.argv[1]=='409' and d['auto_submit_reason']=='paused_too_long' and d.get('remaining_seconds')==0;print('ok  ' if ok else 'FAIL','心跳 → 409 paused_too_long、remaining_seconds=0');sys.exit(0 if ok else 1)" "$code"
# 时间到的老规则：auto_submit_reason=time_up
T4=$(login tu); E=$(newexam $T4)
code=$(cs $T4 "$(at 181)" -o /tmp/r15_body -w '%{http_code}' -XPOST $B/exams/$E/pause -d '{}')
python3 -c "import json,sys;d=json.load(open('/tmp/r15_body'));ok=sys.argv[1]=='409' and d['auto_submit_reason']=='time_up';print('ok  ' if ok else 'FAIL','+181 → 409 time_up');sys.exit(0 if ok else 1)" "$code"
# 4) 趋势：trend=1 不含非连续场次
c $T1 "$(at 60)" "$B/exams?trend=1" | ok "len(d['items'])==0" "暂停 16 分钟那场：trend=1 列表里没有"
c $T1 "$(at 60)" "$B/exams" | ok "len(d['items'])==1 and d['items'][0]['non_continuous'] is True and d['items'][0]['counts_in_trend'] is False and d['items'][0]['score'] is not None and all(k in d['items'][0] and d['items'][0][k] is not None for k in ['score','max_score','submitted_at','submitted_date','title','exam','exam_name','year','status'])" "完整历史里还在（标 non_continuous、分数在）"
c $T3 "$(at 1531)" "$B/exams?trend=1" | ok "len(d['items'])==0" "暂停 25 小时那场不进趋势"
c $T3 "$(at 1531)" "$B/exams" | ok "d['items'][0]['remaining_seconds']==0 and d['items'][0]['auto_submit_reason']=='paused_too_long'" "列表：暂停超时自动交卷 remaining_seconds=0"
c $T1b "$(at 60)" "$B/exams?trend=1" | ok "len(d['items'])==1 and d['items'][0]['id']=='$E15' and d['items'][0]['counts_in_trend'] is True" "连续那场进趋势"
echo "R15 OK"
