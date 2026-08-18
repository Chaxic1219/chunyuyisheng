# -*- coding: utf-8 -*-
import json
from pathlib import Path

path = Path(
    r"C:\Users\11\.cursor\projects\c-Users-11-Desktop-www\agent-transcripts"
    r"\811121bc-aea3-4352-b0e0-b388dcafd683\811121bc-aea3-4352-b0e0-b388dcafd683.jsonl"
)
out = Path(
    r"c:\Users\11\Desktop\www\chunyu-doctor-review\admin-ui\src\views\chunyu\qiwe\_recovered_cover_index.vue"
)
# line 319 is 1-indexed
with path.open("r", encoding="utf-8") as f:
    for i, line in enumerate(f, 1):
        if i != 319:
            continue
        obj = json.loads(line)
        for c in obj["message"]["content"]:
            if c.get("name") == "Write":
                out.write_text(c["input"]["contents"], encoding="utf-8")
                print("wrote", len(c["input"]["contents"]), "to", out)
                print("path was", c["input"].get("path"))
