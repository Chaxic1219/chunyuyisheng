# -*- coding: utf-8 -*-
import sqlite3
DB="/var/lib/chunyu-doctor/data.db"
con=sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
con.row_factory=sqlite3.Row

uids=[
  "7881300070922160",
  "7881301156913033",
  "7881301675338437",
  "7881302857951821",
  "1688856409808606",
]

print("=== cross-doctor identity map ===")
for uid in uids:
  print("UID", uid)
  mems=con.execute(
    "SELECT m.id,m.doctor_id,d.name AS doctor,m.group_id,g.name AS gname,m.display_name,m.status,m.joined_at,m.data_source "
    "FROM community_members m "
    "LEFT JOIN doctors d ON d.id=m.doctor_id "
    "LEFT JOIN community_groups g ON g.id=m.group_id "
    "WHERE m.external_user_id=? ORDER BY m.id", (uid,)
  ).fetchall()
  for m in mems: print("  mem", dict(m))
  idents=con.execute(
    "SELECT pi.patient_id,pi.doctor_id,d.name AS doctor,pi.channel,pi.external_id,p.display_name,p.created_at "
    "FROM patient_identities pi "
    "LEFT JOIN patients p ON p.id=pi.patient_id "
    "LEFT JOIN doctors d ON d.id=pi.doctor_id "
    "WHERE pi.external_id=? ORDER BY pi.patient_id", (uid,)
  ).fetchall()
  for i in idents: print("  ident", dict(i))
  msgs=con.execute(
    "SELECT id,doctor_id,patient_id,patient_name,sender_id,direction,substr(COALESCE(text,''),1,60) t,group_id,created_at "
    "FROM message_log WHERE sender_id=? ORDER BY id DESC LIMIT 8", (uid,)
  ).fetchall()
  print("  msg_log", [dict(x) for x in msgs])

print("\n=== archive counters for placeholders ===")
for did, label in [(4,"zhou"), (5,"wang")]:
  rows=con.execute(
    "SELECT p.id,p.display_name,"
    "(SELECT COUNT(*) FROM message_log m WHERE m.doctor_id=p.doctor_id AND CAST(m.patient_id AS TEXT)=CAST(p.id AS TEXT)) AS msg_log,"
    "(SELECT COUNT(*) FROM community_messages cm WHERE cm.doctor_id=p.doctor_id AND cm.member_id IN "
    "(SELECT id FROM community_members mm WHERE mm.doctor_id=p.doctor_id AND mm.external_user_id IN "
    "(SELECT external_id FROM patient_identities pi WHERE pi.patient_id=p.id))) AS cmsg_by_member,"
    "(SELECT COUNT(*) FROM submissions s WHERE s.doctor_id=p.doctor_id AND s.patient_id=p.id) AS subs "
    "FROM patients p WHERE p.doctor_id=? AND p.display_name IN ('企微患者','群友')",
    (did,)
  ).fetchall()
  print(label, [dict(r) for r in rows])

print("\n=== wang group 709 members aka ===")
for m in con.execute(
  "SELECT external_user_id,display_name,joined_at FROM community_members WHERE group_id=709 ORDER BY joined_at"
).fetchall():
  uid=m["external_user_id"]
  other=con.execute(
    "SELECT DISTINCT doctor_id,display_name FROM community_members WHERE external_user_id=? AND IFNULL(display_name,'') NOT IN ('','企微患者','群友')",
    (uid,)
  ).fetchall()
  pats=con.execute(
    "SELECT DISTINCT p.doctor_id,p.display_name FROM patients p JOIN patient_identities pi ON pi.patient_id=p.id WHERE pi.external_id=?",
    (uid,)
  ).fetchall()
  print(dict(m), "aka_mem=", [dict(x) for x in other], "aka_pat=", [dict(x) for x in pats])

print("\n=== zhou group 701 recent ===")
for m in con.execute(
  "SELECT external_user_id,display_name,joined_at FROM community_members WHERE group_id=701 ORDER BY datetime(joined_at) DESC LIMIT 12"
).fetchall():
  uid=m["external_user_id"]
  other=con.execute(
    "SELECT DISTINCT doctor_id,display_name FROM community_members WHERE external_user_id=? AND IFNULL(display_name,'') NOT IN ('','企微患者','群友')",
    (uid,)
  ).fetchall()
  print(dict(m), "aka=", [dict(x) for x in other])

print("\n=== join welcome / room seen ===")
try:
  print("qiwe_room_member_seen cols", [r[1] for r in con.execute("PRAGMA table_info(qiwe_room_member_seen)").fetchall()])
  rows=con.execute(
    "SELECT * FROM qiwe_room_member_seen WHERE user_id IN (?,?,?,?,?) ORDER BY id DESC LIMIT 30",
    uids
  ).fetchall()
  print([dict(r) for r in rows])
except Exception as e:
  print("seen_err", e)

# community_messages around Aug 4-5 for these groups
print("\n=== community_messages around placeholder joins ===")
for gid in (701, 709):
  rows=con.execute(
    "SELECT id,doctor_id,group_id,sender_name,msg_type,substr(COALESCE(text,''),1,100) t,created_at "
    "FROM community_messages WHERE group_id=? AND created_at>='2026-08-04' ORDER BY id LIMIT 40",
    (gid,)
  ).fetchall()
  print("group", gid, "count", len(rows))
  for r in rows: print(" ", dict(r))

con.close()
print("DONE")
