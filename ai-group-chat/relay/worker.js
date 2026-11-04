// みんなのへや（ai-group-chat/index.html）の留守番役。Cloudflare Workers + Durable Objects（版7・11/4）
//
// ページから「このスレで、この一言に返事をして」と頼まれたら、司会 → 一人ずつ → 言い返し（2周まで）の順番を
// ページが閉じても最後まで回して、書けた返事とお知らせを、順番の番号つきで箱に置く。ページは開いてる間、箱を見に来る。
//
// ・鍵はこのファイルにも Cloudflare の設定にも置かない。頼まれた回だけ受け取って、回し終わったら（止めた時も）消す
// ・箱（Durable Object）の名前は「ページが自分で作った合言葉:スレのid」。合言葉を知らないと開けない
// ・一人分の返事は、アラームの中で書かせる（アラーム一回につき15分まで待てる。ページが離れても止められない）
// ・紙（指示）・会話・名前は、ページが毎回送ってくる。このファイルには書かない（このリポジトリは公開されてる）
// ・順番の回し方は、ページ（index.html）の start() と同じにしてある。片方を変える時は、もう片方も合わせる

const STEP_LIMIT_MS = 60 * 60 * 1000;   // 一回の頼みは1時間まで（それを過ぎたら止めて、鍵を消す）
const KEEP_EVENTS = 400;                // 箱に残すお知らせの数（古いものから消す）
const P_ANT = { in: 4, cw: 5, cr: 0.2, out: 20 };  // Anthropic の 1M トークンあたりのドル（ページと同じ）

// ===== 入口 =====
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsFor(req.headers.get('Origin') || '', env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors || {} });
    if (url.pathname === '/' || url.pathname === '/ping') return json({ ok: true, name: 'みんなのへやの留守番役' }, 200, cors || {});
    if (!cors) return json({ ok: false, msg: 'このページからは使えない' }, 403, {});
    const m = url.pathname.match(/^\/room\/([a-f0-9]{32})\/([A-Za-z0-9_-]{1,40})\/(start|poll|stop)$/);
    if (!m) return json({ ok: false, msg: 'not found' }, 404, cors);
    const stub = env.ROOM.get(env.ROOM.idFromName(m[1] + ':' + m[2]));
    const init = { method: req.method, headers: { 'content-type': 'application/json' } };
    if (req.method === 'POST') init.body = await req.text();
    const res = await stub.fetch('https://room/' + m[3] + url.search, init);
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  }
};

function corsFor(origin, env) {
  const allow = String(env.ALLOW || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origin || !allow.includes(origin)) return null;
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '600', 'Vary': 'Origin' };
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8', ...(headers || {}) } });
}
const pad = n => String(n).padStart(10, '0');
const sleep = ms => new Promise(ok => setTimeout(ok, ms));

// ===== スレの箱 =====
export class Room {
  constructor(state, env) { this.state = state; this.env = env; this.ctrl = null; }
  get st() { return this.state.storage; }

  async fetch(req) {
    const url = new URL(req.url), op = url.pathname.slice(1);
    try {
      if (op === 'start' && req.method === 'POST') return json(await this.start(await req.json()));
      if (op === 'poll') return json(await this.poll(Number(url.searchParams.get('since')) || 0));
      if (op === 'stop' && req.method === 'POST') return json(await this.stop());
      return json({ ok: false, msg: 'not found' }, 404);
    } catch (e) { return json({ ok: false, msg: String(e && e.message || e) }, 500); }
  }

  // 新しい頼み。前の頼みが回ってる途中なら、それはやめて新しい方にする（ページの「送る」と同じ）
  async start(body) {
    const job = body && body.job;
    if (!job || !Array.isArray(job.history) || !job.people) return { ok: false, msg: '頼みの中身が足りない' };
    const prev = await this.st.get('job');
    if (prev) { this.abortNow(); await this.emit(prev, { type: 'done', stopped: true }); }
    job.jid = crypto.randomUUID();
    job.made = Date.now();
    job.state = { phase: 'mod' };
    await this.st.put('job', job);
    await this.st.put('live', null);
    await this.st.setAlarm(Date.now() + 5);
    // 古いお知らせを片付ける
    const seq = (await this.st.get('seq')) || 0;
    if (seq > KEEP_EVENTS) {
      const old = await this.st.list({ prefix: 'ev:', end: 'ev:' + pad(seq - KEEP_EVENTS) });
      if (old.size) await this.st.delete([...old.keys()].slice(0, 128));
    }
    return { ok: true, jid: job.jid, seq };
  }

