/* play.html 的載入期冒煙測試。
   node --check 只驗語法，抓不到 TDZ、未定義參照這類「能解析但一執行就炸」的錯，
   也抓不到呈現層呼叫了內核沒有的方法。這支做兩件事：
     1. 用假 DOM 真的把 play.html 的腳本跑一次
     2. 照 play.html 用到的 API 面，把一整局從頭玩到底

   node play-smoke.js */
'use strict';
const fs=require('fs'), vm=require('vm'), path=require('path');
const K=require('./kernel.js');

let bad=0;
const ok=(n,c)=>{ if(c) console.log('  ✓ '+n); else { bad++; console.error('  ✗ '+n); } };

/* ---------- 1. 假 DOM 載入 ---------- */
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const inline=[];
const RE=/<script(\b[^>]*)>([\s\S]*?)<\/script>/g;
let mm;
while((mm=RE.exec(html))) if(mm[1].indexOf('src=')<0 && mm[2].trim().length>40) inline.push(mm[2]);
ok('index.html 裡有一段 inline 腳本', inline.length===1);

const el=()=>({style:{},dataset:{},value:'',textContent:'',innerHTML:'',id:'',className:'',
  classList:{add(){},remove(){},toggle(){},contains:()=>false},
  appendChild(){},insertBefore(){},remove(){},addEventListener(){},
  querySelectorAll:()=>[],querySelector:()=>null,onclick:null,select(){}});
const sandbox={console,Math,JSON,Object,Array,String,Number,Boolean,Date,isNaN,parseInt,parseFloat,
  Error,RegExp,encodeURIComponent,
  KERNEL:K,
  URLSearchParams:global.URLSearchParams,
  history:{replaceState(){}},
  location:{search:'?seed=smoke',href:'http://x/',reload(){}},
  document:{body:el(),getElementById:el,createElement:el,
    querySelector:()=>el(),querySelectorAll:()=>[]}};
sandbox.window=sandbox; sandbox.globalThis=sandbox;
vm.createContext(sandbox);
try{ vm.runInContext(inline[0],sandbox,{filename:'index.html'}); console.log('  ✓ 腳本載入不拋錯'); }
catch(e){ bad++; console.error('  ✗ 載入期就炸了：'+e.message); }

/* ---- 叫得到卻沒定義的函式 ----
   實際發生過：把舊的出牌面板換成骰子分配時，setAct() 被刪掉，
   但 actOnly() 還在呼叫它。載入期不會炸（那行還沒執行），
   要等到「結算完要畫下一年那顆按鈕」才 ReferenceError——
   於是整局卡在十六歲，而三十五條測試全綠。

   所以：把腳本裡所有「被當成函式呼叫的名字」抓出來，
   對照「腳本裡宣告過的名字」，少掉的就是這種未爆彈。 */
