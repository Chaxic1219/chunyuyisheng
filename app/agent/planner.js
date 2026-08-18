/* Planner：根据理解与临床档产出 intended_action + tool_calls */
const triage = require("../triage.js");

function plan(understood, clinicalRisk, emergency, opts){
  opts = opts || {};
  const level = opts.level;
  // level 由 runtime 传入；缺省 fail-closed 不附卡（避免旧调用误发卡）
  const allowCard = opts.allowCard != null
    ? !!opts.allowCard
    : (level != null && triage.canAttachMiniProgram(level));
  const service = understood && understood.service;
  const medical = !!(understood && understood.medicalIntent);
  const slots = (understood && understood.slots) || {};

  if(emergency || clinicalRisk === "high"){
    return {
      intendedAction:"emergency_safe",
      goal:"safety",
      toolCalls:[],
      preferredCode:null,
      hasMedicalAdviceText:false,
      handoff:true
    };
  }

  // 图片/报告：不在群内解读；仅 L2 可附卡，否则建议 + 转人工
  if(slots.hasAttachment || (understood.attachmentHints || []).length){
    if(allowCard){
      return {
        intendedAction:"open_chunyu_card",
        goal:"consult",
        toolCalls:[
          { name:"reply_text", args:{ tone:"handoff_soft" } },
          { name:"open_chunyu_card", args:{ code:"101" } },
          { name:"handoff_human", args:{ reason:"attachment_review" } }
        ],
        preferredCode:"101",
        hasMedicalAdviceText:false,
        handoff:true,
        note:"attachment"
      };
    }
    return {
      intendedAction:"reply_advice",
      goal:"advice",
      toolCalls:[
        { name:"reply_text", args:{ tone:"advice" } },
        { name:"handoff_human", args:{ reason:"attachment_review" } }
      ],
      preferredCode:null,
      hasMedicalAdviceText:false,
      handoff:true,
      note:"attachment_no_card"
    };
  }

  if(opts.healthChat && !slots.hasAttachment && !(understood.attachmentHints || []).length){
    const personaHint = understood && understood.healthcarePersona;
    const contPhase = opts.chatPhase;
    const continueHc = contPhase === "intake" || contPhase === "educate" || contPhase === "advise"
      || contPhase === "followup" || contPhase === "escalate" || contPhase === "route" || contPhase === "identity";
    const medicalForChat = medical || !!personaHint
      || !!(slots.hasMedicalCue || slots.asksMedication)
      || continueHc;
    // 会话续轮中的「找医生」仍走 health_chat.route，便于文案提示回复 101
    const pureService = !!(service && service.preferredCode && !medicalForChat
      && service.goal !== "menu")
      && !(continueHc && service && service.goal === "consult");
    if(medicalForChat && !pureService){
      if(slots.asksMedication || contPhase === "escalate"){
        return {
          intendedAction:"health_chat",
          goal:"health_chat",
          toolCalls:[{ name:"reply_text", args:{ tone:"health_chat" } }],
          preferredCode:null,
          hasMedicalAdviceText:false,
          handoff:true,
          note:"health_chat_med_escalate",
          chatPhaseHint:"escalate"
        };
      }
      if(service && service.goal === "consult" && continueHc){
        return {
          intendedAction:"health_chat",
          goal:"health_chat",
          toolCalls:[{ name:"reply_text", args:{ tone:"health_chat" } }],
          preferredCode:null,
          hasMedicalAdviceText:false,
          handoff:true,
          note:"health_chat_route",
          chatPhaseHint:"route"
        };
      }
      return {
        intendedAction:"health_chat",
        goal:"health_chat",
        toolCalls:[{ name:"reply_text", args:{ tone:"health_chat" } }],
        preferredCode:null,
        hasMedicalAdviceText:false,
        handoff:false,
        note: continueHc ? "health_chat_continue" : "health_chat",
        chatPhaseHint: (contPhase === "educate" || contPhase === "advise") ? "advise"
          : (contPhase === "followup" ? "followup" : "intake")
      };
    }
  }

  const persona = understood && understood.healthcarePersona;
  if(persona && !service){
    const tone = persona.tone || persona.goal;
    const goal = persona.goal;
    const needHandoff = persona.key !== "care_plan" || clinicalRisk !== "low" || !!slots.worsening;
    if(allowCard && needHandoff){
      return {
        intendedAction:"open_chunyu_card",
        goal,
        toolCalls:[
          { name:"reply_text", args:{ tone } },
          { name:"open_chunyu_card", args:{ code:"101" } },
          { name:"handoff_human", args:{ reason:"persona_" + persona.key } }
        ],
        preferredCode:"101",
        hasMedicalAdviceText:false,
        handoff:true,
        note:"healthcare_persona",
        personaKey: persona.key
      };
    }
    return {
      intendedAction:"reply_advice",
      goal,
      toolCalls:[
        { name:"reply_text", args:{ tone } },
        ...(needHandoff ? [{ name:"handoff_human", args:{ reason:"persona_" + persona.key } }] : [])
      ],
      preferredCode:null,
      hasMedicalAdviceText:false,
      handoff: needHandoff,
      note: allowCard ? "healthcare_persona" : "healthcare_persona_no_card",
      personaKey: persona.key
    };
  }

  // 要开药 / 明确医疗诉求且无单纯「去问诊」→ handoff；L2 可附卡
  if(slots.asksMedication || (medical && clinicalRisk === "medium" && !service)){
    if(allowCard){
      const tools = [
        { name:"reply_text", args:{ tone:"handoff_soft" } }
      ];
      if(service && service.preferredCode){
        tools.push({ name:"open_chunyu_card", args:{ code:service.preferredCode } });
      }else if(medical){
        tools.push({ name:"open_chunyu_card", args:{ code:"101" } });
      }
      tools.push({ name:"handoff_human", args:{ reason:"medical_review" } });
      return {
        intendedAction: tools.some(t=>t.name === "open_chunyu_card") && clinicalRisk === "medium" ? "open_chunyu_card" : "handoff",
        goal: service && service.goal || "medical_handoff",
        toolCalls:tools,
        preferredCode: (service && service.preferredCode) || (medical ? "101" : null),
        hasMedicalAdviceText:false,
        handoff:true,
        note:"pending_medical"
      };
    }
    return {
      intendedAction:"reply_advice",
      goal: service && service.goal || "advice",
      toolCalls:[
        { name:"reply_text", args:{ tone:"advice" } },
        { name:"handoff_human", args:{ reason:"medical_review" } }
      ],
      preferredCode:null,
      hasMedicalAdviceText:false,
      handoff:true,
      note:"pending_medical_no_card"
    };
  }

  if(service && service.goal === "menu"){
    return {
      intendedAction:"open_menu",
      goal:"menu",
      toolCalls:[{ name:"open_menu", args:{} }, { name:"reply_text", args:{ tone:"guide" } }],
      preferredCode:null,
      hasMedicalAdviceText:false,
      handoff:false
    };
  }

  if(service && service.preferredCode){
    if(allowCard){
      return {
        intendedAction:"open_chunyu_card",
        goal:service.goal,
        toolCalls:[
          { name:"reply_text", args:{ tone: (medical && (slots.hasMedicalCue || slots.asksMedication)) ? "handoff_soft" : "service" } },
          { name:"open_chunyu_card", args:{ code:service.preferredCode } }
        ],
        preferredCode:service.preferredCode,
        hasMedicalAdviceText:false,
        handoff:!!(medical && (slots.hasMedicalCue || slots.asksMedication))
      };
    }
    // 非 L2：纯服务不走医疗 advice；仅医疗线索才 advice + handoff
    const needHandoff = !!(slots.hasMedicalCue || slots.asksMedication);
    if(needHandoff){
      return {
        intendedAction:"reply_advice",
        goal: service.goal,
        toolCalls:[
          { name:"reply_text", args:{ tone:"advice" } },
          { name:"handoff_human", args:{ reason:"medical_cue" } }
        ],
        preferredCode:null,
        hasMedicalAdviceText:false,
        handoff:true,
        note:"service_medical_no_card"
      };
    }
    return {
      intendedAction:"reply_service",
      goal: service.goal,
      toolCalls:[{ name:"reply_text", args:{ tone:"service" } }],
      preferredCode:null,
      hasMedicalAdviceText:false,
      handoff:false,
      note:"service_no_card"
    };
  }

  if(medical){
    if(allowCard){
      return {
        intendedAction:"open_chunyu_card",
        goal:"consult",
        toolCalls:[
          { name:"reply_text", args:{ tone:"handoff_soft" } },
          { name:"open_chunyu_card", args:{ code:"101" } },
          { name:"handoff_human", args:{ reason:"medical_cue" } }
        ],
        preferredCode:"101",
        hasMedicalAdviceText:false,
        handoff:true
      };
    }
    return {
      intendedAction:"reply_advice",
      goal:"advice",
      toolCalls:[
        { name:"reply_text", args:{ tone:"advice" } },
        { name:"handoff_human", args:{ reason:"medical_cue" } }
      ],
      preferredCode:null,
      hasMedicalAdviceText:false,
      handoff:true,
      note:"medical_no_card"
    };
  }

  // 未识别：澄清，不静默（群门控已过滤纯闲聊）
  return {
    intendedAction:"ask_clarify",
    goal:"clarify",
    toolCalls:[
      { name:"ask_clarify", args:{} },
      { name:"reply_text", args:{ tone:"clarify" } }
    ],
    preferredCode:null,
    hasMedicalAdviceText:false,
    handoff:false
  };
}

module.exports = { plan };
