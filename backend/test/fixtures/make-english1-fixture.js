// 生成英语一测试卷（虚构内容，非真题）：english1_2099（结构完全正确）、english1_2098（故意写错，测校验）
// 用法：node test/fixtures/make-english1-fixture.js
const fs = require('fs'); const path = require('path');
const dir = __dirname;
function paper(year) {
  const id = (n) => `english1-${year}-${String(n).padStart(2, '0')}`;
  const P = (k) => `english1-${year}-P-${k}`;
  const opt4 = (a, b, c, d) => [{ key: 'A', content: a }, { key: 'B', content: b }, { key: 'C', content: c }, { key: 'D', content: d }];
  const G7 = ['Plan your route the night before.', 'Pack light and pack early.', 'Ask locals for advice.', 'Keep a small notebook.', 'Leave room for surprises.', 'Check the weather twice.', 'Learn a few local words.'];
  const passages = [
    { id: P('cloze'), section: 'use_of_english', title: 'Section I Use of English', directions: 'Read the following text. Choose the best word(s) for each numbered blank.', text: Array.from({ length: 20 }, (_, i) => `Sentence ${i + 1} of the cloze text has a {{${i + 1}}} in it.`).join(' ') + '\n\nThe end of the cloze text.\n\n{{table:0}}', tables: [{ header: ['Word', 'Meaning'], rows: [['gap', 'space']] }], images: [] },
    ...[1, 2, 3, 4].map((t) => ({ id: P(`text${t}`), section: 'reading_a', title: `Text ${t}`, text: `Reading text ${t}, paragraph one. Gardens in small towns are becoming popular.\n\nParagraph two explains why people like to grow food.`, images: [] })),
    { id: P('partb'), section: 'reading_b', title: 'Part B', directions: 'Choose the most suitable heading from the list A-G for each numbered paragraph. There are two extra headings.', text: 'Five short paragraphs about travelling well, numbered 41 to 45.', images: [] },
    { id: P('translation'), section: 'translation', title: 'Part C', directions: 'Translate the underlined segments into Chinese. (10 points)', text: ['Cities are changing fast.', '<u data-q="46">Many people now work from home, which saves them time.</u>', '<u data-q="47">Parks have become more important than ever before.</u>', '<u data-q="48">Children learn best when they are allowed to play outside.</u>', '<u data-q="49">Good public transport makes a city easier to live in.</u>', '<u data-q="50">Planners must listen to the people who live there.</u>'].join(' '), images: [] },
  ];
  const qs = [];
  const base = (n, section, type, score, extra) => ({ schema_version: '0.2', id: id(n), exam: 'english1', year, number: n, section, type, score, images: [], options: [], sub_questions: [], solution: null, source: { fixture: true }, ...extra });
  for (let n = 1; n <= 20; n++) qs.push(base(n, 'use_of_english', 'choice', 0.5, { passage_id: P('cloze'), stem: `（${n}）______`, options: opt4('gap', 'space', 'hole', 'break'), answer: [['A', 'B', 'C', 'D'][n % 4]], knowledge_points: ['英语/完形填空/上下文复现'] }));
  for (let n = 21; n <= 40; n++) qs.push(base(n, 'reading_a', 'choice', 2, { passage_id: P(`text${Math.floor((n - 21) / 5) + 1}`), stem: `Question ${n}: What does the text mainly discuss?`, options: opt4('Gardens.', 'Cars.', 'Music.', 'Sports.'), answer: ['A'], knowledge_points: ['英语/阅读理解A/细节题'] }));
  for (let n = 41; n <= 45; n++) qs.push(base(n, 'reading_b', 'match', 2, { passage_id: P('partb'), stem: `Paragraph ${n}: a short paragraph about one travel tip.`, options: G7.map((c, i) => ({ key: 'ABCDEFG'[i], content: c })), answer: ['ABCDEFG'[n - 41]], knowledge_points: ['英语/阅读理解B（新题型）/小标题匹配'] }));
  const ref = ['如今许多人在家办公，这为他们节省了时间。', '公园变得比以往任何时候都更加重要。', '当孩子们被允许在户外玩耍时，他们学得最好。', '良好的公共交通让城市更宜居。', '规划者必须倾听当地居民的意见。'];
  const src = ['Many people now work from home, which saves them time.', 'Parks have become more important than ever before.', 'Children learn best when they are allowed to play outside.', 'Good public transport makes a city easier to live in.', 'Planners must listen to the people who live there.'];
  for (let n = 46; n <= 50; n++) qs.push(base(n, 'translation', 'translation', 2, { passage_id: P('translation'), stem: src[n - 46], answer: [ref[n - 46]], knowledge_points: ['英语/翻译/英译汉长难句拆分'] }));
  qs.push(base(51, 'writing_a', 'essay', 10, { passage_id: null, stem: 'Write an email to a friend inviting him to a city walk. Write about 100 words. Do not use your own name; use "Li Ming" instead.', answer: ['Dear Tom, I am writing to invite you to a city walk this Saturday ... Yours, Li Ming'], knowledge_points: ['英语/写作/小作文（书信、通知等）'] }));
  qs.push(base(52, 'writing_b', 'essay', 20, { passage_id: null, tables: [{ caption: 'Ways people spend weekends (%)', header: ['Activity', '2015', '2025'], rows: [['Gardening', '12', '31'], ['Shopping', '40', '22']], note: 'Source: a fictional survey' }],
    stem: 'Write an essay of 160-200 words based on the following table.\n{{table:0}}\n1) describe the table, 2) interpret its meaning, 3) give your comments.', answer: ['As is vividly shown in the picture, a family is working in a small garden ...'], knowledge_points: ['英语/写作/大作文（图画作文）'] }));
  return { qs, passages };
}
const ok = paper(2099);
fs.writeFileSync(path.join(dir, 'english1_2099.json'), JSON.stringify(ok.qs, null, 1) + '\n');
fs.writeFileSync(path.join(dir, 'english1_2099_passages.json'), JSON.stringify(ok.passages, null, 1) + '\n');
fs.writeFileSync(path.join(dir, 'reviews', 'english1_2099.jsonl'), ok.qs.map((q) => JSON.stringify({ id: q.id, status: 'confirmed', by: 'fixture', at: '2026-11-01T06:00-08:00', note: '测试夹具' })).join('\n') + '\n');
// 坏卷：翻译 15 分、阅读 B 给了跳号的 J 选项、一题挂错文章、少一题、文章 id 重复
const bad = paper(2098);
bad.qs[45].score = 15;                                   // 46 题 15 分 → en_score_invalid + 总分不对
bad.qs[40].options.push({ key: 'J', content: 'extra' }); bad.qs[40].answer = ['J'];   // 41 题：字母跳号 + 答案不是 A–H
bad.qs[50].tables = [{ header: ['a', 'b'], rows: [['1', '2', '3']] }, { rows: [] }]; bad.qs[50].stem += ' {{table:0}} {{table:3}}';   // 51 题：列数不对、空表、{{table:3}} 不存在、tables[1] 没引用
bad.qs[22].passage_id = 'english1-2098-P-nope';          // 23 题
bad.qs[30].passage_id = 'english1-2098-P-cloze';         // 31 题 section 不一致
bad.qs.splice(51, 1);                                     // 缺 52 题
bad.passages.push({ ...bad.passages[1] });               // 文章 id 重复
bad.passages[0].text += ' Extra blank {{21}}.';           // {{21}} 对不上完形题
bad.passages[6].text = bad.passages[6].text.replace(/<u data-q="50">([^<]*)<\/u>/, '$1');   // 第 50 题在文章里没有划线
fs.writeFileSync(path.join(dir, 'english1_2098.json'), JSON.stringify(bad.qs, null, 1) + '\n');
fs.writeFileSync(path.join(dir, 'english1_2098_passages.json'), JSON.stringify(bad.passages, null, 1) + '\n');
console.log('fixtures written', ok.qs.length, bad.qs.length);

