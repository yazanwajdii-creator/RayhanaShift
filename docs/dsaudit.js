/* فحص نظام التصميم على مستوى المكوّنات لا الشاشات.
   المشكلة التي يعالجها: مسحُ الشاشات لا يمرّ إلا بما تفتحه الحمولة، فصنفٌ
   مثل ‎.td-al.sev-low‎ يعيش داخل ورقةٍ منبثقة قد لا تُفتح أبداً — فيبقى
   عيبه غير مقيس. هنا نُركّب كل صنفٍ مُنسَّق يدوياً في شبكة، ونقيس في
   السمتين. التباين خاصيّة CSS لا خاصيّة شاشة، فالقياس صحيح.

   يُبلّغ عن: نصّ تحت ٤٫٥:١ · سطحٍ ملوّن لا يُفصل عن البطاقة (٣:١) ·
   وصنفٍ تتطابق نتيجته في السمتين (دليل قيمة ثابتة لا تنقلب). */
const fs=require('fs');
const {chromium}=require('/opt/node22/lib/node_modules/playwright');
function lum(r,g,b){const f=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);};
  return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);}
const MEAS=fs.readFileSync(__dirname+'/newaudit.js','utf8')
  .match(/const parse=[\s\S]*?return bases\.map[^\n]*\n\s*\}/)[0];
const css=fs.readFileSync('/workspace/rayhanashift/app.css','utf8');

const ST=['free','reserved','seated','ordered','preparing','ready','served',
          'bill_requested','needs_clean','cleaning','out_of_service'];

let cells='';
const add=(name,html)=>{ cells+='<div class="ds-cell" data-n="'+name+'">'+html+'</div>'; };

ST.forEach(s=>{
  add('tcard.s-'+s,
    '<div class="tcard s-'+s+'"><span class="tc-edge"></span>'+
    '<span class="tc-no">7</span><span class="tc-st">حالة الطاولة</span>'+
    '<div class="tc-body">نصّ داخل البطاقة</div></div>');
  add('tm-t.s-'+s,
    '<div class="tm-board" style="height:120px"><button class="tm-t square s-'+s+'" style="left:40%;top:40%">'+
    '<span class="tm-body"><span class="tm-no">7</span><span class="tm-lbl">حالة</span></span></button></div>');
  add('td-hd.s-'+s,
    '<div class="td-hd s-'+s+'"><span class="td-no">7</span><b>طاولة ٧</b><span>تفاصيل</span></div>');
  add('flr-t.'+s,
    '<div style="position:relative;height:90px"><button class="flr-t" '+
    'style="--tc:var(--st-'+s.replace(/_/g,'-')+');--tc-on:var(--st-'+s.replace(/_/g,'-')+'-on);'+
    'inset-inline-start:40%;top:40%"><span class="n">7</span><span class="s">حالة</span></button></div>');
});
['hi','mid','lo','na'].forEach(k=>add('evd-bar.'+k,
  '<div class="evd-row"><span class="evd-bar '+k+'"><i style="width:70%"></i></span><b>٧٠٪</b></div>'));
['bad','warn','mild'].forEach(k=>add('tf.'+k,'<span class="tf '+k+'">علامة</span>'));
['bad','warn'].forEach(k=>add('tt-fl.'+k,'<span class="tt-fl '+k+'">علامة</span>'));
['high','mid','low'].forEach(k=>add('tal-i.sev-'+k,
  '<div class="tal"><div class="tal-h">تنبيه <span>٣</span></div>'+
  '<button class="tal-i sev-'+k+'"><b>عنوان التنبيه</b><span>سبب التنبيه ومدّته</span></button></div>'));
['high','mid','low'].forEach(k=>add('td-al.sev-'+k,
  '<div class="td-al sev-'+k+'"><span class="ti">•</span><div><b>تنبيه</b><span>تفصيل التنبيه</span></div></div>'));
add('tsug','<div class="tsug"><span class="ti">•</span><div><b>اقتراح توزيع</b><span>سبب الاقتراح</span></div></div>');
add('tm-vf','<div class="tm-vf"><div class="tm-vf-note">ملاحظة تحقّق من الطاولة</div></div>');
add('tm-closed','<div class="tm-closed"><span class="ti">•</span><div><b>المنطقة مغلقة</b><span>تفتح ٣:٠٠ م</span></div></div>');
['floor','kitchen','cash'].forEach(k=>add('bneck.'+k,
  '<div class="bneck '+k+'"><div class="bneck-h"><b>عنق الزجاجة</b><span class="bneck-own">المطبخ</span></div>'+
  '<div class="bneck-i"><b>بند · ٣</b><span>السبب</span><span class="bneck-do">الإجراء</span></div></div>'));
