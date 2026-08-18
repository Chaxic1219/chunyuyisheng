# -*- coding: utf-8 -*-
import re
from pathlib import Path

root = Path(r"c:\Users\11\Desktop\www\chunyu-doctor-review\app\routes")
suspects = {
    "gateMessageLog",
    "gateTriageSession",
    "gateTriage",
    "authed",
    "allowDoctor",
    "decorateAdminPatient",
    "personRowForPatient",
    "cleanText",
    "cleanInt",
    "adminAudit",
    "adminAuditBestEffort",
    "auditOutboxSnapshot",
    "auditRequestId",
    "decisionDoctorId",
    "configIsSuper",
    "configOut",
    "configAccess",
    "configAudit",
    "ensureOpsConfig",
    "parseConfigBody",
    "applyDoctorGroupConfig",
    "applyContactFormConfig",
    "applyCodesCardsConfig",
    "applyScriptsConfig",
    "opsMod",
    "community",
    "outboxMod",
    "qiweBridge",
    "triage",
    "friendlyPatientLabel",
    "patientArchiveLabel",
    "hydrateAdminMessageRow",
    "maskPII",
    "doctorRow",
    "canAdmin",
    "doctorListOut",
    "patientProfile",
    "inviteStore",
    "inviteUrlForToken",
    "allocateStaffId",
    "hashPw",
    "now",
    "db",
    "parseBody",
    "json",
    "gate",
    "rowDoctorId",
    "requireAdminAction",
    "adminScope",
    "auditDecisionSnapshot",
    "auditText",
    "triageSessionDeliveryTarget",
}

for p in sorted(root.glob("*.js")):
    text = p.read_text(encoding="utf-8")
    m = re.search(
        r"function register\w+\(route,\s*ctx\)\s*\{\s*const\s*\{([^}]+)\}\s*=\s*ctx;",
        text,
        re.S,
    )
    if not m:
        print("NO_CTX", p.name)
        continue
    names = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", m.group(1)))
    body = text[m.end() :]
    used = set(re.findall(r"\b([A-Za-z_][A-Za-z0-9_]*)\b", body))
    missing = sorted((used & suspects) - names)
    if missing:
        print(p.name, "MISSING", missing)
    else:
        print(p.name, "ok")
