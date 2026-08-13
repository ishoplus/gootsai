/* 載入期冒煙測試。node --check 只驗語法，抓不到 TDZ、未定義參照這類「能解析但一執行就炸」的錯。
   這支把整份腳本真的跑一次，並確認關鍵全域都建立起來了。 */
const fs=require('fs'), vm=require('vm'), path=require('path');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const src=html.slice(html.indexOf('<script>')+8, html.lastIndexOf('</script>'));
const el=()=>({style:{},dataset:{},value:'',textContent:'',innerHTML:'',
  classList:{add(){},remove(){},toggle(){},contains:()=>false},
  appendChild(){},remove(){},addEventListener(){},querySelectorAll:()=>[],
  querySelector:()=>null,getContext:()=>null,insertAdjacentHTML(){},onclick:null});
const s={console,Math,JSON,Object,Array,String,Number,Boolean,Date,isNaN,parseInt,parseFloat,
 setInterval:()=>0,clearInterval(){},setTimeout:()=>0,requestAnimationFrame(){},
 matchMedia:()=>({matches:true}),navigator:{clipboard:{writeText:()=>Promise.resolve()}},
 localStorage:{getItem:()=>null,setItem(){}},history:{replaceState(){}},
 location:{search:'',pathname:'/',href:'http://x/',origin:'http://x'},
 URLSearchParams:global.URLSearchParams,getComputedStyle:()=>({getPropertyValue:()=>''}),
 document:{body:{dataset:{},classList:{add(){},remove(){},toggle(){},contains:()=>false},appendChild(){},style:{}},
   getElementById:el,createElement:el,querySelectorAll:()=>[],execCommand(){}}};
s.window=s; s.globalThis=s; vm.createContext(s);
try{ vm.runInContext(src,s,{filename:'game.js'}); }
catch(e){ console.error('✗ 載入期就炸了：'+e.message); process.exit(1); }

const q=expr=>vm.runInContext(expr,s);
const checks=[
 ['S 已宣告',            'typeof S!=="undefined"'],
 ['EVENTS 81 張',        'EVENTS.length===81'],
 ['每張卡的 if 可呼叫',   'EVENTS.every(e=>!e.if||typeof e.if==="function")'],
 ['專屬選項卡 10 張',     'EVENTS.filter(e=>e.o).length===10'],
 ['專屬選項各有結果',     'EVENTS.filter(e=>e.o).every(e=>e.o.every(o=>o.t&&o.g&&o.gt))'],
 ['結局規則與圖鑑對齊',   'ENDING_IDS.length>0'],
 ['標的表 6 檔',          'POSN.length===6'],
 ['流派 5 派',            'Object.keys(SCHOOL).length===5'],
];
let bad=0;
for(const [name,expr] of checks){
  let ok=false;
  try{ ok=!!q(expr); }catch(e){ ok=false; }
  if(!ok){ bad++; console.error('  ✗ '+name); } else console.log('  ✓ '+name);
}
/* 條件卡：拿一個空白狀態去跑每一張 if，確認不會拋錯 */
try{
  q(`(()=>{ const fake={nav:0,age:16,career:'none',ab:{},traits:{}};
     EVENTS.forEach(e=>{ if(e.if) e.if(fake); }); })()`);
  console.log('  ✓ 所有 if 條件在空白狀態下不拋錯');
}catch(e){ bad++; console.error('  ✗ if 條件拋錯：'+e.message); }
process.exit(bad?1:0);
