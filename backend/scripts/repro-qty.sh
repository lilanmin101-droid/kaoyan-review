#!/usr/bin/env bash
# 命令栏数量语义 HTTP 复现（对 :3000）：同句 60 秒内重复 / 「加两道」叠加 / 「今天重做 5 道」设定 / 撤回恢复原数量 / 凌晨日界
set -euo pipefail
B=${B:-http://localhost:3000/api/v1}
TZH=${1:-America/Los_Angeles}
U=qty_$RANDOM$RANDOM
curl -sf -XPOST $B/auth/register -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"secret123\"}" >/dev/null
T=$(curl -sf -XPOST $B/auth/login -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"secret123\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
H=(-H "authorization: Bearer $T" -H 'content-type: application/json' -H "X-Timezone: $TZH")
EXP=$(TZ=$TZH date -d '-4 hours' +%F)  # 学习日：当地 04:00 换天
echo "== X-Timezone: $TZH  今天=$EXP"
for q in 01 02 03 04 05 06 07 08; do
  curl -sf "${H[@]}" -XPOST $B/answers -d "{\"question_id\":\"math1-2024-$q\",\"answer\":[\"Z\"]}" >/dev/null || curl -sf "${H[@]}" -XPOST $B/answers -d "{\"question_id\":\"math1-2024-$q\",\"self_rating\":\"no_idea\"}" >/dev/null
done
# cmd <text> <expect python expr on done d and steps S>
cmd() { curl -sfN "${H[@]}" -XPOST $B/agent/commands -d "{\"text\":\"$1\"}" | grep '^data' | python3 -c "
import sys,json
S=[];A=[];d=None
for l in sys.stdin:
  e=json.loads(l[5:])
  if e['type']=='step': S.append(e['text'])
  if e['type']=='action': A.append(e['action'])
  if e['type']=='done': d=e
print('> $1'); [print('   ·',x) for x in S]; [print('   ✎',a['summary']) for a in A]
print('   = deduped=%s from=%s to=%s date=%s' % (d['deduped'],d.get('quantity_from'),d.get('quantity_to'),d['date']))
assert $2, (d,S)
open('/tmp/qty_last_action','w').write(next((a['id'] for a in A if a['target']['kind']=='plan_task'),''))"; }
qty() { curl -sf "${H[@]}" $B/plans/today | python3 -c "
import sys,json;d=json.load(sys.stdin);ts=[t for t in d['plan']['tasks'] if t['kind']=='redo_wrong' and t['status']!='skipped']
print('   plan:',[(t['title'],len(t['payload'].get('question_ids',[]))) for t in ts]); assert len(ts)==1 and len(ts[0]['payload']['question_ids'])==$1, ts"; }
cmd "重做 3 道错题" "d['quantity_to']==3 and not d['deduped']"; qty 3
cmd "加两道重做错题" "d['quantity_from']==3 and d['quantity_to']==5 and any('已从 3 道加到 5 道' in x for x in S)"; qty 5
A5=$(cat /tmp/qty_last_action)
cmd "加两道重做错题" "d['deduped'] and d['action_count']==0 and any('刚才已从 3 道加到 5 道' in x for x in S)"; qty 5
cmd "今天重做 5 道错题" "d['deduped'] and any('已经有' in x for x in S)"; qty 5
cmd "再来 2 道错题" "d['quantity_from']==5 and d['quantity_to']==7"; qty 7
cmd "今天重做 4 道错题" "d['quantity_from']==7 and d['quantity_to']==4 and any('已从 7 道改为 4 道' in x for x in S)"; qty 4
A4=$(cat /tmp/qty_last_action)
echo "-- 撤回「7→4」→ 回到 7"
curl -sf "${H[@]}" -XPOST $B/agent/actions/$A4/undo >/dev/null; qty 7
echo "-- 撤回后再说同一句 → 重新执行（不算重复）"
cmd "今天重做 4 道错题" "d['quantity_from']==7 and d['quantity_to']==4 and not d['deduped']"; qty 4
echo "-- X-Debug-Now 明天凌晨 00:30（$TZH）说「今天只有一小时」→ 04:00 前还算前一天：计划日期 = 日历今天"
NOWH=$(TZ=$TZH date -d "tomorrow 00:30" +%FT%T%:z); WANT=$(TZ=$TZH date +%F)
curl -sfN "${H[@]}" -H "X-Debug-Now: $NOWH" -XPOST $B/agent/commands -d '{"text":"今天只有一小时"}' | grep '^data' | python3 -c "
import sys,json
for l in sys.stdin:
  e=json.loads(l[5:])
  if e['type']=='step': print('   ·',e['text'])
  if e['type']=='done': print('   = date',e['date']); assert e['date']=='$WANT', e"
echo "OK $TZH"
