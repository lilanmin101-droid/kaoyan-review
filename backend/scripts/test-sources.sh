#!/usr/bin/env bash
# 讲解/思路来源 + 讲解核对（verified）测试：另起一个后端（:3002），EXPLANATIONS_DIR 指向临时目录，验证
#   专家文件里有的题 → expert；没有的 → pending（讲解生成中 / 思路生成中，不出示例内容）；文件追加后不重启即生效
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d); PORT=3002; B=http://127.0.0.1:$PORT/api/v1
grep '"math1-2024-19"' /workspace/kaoyan/tiku/explanations/math1_2024_expert.jsonl > "$TMP/math1_2024_expert.jsonl"
mkdir -p "$TMP/reviews"
# 2024 格式（verdict，无 kind）：q19 先 fail 后 pass → 最新一条 pass
printf '%s\n' '{"id":"math1-2024-19","verdict":"pass","by":"t","at":"2026-11-01T05:05"}' '{"id":"math1-2024-19","verdict":"fail","by":"t","at":"2026-11-01T05:00"}' > "$TMP/reviews/explanations_math1_2024.jsonl"
PORT=$PORT JOBS_ENABLED=0 EXPLANATIONS_DIR=$TMP REVIEWS_DIR=$TMP/reviews node dist/src/main.js > /tmp/test-sources.log 2>&1 & PID=$!
trap 'kill $PID 2>/dev/null; rm -rf "$TMP"' EXIT
for i in $(seq 1 30); do curl -sf $B/health >/dev/null 2>&1 && break; sleep 0.5; done
T=$(curl -sf -XPOST $B/auth/register -H 'content-type: application/json' -d "{\"username\":\"src$RANDOM$RANDOM\",\"password\":\"pass12345\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).access_token))')
H=(-H "authorization: Bearer $T")
chk() { echo "$2" | grep -q "$3" && echo "OK  $1" || { echo "FAIL $1: $2"; exit 1; }; }
chk "explain q19 expert" "$(curl -sfN "${H[@]}" $B/questions/math1-2024-19/explain | grep '"type":"done"')" '"status":"expert","source":"expert","source_label":"行业专家参考解答（非官方解析）"'
chk "explain q03 pending" "$(curl -sfN "${H[@]}" $B/questions/math1-2024-03/explain | grep -c '"type":"step"' || true)" '^0$'
chk "explain q03 done" "$(curl -sfN "${H[@]}" -XPOST -H 'content-type: application/json' -d '{"selectedText":"x"}' $B/questions/math1-2024-03/explain | grep '"type":"done"')" '"status":"pending","source":"pending".*讲解生成中'
chk "hint q03 pending" "$(curl -sf "${H[@]}" "$B/questions/math1-2024-03/hint?step=2")" '"hints":\[\],"status":"pending","source":"pending".*思路生成中'
grep '"math1-2024-03"' /workspace/kaoyan/tiku/explanations/math1_2024_expert.jsonl >> "$TMP/math1_2024_expert.jsonl"
chk "hint q03 after append" "$(curl -sf "${H[@]}" "$B/questions/math1-2024-03/hint")" '"source":"expert"'
# verified：最新 at 取胜（不看文件顺序；带时区 / 裸时间按太平洋时间）
chk "q19 verified (latest pass)" "$(curl -sf "${H[@]}" "$B/questions/math1-2024-19/hint")" '"source":"expert","verified":true'
chk "q19 explain verified" "$(curl -sfN "${H[@]}" $B/questions/math1-2024-19/explain | grep '"type":"done"')" '"verified":true,"status":"expert"'
echo '{"id":"math1-2024-19","verdict":"fail","by":"t","at":"2026-11-01T05:10"}' >> "$TMP/reviews/explanations_math1_2024.jsonl"
chk "q19 later fail → unverified" "$(curl -sf "${H[@]}" "$B/questions/math1-2024-19")" '"source":"expert","source_label":"行业专家参考解答（非官方解析）","verified":false'
echo '{"id":"math1-2024-19","verdict":"pass_minor","by":"t","at":"2026-11-01T13:06:00Z"}' >> "$TMP/reviews/explanations_math1_2024.jsonl"
chk "q19 earlier pass (05:06 PT, Z) still loses" "$(curl -sf "${H[@]}" "$B/questions/math1-2024-19")" '"verified":false'
echo '{"id":"math1-2024-19","kind":"expert_explanation","result":"pass_minor","by":"t","at":"2026-11-01T05:20-08:00"}' >> "$TMP/reviews/explanations_math1_2024.jsonl"
chk "q19 pass_minor with kind=expert_explanation → verified" "$(curl -sf "${H[@]}" "$B/questions/math1-2024-19")" '"verified":true'
# 官方解析：没有核对记录 →「官方解析（未核对）」；pass →「官方解析」；fail →「官方解析（未核对）」
chk "2023-17 official unverified" "$(curl -sf "${H[@]}" "$B/questions/math1-2023-17/hint")" '"source":"official","verified":false,"source_label":"官方解析（未核对）"'
printf '%s\n' '{"id":"math1-2023-17","kind":"official_solution","result":"pass","by":"t","at":"2026-11-01T05:20-08:00"}' > "$TMP/reviews/explanations_math1_2023.jsonl"
chk "2023-17 official verified" "$(curl -sf "${H[@]}" "$B/questions/math1-2023-17/hint")" '"source":"official","verified":true,"source_label":"官方解析"'
echo '{"id":"math1-2023-17","result":"fail","by":"t","at":"2026-11-01T05:30-08:00"}' >> "$TMP/reviews/explanations_math1_2023.jsonl"
chk "2023-17 kind 缺省 + 有官方解析 → official fail" "$(curl -sf "${H[@]}" "$B/questions/math1-2023-17/hint")" '"verified":false,"source_label":"官方解析（未核对）"'
echo "SOURCES OK"