(function(){
  /* 先把註解與字串挖掉：不然會掃到 CSS 的 var(--dim)、
     以及註解裡提到的函式名（例如這一段自己）。 */
  const src=inline[0]
    .replace(/\/\*[\s\S]*?\*\//g,' ')
    .replace(/(^|[^:])\/\/[^\n]*/g,'$1 ')
    .replace(/'(?:\\.|[^'\\])*'/g,"''")
    .replace(/"(?:\\.|[^"\\])*"/g,'""')
    .replace(/`(?:\\.|[^`\\])*`/g,'``');
  const declared=new Set();
  let m;
  const DECL=/(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/g;
  while((m=DECL.exec(src))) declared.add(m[1]||m[2]);
  /* 參數也算宣告過（callback 的參數常常是函式） */
  const PARAM=/\(([^)]*)\)\s*=>|function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g;
  while((m=PARAM.exec(src)))
    (m[1]||m[2]||'').split(',').forEach(x=>{ x=x.trim().replace(/=.*$/,''); if(x) declared.add(x); });
  const BUILTIN=new Set(['if','for','while','switch','catch','return','typeof','function','new',
    'do','else','try','throw','void','delete','in','of','instanceof','case','await','yield',
    'Math','JSON','Object','Array','String','Number','Boolean','Date','Error','RegExp','Set','Map',
    'parseInt','parseFloat','isNaN','encodeURIComponent','decodeURIComponent','setTimeout',
    'URLSearchParams','requestAnimationFrame','alert','confirm','Promise','Symbol','BigInt']);
  const CALL=/(?:^|[^\w.$])([A-Za-z_$][\w$]*)\s*\(/g;
  const missing=new Set();
  while((m=CALL.exec(src))){
    const n=m[1];
    if(BUILTIN.has(n)||declared.has(n)) continue;
    if(typeof sandbox[n]==='function') continue;
    missing.add(n);
  }
  ok('沒有「叫得到卻沒定義」的函式'+(missing.size?'（'+[...missing].join('、')+'）':''),
     missing.size===0);
})();

const q=expr=>{ try{ return vm.runInContext(expr,sandbox); }catch(e){ return '<<'+e.message+'>>'; } };
ok('money() 可用',        q('money(12345)')==='1.23億');
ok('sgn() 可用',          q('sgn(3.14)')==='+3.1');
ok('esc() 擋掉尖括號',    q('esc("<img>")')==='&lt;img&gt;');
ok('種子白名單擋掉引號',  q('"a\\"b<c".replace(SAFE,"")')==='abc');

/* ---------- 2. 照 play.html 用到的 API 面玩一整局 ---------- */
const need=['newGame','BY_ID','HABITS','REGIME','slotsAt','INST','SIGNALS','THEMES'];
ok('KERNEL 匯出頁面要用的東西', need.every(k=>K[k]!=null));

const g=K.newGame('smoke');
const api=['nav','assets','investable','openYear','moves','play','midWindow','playMid','closeYear','career',
           'event','deferEvent','beginEvent','answerEvent','beat','pass','skipRest','setPlan','autoTick','riskCheck',
           'allocPreview','addAlloc','autoAllocate'];
ok('遊戲物件有頁面要用的方法', api.every(k=>typeof g[k]==='function'));

/* 新版順序：開年先配點，配完才翻事件卡。 */
(function(){
  const a=K.newGame('deferred-event'); a.openYear();
  const had=!!a.event();
ok('事件可延後到配點之後', !had || (a.deferEvent() && a.phase==='act' && a.beginEvent() && !!a.event()));
})();

(function(){
  let badDice=0;
  for(let i=0;i<200;i++){
    const a=K.newGame('dice-count-'+i); a.openYear();
    if(a.raw.dice.length<3||a.raw.dice.length>6||a.raw.dice.some(d=>d<1||d>6))badDice++;
  }
  ok('每年固定 3～6 顆，每顆 1～6 點（錯 '+badDice+' 局）',badDice===0);
})();

(function(){
  const a=K.newGame('profile-a'), again=K.newGame('profile-a'), b=K.newGame('profile-b');
  const keys=['invest','research','habit','life','funds'];
  const valid=keys.every(k=>a.raw.allocStats[k]>=20&&a.raw.allocStats[k]<=32&&
    a.raw.allocCaps[k]>=46&&a.raw.allocCaps[k]<=80&&a.raw.allocStats[k]<=a.raw.allocCaps[k]);
  const same=JSON.stringify([a.raw.allocStats,a.raw.allocCaps])===JSON.stringify([again.raw.allocStats,again.raw.allocCaps]);
  const different=JSON.stringify([a.raw.allocStats,a.raw.allocCaps])!==JSON.stringify([b.raw.allocStats,b.raw.allocCaps]);
  ok('種子決定初始點數與個別上限，同種子可重現',valid&&same&&different);
})();

(function(){
  const a=K.newGame('ability-cost');
  a.raw.allocStats.invest=58; a.raw.allocCaps.invest=70; a.raw.allocCarry.invest=0;
  const first=a.addAlloc('invest',3), second=a.addAlloc('invest',1);
  a.raw.allocStats.invest=70; a.raw.allocCarry.invest=0;
  const overPot=a.addAlloc('invest',27), finish=a.addAlloc('invest',1);
  ok('能力愈高升級愈貴，未滿一級的點數會保留，超過天賦後成本 ×4',
    first.value===58&&first.carry===3&&first.cost===4&&
    second.value===59&&second.carry===0&&overPot.value===70&&overPot.carry===27&&
    overPot.cost===28&&finish.value===71&&finish.carry===0);
})();

(function(){
  const run=(stats,trait)=>{
    const a=K.newGame('ability-performance'); a.setPlan(trait); a.openYear();
    a.raw.allocStats=Object.assign({},stats);
    a.raw.cash=0; a.raw.book={wide:{sh:1,cost:100}};
    return a.closeYear();
  };
  const low={invest:25,research:25,habit:25,life:25,funds:25};
  const high={invest:70,research:70,habit:70,life:70,funds:70};
  const researchHeavy={invest:25,research:70,habit:25,life:25,funds:25};
  const a=run(low,'craft'), b=run(high,'craft');
  const craft=run(researchHeavy,'craft'), life=run(researchHeavy,'life');
  ok('五種能力與開局特質會影響年度操作績效',
    b.abilityPct>a.abilityPct&&b.abilityGain>a.abilityGain&&craft.abilityPct>life.abilityPct);
})();

(function(){
  let low=0,hot=0,normal=0,valid=true;
  for(let i=0;i<600;i++){
    const a=K.newGame('year-form-'+i); a.openYear();
    const row=a.closeYear();
    if(row.form<0){low++;valid=valid&&row.formFactor===.65;}
    else if(row.form>0){hot++;valid=valid&&row.formFactor===1.2;}
    else{normal++;valid=valid&&row.formFactor===1;}
  }
  ok('年度狀態約一成失常、一成手感極佳，其餘正常發揮',
    valid&&low>35&&low<90&&hot>35&&hot<90&&normal>430&&normal<530);
})();

(function(){
  const a=K.newGame('automatic-performance'); a.setPlan('safe'); a.openYear();
  const cashBefore=a.raw.cash, allocation=a.autoAllocate(), hasHolding=!!a.raw.book.wide&&a.raw.cash<cashBefore;
  const row=a.closeYear();
  let chanceRaised=false;
  for(let i=0;i<100&&!chanceRaised;i++){
    const low=K.newGame('event-ability-'+i), high=K.newGame('event-ability-'+i);
    low.setPlan('safe'); high.setPlan('safe'); low.openYear(); high.openYear();
    Object.keys(high.raw.allocStats).forEach(k=>{high.raw.allocStats[k]=70;});
    const le=low.event(), he=high.event();
    if(le&&he){
      const li=le.opts.findIndex(o=>o.gamble);
      if(li>=0)chanceRaised=he.opts[li].chance>le.opts[li].chance;
    }
  }
  ok('沒有手動持股也會自動計算績效，能力會提高事件成功率',
    hasHolding&&allocation.amount>0&&Number.isFinite(row.autoMarketPct)&&chanceRaised);
})();

(function(){
  const countEvents=a=>{ let n=0,e; while((e=a.event())&&n<5){ a.answerEvent(e.opts[0].i); n++; } return n; };
  const student=K.newGame('student-events'); student.openYear();
  const adult=K.newGame('adult-events'); adult.raw.year=6; adult.career('job'); adult.openYear();
  ok('學生每年 2 個、成年後每年 3 個市場事件',countEvents(student)===2&&countEvents(adult)===3);
})();

(function(){
  const safe=K.newGame('plan-effect'); safe.setPlan('safe'); safe.openYear();
  const life=K.newGame('plan-effect'); life.setPlan('life'); life.openYear();
  ok('下一年度投資重點會實際改變消息、壓力或生活',
    safe.raw.tilt===49&&life.raw.life===76);
})();

(function(){
  let researchAdd=0,researchMiss=0,reportAdd=0,reportMiss=0;
  for(let i=0;i<200;i++){
    const a=K.newGame('signal-bonus-'+i);a.setPlan('craft');a.openYear();
    a.raw.signalBonus.research?researchAdd++:researchMiss++;
    const b=K.newGame('report-bonus-'+i);b.setPlan('safe');b.raw.habits.read={streak:3,stage:2};b.openYear();
    b.raw.signalBonus.report?reportAdd++:reportMiss++;
  }
  ok('研究與讀財報各有 50% 機率增加一條市場消息',
    researchAdd>0&&researchMiss>0&&reportAdd>0&&reportMiss>0);
})();

(function(){
  let safe=0,minor=0,major=0,repeatBad=0;
  for(let i=0;i<500;i++){
    const a=K.newGame('risk-check-'+i); a.openYear();
    a.raw.cash=5; a.raw.debt=20; a.raw.book.wide={sh:1,cost:100}; a.raw.tilt=82;
    const first=a.riskCheck(), nav=a.nav(), second=a.riskCheck();
    if(first.kind==='safe')safe++; else if(first.kind==='minor')minor++; else if(first.kind==='major')major++;
    if(first!==second||a.nav()!==nav)repeatBad++;
  }
  ok('風險檢查一次完成，能產生正常、小損失與重大危機',safe>0&&minor>0&&major>0&&repeatBad===0);
})();

/* 第 2 拍：卡沒處理掉，phase 會停在 'event'，moves() 與 beat() 全部回空——
   頁面是這樣做的，測試也必須這樣做，不然量到的是一個停住的遊戲。 */
function answerCard(a,pick){
  let last=null, guard=0;
  while(guard++<5){
    const e=a.event();
    if(!e || !e.opts.length) break;
    last=a.answerEvent(e.opts[pick%e.opts.length].i);
  }
  return last;
}

let years=0, plays=0, mids=0, kinds={}, cards=0;
let guard=0;
while(!g.over && guard++<40){
  if(g.raw.year===6) g.career('job');
  const o=g.openYear();
  if(!o) break;
  years++;
  /* 頁面讀的欄位 */
  if(!Array.isArray(o.signals)||o.signals.some(s=>!s.t)) { bad++; console.error('  ✗ 訊號牌缺 t'); break; }
  if(!Array.isArray(g.raw.notes)) { bad++; console.error('  ✗ notes 不是陣列'); break; }
  const ev=g.event();
  if(ev){
    cards++;
    if(!ev.n||!ev.d||!ev.opts.length){ bad++; console.error('  ✗ 事件卡缺欄位'); break; }
    const r=answerCard(g,years);
    if(!r||!r.text||!Array.isArray(r.eff)){ bad++; console.error('  ✗ answerEvent 回傳不完整'); break; }
  }
  if(g.raw.phase!=='act'){ bad++; console.error('  ✗ 處理完卡之後還卡在 '+g.raw.phase); break; }

  let spin=0;
  while(g.raw.apLeft>0 && spin++<20){
    const mv=g.moves();
    if(!mv.length) break;
    /* 每一種牌都至少走過一次：買、賣、研究、習慣、生活、加班 */
    const m=mv[(years*7+spin)%mv.length];
    const res=g.play(m.id, m.fracs?{frac:m.fracs[spin%m.fracs.length]}:undefined);
    if(res){
      plays++; kinds[m.kind]=(kinds[m.kind]||0)+1;
      /* 頁面在 reportPlay 讀的欄位 */
      if(m.kind==='buy'   && res.amount==null)      { bad++; console.error('  ✗ buy 沒有 amount'); }
      if(m.kind==='sell'  && res.pl==null)          { bad++; console.error('  ✗ sell 沒有 pl'); }
      if(m.kind==='margin'&& res.borrowed==null)    { bad++; console.error('  ✗ margin 沒有 borrowed'); }
      if(m.kind==='scout' &&(res.acc==null||res.beatsMarket==null)){ bad++; console.error('  ✗ scout 欄位不全'); }
      if(m.kind==='habit' && !(res.stage>=1&&res.stage<=3)){ bad++; console.error('  ✗ habit stage 超出 1..3'); }
      if(m.kind==='work'  && res.earned==null)      { bad++; console.error('  ✗ work 沒有 earned'); }
    }
    /* 出的牌若不合法，moves() 就不該列出來——列了卻做不動，UI 上就是按了沒反應 */
    else if(m.fracs==null){ bad++; console.error('  ✗ moves() 列出了做不動的牌：'+m.id); break; }
  }
  const w=g.midWindow();
  if(w){
    mids++;
    if(!w.options||!w.options.length){ bad++; console.error('  ✗ 年中窗口沒有選項'); }
    g.playMid(w.options[years%w.options.length].id);
  }
  const row=g.closeYear();
  if(row && (row.nav==null||row.ret==null||row.mkt==null||!K.REGIME[row.rg])){
    bad++; console.error('  ✗ 結算列缺欄位'); break;
  }
}
ok('玩得完一整局（'+years+' 年）', years>=20 || g.over);
ok('出過牌（'+plays+' 次）', plays>20);
ok('買、賣、習慣、研究都走到過',
   ['buy','sell','habit','scout'].every(k=>kinds[k]>0));
ok('遇過年中窗口（'+mids+' 次）', mids>0);

/* 年中「加碼」以前是無條件列出來的：現金 0 也給你按，
   按下去 playMid() 因為金額不足而什麼都不做，卻照樣扣心態。
   列出來卻做不動的選項，跟 beat() 那邊犯過的是同一個錯。 */
(function(){
  let windows=0, offered=0, ghost=0, broke=0, silent=0;
  for(let i=0;i<400;i++){
    const a=K.newGame('mid-'+i); let n=0;
    while(!a.over && n++<30){
      if(a.raw.year===6) a.career('job');
      if(!a.openYear()) break;
      answerCard(a,i+n);
      let s=0;
      while(a.raw.apLeft>0 && s++<20){
        if(!(a.raw.apLeft<=1 && a.beat()) && a.autoTick()) continue;
        const b=a.beat(); if(!b) break;
        const o=b.opts[(i+s)%b.opts.length];
        if(o.skip) a.pass(b.id); else if(!a.play(o.mv,o.arg)) break;
      }
      const w=a.midWindow();
      if(w){
        windows++;
        const add=w.options.filter(x=>x.id==='add')[0];
        if(add){
          offered++;
          const tilt=a.raw.tilt, mid=a.raw.mid;
          const r=a.playMid('add');
          /* 列出來就必須做得動 */
          if(!r || !(r.bought>0)) ghost++;
          /* 做不動的時候，心態與 mid 都不該被動過 */
          if(!r && (a.raw.tilt!==tilt || a.raw.mid!==mid)) silent++;
        } else {
          /* 沒列出來的年份，確實應該是錢不夠 */
          const need=a.investable()*(w.kind==='crash'?0.5:0.3);
          if(need>0.5) broke++;
          a.playMid('hold');
        }
      }
      a.closeYear();
    }
  }
  ok('年中窗口 '+windows+' 次，其中列出加碼 '+offered+' 次', windows>50);
  ok('列出來的加碼都買得動（做不動 '+ghost+' 次）', ghost===0);
  ok('沒列出來的都是真的錢不夠（誤判 '+broke+' 次）', broke===0);
  ok('做不動的時候不會偷偷動心態（'+silent+' 次）', silent===0);
})();
ok('抽到過事件卡（'+cards+' 張）', cards>=15);
ok('有結局', !!g.ending && !!g.ending.t);
ok('結局有頁面要印的欄位',
   g.ending && ['nav','inflow','bench','edge','tax','div','trades','blowups','life','age','endYear'].every(k=>g.ending[k]!=null));

(function(){
  const a=K.newGame('early-burnout-age'); a.openYear(); a.raw.life=0; a.closeYear();
  ok('「人先垮了」使用實際結算年齡，不會寫死四十歲',
    a.ending&&a.ending.id==='burnout'&&a.ending.age===16&&a.ending.years===1&&a.ending.endYear===2026);
})();

/* ---------- 3. 頁面真正走的路徑：beat() ----------
   畫面上不再攤 moves()，而是一次問一個處境。這條路徑必須自己測，
   不然「頁面能玩」這件事等於沒有驗過。 */
(function(){
  let opts=0, asks=0, mx=0, minOpt=99, years=0, ended=0;
  const seen={}; let badOpt=0, noSkip=0, autos=0, dry=0;
  const PLANS=K.PLAN_K;
  for(let i=0;i<200;i++){
    const a=K.newGame('beat-'+i); let guard=0;
    a.setPlan(PLANS[i%PLANS.length]);
    while(!a.over && guard++<40){
      if(a.raw.year===6) a.career('job');
      if(!a.openYear()) break;
      years++;
      answerCard(a,i+years);
      let s=0, asked=0;
      while(a.raw.apLeft>0 && s++<20){
        /* 頁面的節奏：不需要問的事先自動跑掉，但最後一顆骰子留給玩家。
           不留的話實測有 27% 的年份一句話都插不上——那一年不是玩家在過。 */
        if(!(a.raw.apLeft<=1 && a.beat()) && a.autoTick()){ autos++; continue; }
        const b=a.beat();
        if(!b){ a.skipRest(); break; }
        asks++; asked++; seen[b.id]=(seen[b.id]||0)+1;
        opts+=b.opts.length;
        if(b.opts.length>mx) mx=b.opts.length;
        if(b.opts.length<minOpt) minOpt=b.opts.length;
        if(!b.q) badOpt++;
        if(!b.opts.some(o=>o.skip)) noSkip++;
        const o=b.opts[(i+s)%b.opts.length];
        /* 每個選項都必須真的做得動——否則畫面上就是按了沒反應 */
        const okPlay = o.skip ? a.pass(b.id) : !!a.play(o.mv,o.arg);
        if(!okPlay){ badOpt++; break; }
      }
      if(!asked) dry++;
      const w=a.midWindow(); if(w) a.playMid(w.options[0].id);
      a.closeYear();
    }
    if(a.over) ended++;
  }
  const avg=opts/asks;
  ok('beat() 每題平均 '+avg.toFixed(1)+' 個選項（要 ≤5）', avg<=5);
  ok('最多 '+mx+' 個、最少 '+minOpt+' 個（要 2～5）', mx<=5 && minOpt>=2);
  ok('每題都有敘述，選項都做得動', badOpt===0);
  ok('每題都留得下「不做」這個選項', noSkip===0);
  ok('用 beat() 玩得完（'+ended+'/200 局）', ended===200);
  ok('處境不只一種（'+Object.keys(seen).length+' 種）', Object.keys(seen).length>=5);
  /* autoTick 沒有人呼叫的時候，生活／研究／加班在畫面上從來不會發生，
     骰子也因此只剩滑價一個作用。這兩條把那件事釘住。 */
  ok('不用問的事有自動跑掉（每年 '+(autos/years).toFixed(2)+' 件）', autos/years>1);
  /* 這一段量的是 beat() 舊出牌路徑（正式玩法已改配點制，不走這裡）。
     v36 讓事件卡的 mood 效果真的作用之後，心態會震盪，舊路徑的
     「不敢」（tilt≤20 買入牌消失）年份變多——那是舊路徑自己的個性，
     不是正式玩法的問題，門檻從 5% 放寬到 20%。 */
  ok('幾乎每年都問得到玩家（沒問到 '+(dry/years*100).toFixed(1)+'%，要 <20%）', dry/years<0.20);
  ok('每年問 '+(asks/years).toFixed(2)+' 次（要 1～3）', asks/years>=1 && asks/years<=3);
  console.log('    處境分布：'+Object.keys(seen).sort((x,y)=>seen[y]-seen[x])
    .map(k=>k+' '+(seen[k]/asks*100).toFixed(0)+'%').join('　'));
})();

/* ---------- 3.5 骰子分配：一次攤開、自己挑哪一顆 ----------
   以前骰子照順序被吃掉，玩家只能承受。現在 beats() 一次給出全部處境，
   play(id,{dieIdx}) 可以指定花哪一顆。這條路徑是畫面真正走的路，必須自己測。 */
(function(){
  let years=0, multi=0, mx=0, badOpt=0, outOfOrder=0, mismatch=0;
  for(let i=0;i<200;i++){
    const a=K.newGame('alloc-'+i);
    a.setPlan(K.PLAN_K[i%K.PLAN_K.length]);
    let guard=0;
    while(!a.over && guard++<40){
      if(a.raw.year===6) a.career('job');
      if(!a.openYear()) break;
      years++;
      answerCard(a,i+years);
      let s=0;
      while(a.raw.apLeft>0 && s++<20){
        if(!(a.raw.apLeft<=1 && a.beat()) && a.autoTick()) continue;
        /* 故意挑最後一顆還沒用的，而不是下一顆 */
        let want=-1;
        for(let k=a.raw.dice.length-1;k>=0;k--) if(!a.raw.dieUsed[k]){ want=k; break; }
        if(want<0) break;
        const bs=a.beats(want);
        if(!bs.length) break;
        if(bs.length>1) multi++;
        if(bs.length>mx) mx=bs.length;
        /* 預覽用的必須真的是我指定的那一顆 */
        bs.forEach(b=>{ if(b.die!==a.raw.dice[want]) mismatch++; });
        const b=bs[(i+s)%bs.length];
        const o=b.opts[(i+s)%b.opts.length];
        if(o.skip){ a.pass(b.id); continue; }
        const arg={dieIdx:want};
        if(o.arg) for(const k in o.arg) arg[k]=o.arg[k];
        const r=a.play(o.mv,arg);
        if(!r){ badOpt++; break; }
        /* 花掉的必須正好是那一顆 */
        if(r.dieIdx!==want || !a.raw.dieUsed[want]) outOfOrder++;
      }
      const w=a.midWindow(); if(w) a.playMid(w.options[0].id);
      a.closeYear();
    }
  }
  ok('beats() 一次給出全部處境（同時 '+mx+' 個、'+multi+' 次不只一個）', mx>=2 && multi>0);
  ok('預覽用的就是你挑的那一顆骰子（對不上 '+mismatch+' 次）', mismatch===0);
  ok('指定的骰子真的被花掉（錯 '+outOfOrder+' 次）', outOfOrder===0);
  ok('攤開的選項都做得動（做不動 '+badOpt+' 次）', badOpt===0);
})();

/* ---------- 4. 相同種子＋相同選擇＝相同人生 ---------- */
/* 挑哪一顆骰子也是一種選擇：同樣的挑法必須得到同樣的人生。
   挑骰子不擲任何亂數，所以種子流不該被動到。 */
function replayAlloc(seed){
  const a=K.newGame(seed); let n=0;
  while(!a.over && n++<40){
    if(a.raw.year===6) a.career('job');
    if(!a.openYear()) break;
    answerCard(a,n);
    let s=0;
    while(a.raw.apLeft>0 && s++<20){
      let want=-1;
      for(let k=a.raw.dice.length-1;k>=0;k--) if(!a.raw.dieUsed[k]){ want=k; break; }
      if(want<0) break;
      const bs=a.beats(want); if(!bs.length) break;
      const b=bs[0], o=b.opts[(n+s)%b.opts.length];
      if(o.skip){ a.pass(b.id); continue; }
      const arg={dieIdx:want};
      if(o.arg) for(const k in o.arg) arg[k]=o.arg[k];
      if(!a.play(o.mv,arg)) break;
    }
    const w=a.midWindow(); if(w) a.playMid(w.options[0].id);
    a.closeYear();
  }
  return a.ending;
}
function replay(seed){
  const a=K.newGame(seed); let n=0;
  while(!a.over && n++<40){
    if(a.raw.year===6) a.career('job');
    if(!a.openYear()) break;
    answerCard(a,n);
    let s=0;
    while(a.raw.apLeft>0 && s++<20){
      const mv=a.moves(); if(!mv.length) break;
      const m=mv[(n*3+s)%mv.length];
      a.play(m.id, m.fracs?{frac:m.fracs[0]}:undefined);
    }
    const w=a.midWindow(); if(w) a.playMid(w.options[0].id);
    a.closeYear();
  }
  return a.ending;
}
const r1=replay('determinism'), r2=replay('determinism');
ok('同種子同選擇＝同人生', JSON.stringify(r1)===JSON.stringify(r2));
ok('換種子就換人生', JSON.stringify(replay('other'))!==JSON.stringify(r1));
ok('挑骰子的那條路徑也是決定論的',
   JSON.stringify(replayAlloc('alloc-det'))===JSON.stringify(replayAlloc('alloc-det')));

process.exit(bad?1:0);
