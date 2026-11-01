. ./r7.sh
reg kaosheng_r8d "-H X-Timezone:America/Los_Angeles"
req PATCH /me/settings '{"coach_frequency":"ask"}' >/dev/null
echo ==a; N=$(req POST /agent/jobs/run '{"job":"nightly","force":true}'); echo "$N"|head -c 1500; echo
ID=$(echo "$N"|head -1|jq -r '.. | objects | select(has("id") and (has("headline") or has("status"))) | .id' 2>/dev/null|head -1)
[ -z "$ID" ] && ID=$(req GET /agent/messages|head -1|jq -r '.items[0].id')
echo ID=$ID; req POST /agent/messages/$ID/confirm '{}'; echo
req GET /agent/messages | head -1 | jq -c '.items[]|{id,status,headline,details}'
echo ==b; req POST /agent/jobs/run '{"job":"midday","force":true}'; echo; req POST /agent/jobs/run '{"job":"weekly","force":true}'
