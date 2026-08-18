# -*- coding: utf-8 -*-
from pathlib import Path
import re

p = Path(r"c:\Users\11\Desktop\www\chunyu-doctor-review\app\modules\qiwe\delivery.js")
text = p.read_text(encoding="utf-8")

# 1) relax weappCodes filter
pat = re.compile(
    r"  const weappCodes = Array\.isArray\(q\.weappCodes\)\n"
    r"    \? q\.weappCodes\.map\(x=>\{\n"
    r"        const c = String\(x \|\| \"\"\)\.trim\(\);\n"
    r"        return c === \".+?\" \? \"979\" : c;\n"
    r"      \}\)\.filter\(\(x, i, arr\)=>x && WELCOME_WEAPP_CODES\.includes\(x\) && arr\.indexOf\(x\) === i\)\n"
    r"    : \[\];",
    re.M,
)
m = pat.search(text)
if not m:
    raise SystemExit("weappCodes block not found")
orig = m.group(0)
# keep Chinese mapping line
map_line = re.search(r"return c === \".+?\" \? \"979\" : c;", orig).group(0)
repl = f'''  const outboxSource = String(payload.source || q.source || "");
  const weappCodes = Array.isArray(q.weappCodes)
    ? q.weappCodes.map(x=>{{
        const c = String(x || "").trim();
        {map_line}
      }}).filter((x, i, arr)=>{{
        if(!x || arr.indexOf(x) !== i) return false;
        if(outboxSource === "welcome") return WELCOME_WEAPP_CODES.includes(x);
        return true;
      }})
    : [];'''
text = text[:m.start()] + repl + text[m.end():]

# 2) use loadSendableWeappTemplate in weappCodes loop
old_load = "const cardTpl = loadWelcomeWeappTemplate(doctorId, c);"
if old_load not in text:
    raise SystemExit("loadWelcomeWeappTemplate call not found")
text = text.replace(old_load, "const cardTpl = loadSendableWeappTemplate(doctorId, c);", 1)

p.write_text(text, encoding="utf-8")
print("delivery.js patched")
