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
const html=fs.readFileSync(path.join(__dirname,'play.html'),'utf8');
const inline=[];
const RE=/<script(\b[^>]*)>([\s\S]*?)<\/script>/g;
let mm;
while((mm=RE.exec(html))) if(mm[1].indexOf('src=')<0 && mm[2].trim().length>40) inline.push(mm[2]);
ok('play.html 裡有一段 inline 腳本', inline.length===1);

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
  document:{body:{appendChild(){},style:{}},getElementById:el,createElement:el,
    querySelector:()=>el(),querySelectorAll:()=>[]}};
sandbox.window=sandbox; sandbox.globalThis=sandbox;
vm.createContext(sandbox);
try{ vm.runInContext(inline[0],sandbox,{filename:'play.html'}); console.log('  ✓ 腳本載入不拋錯'); }
catch(e){ bad++; console.error('  ✗ 載入期就炸了：'+e.message); }

const q=expr=>{ try{ return vm.runInContext(expr,sandbox); }catch(e){ return '<<'+e.message+'>>'; } };
ok('money() 可用',        q('money(12345)')==='1.23億');
ok('sgn() 可用',          q('sgn(3.14)')==='+3.1');
ok('esc() 擋掉尖括號',    q('esc("<img>")')==='&lt;img&gt;');
ok('種子白名單擋掉引號',  q('"a\\"b<c".replace(SAFE,"")')==='abc');

/* ---------- 2. 照 play.html 用到的 API 面玩一整局 ---------- */
const need=['newGame','BY_ID','HABITS','REGIME','slotsAt','INST','SIGNALS','THEMES'];
ok('KERNEL 匯出頁面要用的東西', need.every(k=>K[k]!=null));

const g=K.newGame('smoke');
const api=['nav','assets','investable','openYear','moves','play','midWindow','playMid','closeYear','career'];
ok('遊戲物件有頁面要用的方法', api.every(k=>typeof g[k]==='function'));

let years=0, plays=0, mids=0, kinds={};
let guard=0;
while(!g.over && guard++<40){
  if(g.raw.year===6) g.career('job');
  const o=g.openYear();
  if(!o) break;
  years++;
  /* 頁面讀的欄位 */
  if(!Array.isArray(o.signals)||o.signals.some(s=>!s.t)) { bad++; console.error('  ✗ 訊號牌缺 t'); break; }
  if(!Array.isArray(g.raw.notes)) { bad++; console.error('  ✗ notes 不是陣列'); break; }

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
ok('有結局', !!g.ending && !!g.ending.t);
ok('結局有頁面要印的欄位',
   g.ending && ['nav','inflow','bench','edge','tax','div','trades','blowups','life'].every(k=>g.ending[k]!=null));

/* ---------- 3. 相同種子＋相同選擇＝相同人生 ---------- */
function replay(seed){
  const a=K.newGame(seed); let n=0;
  while(!a.over && n++<40){
    if(a.raw.year===6) a.career('job');
    if(!a.openYear()) break;
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

process.exit(bad?1:0);
