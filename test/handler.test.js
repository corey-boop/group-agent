import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/index.js";
import { parseTrigger, isStop, twilioSignature } from "../src/lib.js";

function fakeDB() {
  const messages = new Map(), replies = new Map(), opt = new Set();
  const prep = (sql) => ({
    bind(...a) {
      return {
        async run() {
          if (sql.includes("INTO messages")) { if (messages.has(a[0])) return { meta: { changes: 0 } }; messages.set(a[0], a); return { meta: { changes: 1 } }; }
          if (sql.includes("INTO replies")) { if (replies.has(a[0])) return { meta: { changes: 0 } }; replies.set(a[0], "claimed"); return { meta: { changes: 1 } }; }
          if (sql.includes("INTO opt_outs")) { opt.add(a.join("|")); return { meta: { changes: 1 } }; }
          if (sql.includes("UPDATE replies")) { replies.set(a[1], a[0]); return { meta: { changes: 1 } }; }
        },
        async first() { return opt.has(a.join("|")) ? { 1: 1 } : null; },
        async all() { return { results: [...messages.values()].map((m) => ({ author: m[2], body: m[3] })) }; },
      };
    },
  });
  return { prepare: prep, replies, opt };
}

const url = "https://x.test/hook";
const G = "CH095b684d55604a2bafa49276ef183431";
async function call(env, p, deps) {
  const params = { EventType: "onMessageAdded", ConversationSid: G, ...p };
  const sig = await twilioSignature(url, params, env.TWILIO_AUTH_TOKEN);
  const pending = [];
  const res = await handle(new Request(url, { method: "POST", body: new URLSearchParams(params), headers: { "x-twilio-signature": sig } }), env, { waitUntil: (p) => pending.push(p) }, deps);
  await Promise.all(pending);
  return res;
}
const mkEnv = () => ({ GROUP_ENABLED: "true", TWILIO_AUTH_TOKEN: "t", PROGRAM_NUMBER: "+14023832515", GROUP_SIDS: G, DB: fakeDB() });

test("trigger and stop parsing", () => {
  assert.equal(parseTrigger("@Agent tell a joke"), "tell a joke");
  assert.equal(parseTrigger("agent, hi"), "hi");
  assert.equal(parseTrigger("agents rule"), null);
  assert.ok(isStop("STOP"));
});

test("replies once to originating group, dedupes", async () => {
  const env = mkEnv(); const sent = [];
  const deps = { askGrok: async () => "joke", sendToGroup: async (e, c, t) => sent.push([c, t]) };
  await call(env, { MessageSid: "IM1", Author: "+1555", Body: "Agent joke" }, deps);
  await call(env, { MessageSid: "IM1", Author: "+1555", Body: "Agent joke" }, deps);
  assert.deepEqual(sent, [[G, "joke"]]);
  assert.equal(env.DB.replies.get("IM1"), "sent");
});

test("ignores self, plain messages, bad signature; no retry on uncertain send", async () => {
  const env = mkEnv(); let n = 0;
  const deps = { askGrok: async () => "x", sendToGroup: async () => { n++; throw new Error("t"); } };
  await call(env, { MessageSid: "IM2", Author: env.PROGRAM_NUMBER, Body: "Agent hi" }, deps);
  await call(env, { MessageSid: "IM3", Author: "+1555", Body: "hello" }, deps);
  assert.equal(n, 0);
  const bad = await handle(new Request(url, { method: "POST", body: "a=b", headers: { "x-twilio-signature": "bad" } }), env, { waitUntil() {} }, deps);
  assert.equal(bad.status, 403);
  await call(env, { MessageSid: "IM4", Author: "+1555", Body: "@Agent hi" }, deps);
  assert.equal(n, 1);
  assert.equal(env.DB.replies.get("IM4"), "uncertain");
});

test("opted-out author gets no reply", async () => {
  const env = mkEnv(); let n = 0;
  const deps = { askGrok: async () => "x", sendToGroup: async () => n++ };
  await call(env, { MessageSid: "IM5", Author: "+1555", Body: "STOP" }, deps);
  await call(env, { MessageSid: "IM6", Author: "+1555", Body: "Agent hi" }, deps);
  assert.equal(n, 0);
});
