function cleanText(v, n){ return String(v == null ? "" : v).replace(/\s+\n/g, "\n").trim().slice(0, n || 1200); }
function realMentionName(v){ const s = cleanText(v, 80); return s.replace(/^[@\uff20]\s*/u, "").trim(); }

function extractJoinMemberName(text){
  const rawText = cleanText(text, 1000);
  if(!rawText) return "";
  const quotedPatterns = [
    /邀请[\u201c\u201d"\u300c]([^"\u201c\u201d\u300c\u300d]{1,40})[\u201c\u201d"\u300d]加入(?:了)?(?:外部)?群聊/,
    /[\u201c\u201d"\u300c]([^"\u201c\u201d\u300c\u300d]{1,40})[\u201c\u201d"\u300d]通过扫描.*?二维码加入(?:了)?(?:外部)?群聊/,
  ];
  for(const re of quotedPatterns){
    const m = rawText.match(re);
    const name = realMentionName(m && m[1]);
    if(name && !/^(?:你|您|我|大家|各位|群友|新朋友)$/.test(name)) return name;
  }
  const t = rawText.replace(/[\u201c\u201d]/g, "");
  const patterns = [
    /邀请(?:了)?(?:微信的|企业微信的|微信用户|外部联系人)?([^，,。\s「」]{1,40})加入(?:了)?(?:外部)?群聊/,
    /(?:你|您|我|管理员|群主)?邀请了?([^，,。\s「」]{1,40})加入(?:了)?(?:外部)?群聊/,
    /([^，,。\s「」]{1,40})通过扫描.*?二维码加入(?:了)?(?:外部)?群聊/,
    /(?:^|[\n\r\s])(?:@)?([^，,。\s「」]{1,40})\s*您好[，,、\s]*欢迎加入/,
    /欢迎\s*@([^，,。\s「」]{1,40})\s*加入/,
    /欢迎\s*([^，,。\s「」]{1,40})\s*加入(?:了)?(?:本|本群|群聊|外部群聊)/
  ];
  for(const re of patterns){
    const m = t.match(re);
    const name = realMentionName(m && m[1]);
    if(name && !/^(?:你|您|我|大家|各位|群友|新朋友)$/.test(name)) return name;
  }
  return "";
}

const cases = [
  ['\u4f60\u9080\u8bf7\u201cC\u201d\u52a0\u5165\u4e86\u7fa4\u804a', 'C'],
  ['你邀请「C」加入了群聊', 'C'],
  ['你邀请了"张三"加入了群聊', '张三'],
  ['邀请张三加入群聊', '张三'],
  ['C 您好，欢迎加入吕主任消化健康群', 'C'],
  ['"小明"通过扫描群二维码加入群聊', '小明'],
  ['你邀请"李四"加入了外部群聊', '李四'],
];

let pass = 0, fail = 0;
for(const [input, expected] of cases){
  const got = extractJoinMemberName(input);
  const ok = got === expected;
  console.log(ok ? '✓' : '✗', JSON.stringify(input), '->', JSON.stringify(got), ok ? '' : `(expected ${JSON.stringify(expected)})`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${cases.length} passed`);
