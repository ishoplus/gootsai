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
  cash:  {n:'永遠留三成現金', fx:'可投入資金上限七成，幾乎不可能斷頭'},
  /* 這兩個是為了事件卡加回來的。骨架剛換的時候把它們砍了，因為在純財務模型裡
     它們沒有掛載點——但「退了群就不會有人報明牌給你」正是這款最好的一條規則，
     而它只有在事件卡存在的時候才成立。砍掉它們等於砍掉事件系統的一半。 */
  quiet: {n:'不看群組',       fx:'明牌、詐騙那類事件不再發生'},
  broker:{n:'跟營業員喝咖啡', fx:'研究個股的判斷準確率 +12'}
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
on('scoutacc','broker',  function(v,c){ return v + 12*hb(c.g,'broker'); });
/* quiet 沒有 hook——它的效果是「這張卡根本不會發生」，寫在抽牌的 block 檢查裡。
   一個習慣最好的效果，是讓你再也不必面對某個處境。 */

/* ================= 事件卡 =================
   規則只有一條：**選項必須是那個處境裡你真的能做的事，而且各有各的後果。**
   沒有「保守／照常／全力」這種難度旋鈕——那是把同一件事縮放三次，
   跟卡片講什麼沒有關係。

   從舊版原樣搬過來，只把 mood 改名成 tilt。33 張卡、97 個選項、54 處機率分歧。
   骨架換過，但這批文字是這款唯一沒辦法用模擬器生出來的東西。

   stg      young（<22 歲）／pro（>=22 歲）／*（都可以）
   need     有這個習慣，才會多出某個選項（你做得到什麼，取決於你養成了什麼）
   block    有這個習慣，這張卡根本不會發生（退了群就不會有人報明牌給你）
   p 省略   ＝確定發生，不擲骰——不是每個決定都是賭局
   g / b    成功與失敗各自的後果；gt / bt 是各自的那段文字
   nav      淨值百分比（在 evMoney 裡縮放），其餘是點數 */
