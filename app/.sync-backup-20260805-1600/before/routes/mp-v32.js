"use strict";
const mpAuth = require("../mp_auth.js");
const { bearerToken } = require("./mp-auth.js");
const { createMpV32 } = require("../modules/mpV32");

function registerMpV32Routes(route, ctx) {
  const { parseBody, json, MESSAGE_MAX_BODY, db, profileStore, patientProfile } = ctx;
  const mpV32 = createMpV32(db, { profileStore, patientProfile });

  function requirePerson(req, res) {
    const token = bearerToken(req);
    if (!token) {
      json(res, 401, { error: "unauthorized" });
      return null;
    }
    try {
      return mpAuth.requireBoundSession(token);
    } catch (e) {
      json(res, 401, { error: "unauthorized" });
      return null;
    }
  }

  function loadHealthRecords(personId) {
    try {
      return db
        .prepare(
          `SELECT * FROM patient_health_records WHERE person_id=? ORDER BY id DESC LIMIT 100`
        )
        .all(personId);
    } catch (e) {
      return [];
    }
  }

  function loadProfile(personId) {
    try {
      const person = db.prepare(`SELECT * FROM persons WHERE id=?`).get(personId);
      return {
        name:
          (person &&
            (person.real_name || person.name || person.display_name || "")) ||
          "",
      };
    } catch (e) {
      return { name: "" };
    }
  }

  route("GET", /^\/api\/mp\/v32\/home-feed$/, (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const personId = +sess.person_id;
    const plan = mpV32.repo.getActivePlan(personId);
    const tasks = plan ? mpV32.repo.ensureTodayTasks(personId, plan) : [];
    const data = mpV32.buildHomeFeed({
      personId,
      profile: loadProfile(personId),
      plan,
      tasks,
      confirmations: mpV32.repo.listConfirmations(personId),
      healthRecords: loadHealthRecords(personId),
    });
    json(res, 200, { data });
  });

  route("GET", /^\/api\/mp\/v32\/mine-assets$/, (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const personId = +sess.person_id;
    json(res, 200, {
      data: mpV32.buildMineAssets({
        personId,
        plan: mpV32.repo.getActivePlan(personId),
        confirmations: mpV32.repo.listConfirmations(personId),
        healthRecords: loadHealthRecords(personId),
        family: mpV32.repo.listFamily(personId),
      }),
    });
  });

  route("GET", /^\/api\/mp\/v32\/records$/, (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const personId = +sess.person_id;
    json(res, 200, {
      data: mpV32.buildRecordList({
        personId,
        profile: loadProfile(personId),
        confirmations: mpV32.repo.listConfirmations(personId),
        healthRecords: loadHealthRecords(personId),
      }),
    });
  });

  route("POST", /^\/api\/mp\/v32\/records\/([^/]+)\/confirmations$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    const sourceKey = decodeURIComponent(m[1]);
    const list = mpV32.repo.upsertConfirmation(+sess.person_id, sourceKey, b.payload || b);
    json(res, 200, { data: { confirmations: list } });
  });

  route("POST", /^\/api\/mp\/v32\/plans\/generate$/, async (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const personId = +sess.person_id;
    const draft = mpV32.generatePlanDraft({
      confirmations: mpV32.repo.listConfirmations(personId),
      healthRecords: loadHealthRecords(personId),
      profile: loadProfile(personId),
    });
    if (!draft.ok) return json(res, 400, { error: draft.reason, missing: draft.missing });
    const plan = mpV32.repo.insertPlanWithItems(personId, draft);
    json(res, 200, { data: { plan } });
  });

  route("GET", /^\/api\/mp\/v32\/plans\/current$/, (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const personId = +sess.person_id;
    let plan = mpV32.repo.getActivePlan(personId);
    if (!plan) {
      try {
        plan = db
          .prepare(
            `SELECT * FROM health_plans WHERE person_id=? ORDER BY updated_at DESC LIMIT 1`
          )
          .get(personId);
      } catch (e) {
        plan = null;
      }
    }
    const tasks = plan && plan.status === "active" ? mpV32.repo.ensureTodayTasks(personId, plan) : [];
    json(res, 200, {
      data: mpV32.buildPlanDetail({ personId, plan, tasks }),
    });
  });

  route("POST", /^\/api\/mp\/v32\/plans\/(\d+)\/(activate|pause|resume)$/, (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const planId = +m[1];
    const action = m[2];
    const status = action === "activate" || action === "resume" ? "active" : "paused";
    try {
      const plan = mpV32.repo.setPlanStatus(+sess.person_id, planId, status);
      if (status === "active") mpV32.repo.ensureTodayTasks(+sess.person_id, plan);
      json(res, 200, { data: { plan } });
    } catch (e) {
      const code = e.code === "not_found" ? 404 : 400;
      json(res, code, { error: e.message });
    }
  });

  route("POST", /^\/api\/mp\/v32\/tasks\/(\d+)\/complete$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    try {
      const task = mpV32.repo.completeTask(+sess.person_id, +m[1], b);
      json(res, 200, { data: { task } });
    } catch (e) {
      const code = e.code === "not_found" ? 404 : 400;
      json(res, code, { error: e.message });
    }
  });

  route("GET", /^\/api\/mp\/v32\/services$/, (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    json(res, 200, { data: mpV32.getServiceCenter() });
  });

  route("GET", /^\/api\/mp\/v32\/family$/, (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    json(res, 200, {
      data: mpV32.buildFamilyData({
        family: mpV32.repo.listFamily(+sess.person_id),
      }),
    });
  });

  route("POST", /^\/api\/mp\/v32\/family$/, async (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    const row = mpV32.repo.addFamily(+sess.person_id, b);
    json(res, 200, { data: { member: row } });
  });
}

module.exports = { registerMpV32Routes };
