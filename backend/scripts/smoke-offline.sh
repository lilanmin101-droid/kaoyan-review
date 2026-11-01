#!/usr/bin/env bash
# 离线题包 + 离线补传冒烟：GET /offline/pack（ETag / since_version → 304）、POST /answers 带 client_id / answered_at / source=offline_pack 补传、
# 重发全 duplicate、和在线作答的判分 / 错题本 / 统计一致、answered_at 夹 7 天、X-Debug-Now 定作答时间
# 用法：BASE=http://localhost:3011/api/v1 bash scripts/smoke-offline.sh（务必对着副库 + AI_FAKE=1 的侧端口跑）
set -euo pipefail
PW="${TEST_PW:-$(openssl rand -hex 12)}"
B=${BASE:-http://localhost:3000/api/v1}
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
ok() { python3 -c "import sys,json;d=json.load(sys.stdin);r=eval(sys.argv[1]);print('ok' if r else 'FAIL', sys.argv[1][:160]);sys.exit(0 if r else print(json.dumps(d,ensure_ascii=False)[:1200]) or 1)" "$1"; }
user() {
  local u="off_$1_$(date +%s%N)"
  curl -sf -XPOST $B/auth/register -H 'content-type: application/json' -d "{\"username\":\"$u\",\"password\":\"$PW\"}" >/dev/null
  curl -sf -XPOST $B/auth/login -H 'content-type: application/json' -d "{\"username\":\"$u\",\"password\":\"$PW\"}" | j "d['access_token']"
}
T1=$(user off); T2=$(user on)
A=(-H "authorization: Bearer $T1" -H 'content-type: application/json' -H 'x-device: phone')
A2=(-H "authorization: Bearer $T2" -H 'content-type: application/json' -H 'x-device: pc')

echo "== 题包：今日完形 + 阅读整篇、每题带答案 / 讲解状态、不含模考"
PACK=$(curl -sf "${A[@]}" $B/offline/pack)
echo "$PACK" | ok "len(d['version'])==16 and d['study_date'] and d['expires_at']>d['generated_at'] and d['relative_day']=='今天'"
echo "$PACK" | ok "{p['section'] for p in d['passages']} >= {'use_of_english'} and any(p['section'] in ('reading_a','reading_b') for p in d['passages'])"
echo "$PACK" | ok "all(q['passage_id'] in {p['id'] for p in d['passages']} for q in d['questions']) and all(set(p['question_ids'])<= {q['id'] for q in d['questions']} for p in d['passages'] if p['pick']!='wrong_redo')"
echo "$PACK" | ok "all(q['explanation_status'] in ('ready','pending') and (q['explanation_status']=='ready')==(q['explanation'] is not None) and (q['solution'] is None)==(q['explanation'] is None) for q in d['questions'])"
echo "$PACK" | ok "all(q['correct_answer'] and q['answer']==q['correct_answer'] for q in d['questions'] if q['objective']) and all(q['section'] not in ('translation','writing_a','writing_b') for q in d['questions'] if q['origin']=='plan')"
echo "$PACK" | ok "'exam' not in d and 'exams' not in d and all(a.startswith('/api/v1/assets/') for a in d['assets']) and len(d['questions'])<200"
echo "$PACK" | ok "set(d['words'])>={'review','new','relearn','study_date'} and d['counts']['words']==len(d['words']['review'])+len(d['words']['new'])+len(d['words']['relearn'])"
V=$(echo "$PACK" | j "d['version']")
test "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" "$B/offline/pack?since_version=$V")" = 304 && echo "ok since_version 相同 → 304"
test "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" -H "If-None-Match: \"$V\"" "$B/offline/pack")" = 304 && echo "ok If-None-Match 相同 → 304"
test "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" "$B/offline/pack?since_version=deadbeefdeadbeef")" = 200 && echo "ok 旧版本 → 200"
curl -sf -D - -o /dev/null "${A[@]}" $B/offline/pack | grep -qi "^etag: \"$V\"" && echo "ok ETag 头 = version（同一天同内容版本不变）"

