#!/usr/bin/env bash
# 冒烟测试：注册/登录 → 题目 → 作答 → 模考进度（幂等、暂停、续考）→ 交卷 → 错题 → 单词 → 计划 → Agent 命令/撤回 → 掌握度 → 同步/埋点/打卡 → 讲解 SSE → 费曼上传 → PDF
set -euo pipefail
PW="${TEST_PW:-$(openssl rand -hex 12)}"  # 测试号密码：TEST_PW 或每次随机生成（不要写死在仓库里）
B=${BASE:-http://localhost:3000/api/v1}
U="smoke_$(date +%s)"
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
# 断言：表达式为假就失败（打印实际数据）
ok() { python3 -c "import sys,json;d=json.load(sys.stdin);r=eval(sys.argv[1]);print('ok' if r else 'FAIL', sys.argv[1]);sys.exit(0 if r else print(json.dumps(d,ensure_ascii=False)[:800]) or 1)" "$1"; }
echo "== register/login"
curl -sf -XPOST $B/auth/register -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"$PW\"}" >/dev/null
TOKEN=$(curl -sf -XPOST $B/auth/login -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"$PW\"}" | j "d['access_token']")
A=(-H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H 'x-device: smoke-pc')
echo "== questions"; curl -sf "${A[@]}" "$B/questions?exam=math1&year=2024&page_size=3" | j "(d['total'], [q['id'] for q in d['items']])"
curl -sf "${A[@]}" "$B/questions" -G --data-urlencode "kp=高等数学/一元函数积分学" | j "d['total']"
echo "== answer (wrong choice + fill blank right)"
curl -sf "${A[@]}" -XPOST $B/answers -d '{"items":[{"question_id":"math1-2024-01","answer":["A"],"time_spent_seconds":95,"client_id":"c1"},{"question_id":"math1-2024-13","answer":["$-\\frac{1}{\\pi}$"],"client_id":"c2"},{"question_id":"math1-2024-17","self_rating":"approach_ok_calc_wrong","client_id":"c3"}]}' | j "[(i['question_id'], i['is_correct']) for i in d['items']]"
curl -sf "${A[@]}" -XPOST $B/answers -d '{"question_id":"math1-2024-01","answer":["A"],"client_id":"c1"}' | j "'duplicate' if d.get('duplicate') else 'NOT DEDUPED'"
curl -sf "${A[@]}" "$B/answers?exam=math1&year=2024" | j "('latest', d['latest'], sorted((i['question_id'], i['is_correct']) for i in d['items']))"
curl -sf "${A[@]}" "$B/questions?page_size=100" | j "('page_size', d['page_size'], len(d['items']))"
echo "== scoring（证明题整题计分 / 计算题小问估分 / 自评 全对=满分 思路对算错=一半 没思路=0）"
# 跟着数据走（小问分值来自 kp_tags，可能会变）：只断言不变量，不写死具体分数
# 计分方式优先级：kp_tags 明写 score_by_whole / sub_scores 的优先，都没写才按证明题自动识别
# 整题计分的题（从数据里找第一道有小问的）：小问分值一律为 null、顶层 sub_scores 是 null（不是 [null]）
WQJ=$(for y in $(seq 2015 2025); do curl -sf "${A[@]}" "$B/questions?exam=math1&year=$y&page_size=100"; echo; done | python3 -c "
import sys,json
qs=[q for l in sys.stdin.read().splitlines() if l.strip() for q in json.loads(l)['items'] if q['score_by_whole'] and q['sub_questions']]
print(json.dumps(qs[0]))")
WQ=$(echo "$WQJ" | j "d['id']"); WQS=$(echo "$WQJ" | j "d['score']"); echo "整题计分样例：$WQ"
echo "$WQJ" | ok "d['score_by_whole'] is True and d['score_estimated'] is False and all(s['score'] is None for s in d['sub_questions']) and d['sub_scores'] is None"
# 2024 Q18 / Q19：kp_tags 写了 sub_scores → 按小问计分（Q19 虽是证明题，两问独立证明、分开给分）
Q18=$(curl -sf "${A[@]}" "$B/questions/math1-2024-18"); Q19J=$(curl -sf "${A[@]}" "$B/questions/math1-2024-19")
for QJ in "$Q18" "$Q19J"; do echo "$QJ" | ok "d['score_by_whole'] is False and len(d['sub_questions'])>=2 and all(s['score'] is not None for s in d['sub_questions']) and abs(sum(s['score'] for s in d['sub_questions'])-d['score'])<1e-9 and d['sub_scores']==[s['score'] for s in d['sub_questions']] and d.get('sub_scores_source', 'estimated')=='estimated'"; done
S1=$(echo "$Q18" | j "d['sub_questions'][0]['score']"); S2=$(echo "$Q18" | j "d['sub_questions'][1]['score']")
T1=$(echo "$Q19J" | j "d['sub_questions'][0]['score']")
Q21=$(curl -sf "${A[@]}" "$B/questions/math1-2024-21" | j "d['score']")
# 顶层 sub_scores 和 sub_questions[].score 一致；没小问或整题计分是 null
curl -sf "${A[@]}" "$B/questions/math1-2019-22" | ok "d['sub_scores']==[s['score'] for s in d['sub_questions']] and None not in d['sub_scores']"
curl -sf "${A[@]}" "$B/questions?exam=math1&year=2024&page_size=100" | ok "all('score_estimated' in q and 'score_by_whole' in q and (q['sub_scores'] is None)==(q['score_by_whole'] or not q['sub_questions']) and (q['sub_scores'] is None or q['sub_scores']==[s['score'] for s in q['sub_questions']]) for q in d['items']) and all(q['score_by_whole'] or not q['sub_questions'] or all(s['score'] is not None for s in q['sub_questions']) and abs(sum(s['score'] for s in q['sub_questions'])-q['score'])<1e-9 for q in d['items'] if q['type']!='single_choice' and q['sub_questions'])"
# 自评：全对=满分、思路对算错=一半、没思路=0；整题计分的题带 sub_number 也只记一行整题分（sub_number_ignored）
curl -sf "${A[@]}" -XPOST $B/answers -d '{"items":[{"question_id":"math1-2024-18","sub_number":1,"self_rating":"full","client_id":"s1"},{"question_id":"math1-2024-18","sub_number":2,"self_rating":"approach_ok_calc_wrong","client_id":"s2"},{"question_id":"'$WQ'","sub_number":1,"self_rating":"full","client_id":"s3"},{"question_id":"math1-2024-21","self_rating":"no_idea","client_id":"s4"}]}' \
  | ok "len(d['items'])==4 and [(i['points'], i['max_points']) for i in d['items']]==[($S1,$S1),($S2/2,$S2),($WQS,$WQS),(0,$Q21)] and d['items'][2].get('sub_number_ignored') is True and d['items'][2]['sub_number'] is None"
curl -sf "${A[@]}" "$B/answers?question_ids=$WQ" | ok "len([i for i in d['items'] if i['question_id']=='$WQ'])==1 and d['items'][0]['sub_number'] is None and d['items'][0]['points']==d['items'][0]['max_points']"
curl -sf "${A[@]}" "$B/answers?question_ids=math1-2024-17" | ok "d['items'][0]['points']==5 and d['items'][0]['max_points']==10"
echo "== exam"
if ! curl -sf "${A[@]}" "$B/questions/years?exam=math1" | python3 -c "import sys,json;d=json.load(sys.stdin);sys.exit(0 if {'exam':'math1','year':2024} in d['ready'] else 1)"; then
  echo "SKIP exam：2024 数一卷当前不是 ready（题库数据正在改，见 /questions/years），跳过整卷模考这一段"
else
EX=$(curl -sf "${A[@]}" -XPOST $B/exams -d '{"exam":"math1","year":2024,"duration_minutes":180}' | j "d['id']")
# 同一张卷再点「开考」→ 200 + 同一场（resumed=true），不 409；别的卷 → 409 other_exam_active，写明是哪一场
RS=$(curl -s -o /tmp/smoke_resume_$$.json -w '%{http_code}' "${A[@]}" -XPOST $B/exams -d '{"exam":"math1","year":2024,"duration_minutes":180}')
python3 -c "import json,sys;d=json.load(open('/tmp/smoke_resume_$$.json'));ok=sys.argv[1]=='200' and d['id']=='$EX' and d['resumed'] is True and d['status']=='in_progress';print('ok' if ok else 'FAIL', 'same paper -> resumed', sys.argv[1], d.get('id'), d.get('resumed'));sys.exit(0 if ok else 1)" "$RS"
RS=$(curl -s -o /tmp/smoke_resume_$$.json -w '%{http_code}' "${A[@]}" -XPOST $B/exams -d '{"exam":"english1","year":2020}')
python3 -c "import json,sys;d=json.load(open('/tmp/smoke_resume_$$.json'));a=d.get('active_exam') or {};ok=sys.argv[1]=='409' and d['code']=='other_exam_active' and d['active_exam_id']=='$EX' and a.get('id')=='$EX' and a.get('exam')=='math1' and a.get('year')==2024 and a.get('title') and a.get('title') in d['message'];print('ok' if ok else 'FAIL', 'other paper -> 409', sys.argv[1], d.get('code'), a.get('title'));sys.exit(0 if ok else 1)" "$RS"
rm -f /tmp/smoke_resume_$$.json
curl -sf "${A[@]}" -XPUT $B/exams/$EX/progress -d '{"idempotency_key":"k1","client_seq":1,"answers":[{"question_id":"math1-2024-02","answer":["A"],"time_spent_seconds":200}],"current_question_id":"math1-2024-03"}' | j "(d['duplicate'], d['remaining_seconds'], list(d['progress']['answers']))"
curl -sf "${A[@]}" -XPUT $B/exams/$EX/progress -d '{"idempotency_key":"k1","client_seq":1,"answers":[{"question_id":"math1-2024-02","answer":["B"]}]}' | j "('dup=',d['duplicate'], d['progress']['answers']['math1-2024-02']['answer'])"
curl -sf "${A[@]}" -XPUT $B/exams/$EX/progress -d '{"idempotency_key":"k2","client_seq":3,"answers":[{"question_id":"math1-2024-19","answer":[],"time_spent_seconds":2400}],"state":"paused"}' | j "(d['status'], d['remaining_seconds'])"
curl -sf "${A[@]}" -XPUT $B/exams/$EX/progress -d '{"idempotency_key":"k-old","client_seq":2,"answers":[{"question_id":"math1-2024-19","answer":["stale"]}]}' | j "('stale=',d['stale'], d['progress']['answers']['math1-2024-19']['answer'])"
curl -sf "${A[@]}" $B/exams/active | j "(d['exam']['id']=='$EX', d['exam']['status'])"
curl -sf "${A[@]}" -XPUT $B/exams/$EX/progress -d '{"idempotency_key":"k3","client_seq":4,"state":"running"}' | j "d['status']"
curl -sf "${A[@]}" -XPOST $B/exams/$EX/submit -d '{"self_ratings":{"math1-2024-17":"full","math1-2024-18":{"1":"full","2":"approach_ok_calc_wrong"},"math1-2024-19":{"1":"full","2":"no_idea"},"math1-2024-21":"no_idea"}}' \
  | ok "(lambda p: d['status']=='submitted' and p['math1-2024-17']['got']==p['math1-2024-17']['score'] and p['math1-2024-18']['got']==$S1+$S2/2 and [x['got'] for x in p['math1-2024-18']['sub_scores']]==[$S1,$S2/2] and abs(sum(x['score'] for x in p['math1-2024-18']['sub_scores'])-p['math1-2024-18']['score'])<1e-9 and p['math1-2024-19']['got']==$T1 and not p['math1-2024-19']['score_by_whole'] and abs(sum(x['score'] for x in p['math1-2024-19']['sub_scores'])-p['math1-2024-19']['score'])<1e-9 and p['math1-2024-21']['got']==0)({x['question_id']:x for x in d['result']['per_question']})"
curl -sf "${A[@]}" $B/exams/$EX | j "(d['result']['score'], d['result']['max_score'], d['result']['conclusions'][0])"
curl -sf "${A[@]}" $B/exams/active | j "d"
fi
# 整题计分的题在模考里：按小问自评 → 400；整题自评一半 → 得一半、没有 sub_scores
EW=$(curl -sf "${A[@]}" -XPOST $B/exams -d '{"question_ids":["'$WQ'"],"duration_minutes":30,"include_unreviewed":true}' | j "d['id']")
test "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" -XPOST $B/exams/$EW/submit -d '{"self_ratings":{"'$WQ'":{"1":"full"}}}')" = 400 && echo "ok 整题计分的题按小问自评 → 400"
curl -sf "${A[@]}" -XPOST $B/exams/$EW/submit -d '{"self_ratings":{"'$WQ'":"approach_ok_calc_wrong"}}' | ok "(lambda p: p['got']==$WQS/2 and p['score_by_whole'] and not p.get('sub_scores'))(d['result']['per_question'][0])"
# 开考 2 分钟内一道没答就放弃 → 整场删除（discarded=true，历史 / 进行中都没有）；答过 / 超过 2 分钟（X-Debug-Now +3 分钟）→ 照旧 abandoned
echo "== exam abandon discard"
ED=$(curl -sf "${A[@]}" -XPOST $B/exams -d '{"question_ids":["'$WQ'"],"duration_minutes":30,"include_unreviewed":true}' | j "d['id']")
curl -sf "${A[@]}" -XPOST $B/exams/$ED/abandon | ok "d['discarded'] is True and d['status']=='discarded' and d['id']=='$ED'"
test "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" $B/exams/$ED)" = 404 && echo "ok discarded exam → 404" || { echo "FAIL discarded exam still readable"; exit 1; }
curl -sf "${A[@]}" "$B/exams?limit=50" | ok "all(i['id']!='$ED' for i in d['items'])"
curl -sf "${A[@]}" $B/exams/active | ok "d['exam'] is None"
test "$(psql "${DATABASE_URL:-$(grep -E '^DATABASE_URL=' .env 2>/dev/null | cut -d= -f2-)}" -Atc "select count(*) from exams where id='$ED'")" = 0 && echo "ok discarded exam row deleted" || { echo "FAIL discarded exam row still there"; exit 1; }
EK=$(curl -sf "${A[@]}" -XPOST $B/exams -d '{"question_ids":["'$WQ'"],"duration_minutes":30,"include_unreviewed":true}' | j "d['id']")
curl -sf "${A[@]}" -XPUT $B/exams/$EK/progress -d '{"idempotency_key":"d1","client_seq":1,"answers":[{"question_id":"'$WQ'","answer":["x"]}]}' >/dev/null
curl -sf "${A[@]}" -XPOST $B/exams/$EK/abandon | ok "d['discarded'] is False and d['status']=='abandoned' and d['id']=='$EK'"
EL=$(curl -sf "${A[@]}" -XPOST $B/exams -d '{"question_ids":["'$WQ'"],"duration_minutes":30,"include_unreviewed":true}' | j "d['id']")
LATER=$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=3)).isoformat())")
curl -sf "${A[@]}" -H "x-debug-now: $LATER" -XPOST $B/exams/$EL/abandon | ok "d['discarded'] is False and d['status']=='abandoned'"
curl -sf "${A[@]}" "$B/exams?limit=50" | ok "{'$EK','$EL'} <= {i['id'] for i in d['items']}"
# 开考时间也按 X-Debug-Now（第 13 轮）：started_at = 调试时刻；+60 秒读剩余时间少 60 秒；不带调试头（真实时间早于开考）不倒扣；+121 秒不答放弃 → abandoned，abandoned_at 也是调试时刻，单次心跳封顶 120 秒
T0=$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=3)).replace(microsecond=0).isoformat().replace('+00:00','Z'))")
read T60 T121 <<<"$(python3 -c "import datetime;t=datetime.datetime.fromisoformat('$T0'.replace('Z','+00:00'));print(*[(t+datetime.timedelta(seconds=s)).isoformat().replace('+00:00','Z') for s in (60,121)])")"
EN=$(curl -sf "${A[@]}" -H "x-debug-now: $T0" -XPOST $B/exams -d '{"question_ids":["'$WQ'"],"duration_minutes":30,"include_unreviewed":true}' | j "d['id']")
curl -sf "${A[@]}" -H "x-debug-now: $T0" $B/exams/$EN | ok "d['started_at'].startswith('$T0'[:19]) and d['remaining_seconds']==1800 and d['server_time'].startswith('$T0'[:19])"
curl -sf "${A[@]}" -H "x-debug-now: $T60" $B/exams/$EN | ok "d['elapsed_seconds']==60 and d['remaining_seconds']==1740"
curl -sf "${A[@]}" $B/exams/$EN | ok "d['elapsed_seconds']==0 and d['remaining_seconds']==1800"
curl -sf "${A[@]}" -H "x-debug-now: $T121" -XPOST $B/exams/$EN/abandon | ok "d['discarded'] is False and d['status']=='abandoned' and d['abandoned_at'].startswith('$T121'[:19]) and d['elapsed_seconds']==121"
# 第 14 轮：墙上时钟——不发心跳 30 分钟后剩 150 分钟；暂停不计时；181 分钟后读 → 已自动交卷（auto_submitted），再发心跳 → 409 exam_auto_submitted
echo "== exam wall clock / pause / auto submit"
TW=$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=5)).replace(microsecond=0).isoformat().replace('+00:00','Z'))")
at() { python3 -c "import datetime;t=datetime.datetime.fromisoformat('$TW'.replace('Z','+00:00'));print((t+datetime.timedelta(minutes=$1)).isoformat().replace('+00:00','Z'))"; }
EWC=$(curl -sf "${A[@]}" -H "x-debug-now: $TW" -XPOST $B/exams -d '{"question_ids":["'$WQ'"],"duration_minutes":180,"include_unreviewed":true,"kind":"paper"}' | j "d['id']")
curl -sf "${A[@]}" -H "x-debug-now: $(at 30)" $B/exams/$EWC | ok "d['remaining_seconds']==9000 and d['pause_count']==0 and d['paused_seconds']==0 and d['auto_submitted'] is False"
curl -sf "${A[@]}" -H "x-debug-now: $(at 40)" -XPOST $B/exams/$EWC/pause | ok "d['status']=='paused' and d['pause_count']==1"
curl -sf "${A[@]}" -H "x-debug-now: $(at 50)" -XPOST $B/exams/$EWC/resume | ok "d['status']=='in_progress' and d['paused_seconds']==600 and d['remaining_seconds']==8400"
curl -sf "${A[@]}" -H "x-debug-now: $(at 60)" -XPUT $B/exams/$EWC/progress -d '{"idempotency_key":"w1","client_seq":1,"answers":[{"question_id":"'$WQ'","answer":["wall"]}]}' | ok "d['remaining_seconds']==7800"
curl -sf "${A[@]}" -H "x-debug-now: $(at 191)" $B/exams/$EWC | ok "d['status']=='submitted' and d['auto_submitted'] is True and d['result']['auto_submitted'] is True and d['result']['pause_count']==1 and d['result']['paused_seconds']==600 and d['elapsed_seconds']==10800 and d['remaining_seconds']==0 and d['progress']['answers']['$WQ']['answer']==['wall']"
curl -s "${A[@]}" -H "x-debug-now: $(at 192)" -XPUT $B/exams/$EWC/progress -d '{"idempotency_key":"w2","client_seq":2}' | ok "d['code']=='exam_auto_submitted' and d['exam_id']=='$EWC' and d['status']=='submitted'"
curl -s "${A[@]}" -H "x-debug-now: $(at 192)" -XPOST $B/exams/$EWC/submit -d '{}' | ok "d['code']=='exam_auto_submitted'"
# 不发心跳、不读，181 分钟后定时扫 / 下次心跳也会自动交
EWD=$(curl -sf "${A[@]}" -H "x-debug-now: $TW" -XPOST $B/exams -d '{"question_ids":["'$WQ'"],"duration_minutes":180,"include_unreviewed":true}' | j "d['id']")
curl -s "${A[@]}" -H "x-debug-now: $(at 181)" -XPUT $B/exams/$EWD/progress -d '{"idempotency_key":"w3","client_seq":1,"answers":[{"question_id":"'$WQ'","answer":["late"]}]}' | ok "d['code']=='exam_auto_submitted'"
curl -sf "${A[@]}" -H "x-debug-now: $(at 182)" $B/exams/$EWD | ok "d['auto_submitted'] is True and d['submitted_at'].startswith('$(at 180)'[:16]) and not d['progress']['answers']"
echo "== wrong questions"; curl -sf "${A[@]}" $B/wrong-questions | ok "all('images' in i and 'sub_questions' in i and 'score_estimated' in i and 'score_by_whole' in i for i in d['items'])"
echo "== words"; curl -sf "${A[@]}" $B/words/today | ok "all(w['audio_url_us'].endswith('/audio?accent=us') and w['audio_url_uk'].endswith('/audio?accent=uk') for w in d['new']+d['review']) and {'new_target','new_done_today','reviewed_today'} <= set(d['counts'])"
W=$(curl -sf "${A[@]}" $B/words/today | j "d['new'][0]['id']");
# 发音：不带登录；第一次可能联网（失败时 502 JSON + fallback），第二次必须命中本地缓存
C1=$(curl -s -o /tmp/smoke_audio.mp3 -w '%{http_code}' "${B}/words/$W/audio?accent=us")
if [ "$C1" = 200 ]; then
  curl -s -D - -o /dev/null "${B}/words/$W/audio?accent=us" | grep -qi '^x-audio-cache: hit' && echo "ok audio 200 + cache hit ($(wc -c </tmp/smoke_audio.mp3) bytes)" || { echo "FAIL audio cache"; exit 1; }
