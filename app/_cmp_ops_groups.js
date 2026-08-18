const {db}=require("./db.js");
const row=db.prepare("SELECT published_json FROM ops_configs WHERE doctor_id=1 AND domain='doctor_group'").get();
const pub=JSON.parse(row.published_json||"{}");
console.log("ops_config_groups", JSON.stringify((pub.groups||[]).map(g=>({id:g.id,name:g.name,ext:g.externalGroupId})),null,2));
const live=db.prepare("SELECT id,name,external_group_id,status,is_business,data_source FROM community_groups WHERE doctor_id=1 ORDER BY id").all();
console.log("live_groups", JSON.stringify(live,null,2));
