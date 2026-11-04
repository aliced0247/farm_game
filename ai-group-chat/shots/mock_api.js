// 偽の Anthropic と OpenRouter（留守番役の確かめ用）。返事まで数秒かかるようにして、ページを途中で閉じる確かめに使う
const http = require('http');
const log = [];
let n = 0, failOR = false, delay = 2500;
const names = { 'claude-opus-5-5': null };
http.createServer((req, res) => {
  let b = '';
  req.on('data', d => b += d);
  req.on('end', () => {
    if (req.url === '/log') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(log)); return; }
    if (req.url.startsWith('/set')) { const u = new URL(req.url, 'http://x'); if (u.searchParams.has('failOR')) failOR = u.searchParams.get('failOR') === '1'; if (u.searchParams.has('delay')) delay = +u.searchParams.get('delay'); res.end('ok'); return; }
    let j = {}; try { j = JSON.parse(b); } catch (e) { }
    const sys = typeof j.system === 'string' ? j.system : Array.isArray(j.system) ? j.system.map(x => x.text).join('') : (j.messages && j.messages[0] && j.messages[0].role === 'system' ? j.messages[0].content : '');
    const who = (sys.match(/あなたは「(.+?)」/) || sys.match(/あなたは『(.+?)』/) || [, '?'])[1];
    const entry = { at: Date.now(), url: req.url, model: j.model, who, key: req.headers['x-api-key'] || req.headers['authorization'], think: !!j.thinking, hasNote: sys.includes('［このスレの一言］'), lastUser: j.messages && JSON.stringify(j.messages[j.messages.length - 1]).slice(0, 120), done: false };
    log.push(entry);
    const id = ++n;
    setTimeout(() => {
      entry.done = true;
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url.startsWith('/v1/messages')) {
        if (req.headers['x-api-key'] !== 'sk-ant-test') { res.writeHead(401); res.end(JSON.stringify({ error: { message: 'bad key' } })); return; }
        res.end(JSON.stringify({ content: [{ type: 'text', text: who + 'の返事（' + id + '）' + (who === 'くろくん' && id % 3 === 0 ? ' Geminiはどう思う？' : '') }], usage: { input_tokens: 1000, output_tokens: 100 } }));
        return;
      }
      if (failOR) { res.end(JSON.stringify({ error: { message: 'No endpoints found matching your data policy' } })); return; }
      if (req.headers['authorization'] !== 'Bearer sk-or-test') { res.end(JSON.stringify({ error: { message: 'bad key' } })); return; }
      if (j.model === 'openai/gpt-6-luna') {
        const body = j.messages[1].content;
        const line = (body.match(/今部屋にいて、選べる子：(.+)/) || [, ''])[1].split('、');
        const must = JSON.parse((body.match(/必ず入れる子：(\[.*\])/) || [, '[]'])[1]);
        const pick = [...must, ...line.filter(x => !must.includes(x) && x !== 'Grok').slice(0, 2)].slice(0, 4);
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ speakers: pick }) } }], usage: { cost: 0.0001 } }));
        return;
      }
      res.end(JSON.stringify({ choices: [{ message: { content: who + 'の返事（' + id + '）' } }], usage: { cost: 0.002 } }));
    }, req.url.startsWith('/v1/messages') ? delay * 2 : delay);
  });
}).listen(8790, () => console.log('mock on 8790'));
