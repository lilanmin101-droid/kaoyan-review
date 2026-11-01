B=http://localhost:3000/api/v1
L=api_retest2.md
req(){ m=$1; p=$2; d=$3; echo "### $m $p $d" >>$L; if [ -n "$d" ]; then r=$(curl -s -w '\n[HTTP %{http_code}]' -X $m "$B$p" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "$d"); else r=$(curl -s -w '\n[HTTP %{http_code}]' -X $m "$B$p" -H "Authorization: Bearer $T"); fi; echo "$r" >>$L; echo >>$L; echo "$r"; }
echo "# Round 8 retest2 $(TZ=America/Los_Angeles date +%FT%T%:z)" >$L
T=
R=$(curl -s -X POST $B/auth/register -H 'Content-Type: application/json' -H 'X-Timezone: America/Los_Angeles' -d '{"username":"kaosheng_r8b","password":"r8test2026"}'); echo "### register r8b (X-Timezone LA)"; echo "$R" | sed 's/"access_token":"[^"]*"/"access_token":"…"/' | tee -a $L
R2=$(curl -s -X POST $B/auth/register -H 'Content-Type: application/json' -d '{"username":"kaosheng_r8c","password":"r8test2026"}'); echo "### register r8c (no header)" >>$L; echo "$R2" | sed 's/"access_token":"[^"]*"/"access_token":"…"/' | tee -a $L
T=$(echo "$R"|jq -r .access_token)
req GET /me/settings
req PATCH /me/settings '{"coach_frequency":"ask"}' >/dev/null
req POST /agent/jobs/run '{"job":"nightly","force":true}' >/dev/null
req GET /agent/messages