const EVENTS=[

/* ---- 學生時期 ---- */
{n:'群組明牌',stg:'young',block:'quiet',
 d:'高中同學群裡有人貼了一張圖：「下週有大訊息，懂的自己上車。」下面已經十幾個人說謝謝。',
 o:[
  {t:'問他訊息哪來的', g:{hab:{log:2}},
   gt:'他說是「朋友的朋友在裡面」。你笑笑沒再追問，也沒有買。群組裡從此少了一個人找你講話。'},
  {t:'小買一點試試', p:52, g:{nav:7},
   gt:'漲了兩天你就跑了，賺一個便當錢。但你記住了那個感覺——那才是危險的地方。',
   b:{nav:-8,mood:-4}, bt:'你買在那兩天的最高點。它現在還在你的庫存裡，你已經很久沒點開那一頁。'},
  {t:'照他說的全押', p:33, g:{nav:26,mood:9},
   gt:'真的漲停了。你在群組裡連發三個貼圖，那天晚上睡不著，但是是好的那種。',
   b:{nav:-28,mood:-11}, bt:'隔天開盤跌停。你回頭去看那則訊息，發現貼圖的人已經退群了。'},
  {t:'退群，不玩這個', need:null, g:{hab:{quiet:5},mood:-3},
   gt:'你按了退出。手指停了兩秒——你知道自己以後會少聽到很多東西。'}
 ]},

{n:'教官搜書包',stg:'young',
 d:'全班的手機都被收走。你的股票軟體停在一個很難解釋的畫面。',
 o:[
  {t:'承認，交出手機', g:{hab:{log:2},life:2},
   gt:'記了一支小過。教官在辦公室問你為什麼要做這個，你講了十分鐘，他聽完了。'},
  {t:'說是幫爸爸看的', p:48, g:{mood:3},
   gt:'他將信將疑，手機還你了。你走出辦公室的時候腿有點軟。',
   b:{life:-6,mood:-5}, bt:'他打了電話回家。那通電話之後，家裡的氣氛有半年不太對。'},
  {t:'把畫面切掉，裝沒事', p:34, g:{mood:4},
   gt:'你切得夠快。那天之後你養成了鎖螢幕的習慣，這習慣跟了你很多年。',
   b:{life:-7,mood:-7}, bt:'他看到了你切畫面的動作。事情從「看盤」變成「說謊」。'}
 ]},

{n:'大夜班',stg:'young',
 d:'便利商店的大夜班，時薪一百八。你算過，做滿三個月可以多買兩張。',
 o:[
  {t:'做滿三個月', g:{nav:16,life:-5},
   gt:'三個月後你真的多買了兩張。你也第一次知道，凌晨四點的便利商店是什麼樣子。'},
  {t:'做一個月就好', g:{nav:5,life:-1},
   gt:'錢少一點，但你還睡得著。'},
  {t:'不做，把時間拿來讀', g:{hab:{read:4}},
   gt:'你把那三個月拿去把一本厚書讀完。當下覺得虧了，很多年後才知道沒有。'}
 ]},

{n:'壓歲錢全砸進去',stg:'young',
 d:'過年拿到的紅包，你一毛都沒留。',
 o:[
  {t:'留一半，另一半進場', g:{nav:6,hab:{cash:3}},
   gt:'你留了一半在戶頭。那筆錢後來在某個很低的位置派上用場。'},
  {t:'全部進場', p:50, g:{nav:17,mood:6},
   gt:'開學前它漲了三成。你在班上什麼都沒說，但走路有風。',
   b:{nav:-16,mood:-8}, bt:'開學前它跌了三成。你連午餐都改吃最便宜的那種。'}
 ]},

{n:'她問你在忙什麼',stg:'young',
 d:'你想了三種講法，每一種聽起來都像在炫耀或像個怪人。',
 o:[
  {t:'照實說', p:55, g:{life:5,mood:6},
   gt:'她說「聽起來很酷欸」，然後真的問了兩個問題。你們聊到打烊。',
   b:{life:-4,mood:-6}, bt:'她「喔」了一聲，話題就轉走了。你那天回家路上想了很久。'},
  {t:'說在打工', g:{life:2,mood:-2},
   gt:'安全。也就只是安全而已。'}
 ]},

/* ---- 進場之後 ---- */
{n:'第一次開融資',stg:'*',
 d:'營業員打來：「你的額度下來了，要不要開？開了不用也沒關係。」',
 o:[
  {t:'不開', g:{hab:{cash:4}},
   gt:'你說不用。他愣了一下，說很少人這樣回答。'},
  {t:'開著，但不用', p:56, g:{mood:3},
   gt:'額度在那裡，你一次都沒動過。你開始明白，能力跟用不用它是兩件事。',
   b:{hab:{cash:-3},mood:5}, bt:'額度在那裡三個月，你就用了。人不會放著工具不用。'},
  {t:'開了就用滿', p:36, g:{nav:22,mood:8},
   gt:'那一波你賺了兩倍。你開始覺得沒開融資的人只是膽子小。',
   b:{nav:-27,mood:-12}, bt:'第一次追繳簡訊來的時候是禮拜五下午。那個週末很長。'}
 ]},

{n:'停損測試',stg:'*',
 d:'它跌破了你當初心裡想的那個價位。手指停在賣出鍵上。',
 o:[
  {t:'照紙上寫的做', need:'stop', g:{nav:-6,hab:{stop:3}},
   gt:'你按下賣出。三天後它跌得更深，你沒有告訴任何人，你其實鬆了一口氣。'},
  {t:'再等一根看看', p:44, g:{nav:4},
   gt:'它止跌了。這次對了——但你心裡有個聲音說，這種對法不能常常用。',
   b:{nav:-15,mood:-6,hab:{stop:-2}}, bt:'再一根，然後又一根。你當初想的那個價位，現在看起來像天花板。'},
  {t:'不但不賣，還加碼', p:29, g:{nav:20,mood:9},
   gt:'你賭對了。它翻上來的那天，你覺得停損根本是給沒把握的人用的。',
   b:{nav:-27,mood:-12,hab:{stop:-4}}, bt:'加碼的部位跟原本的一起躺平。學費是你原本打算認賠金額的三倍。'}
 ]},

{n:'抄底',stg:'*',
 d:'它已經跌了六成。有人說接刀子，有人說千載難逢。',
 o:[
  {t:'再等等，讓它落底', p:58, g:{nav:9,hab:{stop:2}},
   gt:'你等到量縮才進。買在不是最低但夠低的地方——這通常比買在最低更難。',
   b:{mood:-6}, bt:'它從你不敢買的那天起就沒再回頭。你看著它漲回去，一張都沒有。'},
  {t:'分批往下承接', g:{nav:-3,hab:{log:3}},
   gt:'你分了四批。最後平均成本比一次買進好一點，心臟也好過一點。'},
  {t:'一次買滿', p:38, g:{nav:26,mood:8},
   gt:'你買在了那根最長的下影線上。這種事一輩子會發生一兩次，問題是你不知道是哪次。',
   b:{nav:-24,mood:-11}, bt:'你買完之後它又跌了四成。原來六成不是底，八成才是。'}
 ]},

{n:'今年的當紅題材',stg:'*',
 d:'一個你完全看不懂的東西三個月漲了八倍。所有人都在裡面，包括你以為很保守的那個同事。',
 o:[
  {t:'看不懂就不碰', g:{hab:{read:3},mood:-4},
   gt:'你沒有買。接下來三個月，每一次它漲停你都會知道——因為有人會告訴你。'},
  {t:'拿零用錢玩一點', p:47, g:{nav:11,mood:5},
   gt:'小賺跑掉。你發現自己其實只是想參與，不是想賺錢。',
   b:{nav:-9,mood:-5}, bt:'你進場那天就是最高點。金額不大，但那個時間點準得可怕。'},
  {t:'借錢也要上車', p:26, g:{nav:34,mood:12},
   gt:'你上到了最後一段。那三個月你覺得自己是天才，這個錯覺持續了很久。',
   b:{nav:-33,mood:-15,life:-4}, bt:'它從你買進那天開始跌，跌到你不敢跟任何人講數字。'}
 ]},

{n:'假投資群',stg:'*',block:'quiet',
 d:'一個自稱基金經理的人加你好友，兩週沒推銷任何東西，只是每天分享行情。今天他給了你一個 App 連結。',
 o:[
  {t:'直接封鎖', g:{hab:{quiet:3}},
   gt:'你封鎖了他。三天後另一個人加你，開場白幾乎一模一樣。'},
  {t:'先查一下這個人', p:72, g:{hab:{read:3,log:2}},
   gt:'照片是網路上抓的，公司地址查無此號。你把截圖丟到反詐騙的社團，底下一堆人說也遇過。',
   b:{life:-3,mood:-4}, bt:'查了半天查不出所以然。你把對話刪掉，但那個連結你還留著。'},
  {t:'小額試水溫', p:20, g:{nav:8,mood:5},
   gt:'第一筆真的出金了。你後來才知道，那是他們的成本——用來換你下一筆大的。',
   b:{nav:-32,mood:-15,life:-4}, bt:'出金要先繳「保證金」。你才發現整個平台的數字都是畫出來的。'}
 ]},

{n:'當沖上癮',stg:'*',
 d:'你發現每天進出十幾趟很爽，輸贏都爽。手續費單據你已經不看了。',
 o:[
  {t:'把當沖權限關掉', g:{hab:{close:6},life:3},
   gt:'你打電話去券商。營業員問你是不是遇到什麼事，你說沒有。'},
  {t:'限制自己每週兩次', p:46, g:{hab:{close:3}},
   gt:'次數少了，勝率反而高了。你開始懷疑之前那些單子到底是在做什麼。',
   b:{nav:-10,life:-3,hab:{close:-2}}, bt:'第一週兩次，第二週五次，第三週你不再算了。'},
  {t:'加大部位，這才有搞頭', p:27, g:{nav:18,mood:10},
   gt:'那個月你賺得比上班一年多。你開始認真考慮辭職。',
   b:{nav:-25,life:-6,mood:-9}, bt:'部位大了虧損也大了，而手續費是照倍數算的。那個月的稅費比伙食費高。'}
 ]},

{n:'從不看盤的朋友',stg:'*',
 d:'他十年前買了幾檔就沒再動過，也說不出理由。他的報酬率比你高。',
 o:[
  {t:'照做，什麼都不動', g:{hab:{close:5},mood:-3},
   gt:'你把通知關掉。第一個禮拜很難熬，第三個禮拜你就忘記自己關過。'},
  {t:'參考一下，做點調整', p:64, g:{hab:{log:3,close:2}},
   gt:'你把週轉率砍了一半。年底一看，省下來的手續費比你那年的價差還多。',
   b:{mood:-5}, bt:'你調整了兩個月又調回去。人要改變一個習慣，比想像中難得多。'},
  {t:'他只是運氣好', p:38, g:{nav:8,mood:4},
   gt:'你證明了自己那年比他強。只有那一年。',
   b:{nav:-11,mood:-8}, bt:'年底對帳，他還是贏你。他甚至說不出自己買了什麼。'}
 ]},

{n:'一本很厚的書',stg:'*',
 d:'很舊、沒有任何 K 線圖。你翻到第三章開始覺得哪裡不對——不對的是你。',
 o:[
  {t:'讀完', g:{hab:{read:6}},
   gt:'花了兩個月。讀完之後你把自己過去三年的交易重看一遍，看不下去。'},
  {t:'翻一翻就好', g:{hab:{read:2}},
   gt:'你抓到幾個概念，其他的留在書架上。'},
  {t:'太慢了，去看影片', p:40, g:{mood:5},
   gt:'十分鐘的濃縮版。你確實學到了東西，只是那些東西別人也都知道。',
   b:{hab:{read:-2},mood:-3}, bt:'演算法接著推了二十支類似的。兩小時後你什麼都沒記得。'}
 ]},

{n:'看到財富自由影片',stg:'*',
 d:'演算法推播給你一支影片：《我 25 歲退休，只做對了這一件事》。',
 o:[
  {t:'關掉', g:{mood:2,hab:{quiet:2}},
   gt:'你關掉了。三秒後它又推了一支類似的。'},
  {t:'看完，記下他說的方法', p:52, g:{hab:{log:3}},
   gt:'方法其實不新，但他講得很清楚。你把它寫進日誌，之後真的用上了。',
   b:{mood:6,hab:{stop:-2}}, bt:'你記住的不是方法，是那個數字。接下來一個月你的部位都開得比平常大。'}
 ]},

{n:'停利之後又漲了',stg:'*',
 d:'你在 +30% 出場，它接著又漲了一倍。你每天還是會點進去看一次。',
 o:[
  {t:'關掉，不看了', g:{mood:3,hab:{close:3}},
   gt:'你把那檔從自選股刪掉。刪的時候手指停了一下，但還是刪了。'},
  {t:'記下來，寫進檢討', need:'log', g:{hab:{log:3,read:2}},
   gt:'你把當初賣出的理由重讀一次，發現理由沒錯，只是市場比你有耐心。'},
  {t:'追回去', p:34, g:{nav:14,mood:6},
   gt:'你追回去了，而且還有第三段。那次之後你更難賣得掉任何東西。',
   b:{nav:-17,mood:-9,hab:{stop:-3}}, bt:'你買在那一段的頂點。同一檔股票，你賺過也賠過，賠的比賺的多。'}
 ]},

{n:'健康檢查紅字',stg:'*',
 d:'醫生指著報告：「你這個年紀不該有這種數字。你晚上都幾點睡？」',
 o:[
  {t:'照醫生說的做', g:{hab:{gym:6},life:6},
   gt:'你開始十一點睡。盤中發生什麼你都慢一步知道了——後來發現這樣也沒差。'},
  {t:'先把這一季撐完', p:52, g:{nav:6},
   gt:'你撐完了，而且那一季做得不錯。年底回診，有幾個數字自己降下來了。',
   b:{life:-8,mood:-4}, bt:'那一季結束的時候你掛了急診。醫生翻著上一份報告，什麼都沒說。'},
  {t:'報告收起來，不要想它', g:{life:-7,mood:4},
   gt:'你把那張紙折起來塞進抽屜。心情確實好一點——這是這件事最麻煩的地方。'}
 ]},

{n:'營業員來電',stg:'*',
 d:'「這檔我們自己人都有買。」他壓低聲音說。',
 o:[
  {t:'謝謝，但我自己看', g:{hab:{read:3}},
   gt:'你查了那家公司，發現負債比高得離譜。你沒有問他為什麼推。'},
  {t:'買一點，順便維持關係', p:50, g:{nav:6,hab:{broker:3}},
   gt:'不算賺，但他記住了你。年底他真的先打給你。',
   b:{nav:-8,hab:{broker:2}}, bt:'賠了一點。他後來換到別家去了，也沒有再聯絡。'},
  {t:'既然是自己人，就重壓', p:34, g:{nav:20,hab:{broker:3}},
   gt:'那檔真的走了一段。你開始相信那句「我們自己人」。',
   b:{nav:-24,mood:-9,hab:{broker:-3}}, bt:'你後來才知道，同一句話他跟很多人講過。'}
 ]},

/* ---- 成年之後 ---- */
{n:'過年被問收益率',stg:'pro',
 d:'三姑六婆圍成一圈。「聽說你在做股票？今年賺多少？」',
 o:[
  {t:'含糊帶過', g:{mood:2,life:2},
   gt:'你說「還好啦」，然後把話題轉到表弟的婚事上。這招你以後每年都會用。'},
  {t:'照實說', p:54, g:{life:3,hab:{family:3}},
   gt:'你把賺的賠的都講了。三舅說他也賠過，兩個人聊到十二點。',
   b:{life:-5,mood:-6}, bt:'數字說出口的那一刻，桌上安靜了兩秒。那兩秒你記了很久。'},
  {t:'講得比實際好聽', p:46, g:{mood:6},
   gt:'那頓飯你是主角。回家的路上你在心裡把數字又算了一次，還是不對。',
   b:{life:-4,mood:-8,trust:-6}, bt:'有人真的拿錢來找你操作。你才發現吹過的牛是要還的。'}
 ]},

{n:'老闆發現你上班看盤',stg:'pro',need_job:1,
 d:'他沒有罵你，只是把你的座位調到了他辦公室門口。',
 o:[
  {t:'收起來，上班就上班', g:{hab:{close:6},life:3},
   gt:'你把 App 從手機首頁移走。盤中發生什麼你都不知道了——後來發現這樣也沒差。'},
  {t:'改成只看收盤', p:60, g:{hab:{close:3,log:2}},
   gt:'一天看一次，決定反而變少、變好。你開始懷疑盤中那些單子是在做什麼的。',
   b:{life:-4,mood:-4}, bt:'撐了三週。第四週你又開始每隔十分鐘翻一次手機。'},
  {t:'照看，反正他不敢怎樣', p:38, g:{nav:9,mood:5},
   gt:'那年你盤中抓到幾波，賺的比年終多。你開始覺得這份工作只是個地方坐。',
   b:{nav:-6,life:-6,mood:-9}, bt:'考績出來，你被調到一個沒有窗戶的位子。沒有人跟你說原因。'}
 ]},

{n:'朋友要跟單',stg:'pro',
 d:'他把定存解約了，說要跟你一起做。金額是你的三倍。',
 o:[
  {t:'勸他別做', g:{life:2,mood:2},
   gt:'你把可能虧多少講完，他有點失望。三年後他還是會提起這件事，語氣是感謝的。'},
  {t:'照實告訴他風險', p:58, g:{nav:5,hab:{log:2}},
   gt:'他聽懂了，自己減碼一半。賺的時候他請你吃飯，賠的時候他沒有怪你。',
   b:{life:-4}, bt:'他只聽到「有機會」三個字。賠掉之後，他覺得你早就知道會這樣。'},
  {t:'帶他一起，賺賠一起扛', p:40, g:{nav:12,life:3},
   gt:'一起賺到了。那頓慶功宴他堅持要買單，你們兩個都喝多了。',
   b:{life:-9,mood:-11}, bt:'他的定存是解約的。你把錢賠給他，他收下了，但你們沒有再一起吃過飯。'}
 ]},

{n:'另一半說該買房了',stg:'pro',minAge:26,
 d:'「你的錢都在股票裡，我知道。可是我們要住哪裡？」',
 o:[
  {t:'先看房，部位砍一半', g:{life:8,nav:-11,hab:{cash:4}},
   gt:'頭期款轉出去那天，帳戶少了一半。那天晚上你們睡得很好。'},
  {t:'兩邊各退一步', p:60, g:{life:4,hab:{family:3}},
   gt:'你們談了一個折衷的數字。這種對話往後還會有很多次，但這次你們都沒有大聲。',
   b:{life:-6,mood:-5}, bt:'折衷的意思是兩個人都不滿意。這件事之後被提起過很多次。'},
  {t:'再等一年，我算過的', p:38, g:{nav:14,mood:6},
   gt:'那一年市場真的漲了。你把試算表拿給他看，他沒有說話。',
   b:{life:-11,mood:-10}, bt:'房價漲得比你的部位快。「我算過的」這四個字，你以後不敢再講。'}
 ]},

{n:'父母生病',stg:'pro',minAge:28,
 d:'電話是半夜打來的。醫藥費的數字，剛好是你這檔股票的浮虧。',
 o:[
  {t:'賣股，先顧人', g:{nav:-14,life:6,hab:{family:4}},
   gt:'你賣在一個很難看的價位。後來它漲回去了，但你沒有後悔過這件事。'},
  {t:'借錢週轉，部位不動', p:50, g:{nav:-4},
   gt:'你借了一筆，兩年還完。部位撐住了，人也顧到了——這次算你運氣好。',
   b:{nav:-18,life:-6,mood:-9}, bt:'借的錢跟賠的錢一起來。那半年你沒有一天睡超過五小時。'},
  {t:'撐著，我算得出來還撐得住', p:34, g:{nav:8},
   gt:'你算對了。但那段時間你每天都在算，算到自己都覺得不對勁。',
   b:{life:-12,mood:-13}, bt:'你算錯了。錢是後來湊到的，但你記得自己猶豫過那幾秒。'}
 ]},

{n:'岳家的錢',stg:'pro',minAge:28,
 d:'「我們退休金放定存也是放著，你幫我們操作嘛。」',
 o:[
  {t:'不接', g:{life:4,mood:3},
   gt:'你說自己都還沒想清楚。他們有點失望，但你晚上睡得著。'},
  {t:'接，但講清楚可能會賠', p:56, g:{trust:6,hab:{family:3}},
   gt:'你寫了一張紙，把最壞的情況列出來給他們簽。他們笑你太誇張，但簽了。',
   b:{life:-6,trust:-8}, bt:'話講在前面沒有用。數字一綠，前面講的都不算了。'},
  {t:'接下來，一定會賺', p:34, g:{nav:10,trust:8},
   gt:'第一年就賺了。過年時你是全家最會做人的那一個。',
   b:{life:-10,mood:-12,trust:-20}, bt:'那筆錢賠了三成。他們一句重話都沒說，這件事因此更難過去。'}
 ]},

{n:'同學會',stg:'pro',
 d:'有人問你在做什麼。你想了兩秒，決定要不要講實話。',
 o:[
  {t:'輕描淡寫', g:{life:3,mood:2},
   gt:'你說在上班。那天晚上你聽了很多別人的事，講了很少自己的。'},
  {t:'照實講，包括賠的', p:58, g:{life:4,hab:{log:2}},
   gt:'有兩個人下場問你細節。其中一個後來變成你少數會討論部位的人。',
   b:{mood:-6}, bt:'桌上安靜了一下。有人說「還好我沒碰」。'},
  {t:'講得像那麼一回事', p:44, g:{mood:7},
   gt:'那晚你是話題中心。回家的計程車上你想起來自己漏講了哪些年。',
   b:{life:-5,mood:-8}, bt:'有人拿出手機查了那檔的走勢，當場對不上。'}
 ]},

{n:'公司裁員',stg:'pro',need_job:1,
 d:'名單還沒公佈，但會議室的百葉窗放下來一整個下午了。',
 o:[
  {t:'先把履歷更新好', g:{life:-2,hab:{log:2}},
   gt:'你花了一個週末把這幾年做過的事列出來。列完發現比自己以為的多。'},
  {t:'什麼都不做，等消息', p:52, g:{mood:2},
   gt:'名單沒有你。你鬆了一口氣，然後發現隔壁桌空了。',
   b:{life:-7,mood:-10}, bt:'名單有你。資遣費入帳那天，你把它全部丟進市場——這個決定日後你會反覆想起。'},
  {t:'主動去談，換部門', p:44, g:{life:3},
   gt:'你換到一個比較穩的位子。薪水少一點，但那一波沒有掃到你。',
   b:{life:-5,mood:-6}, bt:'你去談了，主管的表情讓你知道自己本來不在名單上。'}
 ]},

{n:'年終獎金',stg:'pro',need_job:1,
 d:'今年公司賺錢，年終比預期多。錢剛進戶頭。',
 o:[
  {t:'照原本的計畫投入', need:'dca', g:{nav:11},
   gt:'錢一進來就照比例分掉了。你已經很久沒有為這種事煩惱過。'},
  {t:'先放著，等機會', p:54, g:{nav:8,hab:{cash:3}},
   gt:'你放了四個月，等到一個不錯的位置。等待也是一種部位。',
   b:{mood:-5}, bt:'放到年底都沒等到「更好的位置」。那筆錢就這樣躺了一年。'},
  {t:'加碼現在最強的那檔', p:42, g:{nav:15,mood:6},
   gt:'追上去還有一段。你把這歸功於自己的判斷。',
   b:{nav:-14,mood:-7}, bt:'你買在那一波的尾巴。年終獎金變成一個你不想再提的數字。'}
 ]},

{n:'開直播當老師',stg:'pro',
 d:'有人問你能不能開個頻道。「你講得比那些人清楚多了。」',
 o:[
  {t:'不開', g:{mood:3,life:2},
   gt:'你想了三天，回訊息說最近沒空。對方沒有再問。'},
  {t:'開了但不收費', p:58, g:{hab:{log:3,read:2}}, fame:1,
   gt:'講給別人聽，才發現自己有很多地方沒想清楚。頻道不大，但你變強了。',
   b:{life:-5,mood:-5}, bt:'留言區開始有人問明牌，你不回，他們就說你藏私。'},
  {t:'開課，一堂四萬八', p:50, g:{nav:14,mood:8}, fame:1,
   gt:'第一梯就滿了。你發現教課的現金流比操作穩定得多——這件事你沒有跟學員說。',
   b:{life:-5,mood:-9,trust:-6}, bt:'有學員把你的對帳單跟課程文宣放在一起比對，貼上網。'}
 ]},

{n:'借錢',stg:'pro',
 d:'信貸利率 3.2%，你算過，只要報酬率超過它就是賺。銀行說今天下午就能核。',
 o:[
  {t:'不借', g:{hab:{cash:4},mood:2},
   gt:'你把試算表關掉。那個 3.2%，你算了整整一個晚上。'},
  {t:'借最低額度', p:54, g:{nav:9},
   gt:'剛好夠你在低點多買一些。還款那天你算了一下，扣掉利息還是賺的。',
   b:{nav:-12,mood:-6}, bt:'市場沒有照你算的走。每個月的扣款日提醒你，這筆錢是借來的。'},
  {t:'額度給多少借多少', p:36, g:{nav:24,mood:9},
   gt:'一次到位。你開始覺得，不敢借的人只是不夠了解自己在做什麼。',
   b:{nav:-31,life:-5,mood:-13}, bt:'部位縮水，貸款一毛沒少。你開始用信用卡的循環利息付信貸的月付金。'}
 ]},

{n:'同學的告別式',stg:'pro',minAge:32,
 d:'心肌梗塞，四十一歲。你在告別式上算了一下自己的年紀。',
 o:[
  {t:'從明天開始運動', g:{hab:{gym:6},life:5},
   gt:'你真的從隔天開始。前三個月很痛苦，第四個月開始想念它。'},
  {t:'打電話給家裡', g:{life:6,hab:{family:4}},
   gt:'你打給爸媽，講了四十分鐘的廢話。掛掉之後你在車上坐了很久。'},
  {t:'回去把部位重新看一遍', g:{hab:{log:4},mood:-4},
   gt:'你把所有持股列出來，問自己每一檔為什麼還在。有三檔答不出來。'}
 ]},

{n:'內線訊息',stg:'pro',
 d:'飯局上有人喝多了，講了一個還沒公告的併購案。你記住了代號。',
 o:[
  {t:'當作沒聽到', g:{mood:2,hab:{log:2}},
   gt:'你把那個代號忘掉。花了大概兩個月，中間你查過三次股價。'},
  {t:'記下來但不動作', p:60, g:{hab:{broker:3,log:2}},
   gt:'兩個月後併購案公告，股價翻倍。你什麼都沒買，但你確認了一件事：那個飯局值得再去。',
   b:{mood:-7}, bt:'那個案子最後沒有成。你慶幸自己沒進場，同時有點失落。'},
  {t:'明天開盤就進場', p:56, g:{nav:26},
   gt:'公告當天漲停。你賣在第二根，錢入帳的那個下午你一直在看手機。',
   b:{nav:-13,life:-5,mood:-9}, honor:'曾因不明資金往來被關切',
   bt:'案子破局，股價一路往下。更麻煩的是，交易所調閱了那段期間的進出紀錄。'}
 ]},

{n:'帳戶破千萬那天',stg:'*',minNav:1000,
 d:'你截了圖，打開通訊錄，從頭滑到尾。',
 o:[
  {t:'誰都不說', g:{mood:5,hab:{quiet:3}},
   gt:'你把截圖存進一個只有自己看得到的資料夾。這件事你守了很多年。'},
  {t:'傳給家人', g:{life:6,mood:6,hab:{family:3}},
   gt:'媽回了一句「不要太累」。你看著那七個字看了很久。'},
  {t:'發出去，我值得', p:48, g:{mood:10}, fame:1,
   gt:'底下三百多個讚。那天你回了每一則留言。',
   b:{life:-6,mood:-8,trust:-5}, bt:'有人截圖轉到別的群組，配上一句「就這樣也敢發」。'}
 ]},

{n:'房子還是股票',stg:'pro',minAge:26,minNav:200,
 d:'頭期款拿出來，帳戶就少一半。可是房子會一直在那裡。',
 o:[
  {t:'買房', g:{nav:-32,life:10,hab:{cash:5}},
   gt:'搬進去的第一晚，你們坐在還沒組好的沙發上吃泡麵。那是你記得最清楚的一頓飯。'},
  {t:'再等一年', p:46, g:{nav:12},
   gt:'那一年你的部位漲得比房價快。你把差額算出來，貼在冰箱上。',
   b:{life:-8,mood:-9}, bt:'房價漲了兩成，你的部位沒有。那張沒貼成的紙後來也沒再提。'},
  {t:'貸款買，股票也不賣', p:36, g:{nav:6,life:5},
   gt:'兩邊都要了。你也因此有整整八年不敢生病。',
   b:{nav:-20,life:-8,mood:-11}, bt:'升息那年你才知道，兩邊都要的意思是兩邊都撐。'}
 ]},

{n:'有人要把錢交給你',stg:'pro',minNav:600,
 d:'不是家人，是一個認識很久、但從來沒談過錢的朋友。他說他信得過你。',
 o:[
  {t:'婉拒', g:{mood:4,life:2},
   gt:'你說自己都還在學。他點點頭，那頓飯之後你們還是朋友。'},
  {t:'接，但先寫清楚規則', need:'log', g:{trust:10,hab:{log:3}},
   gt:'你把費用、風險、什麼情況會賠光都寫成一張紙。他看完說「你比銀行還囉唆」。'},
  {t:'接下來再說', p:44, g:{trust:6,nav:5},
   gt:'第一年順利。你們都沒提規則的事，因為沒有需要。',
   b:{trust:-14,life:-7}, bt:'第一年就賠。沒有寫過的規則，事後怎麼講都是你的錯。'}
 ]}

];

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
    tilt:55, life:70, habits:{}, career:'none', plan:'craft',
    ap:0, apLeft:0, dice:[], dieAt:0, declined:{}, signals:[], hotGuess:null, yr:null, mid:null, scouted:{},
    blowups:0, taxPaid:0, divTotal:0, realized:0, trades:0,
    inflow:0, benchSh:0,
    trust:50, fame:0, honors:[],           /* 事件卡寫得進來的三個外部狀態 */
    seenEv:{}, pendEv:null, evLog:[],
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
function buy(g,id,amount,priceOverride){
  amount=Math.min(amount, g.cash);
  if(!(amount>MIN_TRADE)) return null;
  const p=priceOverride==null?g.price[id]:priceOverride;
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
  /* 每一點行動點都是一顆骰子。點數在問你之前就先亮出來——
     它不決定你能不能做，決定的是你今年做這件事做得多到位。
     舊版的骰子點數只換成熟練度，那是一個看不見的數字；
     這裡它直接改你眼前那個選項的後果。 */
  g.dice=[]; for(let i=0;i<g.ap;i++) g.dice.push(1+Math.floor(g.R()*6));
  g.dieAt=0;

  /* 手癢：心態太高，年初就有一點被你自己花掉了 */
  if(g.tilt>=80 && fold('itch',1,{g:g})){
    const th=BY_ID['th_'+g.hotGuess];
    const amt=investable(g)*0.3;
    if(amt>MIN_TRADE && th){ buy(g,th.id,amt); g.apLeft--; g.dieAt++; g.notes.push('你手癢，年初就先追了 '+g.hotGuess+'——這一點不是你決定的'); }
  }
  g.scouted={}; g.autoDone={};
  /* 第 2 拍：今年發生在你身上的事。抽得到就先問它，抽不到才直接進出牌。
     phase 停在 'event' 的時候 moves()／beat()／autoTick() 全部回空——
     呼叫端必須先把卡處理掉。closeYear() 留了一張安全網，見那裡的註解。 */
  g.pendEv=drawEvent(g);
  g.phase=g.pendEv?'event':'act';
  return {age:g.age, income:inc, signals:g.signals, ap:g.ap, nav:nav(g), event:!!g.pendEv};
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
  /* 還融資。沒有這張牌，融資就是一條單行道：借得到、還不掉，只能等斷頭。
     那不是一個處境，那是一個判決。 */
  if(g.debt>0 && g.cash>MIN_TRADE) out.push({id:'repay', kind:'repay', label:'還掉一部分融資'});

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
  const die=curDie(g), sl=slip(die);
  let res=null;
  if(kind==='buy'){
    res=buy(g,target,investable(g)*(arg.frac==null?1:arg.frac), g.price[target]*(1+sl));
    if(!res) return null;
    res.die=die; res.slip=sl;
  } else if(kind==='sell'){
    res=sell(g,target,arg.frac==null?1:arg.frac, g.price[target]*(1-sl));
    if(!res) return null;
    res.die=die; res.slip=sl;
  } else if(kind==='margin'){
    const borrow=nav(g)*0.6;
    if(!(borrow>1)) return null;
    g.debt+=borrow; g.cash+=borrow;
    res=buy(g,target,borrow);
    if(!res){ g.debt-=borrow; g.cash-=borrow; return null; }
    res.borrowed=borrow;
  } else if(kind==='habit'){
    const h=g.habits[target]||(g.habits[target]={streak:0,stage:0});
    /* 擲到 5、6 的那一年，你是真的做到了——一年抵兩年 */
    const gain = die>=5 ? 2 : 1;
    h.streak+=gain; h.fed=g.year;
    h.stage = h.streak>=6?3 : h.streak>=3?2 : 1;
    res={habit:target, stage:h.stage, die:die, gain:gain};
  } else if(kind==='life'){
    const back=3+die*2;
    g.life=clamp(g.life+back,0,100);
    g.tilt=clamp(g.tilt+(g.tilt<55?8:-8),0,100);
    res={life:g.life, back:back, die:die};
  } else if(kind==='scout'){
    /* 只講超額報酬，不洩漏大盤方向——跟訊號牌互補，不重疊 */
    const beats=g.yr[target] - BY_ID[target].beta*g.market[g.year].ret > 0;
    const acc=fold('scoutacc', 44+die*6+18*hb(g,'read'), {g:g});
    const say=g.R()*100<acc ? beats : !beats;
    g.scouted[target]=say;
    res={inst:target, beatsMarket:say, acc:Math.round(acc)};
  } else if(kind==='repay'){
    const amt=Math.min(g.cash, g.debt);
    if(!(amt>MIN_TRADE)) return null;
    g.cash-=amt; g.debt-=amt;
    res={repaid:amt, debt:g.debt};
  } else if(kind==='work'){
    /* 拿時間直接換錢。給得少、扣得重——不然它會變成沒有風險的最優解 */
    const amt=(0.6+g.year*0.09)*die;
    income(g,amt); g.life=clamp(g.life-7,0,100);
    res={earned:amt, die:die};
  } else return null;
  g.apLeft--; g.dieAt++;
  return res;
}