echo "== 离线做 5 题（answered_at 是过去的客户端时间）→ 补传"
NOW=$(date -u +%s)
ITEMS=$(echo "$PACK" | python3 -c "
import sys,json,datetime as dt
d=json.load(sys.stdin); now=$NOW
qs=[q for q in d['questions'] if q['objective'] and q['type']=='choice'][:5]
# 交替答对 / 答错；时间分别是 3 小时前 ~ 1 小时前
items=[]
for k,q in enumerate(qs):
  right=q['correct_answer'][0]; wrong=[o['key'] for o in q['options'] if o['key']!=right][0]
  at=dt.datetime.fromtimestamp(now-3600*(3-k*0.5),dt.timezone.utc).isoformat()
  items.append({'question_id':q['id'],'answer':[right if k%2==0 else wrong],'client_id':f'off-{now}-{k}','answered_at':at,'source':'offline_pack','pack_version':d['version']})
print(json.dumps({'items':items}))")
R1=$(curl -sf "${A[@]}" -XPOST $B/answers -d "$ITEMS")
echo "$R1" | ok "len(d['items'])==5 and all(i['status']=='recorded' and i['duplicate'] is False and i['source']=='offline_pack' and i['pack_version']=='$V' and i['answered_at_clamped'] is None for i in d['items'])"
echo "$R1" | ok "[i['is_correct'] for i in d['items']]==[True,False,True,False,True] and all(i['wrong_question_id'] for i in d['items'] if not i['is_correct'])"
echo "$ITEMS" | python3 -c "import sys,json;a=json.load(sys.stdin)['items'];r=json.loads(sys.argv[1])['items'];import datetime as dt
f=lambda s: dt.datetime.fromisoformat(s.replace('Z','+00:00'))
ok=all(abs((f(x['answered_at'])-f(y['answered_at'])).total_seconds())<1 for x,y in zip(a,r));print('ok answered_at 按客户端时间存' if ok else 'FAIL answered_at');sys.exit(0 if ok else 1)" "$R1"

echo "== 重发同一批：全 duplicate、结果和第一次一样、不重复计分"
R2=$(curl -sf "${A[@]}" -XPOST $B/answers -d "$ITEMS")
python3 -c "
import json,sys
a=json.loads(sys.argv[1])['items']; b=json.loads(sys.argv[2])['items']
keys=['id','question_id','is_correct','score','points','answered_at','study_date','wrong_question_id','client_id']
r=all(y['status']=='duplicate' and y['duplicate'] is True and all(x[k]==y[k] for k in keys) for x,y in zip(a,b)) and len(b)==5
print('ok 重发 5 条全 duplicate、同 id 同分' if r else 'FAIL 重发'); sys.exit(0 if r else 1)" "$R1" "$R2"
curl -sf "${A[@]}" "$B/me/stats" | ok "d['attempts']==5 and d['correct_attempts']==3"

curl -sf "${A[@]}" $B/offline/pack | ok "d['version']=='$V' and d['counts']['wrong_redos']==0"
echo "== 同样 5 题在线作答（另一个号）：判分、错题本、统计一致"
ONLINE=$(echo "$ITEMS" | python3 -c "import sys,json;print(json.dumps({'items':[{'question_id':i['question_id'],'answer':i['answer'],'client_id':i['client_id']+'-on'} for i in json.load(sys.stdin)['items']]}))")
R3=$(curl -sf "${A2[@]}" -XPOST $B/answers -d "$ONLINE")
python3 -c "
import json,sys
a=json.loads(sys.argv[1])['items']; b=json.loads(sys.argv[2])['items']
r=[(x['question_id'],x['is_correct'],x['score'],x['max_points'],x['wrong_question_status']) for x in a]==[(y['question_id'],y['is_correct'],y['score'],y['max_points'],y['wrong_question_status']) for y in b] and all(y['source']=='online' for y in b)
print('ok 判分/得分/错题状态与在线一致' if r else 'FAIL 不一致', [(x['is_correct'],x['score']) for x in a]); sys.exit(0 if r else 1)" "$R1" "$R3"
W1=$(curl -sf "${A[@]}" "$B/wrong-questions?status=active" | j "sorted(i['question_id'] for i in d['items'])")
W2=$(curl -sf "${A2[@]}" "$B/wrong-questions?status=active" | j "sorted(i['question_id'] for i in d['items'])")
test "$W1" = "$W2" && echo "ok 错题本一致：$W1"
S1=$(curl -sf "${A[@]}" $B/me/stats | j "(d['attempts'],d['judged_attempts'],d['correct_attempts'],d['questions_done'],d['wrong_questions'])")
S2=$(curl -sf "${A2[@]}" $B/me/stats | j "(d['attempts'],d['judged_attempts'],d['correct_attempts'],d['questions_done'],d['wrong_questions'])")
test "$S1" = "$S2" && echo "ok /me/stats 一致：$S1"

echo "== answered_at 夹 [现在−7 天, 现在]；坏的一条不影响别的"
OLD=$(date -u -d '-10 days' +%FT%TZ); FUT=$(date -u -d '+2 days' +%FT%TZ)
curl -sf "${A[@]}" -XPOST $B/answers -d "{\"items\":[{\"question_id\":\"math1-2024-01\",\"answer\":[\"A\"],\"client_id\":\"old-$NOW\",\"answered_at\":\"$OLD\",\"source\":\"offline_pack\"},{\"question_id\":\"math1-2024-02\",\"answer\":[\"A\"],\"client_id\":\"fut-$NOW\",\"answered_at\":\"$FUT\",\"source\":\"offline_pack\"},{\"question_id\":\"no-such-q\",\"answer\":[\"A\"],\"client_id\":\"bad-$NOW\"},{\"question_id\":\"math1-2024-03\",\"answer\":[\"A\"],\"client_id\":\"bad id\"},{\"question_id\":\"math1-2024-04\",\"answer\":[\"A\"],\"source\":\"carrier-pigeon\"}]}" \
  | ok "[i['status'] for i in d['items']]==['recorded','recorded','rejected','rejected','rejected'] and d['items'][0]['answered_at_clamped']['reason']=='too_old' and d['items'][1]['answered_at_clamped']['reason']=='future' and [i['reason'] for i in d['items'][2:]]==['question_not_found','bad_client_id','bad_source']"
test "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" -XPOST $B/answers -d '{"question_id":"math1-2024-01","answer":["A"],"answered_at":"昨天"}')" = 400 && echo "ok 单条坏 answered_at → 400"
python3 -c "import json;print(json.dumps({'items':[{'question_id':'math1-2024-01','answer':['A']}]*201}))" > /tmp/off201.json
test "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" -XPOST $B/answers -d @/tmp/off201.json)" = 400 && echo "ok 超过 200 条 → 400"

