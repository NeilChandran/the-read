#!/usr/bin/env node
/**
 * Local CORS proxy for The Read chatbot.
 * Browsers cannot call OpenAI/Anthropic directly — run this first:
 *
 *   node llm-proxy.mjs
 *
 * Then set Proxy URL to http://localhost:8787 in chat ⚙ settings.
 */
import http from 'http';

const PORT = 8787;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function callOpenAI({ apiKey, model, system, messages }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || res.statusText);
  return data.choices[0].message.content;
}

async function callAnthropic({ apiKey, model, system, messages }) {
  const mapped = messages.map(m => ({ role: m.role, content: m.content }));
  mapped.push({ role: 'assistant', content: '{' });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      temperature: 0.2,
      system,
      messages: mapped,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || res.statusText);
  const text = data.content.map(b => b.text || '').join('');
  return text.startsWith('{') ? text : '{' + text;
}

const server = http.createServer(async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method !== 'POST' || req.url !== '/chat') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'POST /chat or GET /health' }));
  }

  try {
    const body = JSON.parse(await readBody(req));
    const { provider, apiKey, model, system, messages } = body;

    if (!apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing apiKey' }));
    }

    let content;
    if (provider === 'anthropic') {
      content = await callAnthropic({ apiKey, model, system, messages: messages || [] });
    } else {
      content = await callOpenAI({ apiKey, model, system, messages: messages || [] });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || String(e) }));
  }
});

server.listen(PORT, () => {
  console.log('The Read LLM proxy → http://localhost:' + PORT);
  console.log('Set this URL in chat ⚙ settings, then add your API key.');
});