/* ================= 第 2 拍：事件 =================
   事件不花行動點。行動點是「你今年決定做的事」，事件是「今年發生在你身上的事」——
   為了應付它而少做一件自己的事，那是雙重懲罰。

   舊版的 nav 是直接改淨值百分比。這裡不行：v2 有成本價、有帳本，
   一筆憑空的 +26% 會讓對照組那條體檢線失去意義。所以縮放，而且是實扣——
   賠掉的錢從現金與持股身上按比例扣走，不課稅（這不是一筆交易，是一件事）。 */
const EV_MAG=0.45;

/* 事件卡的錢分兩種，記帳方式不一樣。這件事一開始漏掉，
   「買市值型抱到底 vs 對照組」立刻從 −0.8% 掉到 −14.2%——
   因為頭期款是從玩家身上扣的，對照組不用買房。

   market：那是一個市場結果（你買在最高點）。只扣玩家，對照組不動。
   flow  ：那是一筆外部現金流（頭期款、醫藥費、年終獎金）。
           對照組要付一樣的錢——不然這條線量到的就不是「你會不會投資」，
           而是「這局有沒有叫你買房」。

   怎麼分？用卡片自己的結構：要擲骰的分支（有 p）是市場結果，
   確定發生的是生活現金流。這條規則不完美（「照紙上寫的做」的 −6 其實是市場結果），
   但它不需要人工標註六十五個數字，而且錯的方向是保守的。 */
