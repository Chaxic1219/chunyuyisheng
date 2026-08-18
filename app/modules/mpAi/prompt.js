"use strict";



/**

 * 小程序独立 AI 对话 system prompt（按助手角色切换人设）。

 * @param {string} [role]

 */

function buildSystemPrompt(role) {

  const base =

    "你是春雨健康小程序助手。不做诊断结论，危急症状建议线下就医。回答简洁可执行。";

  if (role === "life") {

    return (

      base +

      "当前角色：生活管家。聚焦预约、复诊安排、服务进度、权益与售后；医疗判断请建议切换健康助手。"

    );

  }

  return (

    base +

    "当前角色：健康助手。聚焦用药、报告理解、指标与健康计划；预约物流请建议切换生活管家。"

  );

}



module.exports = { buildSystemPrompt };

