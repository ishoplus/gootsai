/* ================================================================
   內核 v2 · 平衡模擬器

   跑 N 局 × 數種策略，回答三個問題：
     1. 有沒有支配策略？（任何一種打爆其他所有種，遊戲就不用玩了）
     2. 隨機性夠不夠寬？（同一種策略的 p10 與 p90 差多少）
     3. 破產與人垮掉的比例合不合理？

   策略一律不呼叫內核的亂數，只讀狀態——否則會偷走種子流，結果不可比。

   node kernel-sim.js [局數]
   ================================================================ */
'use strict';
const K=require('./kernel.js');

/* ---- 讀訊號的正確方式：貝氏後驗 ----
   訊號牌的權重表就是似然。玩家跨局學得會的東西，這裡直接算出來當上限對照組。 */
const RGS=['boom','bull','chop','bear','crash'];
const PRIOR={boom:0.13,bull:0.27,chop:0.30,bear:0.20,crash:0.10};
const MID={}; RGS.forEach(r=>{ const x=K.REGIME[r]; MID[r]=(x.lo+x.hi)/2; });
const SIGW={}; K.SIGNALS.forEach(s=>{ SIGW[s.id]=s.w; });

function expectMkt(signals){
  const post={}; let tot=0;
  RGS.forEach(r=>{
    let p=PRIOR[r];
    signals.forEach(s=>{ const w=SIGW[s.id]; if(w) p*=Math.max(w[r],K.SIG_FLOOR); });
    post[r]=p; tot+=p;
  });
  let e=0; RGS.forEach(r=>{ e+=(post[r]/tot)*MID[r]; });
  return e;
}

/* ---- 事件卡 ----
   策略不能自己擲骰（會偷走種子流），所以選項是用固定規則挑的：
   safe 永遠挑第一個（那幾乎都是不賭的那個），bold 永遠挑最後一個（那幾乎都是賭最大的）。
   這剛好量到兩端：「事件卡從不冒險」與「事件卡每次都梭」各自的下場。 */
function answerCard(g,mode){
  const e=g.event();
  if(!e || !e.opts.length) return;
  const i = mode==='bold' ? e.opts[e.opts.length-1].i
          : mode==='mid'  ? e.opts[Math.floor((e.opts.length-1)/2)].i
          : e.opts[0].i;
  g.answerEvent(i);
}

/* ---- 把剩下的行動點花掉：先養習慣、生活撐不住就顧生活，再不然加班 ---- */
function spendRest(g,plan){
  let guard=0;
  while(g.raw.apLeft>0 && guard++<12){
    const mv=g.moves();
    let done=false;
    for(const k of plan){
      const m=mv.find(x=>x.id==='habit:'+k);
      const h=g.raw.habits[k];
      if(m && !(h&&h.fed===g.raw.year)){ g.play(m.id); done=true; break; }
    }
    if(done) continue;
    if(g.raw.life<60 && mv.some(x=>x.id==='life')){ g.play('life'); continue; }
    const sc=mv.find(x=>x.kind==='scout');
    if(sc){ g.play(sc.id); continue; }
    if(mv.some(x=>x.id==='work')){ g.play('work'); continue; }
    break;
  }
}
function sellAll(g){
  let guard=0;
  while(guard++<14){
    const m=g.moves().find(x=>x.kind==='sell');
    if(!m||g.raw.apLeft<=0) break;
    g.play(m.id,{frac:1.0});
  }
}
function buyAll(g,id){
  const m=g.moves().find(x=>x.id==='buy:'+id);
  if(m) g.play(m.id,{frac:1.0});
}

/* ================= 策略 ================= */
const POLICIES={
  '空手':{plan:['gym','family','read'],career:'job',ev:'safe',
    act(){}, mid(){ return 'hold'; }},

  '市值型 ETF 抱到底':{plan:['dca','read','gym','family'],career:'job',ev:'safe',
    act(g){ buyAll(g,'wide'); }, mid(){ return 'hold'; }},

  '高股息存股':{plan:['dca','gym','family','cash'],career:'job',ev:'safe',
    act(g){ buyAll(g,'div'); }, mid(){ return 'hold'; }},

  '每年追當紅題材':{plan:['read','gym','family'],career:'job',ev:'bold',
    act(g){
      const want='th_'+g.raw.hotGuess;
      const held=Object.keys(g.raw.book);
      if(held.length===1 && held[0]===want){ buyAll(g,want); return; }
      sellAll(g); buyAll(g,want);
    },
    mid(w){ return w.kind==='crash'?'cut':'take'; }},

  '融資追題材':{plan:['read','gym'],career:'job',ev:'bold',
    act(g){
      const want='th_'+g.raw.hotGuess;
      const held=Object.keys(g.raw.book);
      if(!(held.length===1&&held[0]===want)) { sellAll(g); }
      const m=g.moves().find(x=>x.id==='margin:'+want);
      if(m) g.play(m.id); else buyAll(g,want);
    },
    mid(w){ return w.kind==='crash'?'cut':'hold'; }},

  '讀訊號配置':{plan:['read','stop','gym','family','log'],career:'job',ev:'mid',
    act(g){
      const e=expectMkt(g.raw.signals);
      const want = e>=22 ? 'lead' : e>=8 ? 'wide' : e>=0 ? 'div' : 'bond';
      const held=Object.keys(g.raw.book);
      if(held.length===1 && held[0]===want){ buyAll(g,want); return; }
      sellAll(g); buyAll(g,want);
    },
    mid(w){ return w.kind==='crash'?'cut':'take'; }},

  '讀訊號＋看對才追題材':{plan:['read','stop','gym','family','log'],career:'job',ev:'mid',
    act(g){
      const e=expectMkt(g.raw.signals);
      const want = e>=25 ? 'th_'+g.raw.hotGuess : e>=8 ? 'wide' : e>=0 ? 'div' : 'bond';
      const held=Object.keys(g.raw.book);
      if(held.length===1 && held[0]===want){ buyAll(g,want); return; }
      sellAll(g); buyAll(g,want);
    },
    mid(w){ return w.kind==='crash'?'cut':'take'; }}
};