function evMoney(g,pct,flow){
  const amt=nav(g)*(pct/100)*EV_MAG;
  if(!isFinite(amt)||Math.abs(amt)<0.01) return 0;
  if(flow){
    /* 對照組付一樣的絕對金額——房子不會因為你比較會投資就比較便宜 */
    if(amt>0){ income(g,amt); return amt; }
    g.benchSh=Math.max(0, g.benchSh-(-amt)/g.price.wide);
  }
  if(amt>0){ g.cash+=amt; return amt; }
  let need=-amt;
  const fromCash=Math.min(g.cash,need); g.cash-=fromCash; need-=fromCash;
  if(need>0.01){
    const mv=assets(g)-g.cash;
    if(mv>0.01){
      const f=Math.min(1,need/mv);
      for(const id in g.book){
        g.book[id].sh*=(1-f);
        if(g.book[id].sh*g.price[id]<=1e-6) delete g.book[id];
      }
    }
  }
  return amt;
}

/* 舊版的習慣是 0～100 的熟練度，一張卡給 +2 是很小的一推；
   新版是 0～6 的連續年數，+2 會直接跳一階。所以要換算，不能照抄。 */
function evHabit(g,k,v){
  if(!HABITS[k]||!v) return null;
  const step=(v>0?1:-1)*(Math.abs(v)>=4?2:1);
  let h=g.habits[k];
  if(!h){
    if(step<0) return null;
    /* 槽位滿了就落不了地。卡片可以推你一把，但推不出一個你沒有位子放的習慣 */
    if(Object.keys(g.habits).length>=slotsAt(g.age)) return null;
    h=g.habits[k]={streak:0,stage:0};
  }
  if(h.stage>=3) return null;                       /* 固化了，卡片動不了它 */
  h.streak=h.streak+step;
  if(step>0) h.fed=g.year;                          /* 卡片推的那一年也算有餵 */
  if(h.streak<=0){ delete g.habits[k]; return {hab:k, broke:true}; }
  h.stage=h.streak>=6?3:h.streak>=3?2:1;
  return {hab:k, stage:h.stage, step:step};
}

