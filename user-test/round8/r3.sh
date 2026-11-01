B=http://localhost:3000/api/v1; L=api_retest2.md
req(){ m=$1; p=$2; d=$3; echo "### $m $p $d" >>$L; if [ -n "$d" ]; then r=$(curl -s -w '\n[HTTP %{http_code}]' -X $m "$B$p" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "$d"); else r=$(curl -s -w '\n[HTTP %{http_code}]' -X $m "$B$p" -H "Authorization: Bearer $T"); fi; echo "$r" >>$L; echo >>$L; echo "$r"; }
T=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"username":"kaosheng_r8b","password":"r8test2026"}'|jq -r .access_token)
A=80489f8e-4df0-4296-aaa9-8913a4813f5a
echo ==confirmA; req POST /agent/messages/$A/confirm '{}' | cut -c1-700
echo ==msgs; req GET /agent/messages | jq -c '.items[]|select(.kind=="proposal")|{id,headline,st:.proposal.status,n:(.proposal.items|length)}' 2>/dev/null
req POST /agent/jobs/run '{"job":"midday","force":true}' >/dev/null
req POST /agent/jobs/run '{"job":"weekly","force":true}' >/dev/null
echo ==msgs2; req GET /agent/messages | head -1 | jq -c '.items[]|select(.kind=="proposal")|{id,headline,st:.proposal.status,n:(.proposal.items|length)}'
