. ./r7.sh
reg kaosheng_r8e ""
req PATCH /me/settings '{"coach_frequency":"ask"}' >/dev/null
N=$(req POST /agent/jobs/run '{"job":"nightly","force":true}'|head -1); echo "$N"|jq -c '{summary,proposal:.proposal.items[0].summary,tip:.actions[0].after.tip_date}'
ID=$(echo "$N"|jq -r .proposal.message_id); req POST /agent/messages/$ID/confirm '{}'|head -1|jq -c .message
req GET /agent/messages | head -1 | jq -c ".items[]|select(.id==\"$ID\")|{headline,details}"
for j in midday weekly; do req POST /agent/jobs/run "{\"job\":\"$j\",\"force\":true}"|head -1|jq -c '{summary,proposal,proposal_skipped,reason:.actions[0].reason,det:.actions[0].after.details}'; done