/* 套用一組後果，並回傳「畫面上該印什麼」——
   結果只給一段文字而不說數字，玩家就學不會這款的因果。 */
function applyFx(g,fx,flow){
  const out=[];
  if(!fx) return out;
  if(fx.nav!=null){
    const amt=evMoney(g,fx.nav,flow);
    if(Math.abs(amt)>=0.05) out.push({k:'nav', v:amt, t:(amt>0?'帳上多了 ':'帳上少了 ')+Math.abs(amt).toFixed(1)+' 萬'});
  }
  if(fx.tilt!=null){ addTilt(g,fx.tilt); out.push({k:'tilt', v:fx.tilt, t:'心態 '+(fx.tilt>0?'+':'')+fx.tilt}); }
  if(fx.life!=null){ g.life=clamp(g.life+fx.life,0,100); out.push({k:'life', v:fx.life, t:'生活 '+(fx.life>0?'+':'')+fx.life}); }
  if(fx.trust!=null){ g.trust=clamp(g.trust+fx.trust,0,100); out.push({k:'trust', v:fx.trust, t:'別人對你的信任 '+(fx.trust>0?'+':'')+fx.trust}); }
  if(fx.hab) for(const k in fx.hab){
    const r=evHabit(g,k,fx.hab[k]);
    if(!r) continue;
    out.push({k:'hab', v:r.step,
      t: r.broke ? '「'+HABITS[k].n+'」斷了'
        : (r.step>0?'「'+HABITS[k].n+'」往前走了'+(r.step>1?'兩年':'一年'):'「'+HABITS[k].n+'」退了一年')});
  }
  return out;
}