else
  grep -q '"fallback":"speech_synthesis"' /tmp/smoke_audio.mp3 && [ "$C1" = 502 ] && echo "ok audio upstream down → 502 fallback" || { echo "FAIL audio $C1"; exit 1; }
fi
test "$(curl -s -o /dev/null -w '%{http_code}' "${B}/words/$W/audio?accent=fr")" = 400 && echo "ok audio bad accent → 400"
 curl -sf "${A[@]}" -XPOST $B/words/$W/review -d '{"rating":"good"}' | j "(d['state'], d['next_due_in_days'])"
echo "== plans"; T=$(date +%F); curl -sf "${A[@]}" -XPOST $B/plans -d "{\"plan_date\":\"$T\",\"tasks\":[{\"kind\":\"practice\",\"title\":\"2024 数一选择题\",\"estimated_minutes\":40},{\"kind\":\"words\",\"title\":\"背 20 个词\"}]}" | j "d['progress']"
curl -sf "${A[@]}" $B/plans/today | j "(d['date'], len(d['plan']['tasks']))"
echo "== agent command (SSE)"; curl -sfN "${A[@]}" -XPOST $B/agent/commands -d '{"text":"这周把极限练透"}' | grep '^event:' | tr '\n' ' '; echo
ACT=$(curl -sf "${A[@]}" $B/agent/actions | j "d['items'][0]['id']"); curl -sf "${A[@]}" $B/agent/actions | j "(d['items'][0]['summary'], d['items'][0]['target'])"
curl -sf "${A[@]}" -XPOST $B/agent/actions/$ACT/undo | j "(d['undone_at'] is not None, d['undoable'])"
curl -s -o /dev/null -w "second undo -> %{http_code}\n" "${A[@]}" -XPOST $B/agent/actions/$ACT/undo
echo "== mastery"; curl -sf "${A[@]}" $B/mastery/tree | j "(d['total_points'], [(s['name'], s['score'], s['practiced'], s['total']) for s in d['subjects']])"
echo "== hint/explain"; curl -sf "${A[@]}" "$B/questions/math1-2024-17/hint?step=2" | j "(d['step'], d['total_steps'], d['has_more'], d['source'])"
# 现在 22 题都有专家讲解；没有讲解时的 pending 路径见 npm run test:sources
X=$(curl -sf "${A[@]}" "$B/questions/math1-2024-01/hint?step=2"); echo "$X" | grep -qE '"source":"expert"|"source":"pending".*思路生成中' && echo "hint q01 OK" || { echo "FAIL hint q01: $X"; exit 1; }
curl -sfN "${A[@]}" -XPOST $B/questions/math1-2024-01/explain -d '{"selectedText":"f(x) 为奇函数"}' | grep '^event:' | tr '\n' ' '; echo
# 讲解来源：q19 = expert（行业专家参考解答（非官方解析））；q01 = expert 或 pending；GET 版也要通
X=$(curl -sfN "${A[@]}" -XPOST $B/questions/math1-2024-19/explain -d '{}' | grep '"type":"done"'); echo "$X" | grep -q '"status":"expert","source":"expert"' && echo "explain q19 expert OK" || { echo "FAIL explain q19 expert: $X"; exit 1; }
X=$(curl -sfN "${A[@]}" "$B/questions/math1-2024-01/explain?mode=full" | grep '"type":"done"'); echo "$X" | grep -qE '"source":"expert"|"status":"pending".*"source":"pending".*讲解生成中' && echo "explain q01 OK (GET)" || { echo "FAIL explain q01: $X"; exit 1; }
echo "== explanation verified（reviews/explanations_<exam>_<year>.jsonl 最新一条）"
curl -sf "${A[@]}" "$B/questions/math1-2024-19" | ok "d['explanation']['source']=='expert' and d['explanation']['verified'] is True and d['explanation']['review']['verdict']=='pass'"
curl -sf "${A[@]}" "$B/questions/math1-2024-19/hint" | ok "d['source']=='expert' and d['verified'] is True and d['source_label']=='行业专家参考解答（非官方解析）'"
curl -sf "${A[@]}" "$B/questions/math1-2023-01/hint" | ok "d['source']=='official' and d['verified'] is True and d['source_label']=='官方解析'"
# verified 取决于 reviews/ 里的最新复核（用户 06:14 PT 已复核 2023-02），这里只校验结构和标签一致
curl -sf "${A[@]}" "$B/questions/math1-2023-02/hint" | ok "d['source']=='expert' and isinstance(d['verified'], bool)"
curl -sf "${A[@]}" "$B/questions/math1-2023-17/hint" | ok "d['source']=='official' and d['source_label']==('官方解析' if d['verified'] else '官方解析（未核对）')"
X=$(curl -sfN "${A[@]}" "$B/questions/math1-2023-04/explain" | grep -E '"type":"(meta|done)"' | tr -d '\n'); grep -q '"type":"meta".*"source":"official","verified":true.*"type":"done","verified":true,"status":"official"' <<<"$X" && echo "ok explain 2023-04 official verified (meta+done)" || { echo "FAIL explain verified: $X"; exit 1; }
curl -sf "${A[@]}" $B/wrong-questions | ok "len(d['items'])>0 and all('verified' in i['explanation'] and 'source' in i['explanation'] for i in d['items'])"
echo "== sync/events/checkins"
curl -sf "${A[@]}" -XPOST $B/sync -d '{"device":"phone","changes":[{"entity":"answer_record","client_id":"p1","data":{"question_id":"math1-2024-03","answer":["A"]}}]}' | j "d['results']"
curl -sf "${A[@]}" "$B/sync?cursor=0&device=phone" | j "(len(d['changes']), d['next_cursor'])"
curl -sf "${A[@]}" -XPOST $B/events -d '{"device":"pc","events":[{"client_id":"e1","name":"question_view","props":{"q":"math1-2024-01"}},{"client_id":"e1","name":"question_view"}]}' | j "d"
curl -sf "${A[@]}" -XPOST $B/checkins -d '{"minutes":120}' | j "(d['day'], d['streak_days'])"
echo "== feynman upload"; head -c 2048 /dev/urandom > /tmp/smoke.webm
curl -sf -H "authorization: Bearer $TOKEN" -XPOST $B/feynman -F "kp_path=高等数学/函数、极限、连续/函数极限" -F "audio=@/tmp/smoke.webm;type=audio/webm" | j "(d['mime_type'], d['audio_bytes'], d['verdict']['mock'])"
curl -s -o /dev/null -w "wav rejected -> %{http_code}\n" -H "authorization: Bearer $TOKEN" -XPOST $B/feynman -F "kp_path=高等数学/函数、极限、连续/函数极限" -F "audio=@/tmp/smoke.webm;type=audio/wav"
echo "== pdf"; curl -sf "${A[@]}" "$B/wrong-questions/export.pdf?with_answer=true" -o /tmp/wrong.pdf && file /tmp/wrong.pdf 2>/dev/null || head -c 8 /tmp/wrong.pdf; echo
H=$(curl -sf "${A[@]}" "$B/wrong-questions/export.pdf?with_answer=true&format=html"); grep -q "行业专家参考解答（非官方解析）" <<<"$H" && echo "pdf expert label OK" || { echo "FAIL pdf expert label"; exit 1; }
echo "== 11-01 联调修复（新用户，互不干扰）"
DBURL=${DATABASE_URL:-$(grep -E '^DATABASE_URL=' .env 2>/dev/null | cut -d= -f2-)}
PSQL() { psql "$DBURL" -qtAX -c "$1"; }
U2="smoke2_$(date +%s)"
curl -sf -XPOST $B/auth/register -H 'content-type: application/json' -d "{\"username\":\"$U2\",\"password\":\"$PW\"}" >/dev/null
T2=$(curl -sf -XPOST $B/auth/login -H 'content-type: application/json' -d "{\"username\":\"$U2\",\"password\":\"$PW\"}" | j "d['access_token']")
A2=(-H "authorization: Bearer $T2" -H 'content-type: application/json')
UID2=$(PSQL "SELECT id FROM users WHERE username='$U2'")
TODAY=$(TZ=${APP_TZ:-Asia/Shanghai} date -d '-4 hours' +%F); TMR=$(date -d "$TODAY +1 day" +%F)  # 学习日：当地 04:00 换天
echo "-- 5) 未核对年份默认不出；/questions/years"
curl -sf "${A2[@]}" "$B/questions/years?exam=math1" | ok "(lambda m: m[2023]['ready'] and m[2024]['ready'] and all(not r['ready'] for y,r in m.items() if r['confirmed']<r['total']) and all(k in m[2024] for k in ('total','confirmed','pending','suspect')))({r['year']:r for r in d['items']})"
curl -sf "${A2[@]}" "$B/questions?exam=math1&page_size=100" | ok "all(q['review']['status']=='confirmed' for q in d['items'])"
NU=$(PSQL "SELECT count(*) FROM questions WHERE exam='math1' AND review_status<>'confirmed'")
if [ "$NU" -gt 0 ]; then
  UY=$(PSQL "SELECT year FROM questions WHERE exam='math1' AND review_status<>'confirmed' ORDER BY year DESC LIMIT 1")
  curl -sf "${A2[@]}" "$B/questions?exam=math1&year=$UY&page_size=100" | ok "all(q['review']['status']=='confirmed' for q in d['items'])"
  curl -sf "${A2[@]}" "$B/questions?exam=math1&year=$UY&page_size=100&include_unreviewed=1" | ok "any(q['review']['status']!='confirmed' for q in d['items'])"
  test "$(curl -s -o /dev/null -w '%{http_code}' "${A2[@]}" -XPOST $B/exams -d "{\"exam\":\"math1\",\"year\":$UY}")" = 422 && echo "ok 未核对完的年份不能开模考 → 422 missing_numbers"
