"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, `_qiwe_group_name_${process.pid}.db`);
process.env.DB_PATH = dbPath;
process.env.QIWE_DRY_RUN = "1";

(async () => {
  const { db } = require("./db.js");
  const repo = require("./modules/community/repo.js");
  const qiweSync = require("./qiwe_sync.js");
  const qiwe = require("./qiwe.js");
  const callback = require("./modules/qiwe/callback.js");
  const doctor = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get();
  const group = repo.insertGroup({
    doctorId: doctor.id, channelType: "qiwe", externalGroupId: "room-rename-1",
    name: "旧群名", owner: "owner-keep", memberCount: 7, status: "pilot",
    isBusiness: true, dataSource: "qiwe", reviewMode: "human_review"
  });
  const api = async (method, params) => {
    assert.equal(method, "/room/batchGetRoomDetail");
    assert.deepEqual(params.roomIdList, ["room-rename-1"]);
    return { code: 200, data: { roomList: [{
      roomId: "room-rename-1",
      roomName: Buffer.from("新群名").toString("base64"),
      roomOwnerId: "owner-change-must-ignore",
      roomMemberCount: 99,
      memberList: [{ userId: "must-not-sync" }]
    }] } };
  };
  const synced = await qiweSync.syncRoomName({ roomId: "room-rename-1", api });
  assert.equal(synced.changed, true);
  let row = repo.getGroupById(group.id);
  assert.equal(row.name, "新群名");
  assert.equal(row.owner, "owner-keep");
  assert.equal(row.member_count, 7);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM community_members WHERE group_id=?").get(group.id).c, 0);

  db.prepare("UPDATE community_groups SET name='回调前群名' WHERE id=?").run(group.id);
  const oldDoApi = qiwe.doApi;
  qiwe.doApi = api;
  const result = await callback.processEvent({
    cmd: 15000, msgType: 1000, isRoomNotice: 1, fromRoomId: "room-rename-1",
    senderId: "member-1", receiverId: "self-1", userId: "self-1",
    msgUniqueIdentifier: "rename-event-1", msgData: {}
  }, {
    enabled: true, token: "token", guid: "guid", allowGroup: true,
    selfUserId: "self-1", doctorId: doctor.id, testToId: "room-rename-1"
  });
  qiwe.doApi = oldDoApi;
  assert.equal(result.skipped, "room_name_notice_processed");
  row = repo.getGroupById(group.id);
  assert.equal(row.name, "新群名");
  assert.equal(row.owner, "owner-keep");
  assert.equal(row.member_count, 7);
  console.log("qiwe group name sync PASS");
  setTimeout(() => {
    try { db.close(); } catch (e) {}
    [dbPath, dbPath + "-wal", dbPath + "-shm"].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });
  }, 30);
})().catch((e) => { console.error(e); process.exit(1); });
