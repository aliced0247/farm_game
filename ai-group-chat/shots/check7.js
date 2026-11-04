// みんなのへや（版7：留守番役）の確かめ。手元で留守番役（wrangler dev）と、偽のAnthropic・OpenRouter（mock_api.js）を動かしてから
//   node ai-group-chat/shots/check7.js [撮った画面を置くフォルダ]
// ページ：http://127.0.0.1:8123（リポジトリの一番上で python3 -m http.server 8123）
// 留守番役：http://127.0.0.1:8787（ALLOW に http://127.0.0.1:8123、ANT_URL・OR_URL は偽の方へ）
// 偽のAPI：http://127.0.0.1:8790（鍵 sk-ant-test・sk-or-test だけ通す。返事まで数秒かかる）
const {chromium}=require('playwright');
const OUT=process.argv[2]||__dirname;
const BASE='http://127.0.0.1:8123/ai-group-chat/';
const RELAY='http://127.0.0.1:8787', MOCK='http://127.0.0.1:8790';
const K='ai-group-chat:v1';
const results=[];
const ok=(name,cond,info)=>{results.push((cond?'OK ':'NG ')+name+(info?'　'+info:''));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mockLog=async()=>(await fetch(MOCK+'/log')).json();
const mockSet=q=>fetch(MOCK+'/set?'+q);
const relayPoll=async(key,rid,since)=>(await fetch(RELAY+'/room/'+key+'/'+rid+'/poll?since='+(since||0),{headers:{Origin:'http://127.0.0.1:8123'}})).json();
(async()=>{
  const b=await chromium.launch();
  try{
  const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'ja-JP'});
  var errs=[];
  const open=async()=>{const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text())});p.on('dialog',d=>d.accept());await p.goto(BASE);return p};
  const shot=async(p,n)=>p.screenshot({path:OUT+'/7-'+n+'.png'});
  const say=async(p,t)=>{await p.fill('#in',t);await p.tap('#send')};
  const room=(p,n)=>p.evaluate(n=>{const r=S.rooms.find(x=>x.name===n);return r&&{id:r.id,msgs:r.msgs.map(m=>({who:m.who,text:m.text,at:m.at,cost:m.cost})),relay:r.relay,busy:!!r._ctrl}},n);

  // ---- 準備：留守番役の住所と鍵を入れた状態 ----
  let p=await open();
  const t0=Date.now()-3600e3;
  await p.evaluate(([K,t0])=>{localStorage.clear();
    localStorage.setItem('kuro-chat-v1',JSON.stringify({msgs:[]}));
    localStorage.setItem(K,JSON.stringify({name:'ミント',test:false,orKey:'sk-or-test',kuroKey:'sk-ant-test',kuroSys:'あなたは「くろくん」。',think:true,day:'',dayCost:0,
      msgs:[{who:'me',text:'前の話',at:t0},{who:'kuro',text:'おう',at:t0+1000}],on:{grok:false}}))},[K,t0]);
  await p.reload();
  await p.tap('#gear');await p.fill('#s-relay','http://127.0.0.1:8787/');await p.tap('#s-relay-test');
  await p.waitForFunction(()=>document.getElementById('s-relay-res').textContent!=='試してる…');
  ok('「つながるか試す」でつながった',(await p.textContent('#s-relay-res'))==='つながった',await p.textContent('#s-relay-res'));
  await shot(p,'01-設定（留守番役の住所）');
  await p.tap('#save');
  ok('一覧に「留守番役につないでる」',(await p.textContent('#relaynote')).includes('留守番役につないでる'));
  var key=await p.evaluate(()=>S.relayKey);
  ok('合言葉はページが自分で作って保存した（32字）',/^[a-f0-9]{32}$/.test(key)&&(await p.evaluate(K=>JSON.parse(localStorage.getItem(K)).relayKey,K))===key);

  // ---- 1. 送って、書いてる途中でページを閉じる → 留守番役は最後まで回す ----
  await p.tap('.th');
  await say(p,'くろくん、ジェミちゃん、きいて');
  await p.waitForSelector('#log .typing',{timeout:20000});
  await shot(p,'02-留守番役が回してる');
  const r1=await room(p,'はじめのスレ');
  const logAtClose=(await mockLog()).length;
  await p.close();
  const closedAt=Date.now();
  // 閉じてる間も、偽のAPIへの呼び出しが続いて、留守番役の頼みが終わる
  let st;for(let i=0;i<60;i++){st=await relayPoll(key,r1.id,0);if(!st.busy)break;await sleep(1000)}
  const lg=await mockLog();
  const after=lg.filter(e=>e.at>closedAt);
  ok('ページを閉じたあとも呼び出しが続いた',after.length>=1,'閉じた後に始まった呼び出し '+after.length+'件');
  ok('閉じてる間に最後まで回し終わった',st&&!st.busy,'お知らせ '+(st&&st.events.length)+'件');
  const msgEv=st.events.filter(e=>e.type==='msg');
  ok('留守番役の箱に返事がたまってる',msgEv.length>=2,msgEv.map(e=>e.m.who).join(','));
  ok('司会は留守番役が呼んだ（Grokは外したまま）',lg.some(e=>e.model==='openai/gpt-6-luna')&&!lg.some(e=>e.who==='Grok'));
  ok('くろくんの鍵・OpenRouterの鍵は、ページから渡した物が使われた',lg.filter(e=>e.url.startsWith('/v1')).every(e=>e.key==='sk-ant-test')&&lg.filter(e=>e.url==='/or').every(e=>e.key==='Bearer sk-or-test'));
  ok('くろくんの紙はページが送った物',lg.some(e=>e.who==='くろくん'));

  // ---- 2. 開き直すと、閉じてる間の返事が全部並ぶ ----
  p=await open();
  await p.tap('.th:has-text("はじめのスレ")');
  await p.waitForFunction(()=>{const r=S.rooms[0];return r.relay&&!r.relay.jid},null,{timeout:20000});
  const r2=await room(p,'はじめのスレ');
  const replies=r2.msgs.slice(3);
  ok('開き直したら、閉じてる間の返事が全部入った',replies.length===msgEv.length&&replies.every((m,i)=>m.text===msgEv[i].m.text),replies.map(m=>m.who).join(',')+' / 箱 '+msgEv.length);
  ok('並び順：自分の一言のあとに返事',r2.msgs[2].who==='me'&&replies.every(m=>m.at>r2.msgs[2].at));
  ok('額も足された',await p.evaluate(()=>S.dayCost>0),await p.textContent('#today'));
  await shot(p,'03-開き直したら全部並んでる');
  await sleep(4000);
  ok('何回見に行っても二重にならない',(await room(p,'はじめのスレ')).msgs.length===r2.msgs.length);
  await p.reload();await p.waitForTimeout(2500);
  ok('再読み込みしても二重にならない',(await room(p,'はじめのスレ')).msgs.length===r2.msgs.length);

  // ---- 3. 回ってる途中で次の一言 → 前の頼みはやめて、新しい方だけ続く ----
  await p.tap('.th:has-text("はじめのスレ")');
  await say(p,'Gemini、ひとつ目');
  await p.waitForSelector('#log .typing',{timeout:20000});
  await p.waitForTimeout(500);
  const bAt=Date.now();
  await say(p,'くろくん、ふたつ目');
  await p.waitForFunction(()=>{const r=S.rooms[0];return r.relay&&!r.relay.jid&&!r._ctrl},null,{timeout:60000});
  const r3=await room(p,'はじめのスレ');
  const bi=r3.msgs.findIndex(m=>m.text==='くろくん、ふたつ目');
  const lg3=await mockLog();
  const idOf=t=>{const m=String(t).match(/（(\d+)）/);return m?+m[1]:0};
  const stale=r3.msgs.slice(bi+1).filter(m=>{const e=lg3[idOf(m.text)-1];return !e||e.at<bAt});
  ok('ふたつ目のあとに、ひとつ目の頼みの返事が混ざらない',bi>0&&r3.msgs.length>bi+1&&stale.length===0,'ふたつ目のあと '+(r3.msgs.length-bi-1)+'件');
  ok('ふたつ目では、くろくんが答えた',r3.msgs.slice(bi+1).some(m=>m.who==='kuro'));

  // ---- 4. 二つのスレで同時に（片方は一覧に戻ったまま） ----
  await p.tap('#back');
  await p.tap('#newroom');await p.fill('#r-name','映画の話');await p.tap('#r-close');
  await say(p,'Gemini、映画');
  await p.tap('#back');
  await p.tap('.th:has-text("はじめのスレ")');
  await say(p,'くろくん、三つ目');
  await p.tap('#back');
  await p.waitForSelector('.th .busy');
  const busyN=await p.locator('.th .busy').count();
  await shot(p,'04-二つのスレが留守番役で回ってる');
  await p.waitForFunction(()=>S.rooms.every(r=>!r._ctrl),null,{timeout:90000});
  const mv=await room(p,'映画の話'),hj=await room(p,'はじめのスレ');
  ok('二つのスレが同時に「書いてる…」',busyN===2,busyN+'個');
  ok('映画の話にも、はじめのスレにも返事が入った',mv.msgs.filter(m=>m.who!=='me').length>0&&hj.msgs.slice(hj.msgs.findIndex(m=>m.text==='くろくん、三つ目')+1).length>0);
  ok('スレの箱は別々（合言葉は同じ、スレのidが違う）',mv.relay.since>0&&hj.relay.since>0);

  // ---- 5. このスレの一言が、留守番役経由でも紙に入る ----
  await p.tap('.th:has-text("映画の話")');await p.tap('#title');await p.fill('#r-note','ネタバレなし');await p.tap('#r-close');
  const before5=(await mockLog()).length;
  await say(p,'Gemini、もう一回');
  await p.waitForFunction(()=>S.rooms.every(r=>!r._ctrl),null,{timeout:60000});
  const lg5=(await mockLog()).slice(before5).filter(e=>e.who!=='?');
  ok('一言が紙の最後に入って届いた',lg5.length>0&&lg5.every(e=>e.hasNote),lg5.map(e=>e.who+(e.hasNote?'○':'×')).join(','));

  // ---- 6. うまく届かなかった時のお知らせ ----
  await mockSet('failOR=1');
  await say(p,'Gemini、エラーの時');
  await p.waitForFunction(()=>S.rooms.every(r=>!r._ctrl),null,{timeout:60000});
  await mockSet('failOR=0');
  ok('届かなかった時は、スレに赤いお知らせ（Privacyの案内つき）',await p.locator('#log .note.err:has-text("Settings → Privacy")').count()>=1);
  await shot(p,'05-届かなかった時');

  // ---- 7. 試しモードは、留守番役も偽の返事で回す（偽のAPIは呼ばない） ----
  await p.tap('#gear');await p.check('#s-test');await p.tap('#save');  // 映画の話の中のまま
  const before7=(await mockLog()).length;
  await say(p,'試しで話す');
  await p.waitForFunction(()=>S.rooms.every(r=>!r._ctrl),null,{timeout:60000});
  const mv7=await room(p,'映画の話');
  ok('試しモードでも留守番役が回した（偽のAPIは呼んでない）',(await mockLog()).length===before7&&mv7.msgs[mv7.msgs.length-1].who!=='me',mv7.msgs.slice(-2).map(m=>m.who+':'+m.text).join(' / '));
  await p.tap('#gear');await p.uncheck('#s-test');await p.tap('#save');

  // ---- 8. 頼みが終わったら、留守番役の箱に鍵が残ってない ----
  const ns=await (await fetch(RELAY+'/cdn-cgi/local/explorer/api/workers/durable_objects/namespaces')).json().catch(()=>null);
  results.push('（箱の一覧の形）'+JSON.stringify(ns).slice(0,200));

  // ---- 9. 住所が違う時 ----
  await p.tap('#gear');await p.fill('#s-relay','http://127.0.0.1:8799');await p.tap('#save');  // 映画の話の中のまま
  await say(p,'Gemini、住所ちがい');
  await p.waitForSelector('#log .note.err:has-text("留守番役に頼めなかった")',{timeout:20000});
  ok('住所が違う時は「留守番役に頼めなかった」と出て、止まったままにならない',!(await p.evaluate(()=>S.rooms.some(r=>r._ctrl))));
  await shot(p,'06-住所が違う時');
  await p.tap('#gear');await p.fill('#s-relay','');await p.tap('#save');
  ok('住所を空にすると「つないでる」が消える',await p.locator('#relaynote').isHidden());

  ok('エラーが出てない',errs.length===0,errs.slice(0,3).join(' / '));
  console.log('KEY',key);
  }catch(e){results.push('止まった：'+e.message.split('\n')[0])}
  console.log(results.join('\n'));
  await b.close();
})();