  // since より後ろのお知らせと、今だれが書いてるか
  async poll(since) {
    const seq = (await this.st.get('seq')) || 0;
    const evs = since < seq ? await this.st.list({ prefix: 'ev:', start: 'ev:' + pad(since + 1), limit: 200 }) : new Map();
    const job = await this.st.get('job');
    const live = await this.st.get('live');
    return { ok: true, seq, events: [...evs.values()], busy: !!job, jid: job ? job.jid : null, live: job ? live : null };
  }

  async stop() {
    const job = await this.st.get('job');
    this.abortNow();
    if (job) { await this.st.delete('job'); await this.st.put('live', null); await this.emit(job, { type: 'done', stopped: true }); }
    await this.st.deleteAlarm();
    return { ok: true };
  }

  abortNow() { if (this.ctrl) { try { this.ctrl.abort(); } catch (e) { } this.ctrl = null; } }

  async emit(job, ev) {
    const seq = ((await this.st.get('seq')) || 0) + 1;
    await this.st.put({ seq, ['ev:' + pad(seq)]: { ...ev, seq, jid: job.jid, at: ev.at || Date.now() } });
    return seq;
  }
  async note(job, text, err) { return this.emit(job, { type: 'note', text, err: !!err }); }
  async setLive(job, who) { await this.st.put('live', who ? { who, jid: job.jid, at: Date.now() } : null); }
  async still(job) { const j = await this.st.get('job'); return !!(j && j.jid === job.jid); }
  async finish(job) {
    if (!(await this.still(job))) return;
    await this.st.delete('job');   // 鍵もここで消える
    await this.st.put('live', null);
    await this.emit(job, { type: 'done' });
  }

  // 一回のアラームで一歩（司会を一回、か、一人分の返事）。終わったら次のアラームを入れる
  async alarm() {
    const job = await this.st.get('job');
    if (!job) return;
    if (Date.now() - job.made > STEP_LIMIT_MS) { await this.note(job, '時間がかかりすぎたので止めた', true); await this.finish(job); return; }
    try { await this.step(job); }
    catch (e) {
      if (await this.still(job)) { await this.note(job, '止まった：' + (e && e.message || e), true); await this.finish(job); }
    }
    // まだ頼みが残っていれば、次の一歩（途中で新しい頼みに入れ替わった時も、ここで必ず次を入れる）
    if (await this.st.get('job')) await this.st.setAlarm(Date.now() + 5);
  }

  async step(job) {
    const S = job.state, L = job.limits || {};
    const cands = job.cands || [], forced = job.forced || [];
    if (S.phase === 'mod') {
      let first, modCost = 0;
      if (forced.length >= 4) first = forced.slice();
      else {
        let picked = null;
        if (job.mod && job.mod.ready) {
          await this.setLive(job, 'mod');
          const r = await this.call(job, 'mod', { system: job.mod.system, messages: [{ role: 'user', content: job.mod.body }], maxTokens: 2000 });
          if (!(await this.still(job))) return;
          await this.setLive(job, null);
          if (typeof r.cost === 'number') { modCost = r.cost; await this.emit(job, { type: 'cost', cost: r.cost }); }
          if (r.ok) picked = parseSpeakers(job, r.text);
        }
        first = [...forced];
        if (picked) { for (const id of picked) if (cands.includes(id) && !first.includes(id)) first.push(id); }
        else if (!forced.length) first.push(fallbackOne(job, cands));
        first = first.slice(0, job.kind === 'more' ? 3 : 4);
        if (!first.length) first = [fallbackOne(job, cands)];
      }
      job.state = { phase: 'speak', queue: first.filter(Boolean).map(id => ({ id })), said: [], extra: 0, modCost };
      if (!job.state.queue.length) { await this.finish(job); return; }
      await this.st.put('job', job);
      return;
    }
    // 一人分
    const s = S.queue.shift();
    await this.setLive(job, s.id);
    const r = await this.call(job, s.id, { system: (job.sys || {})[s.id] || '', messages: convFor(job, s.id, job.tail), maxTokens: L.maxTokens || 8000, to: s.to });
    if (!(await this.still(job))) return;
    await this.setLive(job, null);
    if (!r.ok) await this.note(job, errText(job.people[s.id].name, r), true);
    else {
      const text = clean(job, s.id, r.text);
      if (!text) await this.note(job, job.people[s.id].name + 'の返事が空だった', true);
      else {
        const m = { who: s.id, text, at: Date.now() };
        if (typeof r.cost === 'number') m.cost = r.cost;
        if (S.modCost) m.mod = S.modCost;
        if (job.test) m.test = true;
        job.history.push(m);
        await this.emit(job, { type: 'msg', m });
        S.said.push({ id: s.id, text });
        S.modCost = 0;
      }
    }
    if (r.nothink) { job.think = false; await this.emit(job, { type: 'nothink' }); }
    if (!S.queue.length) {
      const maxExtra = L.maxExtraRounds != null ? L.maxExtraRounds : 2, maxBack = L.maxBack != null ? L.maxBack : 2;
      if (S.extra >= maxExtra) { await this.finish(job); return; }
      // 返事の中で、ほかのAIに話しかけた・言い返した時は、言われた子が一回返す（そのあとに同じ周で喋った子はのぞく）
      const next = [];
      S.said.forEach((x, i) => {
        for (const id of findCalls(job, x.text, x.id)) {
          if (!cands.includes(id) || S.said.slice(i + 1).some(y => y.id === id) || next.some(n => n.id === id)) continue;
          next.push({ id, to: x.id });
        }
      });
      if (!next.length) { await this.finish(job); return; }
      S.queue = next.slice(0, maxBack); S.said = []; S.extra++;
    }
    await this.st.put('job', job);
  }

