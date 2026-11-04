const enc = new TextEncoder();

export function parseTrigger(body) {
  const m = /^\s*@?agent\b[\s,:\-–—]*/i.exec(body || "");
  return m ? body.slice(m[0].length).trim() : null;
}

export function isStop(body) {
  return /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*[.!]?\s*$/i.test(body || "");
}

export async function twilioSignature(url, params, token) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey("raw", enc.encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s);
}

export async function validSignature(url, params, header, token) {
  if (!header || !token) return false;
  const expected = await twilioSignature(url, params, token);
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

export async function askGrok(env, history, question, fetchFn = fetch) {
  const res = await fetchFn("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + env.XAI_API_KEY },
    body: JSON.stringify({
      model: env.XAI_MODEL || "grok-4",
      messages: [
        { role: "system", content: "You are Agent, a helpful assistant in a group text. Keep replies short and plain text. Use only the conversation provided." },
        { role: "user", content: `Group history:\n${history}\n\nRequest: ${question}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`xAI ${res.status}`);
  const text = (await res.json())?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("xAI empty response");
  return text.slice(0, 1500);
}

export async function sendToGroup(env, conversationSid, text, fetchFn = fetch) {
  const res = await fetchFn(`https://conversations.twilio.com/v1/Conversations/${conversationSid}/Messages`, {
    method: "POST",
    headers: {
      authorization: "Basic " + btoa(`${env.TWILIO_API_KEY_SID}:${env.TWILIO_API_KEY_SECRET}`),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ Author: env.PROGRAM_NUMBER, Body: text }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}`);
}
