/* ================================================================
   內核 v33 · 平衡模擬器（配點制）

   跑 N 局 × 數種策略，回答三個問題：
     1. 有沒有支配策略？（任何一種打爆其他所有種，遊戲就不用玩了）
     2. 隨機性夠不夠寬？（同一種策略的 p10 與 p90 差多少）
     3. 破產與人垮掉的比例合不合理？

   v19 之後玩法換成配點制：投資由 autoAllocate 自動執行，
   玩家的決策面是「骰子灌哪五路、事件怎麼答、年中怎麼應對、
   年末方針、要不要收手」。策略照這個面寫，舊的手動買賣策略全部作廢。

   策略一律不呼叫內核的亂數，只讀狀態——否則會偷走種子流，結果不可比。

   node kernel-sim.js [局數]
   ================================================================ */
'use strict';
const K=require('./kernel.js');

/* ---- 事件卡 ----
   策略不能自己擲骰（會偷走種子流），選項用固定規則挑：
   safe 挑第一個（幾乎都是最保守的），bold 挑最後一個（幾乎都是賭最大的）。
   量到兩端：「從不冒險」與「每次都梭」各自的下場。 */
function answerCard(g,mode){
  const e=g.event();
  if(!e || !e.opts.length) return;
  const i = mode==='bold' ? e.opts[e.opts.length-1].i
          : mode==='mid'  ? e.opts[Math.floor((e.opts.length-1)/2)].i
          : e.opts[0].i;
  g.answerEvent(i);
}

/* ---- 配點工具 ---- */
const ROWS5=['invest','research','habit','life','funds'];
const statOf=(g,r)=>(g.raw.allocStats&&g.raw.allocStats[r])||0;
const notCap=(g,r)=>statOf(g,r)<80;
const firstOk=(g,pref)=>{ for(const r of pref) if(notCap(g,r)) return r; return null; };
/* 天賦缺口最大的那一路（沒封頂的裡面挑 cap−stat 最大） */
function gapMax(g){
  const caps=g.raw.allocCaps||{};
  let best=null, bestGap=-1;
  ROWS5.forEach(r=>{
    if(!notCap(g,r)) return;
    const gap=(caps[r]||80)-statOf(g,r);
    if(gap>bestGap){ bestGap=gap; best=r; }
  });
  return best;
}

/* ================= 策略 =================
   alloc(g,idx,val) 回傳這顆骰子要灌哪一路；
   ev  = 事件卡風格（safe/mid/bold）
   mid = 年中窗口（回傳 option id，找不到就用第一個）
   plan = 年末方針；walk = 達標就收手 */
const POLICIES={
  '全灌投資':{plan:'craft',ev:'safe',
    alloc:g=>firstOk(g,['invest','research','funds','habit','life']),
    mid:()=>'hold'},

  '全灌生活':{plan:'life',ev:'safe',
    alloc:g=>firstOk(g,['life','habit','funds','research','invest']),
    mid:()=>'hold'},

  '平均輪流':{plan:'craft',ev:'mid',
    alloc:(g,idx)=>{ const r=ROWS5[idx%5]; return notCap(g,r)?r:firstOk(g,ROWS5); },
    mid:w=>w.kind==='crash'?'hold':'hold'},

  '天賦缺口優先':{plan:'craft',ev:'mid',
    alloc:g=>gapMax(g),
    mid:w=>w.kind==='crash'?'hold':'take'},

  '投資研究對半':{plan:'craft',ev:'mid',
    alloc:(g,idx)=>firstOk(g, idx%2 ? ['research','invest','funds','habit','life']
                                    : ['invest','research','funds','habit','life']),
    mid:w=>w.kind==='crash'?'cut':'take'},

  '紀律資金流':{plan:'safe',ev:'safe',
    alloc:(g,idx)=>firstOk(g, idx%2 ? ['funds','habit','life','invest','research']
                                    : ['habit','funds','life','invest','research']),
    mid:()=>'hold'},

  '事件全梭（平均輪流）':{plan:'craft',ev:'bold',
    alloc:(g,idx)=>{ const r=ROWS5[idx%5]; return notCap(g,r)?r:firstOk(g,ROWS5); },
    mid:w=>w.kind==='crash'?'add':'add'},

  '達標就收手':{plan:'craft',ev:'mid',walk:true,
    alloc:(g,idx)=>{ const r=ROWS5[idx%5]; return notCap(g,r)?r:firstOk(g,ROWS5); },
    mid:w=>w.kind==='crash'?'hold':'take'}
};

/* ================= 跑一局 =================
   內核呼叫順序照 play.html 的年循環：
   openYear → deferEvent → addAlloc×n → autoAllocate → skipRest →
   beginEvent → answerEvent×n → riskCheck → midWindow/playMid → closeYear。
   順序動一格，同一顆種子就是另一條人生。 */
function run(seed,P){
  const g=K.newGame(seed);
  g.setPlan(P.plan||'craft');
  let guard=0;
  while(!g.over && guard++<40){
    if(16+g.raw.year===22 && !g.raw.careerSet){ g.raw.careerSet=1; g.career(P.career||'job'); }
    if(!g.openYear()) break;
    g.deferEvent();
    /* 配點：把每顆沒被手癢用掉的骰子灌進策略指定的那一路 */
    const r=g.raw, put={};
    let free=0;
    for(let i=0;i<r.dice.length;i++){
      if(r.dieUsed[i]) continue;
      const row=P.alloc(g,free,r.dice[i]);
      if(row) put[row]=(put[row]||0)+r.dice[i];
      free++;
    }
    for(const k in put) g.addAlloc(k,put[k]);
    g.autoAllocate();
    if(g.raw.apLeft>0) g.skipRest();
    if(g.beginEvent()){ let gd=0; while(g.event()&&gd++<9) answerCard(g,P.ev||'safe'); }
    g.riskCheck();
    const w=g.midWindow();
    if(w){
      const want=P.mid?P.mid(w,g):'hold';
      const opt=w.options.find(o=>o.id===want)||w.options[0];
      if(opt) g.playMid(opt.id);
    }
    g.closeYear();
    if(P.walk && !g.over && g.canWalkaway()) g.walkaway();
  }
  return g.ending;
}

