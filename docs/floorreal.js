/* أهمّ اختبار في هذه الجولة: هل تتراكب بلاطة على أخرى؟
   بالإحداثيات الحقيقية من قاعدة البيانات، في السمتين، بالطول وبالعرض،
   وفي وضعَي المخطّط والشبكة. التراكب يُقاس بتقاطع المستطيلات فعلياً — لا
   بالنظر. ويُقاس معه: نصٌّ مقطوع، وأهداف لمس، وتباين. */
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
       '\nreturn {S:S, FLR:FLR, flrPaint:flrPaint, viewFloor:viewFloor, flrFit:flrFit};\n})();\n');
if(!/window.__app/.test(js)) throw new Error('unwrap failed');

const page=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
<body class="floormode"><div id="app"><div class="wrap" id="view"></div>
<nav class="bottom"><button data-t="floor" class="on">الصالة</button></nav></div>
<div id="toast"></div>
<scr`+`ipt>${js.replace(/<\/script>/g,'<\\/script>')}</scr`+`ipt>
<scr`+`ipt>window.__ready=true;</scr`+`ipt></body></html>`;
fs.writeFileSync(__dirname+'/floorreal.html', page);

/* الإحداثيات الحقيقية — منسوخة من rko_cafe_tables */
const A1=[[1,15,22,'booth',6,'ordered'],[2,16,43,'booth',6,'cleaning'],[3,15,66,'booth',6,'needs_clean'],
[4,42,91,'standalone',4,'free'],[5,58,91,'standalone',4,'free'],[6,69,91,'high',5,'free'],
[7,92,79,'curved',4,'free'],[8,92,53,'curved',4,'free'],[9,93,28,'curved',4,'free'],
[10,69,26,'standalone',4,'seated'],[11,69,55,'standalone',6,'seated'],[12,46,55,'standalone',4,'free'],
[13,44,25,'standalone',4,'free'],[14,34,52,'standalone',4,'free'],[15,34,28,'two_seat',2,'free']];
const A2=[[1,10,30],[2,22,15],[3,34,30],[4,46,15],[5,58,30],[6,70,15],[7,81,24],[8,79,46],
[9,79,60],[10,79,74],[11,82,39],[12,38,92]];
const mk=(rows,base)=>rows.map((r,i)=>({
  id:base+i, no:r[0], x:r[1], y:r[2], type:r[3]||'standalone', seats:r[4]||4,
  state:r[5]||'free', version:1, mins:(r[5]&&r[5]!=='free')?12+i*7:0,
  guests:(r[5]&&r[5]!=='free')?3:null, overdue:(i===2), long_stay:false, since_seen:5,
  oos:false, owner:null, group_id:null, session_id:null,
  next:['seated','ordered','preparing','ready','served','bill_requested','needs_clean','cleaning','free']
}));
const AREAS=[{id:1,name:'الصالة الداخلية',allowed:true,scope:'full',total:15,busy:5,open:{open:true}},
             {id:2,name:'الساحة الخارجية',allowed:true,scope:'full',total:12,busy:0,open:{open:true}}];
const TABLES={1:mk(A1,1), 2:mk(A2,16)};

const VPS=[['طول 360',360,740],['طول 390',390,844],['عرض 740',740,360],['عرض 844',844,390],['عرض 932',932,430]];

(async()=>{
  const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const rep=[];
  for(const theme of ['light','dark'])
  for(const [vn,W,H] of VPS)
  for(const area of [1,2])
  for(const view of ['map','grid']){
    const p=await br.newPage({viewport:{width:W,height:H},colorScheme:theme});
    const errs=[]; p.on('pageerror',e=>errs.push(e.message));
    await p.goto('file://'+__dirname+'/floorreal.html');
    await p.waitForFunction('window.__ready===true',{timeout:15000});
    const r=await p.evaluate(async(a)=>{
      const [MEAS,TABLES,AREAS,area,view]=a;
      const app=window.__app;
      app.S.role='staff'; app.S.tab='floor'; app.S.me={id:1,name:'هبة'};
      app.S.state={attendance:{'in':new Date(Date.now()-3*3600e3).toISOString()},
        shift:{name:'مسائي',area:'الصالة',area_id:1,
          start:new Date(Date.now()-3*3600e3).toISOString(),
          end:new Date(Date.now()+5*3600e3).toISOString()}};
      document.getElementById('view').innerHTML=app.viewFloor();
      app.FLR.areas=AREAS; app.FLR.area=area; app.FLR.sel=null; app.FLR.st=null;
      app.FLR.q=''; app.FLR.view=view;
      app.FLR.data={ok:true, area:AREAS[area-1], tables:TABLES[area], open:{open:true},
        scope:'full', duty_tables:[], can_edit:true,
        server_now:new Date().toISOString(), groups:[], alerts:[], counts:{}};
      app.flrPaint();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      app.flrFit();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      eval(MEAS);

      const sel = view==='grid' ? '.flrg-t' : '.flr-t';
      const tiles=[...document.querySelectorAll(sel)];
      const R=tiles.map(t=>({el:t, r:t.getBoundingClientRect(),
        no:(t.querySelector('.n,.no')||{}).textContent}));
      // تقاطع مستطيلات فعلي
      const overlaps=[];
      for(let i=0;i<R.length;i++) for(let j=i+1;j<R.length;j++){
        const a=R[i].r,b=R[j].r;
        const ox=Math.min(a.right,b.right)-Math.max(a.left,b.left);
        const oy=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
        if(ox>1 && oy>1) overlaps.push(R[i].no+'×'+R[j].no+' ('+Math.round(ox)+'×'+Math.round(oy)+')');
      }
      // نصّ مقطوع
      const clipped=[];
      tiles.forEach(t=>t.querySelectorAll('.n,.s,.no,.st,.mt').forEach(e=>{
        if(e.scrollWidth>e.clientWidth+1 || e.scrollHeight>e.clientHeight+1)
          clipped.push((t.querySelector('.n,.no')||{}).textContent+':'+e.className);
      }));
      // خارج حدود اللوح
      const bd=document.querySelector('.flr-board');
      const outside=[];
      if(bd){ const br2=bd.getBoundingClientRect();
        R.forEach(x=>{ if(x.r.left<br2.left-2||x.r.right>br2.right+2||
                          x.r.top<br2.top-2||x.r.bottom>br2.bottom+2) outside.push(x.no); }); }
      const small=tiles.filter(t=>{const q=t.getBoundingClientRect();
        return q.width<38||q.height<38;}).length;
      const hscroll=document.documentElement.scrollWidth>document.documentElement.clientWidth+1;
      const texts=[];
      document.querySelectorAll('#view *').forEach(el=>{
        if(el.children.length===0 && (el.textContent||'').trim()){
          const cs=getComputedStyle(el);
          if(cs.visibility==='hidden'||cs.display==='none') return;
          const size=parseFloat(cs.fontSize), w=cs.fontWeight;
          texts.push({txt:el.textContent.trim().slice(0,20), size, color:cs.color,
            bgs:bgOf(el), need:(size>=24||(size>=18.66&&+w>=700))?3:4.5});
        }
      });
      const tsz=bd?getComputedStyle(bd).getPropertyValue('--tsz').trim():'—';
      return {tiles:tiles.length, overlaps, clipped:[...new Set(clipped)], outside,
              small, hscroll, texts, tsz, tight:bd?bd.hasAttribute('data-tight'):false};
    },[MEAS,TABLES,AREAS,area,view]);

    const rgb=s=>{const t=String(s);
      const n=(t.match(/-?[\d.]+(?:e-?\d+)?/g)||[]).slice(0,3).map(Number);
      const k=/^color\(/i.test(t.trim())?255:1;
      return n.map(v=>Math.max(0,Math.min(255,v*k)));};
    const fails=[];
    r.texts.forEach(t=>{const lf=lum(...rgb(t.color));
      const worst=Math.min(...t.bgs.map(b=>{const lb=lum(...rgb(b));
        return (Math.max(lf,lb)+0.05)/(Math.min(lf,lb)+0.05);}));
      if(worst<t.need) fails.push(t.txt+' '+worst.toFixed(2)+'<'+t.need);});
    rep.push({theme,vn,area,view,fails,errs,r});
    await p.close();
  }
  let bad=0;
  rep.forEach(o=>{
    const f=(o.r.overlaps.length||o.r.clipped.length||o.r.outside.length||o.r.small||
             o.r.hscroll||o.fails.length||o.errs.length);
    if(f) bad++;
    console.log((o.theme+' '+o.vn+' م'+o.area+' '+o.view).padEnd(30),
      'بلاطات:'+String(o.r.tiles).padStart(2),
      'تراكب:'+String(o.r.overlaps.length).padStart(2),
      'مقطوع:'+String(o.r.clipped.length).padStart(2),
      'خارج:'+o.r.outside.length,
      'صغير:'+o.r.small,
      'أفقي:'+(o.r.hscroll?'نعم':'لا'),
      'تباين:'+o.fails.length,
      (o.r.tsz?('ضلع:'+o.r.tsz):''), (o.r.tight?'[مزدحم]':''));
    if(o.r.overlaps.length) console.log('     تراكب:',o.r.overlaps.slice(0,6));
    if(o.r.clipped.length) console.log('     مقطوع:',o.r.clipped.slice(0,6));
    if(o.fails.length) console.log('     تباين:',o.fails.slice(0,4));
    if(o.errs.length) console.log('     أخطاء:',o.errs);
  });
  console.log('\nحالات بها ملاحظات:',bad,'من',rep.length);
  await br.close();
})();
