#!/usr/bin/env bash
# 第 6 轮问题 HTTP 复现：时区、命令去重/数量、单词总数（对 :3000）
set -euo pipefail
B=${B:-http://localhost:3000/api/v1}
TZH=${1:-America/Los_Angeles}
U=r6_$RANDOM$RANDOM
curl -sf -XPOST $B/auth/register -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"secret123\"}" >/dev/null
T=$(curl -sf -XPOST $B/auth/login -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"secret123\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
H=(-H "authorization: Bearer $T" -H 'content-type: application/json' -H "X-Timezone: $TZH")
EXP=$(TZ=$TZH date -d '-4 hours' +%F)  # 学习日：当地 04:00 换天
echo "== X-Timezone: $TZH  期望今天=$EXP"
curl -sf "${H[@]}" $B/me/settings | python3 -c "import sys,json;d=json.load(sys.stdin);print('settings', d);assert d['timezone']=='$TZH' and d['today']=='$EXP'"
curl -sf "${H[@]}" $B/plans/today | python3 -c "import sys,json;d=json.load(sys.stdin);print('plans/today date', d['date']);assert d['date']=='$EXP'"
for q in math1-2024-01 math1-2024-02 math1-2024-03 math1-2024-04; do
  curl -sf "${H[@]}" -XPOST $B/answers -d "{\"question_id\":\"$q\",\"answer\":[\"Z\"]}" >/dev/null || curl -sf "${H[@]}" -XPOST $B/answers -d "{\"question_id\":\"$q\",\"self_rating\":\"no_idea\"}" >/dev/null
done
cmd() { curl -sfN "${H[@]}" -XPOST $B/agent/commands -d "{\"text\":\"$1\"}"; }
echo "-- 「今天只有一小时」"
cmd "今天只有一小时" | grep '^data' | python3 -c "
import sys,json
for l in sys.stdin:
  d=json.loads(l[5:])
  if d['type'] in('step','done'): print(' ',d['type'],d.get('text') or d.get('reply'), d.get('date',''))
  if d['type']=='done': assert d['date']=='$EXP', d"
echo "-- 「帮我加一道重做错题」×2"
for i in 1 2; do cmd "帮我加一道重做错题" | grep '^data' | python3 -c "
import sys,json
for l in sys.stdin:
  d=json.loads(l[5:])
  if d['type'] in('step','done','action'): print(' ',d['type'],d.get('text') or d.get('reply') or d['action']['summary'], 'deduped=%s'%d.get('deduped') if d['type']=='done' else '')"; done
echo "-- 「重做 3 道错题」×2 + 「两道」"
for t in "给我加重做 3 道错题" "给我加重做 3 道错题" "加两道错题重做"; do cmd "$t" | grep '^data' | python3 -c "
import sys,json
for l in sys.stdin:
  d=json.loads(l[5:])
  if d['type']=='done': print(' ','$t','→',d.get('reply'),'deduped=%s'%d['deduped'])"; done
curl -sf "${H[@]}" "$B/plans/today" | python3 -c "
import sys,json;d=json.load(sys.stdin);ts=[t['title'] for t in d['plan']['tasks'] if t['status']!='skipped'];print('  today tasks',ts)
assert len([t for t in ts if '错题' in t])==1, ts"
echo "-- 单词：记住了 → F5 总数不变"
W=$(curl -sf "${H[@]}" $B/words/today)
python3 -c "import sys,json;c=json.loads(sys.argv[1])['counts'];print('  before',c['position'],'/',c['scheduled_today'])" "$W"
ID=$(python3 -c "import sys,json;d=json.loads(sys.argv[1]);print(d['new'][0]['id'])" "$W")
S0=$(python3 -c "import sys,json;print(json.loads(sys.argv[1])['counts']['scheduled_today'])" "$W")
curl -sf "${H[@]}" -XPOST $B/words/$ID/review -d '{"rating":"easy"}' >/dev/null
ID2=$(python3 -c "import sys,json;d=json.loads(sys.argv[1]);print(d['new'][1]['id'])" "$W")
curl -sf "${H[@]}" -XPOST $B/words/$ID2/review -d '{"rating":"again"}' >/dev/null
curl -sf "${H[@]}" $B/words/today | python3 -c "
import sys,json;c=json.load(sys.stdin)['counts'];print('  after F5',c['position'],'/',c['scheduled_today'], c)
assert c['scheduled_today']==$S0 and c['position']==3 and c['done_today']==2"
echo "-- 新用户：「帮我加一道重做错题」→ 1 道；再说一次 → deduped"
U2=r6b_$RANDOM$RANDOM
curl -sf -XPOST $B/auth/register -H 'content-type: application/json' -d "{\"username\":\"$U2\",\"password\":\"secret123\"}" >/dev/null
T2=$(curl -sf -XPOST $B/auth/login -H 'content-type: application/json' -d "{\"username\":\"$U2\",\"password\":\"secret123\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
H=(-H "authorization: Bearer $T2" -H 'content-type: application/json' -H "X-Timezone: $TZH")
for q in math1-2024-01 math1-2024-02 math1-2024-03 math1-2024-04; do
  curl -sf "${H[@]}" -XPOST $B/answers -d "{\"question_id\":\"$q\",\"answer\":[\"Z\"]}" >/dev/null || curl -sf "${H[@]}" -XPOST $B/answers -d "{\"question_id\":\"$q\",\"self_rating\":\"no_idea\"}" >/dev/null
done
for want in False True; do cmd "帮我加一道重做错题" | grep '^data' | python3 -c "
import sys,json
for l in sys.stdin:
  d=json.loads(l[5:])
  if d['type']=='done': print('  done',d['reply'],'deduped=%s'%d['deduped'],d['date']); assert d['deduped']==$want and d['date']=='$EXP', d"; done
curl -sf "${H[@]}" "$B/plans/today" | python3 -c "
import sys,json;d=json.load(sys.stdin);ts=[t for t in d['plan']['tasks'] if t['kind']=='redo_wrong'];print('  redo tasks',[(t['title'],len(t['payload'].get('question_ids',[]))) for t in ts])
assert len(ts)==1 and len(ts[0]['payload']['question_ids'])==1 and '1 道' in ts[0]['title'], ts"
echo "OK $TZH"