  // ===== 通り道（ページの ROUTES と同じ呼び方） =====
  async call(job, id, a) {
    this.ctrl = new AbortController();
    const signal = this.ctrl.signal;
    try {
      if (job.test) return await fakeCall(job, id, a, signal);
      const route = (job.route || {})[id];
      if (route === 'anthropic') return await this.antCall(job, id, a, signal);
      return await this.orCall(job, id, a, signal);
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, msg: '止めた' };
      return { ok: false, msg: String(e && e.message || e) };
    } finally { this.ctrl = null; }
  }

  async antCall(job, id, { system, messages, maxTokens }, signal) {
    const key = job.keys && job.keys.ant;
    if (!key) return { ok: false, msg: 'Anthropic の鍵がない' };
    const n = messages.length;
    const body = { model: job.models[id], max_tokens: 16000,
      messages: messages.map((m, i) => ({ role: m.role, content: i === n - 1 ? [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] : m.content })) };
    if (String(system).trim()) body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
    if (job.think) body.thinking = { type: 'adaptive' };
    const post = async () => {
      const r = await fetch(this.env.ANT_URL || 'https://api.anthropic.com/v1/messages', { method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
      return { r, j: await r.json().catch(() => ({})) };
    };
    let { r, j } = await post(), nothink = false;
    // 考える（thinking）が使えないと言われたら、考えないでもう一回（ページと同じ）
    if (!r.ok && body.thinking && r.status === 400 && /think/i.test(JSON.stringify(j))) { delete body.thinking; ({ r, j } = await post()); if (r.ok) nothink = true; }
    if (!r.ok) return { ok: false, status: r.status, msg: (j.error && j.error.message) || '' };
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const u = j.usage || {};
    const cost = ((u.input_tokens || 0) * P_ANT.in + (u.cache_creation_input_tokens || 0) * P_ANT.cw + (u.cache_read_input_tokens || 0) * P_ANT.cr + (u.output_tokens || 0) * P_ANT.out) / 1e6;
    return { ok: true, text, cost, nothink };
  }

  async orCall(job, id, { system, messages, maxTokens }, signal) {
    const key = job.keys && job.keys.or;
    if (!key) return { ok: false, msg: 'OpenRouter の鍵がない' };
    const body = { model: job.models[id], max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages], usage: { include: true } };
    if (id === 'mod') body.reasoning = { effort: 'low' };
    const r = await fetch(this.env.OR_URL || 'https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + key }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    const c = j.choices && j.choices[0], err = j.error || (c && c.error);
    if (!r.ok || err || !c) return { ok: false, status: r.status, msg: (err && err.message) || '' };
    let text = c.message && c.message.content;
    if (Array.isArray(text)) text = text.map(x => x && x.text || '').join('');
    const u = j.usage || {}, pr = (job.price || {})[id] || [0, 0];
    const cost = typeof u.cost === 'number' ? u.cost : ((u.prompt_tokens || 0) * pr[0] + (u.completion_tokens || 0) * pr[1]) / 1e6;
    return { ok: true, text: text || '', cost };
  }
}

// ===== 試しモード（本物のAIは呼ばない。決まった返事はページが送ってくる） =====
async function fakeCall(job, id, { to }, signal) {
  const f = job.fake || {};
  await new Promise((ok, ng) => { const t = setTimeout(ok, 600 + Math.random() * 600); signal.addEventListener('abort', () => { clearTimeout(t); ng(Object.assign(new Error('止めた'), { name: 'AbortError' })); }, { once: true }); });
  const cost = +(((f.cost || {})[id] || 0.001) * (0.8 + Math.random() * 0.4)).toFixed(5);
  const here = job.here || [];
  if (id === 'mod') {
    const forced = job.forced || [];
    const rest = here.filter(a => !forced.includes(a)).sort((a, b) => lastSpoke(job, a) - lastSpoke(job, b));
    const n = Math.min(rest.length, 4 - forced.length, 1 + Math.floor(Math.random() * 2));
    return { ok: true, text: JSON.stringify({ speakers: [...forced, ...rest.slice(0, n)].map(a => job.people[a].name) }), cost };
  }
  let t;
  if (to) t = String((f.back || {})[id] || '{相手}、なるほど').split('{相手}').join(job.people[to].name);
  else {
    const list = (f.lines || {})[id] || ['（' + job.people[id].name + '）'];
    job.fakeTurn = job.fakeTurn || {};
    const i = (job.fakeTurn[id] = (job.fakeTurn[id] || 0) + 1) % list.length;
    const others = here.filter(a => a !== id), o = others.length ? others : Object.keys(job.people).filter(a => a !== id);
    t = list[i].split('{相手}').join(job.people[o[Math.floor(Math.random() * o.length)]].name);
  }
  return { ok: true, text: t.split('{ユーザー名}').join(job.user || 'わたし'), cost };
}

// ===== 会話の渡し方・名前の読み取り（ページと同じ） =====
const nameOf = (job, id) => id === 'me' ? (job.user || 'わたし') : (job.people[id] ? job.people[id].name : id);
function convFor(job, id, tail) {
  const out = [];
  for (const m of job.history.slice(-((job.limits || {}).history || 40))) {
    const role = m.who === id ? 'assistant' : 'user', text = role === 'assistant' ? m.text : nameOf(job, m.who) + '：' + m.text;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += '\n' + text; else out.push({ role, content: text });
  }
  if (out.length && out[0].role === 'assistant') out.unshift({ role: 'user', content: '［会話の途中から］' });
  if (!out.length || out[out.length - 1].role === 'assistant') out.push({ role: 'user', content: tail || '［続けてどうぞ］' });
  return out;
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function clean(job, id, text) {
  let t = String(text || '').trim().replace(new RegExp('^\\s*' + esc(job.people[id].name) + '\\s*[：:]\\s*'), '');
  const others = [nameOf(job, 'me'), ...Object.keys(job.people).filter(a => a !== id).map(a => job.people[a].name)];
  const keep = [];
  for (const ln of t.split('\n')) { if (others.some(n => new RegExp('^\\s*' + esc(n) + '\\s*[：:]').test(ln))) break; keep.push(ln); }
  return keep.join('\n').trim();
}
function findCalls(job, text, except) {
  const low = String(text).toLowerCase(), hits = [];
  for (const id of Object.keys(job.people)) {
    if (id === except) continue;
    let pos = -1;
    for (const c of job.people[id].calls || []) { const i = low.indexOf(String(c).toLowerCase()); if (i >= 0 && (pos < 0 || i < pos)) pos = i; }
    if (pos >= 0) hits.push([pos, id]);
  }
  return hits.sort((a, b) => a[0] - b[0]).map(h => h[1]);
}
function idFromName(job, s) {
  const t = String(s).trim().toLowerCase();
  return Object.keys(job.people).find(id => job.people[id].name.toLowerCase() === t || (job.people[id].calls || []).some(c => String(c).toLowerCase() === t)) || null;
}
function parseSpeakers(job, text) {
  const m = String(text || '').match(/\{[\s\S]*\}/); if (!m) return null;
  let j; try { j = JSON.parse(m[0]); } catch (e) { return null; }
  if (!j || !Array.isArray(j.speakers)) return null;
  const ids = []; for (const s of j.speakers) { const id = typeof s === 'string' && idFromName(job, s); if (id && !ids.includes(id)) ids.push(id); }
  return ids.length ? ids : null;
}
function lastSpoke(job, id) { for (let i = job.history.length - 1; i >= 0; i--) if (job.history[i].who === id) return i; return -1; }
function fallbackOne(job, cands) {
  const c = cands.length ? cands : Object.keys(job.people);
  if (c.includes('kuro') && !job.history.slice(-6).some(m => m.who === 'kuro')) return 'kuro';
  return [...c].sort((a, b) => lastSpoke(job, a) - lastSpoke(job, b))[0];
}
function errText(name, r) {
  const hint = /data policy|privacy|No endpoints found/i.test(r.msg || '') ? '\n→ OpenRouterの Settings → Privacy の設定で、この子の提供元が外れているかも' : '';
  return name + '：うまく届かなかった' + (r.status ? '（' + r.status + '）' : '') + (r.msg ? '\n' + r.msg : '') + hint;
}
