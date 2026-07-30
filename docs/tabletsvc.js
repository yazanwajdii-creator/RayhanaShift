/* شاشة الخدمة على مقاسات الأجهزة اللوحية المستعملة فعلاً في المطاعم،
   بالإضافة إلى الهواتف. يُقاس: تراكب البطاقات (تقاطع مستطيلات)، نصّ
   مقطوع، أهداف لمس، تمرير أفقي، تباين، وأعمدة الشبكة. */
const fs=require('fs');
const {chromium}=require('/opt/node22/lib/node_modules/playwright');
function lum(r,g,b){const f=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);};
  return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);}
const MEAS=fs.readFileSync(__dirname+'/newaudit.js','utf8')
  .match(/const parse=[\s\S]*?return bases\.map[^\n]*\n\s*\}/)[0];
const css=fs.readFileSync('/workspace/rayhanashift/app.css','utf8');
let js=fs.readFileSync('/workspace/rayhanashift/config.js','utf8')+'\n'+
       fs.readFileSync('/workspace/rayhanashift/app.js','utf8');
js=js.replace('(function(){\n"use strict";','window.__app = (function(){\n"use strict";')
     .replace(/\nboot\(\);\n\}\)\(\);\n?$/,
       '\nreturn {S:S, FLR:FLR, flrPaint:flrPaint, viewFloor:viewFloor};\n})();\n');