/* ================= 跑一局 ================= */
function run(seed,P){
  const g=K.newGame(seed);
  let guard=0;
  while(!g.over && guard++<40){
    if(16+g.raw.year===22) g.career(P.career);
    g.openYear();
    answerCard(g,P.ev);
    P.act(g);
    spendRest(g,P.plan);
    P.act(g);            /* 掃一次剩下的現金——加班賺到的錢不該在帳上躺一整年 */
    const w=g.midWindow();
    if(w) g.playMid(P.mid(w,g));
    g.closeYear();
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
  const navs=[], edges=[];
  let ruin=0, burn=0, blow=0, tax=0, trades=0, beat=0, inflow=0;
  seeds.forEach(s=>{
    const e=run(s,P);
    navs.push(e.nav); edges.push(e.edge);
    if(e.id==='ruin') ruin++;
    if(e.id==='burnout') burn++;
    if(e.blowups>0) blow++;
    if(e.nav>e.bench) beat++;
    tax+=e.tax; trades+=e.trades; inflow+=e.inflow;
  });
  navs.sort((a,b)=>a-b); edges.sort((a,b)=>a-b);
  rows.push({name:name, p10:pct(navs,0.10), p50:pct(navs,0.50), p90:pct(navs,0.90),
    edge:pct(edges,0.50), beat:beat/N*100, ruin:ruin/N*100, burn:burn/N*100,
    blow:blow/N*100, tax:tax/N, trades:trades/N, inflow:inflow/N});
}

const pad=(s,n)=>{ let w=0; for(const c of String(s)) w+= c.charCodeAt(0)>0x2000?2:1; return String(s)+' '.repeat(Math.max(0,n-w)); };
console.log('投入本金中位數約 '+money(rows[0].inflow)+'（二十五年存下來的錢）');
console.log('對照組＝一模一樣的每一筆錢、同一時點全部買市值型 ETF 並把股利再投入\n');
console.log(pad('策略',26)+pad('p10',10)+pad('中位數',11)+pad('p90',11)+
            pad('贏對照組',11)+pad('勝率',8)+pad('歸零',7)+pad('垮掉',7)+pad('斷頭',7)+pad('稅費',9)+'交易');
console.log('─'.repeat(118));
rows.forEach(r=>{
  console.log(pad(r.name,26)+pad(money(r.p10),10)+pad(money(r.p50),11)+pad(money(r.p90),11)+
    pad((r.edge>=0?'+':'')+r.edge.toFixed(1)+'%',11)+pad(r.beat.toFixed(0)+'%',8)+
    pad(r.ruin.toFixed(1)+'%',7)+pad(r.burn.toFixed(1)+'%',7)+
    pad(r.blow.toFixed(1)+'%',7)+pad(money(r.tax),9)+r.trades.toFixed(0));
});

/* ---- 判定 ---- */
console.log('');
const sorted=rows.slice().sort((a,b)=>b.p50-a.p50);
const best=sorted[0], second=sorted[1];
const ratio=best.p50/Math.max(second.p50,0.01);
console.log('最強：'+best.name+'　中位數是第二名（'+second.name+'）的 '+ratio.toFixed(2)+' 倍');
console.log(ratio>1.6 ? '  ✗ 支配策略：差距太大，其他選項等於沒得選'
          : ratio>1.35 ? '  △ 偏強，可以再壓'
          : '  ✓ 沒有支配策略');
const spread=best.p90/Math.max(best.p10,0.01);
console.log('最強策略的 p90/p10 ＝ '+spread.toFixed(1)+' 倍　'+
  (spread<3?'✗ 隨機性太窄，種子不影響命運':spread>60?'✗ 太寬，選擇被雜訊淹沒':'✓ 隨機性合理'));