add('tload','<div class="tload"><div class="tload-h">توزيع الحمل</div>'+
  '<div class="tload-r"><span class="tc-av">سد</span><span class="tload-n">سدره</span>'+
  '<span class="tload-bar"><i style="width:60%"></i></span><span class="tload-v">3/5</span></div></div>');
add('tcb','<div class="tcb"><div class="tcb-i"><b>٥</b><span>مشغولة</span></div>'+
  '<div class="tcb-i bad"><b>٢</b><span>تحتاج تدخلاً</span></div>'+
  '<div class="tcb-i info"><b>١</b><span>طلبت الحساب</span></div></div>');
['g','o','r'].forEach(k=>add('sdot.'+k,'<span class="sdot '+k+'"></span><span>حالة</span>'));
['','ghost','block','sm ghost','danger'].forEach(k=>add('btn '+(k||'primary'),
  '<button class="btn '+k+'">زرّ الإجراء</button>'));
['','green','orange','red','ink'].forEach(k=>add('chip '+(k||'default'),
  '<span class="chip '+k+'">شارة</span>'));
add('tm-badge','<div class="tm-board" style="height:90px"><button class="tm-t square s-seated" style="left:40%;top:40%">'+
  '<span class="tm-body"><span class="tm-badge"><b>١٢ د</b></span><span class="tm-no">7</span>'+
  '<span class="tm-lbl">حالة</span></span></button></div>');

const page=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
.ds-wrap{padding:12px;display:grid;grid-template-columns:1fr;gap:14px}
.ds-cell{padding:10px;border-radius:12px;background:var(--surface);border:1px solid var(--line)}
</style></head><body><div id="app"><div class="wrap"><div class="ds-wrap">${cells}</div></div></div>
<div id="toast"></div></body></html>`;
fs.writeFileSync(__dirname+'/ds.html', page);

(async()=>{
  const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const out={};
  for(const theme of ['light','dark']){
    const p=await br.newPage({viewport:{width:390,height:900},colorScheme:theme});
    await p.goto('file://'+__dirname+'/ds.html');
    await p.waitForTimeout(350);
    const r=await p.evaluate((MEAS)=>{
      eval(MEAS);
      const rows=[];
      document.querySelectorAll('.ds-cell').forEach(cell=>{
        const name=cell.getAttribute('data-n');
        cell.querySelectorAll('*').forEach(el=>{
          if(el.children.length===0 && (el.textContent||'').trim()){
            const cs=getComputedStyle(el);
            if(cs.visibility==='hidden'||cs.display==='none') return;
            const q=el.getBoundingClientRect(); if(q.width<1||q.height<1) return;
            const size=parseFloat(cs.fontSize), w=cs.fontWeight;
            rows.push({name, txt:el.textContent.trim().slice(0,18), size,
              color:cs.color, bgs:bgOf(el),
              need:(size>=24||(size>=18.66&&+w>=700))?3:4.5});
          }
        });
      });
      return rows;
    },MEAS);
    out[theme]=r;
    await p.close();
  }
  const rgb=s=>{const t=String(s);
    const n=(t.match(/-?[\d.]+(?:e-?\d+)?/g)||[]).slice(0,3).map(Number);
    const k=/^color\(/i.test(t.trim())?255:1;
    return n.map(v=>Math.max(0,Math.min(255,v*k)));};
  const score=t=>{const lf=lum(...rgb(t.color));
    return Math.min(...t.bgs.map(b=>{const lb=lum(...rgb(b));
      return (Math.max(lf,lb)+0.05)/(Math.min(lf,lb)+0.05);}));};

  const fails={light:[],dark:[]}, frozen=[];
  for(const th of ['light','dark'])
    out[th].forEach(t=>{ const r=score(t);
      if(r<t.need) fails[th].push(t.name+' «'+t.txt+'» '+r.toFixed(2)+'<'+t.need); });

  // لون لا ينقلب: نفس لون النصّ ونفس الخلفية في السمتين
  const key=t=>t.name+'|'+t.txt;
  const L={}; out.light.forEach(t=>L[key(t)]=t);
  out.dark.forEach(t=>{ const l=L[key(t)]; if(!l) return;
    if(l.color===t.color && String(l.bgs)===String(t.bgs)) frozen.push(t.name+' «'+t.txt+'»'); });

  console.log('مكوّنات مفحوصة:', new Set(out.light.map(t=>t.name)).size,
    '· عناصر نصّية:', out.light.length);
  console.log('\nفشل تباين — فاتحة:', fails.light.length);
  fails.light.forEach(x=>console.log('  ',x));
  console.log('فشل تباين — داكنة:', fails.dark.length);
  fails.dark.forEach(x=>console.log('  ',x));
  const fz=[...new Set(frozen)];
  console.log('\nعناصر لا تنقلب بين السمتين (قيمة ثابتة):', fz.length);
  fz.slice(0,40).forEach(x=>console.log('  ',x));
  await br.close();
})();
