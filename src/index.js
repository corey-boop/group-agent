import { parseTrigger, isStop, validSignature, askGrok, sendToGroup } from "./lib.js";

export async function handle(request, env, ctx, deps = {}) {
  const ask = deps.askGrok || askGrok;
  const send = deps.sendToGroup || sendToGroup;
  if (request.method !== "POST") return new Response("ok");
  if (env.GROUP_ENABLED !== "true") return new Response("disabled", { status: 503 });

  const params = Object.fromEntries(new URLSearchParams(await request.text()));
  if (!(await validSignature(request.url, params, request.headers.get("x-twilio-signature"), env.TWILIO_AUTH_TOKEN))) {
    return new Response("forbidden", { status: 403 });
  }
  if (params.EventType && params.EventType !== "onMessageAdded") return new Response("ignored");

  const { ConversationSid: conv, MessageSid: sid, Author: author = "", Body: body = "" } = params;
  if (!conv || !sid || !(env.GROUP_SIDS || "").split(",").includes(conv)) return new Response("ignored");
  if (author === env.PROGRAM_NUMBER) return new Response("self");

  const ins = await env.DB.prepare("INSERT OR IGNORE INTO messages (message_sid, conversation_sid, author, body) VALUES (?, ?, ?, ?)")
    .bind(sid, conv, author, body).run();
  if (!ins.meta?.changes) return new Response("duplicate");

  if (isStop(body)) {
    await env.DB.prepare("INSERT OR IGNORE INTO opt_outs (conversation_sid, author) VALUES (?, ?)").bind(conv, author).run();
    return new Response("stop");
  }
  const question = parseTrigger(body);
  if (question === null) return new Response("captured");
  const out = await env.DB.prepare("SELECT 1 FROM opt_outs WHERE conversation_sid = ? AND author = ?").bind(conv, author).first();
  if (out) return new Response("opted-out");

  const claim = await env.DB.prepare("INSERT OR IGNORE INTO replies (message_sid, conversation_sid, status) VALUES (?, ?, 'claimed')")
    .bind(sid, conv).run();
  if (!claim.meta?.changes) return new Response("duplicate");

  const work = respond(env, conv, sid, question, ask, send);
  ctx.waitUntil(work);
  return new Response("accepted", { status: 202 });
}

async function respond(env, conv, sid, question, ask, send) {
  const setStatus = (s) => env.DB.prepare("UPDATE replies SET status = ? WHERE message_sid = ?").bind(s, sid).run();
  let text;
  try {
    const { results } = await env.DB.prepare(
      "SELECT author, body FROM messages WHERE conversation_sid = ? ORDER BY created_at DESC, rowid DESC LIMIT 30").bind(conv).all();
    const history = results.reverse().map((r) => `${r.author}: ${r.body}`).join("\n");
    text = await ask(env, history, question || "Respond to the conversation.");
  } catch {
    await setStatus("failed_before_send");
    return;
  }
  // Never retry: a failed send may still have been delivered.
  await setStatus("sending");
  try {
    await send(env, conv, text);
    await setStatus("sent");
  } catch {
    await setStatus("uncertain");
  }
}

export default { fetch: (req, env, ctx) => handle(req, env, ctx) };