fi
echo "-- 3) 错题状态：做错 active → 交卷做对 mastered → 到期再做对 archived → 再错 active、wrong_count+1"
Q1ANS=$(curl -sf "${A2[@]}" "$B/questions/math1-2024-01?include_answer=true" | j "json.dumps(d['answer'])")
WRONG=$(python3 -c "import json,sys;a=json.loads(sys.argv[1]);print(json.dumps(['B' if a!=['B'] else 'C']))" "$Q1ANS")
curl -sf "${A2[@]}" -XPOST $B/answers -d "{\"question_id\":\"math1-2024-01\",\"answer\":$WRONG,\"client_id\":\"w1\"}" | ok "d['is_correct'] is False and d['wrong_question_status']=='active'"
curl -sf "${A2[@]}" $B/wrong-questions | ok "d['status']=='active' and d['counts']['active']==1 and [i['question_id'] for i in d['items']]==['math1-2024-01']"
EX2=$(curl -sf "${A2[@]}" -XPOST $B/exams -d '{"exam":"math1","year":2024}' | j "d['id']")
curl -sf "${A2[@]}" -XPUT $B/exams/$EX2/progress -d "{\"idempotency_key\":\"a1\",\"client_seq\":1,\"answers\":[{\"question_id\":\"math1-2024-01\",\"answer\":$Q1ANS}]}" >/dev/null
curl -sf "${A2[@]}" -XPOST $B/exams/$EX2/submit -d '{}' >/dev/null
# 交卷后马上读错题本（以前偶发 502）：连发 5 次都要 200
for i in 1 2 3 4 5; do curl -sf "${A2[@]}" $B/wrong-questions >/dev/null || { echo "FAIL wrong-questions after submit"; exit 1; }; done; echo "ok 交卷后立刻读错题本 ×5"
# 交卷时没作答的客观题也算错进错题本（exams.service 06:4x PT 的新规则）：先核对，再清掉，后面只盯 01 这一题
curl -sf "${A2[@]}" $B/wrong-questions | ok "d['counts']['active']>=1 and 'math1-2024-01' not in [i['question_id'] for i in d['items']] and all(i['source']=='exam' for i in d['items'] if 'source' in i)"
PSQL "DELETE FROM wrong_questions WHERE user_id='$UID2' AND question_id<>'math1-2024-01'" >/dev/null
# 交卷时没作答的客观题也算错进错题本（exams.service 06:4x PT 改的规则），这里只看 01 已掌握
curl -sf "${A2[@]}" $B/wrong-questions | ok "'math1-2024-01' not in [i['question_id'] for i in d['items']] and d['counts']['mastered']==1"
curl -sf "${A2[@]}" "$B/wrong-questions?status=mastered" | ok "d['items'][0]['status']=='mastered' and d['items'][0]['due_at'] and d['items'][0]['review_due'] is False"
curl -sf "${A2[@]}" "$B/wrong-questions?status=due" | ok "d['items']==[]"
PSQL "UPDATE wrong_questions SET due_at=now()-interval '1 minute' WHERE user_id='$UID2' AND question_id='math1-2024-01'" >/dev/null
curl -sf "${A2[@]}" "$B/wrong-questions?status=due" | ok "len(d['items'])==1 and d['counts']['due']==1"
curl -sf "${A2[@]}" $B/plans/today | ok "d['review_due']['count']==1 and d['review_due']['items'][0]['question_id']=='math1-2024-01'"
curl -sf "${A2[@]}" -XPOST $B/answers -d "{\"question_id\":\"math1-2024-01\",\"answer\":$Q1ANS,\"client_id\":\"r1\"}" | ok "d['wrong_question_status']=='archived'"
curl -sf "${A2[@]}" "$B/wrong-questions?status=archived" | ok "len(d['items'])==1"
curl -sf "${A2[@]}" -XPOST $B/answers -d "{\"question_id\":\"math1-2024-01\",\"answer\":$WRONG,\"client_id\":\"w2\"}" >/dev/null
curl -sf "${A2[@]}" $B/wrong-questions | ok "(lambda x: len(x)==1 and x[0]['status']=='active' and x[0]['wrong_count']==2)([i for i in d['items'] if i['question_id']=='math1-2024-01'])"
# 交卷时没作答的客观题也进了错题本（source=exam），这里只核 01 这一条
curl -sf "${A2[@]}" "$B/wrong-questions?status=all" | ok "len([i for i in d['items'] if i['question_id']=='math1-2024-01'])==1 and d['counts']['all']==len(d['items'])"
# 大题按小问自评：两问都全对才算掌握
curl -sf "${A2[@]}" -XPOST $B/answers -d '{"question_id":"math1-2024-18","sub_number":2,"self_rating":"no_idea","client_id":"s18a"}' >/dev/null
curl -sf "${A2[@]}" -XPOST $B/answers -d '{"question_id":"math1-2024-18","sub_number":1,"self_rating":"full","client_id":"s18b"}' | ok "d['wrong_question_status'] is None"
curl -sf "${A2[@]}" -XPOST $B/answers -d '{"question_id":"math1-2024-18","sub_number":2,"self_rating":"full","client_id":"s18c"}' | ok "d['wrong_question_status']=='mastered'"
echo "-- 1) 命令栏「今天只有一小时」改今天（$TODAY），放不下的明确挪到明天"
curl -sf "${A2[@]}" -XPOST $B/plans -d "{\"plan_date\":\"$TODAY\",\"tasks\":[{\"kind\":\"practice\",\"title\":\"2023 数一选择题\",\"estimated_minutes\":40},{\"kind\":\"words\",\"title\":\"背 20 个词\",\"estimated_minutes\":40}]}" >/dev/null
S=$(curl -sfN "${A2[@]}" -XPOST $B/agent/commands -d '{"text":"今天只有一小时"}')
grep -q "今天（${TODAY:5}）只有 60 分钟" <<<"$S" && grep -q "挪到明天（${TMR:5}）" <<<"$S" && grep -q '"deduped":false' <<<"$S" && echo "ok step 写明今天 + 挪到明天" || { echo "FAIL today steps: $S"; exit 1; }
curl -sf "${A2[@]}" $B/plans/today | ok "d['date']=='$TODAY' and [t['title'] for t in d['plan']['tasks'] if t['kind']=='redo_wrong' and t['status']=='todo']==['重做 1 道错题'] and sum((t['estimated_minutes'] or 0) for t in d['plan']['tasks'] if t['status']=='todo')<=60"
curl -sf "${A2[@]}" "$B/plans?from=$TMR&to=$TMR" | ok "[t['title'] for t in d['items'][0]['tasks']]==['背 20 个词'] and not any(t['kind']=='redo_wrong' for t in d['items'][0]['tasks'])"
N1=$(curl -sf "${A2[@]}" "$B/agent/actions?limit=200" | j "len(d['items'])")
echo "-- 2) 同一意图连发两次：按意图去重（不看原句），不重复执行，step 说已经有了"
S=$(curl -sfN "${A2[@]}" -XPOST $B/agent/commands -d '{"text":"今天 只有一小时。"}'); grep -q '"deduped":true' <<<"$S" && grep -q '已经有' <<<"$S" && echo "ok 重复意图去重" || { echo "FAIL dedupe: $S"; exit 1; }
N2=$(curl -sf "${A2[@]}" "$B/agent/actions?limit=200" | j "len(d['items'])"); test "$N1" = "$N2" && echo "ok 去重不新增 action ($N2)" || { echo "FAIL actions $N1 -> $N2"; exit 1; }
# 换个说法（不算同一句）也不会再加一条「重做 1 道错题」
S=$(curl -sfN "${A2[@]}" -XPOST $B/agent/commands -d '{"text":"今天只有一个小时"}'); grep -q "没有重复添加" <<<"$S" && echo "ok 等价任务不重复加" || { echo "FAIL dedupe task: $S"; exit 1; }
curl -sf "${A2[@]}" $B/plans/today | ok "len([t for t in d['plan']['tasks'] if t['kind']=='redo_wrong'])==1"
curl -sf "${A2[@]}" "$B/plans?from=$TMR&to=$TMR" | ok "len(d['items'][0]['tasks'])==1"
echo "-- 手滑 → careless，不扣掌握度，可撤回"
KP=$(PSQL "SELECT knowledge_points[1] FROM questions WHERE id='math1-2024-01'")
M0=$(PSQL "SELECT score FROM mastery WHERE user_id='$UID2' AND kp_path='$KP'")
S=$(curl -sfN "${A2[@]}" -XPOST $B/agent/commands -d '{"text":"这题我会，是手滑","question_id":"math1-2024-01"}'); grep -q '"tool":"markCareless"' <<<"$S" && echo "ok careless step" || { echo "FAIL careless: $S"; exit 1; }
curl -sf "${A2[@]}" $B/wrong-questions | ok "d['items'][0]['error_type']=='careless'"
M1=$(PSQL "SELECT score FROM mastery WHERE user_id='$UID2' AND kp_path='$KP'")
python3 -c "import sys;a,b=map(float,sys.argv[1:]);print('ok 掌握度退回', a,'->',b) if b>a else sys.exit(print('FAIL mastery',a,b) or 1)" "$M0" "$M1"
CA=$(curl -sf "${A2[@]}" "$B/agent/actions?limit=5" | j "[a['id'] for a in d['items'] if a['tool']=='markCareless'][0]")
curl -sf "${A2[@]}" -XPOST $B/agent/actions/$CA/undo >/dev/null
curl -sf "${A2[@]}" $B/wrong-questions | ok "d['items'][0]['error_type']!='careless'"
test "$(PSQL "SELECT score FROM mastery WHERE user_id='$UID2' AND kp_path='$KP'")" = "$M0" && echo "ok 撤回后掌握度恢复" || { echo "FAIL mastery undo"; exit 1; }
echo "-- 主动消息：一句话 headline + 折叠 details；「别管我」/连续 2 次没看 → 少打扰；重新互动 → 恢复"
curl -sf "${A2[@]}" -XPOST $B/agent/jobs/nightly/run >/dev/null
curl -sf "${A2[@]}" $B/agent/messages | ok "(lambda m: m['kind']=='review' and len(m['headline'])<=40 and m['details'] and m['seen_at'] is None and m['delivered_at'])(d['items'][0]) and d['proactive']['mode']=='normal'"
S=$(curl -sfN "${A2[@]}" -XPOST $B/agent/commands -d '{"text":"别管我"}'); grep -q '"tool":"setProactive"' <<<"$S" && echo "ok 别管我 → setProactive" || { echo "FAIL backoff: $S"; exit 1; }
curl -sf "${A2[@]}" $B/agent/messages | ok "d['proactive']['mode']=='reduced' and d['proactive']['nightly_every_days']==3"
curl -sf "${A2[@]}" -XPOST "$B/agent/jobs/nightly/run?respect_backoff=1" | ok "d['skipped'] is True and '少打扰' in d['reason']"
curl -sf "${A2[@]}" -XPOST "$B/agent/jobs/weekly/run?respect_backoff=1" | ok "d['skipped'] is False"
curl -sfN "${A2[@]}" -XPOST $B/agent/commands -d '{"text":"帮我看看今天还差什么"}' >/dev/null
curl -sf "${A2[@]}" $B/agent/messages | ok "d['proactive']['mode']=='normal'"
PSQL "DELETE FROM daily_tips WHERE user_id='$UID2' AND kind='review'; INSERT INTO daily_tips(user_id,tip_date,kind,text,headline,delivered_at) VALUES ('$UID2','$TODAY'::date-2,'review','x','x',now()-interval '2 days'),('$UID2','$TODAY'::date-1,'review','y','y',now()-interval '1 day')" >/dev/null
curl -sf "${A2[@]}" -XPOST "$B/agent/jobs/nightly/run?respect_backoff=1" | ok "d['skipped'] is True and d['actions'][0]['tool']=='setProactive'"
curl -sf "${A2[@]}" "$B/agent/actions?limit=3" | ok "d['items'][0]['tool']=='setProactive' and d['items'][0]['undoable'] and d['items'][0]['trigger']=='nightly'"
MID=$(curl -sf "${A2[@]}" $B/agent/messages | j "d['items'][0]['id']")
curl -sf "${A2[@]}" -XPOST $B/agent/messages/$MID/seen | ok "d['seen_at'] and d['proactive_restored'] is True"
echo "== 我的：目标 / 教练频率 / 免打扰 / 学习统计"
U3=me$RANDOM; curl -sf -XPOST $B/auth/register -H 'content-type: application/json' -d "{\"username\":\"$U3\",\"password\":\"$PW\"}" >/dev/null
T3=$(curl -sf -XPOST $B/auth/login -H 'content-type: application/json' -d "{\"username\":\"$U3\",\"password\":\"$PW\"}" | j "d['access_token']")
A3=(-H "authorization: Bearer $T3" -H 'content-type: application/json' -H 'X-Timezone: America/Los_Angeles'); UID3=$(PSQL "SELECT id FROM users WHERE username='$U3'")
curl -sf "${A3[@]}" $B/me/settings | ok "d['effective']['coach_frequency']=='normal' and d['effective']['quiet_hours'] is None and d['effective']['days_to_exam'] is None"
curl -sf "${A3[@]}" -XPATCH $B/me/settings -d '{"target_school":"浙江大学 计算机","target_score":400,"exam_date":"2026-12-19","coach_frequency":"less","quiet_hours":{"start":"22:30","end":"08:00"}}' \
  | ok "(lambda s: s['target_school']=='浙江大学 计算机' and s['target_score']==400 and s['exam_date']=='2026-12-19' and s['coach_frequency']=='less' and s['quiet_hours']=={'start':'22:30','end':'08:00'} and s['timezone']=='America/Los_Angeles')(d['settings']) and isinstance(d['effective']['days_to_exam'],int)"
