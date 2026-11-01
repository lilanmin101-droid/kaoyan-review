B=http://localhost:3000/api/v1; L=api_retest2.md
req(){ m=$1; p=$2; d=$3; echo "### $m $p $d" >>$L; if [ -n "$d" ]; then r=$(curl -s -w '\n[HTTP %{http_code}]' -X $m "$B$p" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "$d"); else r=$(curl -s -w '\n[HTTP %{http_code}]' -X $m "$B$p" -H "Authorization: Bearer $T"); fi; echo "$r" >>$L; echo >>$L; echo "$r"; }
T=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"username":"kaosheng_r8b","password":"r8test2026"}'|jq -r .access_token)
req GET /agent/actions > acts.txt; head -1 acts.txt | jq -c '.items[]|{id,group_id,summary,action_count,tool}'
ID=$(head -1 acts.txt | jq -r '.items[]|select(.summary|test("昨天|11-01 的计划"))|.id' | head -1)
echo ==u1 $ID; req POST /agent/actions/$ID/undo '{}' | tail -c 200
echo ==u2; req POST /agent/actions/$ID/undo '{}'