const page=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
<body class="floormode"><div id="app"><div class="wrap" id="view"></div>
<nav class="bottom"><button data-t="floor" class="on">الصالة</button></nav></div>
<div id="toast"></div>
<scr`+`ipt>${js.replace(/<\/script>/g,'<\\/script>')}</scr`+`ipt>
<scr`+`ipt>window.__ready=true;</scr`+`ipt></body></html>`;
fs.writeFileSync(__dirname+'/svc.html', page);

const ST=['ordered','cleaning','needs_clean','free','free','free','free','free','free',
          'seated','seated','free','free','free','free','bill_requested','ready','served',
          'free','free','preparing','free','reserved','free','free','free','free'];
const TABLES=Array.from({length:27},(_,i)=>({
  id:i+1, no:i+1, state:ST[i]||'free', version:1,
  mins:(ST[i]&&ST[i]!=='free')?7+i*4:0, guests:(ST[i]&&ST[i]!=='free')?(2+i%5):null,
  overdue:(i===2||i===16), long_stay:false, since_seen:5,
  oos:(i===22), oos_reason:(i===22?'كرسي مكسور':null),
  owner:(i<6?'سدره':(i<12?'ليان':null)),
  next:['seated','ordered','preparing','ready','served','bill_requested','needs_clean','cleaning','free']
}));
const AREAS=[{id:1,name:'الصالة الداخلية',allowed:true,scope:'full',total:15,busy:5,open:{open:true}},
             {id:2,name:'الساحة الخارجية',allowed:true,scope:'full',total:12,busy:2,open:{open:true}}];

/* مقاسات الأجهزة المستعملة فعلاً في الخدمة + الهواتف */
const VPS=[
  ['iPad 10.2 عرضاً',1080,810],['iPad 10.9 عرضاً',1180,820],
  ['iPad طولاً',810,1080],['لوحي أندرويد',1280,800],
  ['هاتف كبير',430,932],['هاتف',390,844],['هاتف صغير',360,740]];

(async()=>{
  const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const rep=[];
  for(const theme of ['light','dark'])
  for(const [vn,W,H] of VPS)
  for(const selId of [null,3])
  for(const f of ['all','need']){
    const p=await br.newPage({viewport:{width:W,height:H},colorScheme:theme});
    const errs=[]; p.on('pageerror',e=>errs.push(e.message));
    await p.goto('file://'+__dirname+'/svc.html');
    await p.waitForFunction('window.__ready===true',{timeout:15000});
    const r=await p.evaluate(async(a)=>{
      const [MEAS,TABLES,AREAS,selId,f]=a; const app=window.__app;
      app.S.role='staff'; app.S.tab='floor'; app.S.me={id:2,name:'سدره'};
      app.S.state={attendance:{'in':new Date(Date.now()-3*3600e3).toISOString()},
        shift:{name:'مسائي',area:'الصالة',area_id:1,
          start:new Date(Date.now()-3*3600e3).toISOString(),
          end:new Date(Date.now()+5*3600e3).toISOString()}};
      document.getElementById('view').innerHTML=app.viewFloor();
      app.FLR.areas=AREAS; app.FLR.area=1; app.FLR.sel=selId; app.FLR.f=f;
      app.FLR.data={ok:true,area:AREAS[0],tables:TABLES,open:{open:true},
        scope:'full',duty_tables:[1,2,3,4,5,6],can_edit:true,
        server_now:new Date().toISOString(),groups:[],alerts:[],counts:{}};
      app.flrPaint();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      eval(MEAS);
      const cards=[...document.querySelectorAll('.flrc')];
      const R=cards.map(c=>({r:c.getBoundingClientRect(),
        no:(c.querySelector('.flrc-no')||{}).textContent}));
      const overlaps=[];
      for(let i=0;i<R.length;i++) for(let j=i+1;j<R.length;j++){
        const a1=R[i].r,b1=R[j].r;
        const ox=Math.min(a1.right,b1.right)-Math.max(a1.left,b1.left);
        const oy=Math.min(a1.bottom,b1.bottom)-Math.max(a1.top,b1.top);
        if(ox>1&&oy>1) overlaps.push(R[i].no+'×'+R[j].no);
      }
      const clipped=[];
      document.querySelectorAll('.flrc-no,.flrc-st,.flrc-f .t,.flrx-seg button,.flrx-f button,.flr-sel-t b,.flr-sel-t span')
        .forEach(e=>{ if(e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1)
          clipped.push(e.className+':'+e.textContent.trim().slice(0,14)); });
      const small=[...document.querySelectorAll('button')].filter(b=>{
        const q=b.getBoundingClientRect(); return q.width>0&&(q.width<44||q.height<44);
      }).map(b=>(b.className||b.tagName)+' '+Math.round(b.getBoundingClientRect().width)+'x'+
        Math.round(b.getBoundingClientRect().height));
      const hscroll=document.documentElement.scrollWidth>document.documentElement.clientWidth+1;
      // أعمدة الشبكة
      const g=document.querySelector('.flrx-grid');
      const cols=g?getComputedStyle(g).gridTemplateColumns.split(' ').length:0;
      const cw=cards.length?Math.round(cards[0].getBoundingClientRect().width):0;
      const texts=[];
      document.querySelectorAll('#view *').forEach(el=>{
        if(el.children.length===0&&(el.textContent||'').trim()){
          const cs=getComputedStyle(el);
          if(cs.visibility==='hidden'||cs.display==='none') return;
          const size=parseFloat(cs.fontSize), w=cs.fontWeight;
          texts.push({txt:el.textContent.trim().slice(0,18),size,color:cs.color,
            bgs:bgOf(el),need:(size>=24||(size>=18.66&&+w>=700))?3:4.5});
        }
      });
      return {cards:cards.length,overlaps,clipped:[...new Set(clipped)],
              small:[...new Set(small)],hscroll,cols,cw,texts,
              side:!!document.querySelector('.flr-sel')};
    },[MEAS,TABLES,AREAS,selId,f]);
    const rgb=s=>{const t=String(s);
      const n=(t.match(/-?[\d.]+(?:e-?\d+)?/g)||[]).slice(0,3).map(Number);
      const k=/^color\(/i.test(t.trim())?255:1;
      return n.map(v=>Math.max(0,Math.min(255,v*k)));};
    const fails=[];
    r.texts.forEach(t=>{const lf=lum(...rgb(t.color));
      const worst=Math.min(...t.bgs.map(b=>{const lb=lum(...rgb(b));
        return (Math.max(lf,lb)+0.05)/(Math.min(lf,lb)+0.05);}));
      if(worst<t.need) fails.push(t.txt+' '+worst.toFixed(2)+'<'+t.need);});
    rep.push({theme,vn,selId,f,fails,errs,r});
    await p.close();
  }
  let bad=0;
  rep.forEach(o=>{
    const x=(o.r.overlaps.length||o.r.clipped.length||o.r.small.length||o.r.hscroll||
             o.fails.length||o.errs.length);
    if(x) bad++;
    console.log((o.theme+' '+o.vn+' '+(o.selId?'محدّدة':'—')+' '+o.f).padEnd(38),
      'بطاقات:'+String(o.r.cards).padStart(2),'أعمدة:'+o.r.cols,'عرض:'+o.r.cw,
      '| تراكب:'+o.r.overlaps.length,'مقطوع:'+o.r.clipped.length,
      'صغير:'+o.r.small.length,'أفقي:'+(o.r.hscroll?'نعم':'لا'),'تباين:'+o.fails.length,
      'أخطاء:'+o.errs.length);
    if(o.r.clipped.length) console.log('     مقطوع:',o.r.clipped.slice(0,5));
    if(o.r.small.length) console.log('     صغير:',o.r.small.slice(0,5));
    if(o.fails.length) console.log('     تباين:',o.fails.slice(0,5));
    if(o.errs.length) console.log('     أخطاء:',o.errs.slice(0,3));
  });
  console.log('\nحالات بها ملاحظات:',bad,'من',rep.length);
  await br.close();
})();
