#!/usr/bin/env bash
# 考场模式端到端（对 :3000）：开考 2017 数一 → 作答 → 暂停 → 继续 → 重放 → F5 → 再开考 409 → 交卷 → 自评 → 成绩汇总 → 错题本 → 教练消息 → 历史 → PDF
set -euo pipefail
B=${B:-http://localhost:3000/api/v1}
TZH=${TZH:-America/Los_Angeles}
U=exam_$RANDOM$RANDOM
J() { python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }
curl -sf -XPOST $B/auth/register -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"secret123\"}" >/dev/null
T=$(curl -sf -XPOST $B/auth/login -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"secret123\"}" | J "print(d['access_token'])")
H=(-H "authorization: Bearer $T" -H 'content-type: application/json' -H "X-Timezone: $TZH" -H 'X-Device: repro')
req() { local m=$1 p=$2; shift 2; curl -s -o /tmp/exam_body -w '%{http_code}' "${H[@]}" -X$m "$B$p" "$@"; }
ok() { echo "  ✓ $*"; }

echo "== 1. 凑不齐整卷的年份 → 422 + missing_numbers"
# 2025 年还没核对（全部 pending），换年份用 INCOMPLETE_YEAR=…
IY=${INCOMPLETE_YEAR:-2025}
code=$(req POST /exams -d "{\"exam\":\"math1\",\"year\":$IY}")
if [ "$code" = 422 ]; then J "print('  ', d['message']); assert d['code']=='paper_incomplete' and d['missing_numbers']" </tmp/exam_body; ok "$IY → 422 missing_numbers"
else echo "  ($IY 已整卷 confirmed，HTTP $code，跳过)"; [ "$code" = 201 ] && { E0=$(J "print(d['id'])" </tmp/exam_body); req POST /exams/$E0/submit -d '{}' >/dev/null; }; fi
code=$(req POST /exams -d '{"exam":"math1","year":2021}'); [ "$code" = 201 ] || { echo "2021（22 题）应能开考，HTTP $code"; cat /tmp/exam_body; exit 1; }
J "assert d['question_count']==22 and d['max_score']==150" </tmp/exam_body; E0=$(J "print(d['id'])" </tmp/exam_body)
code=$(req POST /exams/$E0/submit -d '{}'); [ "$code" = 200 ] && ok "2021 年 22 题整卷能开考（随即交卷）"
code=$(req POST /exams -d '{"exam":"math1","year":1999}'); [ "$code" = 404 ] && ok "没导入的年份 → 404"

echo "== 2. 开考 2017 数一"
code=$(req POST /exams -d '{"exam":"math1","year":2017}'); [ "$code" = 201 ] || { echo "HTTP $code"; cat /tmp/exam_body; exit 1; }
E=$(J "print(d['id'])" </tmp/exam_body)
J "assert d['status']=='in_progress' and d['duration_seconds']==10800 and d['max_score']==150 and d['question_count']==23, d; print('  ', d['title'], d['duration_seconds'], d['max_score'], d['started_date'], d['timezone'])" </tmp/exam_body
ok "exam=$E 180 分钟 / 150 分 / 23 题"
Q() { printf 'math1-2017-%02d' "$1"; }

echo "== 3. 作答 + 暂停 + 继续 + 重放"
ANS="[{\"question_id\":\"$(Q 1)\",\"answer\":[\"A\"],\"time_spent_seconds\":200},{\"question_id\":\"$(Q 2)\",\"answer\":[\"B\"],\"time_spent_seconds\":150},{\"question_id\":\"$(Q 3)\",\"answer\":[\"C\"],\"time_spent_seconds\":180},{\"question_id\":\"$(Q 9)\",\"answer\":[\"0\"],\"time_spent_seconds\":240}]"
code=$(req PUT /exams/$E/progress -d "{\"idempotency_key\":\"k1\",\"client_seq\":1,\"answers\":$ANS,\"current_question_id\":\"$(Q 9)\",\"state\":\"running\"}"); [ "$code" = 200 ]
J "assert len(d['progress']['answers'])==4 and d['duplicate'] is False" </tmp/exam_body; ok "4 道答案已保存"
code=$(req PUT /exams/$E/progress -d '{"idempotency_key":"k2","client_seq":2,"state":"paused"}'); [ "$code" = 200 ]
P1=$(J "assert d['status']=='paused'; print(d['elapsed_seconds'])" </tmp/exam_body); sleep 2
P2=$(req GET /exams/$E >/dev/null; J "print(d['elapsed_seconds'])" </tmp/exam_body)
[ "$P1" = "$P2" ] && ok "暂停后计时不走（elapsed=$P1）"
K3="{\"idempotency_key\":\"k3\",\"client_seq\":3,\"answers\":[{\"question_id\":\"$(Q 4)\",\"answer\":[\"D\"],\"time_spent_seconds\":120}],\"state\":\"running\"}"
code=$(req PUT /exams/$E/progress -d "$K3"); [ "$code" = 200 ]; J "assert d['status']=='in_progress' and d['duplicate'] is False" </tmp/exam_body; ok "继续（running）"
code=$(req PUT /exams/$E/progress -d "$K3"); [ "$code" = 200 ]; J "assert d['duplicate'] is True and len(d['progress']['answers'])==5" </tmp/exam_body; ok "同一 idempotency_key 重放 → duplicate:true，不重复生效"
code=$(req PUT /exams/$E/progress -d "{\"idempotency_key\":\"k-old\",\"client_seq\":1,\"answers\":[{\"question_id\":\"$(Q 1)\",\"answer\":[\"D\"]}]}"); [ "$code" = 200 ]
J "assert d['stale'] is True and d['progress']['answers']['$(Q 1)']['answer']==['A']" </tmp/exam_body; ok "乱序旧请求（client_seq 小）不覆盖答案"

echo "== 4. F5：GET /exams/active 接回同一场"
code=$(req GET /exams/active); J "e=d['exam'];assert e['id']=='$E' and e['status']=='in_progress' and len(e['progress']['answers'])==5 and e['progress']['last_client_seq']==3; print('  remaining', e['remaining_seconds'])" </tmp/exam_body; ok "active 返回同一场、答案都在"

echo "== 5. 再开考：同一张卷 → 200 接回同一场；别的卷 → 409 + active_exam"
code=$(req POST /exams -d '{"exam":"math1","year":2021}'); [ "$code" = 200 ]; J "assert d['id']=='$E' and d['resumed'] is True" </tmp/exam_body; ok "同一张卷 → 200 resumed，同一个 id"
code=$(req POST /exams -d '{"exam":"math1","year":2018}'); [ "$code" = 409 ]; J "assert d['active_exam_id']=='$E' and d['code']=='other_exam_active' and d['active_exam']['year']==2021" </tmp/exam_body; ok "409 active_exam_id=$E"

echo "== 6. 交卷（不带自评）"
code=$(req POST /exams/$E/submit -d '{"idempotency_key":"submit-1"}'); [ "$code" = 200 ]
J "
r=d['result'];assert d['status']=='submitted'
print('  score',r['score'],'/',r['max_score'],'pending',len(r['pending_self_rating']),'pending_points',r['pending_points'])
print('  sections',[(s['section'],s['score'],s['max_score']) for s in r['sections']])
print('  subjects',[(s['name'],s['score'],s['max_score'],s['rate']) for s in r['subjects']])
assert [s['section'] for s in r['sections']]==['选择题','填空题','解答题'] and [s['name'] for s in r['subjects']]==['高数','线代','概率']
assert len(r['pending_self_rating'])==9 and r['coach'] is None and r['max_score']==150
assert sum(s['max_score'] for s in r['sections'])==150 and sum(s['max_score'] for s in r['subjects'])==150
" </tmp/exam_body; ok "客观题已判分，9 道解答题待自评"
code=$(req POST /exams/$E/submit -d '{}'); [ "$code" = 200 ]; J "assert d['status']=='submitted'" </tmp/exam_body; ok "重复交卷 → 原样返回"
code=$(req PUT /exams/$E/progress -d '{"idempotency_key":"k9","client_seq":9}'); [ "$code" = 409 ] && ok "交卷后再存进度 → 409"

echo "== 7. 交卷后自评"
code=$(req POST /exams/$E/self-ratings -d "{\"idempotency_key\":\"sr-bad\",\"self_ratings\":{\"$(Q 18)\":{\"1\":\"full\"}}}"); [ "$code" = 400 ] && ok "证明题按小问自评 → 400"
code=$(req POST /exams/$E/self-ratings -d "{\"idempotency_key\":\"sr-bad2\",\"self_ratings\":{\"$(Q 1)\":\"full\"}}"); [ "$code" = 400 ] && ok "客观题自评 → 400"
code=$(req POST /exams/$E/self-ratings -d "{\"idempotency_key\":\"sr-bad3\",\"self_ratings\":{\"$(Q 19)\":{\"9\":\"full\"}}}"); [ "$code" = 400 ] && ok "不存在的小问 → 400"
SR1="{\"idempotency_key\":\"sr-1\",\"self_ratings\":{\"$(Q 15)\":\"full\",\"$(Q 18)\":\"approach_ok_calc_wrong\",\"$(Q 19)\":{\"1\":\"full\",\"2\":\"approach_ok_calc_wrong\"}}}"
code=$(req POST /exams/$E/self-ratings -d "$SR1"); [ "$code" = 200 ]
S1=$(J "r=d['result'];assert len(r['pending_self_rating'])==6 and r['coach'] is None;q=[p for p in r['per_question'] if p['number']==19][0];assert [s['self_rating'] for s in q['sub_scores']]==['full','approach_ok_calc_wrong'] and q['is_correct'] is False;print(r['score'])" </tmp/exam_body); ok "部分自评 → 还剩 6 题，得分 $S1"
code=$(req POST /exams/$E/self-ratings -d "$SR1"); J "assert d['duplicate'] is True" </tmp/exam_body; ok "同 key 重放 → duplicate:true"
SR2="{\"idempotency_key\":\"sr-2\",\"self_ratings\":{\"$(Q 16)\":\"no_idea\",\"$(Q 17)\":\"full\",\"$(Q 20)\":{\"1\":\"full\",\"2\":\"no_idea\"},\"$(Q 21)\":\"no_idea\",\"$(Q 22)\":{\"1\":\"full\",\"2\":\"full\"},\"$(Q 23)\":{\"1\":\"full\",\"2\":\"approach_ok_calc_wrong\",\"3\":\"no_idea\"}}}"
code=$(req POST /exams/$E/self-ratings -d "$SR2"); [ "$code" = 200 ]
S2=$(J "r=d['result'];assert r['pending_self_rating']==[] and r['pending_points']==0 and r['coach'] and r['coach']['message_id'];print(r['score'])" </tmp/exam_body); ok "全部自评完 → 得分 $S2，生成教练复盘"
code=$(req POST /exams/$E/self-ratings -d "{\"idempotency_key\":\"sr-3\",\"self_ratings\":{\"$(Q 16)\":\"full\"}}"); [ "$code" = 200 ]
J "
r=d['result'];s2=$S2;print('  重评第16题 no_idea→full：',s2,'→',r['score']);assert r['score']==s2+10
print('  score',r['score'],'/',r['max_score'],'rate',r['score_rate'])
print('  sections',[(s['section'],s['score'],s['max_score']) for s in r['sections']])
print('  subjects',[(s['name'],s['score'],s['max_score'],s['rate']) for s in r['subjects']])
print('  lost_by_kp top3',[(k['name'],k['lost']) for k in r['lost_by_kp'][:3]])
print('  coach:',r['coach']['headline'])
l=[k['lost'] for k in r['lost_by_kp']];assert l==sorted(l,reverse=True)
assert abs(sum(l)-(r['max_score']-r['score']))<0.5, (sum(l), r['max_score']-r['score'])
assert str(r['score']) in r['coach']['headline']
for c in r['conclusions']: print('   -',c)
" </tmp/exam_body; ok "重评覆盖，汇总重算"
cp /tmp/exam_body /tmp/exam_final.json

echo "== 8. 教练消息 GET /agent/messages"
code=$(req GET /agent/messages); J "
f=json.load(open('/tmp/exam_final.json'))['result']['coach']
m=[i for i in d['items'] if i['kind']=='exam_review'];assert m and m[0]['id']==f['message_id'] and m[0]['headline']==f['headline'];print('  ',m[0]['date'],m[0]['headline'])" </tmp/exam_body; ok "kind=exam_review 消息可见"

echo "== 9. 错题本（source=exam）"
code=$(req GET "/wrong-questions?status=all&source=exam&exam_id=$E"); J "
f=json.load(open('/tmp/exam_final.json'))['result']
got=sorted(i['question_id'] for i in d['items']);print('  错题本',len(got),'道:',[g[-2:] for g in got])
assert all(i['source']=='exam' and i['source_exam_id']=='$E' for i in d['items'])
need={p['question_id'] for p in f['per_question'] if p['is_correct'] is False}
assert need<=set(got), need-set(got)
for q in ['$(Q 19)','$(Q 20)','$(Q 21)','$(Q 23)','$(Q 5)']: assert q in got, q
s={i['question_id']:i['status'] for i in d['items']};assert s['$(Q 16)']=='mastered', s.get('$(Q 16)')
" </tmp/exam_body; ok "做错/部分得分的题都进了错题本（重评对的第16题转 mastered）"

echo "== 10. 历史 GET /exams"
code=$(req GET "/exams?limit=1"); J "
i=d['items'][0];print('  ',i['title'],i['status'],i['score'],'/',i['max_score'],'elapsed',i['elapsed_seconds'],i['started_date'])
assert i['id']=='$E' and i['status']=='submitted' and i['max_score']==150 and i['submitted_at']" </tmp/exam_body; ok "历史里有这场"

echo "== 11. 成绩报告 PDF"
curl -s -D /tmp/exam_hdr -o /tmp/exam_report.pdf "${H[@]}" "$B/exams/$E/report.pdf"
head -c 4 /tmp/exam_report.pdf | grep -q '%PDF' && ok "PDF $(stat -c %s /tmp/exam_report.pdf) 字节，%PDF 头"
grep -i 'content-disposition' /tmp/exam_hdr | sed 's/^/  /'
grep -qi "filename\*=UTF-8''" /tmp/exam_hdr && ok "中文文件名（filename*）"
TXT=$(pdftotext /tmp/exam_report.pdf - 2>/dev/null || true)
for w in 分题型 分科 丢分知识点 教练 每题明细 错题; do grep -q "$w" <<<"$TXT" || { echo "PDF 缺「$w」"; exit 1; }; done; ok "PDF 内含分题型/分科/丢分知识点/教练句/每题明细/错题讲解"

echo "== 12. 放弃 POST /exams/{id}/abandon（round7）"
code=$(req POST /exams -d '{"exam":"math1","year":2017}'); [ "$code" = 201 ]; EA=$(J "print(d['id'])" </tmp/exam_body)
code=$(req PUT /exams/$EA/progress -d "{\"idempotency_key\":\"a1\",\"client_seq\":1,\"answers\":[{\"question_id\":\"$(Q 1)\",\"answer\":[\"B\"]}]}"); [ "$code" = 200 ]
code=$(req POST /exams/$EA/abandon -d '{}'); [ "$code" = 200 ] || { echo "abandon HTTP $code"; cat /tmp/exam_body; exit 1; }
J "assert d['status']=='abandoned' and d['abandoned_at'] and d['result'] is None and d['progress']['answers']['$(Q 1)']['answer']==['B']" </tmp/exam_body; ok "abandoned，进度保留，没有成绩"
code=$(req POST /exams/$EA/abandon -d '{}'); [ "$code" = 200 ] && ok "重复放弃 → 200（幂等）"
code=$(req POST /exams/$EA/submit -d '{}'); [ "$code" = 409 ] && ok "放弃后交卷 → 409"
code=$(req PUT /exams/$EA/progress -d '{"idempotency_key":"a2","client_seq":2}'); [ "$code" = 409 ] && ok "放弃后存进度 → 409"
code=$(req GET /exams/active); J "assert d['exam'] is None" </tmp/exam_body; ok "active 位置腾出来了"
code=$(req GET "/wrong-questions?status=all&source=exam&exam_id=$EA"); J "assert d['items']==[]" </tmp/exam_body; ok "放弃的不进错题本"
code=$(req GET "/exams?limit=5"); J "i=[x for x in d['items'] if x['id']=='$EA'][0];assert i['status']=='abandoned' and i['score'] is None and i['abandoned_at'] and i['answered_count']==1" </tmp/exam_body; ok "历史里显示 abandoned"
code=$(req POST /exams/$E/abandon -d '{}'); [ "$code" = 409 ] && ok "已交卷的不能放弃 → 409"

echo "== 13. 小问自评：只评 (1) 交卷，之后补 (2)；各种键写法；没评的不算丢分（round7）"
code=$(req POST /exams -d '{"exam":"math1","year":2017}'); [ "$code" = 201 ]; E3=$(J "print(d['id'])" </tmp/exam_body)
code=$(req PUT /exams/$E3/progress -d "{\"idempotency_key\":\"b1\",\"client_seq\":1,\"answers\":[{\"question_id\":\"$(Q 1)\",\"answer\":[\"A\"]},{\"question_id\":\"$(Q 2)\",\"answer\":[\"C\"]}]}"); [ "$code" = 200 ]
# 和测试员一样：交卷时第 19 题只带了 (1)，第 15/16 整题，其他没评；第 22 题小问值为 null（先不评）
code=$(req POST /exams/$E3/submit -d "{\"self_ratings\":{\"$(Q 15)\":\"full\",\"$(Q 16)\":\"approach_ok_calc_wrong\",\"$(Q 19)\":{\"1\":\"full\"},\"$(Q 22)\":{\"1\":null}}}"); [ "$code" = 200 ] || { cat /tmp/exam_body; exit 1; }
J "
r=d['result'];pq={p['number']:p for p in r['per_question']}
assert r['coach'] is None, r['coach']
assert '$(Q 19)' in r['pending_self_rating'] and '$(Q 20)' in r['pending_self_rating']
assert all(20 not in k['question_numbers'] for k in r['lost_by_kp']), '没评的第 20 题不能算丢分'
assert all(not(set(k['question_numbers'])&{17,18,20,21,22,23}) for k in r['lost_by_kp'])
graded_lost=sum(s['lost'] for s in r['subjects']);assert abs(graded_lost+r['score']+r['pending_points']-150)<0.01,(graded_lost,r['score'],r['pending_points'])
assert abs(sum(k['lost'] for k in r['lost_by_kp'])-graded_lost)<0.5
for s in r['subjects']: assert abs(s['score']+s['lost']+s['pending_points']-s['max_score'])<0.01, s
assert not any('第 20 题' in c and '丢' in c for c in r['conclusions'])
# 客观题带标准答案
for n in range(1,15): assert pq[n]['correct_answer'], n
assert pq[1]['answer']==['A'] and pq[3]['answer']==[]
assert pq[15]['answered'] and pq[19]['answered'] and not pq[20]['answered']
print('  pending',len(r['pending_self_rating']),'pending_points',r['pending_points'],'lost_by_kp top',[(k['name'],k['lost'],k['question_numbers']) for k in r['lost_by_kp'][:2]])
" </tmp/exam_body; ok "没评的部分只进 pending_points；客观题有 correct_answer；coach=null"
code=$(req GET /agent/messages); J "
m=[i for i in d['items'] if i['kind']=='exam_review'];f=json.load(open('/tmp/exam_final.json'))['result']['coach']
assert m and m[0]['headline']==f['headline'], '没评完的模考不能写教练消息'" </tmp/exam_body; ok "没评完不写 exam_review"
# 老数据里没评完却带了 coach（模拟）：再评一部分 → coach 撤掉
DBURL=$(grep -oP '^DATABASE_URL=\K.*' .env 2>/dev/null || true)
if [ -n "$DBURL" ] && command -v psql >/dev/null; then
  psql "$DBURL" -qAt -c "UPDATE exams SET result=jsonb_set(result,'{coach}','{\"message_id\":null,\"headline\":\"这场丢分最多的是「矩阵的秩」，11 分，第 20 题。\",\"kind\":\"exam_review\"}') WHERE id='$E3'"
  code=$(req GET /exams/$E3); J "assert d['result']['coach'] is None" </tmp/exam_body; ok "没评完时 GET 不返回旧 coach"
fi
# 交卷后补 (2)：键写成 "(2)"，要和之前的 (1) 合并
code=$(req POST /exams/$E3/self-ratings -d "{\"idempotency_key\":\"c1\",\"self_ratings\":{\"$(Q 19)\":{\"(2)\":\"approach_ok_calc_wrong\"}}}"); [ "$code" = 200 ] || { cat /tmp/exam_body; exit 1; }
J "
r=d['result'];q=[p for p in r['per_question'] if p['number']==19][0]
assert [s['self_rating'] for s in q['sub_scores']]==['full','approach_ok_calc_wrong'], q['sub_scores']
assert '$(Q 19)' not in r['pending_self_rating'] and q['got']==q['sub_scores'][0]['score']+q['sub_scores'][1]['score']/2 and q['answered'] and r['coach'] is None, q  # 小问分值跟着 kp_tags 走（估分），不写死" </tmp/exam_body; ok "补评 (2) 和 (1) 合并，第 19 题不再待自评"
# 其他键写法：组合键、罗马数字、数组、中文序号、数字键
code=$(req POST /exams/$E3/self-ratings -d "{\"idempotency_key\":\"c2\",\"self_ratings\":{\"$(Q 20):1\":\"full\",\"$(Q 20)\":{\"Ⅱ\":\"no_idea\"},\"$(Q 22)\":[{\"sub_number\":1,\"self_rating\":\"full\"},{\"sub_number\":\"ii\",\"self_rating\":\"no_idea\"}],\"$(Q 23)\":{\"第1问\":\"full\",\"二\":\"full\",\"sub3\":\"no_idea\"}}}"); [ "$code" = 200 ] || { cat /tmp/exam_body; exit 1; }
J "
r=d['result'];pq={p['number']:p for p in r['per_question']}
assert [s['self_rating'] for s in pq[20]['sub_scores']]==['full','no_idea']
assert [s['self_rating'] for s in pq[22]['sub_scores']]==['full','no_idea']
assert [s['self_rating'] for s in pq[23]['sub_scores']]==['full','full','no_idea']
assert sorted(int(x[-2:]) for x in r['pending_self_rating'])==[17,18,21], r['pending_self_rating']" </tmp/exam_body; ok "\"qid:1\" / \"Ⅱ\" / [{sub_number:\"ii\"}] / \"第1问\" / \"二\" / \"sub3\" 都认"
code=$(req POST /exams/$E3/self-ratings -d "{\"idempotency_key\":\"c3\",\"self_ratings\":{\"$(Q 19)\":{\"(9)\":\"full\"}}}"); [ "$code" = 400 ] && ok "不存在的小问 (9) → 400"
code=$(req POST /exams/$E3/self-ratings -d "{\"idempotency_key\":\"c4\",\"self_ratings\":{\"$(Q 17)\":\"full\",\"$(Q 18)\":\"no_idea\",\"$(Q 21)\":\"approach_ok_calc_wrong\"}}"); [ "$code" = 200 ]
J "r=d['result'];assert r['pending_self_rating']==[] and r['coach'] and str(r['score']) in r['coach']['headline'];print('  coach:',r['coach']['headline'])" </tmp/exam_body; ok "全部评完才出教练一句话"
echo "ALL PASS  exam=$E exam2=$E3"
