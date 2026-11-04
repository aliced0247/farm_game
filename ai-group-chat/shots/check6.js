// みんなのへや（版6：スレ）の確かめ。試しモードで、iPhoneの大きさで本当に押して、画面を撮る
// 使い方：リポジトリの一番上で python3 -m http.server 8123 を動かしてから
//   node ai-group-chat/shots/check6.js [撮った画面を置くフォルダ] [幅（390か360）]
const {chromium}=require('playwright');
const OUT=process.argv[2]||__dirname;
const W=+(process.argv[3]||390);
const BASE='http://127.0.0.1:8123/ai-group-chat/';
const K='ai-group-chat:v1';
const results=[];
const ok=(name,cond,info)=>{results.push((cond?'OK ':'NG ')+name+(info?'　'+info:''));};
(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:W,height:W===390?844:740},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'ja-JP'});
  await ctx.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:8123'});
  await ctx.addInitScript(()=>{let a=20261104;Math.random=()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}});
  const p=await ctx.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  const net=[];p.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1'))net.push(r.url())});
  p.on('dialog',d=>d.accept());
  const shot=async n=>p.screenshot({path:OUT+'/'+W+'-'+n+'.png'});
  const say=async t=>{await p.fill('#in',t);await p.tap('#send')};
  const roomByName=n=>p.evaluate(n=>{const r=S.rooms.find(x=>x.name===n);return r&&{id:r.id,n:r.msgs.length,busy:!!r._ctrl,on:r.on,copyAt:r.copyAt,note:r.note,inline:!!r.inline}},n);
  const idle=n=>p.waitForFunction(n=>{const r=S.rooms.find(x=>x.name===n);return r&&!r._ctrl},n,{timeout:40000});

  // ---- 1. 版5の形で保存されてる会話を置いておく（へやのデータも偽物を置く） ----
  await p.goto(BASE);
  const t0=Date.UTC(2026,10,3,10,0,0);
  const old={name:'ミント',test:true,orKey:'',kuroKey:'',kuroSys:'',think:true,on:{kuro:true,gpt:true,gemini:true,grok:false,claude:true,kimi:true,muse:true,deepseek:true},
    msgs:[{who:'me',text:'きのうの話',at:t0},{who:'kuro',text:'おう、覚えてる',at:t0+60000},{who:'gpt',text:'私も覚えてます',at:t0+120000},{who:'me',text:'ありがと',at:t0+180000},{who:'gemini',text:'どういたしまして✨',at:t0+240000}],
    day:'',dayCost:0,copyAt:t0+120000};
  await p.evaluate(([K,o])=>{localStorage.clear();localStorage.setItem('kuro-chat-v1',JSON.stringify({key:'sk-ant-dummy-for-check-0000',msgs:[{role:'user',text:'へやの会話'}]}));localStorage.setItem(K,JSON.stringify(o))},[K,old]);
  const heyaBefore=await p.evaluate(()=>localStorage.getItem('kuro-chat-v1'));
  await p.reload();
  await shot('01-一覧（版5から移った）');
  const st=await p.evaluate(K=>{const t=JSON.parse(localStorage.getItem(K));return {hasMsgs:'msgs' in t,hasOn:'on' in t,rooms:t.rooms.map(r=>({name:r.name,id:r.id,on:r.on,copyAt:r.copyAt,inline:r.inline,hasMsgs:'msgs' in r})),
    stored:t.rooms.map(r=>JSON.parse(localStorage.getItem(K+':r:'+r.id)||'[]').length)}},K);
  ok('版5の会話が「はじめのスレ」になった',st.rooms.length===1&&st.rooms[0].name==='はじめのスレ'&&st.stored[0]===5,JSON.stringify(st.rooms.map(r=>r.name))+' 件数'+st.stored);
  ok('K の中から一本の会話（msgs・on・copyAt）が消えて、スレの方に移った',!st.hasMsgs&&!st.hasOn&&!st.rooms[0].hasMsgs&&!st.rooms[0].inline);
  ok('いる子（Grokを外してた）とコピー位置がそのまま',st.rooms[0].on.grok===false&&st.rooms[0].copyAt===t0+120000);
  ok('一覧に、最後の一言と時刻',(await p.textContent('.th .pv')).includes('Gemini：どういたしまして')&&(await p.textContent('.th .tm2'))==='11/3',await p.textContent('.th .pv'));

  // ---- 2. スレに入る ----
  await p.tap('.th');
  ok('スレの中：5件出る・上に名前と戻る',await p.locator('#log .msg').count()===5&&(await p.textContent('#tname'))==='はじめのスレ'&&await p.isVisible('#back'));
  await shot('02-はじめのスレの中');

  // ---- 3. 送ってすぐ一覧に戻る → 書いてるのが止まらない ----
  await say('くろくん、ジェミちゃん、きいて');
  await p.waitForSelector('#log .typing,#log .note:not(.empty)');
  await p.tap('#back');
  await p.waitForSelector('.busy');
  ok('一覧に戻っても「書いてる…」',(await p.textContent('.th .busy'))==='書いてる…');
  await shot('03-一覧で書いてる');
  const before=(await roomByName('はじめのスレ')).n;
  await idle('はじめのスレ');
  const after=await roomByName('はじめのスレ');
  ok('一覧にいる間に返事が増えた',after.n>before+0,before+'→'+after.n);
  ok('書き終わったら「書いてる…」が消えて、まだ読んでない点が出る',await p.locator('.th .busy').count()===0&&await p.locator('.th .dot').count()===1);
  const whoSaid=await p.evaluate(()=>S.rooms[0].msgs.slice(6).map(m=>m.who));
  ok('外してたGrokは呼ばれない',!whoSaid.includes('grok'),whoSaid.join(','));
  await shot('04-一覧で書き終わった');

  // ---- 4. 新しいスレ：名前・いる子・一言 ----
  await p.tap('#newroom');
  await p.waitForSelector('#sheet.on');
  await shot('05-新しいスレの設定');
  await p.fill('#r-name','映画の話');
  for(const n of ['ChatGPT','Grok','Claude','Kimi','Muse','DeepSeek'])await p.tap(`#r-on button:text-is("${n}")`);
  await p.fill('#r-note','今日は映画の話。ネタバレは聞かれるまで言わない');
  await shot('06-名前といる子と一言');
  await p.tap('#r-close');
  ok('上の名前が変わった',(await p.textContent('#tname'))==='映画の話');
  const mv=await roomByName('映画の話');
  ok('いる子はくろくんとGeminiだけ',Object.entries(mv.on).filter(([k,v])=>v).map(([k])=>k).join(',')==='kuro,gemini',JSON.stringify(mv.on));
  const sys=await p.evaluate(()=>{const r=S.rooms.find(x=>x.name==='映画の話');return {g:sysFor('gemini',r),k:sysFor('kuro',r)}});
  ok('一言がGeminiの紙の最後に入る',sys.g.endsWith('［このスレの一言］\n今日は映画の話。ネタバレは聞かれるまで言わない'));
  ok('一言がくろくんの紙の最後にも入る（今この部屋にいるAIの行のあと）',/［今この部屋にいるAI：Gemini］\n\n［このスレの一言］/.test(sys.k));
  ok('一言は「はじめのスレ」の紙には入らない',!(await p.evaluate(()=>sysFor('gemini',S.rooms.find(x=>x.name==='はじめのスレ')))).includes('このスレの一言'));

  // ---- 5. 二つのスレで同時に書かせる ----
  await say('おすすめ教えて');
  await p.waitForSelector('#log .typing,#log .note:not(.empty)');
  await p.tap('#back');
  await p.tap('.th:has-text("はじめのスレ")');
  ok('開いたら読んでない点が消える',await p.evaluate(()=>!unread(S.rooms.find(x=>x.name==='はじめのスレ'))));
  await say('もう一個きいて');
  const both=await p.evaluate(()=>S.rooms.filter(r=>r._ctrl).map(r=>r.name));
  ok('二つのスレが同時に書いてる',both.length===2,both.join('・'));
  await shot('07-はじめのスレで書いてる間');
  await idle('映画の話');await idle('はじめのスレ');
  const mw=await p.evaluate(()=>S.rooms.find(x=>x.name==='映画の話').msgs.filter(m=>m.who!=='me').map(m=>m.who));
  ok('映画の話：くろくんとGeminiだけが喋った',mw.length>0&&mw.every(w=>w==='kuro'||w==='gemini'),mw.join(','));
  await p.tap('#back');await shot('08-一覧（二つ）');
  ok('一覧は新しい順',(await p.locator('.th .tn span').allTextContents()).join('|'),(await p.locator('.th .tn span').allTextContents()).join('|'));

  // ---- 6. 下書きはスレごと ----
  await p.tap('.th:has-text("映画の話")');
  await p.fill('#in','書きかけ');
  await p.tap('#back');await p.tap('.th:has-text("はじめのスレ")');
  const d1=await p.inputValue('#in');
  await p.tap('#back');await p.tap('.th:has-text("映画の話")');
  const d2=await p.inputValue('#in');
  ok('書きかけはスレごとに残る',d1===''&&d2==='書きかけ',JSON.stringify([d1,d2]));
  await p.fill('#in','');

  // ---- 7. 会話をコピーはスレごと ----
  await p.tap('#copy');
  await p.waitForTimeout(200);
  const clip=await p.evaluate(()=>navigator.clipboard.readText().catch(()=>''));
  ok('コピーの一行目にスレの名前',clip.startsWith('みんなのへや「映画の話」の会話'),clip.split('\n')[0]);
  const ca=await p.evaluate(()=>S.rooms.map(r=>[r.name,r.copyAt]));
  ok('コピー位置は映画の話だけ動いて、はじめのスレはそのまま',ca.find(x=>x[0]==='はじめのスレ')[1]===t0+120000&&ca.find(x=>x[0]==='映画の話')[1]>0,JSON.stringify(ca));

  // ---- 8. 開き直しても残る ----
  const countsBefore=await p.evaluate(()=>S.rooms.map(r=>r.name+':'+r.msgs.length).sort().join(','));
  await p.reload();
  const countsAfter=await p.evaluate(()=>S.rooms.map(r=>r.name+':'+r.msgs.length).sort().join(','));
  ok('開き直しても、スレと会話が全部残る',countsBefore===countsAfter,countsAfter);
  ok('開き直すと一覧から',await p.isVisible('#rooms')&&!(await p.isVisible('#log')));

  // ---- 9. 前の版のページ（v5/）で話した分 ----
  await p.goto(BASE+'v5/');
  await p.waitForTimeout(300);
  await p.fill('#in','前の版で話す');await p.tap('#send');
  await p.waitForFunction(()=>!ctrl,null,{timeout:30000});
  await p.goto(BASE);
  const names=await p.evaluate(()=>S.rooms.map(r=>r.name+':'+r.msgs.length));
  ok('前の版のページで話した分は別のスレになる（ほかのスレはそのまま）',names.some(n=>n.startsWith('前の版のページで話した分:'))&&names.length===3,names.join(' / '));
  const k2=await p.evaluate(K=>'msgs' in JSON.parse(localStorage.getItem(K)),K);
  ok('移したあと K に一本の会話は残らない',!k2);

  // ---- 10. スレを消す ----
  await p.tap('.th:has-text("前の版のページで話した分")');
  await p.tap('#title');await p.waitForSelector('#sheet.on');
  const delId=(await roomByName('前の版のページで話した分')).id;
  await p.tap('#r-del');
  await p.waitForTimeout(200);
  const gone=await p.evaluate(([K,id])=>({rooms:S.rooms.map(r=>r.name),key:localStorage.getItem(K+':r:'+id)}),[K,delId]);
  ok('消したスレは一覧からも保存場所からも消える',!gone.rooms.includes('前の版のページで話した分')&&gone.key===null&&gone.rooms.length===2,gone.rooms.join('・'));
  ok('消したあとは一覧に戻る',await p.isVisible('#rooms'));

  // ---- 11. 保存場所がいっぱいの時 ----
  // スレの場所に入らない → K の中に一緒に置く（知らせない）。K にも入らない → 赤い字で知らせる
  await p.evaluate(K=>{const orig=Storage.prototype.setItem;window.__full='room';Storage.prototype.setItem=function(k,v){if(window.__full==='all'||(window.__full==='room'&&k.startsWith(K+':r:')))throw new DOMException('full','QuotaExceededError');return orig.call(this,k,v)}},K);
  await p.tap('.th:has-text("映画の話")');
  await say('いっぱいの時');
  await idle('映画の話');
  const inl=await p.evaluate(K=>{const t=JSON.parse(localStorage.getItem(K));const r=t.rooms.find(x=>x.name==='映画の話');return {inline:r.inline,n:(r.msgs||[]).length,mem:S.rooms.find(x=>x.name==='映画の話').msgs.length,key:localStorage.getItem(K+':r:'+r.id)}},K);
  ok('スレの場所に入らない時は K の中に一緒に置く',inl.inline===true&&inl.n===inl.mem&&inl.key===null,JSON.stringify({inline:inl.inline,n:inl.n,mem:inl.mem}));
  ok('そこまでは赤い字は出ない',await p.locator('#savewarn').isHidden());
  await p.evaluate(()=>{window.__full='all'});
  await say('もっといっぱい');
  await idle('映画の話');
  ok('どこにも入らない時は、スレの中に赤い字で出る',await p.locator('#log .note.err:has-text("保存できなかった")').count()>=1);
  await p.tap('#back');
  ok('一覧の下にも赤い字',await p.isVisible('#savewarn'));
  await shot('09-保存できなかった');
  await p.evaluate(()=>{window.__full='none'});
  await p.tap('.th:has-text("映画の話")');await say('戻った');await idle('映画の話');
  const back=await p.evaluate(K=>{const t=JSON.parse(localStorage.getItem(K));const r=t.rooms.find(x=>x.name==='映画の話');return {inline:!!r.inline,key:JSON.parse(localStorage.getItem(K+':r:'+r.id)||'[]').length,mem:S.rooms.find(x=>x.name==='映画の話').msgs.length}},K);
  ok('空いたら、またスレの場所に戻る',!back.inline&&back.key===back.mem,JSON.stringify(back));
  await p.tap('#back');
  ok('空いたら赤い字が消える',await p.locator('#savewarn').isHidden());

  // ---- 12. 設定の画面 ----
  await p.tap('#gear');await shot('10-設定（いる子はスレごと）');
  ok('設定に「部屋にいる子」のチェックが残ってない',await p.locator('#s-on').count()===0);
  await p.tap('#close');

  // ---- 13. へやには触ってない・外に出てない ----
  ok('くろくんのへやの保存はそのまま',(await p.evaluate(()=>localStorage.getItem('kuro-chat-v1')))===heyaBefore);
  ok('試しモードで外に通信してない',net.length===0,net.slice(0,3).join(' '));
  ok('エラーが出てない',errs.length===0,errs.slice(0,3).join(' / '));

  // 暗い画面の見た目
  await p.emulateMedia({colorScheme:'dark'});
  await shot('11-一覧（暗い画面）');
  await p.tap('.th:has-text("はじめのスレ")');await p.tap('#title');await p.waitForSelector('#sheet.on');
  await shot('12-このスレ（暗い画面）');

  console.log(results.join('\n'));
  await b.close();
})();
