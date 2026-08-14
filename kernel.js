/* ================================================================
   少年股神 · 內核 v2（骨架）

   純邏輯、種子化、沒有任何 DOM。node 與瀏覽器都能載入。
   目的是先讓數字可驗證（見 kernel-sim.js），再決定要不要接進 index.html。

   四個名詞取代舊版的十二個：
     帳本 book      持股跨年延續，有成本價。改變它要花行動、繳稅、把未實現變成已實現
     行動點 ap      每年 3～6 點，花在牌桌上。骰子買的是「決定」，不是「數字」
     牌 move        買／賣／養習慣／生活／加班，全部同一個形狀
     修正器 hook    習慣、特質、流派、制度塌縮成同一個東西，settle 只做 fold

   鐵律沿用舊版：任何呈現層一律禁止呼叫 rng——多消耗一次亂數，整條人生就會錯位。
   ================================================================ */
(function(root, factory){
  if(typeof module==='object' && module.exports) module.exports=factory();
  else root.KERNEL=factory();
})(typeof self!=='undefined'?self:this, function(){
'use strict';

/* ================= 亂數 ================= */
function xmur3(str){
  let h=1779033703^str.length;
  for(let i=0;i<str.length;i++){ h=Math.imul(h^str.charCodeAt(i),3432918353); h=h<<13|h>>>19; }
  return function(){ h=Math.imul(h^h>>>16,2246822507); h=Math.imul(h^h>>>13,3266489909); return (h^=h>>>16)>>>0; };
}
function rngOf(seed){
  let a=xmur3(String(seed))();
  return function(){
    a|=0; a=a+0x6D2B79F5|0;
    let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/* ================= 修正器管線 =================
   舊版 settle() 把 15 種特例硬折疊在一行行 if 裡，加內容就得動核心。
   這裡全部走同一個介面：註冊一筆資料，核心永遠不用改。 */
const HOOKS={};
function on(hook,id,fn){ (HOOKS[hook]||(HOOKS[hook]=[])).push({id:id,fn:fn}); }
function fold(hook,v,ctx){
  const L=HOOKS[hook]; if(!L) return v;
  for(let i=0;i<L.length;i++) v=L[i].fn(v,ctx);
  return v;
}

/* ================= 靜態資料 ================= */
/* ---- 行情體制 ----
   實測（4000 顆種子 × 25 年）：算術年均 11.10%、幾何年化 7.61%、每局崩盤 2.25 次。
   幾何遠低於算術是刻意的——波動本身就在吃掉報酬，這是這款想講的第一件事。
   舊版的區間（crash 到 −58）跑出來只有幾何 5.34%，那是崩盤尾巴太長把複利吃掉了。 */
const REGIME={
  boom: {n:'狂牛', lo: 42, hi: 74},
  bull: {n:'牛市', lo: 12, hi: 38},
  chop: {n:'震盪', lo: -5, hi: 20},
  bear: {n:'熊市', lo:-26, hi: -7},
  crash:{n:'崩盤', lo:-48, hi:-28}
};
const TRANS={
  boom: [['boom',15],['bull',28],['chop',22],['bear',21],['crash',14]],
  bull: [['boom',18],['bull',34],['chop',28],['bear',15],['crash',5]],
  chop: [['boom',9], ['bull',33],['chop',34],['bear',20],['crash',4]],
  bear: [['boom',8], ['bull',25],['chop',37],['bear',23],['crash',7]],
  crash:[['boom',30],['bull',32],['chop',26],['bear',10],['crash',2]]
};

const THEMES=['航運','AI 伺服器','生技','軍工','重電','記憶體','觀光','綠能'];

/* ---- 標的 ----
   價格報酬 = beta*大盤 + alpha − 殖利率（除息當天股價直接扣掉股利），
   股利另外入現金。所以總報酬 = beta*大盤 + alpha，而帳面價格看得到除息的坑。
   liq = 崩盤年砍得掉的基礎機率。 */
const CORE=[
  {id:'bond', n:'債券 ETF',   beta:-0.12, aMu: 1.0, aSd: 4, div:3.5, liq:1.00},
  {id:'div',  n:'高股息 ETF', beta: 0.72, aMu: 0.4, aSd: 5, div:5.4, liq:1.00},
  {id:'wide', n:'市值型 ETF', beta: 1.00, aMu: 0.0, aSd: 2, div:2.8, liq:1.00},
  {id:'lead', n:'權值龍頭',   beta: 1.18, aMu: 1.6, aSd:13, div:1.8, liq:0.95},
  {id:'small',n:'冷門小型股', beta: 1.10, aMu:-1.0, aSd:22, div:1.2, liq:0.35}
];
const HOT_BOOST=18;    /* 今年的題材 */
const POP_PENALTY=18;  /* 去年的題材，泡沫破掉 */
function buildInst(){
  const out=CORE.slice();
  THEMES.forEach(function(t){
    out.push({id:'th_'+t, n:t+'概念股', beta:1.45, aMu:-8, aSd:34, div:0, liq:0.50, theme:t});
  });
  return out;
}
const INST=buildInst();
const BY_ID={}; INST.forEach(function(x){ BY_ID[x.id]=x; });

/* ---- 訊號牌 ----
   依當年真實體制加權抽出，但牌池重疊，所以每張只有部分相關性。
   玩家跨局學得會這張表——這是這版唯一的長期成長，而且不需要解鎖系統。 */
const SIGNALS=[
  {id:'margin_peak', t:'融資餘額創近年新高',         w:{boom:4,bull:2,chop:1,bear:1,crash:4}},
  {id:'open_acct',   t:'開戶數暴增，券商系統一早塞爆', w:{boom:5,bull:2,chop:1,bear:0,crash:1}},
  {id:'taxi',        t:'小黃司機報你三支明牌',        w:{boom:5,bull:2,chop:1,bear:0,crash:2}},
  {id:'cover',       t:'「這次不一樣」上了雜誌封面',   w:{boom:4,bull:2,chop:1,bear:0,crash:3}},
  {id:'fgn_buy',     t:'外資連續買超，投信同步加碼',   w:{boom:3,bull:4,chop:2,bear:1,crash:0}},
  {id:'target_up',   t:'分析師紛紛調高目標價',        w:{boom:3,bull:4,chop:2,bear:1,crash:1}},
  {id:'statement',   t:'你的對帳單第一次變得很好看',   w:{boom:3,bull:4,chop:1,bear:0,crash:0}},
  {id:'vol_dry',     t:'成交量萎縮到近年低點',        w:{boom:0,bull:1,chop:4,bear:3,crash:1}},
  {id:'range',       t:'指數在同一個區間來回三個月',   w:{boom:0,bull:1,chop:5,bear:2,crash:0}},
  {id:'mixed',       t:'法人多空互見，方向不明',      w:{boom:1,bull:2,chop:4,bear:2,crash:1}},
  {id:'fgn_sell',    t:'外資連八賣，融券餘額墊高',     w:{boom:0,bull:1,chop:2,bear:4,crash:3}},
  {id:'quiet_room',  t:'你認識的人開始不談股票了',     w:{boom:0,bull:0,chop:2,bear:5,crash:3}},
  {id:'margin_call', t:'融資追繳簡訊開始發',          w:{boom:0,bull:0,chop:1,bear:3,crash:5}},
  {id:'limit_down',  t:'有一天開盤跌停鎖死',          w:{boom:0,bull:0,chop:0,bear:2,crash:6}},
  {id:'blame',       t:'財經版頭條換成「誰該負責」',   w:{boom:0,bull:0,chop:0,bear:1,crash:5}}
];
const THEME_SIG_ACC=55;   /* 題材訊號的準確率。刻意壓低——追題材不該是穩賺的 */
/* 抽牌時給每個體制一個地板。權重 0 代表「這張牌在崩盤年絕不出現」，
   那麼只要它出現就等於直接排除崩盤——貝氏更新吃到 0 是決定性的。
   實測沒有地板時，會讀表的玩家勝率 98%、贏對照組 120%，等於支配策略。 */
const SIG_FLOOR=1.6;
function sigW(s,rg){ return Math.max(s.w[rg], SIG_FLOOR); }

/* ---- 習慣 ----
   三階：嘗試(1年) → 習慣(3年) → 固化(6年，不再需要餵，也不再衰退)。
   槽位仍然有限，固化也佔位子。斷掉要從頭來。 */
const HABITS={
  read:  {n:'每季讀財報',     fx:'年初多翻一張訊號牌'},
  log:   {n:'寫交易日誌',     fx:'心態波動減三成'},
  stop:  {n:'停損寫在紙上',   fx:'崩盤年砍得掉的機率 +20'},
  close: {n:'只在收盤後下單', fx:'手癢時不會替你亂下單'},
  dca:   {n:'每月定額',       fx:'薪水的六成自動買市值型 ETF'},
  gym:   {n:'固定運動',       fx:'生活 +5／年'},
  family:{n:'每年跟家人對帳', fx:'生活 +6／年，心態被拉回中間'},
  cash:  {n:'永遠留三成現金', fx:'可投入資金上限七成，幾乎不可能斷頭'}
};
const HK=Object.keys(HABITS);
const STAGE=[0,0.4,0.75,1.0];
function hb(g,id){ const h=g.habits[id]; return h?STAGE[h.stage]:0; }
function slotsAt(age){ return age>=32?4 : age>=26?3 : 2; }

/* ---- 習慣全部走 hook 註冊。加一個習慣＝加一筆資料 + 一行 on()，核心不動 ---- */
on('signals','read',    function(n,c){ return n + (hb(c.g,'read')>=0.4?1:0); });
on('tiltdelta','log',   function(v,c){ return v*(1-0.3*hb(c.g,'log')); });
on('escape','stop',     function(v,c){ return v + 20*hb(c.g,'stop'); });
on('itch','close',      function(v,c){ return hb(c.g,'close')>=0.4 ? 0 : v; });
on('life','gym',        function(v,c){ return v + 5*hb(c.g,'gym'); });
on('life','family',     function(v,c){ return v + 6*hb(c.g,'family'); });
on('investable','cash', function(v,c){ return v*(1-0.30*hb(c.g,'cash')); });

/* ---- 交易成本：台股是賣出課稅 ---- */
const TAX_SELL=0.003, FEE=0.000855, NHI=0.0211;
const MIN_TRADE=0.5;   /* 低於這個金額不成交（萬元）——碎屑不該產生選項 */
const MAINT=1.30, DEBT_RATE=0.075;

/* ================= 建局 ================= */
function genMarket(R,years){
  let cur='chop'; const out=[];
  for(let y=0;y<years;y++){
    const tbl=TRANS[cur];
    let roll=R()*100, acc=0, nx='chop';
    for(let i=0;i<tbl.length;i++){ acc+=tbl[i][1]; if(roll<acc){ nx=tbl[i][0]; break; } }
    cur=nx;
    const rg=REGIME[cur];
    out.push({rg:cur, ret:rg.lo+R()*(rg.hi-rg.lo)});
  }
  /* 二十五年至少兩次崩盤——沒撞過牆的人生講不出這款想講的事 */
  let guard=0;
  while(out.filter(function(y){return y.rg==='crash';}).length<2 && guard++<40){
    const i=3+Math.floor(R()*(years-5));
    out[i]={rg:'crash', ret:REGIME.crash.lo+R()*(REGIME.crash.hi-REGIME.crash.lo)};
  }
  return out;
}

const TOTAL=25;   /* 16 → 40 歲 */

function newGame(seed,opts){
  opts=opts||{};
  const R=rngOf(seed);
  const ri=function(a,b){ return a+Math.floor(R()*(b-a+1)); };
  const N0=function(sd){ return ((R()+R()+R()+R())-2)*1.732*sd; };
  const pick=function(a){ return a[Math.floor(R()*a.length)]; };

  const market=genMarket(R,TOTAL);
  const hots=[]; for(let y=0;y<TOTAL;y++) hots.push(THEMES[Math.floor(R()*THEMES.length)]);

  const price={}; INST.forEach(function(x){ price[x.id]=100; });

  const g={
    seed:String(seed), R:R, ri:ri, N0:N0, pick:pick,
    market:market, hots:hots, price:price,
    year:0, age:16, phase:'idle',
    cash:0, debt:0, book:{},          /* book[id] = {sh, cost} */
    tilt:55, life:70, habits:{}, career:'none',
    ap:0, apLeft:0, signals:[], hotGuess:null, yr:null, mid:null, scouted:{},
    blowups:0, taxPaid:0, divTotal:0, realized:0, trades:0,
    inflow:0, benchSh:0,
    hist:[], log:[], over:false, ending:null, notes:[]
  };
  return wrap(g);
}

/* ================= 估值 ================= */
function assets(g){
  let v=g.cash;
  for(const id in g.book) v+=g.book[id].sh*g.price[id];
  return v;
}
function nav(g){ return assets(g)-g.debt; }
function investable(g){ return Math.max(0, fold('investable', g.cash, {g:g})); }

/* ================= 交易 ================= */
function buy(g,id,amount){
  amount=Math.min(amount, g.cash);
  if(!(amount>MIN_TRADE)) return null;
  const p=g.price[id];
  const fee=amount*FEE;
  const net=amount-fee;
  const sh=net/p;
  const b=g.book[id]||(g.book[id]={sh:0,cost:0});
  b.cost=(b.cost*b.sh+net)/(b.sh+sh);
  b.sh+=sh;
  g.cash-=amount; g.taxPaid+=fee; g.trades++;
  return {id:id, amount:amount, sh:sh, price:p};
}
function sell(g,id,frac,priceOverride){
  const b=g.book[id]; if(!b||b.sh<=0) return null;
  const p=priceOverride==null?g.price[id]:priceOverride;
  const sh=b.sh*clamp(frac,0,1);
  const gross=sh*p;
  if(!(gross>MIN_TRADE)) return null;
  const tax=gross*TAX_SELL, fee=gross*FEE;
  const proceeds=gross-tax-fee;
  const basis=sh*b.cost;
  g.cash+=proceeds; g.taxPaid+=tax+fee; g.trades++;
  g.realized+=proceeds-basis;
  b.sh-=sh; if(b.sh<=1e-9) delete g.book[id];
  /* 實現損益直接打在心態上——這是散戶真正的情緒來源，不是帳面數字 */
  const pl=(proceeds-basis)/Math.max(basis,0.01)*100;
  addTilt(g, clamp(pl*0.25, -14, 10));
  return {id:id, sh:sh, proceeds:proceeds, pl:proceeds-basis};
}
function addTilt(g,d){ g.tilt=clamp(g.tilt+fold('tiltdelta',d,{g:g}),0,100); }

/* ---- 進帳，同時餵給對照組 ----
   對照組＝一模一樣的每一筆錢、在一模一樣的時點、全部買市值型 ETF 並把股利再投入。
   所以最後的差距完全來自選擇，不是本金。這是唯一誠實的「你到底有沒有比較會」。 */
function income(g,amt){
  if(!(amt>0)) return;
  g.cash+=amt; g.inflow+=amt;
  g.benchSh+=amt/g.price.wide;
}
function benchNav(g){ return g.benchSh*g.price.wide; }

/* ================= 年循環 ================= */
/* 1. 開年：收入、題材、訊號、行動點、手癢 */
function openYear(g){
  if(g.over) return null;
  g.age=16+g.year;
  const m=g.market[g.year];
  g.notes=[];

  /* 收入 ----
     這裡進來的是「一年存得下來的錢」，不是薪水。
     用薪水當本金會讓存錢本身贏過投資——實測過：空手不投資也能到三千萬，
     那整款遊戲的核心決策就沒有意義了。 */
  let inc;
  if(g.age<19) inc=g.ri(1,3);
  else if(g.age<22) inc=g.ri(4,9);
  else if(g.career==='pro') inc=0;
  else inc=Math.round(g.ri(13,26)*(1+0.03*(g.age-22)));
  income(g,inc); g.income=inc;

  /* 每月定額：薪水的六成自動進場，不受心態影響 */
  const dca=hb(g,'dca');
  if(dca>0 && inc>0){ const amt=inc*0.6*dca; buy(g,'wide',amt); g.notes.push('定額扣款 '+amt.toFixed(1)+' 萬自動進場'); }

  /* 今年的題材，以及每一檔的報酬（先抽好，年中窗口才有真實的半路價格） */
  const hot=g.hots[g.year], prevHot=g.year>0?g.hots[g.year-1]:null;
  g.yr={};
  INST.forEach(function(x){
    let mu=x.aMu;
    if(x.theme===hot) mu+=HOT_BOOST;
    else if(x.theme && x.theme===prevHot) mu-=POP_PENALTY;
    const r=x.beta*m.ret + mu + g.N0(x.aSd) - x.div;
    g.yr[x.id]=Math.max(r,-92);
  });

  /* 訊號：依真實體制加權抽，牌池重疊所以有雜訊 */
  const n=fold('signals',2,{g:g});
  const pool=SIGNALS.slice(); const out=[];
  for(let i=0;i<n && pool.length;i++){
    let tot=0; pool.forEach(function(s){ tot+=sigW(s,m.rg); });
    if(tot<=0) break;
    let roll=g.R()*tot, acc=0, k=0;
    for(k=0;k<pool.length;k++){ acc+=sigW(pool[k],m.rg); if(roll<acc) break; }
    k=Math.min(k,pool.length-1);
    out.push({id:pool[k].id, t:pool[k].t}); pool.splice(k,1);
  }
  /* 題材訊號：55% 指對，其餘指向一個冷門題材 */
  g.hotGuess = g.R()*100<THEME_SIG_ACC ? hot : g.pick(THEMES.filter(function(t){return t!==hot;}));
  out.push({id:'theme', t:'市場現在都在講「'+g.hotGuess+'」', theme:g.hotGuess});
  g.signals=out;

  /* 行動點 */
  const r=g.R();
  let ap = r<0.34?3 : r<0.74?4 : r<0.94?5 : 6;
  if(g.age<=21) ap+=1;
  if(g.age>=34) ap-=1;
  if(g.career==='pro') ap+=1;
  if(g.tilt<35 || g.tilt>85) ap-=1;
  g.ap=g.apLeft=Math.max(2,ap);

  /* 手癢：心態太高，年初就有一點被你自己花掉了 */
  if(g.tilt>=80 && fold('itch',1,{g:g})){
    const th=BY_ID['th_'+g.hotGuess];
    const amt=investable(g)*0.3;
    if(amt>MIN_TRADE && th){ buy(g,th.id,amt); g.apLeft--; g.notes.push('你手癢，年初就先追了 '+g.hotGuess+'——這一點不是你決定的'); }
  }
  g.scouted={};
  g.phase='act';
  return {age:g.age, income:inc, signals:g.signals, ap:g.ap, nav:nav(g)};
}

/* 2. 出牌 */
function moves(g){
  if(g.phase!=='act'||g.apLeft<=0) return [];
  const out=[];
  const inv=investable(g);
  const scared=g.tilt<=20;
  if(!scared && inv>MIN_TRADE){
    INST.forEach(function(x){
      out.push({id:'buy:'+x.id, kind:'buy', inst:x.id, label:'買 '+x.n, fracs:[0.3,0.6,1.0]});
    });
  }
  /* 只列賣得掉的。零股級的碎屑列出來會變成「按了沒反應」的按鈕，
     任何「一直賣到沒得賣」的迴圈都會卡死在那裡。 */
  for(const id in g.book){
    if(g.book[id].sh*g.price[id]<=MIN_TRADE) continue;
    out.push({id:'sell:'+id, kind:'sell', inst:id, label:'賣 '+BY_ID[id].n, fracs:[0.5,1.0]});
  }

  /* 融資：三十三歲還在散戶這一層就永久關閉——不是規則禁止你，是你輸不起了 */
  const shut=(g.age>=33 && nav(g)<600) || g.blowups>=2;
  if(!scared && !shut && nav(g)>=20 && g.debt<=0){
    INST.forEach(function(x){
      if(x.theme||x.id==='lead') out.push({id:'margin:'+x.id, kind:'margin', inst:x.id, label:'融資買 '+x.n});
    });
  }
  const act=Object.keys(g.habits);
  HK.forEach(function(k){
    const h=g.habits[k];
    if(h && h.stage>=3) return;                                  /* 固化了，不用再餵 */
    if(!h && act.length>=slotsAt(g.age)) return;                 /* 槽位滿了 */
    out.push({id:'habit:'+k, kind:'habit', label:(h?'維持':'開始')+'「'+HABITS[k].n+'」'});
  });
  /* 研究個股：花一點時間，換一個「它今年會不會贏大盤」的判斷。
     這一張永遠有用——沒有它，習慣固化之後的行動點就只剩下加班可花，
     那正是舊版「build 蓋完就沒事做」的老毛病換了個位置重演。 */
  INST.forEach(function(x){
    if(g.scouted[x.id]==null) out.push({id:'scout:'+x.id, kind:'scout', inst:x.id, label:'研究 '+x.n});
  });
  out.push({id:'life', kind:'life', label:'陪家人、把生活過回來'});
  out.push({id:'work', kind:'work', label:'加班接案'});
  return out;
}

function play(g,moveId,arg){
  if(g.phase!=='act'||g.apLeft<=0) return null;
  arg=arg||{};
  const cut=moveId.indexOf(':');
  const kind=cut<0?moveId:moveId.slice(0,cut);
  const target=cut<0?null:moveId.slice(cut+1);
  let res=null;
  if(kind==='buy'){
    res=buy(g,target,investable(g)*(arg.frac==null?1:arg.frac));
    if(!res) return null;
  } else if(kind==='sell'){
    res=sell(g,target,arg.frac==null?1:arg.frac);
    if(!res) return null;
  } else if(kind==='margin'){
    const borrow=nav(g)*0.6;
    if(!(borrow>1)) return null;
    g.debt+=borrow; g.cash+=borrow;
    res=buy(g,target,borrow);
    if(!res){ g.debt-=borrow; g.cash-=borrow; return null; }
    res.borrowed=borrow;
  } else if(kind==='habit'){
    const h=g.habits[target]||(g.habits[target]={streak:0,stage:0});
    h.streak++; h.fed=g.year;
    h.stage = h.streak>=6?3 : h.streak>=3?2 : 1;
    res={habit:target, stage:h.stage};
  } else if(kind==='life'){
    g.life=clamp(g.life+9,0,100);
    g.tilt=clamp(g.tilt+(g.tilt<55?8:-8),0,100);
    res={life:g.life};
  } else if(kind==='scout'){
    /* 只講超額報酬，不洩漏大盤方向——跟訊號牌互補，不重疊 */
    const beats=g.yr[target] - BY_ID[target].beta*g.market[g.year].ret > 0;
    const acc=62+18*hb(g,'read');
    const say=g.R()*100<acc ? beats : !beats;
    g.scouted[target]=say;
    res={inst:target, beatsMarket:say, acc:Math.round(acc)};
  } else if(kind==='work'){
    /* 拿時間直接換錢。給得少、扣得重——不然它會變成沒有風險的最優解 */
    const amt=2+g.year*0.25;
    income(g,amt); g.life=clamp(g.life-7,0,100);
    res={earned:amt};
  } else return null;
  g.apLeft--;
  return res;
}

/* 3. 年中窗口：崩盤與狂牛各插播一次免費行動。
   恐懼與貪婪各測一次——而且這是唯一一個「你知道走到一半了」的決策點。 */
function midWindow(g){
  if(g.phase!=='act') return null;
  const m=g.market[g.year];
  const held=Object.keys(g.book);
  if(!held.length) return null;
  if(m.rg==='crash'){
    return {kind:'crash', sofar:Math.round(m.ret*0.62),
      options:[{id:'cut',label:'全部砍掉'},{id:'hold',label:'抱著，不看'},{id:'add',label:'加碼攤平'}]};
  }
  if(m.rg==='boom'){
    return {kind:'boom', sofar:Math.round(m.ret*0.62),
      options:[{id:'take',label:'獲利了結一半'},{id:'hold',label:'續抱'},{id:'add',label:'再加碼'}]};
  }
  return null;
}
function playMid(g,choice){
  const w=midWindow(g); if(!w) return null;
  const midP={};
  INST.forEach(function(x){ midP[x.id]=g.price[x.id]*(1+g.yr[x.id]*0.62/100); });
  const held=Object.keys(g.book);
  const out={choice:choice, sold:[], failed:[]};

  if(w.kind==='crash'&&choice==='cut'){
    /* 跌停鎖死：委賣單掛在那裡一整天，一張都沒成交 */
    held.forEach(function(id){
      const esc=clamp(fold('escape',30+BY_ID[id].liq*45,{g:g}),15,92);
      if(g.R()*100<esc){ sell(g,id,1,midP[id]); out.sold.push(id); }
      else out.failed.push(id);
    });
    g.mid='cut';
  } else if(choice==='add'){
    const amt=investable(g)*(w.kind==='crash'?0.5:0.3);
    const id=w.kind==='crash' ? (held[0]) : ('th_'+g.hotGuess);
    if(amt>MIN_TRADE && BY_ID[id]) { buy(g,id,amt); }
    /* 手動改成半路價：加碼發生在年中 */
    const b=g.book[id];
    if(b){ b.cost=b.cost*(midP[id]/g.price[id]); }
    g.mid='add'; addTilt(g,w.kind==='crash'?-4:6);
  } else if(w.kind==='boom'&&choice==='take'){
    held.forEach(function(id){ sell(g,id,0.5,midP[id]); out.sold.push(id); });
    g.mid='take';
  } else g.mid='hold';
  return out;
}

/* 4. 結算 */
function closeYear(g){
  if(g.over) return null;
  const m=g.market[g.year];
  const before=nav(g);

  /* 股利：以年初價為基礎；除息的坑已經在價格報酬裡扣掉了 */
  let divCash=0;
  for(const id in g.book){
    const x=BY_ID[id];
    if(!x.div) continue;
    divCash+=g.book[id].sh*g.price[id]*x.div/100;
  }
  if(divCash>2) divCash-=divCash*NHI;    /* 二代健保補充保費 */
  g.cash+=divCash; g.divTotal+=divCash;
  /* 對照組的股利也一樣要等到下一次才買得回去——不然對照組等於偷跑一年，
     光是這個時間差就讓「買市值型抱到底」對上自己的對照組輸 5.4%。 */
  const benchDiv=g.benchSh*g.price.wide*BY_ID.wide.div/100;

  /* 價格走完全年 */
  INST.forEach(function(x){ g.price[x.id]=Math.max(0.5, g.price[x.id]*(1+g.yr[x.id]/100)); });
  g.benchSh+=benchDiv/g.price.wide;

  /* 融資利息與斷頭 */
  let blew=false;
  if(g.debt>0){
    g.debt*=(1+DEBT_RATE);
    const a=assets(g);
    if(a/g.debt<MAINT){
      for(const id in g.book) delete g.book[id];
      g.cash=Math.max(0, a*0.92-g.debt); g.debt=0;
      g.blowups++; blew=true; addTilt(g,-30);
    }
  }
  g.cash*=1.015;   /* 現金部位的定存利息 */

  const after=nav(g);
  const rp=before>0?(after/before-1)*100:0;

  /* 心態 ----
     用絕對報酬餵心態會變成一個只升不降的棘輪：多頭年年 +20%，心態很快就頂在 80,
     實測 51.7% 的年份都在手癢。心態的來源本來就是「比較」——
     大盤漲 35% 你漲 30%，那不是得意，那是焦慮。 */
  addTilt(g, clamp((rp-m.ret)*0.6,-22,22));
  if(m.rg==='crash') addTilt(g,-10);
  if(m.rg==='boom')  addTilt(g,10);
  g.tilt+=(55-g.tilt)*0.18;              /* 人會慢慢回到自己的基準線 */
  if(hb(g,'family')>0) g.tilt+=(55-g.tilt)*0.25*hb(g,'family');
  g.tilt=clamp(g.tilt,0,100);

  /* 生活 */
  let dl=fold('life',0,{g:g});
  dl += g.career==='pro' ? -6 : (g.age>=22 ? -2 : 1);
  g.life=clamp(g.life+dl,0,100);

  /* 習慣：沒餵就退，退到 0 斷掉；固化的不退 */
  HK.forEach(function(k){
    const h=g.habits[k]; if(!h) return;
    if(h.stage>=3) return;
    if(h.fed===g.year) return;
    h.streak--;
    if(h.streak<=0) delete g.habits[k];
    else h.stage = h.streak>=3?2:1;
  });

  const row={year:g.year, age:g.age, rg:m.rg, mkt:m.ret, nav:after, ret:rp,
             tilt:g.tilt, life:g.life, blew:blew, div:divCash};
  g.log.push(row); g.hist.push(after);
  g.mid=null; g.year++; g.phase='idle';

  if(after<=0.5) finish(g,'ruin');
  else if(g.life<=12) finish(g,'burnout');
  else if(g.year>=TOTAL) finish(g,'done');
  return row;
}

/* ---- 22 歲的分岔：唯一一個職業決定 ---- */
function careerChoice(g,which){ g.career=which==='pro'?'pro':'job'; }

/* ================= 結局 ================= */
const ENDINGS=[
  {id:'burnout', c:function(x){return x.reason==='burnout';}, t:'人先垮了'},
  {id:'ruin',    c:function(x){return x.reason==='ruin';},    t:'歸零'},
  {id:'phoenix', c:function(x){return x.blowups>=1&&x.nav>=3000;}, t:'斷過頭，又爬回來'},
  {id:'whale',   c:function(x){return x.nav>=15000;},         t:'隱形富豪'},
  {id:'big',     c:function(x){return x.nav>=3000&&x.life>=55;}, t:'大戶，而且沒把自己弄丟'},
  {id:'rich',    c:function(x){return x.nav>=3000;},          t:'大戶'},
  {id:'mid',     c:function(x){return x.nav>=600;},           t:'中實戶'},
  {id:'steady',  c:function(x){return x.cagr>=6&&x.life>=60;},t:'沒有故事，但是穩'},
  {id:'flat',    c:function(x){return x.cagr>=0;},            t:'二十四年，剛好打平'},
  {id:'leek',    c:function(){return true;},                  t:'韭菜'}
];
function finish(g,reason){
  if(g.over) return;
  g.over=true; g.phase='over';
  const n=nav(g), yrs=Math.max(g.log.length,1);
  const first=g.hist.length?Math.max(g.hist[0],1):1;
  const cagr=(Math.pow(Math.max(n,0.01)/first,1/yrs)-1)*100;
  const x={reason:reason, nav:n, life:g.life, tilt:g.tilt, cagr:cagr, blowups:g.blowups};
  const e=ENDINGS.find(function(E){return E.c(x);});
  const bench=benchNav(g);
  g.ending={id:e.id, t:e.t, nav:n, cagr:cagr, life:g.life, tilt:g.tilt,
            blowups:g.blowups, tax:g.taxPaid, div:g.divTotal, trades:g.trades, years:yrs,
            inflow:g.inflow, bench:bench, edge:(n/Math.max(bench,0.01)-1)*100};
}

/* ================= 對外介面 ================= */
function wrap(g){
  return {
    raw:g,
    get over(){ return g.over; },
    get phase(){ return g.phase; },
    get ending(){ return g.ending; },
    nav:function(){ return nav(g); },
    assets:function(){ return assets(g); },
    investable:function(){ return investable(g); },
    openYear:function(){ return openYear(g); },
    moves:function(){ return moves(g); },
    play:function(id,arg){ return play(g,id,arg); },
    midWindow:function(){ return midWindow(g); },
    playMid:function(c){ return playMid(g,c); },
    closeYear:function(){ return closeYear(g); },
    career:function(w){ return careerChoice(g,w); }
  };
}

return {newGame:newGame, SIG_FLOOR:SIG_FLOOR, INST:INST, BY_ID:BY_ID, HABITS:HABITS, SIGNALS:SIGNALS,
        THEMES:THEMES, REGIME:REGIME, ENDINGS:ENDINGS, TOTAL:TOTAL,
        on:on, fold:fold, hb:hb, slotsAt:slotsAt, nav:nav};
});