/* ================= 統計 ================= */
function pct(sorted,p){
  if(!sorted.length) return 0;
  const i=clamp(Math.round((sorted.length-1)*p),0,sorted.length-1);
  return sorted[i];
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function money(v){
  if(Math.abs(v)>=10000) return (v/10000).toFixed(2)+'億';
  return Math.round(v)+'萬';
}

const N=parseInt(process.argv[2]||'1200',10);
const seeds=[]; for(let i=0;i<N;i++) seeds.push('sim-'+i);

/* ---- 先驗一次行情本身的校準 ---- */
(function(){
  let arith=0, geo=0, crashes=0, n=0;
  seeds.forEach(s=>{
    const g=K.newGame(s).raw;
    let lg=0;
    g.market.forEach(m=>{ arith+=m.ret; lg+=Math.log(1+m.ret/100); n++; if(m.rg==='crash')crashes++; });
    geo+=Math.expm1(lg/g.market.length)*100;
  });
  console.log('大盤校準（'+N+' 顆種子 × 25 年）');
  console.log('  算術年均 '+(arith/n).toFixed(2)+'%　幾何年化 '+(geo/N).toFixed(2)+
              '%　每局崩盤 '+(crashes/N).toFixed(2)+' 次\n');
})();

const rows=[];
for(const name in POLICIES){
  const P=POLICIES[name];
  const navs=[], edges=[], lifes=[];
  let ruin=0, burn=0, blow=0, walk=0, tax=0, trades=0, beat=0, inflow=0;
  seeds.forEach(s=>{
    const e=run(s,P);
    navs.push(e.nav); edges.push(e.edge); lifes.push(e.life);
    if(e.id==='ruin'||e.id==='default') ruin++;
    if(e.id==='burnout') burn++;
    if(e.id==='walkaway') walk++;
    if(e.blowups>0) blow++;
    if(e.nav>e.bench) beat++;
    tax+=e.tax; trades+=e.trades; inflow+=e.inflow;
  });
  navs.sort((a,b)=>a-b); edges.sort((a,b)=>a-b); lifes.sort((a,b)=>a-b);
  rows.push({name:name, p10:pct(navs,0.10), p50:pct(navs,0.50), p90:pct(navs,0.90),
    edge:pct(edges,0.50), beat:beat/N*100, ruin:ruin/N*100, burn:burn/N*100,
    blow:blow/N*100, walk:walk/N*100, life:pct(lifes,0.50), inflow:inflow/N});
}

const pad=(s,n)=>{ let w=0; for(const c of String(s)) w+= c.charCodeAt(0)>0x2000?2:1; return String(s)+' '.repeat(Math.max(0,n-w)); };
console.log('投入本金中位數約 '+money(rows[0].inflow)+'（二十五年存下來的錢）');
console.log('對照組＝一模一樣的每一筆錢、同一時點全部買市值型 ETF 並把股利再投入\n');
console.log(pad('策略',24)+pad('p10',10)+pad('中位數',11)+pad('p90',11)+
            pad('贏對照組',11)+pad('勝率',8)+pad('歸零',7)+pad('垮掉',7)+pad('斷頭',7)+pad('收手',7)+'生活');
console.log('─'.repeat(112));
rows.forEach(r=>{
  console.log(pad(r.name,24)+pad(money(r.p10),10)+pad(money(r.p50),11)+pad(money(r.p90),11)+
    pad((r.edge>=0?'+':'')+r.edge.toFixed(1)+'%',11)+pad(r.beat.toFixed(0)+'%',8)+
    pad(r.ruin.toFixed(1)+'%',7)+pad(r.burn.toFixed(1)+'%',7)+
    pad(r.blow.toFixed(1)+'%',7)+pad(r.walk.toFixed(0)+'%',7)+Math.round(r.life));
});

/* ---- 判定 ----
   「達標就收手」提前離場，淨值天生比較低——它量的是收手值多少生活，
   不參與支配策略的比較。 */
console.log('');
const contest=rows.filter(r=>r.name!=='達標就收手');
const sorted=contest.slice().sort((a,b)=>b.p50-a.p50);
const best=sorted[0], second=sorted[1];
const ratio=best.p50/Math.max(second.p50,0.01);
console.log('最強：'+best.name+'　中位數是第二名（'+second.name+'）的 '+ratio.toFixed(2)+' 倍');
console.log(ratio>1.6 ? '  ✗ 支配策略：差距太大，其他選項等於沒得選'
          : ratio>1.35 ? '  △ 偏強，可以再壓'
          : '  ✓ 沒有支配策略');
const spread=best.p90/Math.max(best.p10,0.01);
console.log('最強策略的 p90/p10 ＝ '+spread.toFixed(1)+' 倍　'+
  (spread<3?'✗ 隨機性太窄，種子不影響命運':spread>60?'✗ 太寬，選擇被雜訊淹沒':'✓ 隨機性合理'));
