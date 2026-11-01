/**
 * 旧的「12 个示例单词」已停用（自拟例句和自拟词频已删除，见 migrations/004_words_ecdict.sql）。
 * 现在单词全部来自 ECDICT：npm run import:words -- /workspace/kaoyan/data/ecdict/ecdict.csv
 * 这个脚本保留为兼容入口：找到 ECDICT 文件就导入，找不到就提示，不再写任何示例内容。
 */
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import * as path from 'path';

const csv = process.env.ECDICT_PATH || '/workspace/kaoyan/data/ecdict/ecdict.csv';
if (!fs.existsSync(csv)) {
  console.log(`没有找到 ECDICT（${csv}）。下载：curl -L -o ${csv} https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv ，再 npm run import:words -- ${csv}`);
  process.exit(0);
}
execFileSync(process.execPath, [path.join(__dirname, 'import-words.js'), csv], { stdio: 'inherit' });