function evStage(g){ return g.age<22?'young':'pro'; }
/* 有些卡的敘述斷言了玩家的狀態——帳上八萬的人不該抽到「帳戶破千萬那天」。
   抽牌時依當下的年齡、淨值、身分過濾，抽過的不再出現。 */
function drawEvent(g){
  const stg=evStage(g), n=nav(g);
  const pool=EVENTS.filter(function(e){
    if(g.seenEv[e.n]) return false;
    if(e.stg!=='*' && e.stg!==stg) return false;
    if(e.block && hb(g,e.block)>0) return false;     /* 退了群就不會有人報明牌給你 */
    if(e.minAge && g.age<e.minAge) return false;
    if(e.minNav && n<e.minNav) return false;
    if(e.need_job && g.career!=='job') return false;
    return true;
  });
  if(!pool.length) return null;
  return pool[Math.floor(g.R()*pool.length)];
}

/* 你有什麼選項，取決於你養成了什麼習慣 */
function evOpts(g,e){
  const out=[];
  e.o.forEach(function(o,i){
    if(o.need && !(hb(g,o.need)>0)) return;
    out.push({i:i, t:o.t, gamble:o.p!=null, need:o.need||null});
  });
  return out;
}
function event(g){
  const e=g.pendEv;
  if(!e || g.phase!=='event') return null;
  return {n:e.n, d:e.d, opts:evOpts(g,e)};
}
function answerEvent(g,i){
  const e=g.pendEv;
  if(!e || g.phase!=='event') return null;
  const o=e.o[i];
  if(!o) return null;
  if(o.need && !(hb(g,o.need)>0)) return null;
  const ok = o.p==null ? true : (g.R()*100 < o.p);
  const fx = ok ? o.g : (o.b||o.g);
  const text = ok ? o.gt : (o.bt||o.gt);
  const eff = applyFx(g,fx, o.p==null);   /* 不擲骰的＝生活現金流，對照組跟著付 */
  if(ok && o.fame) g.fame++;
  if(!ok && o.honor) g.honors.push(o.honor);
  g.seenEv[e.n]=1;
  g.pendEv=null;
  g.phase='act';
  const row={year:g.year, age:g.age, card:e.n, opt:o.t, ok:ok, text:text, eff:eff, gamble:o.p!=null};
  g.evLog.push(row);
  return row;
}

function curDie(g){ const d=g.dice[g.dieAt]; return d==null?3:d; }
/* 執行滑價：擲得低就是拖到比較差的價位才動手，擲得高就是說到做到。
   這是散戶最真實的一種隨機——你決定要買，然後拖了三個月。 */
function slip(die){ return die<=2 ? 0.020 : die<=4 ? 0.006 : -0.004; }

/* ================= 拍子 =================
   moves() 是完整的合法空間——模擬器要靠它跑遍所有路徑。
   但直接把它攤在畫面上，實測平均一次 42 個選項、最多 58 個。那是報表，不是人生。

   借野球模擬器的節奏：一次一個問題、2～4 個選項，而且每個選項都是
   那個處境裡你真的能做的事。這條規矩本來就寫在事件卡的註解裡，
   只是部位系統沒照做——沒有「保守／照常／全力」這種難度旋鈕。

   加一種處境＝往 BEATS 加一列，核心不動。順序就是優先序：
   帳上那筆賺了六成的部位，比「今年要不要開始運動」更該先問你。 */
function held(g){
  return Object.keys(g.book).map(function(id){
    const b=g.book[id];
    return {id:id, n:BY_ID[id].n, val:b.sh*g.price[id], pl:(g.price[id]/b.cost-1)*100};
  }).sort(function(a,b){ return b.val-a.val; });
}
function pctText(v){ return (v>=0?'賺了 ':'跌掉 ')+Math.abs(Math.round(v))+'%'; }

/* 副標一律講「這顆骰子在這個選項上會變成什麼」——
   骰子看得到卻不知道它做什麼，跟沒有骰子是一樣的。

   每一句都掛上那顆骰的點數面，跟題目上面那顆大骰對得起來。
   不然畫面上的「準確率 62%」「進帳 3.2 萬」看起來都像固定值，
   玩家沒有對照組，看不出它其實是這顆骰子給的。 */
const DIEC=['','⚀','⚁','⚂','⚃','⚄','⚅'];
function dieFace(die){ return (DIEC[die]||'')+' '; }
/* 三段都要有話講。原本 3～4 點回空字串——那是六面裡的兩面，
   三分之一的機率讓畫面看起來像「這顆骰子沒有作用」，
   但 +0.6% 的滑價是真的在扣你的錢。 */
