# -*- coding: utf-8 -*-
"""生产库：分析周玉春/王云程「群友」占位档案。在服务器上直接跑。"""
import sqlite3
import sys

DB = "/var/lib/chunyu-doctor/data.db"


def main():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    # schema sniff
    def cols(table):
        return [r[1] for r in con.execute(f"PRAGMA table_info({table})").fetchall()]

    print("COLS patients", cols("patients"))
    print("COLS message_log", cols("message_log")[:30])
    print("COLS community_messages", cols("community_messages")[:30])
    print("COLS community_members", cols("community_members"))

    docs = con.execute(
        "SELECT id,slug,name FROM doctors WHERE slug IN ('zhouyuchun','wangyuncheng') "
        "OR name LIKE '%周玉春%' OR name LIKE '%王云程%'"
    ).fetchall()
    print("DOCTORS", [dict(d) for d in docs])

    for d in docs:
        did = d["id"]
        print(f"\n==== doctor {did} {d['name']} ====")
        groups = con.execute(
            "SELECT g.id,g.name,g.external_group_id,g.member_count,g.data_source,"
            "g.is_business,g.qiwe_hidden,g.last_synced_at "
            "FROM community_groups g WHERE g.doctor_id=? "
            "OR g.id IN (SELECT group_id FROM community_group_doctors WHERE doctor_id=?) "
            "ORDER BY g.id",
            (did, did),
        ).fetchall()
        print("GROUPS", len(groups))
        for g in groups:
            print(" ", dict(g))

        patients = con.execute(
            "SELECT p.id,p.display_name,p.real_name,"
            "CASE WHEN p.avatar_url IS NOT NULL AND trim(p.avatar_url)!='' THEN 1 ELSE 0 END AS has_avatar,"
            "p.created_at,p.updated_at,p.phone,p.phone_verified "
            "FROM patients p WHERE p.doctor_id=? ORDER BY p.id DESC LIMIT 40",
            (did,),
        ).fetchall()
        print("PATIENTS", len(patients))
        for p in patients:
            idents = con.execute(
                "SELECT channel,external_id FROM patient_identities WHERE patient_id=?",
                (p["id"],),
            ).fetchall()
            msg_c = con.execute(
                "SELECT COUNT(*) c FROM message_log WHERE doctor_id=? AND "
                "(patient_id=? OR CAST(patient_id AS TEXT)=?)",
                (did, p["id"], str(p["id"])),
            ).fetchone()["c"]
            print(
                " ",
                dict(p),
                "idents=",
                [dict(i) for i in idents],
                "msg_c=",
                msg_c,
            )

        placeholders = con.execute(
            "SELECT p.id,p.display_name,p.real_name,p.created_at,p.updated_at,"
            "CASE WHEN p.avatar_url IS NOT NULL AND trim(p.avatar_url)!='' THEN 1 ELSE 0 END AS has_avatar "
            "FROM patients p WHERE p.doctor_id=? AND ("
            "p.display_name IS NULL OR trim(p.display_name)='' OR "
            "p.display_name IN ('群友','好友','企微患者','新朋友','新成员','微信用户','患者','未知','匿名','企微用户') OR "
            "p.display_name LIKE '群友%' OR p.display_name LIKE '%·企微'"
            ") ORDER BY p.id",
            (did,),
        ).fetchall()
        print("PLACEHOLDERISH", len(placeholders))
        for p in placeholders:
            print(" P", dict(p))
            idents = con.execute(
                "SELECT channel,external_id FROM patient_identities WHERE patient_id=?",
                (p["id"],),
            ).fetchall()
            for ident in idents:
                print("  ident", dict(ident))
                mems = con.execute(
                    "SELECT id,group_id,external_user_id,display_name,status,data_source,"
                    "joined_at,last_synced_at FROM community_members "
                    "WHERE doctor_id=? AND external_user_id=? ORDER BY id DESC",
                    (did, ident["external_id"]),
                ).fetchall()
                print("  members", [dict(m) for m in mems])
                # recent message_log
                try:
                    msgs = con.execute(
                        "SELECT id,substr(COALESCE(text,content,''),1,100) AS t,"
                        "created_at,direction,is_group,sender_id,patient_name "
                        "FROM message_log WHERE doctor_id=? AND "
                        "(patient_id=? OR CAST(patient_id AS TEXT)=? OR sender_id=?) "
                        "ORDER BY id DESC LIMIT 5",
                        (did, p["id"], str(p["id"]), ident["external_id"]),
                    ).fetchall()
                    print("  msgs", [dict(m) for m in msgs])
                except Exception as e:
                    # fallback column set
                    msgs = con.execute(
                        "SELECT * FROM message_log WHERE doctor_id=? AND "
                        "(patient_id=? OR CAST(patient_id AS TEXT)=? OR sender_id=?) "
                        "ORDER BY id DESC LIMIT 2",
                        (did, p["id"], str(p["id"]), ident["external_id"]),
                    ).fetchall()
                    print("  msgs_raw_err", str(e), [dict(m) for m in msgs])

        mem_all = con.execute(
            "SELECT m.id,m.group_id,g.name AS group_name,m.external_user_id,m.display_name,"
            "m.status,m.data_source,m.joined_at,m.last_synced_at "
            "FROM community_members m LEFT JOIN community_groups g ON g.id=m.group_id "
            "WHERE m.doctor_id=? ORDER BY m.id DESC LIMIT 50",
            (did,),
        ).fetchall()
        print("COMMUNITY_MEMBERS", len(mem_all))
        for m in mem_all:
            print(" ", dict(m))

    con.close()
    print("DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