echo "== 错题进题包：已在今日文章里的错题不重复带、版本不变；别的错题（math1-2024-01 答错）以 wrong_redo 出现、版本变了"
curl -sf "${A[@]}" $B/offline/pack | ok "(lambda w: 'math1-2024-01' in w and all(q['wrong_question_id'] and q['wrong_status']=='active' for q in d['questions'] if q['origin']=='wrong_redo') and d['version']!='$V' and d['counts']['wrong_redos']==len(w)<=10 and len({q['id'] for q in d['questions']})==len(d['questions']))([q['id'] for q in d['questions'] if q['origin']=='wrong_redo'])"
echo "== X-Debug-Now 定作答时间（非生产）：不带 answered_at → 记到 11-04"
curl -sf "${A[@]}" -H 'X-Debug-Now: 2026-11-04T20:00+08:00' -XPOST $B/answers -d "{\"question_id\":\"math1-2024-05\",\"answer\":[\"A\"],\"client_id\":\"dbg-$NOW\"}" \
  | ok "d['study_date']=='2026-11-04' and d['answered_at'].startswith('2026-11-04T12:00:00')"
curl -sf "${A[@]}" -H 'X-Debug-Now: 2026-11-04T20:00+08:00' -XPOST $B/answers -d "{\"question_id\":\"math1-2024-06\",\"answer\":[\"A\"],\"client_id\":\"dbg2-$NOW\",\"answered_at\":\"2026-11-04T23:00+08:00\"}" \
  | ok "d['answered_at_clamped']['reason']=='future' and d['answered_at'].startswith('2026-11-04T12:00:00')"
curl -sf "${A[@]}" -H 'X-Debug-Now: 2026-11-04T20:00+08:00' "$B/me/stats" | ok "d['today']=='2026-11-04'"
if [ -n "${PROD_BASE:-}" ]; then
  echo "== $PROD_BASE（NODE_ENV=production 或 DEBUG_NOW_DISABLED=1）：X-Debug-Now 不起作用"
  T3=$(B=$PROD_BASE; u="off_p_$(date +%s%N)"; curl -sf -XPOST $PROD_BASE/auth/register -H 'content-type: application/json' -d "{\"username\":\"$u\",\"password\":\"$PW\"}" >/dev/null; curl -sf -XPOST $PROD_BASE/auth/login -H 'content-type: application/json' -d "{\"username\":\"$u\",\"password\":\"$PW\"}" | j "d['access_token']")
  curl -sf -H "authorization: Bearer $T3" -H 'content-type: application/json' -H 'X-Debug-Now: 2026-11-04T20:00+08:00' -XPOST $PROD_BASE/answers -d "{\"question_id\":\"math1-2024-05\",\"answer\":[\"A\"],\"client_id\":\"prod-$NOW\"}" \
    | ok "d['study_date']!='2026-11-04' and abs(__import__('datetime').datetime.fromisoformat(d['answered_at'].replace('Z','+00:00')).timestamp()-$NOW)<120"
fi
echo "ALL OK"