function slipNote(die){
  /* 分段要照點數走，不能照滑價的數值走：3～4 點的 +0.6% 也 >0.5，
     用數值判斷會把「普通」講成「低」，那比不印還糟——畫面在說謊。 */
  const v=(slip(die)*100).toFixed(1);
  return '　'+dieFace(die)+(
      die<=2 ? '這顆低，你會拖到比較差的價位（+'+v+'%）'
    : die<=4 ? '這顆普通，價位小虧一點（+'+v+'%）'
    :          '這顆高，說到做到，價位還不錯（'+v+'%）');
}
const BEATS=[
  /* 停利：帳面很好看的時候，賣不賣得下手 */
  {id:'take', ask:1, pick:function(g){
    const h=held(g).filter(function(x){ return x.pl>=45; })[0];
    if(!h) return null;
    return {q:h.n+'已經幫你'+pctText(h.pl)+'。你每天打開軟體第一個看的就是它。',
      opts:[
        {t:'賣一半，先把本金抽回來', s:'剩下的讓它跑'+slipNote(curDie(g)), mv:'sell:'+h.id, arg:{frac:0.5}},
        {t:'全部落袋', s:'證交稅 0.3%，但你不會再看它了'+slipNote(curDie(g)), mv:'sell:'+h.id, arg:{frac:1}},
        {t:'一張都不賣', s:'會賺的部位不該賣——你是這樣告訴自己的', skip:1}
      ]};
  }},
  /* 停損：套牢的時候，攤平還是認錯 */
  {id:'cut', ask:1, pick:function(g){
    const h=held(g).filter(function(x){ return x.pl<=-28; })[0];
    if(!h) return null;
    const can=investable(g)>MIN_TRADE;
    const o=[{t:'認賠出場', s:'實現虧損，這筆帳就結了'+slipNote(curDie(g)), mv:'sell:'+h.id, arg:{frac:1}}];
    if(can) o.push({t:'往下攤平', s:'成本會被拉低，前提是它真的會回來'+slipNote(curDie(g)),
                    mv:'buy:'+h.id, arg:{frac:0.6}});
    o.push({t:'放著不管', s:'沒賣就不算賠', skip:1});
    return {q:h.n+'已經'+pctText(h.pl)+'。你打開對帳單的次數變少了。', opts:o};
  }},
  /* 去年的題材 ----
     KERNEL.md 說這是新骨架最主要的張力來源：「你手上很可能還抱著去年的航運」。
     但一直沒有人問你這件事——停利要 +45%、停損要 −28%，
     泡沫剛破、還沒破到停損線的那一段，正好掉在兩張網子中間，
     而那才是這件事最難受的地方：它還沒爛到讓你死心。 */
  {id:'stale', ask:1, pick:function(g){
    const prev=g.year>0?g.hots[g.year-1]:null;
    if(!prev || prev===g.hots[g.year]) return null;
    const h=held(g).filter(function(x){ return x.id==='th_'+prev; })[0];
    if(!h) return null;
    const die=curDie(g);
    return {q:prev+'概念股是去年的題材，今年沒有人在講了。它現在'+pctText(h.pl)+'。',
      opts:[
        {t:'認了，全部賣掉', s:'換回現金，這筆帳就結了'+slipNote(die), mv:'sell:'+h.id, arg:{frac:1}},
        {t:'賣一半，留一點', s:'萬一它真的回來，你還在車上'+slipNote(die), mv:'sell:'+h.id, arg:{frac:0.5}},
        {t:'再等等，它會回來', s:'去年這個時候，它讓你賺了很多', skip:1}
      ]};
  }},
  /* 維持率吃緊 ----
     融資本來是一條單行道：借得到，還不掉，只能等斷頭。
     加了 repay 之後它才是一個處境——你有機會活下來，但要付代價。 */
  {id:'call', ask:1, pick:function(g){
    if(g.debt<=0) return null;
    const cover=assets(g)/g.debt*100;
    if(cover>=185) return null;
    const o=[];
    if(g.cash>MIN_TRADE)
      o.push({t:'用現金還掉一部分', s:'維持率直接拉高——這是唯一真的有用的動作。跟骰子無關', mv:'repay'});
    const h=held(g)[0];
    if(h) o.push({t:'賣掉'+h.n+'，先把錢換回來', s:'賣了還不會降維持率，但下一步才還得了錢'+slipNote(curDie(g)),
                  mv:'sell:'+h.id, arg:{frac:1}});
    o.push({t:'撐著，它會回來', s:'跌破 130% 就是強制平倉，一次結清', skip:1, warn:1});
    return {q:'維持率 '+cover.toFixed(0)+'%。券商的簡訊今天發了第二封。', opts:o};
  }},
  /* 生活：撐不住的時候 */
  {id:'life', pick:function(g){
    if(g.life>=42) return null;
    return {q:'你已經很久沒有好好睡過。家裡那幾通電話你都沒回。',
      opts:[
        {t:'停一下，把生活過回來', s:dieFace(curDie(g))+'生活 +'+(3+curDie(g)*2)+
             '（點數 ×2，這顆越高休得越徹底）', mv:'life'},
        {t:'撐過去就好', s:'什麼都不做', skip:1}
      ]};
  }},
  /* 錢放哪裡 ----
     不攤十三檔，但這三個必須撐開整條風險光譜：進攻、中庸、防守。
     原本只給「今年的題材」和「一檔穩的」，等於把十三檔塌成兩檔——
     讀出「崩盤要來了」也無處可去，訊號牌因此白讀。
     實測那版連貝氏滿分的玩家都輸對照組 31.5%：他多數年份只能選擇空手。 */
  {id:'put', ask:1, pick:function(g){
    const inv=investable(g);
    if(inv<=MIN_TRADE) return null;
    const hot='th_'+g.hotGuess, hs=held(g);
    const die=curDie(g), o=[];
    o.push({t:'買'+g.hotGuess+'概念股', s:'現在誰都在講這個。上車要快，下車更要快'+slipNote(die),
            mv:'buy:'+hot, arg:{frac:0.6}});
    o.push({t:'買市值型 ETF', s:'跟著大盤走，無聊——這是它最大的優點'+slipNote(die),
            mv:'buy:wide', arg:{frac:1}});
    /* 防守端：手上已經有東西就退到債券，什麼都沒有就先進高股息 */
    const def = hs.length ? 'bond' : 'div';
    o.push({t:'買'+BY_ID[def].n,
            s:(def==='bond'?'跟大盤幾乎不連動。指數垮的時候它不太動'
                           :'每季配息，漲得慢，但錢會一直進來')+slipNote(die),
            mv:'buy:'+def, arg:{frac:1}});
    /* 融資不是常駐按鈕。只有在你正得意的時候它才會自己冒出來——那才是它真正的樣子。
       沒得意的年份，那一格讓給「加碼已經有的部位」。 */
    if(g.tilt>=70 && g.debt<=0)
      o.push({t:'融資追'+g.hotGuess, s:'借淨值六成。維持率跌破 130% 就是斷頭。跟骰子無關',
              mv:'margin:'+hot, warn:1});
    else if(hs.length && hs[0].id!==hot)
      o.push({t:'加碼'+hs[0].n, s:'已經有的部位再壓上去'+slipNote(die),
              mv:'buy:'+hs[0].id, arg:{frac:0.6}});
    o.push({t:'先放著', s:'現金一年 1.5%，以及一整年的「早知道」', skip:1});
    return {q:'帳上有 '+inv.toFixed(0)+' 萬。今年市場在講的是'+g.hotGuess+'。', opts:o};
  }},
  /* 習慣：只問「要不要開一個新的」。
     維持既有的habit不問——那不是決定，那是照做，autoTick 會寫成敘述跑掉。
     開一個新的才是決定：槽位永遠不夠，開了這個就等於放棄那個。 */
  {id:'habit', ask:1, pick:function(g){
    const act=Object.keys(g.habits);
    if(act.length>=slotsAt(g.age)) return null;
    /* 候選照方針排序——方針決定「先想到什麼」，但選的人還是你 */
    const plan=PLANS[g.plan]||PLANS.craft;
    const cand=plan.pr.filter(function(k){ return HABITS[k] && !g.habits[k]; }).slice(0,3);
    if(!cand.length) return null;
    /* 習慣是骰子影響最大的一格——≥5 點一年抵兩年，等於半個習慣白送。
       而副標原本只寫效果，一個字都沒提骰子，玩家因此看不出
       「今年開這個特別划算」。這是骰子最不明顯的一次，也是最大的一次。 */
    const die=curDie(g);
    const note='　'+dieFace(die)+(die>=5 ? '這顆高，今年抵兩年（進度 +2）'
                                        : '這顆普通，一年算一年（進度 +1）');
    const o=cand.map(function(k){ return {t:'開始'+HABITS[k].n, s:HABITS[k].fx+note, mv:'habit:'+k}; });
    o.push({t:'今年不開新的', s:'槽位留著。你也不確定自己撐不撐得住', skip:1});
    return {q:'還有一個槽位空著（'+act.length+'／'+slotsAt(g.age)+'）。要固定做點什麼嗎？', opts:o};
  }},
  /* 研究：手上有東西才問 */
  {id:'scout', pick:function(g){
    const h=held(g).filter(function(x){ return g.scouted[x.id]==null; })[0];
    if(!h) return null;
    return {q:'要不要花幾個晚上，把'+h.n+'的財報從頭讀一遍？',
      opts:[
        {t:'讀', s:dieFace(curDie(g))+'換一個「它今年會不會贏大盤」的判斷，準確率 '+
             Math.round(44+curDie(g)*6+18*hb(g,'read'))+'%（點數 ×6）', mv:'scout:'+h.id},
        {t:'算了', s:'', skip:1}
      ]};
  }},
  /* 缺錢就加班 */
  {id:'work', pick:function(g){
    if(g.cash>30 || g.career==='pro') return null;
    return {q:'有人問你要不要接個案子。',
      opts:[
        {t:'接', s:dieFace(curDie(g))+'進帳 '+((0.6+g.year*0.09)*curDie(g)).toFixed(1)+
             ' 萬（每點 '+(0.6+g.year*0.09).toFixed(1)+' 萬），但生活 −7', mv:'work'},
        {t:'不接', s:'', skip:1}
      ]};
  }}
];

/* 回傳一個問題，或 null（沒什麼好問了）。
   每個選項都先對 moves() 驗過——列出來卻做不動的按鈕，在畫面上就是按了沒反應。 */
/* ---- 方針 ----
   野球模擬器一個球季問你一兩次，不是六次。差別不在選項多寡，在於
   「不需要你決定的事」根本不該停下來問。習慣、研究、生活、加班全部
   照你開局選的方針自動跑完並寫成敘述；只有錢的處境（停利、停損、
   錢放哪裡、融資）才會打斷你。實測每年因此只問 1～2 次。 */
const PLANS={
  craft:{n:'把功夫練起來', d:'讀財報、寫日誌、停損寫在紙上',
         pr:['read','log','stop','close','cash','gym','family','dca']},
  safe: {n:'穩穩來就好',   d:'停損、留現金、只在收盤後下單',
         pr:['stop','cash','close','dca','gym','family','log','read']},
  life: {n:'先把日子過好', d:'運動、跟家人對帳，錢的事情自動化',
         pr:['gym','family','dca','cash','stop','log','read','close']}
};
const PLAN_K=Object.keys(PLANS);

/* 旁白的變體。同一句話連印三年，玩家看到的不是人生，是複讀機——
   實測十六歲那年「有人找你接案子，你接了」連印三次。

   索引用年份與連續年數算出來，不擲骰：擲了會偏移種子流，
   模擬器與頁面就對不起來，而這只是換句話說，不該花掉一顆亂數。 */
