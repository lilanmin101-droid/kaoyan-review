B=http://localhost:3000/api/v1; L=api_retest2.md
req(){ m=$1; p=$2; d=$3; echo "### $m $p $d" >>$L; if [ -n "$d" ]; then r=$(curl -s -w '\n[HTTP %{http_code}]' -X $m "$B$p" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "$d"); else r=$(curl -s -w '\n[HTTP %{http_code}]' -X $m "$B$p" -H "Authorization: Bearer $T"); fi; echo "$r" >>$L; echo >>$L; echo "$r"; }
T=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"username":"kaosheng_r8b","password":"r8test2026"}'|jq -r .access_token)
A=80489f8e-4df0-4296-aaa9-8913a4813f5a; Bm=5b513e94-a1c9-47d7-8d43-8c4c63476f12; C=c67f93b0-3af2-418f-a6d2-b897c32bb3fb
echo ==A2; req POST /agent/messages/$A/confirm '{}'
echo ==B; req POST /agent/messages/$Bm/confirm '{}' | tail -c 200
echo ==dB; req POST /agent/messages/$Bm/dismiss '{}'
echo ==dC; req POST /agent/messages/$C/dismiss '{}' | tail -c 200
echo ==404; req POST /agent/messages/00000000-0000-0000-0000-000000000000/confirm '{}'
echo ==404b; req POST /agent/actions/00000000-0000-0000-0000-000000000000/undo '{}'
echo ==msgAafter; req GET /agent/messages | head -1 | jq -c '.items[]|select(.id=="'$A'")|{headline,details}'