curl -sf "${A3[@]}" -XPATCH $B/me/settings -d '{"target_score":410}' | ok "d['settings']['target_score']==410 and d['settings']['coach_frequency']=='less'"
curl -sf "${A3[@]}" $B/auth/me | ok "d['exam_date']=='2026-12-19'"
curl -sf "${A3[@]}" $B/plans/today | ok "d['exam_date']=='2026-12-19' and d['days_to_exam']==(__import__('datetime').date(2026,12,19)-__import__('datetime').date.fromisoformat(d['date'])).days"
for bad in '{"coach_frequency":"low"}' '{"quiet_hours":{"start":"25:00","end":"08:00"}}' '{"exam_date":"2026-02-30"}' '{"target_score":501}' '{"target_score":"400"}' '{"goals":{}}' '{}'; do
  test "$(curl -s -o /dev/null -w '%{http_code}' "${A3[@]}" -XPATCH $B/me/settings -d "$bad")" = 400 || { echo "FAIL PATCH $bad 应该 400"; exit 1; }; done; echo "ok 非法设置 → 400 ×7"
# 统计按用户时区：LA 10-31 23:30（= 北京 11-01）答的题算 10-31
PSQL "INSERT INTO answer_records(user_id,question_id,answer,is_correct,answered_at,client_id) VALUES ('$UID3','math1-2024-01','[\"A\"]',false,'2026-10-31T23:30:00-07:00','st1'),('$UID3','math1-2024-02','[\"B\"]',true,'2026-10-30T10:00:00-07:00','st2'),('$UID3','math1-2024-02','[\"B\"]',true,'2026-10-29T10:00:00-07:00','st3')" >/dev/null
curl -sf "${A3[@]}" "$B/me/stats?days=30" | ok "(lambda s7: d['timezone']=='America/Los_Angeles' and d['days_studied']==3 and d['questions_done']==2 and d['attempts']==3 and abs(d['accuracy']-0.667)<0.001 and [x['date'] for x in s7 if x['studied']]==['2026-10-29','2026-10-30','2026-10-31'] and len(d['last_30']['series'])==30 and d['last_30']['series'][-1]['date']==d['today'] and {s['subject'] for s in d['subjects']}>={'高等数学','线性代数','概率论与数理统计'})(d['last_7']['series'])"
curl -sf "${A3[@]}" "$B/me/stats" | ok "d['streak_days']==(3 if d['today']=='2026-11-01' else 0) and d['best_streak_days']==3 and 'words' in d and set(d['words'])=={'learned','solid','due'}"
test "$(curl -s -o /dev/null -w '%{http_code}' "${A3[@]}" "$B/me/stats?days=500")" = 400 && echo "ok stats days=500 → 400"
# 免打扰：LA 23:00 的复盘照常生成，但排到 08:00 才出现
curl -sf "${A3[@]}" -H 'X-Debug-Now: 2026-11-01T23:00:00-08:00' -XPOST "$B/agent/jobs/nightly/run?respect_backoff=1" | ok "d['skipped'] is False"
curl -sf "${A3[@]}" -H 'X-Debug-Now: 2026-11-01T23:05:00-08:00' $B/agent/messages | ok "d['items']==[] and d['queued']==1 and d['next_delivery_at'].startswith('2026-11-02T16:00')"
curl -sf "${A3[@]}" -H 'X-Debug-Now: 2026-11-02T08:00:00-08:00' $B/agent/messages | ok "[i['kind'] for i in d['items']]==['review'] and d['queued']==0"
# less：上次复盘是 11-01 → 11-02 跳过，11-04 发
curl -sf "${A3[@]}" -XPATCH $B/me/settings -d '{"quiet_hours":null}' >/dev/null
curl -sf "${A3[@]}" -H 'X-Debug-Now: 2026-11-02T21:00:00-08:00' -XPOST "$B/agent/jobs/nightly/run?respect_backoff=1" | ok "d['skipped'] is True and '每 3 天' in d['reason']"
curl -sf "${A3[@]}" -H 'X-Debug-Now: 2026-11-04T21:00:00-08:00' -XPOST "$B/agent/jobs/nightly/run?respect_backoff=1" | ok "d['skipped'] is False"
# more：中午提醒；normal 不发
curl -sf "${A3[@]}" -XPOST "$B/agent/jobs/midday/run?respect_backoff=1" | ok "d['skipped'] is True"
curl -sf "${A3[@]}" -XPATCH $B/me/settings -d '{"coach_frequency":"more"}' >/dev/null
curl -sf "${A3[@]}" -XPOST "$B/agent/jobs/midday/run?respect_backoff=1" | ok "d['skipped'] is False and d['actions'][0]['tool']=='writeDailyTip'"
# ask：复盘只提建议，确认后才改
curl -sf "${A3[@]}" -XPATCH $B/me/settings -d '{"coach_frequency":"ask"}' >/dev/null
curl -sf "${A3[@]}" -XPOST $B/answers -d '{"question_id":"math1-2024-01","answer":["A"],"client_id":"ask1"}' >/dev/null
curl -sf "${A3[@]}" -XPOST "$B/agent/jobs/nightly/run" | ok "d['proposal'] and d['proposal']['items'][0]['tool']=='updateDailyPlan' and all(a['tool']=='writeDailyTip' for a in d['actions'])"
PMID=$(curl -sf "${A3[@]}" $B/agent/messages | j "[i for i in d['items'] if i['kind']=='proposal'][0]['id']")
curl -sf "${A3[@]}" -XPOST $B/agent/messages/$PMID/confirm -d '{}' | ok "d['proposal']['status']=='confirmed' and d['actions'][0]['trigger']=='confirm'"
test "$(curl -s -o /dev/null -w '%{http_code}' "${A3[@]}" -XPOST $B/agent/messages/$PMID/confirm -d '{}')" = 409 && echo "ok 重复确认 → 409"
# 第 7 轮：一次确认 = 一条记录、一次撤回；400 文案给学生看；开发触发 force
curl -sf "${A3[@]}" "$B/agent/actions" | ok "(lambda c: len(c)==1 and c[0]['action_count']==len(c[0]['actions'])>=2)([x for x in d['items'] if x['trigger']=='confirm'])"
curl -s "${A3[@]}" -XPATCH $B/me/settings -d '{"target_score":600}' | ok "d['message']=='目标分填 0–500 之间的整数' and d['field']=='target_score' and d['code']=='invalid_target_score'"
curl -sf "${A3[@]}" -XPOST $B/agent/jobs/run -d '{"job":"midday","force":true}' | ok "d['dev'] and d['skipped'] is False and d['proposal'] and len(d['proposal']['items'])>=1"
# 第 8 轮：每次任务一条新建议（已确认的不动）；409/404 统一形状；注册读 X-Timezone
curl -s "${A3[@]}" -XPOST $B/agent/messages/$PMID/confirm -d '{}' | ok "d['statusCode']==409 and d['code']=='already_decided' and d['message']=='这条建议已经处理过了' and 'field' in d"
P2=$(curl -sf "${A3[@]}" -XPOST $B/agent/jobs/run -d '{"job":"weekly","force":true}' | j "d['proposal']['message_id']")
curl -sf "${A3[@]}" $B/agent/messages | ok "(lambda p: len(set(x['id'] for x in p))==len(p)>=3 and [x for x in p if x['id']=='$PMID'][0]['proposal']['status']=='confirmed' and [x for x in p if x['id']=='$P2'][0]['proposal']['status']=='pending')([i for i in d['items'] if i['kind']=='proposal'])"
curl -s "${A3[@]}" -XPOST $B/agent/actions/00000000-0000-0000-0000-000000000000/undo | ok "d['statusCode']==404 and d['code']=='action_not_found' and d['field'] is None"
curl -sf -XPOST $B/auth/register -H 'Content-Type: application/json' -H 'X-Timezone: America/Los_Angeles' -d "{\"username\":\"tz_$(date +%s%N)\",\"password\":\"$PW\"}" | ok "d['timezone']=='America/Los_Angeles'"
curl -sf "${A3[@]}" $B/agent/messages | ok "(lambda m: m['headline'].startswith('已') and '等你确认' not in m['headline'] and '还没执行' not in (m['details'] or ''))([i for i in d['items'] if i['id']=='$PMID'][0])"
curl -sf "${A[@]}" $B/questions/english1-2025-14 | ok "d['errata'][0]['printed']=='Chrysanthi Gallon' and set(d['errata'][0])=={'printed','correct','note'}"
echo "== 主观题参考答案 reference_answer（english1-2022 Q47 翻译 / Q51、Q52 作文；客观题 correct_answer 不变）"
RA_IDS='"english1-2022-21","english1-2022-47","english1-2022-51","english1-2022-52"'
ERA=$(curl -sf "${A[@]}" -XPOST $B/exams -d "{\"question_ids\":[$RA_IDS],\"duration_minutes\":30}" | j "d['id']")
curl -sf "${A[@]}" -XPOST $B/exams/$ERA/submit -d '{"self_ratings":{"english1-2022-47":"no_idea","english1-2022-51":"approach_ok_calc_wrong","english1-2022-52":"full"}}' >/dev/null
RAQ=$(for id in english1-2022-21 english1-2022-47 english1-2022-51 english1-2022-52; do curl -sf "${A[@]}" "$B/questions/$id?include_answer=true"; echo; done | python3 -c "import sys,json;print(json.dumps({q['id']:q for q in map(json.loads,filter(str.strip,sys.stdin))}))")
curl -sf "${A[@]}" $B/exams/$ERA | python3 -c "import sys,json;d=json.load(sys.stdin);d['bank']=json.loads(sys.argv[1]);print(json.dumps(d))" "$RAQ" \
  | ok "(lambda p,b: p['english1-2022-47']['reference_answer']=='\n\n'.join(b['english1-2022-47']['answer']) and len(p['english1-2022-47']['reference_answer'])>20 and p['english1-2022-51']['reference_answer'].startswith('Dear') and len(p['english1-2022-52']['reference_answer'])>300 and p['english1-2022-21']['reference_answer'] is None and p['english1-2022-21']['correct_answer']==b['english1-2022-21']['answer'] and p['english1-2022-47']['correct_answer']==b['english1-2022-47']['answer'])({x['question_id']:x for x in d['result']['per_question']}, d['bank'])"
echo "$RAQ" | ok "d['english1-2022-47']['reference_answer']==d['english1-2022-47']['answer'][0] and d['english1-2022-52']['reference_answer'] and d['english1-2022-21']['reference_answer'] is None"
curl -sf "${A[@]}" $B/questions/english1-2022-47 | ok "d['reference_answer'] is None and 'answer' not in d"
curl -sf "${A[@]}" "$B/wrong-questions?exam_id=$ERA" | ok "(lambda w: 'english1-2022-47' in w and w['english1-2022-47']['reference_answer'] and all((x['reference_answer'] is None)==(x['type'] in ('choice','match')) for x in w.values()))({i['question_id']:i for i in d['items']})"
echo "ALL OK"
