/** 知识条目上线前质量检查（前后端共用） */

function validateKnowledgeQuality(item, strategy) {
  const warnings = [];
  if (String(item && item.status || "") !== "ready") return warnings;
  const body = String(item.body || "").trim();
  const title = String(item.title || "").trim();
  if (!title) warnings.push("标题为空");
  if (body.length < 20) {
    warnings.push("正文过短（不足20字），可能不足以支撑 RAG 检索");
  }
  if (!/仅供参考|请咨询|就医|医生|医助|门诊|急诊|医院/.test(body)) {
    warnings.push("建议包含就医引导或免责表述（如「仅供参考」「请咨询医生」）");
  }
  const policy = String(strategy && strategy.private_chat_policy || "");
  if (/不主动.*私聊|不加.*微信|不主动加/.test(policy) && /加微信|私聊我|扫码加|加我微信/.test(body)) {
    warnings.push("正文含私聊/加微信引导，与策略「私聊边界」可能冲突");
  }
  return warnings;
}

function knowledgeLayerSeedRows(d, nowIso) {
  const ts = nowIso || new Date().toISOString();
  return [
    ["医院通用", "预制菜", "医院就医基础信息", `${d.hospital || "医院"}地址、挂号规则、门诊电话、医保/病案复印/住院流程等通用信息。如需具体号码与地址，请以医院官网或门诊公布为准；仅供参考，请咨询医生或医助。`, "医院服务号/官网", "平台运营", "ready"],
    ["医院/科室通用", "预制菜", "科室常见问题与就医路径", `${d.dept || "科室"}常见病种、检查前准备、复诊节奏、住院/手术宣教和FAQ。个人病情判断以面诊为准；仅供参考，请咨询医生。`, "科室模板", "医学运营", "ready"],
    ["医生个人", "半预制", "医生个人主页与科普素材", `${d.name}医生的擅长方向、出诊时间、个人科普、病例分享、感谢信和可分享海报。`, "医生/助理提供", "医生运营", "draft"],
    ["群运营动态", "现炒菜", "本周群运营动作", "每周科普、门诊变化、停诊/加号、患者高频问题和群内舆情处理。", "运营实时整理", "群运营", "draft"]
  ].map((x) => ({
    layer: x[0],
    mode: x[1],
    title: x[2],
    body: x[3],
    source: x[4],
    owner: x[5],
    status: x[6],
    updated_at: ts
  }));
}

/** health_chat 验收用可检索知识（按标题幂等补齐，不覆盖已有同名条目） */
function healthChatDemoKnowledgeRows(d, nowIso) {
  const ts = nowIso || new Date().toISOString();
  const dept = d && d.dept ? String(d.dept) : "消化相关科室";
  const hospital = d && d.hospital ? String(d.hospital) : "医院";
  return [
    {
      layer: "医院/科室通用",
      mode: "预制菜",
      title: "胆囊切除术后饮食要点",
      body: "胆囊切除术后饮食宜清淡、少油少辣。术后早期可从流食/半流食过渡，逐步恢复鸡蛋、瘦肉、鱼类等优质蛋白；避免油炸、动物内脏和高脂餐。若出现持续腹痛、发热、黄疸或呕吐加重，请及时就医或急诊。内容仅供参考，请咨询医生。",
      source: "科室宣教模板",
      owner: "医学运营",
      status: "ready",
      updated_at: ts
    },
    {
      layer: "医院/科室通用",
      mode: "预制菜",
      title: "腹痛自我观察与就医提示",
      body: "出现腹痛时，建议先记录部位（上腹/下腹/脐周）、持续时长、是否加重，以及有无发热、呕吐、黑便或呕血。轻症可先休息观察；若剧痛、持续加重、伴高热或急症表现，请优先线下就医或拨打120。群内说明不能替代面诊，仅供参考，请咨询医生或医助。",
      source: "科室宣教模板",
      owner: "医学运营",
      status: "ready",
      updated_at: ts
    },
    {
      layer: "医院/科室通用",
      mode: "预制菜",
      title: `${hospital}门诊与复诊一般说明`,
      body: `${hospital}${dept}就诊前建议携带既往检查资料与用药清单；复诊请尽量按医嘱时间前往。挂号/加号/住院预约以医院当面公布与团队入口为准。急症请优先急诊通道。仅供参考，请咨询医生或医助。`,
      source: "医院服务说明",
      owner: "平台运营",
      status: "ready",
      updated_at: ts
    },
    {
      layer: "医院/科室通用",
      mode: "预制菜",
      title: "腹痛伴发热何时就医",
      body: "下腹或全腹痛若变为持续性，并出现发热，提示可能存在感染或急腹症风险，建议尽快到医院外科/急诊当面评估，不要只在家观察。就医前可记录体温、疼痛部位和开始时间；途中若剧痛加重、持续高热、频繁呕吐或意识变差，请直接急诊或拨打120。内容仅供参考，请咨询医生。",
      source: "科室宣教模板",
      owner: "医学运营",
      status: "ready",
      updated_at: ts
    }
  ];
}

module.exports = { validateKnowledgeQuality, knowledgeLayerSeedRows, healthChatDemoKnowledgeRows };
