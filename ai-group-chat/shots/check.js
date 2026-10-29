// みんなのへや（版1）の確かめ。試しモードで、iPhoneと同じ大きさ（390×844）で本当に押して、画面を撮る
// 使い方：リポジトリの一番上で python3 -m http.server 8123 を動かしてから
//   node ai-group-chat/shots/check.js [撮った画面を置くフォルダ]
const {chromium}=require('playwright');
const OUT=process.argv[2]||__dirname;
const URL='http://127.0.0.1:8123/ai-group-chat/';
const results=[];
const ok=(name,cond,info)=>{results.push((cond?'OK ':'NG ')+name+(info?'　'+info:''));};
(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'ja-JP'});
  // 毎回同じ流れになるように、くじ（Math.random）を決まった並びにする
  await ctx.addInitScript(()=>{let a=20261029;Math.random=()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}});
  const p=await ctx.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  const net=[];p.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1'))net.push(r.url())});
  const shot=async n=>p.screenshot({path:OUT+'/'+n+'.png'});
  const msgs=()=>p.evaluate(()=>S.msgs.map(m=>({who:m.who,text:m.text})));
  const idle=()=>p.waitForFunction(()=>!ctrl,null,{timeout:30000});
  const say=async t=>{await p.fill('#in',t);await p.tap('#send')};

  // へやのデータ（偽物）を先に置いておく
  await p.goto(URL);
  const HEYA=JSON.stringify({key:'sk-ant-dummy-for-check-0000',sys:'（へやの紙・確かめ用）',model:'claude-opus-5-5',think:true,msgs:[{role:'user',text:'へやの会話'},{role:'assistant',text:'へやの返事',meta:'約$0.010'}],bal:10,spent:1.5});
  await p.evaluate(h=>{localStorage.clear();localStorage.setItem('kuro-chat-v1',h);localStorage.setItem('heya-test:v1','{"msgs":[]}')},HEYA);
  await p.reload();
  await shot('01-はじめて開いた');

  // 設定：名前と試しモード
  await p.tap('#gear');
  ok('設定：へやの鍵を見つけた表示',(await p.textContent('#s-heya')).includes('見つかった'));
  await p.fill('#s-name','ミント');await p.check('#s-test');
  await shot('02-設定');
  await p.tap('#save');

  // 1. 名前を呼ばずに送る
  await say('今日は雨だったよ');
  await p.waitForSelector('.note');await shot('03-司会が決めてる');
  await p.waitForSelector('.typing');await shot('04-入力中');
  ok('入力中…が出る',await p.isVisible('.typing .b'),await p.textContent('.typing .nm')+'：'+(await p.textContent('.typing .b')));
  await idle();
  let m=await msgs();
  ok('名前を呼ばずに送る：だれかが答える',m.length>=2&&m[1].who!=='me',m.slice(1).map(x=>x.who).join('→'));
  await shot('05-名前を呼ばずに送った');

  // 2. 名前を呼んで送る
  let n0=(await msgs()).length;
  await say('ジェミちゃん、おすすめの映画ある？');await idle();
  m=await msgs();
  ok('名前を呼んで送る：Gemini が最初に答える',m[n0+1]&&m[n0+1].who==='gemini',m.slice(n0+1).map(x=>x.who).join('→'));
  await shot('06-ジェミちゃんを呼んだ');

  // 3. 「みんな」で送る
  n0=(await msgs()).length;
  await say('みんな、おはよう');await idle();
  m=await msgs();
  const first4=m.slice(n0+1,n0+5).map(x=>x.who).join('→');
  ok('「みんな」で送る：4人全員が先に答える',first4==='kuro→gpt→gemini→grok',first4);
  const extra=m.length-(n0+5);
  ok('AI同士の返し：あとから足された分は 2周×2人＝4件まで',extra>=1&&extra<=4,'足された '+extra+' 件：'+m.slice(n0+5).map(x=>x.who+'「'+x.text+'」').join(' / '));
  await shot('07-みんなで送った');

  // 4. もっと喋らせる
  n0=(await msgs()).length;
  await p.tap('#more');
  await p.waitForSelector('.typing');await shot('08-もっと喋らせる中');
  await idle();
  m=await msgs();
  const added=m.slice(n0);
  ok('もっと喋らせる：AIだけがもう一周喋る',added.length>=1&&added.every(x=>x.who!=='me'),added.map(x=>x.who).join('→'));
  await shot('09-もっと喋らせた');

  // 5. 喋ってる途中で送ったら、前の分はやめる
  n0=(await msgs()).length;
  await say('みんな、聞いて');
  await p.waitForSelector('.typing');
  await say('やっぱり、くろくんだけ答えて');
  await idle();
  m=await msgs();
  ok('途中で送ると、前の分はやめて新しい話に移る',m[n0].who==='me'&&m[n0+1].who==='me'&&m[n0+2].who==='kuro',m.slice(n0).map(x=>x.who).join('→'));

  // 額
  const today=await p.textContent('#today');
  const sum=await p.evaluate(()=>S.dayCost);
  ok('画面の上の端に今日の額',/今日 \$\d/.test(today)&&sum>0,today);
  ok('吹き出しの横に一回ごとの額',(await p.textContent('.msg.them .tm')).includes('$'));
  const sumCheck=await p.evaluate(()=>{let t=0;for(const m of S.msgs)t+=(m.cost||0)+(m.mod||0);return Math.abs(t-S.dayCost)<1e-9});
  ok('今日の額＝吹き出しの横の額の合計',sumCheck);

  // 6. 開き直しても会話が残ってる
  const before=await msgs();
  await p.reload();await p.waitForTimeout(300);
  const after=await msgs();
  ok('開き直しても会話が残ってる',JSON.stringify(before)===JSON.stringify(after)&&(await p.$$('.msg')).length===after.length,after.length+'件');
  ok('開き直しても今日の額が残ってる',(await p.textContent('#today'))===today,await p.textContent('#today'));
  await shot('10-開き直した');

  // 7. 日付が変わったら今日の分は0から
  await p.evaluate(()=>{const s=JSON.parse(localStorage.getItem('ai-group-chat:v1'));s.day='2000-01-01';localStorage.setItem('ai-group-chat:v1',JSON.stringify(s))});
  await p.reload();
  ok('日付が変わったら今日の分は0から',(await p.textContent('#today'))==='今日 $0.0000',await p.textContent('#today'));

  // 8. 司会が変な答えを返した時
  const fb=await p.evaluate(()=>[parseSpeakers('えーと、Geminiかな'),parseSpeakers('{"speakers":["だれか"]}'),JSON.stringify(parseSpeakers('{"speakers": ["グロック","くろくん","くろくん"]}')),fallbackOne(AIS)]);
  ok('司会の変な答えは読まない',fb[0]===null&&fb[1]===null,String(fb[0])+' / '+String(fb[1]));
  ok('司会の答えの名前を読む',fb[2]==='["grok","kuro"]',fb[2]);
  ok('変な答えの時は、くろくんか一番喋ってない子',['kuro','gpt','gemini','grok'].includes(fb[3]),fb[3]);

  // 呼び名：ほかの言葉の中では数えない
  const calls=await p.evaluate(()=>['ごくろうさま','まっくろな猫','くろい服','ちゃちゃっと片付けた','くろ、聞いて','くろちゃん','ちゃちゃ、元気？','グロックとジェミちゃん'].map(t=>t+'→'+(calledByUser(t).join('・')||'なし')));
  ok('呼び名：ほかの言葉の中（ごくろうさま・まっくろ・くろい・ちゃちゃっと）では呼ばれない',calls.slice(0,4).every(x=>x.endsWith('→なし')),calls.slice(0,4).join(' '));
  ok('呼び名：くろ・くろちゃん・ちゃちゃ・二人呼び',calls.slice(4).join(' ')==='くろ、聞いて→kuro くろちゃん→kuro ちゃちゃ、元気？→gpt グロックとジェミちゃん→grok・gemini',calls.slice(4).join(' '));

  // 司会が決めた後、だれかが書いている途中でやめても、司会の額が吹き出しの横に出る
  await say('今日はなにしてた？');
  await p.waitForSelector('.typing');
  const modShown=await p.evaluate(()=>{const m=S.msgs[S.msgs.length-1];return m.who==='me'&&m.mod>0&&[...document.querySelectorAll('.msg.me .tm')].pop().textContent.includes('司会 $')});
  await say('やっぱりなんでもない');await idle();
  ok('途中でやめても、司会の額が送った一言の横に出る',modShown);

  // 9. 会話を消す（確認つき）
  await p.tap('#gear');await p.click('details summary');await p.$eval('#s-clear',e=>e.scrollIntoView({block:'center'}));await shot('11-会話を消すは設定の奥');
  p.once('dialog',d=>d.dismiss());await p.tap('#s-clear');
  ok('会話を消す：「いいえ」なら消えない',(await msgs()).length>0);
  p.once('dialog',d=>d.accept());await p.tap('#s-clear');
  ok('会話を消す：「はい」なら消える',(await msgs()).length===0);

  // へやのデータが変わってないこと
  const heyaAfter=await p.evaluate(()=>localStorage.getItem('kuro-chat-v1'));
  ok('へやのデータ（kuro-chat-v1）が使う前と同じ',heyaAfter===HEYA);
  ok('へやの試し版のデータ（heya-test:v1）も同じ',(await p.evaluate(()=>localStorage.getItem('heya-test:v1')))==='{"msgs":[]}');
  ok('試しモードでは外に何も送っていない',net.length===0,net.join(' '));
  ok('画面のエラーなし',errs.length===0,errs.join(' / '));
  ok('鍵・名前がページのコードに入っていない',!(await (await p.request.get(URL)).text()).match(/sk-ant-[A-Za-z0-9]|sk-or-[A-Za-z0-9]|もえ/));
  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some(r=>r.startsWith('NG'))?1:0);
})();
