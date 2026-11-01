. ./r7.sh
T=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"username":"kaosheng_r8d","password":"r8test2026"}'|jq -r .access_token)
echo "## (r8d cont.) confirm nightly proposal" >>$L
req POST /agent/messages/20096882-8a7b-48a2-b25a-68663f08ea38/confirm '{}'|head -1|jq -c '{message,status:.status}'
req GET /agent/messages | head -1 | jq -c '.items[]|select(.id=="20096882-8a7b-48a2-b25a-68663f08ea38")|{status,headline,details}'
echo ==b2; for j in midday weekly; do req POST /agent/jobs/run "{\"job\":\"$j\",\"force\":true}"|head -1|jq -c '{proposal,proposal_skipped,reason:.actions[0].reason}'; done
echo ==c; req POST /answers '{"question_id":"english1-2015-03","answer":["A"]}'|head -1|jq -c '{is_correct}'
M=$(req POST /agent/jobs/run '{"job":"midday","force":true}'|head -1); echo "$M"|jq -c '{proposal,proposal_skipped,reason:.actions[0].reason}'
MID=$(echo "$M"|jq -r '.proposal.message_id // empty'); echo MID=$MID
if [ -n "$MID" ]; then req POST /agent/messages/$MID/dismiss '{}'|head -1|jq -c .; req GET /agent/messages|head -1|jq -c ".items[]|select(.id==\"$MID\")|{status,headline,details}"; req POST /agent/messages/$MID/confirm '{}'; fi
echo ==d; req POST /answers '{"question_id":"english1-2015-12","answer":["B"]}'|head -1|jq -c '{is_correct}'
for c in "后天重做 5 道错题" "昨天的错题帮我排 1 道" "今天做错的题明天帮我排 1 道" "上周的错题帮我排 2 道"; do echo "==cmd $c"; req POST /agent/commands "{\"text\":\"$c\"}" | grep -o '"type":"done".*' ; done
for d in 2026-11-01 2026-11-02 2026-11-03; do echo ==plan $d; req GET "/plans?from=$d&to=$d" | head -1 | jq -c '.. | objects | select(has("why_changed")) | {date,why_changed,tasks:[.tasks[]?.title]}' ; done
echo ==h; req GET /agent/actions|head -1|jq -c '.items[]|select(.tool=="writeDailyTip")|{summary,reason}'
echo ==i; req GET /questions/math1-2019-22 | head -1 | jq -c '{sub_scores,sub_scores_source,score,subs:[.sub_questions[]?|{n:.number,score}]}'
