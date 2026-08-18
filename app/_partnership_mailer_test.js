const {
  buildPartnershipEmail,
  notifyPartnershipApplication
} = require("./routes/partnership_mailer.js");

let count = 0;
const failures = [];

function ok(condition, message) {
  count += 1;
  if (!condition) failures.push(message);
  console.log((condition ? "ok " : "not ok ") + count + " - " + message);
}

(async () => {
  const app = {
    id: 12,
    name: "Zhang Doctor",
    phone: "13800138000",
    hospital: "Test Hospital",
    department: "GI",
    title: "Chief Physician",
    source: "landing_page",
    createdAt: "2026-07-24T00:00:00.000Z"
  };

  const email = buildPartnershipEmail(app);
  ok(email.subject.includes("Zhang Doctor") && email.subject.includes("13800138000"), "email subject includes applicant name and phone");
  ok(email.text.includes("Test Hospital") && email.html.includes("landing_page"), "email body includes application details");

  const skipped = await notifyPartnershipApplication(app, {
    config: {
      enabled: false,
      user: "sender@163.com",
      pass: "secret",
      from: "sender@163.com",
      to: "owner@163.com"
    }
  });
  ok(skipped && skipped.skipped === "disabled", "disabled config skips sending");

  const sent = [];
  const result = await notifyPartnershipApplication(app, {
    config: {
      enabled: true,
      user: "sender@163.com",
      pass: "secret",
      from: "sender@163.com",
      to: "owner@163.com"
    },
    client: {
      send: async (message) => sent.push(message)
    }
  });
  ok(result && result.ok === true && sent.length === 1 && sent[0].text.includes("13800138000"), "enabled config sends email through client");

  console.log("\nchecks: " + count + " failures: " + failures.length);
  if (failures.length) {
    failures.forEach((failure) => console.log(" - " + failure));
    process.exit(1);
  }
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
