B=http://localhost:3000/api/v1; L=api_retest2.md
PW="${TEST_PW:-$(cat /workspace/.kaoyan_testpw)}"  # 测试号密码在仓库外
req(){ m=$1; p=$2; d=$3; echo "### $m $p $d" >>$L; if [ -n "$d" ]; then r=$(curl -s -w '\n[HTTP %{http_code}]' -X $m "$B$p" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "$d"); else r=$(curl -s -w '\n[HTTP %{http_code}]' -X $m "$B$p" -H "Authorization: Bearer $T"); fi; echo "$r" >>$L; echo >>$L; echo "$r"; }
T=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"username":"kaosheng_r8b","password":"'"$PW"'"}'|jq -r .access_token)
echo ==wq0; req GET /wrong-questions | head -c 300; echo
echo ==c1; req POST /agent/commands '{"text":"明天加 10 道错题"}' > c1.txt; grep -o '"reply":"[^"]*"\|"summary":"[^"]*"\|data: .*reply.*' c1.txt | head; tail -c 600 c1.txt
req POST /answers '{"question_id":"english1-2015-03","answer":["A"]}' | tail -c 300
req POST /answers '{"question_id":"english1-2015-12","answer":["B"]}' | tail -c 300
echo; psql "$DATABASE_URL" -Atc "select question_id from wrong_questions w join users u on u.id=w.user_id where u.username='kaosheng_r8b'" | tee -a $L
echo ==c2; req POST /agent/commands '{"text":"后天重做 5 道错题"}' > c2.txt; tail -c 900 c2.txt
echo ==c3; req POST /agent/commands '{"text":"昨天的错题帮我排 1 道"}' > c3.txt; tail -c 900 c3.txt