// 数学概率题带表格（分布律），测表格在数学题里不触发 OCR / LaTeX 误报
const mq = { schema_version: '0.2', id: 'math1-2099-01', exam: 'math1', year: 2099, number: 1, section: '选择题', type: 'single_choice', score: 5,
  stem: '设随机变量 $X$ 的分布律为\n{{table:0}}\n则 $E(X)=$', tables: [{ header: ['$X$', '$0$', '$1$', '$2$'], rows: [['$P$', '$0.2$', '$0.5$', '$0.3$']] }],
  images: [], options: [{ key: 'A', content: '$1.1$' }, { key: 'B', content: '$1.0$' }, { key: 'C', content: '$0.9$' }, { key: 'D', content: '$1.2$' }], answer: ['A'], sub_questions: [], solution: null,
  knowledge_points: [], source: { fixture: true } };
// 整题计分规则：02 由 kp_tags 标成 score_by_whole 且给了 sub_scores → 忽略并提醒；03 按小问计分 → 套用 sub_scores
const mBase = (n, stem) => ({ schema_version: '0.2', id: `math1-2099-0${n}`, exam: 'math1', year: 2099, number: n, section: '解答题', type: 'essay', score: 12, stem, images: [], options: [],
  sub_questions: [{ number: 1, stem: '第一问', answer: ['略'] }, { number: 2, stem: '第二问', answer: ['略'] }], answer: [], solution: null, knowledge_points: [], source: { fixture: true } });
fs.writeFileSync(path.join(dir, 'math1_2099.json'), JSON.stringify([mq, mBase(2, '（本题满分 12 分）设 $f(x)$ 连续，求两问。'), mBase(3, '（本题满分 12 分）设 $g(x)=x^2$，求两问。')], null, 1) + '\n');
fs.writeFileSync(path.join(dir, 'math1_2099_kp_tags.json'), JSON.stringify({ source: 'math1_2099.json', tags: [], score_by_whole: ['math1-2099-02'], sub_scores: { 'math1-2099-02': [6, 6], 'math1-2099-03': [5, 7] } }, null, 1) + '\n');