function vary(list,n){ return list[((n%list.length)+list.length)%list.length]; }
const SAY={
  life:[
    '你停下來喘了一口氣，把日子過回來一些。',
    '你關掉通知，睡了兩天飽覺。醒來的時候盤早就收了。',
    '你回了一趟家，什麼都沒講，只是好好吃了頓飯。',
    '你把週末空出來。沒做什麼，就是沒有看盤。'
  ],
  keep:[
    '你照著做了：{n}，第 {k} 年。',
    '{n}——今年也沒有斷，第 {k} 年了。',
    '沒有特別想，時間到了就去做{n}。第 {k} 年。',
    '{n}這件事你已經不用提醒自己，第 {k} 年。'
  ],
  big:[
    '這一年你是真的在{n}——一年抵兩年。',
    '{n}這件事，今年你做得比哪一年都認真，一年抵兩年。',
    '不知道為什麼，今年特別做得下去。{n}，一年抵兩年。'
  ],
  lock:[
    '　現在它已經是你的一部分，不用再花力氣。',
    '　它不再需要你想起它了。',
    '　從今以後這件事會自己發生。'
  ],
  scout:[
    '你翻了{n}的財報，覺得它今年{v}贏大盤。（這個判斷的準確率 {a}%）',
    '你把{n}的財報從頭讀到尾，結論是它今年{v}贏大盤。（準確率 {a}%）',
    '幾個晚上下來，{n}你大概看懂了：今年{v}贏大盤。（準確率 {a}%）'
  ],
  work:[
    '有人找你接案子，你接了。進帳 {m} 萬，人也累了。',
    '你接了個案子，做到半夜。{m} 萬入帳，隔天整天沒精神。',
    '週末拿去接案。錢有了 {m} 萬，睡眠沒了。'
  ]
};
function fill(s,o){ return s.replace(/\{(\w)\}/g, function(_,k){ return o[k]; }); }

/* 自動跑掉一個不需要問的處境，回傳一句敘述（沒有可跑的就回 null）。
   頁面重複呼叫到 null 為止，再開始問問題。

   一年一次的閘門是必要的：沒有它，「加班」會把整年的行動點吃光，
   而且會用一模一樣的句子印三次。 */
function autoTick(g){
  if(g.phase!=='act' || g.apLeft<=0) return null;
  const legal={}; moves(g).forEach(function(m){ legal[m.id]=1; });
  const plan=PLANS[g.plan]||PLANS.craft;
  const done=g.autoDone||(g.autoDone={});
  /* 生活撐不住優先；再來照方針餵既有的習慣；然後研究；真的沒事做才加班 */
  if(g.life<48 && legal['life'] && !done.life){
    done.life=1;
    const r=play(g,'life');
    if(r) return vary(SAY.life, g.year+g.age);
  }
  for(let i=0;i<plan.pr.length;i++){
    const k=plan.pr[i];
    /* 只餵已經有的。開一個新習慣是決定，不是照做——那一題留給玩家 */
    if(!g.habits[k] || g.habits[k].fed===g.year) continue;
    if(!legal['habit:'+k]) continue;
    const r=play(g,'habit:'+k);
    if(!r) continue;
    const st=g.habits[k]?g.habits[k].streak:0;
    const base = r.gain>1 ? fill(vary(SAY.big, g.year+i), {n:HABITS[k].n})
                          : fill(vary(SAY.keep, g.year+st), {n:HABITS[k].n, k:st});
    return base + (r.stage>=3 ? vary(SAY.lock, g.year) : '');
  }
  const hs=held(g).filter(function(x){ return g.scouted[x.id]==null; })[0];
  if(hs && legal['scout:'+hs.id]){
    const r=play(g,'scout:'+hs.id);
    if(r) return fill(vary(SAY.scout, g.year+hs.n.length),
                      {n:hs.n, v:(r.beatsMarket?'會':'不會'), a:r.acc});
  }
  if(g.cash<10 && legal['work'] && !done.work){
    done.work=1;
    const r=play(g,'work');
    if(r) return fill(vary(SAY.work, g.year+g.age), {m:r.earned.toFixed(1)});
  }
  return null;
}

function beat(g){
  if(g.phase!=='act' || g.apLeft<=0) return null;
  const legal={}; moves(g).forEach(function(m){ legal[m.id]=1; });
  /* 光看 moves() 不夠：它驗的是「這檔買得動嗎」，
     但選項用的是六成、一半。可投入 0.8 萬時六成只有 0.48 萬，成交不了——
     那顆按鈕在畫面上就是按了沒反應。所以連金額一起驗。 */
  const doable=function(o){
    if(o.skip) return true;
    if(!legal[o.mv]) return false;
    const cut=o.mv.indexOf(':');
    const kind=cut<0?o.mv:o.mv.slice(0,cut), id=cut<0?null:o.mv.slice(cut+1);
    const f=(o.arg&&o.arg.frac!=null)?o.arg.frac:1;
    /* 用的必須是 play() 真正會成交的那個價——賣出走滑價後的價格，
       邊界上的部位用原始價驗會過、實際卻賣不掉。同一個錯犯第二次了。 */
    if(kind==='buy')  return investable(g)*f > MIN_TRADE;
    if(kind==='sell') return g.book[id] &&
      g.book[id].sh*g.price[id]*(1-slip(curDie(g)))*f > MIN_TRADE;
    return true;
  };
  for(let i=0;i<BEATS.length;i++){
    if(!BEATS[i].ask) continue;                      /* 不用問的，autoTick 處理掉了 */
    if(g.declined[BEATS[i].id]===g.year) continue;   /* 今年已經回絕過這個處境 */
    const b=BEATS[i].pick(g);
    if(!b) continue;
    const opts=b.opts.filter(doable);
    if(opts.length<2) continue;          /* 只剩一個選項就不是選擇了 */
    return {id:BEATS[i].id, q:b.q, opts:opts, die:curDie(g), left:g.apLeft};
  }
  return null;
}
/* 回答一個處境：做完就把它標成今年問過了。
   否則「錢放哪裡」買了六成還剩現金，同一年就會再問你一次、再一次——
   實測一年被問 2.68 次，其中大半是同一個問題重播。
   一年一個處境只該問一次。 */
function answer(g,beatId,mv,arg){
  const r=play(g,mv,arg);
  if(r && beatId) g.declined[beatId]=g.year;
  return r;
}
/* 選了「不做」——不花行動點，只是今年不再問這件事。
   原本「不做」跟「做」一樣貴，結果高優先序的問題會把行動點吃光：
   一年被問了四次停利停損、全部婉拒，錢就再也投不進去。
   實測「永遠買市值型、抱住不賣」因此從 −0.8% 掉到 −14.9%——
   那不是玩家的選擇造成的，是問題的順序造成的。
   行動點的意思是「今年真的做成了幾件事」，不是「被問了幾次」。 */
function pass(g,beatId){
  if(g.phase!=='act') return false;
  if(beatId) g.declined[beatId]=g.year;
  return true;
}
function skipRest(g){ if(g.phase==='act'){ g.apLeft=0; g.dieAt=g.dice.length; return true; } return false; }

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
  /* 安全網：呼叫端沒有處理今年那張卡就直接結算。不套用任何後果，
     也不標記成看過——那張卡以後還會再遇到。寧可讓它重來，也不要靜靜地卡在 'event'。 */
  if(g.pendEv){ g.pendEv=null; g.phase='act'; }
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
    event:function(){ return event(g); },
    answerEvent:function(i){ return answerEvent(g,i); },
    moves:function(){ return moves(g); },
    play:function(id,arg){ return play(g,id,arg); },
    beat:function(){ return beat(g); },
    pass:function(id){ return pass(g,id); },
    answer:function(id,mv,arg){ return answer(g,id,mv,arg); },
    skipRest:function(){ return skipRest(g); },
    midWindow:function(){ return midWindow(g); },
    playMid:function(c){ return playMid(g,c); },
    closeYear:function(){ return closeYear(g); },
    career:function(w){ return careerChoice(g,w); },
    setPlan:function(k){ if(PLANS[k]) g.plan=k; return g.plan; },
    autoTick:function(){ return autoTick(g); }
  };
}

/* 頁面用這個數字確認自己拿到的不是快取裡的舊內核。
   改了對外介面就 +1，並同步改 play.html 的 ?v= 與 NEED_VERSION。 */
const VERSION=9;

return {newGame:newGame, VERSION:VERSION, EVENTS:EVENTS, slip:slip, SIG_FLOOR:SIG_FLOOR, INST:INST, BY_ID:BY_ID, HABITS:HABITS, SIGNALS:SIGNALS,
        THEMES:THEMES, REGIME:REGIME, ENDINGS:ENDINGS, TOTAL:TOTAL,
        BEATS:BEATS, PLANS:PLANS, PLAN_K:PLAN_K, on:on, fold:fold, hb:hb, slotsAt:slotsAt, nav:nav};
});
