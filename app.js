/* ============================ نواة التطبيق ============================ */
(function(){
"use strict";
var $ = function(s, r){ return (r||document).querySelector(s); };
var $$ = function(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };
var APP = $('#app');

function esc(s){ if(s===null||s===undefined) return ''; return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function uid(){ try{ return crypto.randomUUID(); }catch(e){ return 'op-'+Date.now()+'-'+Math.random().toString(36).slice(2,10); } }

/* ===== حاجز الوسائط — لا تُركَّب صورة أو صوت من نص غير موثوق داخل innerHTML =====
   الصور والصوت تصل من الموظفات عبر الـAPI، وكانت تُلصق مباشرة داخل src="..."،
   فيكفي محرفُ اقتباس واحد للخروج من الخاصية وحقن onerror داخل متصفح الإدارة.
   الآن: يُتحقق من الشكل أولاً، ثم يُبنى العنصر برمجياً ويُضبط src كخاصية لا كنص. */
var MEDIA_RE = {
  img: /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i,
  aud: /^data:audio\/(webm|ogg|mpeg|mp4|wav);(codecs=[a-z0-9.,;=\-]*;)?base64,[A-Za-z0-9+/=\s]+$/i
};
function mediaOk(kind, v){
  if(typeof v !== 'string' || !v) return false;
  if(v.length > 8 * 1024 * 1024) return false;              /* لا وسائط ضخمة داخل الصف */
  if(MEDIA_RE[kind === 'img' ? 'img' : 'aud'].test(v)) return true;
  /* روابط موقّعة من التخزين: نفس الأصل أو نطاق Supabase فقط */
  try{
    var u = new URL(v, location.href);
    if(u.protocol !== 'https:') return false;
    return u.origin === location.origin || /\.supabase\.co$/i.test(u.hostname);
  }catch(e){ return false; }
}
/* ===== وسائط التخزين الخاص =====
   الصف في قاعدة البيانات لم يعد يحمل الصورة أو الصوت، بل مفتاح الكائن فقط.
   الملف نفسه في حاوية خاصة، ولا يُقرأ إلا برابط موقّع قصير العمر تُصدره
   دالة الحافة بعد أن تتحقق أن هذه الموظفة يحق لها قراءته. */
var MEDIA_KEY_RE = /^\d{4}-\d{2}-\d{2}\/\d+\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i;
function mediaIsKey(v){ return typeof v === 'string' && MEDIA_KEY_RE.test(v); }
function mediaFn(body){
  body.token = (typeof S !== 'undefined' && S.token) || '';
  var K = getKey();
  return fetch(CONFIG.SUPABASE_URL + '/functions/v1/rko-media', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'apikey':K, 'Authorization':'Bearer '+K },
    body: JSON.stringify(body)
  }).then(function(r){ return r.json(); });
}
/* رفع: يعيد المفتاح فقط — لا يُرسل base64 إلى الجداول بعد اليوم */
function mediaPut(kind, dataUrl, usedBy){
  return mediaFn({ action:'put', kind:kind, data:dataUrl, used_by: usedBy||null })
    .then(function(r){
      if(!r || !r.ok || !r.key) throw new Error((r && r.error) || 'تعذّر رفع الملف');
      return r.key;
    });
}
/* توقيع: يُجمِّع المفاتيح المطلوبة في نداء واحد ويخزّن الرابط حتى قُبيل انتهائه */
var MSIGN = { cache:{}, q:[], t:null };
function mediaSign(key, fresh){
  var hit = MSIGN.cache[key];
  if(!fresh && hit && hit.exp > Date.now()) return Promise.resolve(hit.url);
  if(fresh) delete MSIGN.cache[key];
  return new Promise(function(res){
    MSIGN.q.push({ k:key, res:res });
    clearTimeout(MSIGN.t); MSIGN.t = setTimeout(mediaSignFlush, 40);
  });
}
function mediaSignFlush(){
  var batch = MSIGN.q.splice(0, 40);
  if(!batch.length) return;
  if(MSIGN.q.length){ clearTimeout(MSIGN.t); MSIGN.t = setTimeout(mediaSignFlush, 0); }
  mediaFn({ action:'sign', keys: batch.map(function(b){ return b.k; }) }).then(function(r){
    var urls = (r && r.urls) || {}, ttl = ((r && r.ttl) || 600) * 1000;
    batch.forEach(function(b){
      var u = urls[b.k] || null;
      if(u) MSIGN.cache[b.k] = { url:u, exp: Date.now() + ttl - 30000 };
      b.res(u);
    });
  }, function(){ batch.forEach(function(b){ b.res(null); }); });
}
/* يعيد عنصر DOM جاهزاً (أو null) — لا يعيد نصاً أبداً */
function mediaEl(kind, v, css){
  var isKey = mediaIsKey(v);
  if(!isKey && !mediaOk(kind, v)) return null;
  var el = document.createElement(kind === 'img' ? 'img' : 'audio');
  if(kind === 'img'){ el.alt = ''; }
  else { el.controls = true; el.preload = 'none'; }
  if(css) el.setAttribute('style', css);
  if(isKey){
    var tried = false;
    mediaSign(v).then(function(u){ if(u) el.src = u; else if(el.parentNode) el.parentNode.removeChild(el); });
    /* انتهت صلاحية الرابط بينما البطاقة مفتوحة؟ يُجدَّد مرة واحدة بصمت */
    el.addEventListener('error', function(){
      if(tried) return; tried = true;
      mediaSign(v, true).then(function(u){ if(u) el.src = u; });
    });
  } else {
    el.src = v;                                              /* خاصية، لا سلسلة داخل HTML */
  }
  return el;
}
/* عنصر نائب يُستبدل لاحقاً بالوسيط الحقيقي عبر mediaFill */
var MEDIA_SLOT = 0;
function mediaSlot(kind, v, css){
  if(!mediaIsKey(v) && !mediaOk(kind, v)) return '';
  var id = 'mslot' + (++MEDIA_SLOT);
  (mediaSlot._q = mediaSlot._q || []).push({ id: id, kind: kind, v: v, css: css });
  return '<span id="' + id + '"></span>';
}
function mediaFill(){
  var q = mediaSlot._q; if(!q || !q.length) return;
  var rest = [];
  q.forEach(function(it){
    var host = document.getElementById(it.id);
    if(!host){ rest.push(it); return; }          /* لم يُركَّب بعد — يُعاد في الجولة التالية */
    var el = mediaEl(it.kind, it.v, it.css);
    if(el) host.parentNode.replaceChild(el, host); else host.parentNode.removeChild(host);
  });
  mediaSlot._q = rest;
}
/* ===== الجداول تتحوّل بطاقات على الهاتف =====
   كل td يأخذ عنوان عموده في data-h، فتقرأه CSS تحت ٦٠٠px وتعرض كل خلية
   بسطرها المسمّى. يجري تلقائياً على كل جدول في التطبيق، فلا تحتاج أي شاشة
   إلى تعديل ولا يمكن أن تُنسى شاشة جديدة. */
/* صفوف .check تكتب كـ div لا label، فالضغط على النص لا يبدّل شيئاً والمربع
   وحده هدف صغير على الهاتف. مستمع واحد مفوَّض يغطي كل الصفوف الحالية والقادمة. */
document.addEventListener('click', function(e){
  var row = e.target.closest && e.target.closest('.check');
  if(!row || row.tagName === 'LABEL') return;
  if(e.target.tagName === 'INPUT') return;            /* الصندوق يتكفّل بنفسه */
  var box = row.querySelector('input[type=checkbox],input[type=radio]');
  if(!box || box.disabled) return;
  box.checked = box.type === 'radio' ? true : !box.checked;
  box.dispatchEvent(new Event('change', {bubbles:true}));
});
function tblResponsive(root){
  $$('table.tbl', root || document).forEach(function(t){
    if(t.getAttribute('data-rsp')) return;
    t.setAttribute('data-rsp', '1');
    t.classList.add('rsp');
    var head = t.querySelector('tr');
    if(!head) return;
    var heads = Array.prototype.map.call(head.children, function(c){
      return (c.textContent || '').trim();
    });
    Array.prototype.forEach.call(t.rows, function(r, ri){
      /* هذه الجداول تكتب صفّ العناوين كـ tr>th بلا thead، فلا تطابقه CSS.
         نعلّمه صراحةً كي يُخفى في عرض البطاقات بدل أن يفيض عن الشاشة. */
      if(r.querySelector('th')){ r.classList.add('rsp-head'); return; }
      Array.prototype.forEach.call(r.cells, function(c, ci){
        if(c.hasAttribute('data-h')) return;
        c.setAttribute('data-h', heads[ci] || '');
        var only = c.querySelector('button,input,select,textarea');
        /* الخلية الطويلة أو التي تحوي عناصر تفاعلية تأخذ سطرها كاملاً */
        if((c.textContent || '').length > 34 || only) c.classList.add('rsp-full');
        /* خلية زر وحده لا تحتاج تسمية تكرّر نص الزر */
        if(only && (c.textContent || '').trim().length <= 12) c.classList.add('rsp-nolbl');
      });
    });
  });
}
/* التعبئة تلقائية بعد أي تركيب DOM، فلا يعتمد الأمان على تذكّر استدعائها في كل شاشة */
try{
  new MutationObserver(function(){ mediaFill(); tblResponsive(); })
    .observe(document.documentElement, { childList:true, subtree:true });
}catch(e){}
function toast(msg, err, dur){
  var t = $('#toast');
  t.innerHTML = '<b style="margin-inline-end:6px">'+(err?'⚠':'✔')+'</b>'+esc(msg);
  t.className = err ? 'err show' : 'show';
  clearTimeout(toast._t); toast._t = setTimeout(function(){ t.className=''; }, dur||(err?3800:2400));
}
/* ===== الوقت: نظام ١٢ ساعة بصيغة ص/م في كل التطبيق =====
   كان في المشروع تنسيقان: fmtT بنظام ٢٤ ساعة في كل الشاشات، و tmClock
   بنظام ١٢ ساعة في وحدة الطاولات وحدها — فكانت الموظفة ترى «16:30» هنا
   و«4:30 م» هناك لنفس اللحظة. صار التنسيق واحداً من دالة واحدة.
   العزل ثنائي الاتجاه لازم: بلا مُحدِّد يقلب المتصفح موضع «ص/م» داخل
   الجملة العربية فتُقرأ «ص 4:06». */
var _AP = ['ص','م'];
function _t12(h, m){
  var ap = _AP[h < 12 ? 0 : 1];
  h = h % 12; if(!h) h = 12;
  return '\u2066' + h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap + '\u2069';
}
function fmtT(ts){ if(!ts) return '—'; var d=new Date(ts);
  if(!isFinite(d.getTime())) return '—';
  return _t12(d.getHours(), d.getMinutes()); }
/* وقت الجدولة يأتي من القاعدة نصاً «HH:MM:SS» بلا تاريخ، فلا يُبنى منه Date */
function fmtHM(t){ if(!t) return '—';
  var p=String(t).split(':'); if(p.length<2) return '—';
  var h=+p[0], m=+p[1]; if(!isFinite(h)||!isFinite(m)) return '—';
  return _t12(h, m); }
function fmtD(ts){ if(!ts) return '—'; var d=new Date(ts); return d.toLocaleDateString('ar-JO',{weekday:'short',day:'numeric',month:'numeric'}); }
function today(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
function dlFile(name, content, type){ var blob=new Blob([content],{type:(type||'text/plain')+';charset=utf-8'}); var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },500); }
function addDays(iso,n){ var d=new Date(iso+'T12:00:00'); d.setDate(d.getDate()+n); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
function thisMonth(){ return today().slice(0,7); }
function mins(n){ n=Math.round(n||0); return n+' د'; }
function secFmt(s){ s=Math.max(0,Math.floor(s||0)); var m=Math.floor(s/60); return ('0'+m).slice(-2)+':'+('0'+(s%60)).slice(-2); }

/* ---------- الجلسة والحالة ---------- */
var S = { token:null, role:null, me:null, state:null, tab:'now', adminSec:null, cacheTs:0 };
function saveSess(){ try{ localStorage.setItem('rko_sess', JSON.stringify({token:S.token, role:S.role, me:S.me})); }catch(e){} }
function loadSess(){ try{ var v=JSON.parse(localStorage.getItem('rko_sess')||'null'); if(v&&v.token){ S.token=v.token; S.role=v.role; S.me=v.me; } }catch(e){} }
/* إنهاء الجلسة: الخروج · القفل التلقائي · انتهاء الجلسة من الخادم.
   كان قناةُ اللحظة الحيّة تبقى مفتوحة بعد كلّ ذلك وتُعيد الاتصال من نفسها،
   فيستمرّ الجهاز يستقبل حالات الطاولات بعد تسجيل الخروج. rtStop كانت معرَّفة
   ولا يستدعيها أحد — وُصلت هنا لأنها نقطة الإنهاء الوحيدة لكل المسارات. */
function clearSess(){ S.token=null; S.role=null; S.me=null; S.state=null;
  try{ rtStop(); }catch(e){}
  try{ localStorage.removeItem('rko_sess'); }catch(e){} }

/* ---------- طابور العمليات دون اتصال —  IndexedDB ----------
   localStorage متزامن ومحدود ويُمسح تحت ضغط الذاكرة، وقد يفقد عمليات الموظفة.
   IndexedDB معاملاتي ولا يُمسح بسهولة، فالعملية المؤجلة لا تضيع.
   يبقى localStorage احتياطاً لو تعذّر فتح القاعدة. */
var QDB = null, QMEM = null;
function qOpen(){
  if(QDB) return Promise.resolve(QDB);
  return new Promise(function(res){
    try{
      var rq = indexedDB.open('rko_ops', 1);
      rq.onupgradeneeded = function(e){
        var db = e.target.result;
        if(!db.objectStoreNames.contains('q')) db.createObjectStore('q', {keyPath:'id', autoIncrement:true});
      };
      rq.onsuccess = function(e){ QDB = e.target.result; res(QDB); };
      rq.onerror   = function(){ res(null); };
      setTimeout(function(){ res(QDB); }, 2500);   /* لا نعلّق الواجهة */
    }catch(e){ res(null); }
  });
}
function qLegacy(){ try{ return JSON.parse(localStorage.getItem('rko_q')||'[]'); }catch(e){ return []; } }
function qGetAsync(){
  return qOpen().then(function(db){
    if(!db) return qLegacy();
    return new Promise(function(res){
      try{
        var tx = db.transaction('q','readonly').objectStore('q').getAll();
        tx.onsuccess = function(){ res(tx.result || []); };
        tx.onerror   = function(){ res(qLegacy()); };
      }catch(e){ res(qLegacy()); }
    });
  });
}
/* نسخة متزامنة للعدّاد فقط — تُحدَّث بعد كل عملية */
function qGet(){ return QMEM || qLegacy(); }
function qRefreshCount(){ return qGetAsync().then(function(a){ QMEM = a; updateDot(); return a; }); }

function qPush(fn, action, p){
  var item = {fn:fn, action:action, p:p, ts:Date.now(), op_id:(p && p.op_id) || uid()};
  return qOpen().then(function(db){
    if(!db){ var a=qLegacy(); a.push(item); try{ localStorage.setItem('rko_q', JSON.stringify(a)); }catch(e){} return; }
    return new Promise(function(res){
      try{
        var tx = db.transaction('q','readwrite');
        tx.objectStore('q').add(item);
        tx.oncomplete = function(){ res(); };
        tx.onerror    = function(){ res(); };
      }catch(e){ res(); }
    });
  }).then(qRefreshCount);
}
function qDrop(item){
  return qOpen().then(function(db){
    if(!db || item.id === undefined){
      var a = qLegacy(); a.shift();
      try{ localStorage.setItem('rko_q', JSON.stringify(a)); }catch(e){}
      return;
    }
    return new Promise(function(res){
      try{
        var tx = db.transaction('q','readwrite');
        tx.objectStore('q').delete(item.id);
        tx.oncomplete = function(){ res(); }; tx.onerror = function(){ res(); };
      }catch(e){ res(); }
    });
  });
}
var syncing=false;
function qSync(){
  if(syncing || !navigator.onLine) return;
  syncing = true;
  qGetAsync().then(function(a){
    if(!a.length){ syncing=false; QMEM=a; updateDot(); return; }
    var item = a[0];
    return rawRpc(item.fn, item.action, item.p).then(function(res){
      if(res && res.relogin){
        syncing=false; clearSess(); renderLogin();
        toast('انتهت الجلسة — سجلي الدخول لتكملة المزامنة', true); return;
      }
      /* لا نحذف إلا بعد ردّ فعلي من الخادم — لا نجاح كاذب */
      if(res && (res.ok || res.error)){
        if(res.error) toast('رُفضت عملية مؤجلة: '+res.error, true);
        return qDrop(item).then(qRefreshCount).then(function(rest){
          syncing = false;
          if(rest.length) qSync();
          else { toast('تمت مزامنة العمليات المؤجلة'); refresh(); }
        });
      }
      syncing = false;
    });
  }).catch(function(){ syncing=false; });
}
/* ترحيل ما تبقّى في localStorage مرة واحدة */
(function migrateQueue(){
  var old = qLegacy();
  if(!old.length) return;
  qOpen().then(function(db){
    if(!db) return;
    try{
      var st = db.transaction('q','readwrite').objectStore('q');
      old.forEach(function(x){ st.add(x); });
      localStorage.removeItem('rko_q');
    }catch(e){}
  }).then(qRefreshCount);
})();
window.addEventListener('online', function(){ updateDot(); qSync(); });
window.addEventListener('offline', updateDot);
function updateDot(){ var d=$('#syncdot'); if(!d) return; var pending=qGet().length; d.className = (navigator.onLine&&!pending) ? 'dot' : 'dot off'; d.title = pending? pending+' عملية بانتظار المزامنة' : (navigator.onLine?'متصل':'دون اتصال'); }
/* CRB #1: إلغاء عمليات مهام معلّقة (بعد الانصراف) + قفل التنفيذ خارج الشفت */
/* إلغاء عمليات معلّقة من الطابور (تُستدعى عند الانصراف لمنع تنفيذ مهام بعده).
   كانت تنادي qSet المحذوفة بعد الانتقال إلى IndexedDB، فترمي عند كل انصراف. */
function qClear(pred){
  return qGetAsync().then(function(a){
    var doomed = pred ? a.filter(pred) : a;
    return doomed.reduce(function(chain, item){
      return chain.then(function(){ return qDrop(item); });
    }, Promise.resolve());
  }).then(qRefreshCount);
}
function workLocked(){ var a=S.state&&S.state.attendance; return !!(a&&a.out); }

/* ---------- الاتصال بالخادم ---------- */
function getKey(){ try{ var k=localStorage.getItem('rko_key'); if(k) return k; }catch(e){} return CONFIG.SUPABASE_ANON_KEY; }
function rawRpc(fn, action, p){
  var K=getKey();
  return fetch(CONFIG.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'apikey':K, 'Authorization':'Bearer '+K },
    body: JSON.stringify({ p_token: S.token||'', p_action: action, p: p||{} })
  }).then(function(r){ return r.json(); }).then(function(res){
    /* الخادم يدوّر توكن الجلسة دورياً؛ نلتقط الجديد فوراً وإلا بطل القديم عند الطلب التالي */
    if(res && res.new_token && res.new_token !== S.token){ S.token = res.new_token; saveSess(); }
    return res;
  });
}
// mutQueue=true: عملية تعديل تُحفظ بالطابور إذا انقطع الاتصال
function rpc(fn, action, p, mutQueue){
  p = p||{};
  return rawRpc(fn, action, p).then(function(res){
    if(res && res.relogin){ clearSess(); renderLogin(); toast('انتهت الجلسة — سجلي الدخول من جديد', true); throw {handled:true}; }
    return res;
  }).catch(function(e){
    if(e && e.handled) throw e;
    if(mutQueue){ if(!p.op_id) p.op_id=uid(); qPush(fn, action, p); toast('لا يوجد اتصال — حُفظت العملية وستُرسل تلقائياً'); return {ok:true, queued:true}; }
    toast('تعذر الاتصال بالخادم', true); throw e;
  });
}
function sAct(action, p, mut){ if(mut){ p=p||{}; if(!p.op_id) p.op_id=uid(); } return rpc('rko_staff', action, p, mut); }
function aAct(action, p){ return rpc('rko_admin', action, p, false); }

/* ---------- قفل الخمول (جهاز مشترك) ----------
   كان ٢٥ دقيقة مثبّتة هنا، والإعداد في قاعدة البيانات لا يقرؤه أحد —
   فكان يعرض رقماً غير الرقم العامل. صار يُقرأ من حمولة الشفت، والمثبّت
   هنا احتياطٌ لما قبل وصولها فقط. */
var idleT=null, IDLE_MIN=25;
function idleMins(){
  var c=(S.state&&S.state.cfg)||{}, m=+c.idle_minutes;
  return (m>=1 && m<=240) ? m : IDLE_MIN;
}
function idleReset(){
  if(S.role!=='staff') return;
  clearTimeout(idleT);
  idleT=setTimeout(function(){ clearSess(); renderLogin(); toast('أُغلقت الجلسة تلقائياً لحماية حسابك'); }, idleMins()*60*1000);
}
['click','touchstart','keydown','scroll'].forEach(function(ev){ document.addEventListener(ev, idleReset, {passive:true}); });

/* ---------- نافذة منبثقة ---------- */
function sheet(title, html, onOpen){
  var ov=document.createElement('div'); ov.className='overlay';
  ov.innerHTML='<div class="sheet"><h3><span>'+esc(title)+'</span><button class="x" aria-label="إغلاق">✕</button></h3><div class="sh-body">'+html+'</div></div>';
  ov.addEventListener('click', function(e){ if(e.target===ov) close(); });
  $('.x',ov).addEventListener('click', close);
  function onKey(e){ if(e.key==='Escape') close(); }
  document.addEventListener('keydown', onKey);
  var prevOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  function close(){
    if(ov.parentNode) ov.parentNode.removeChild(ov);
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow=prevOverflow;
  }
  document.body.appendChild(ov);
  if(onOpen) onOpen(ov, close);
  return close;
}

/* ---------- نوافذ تأكيد وإدخال داخل النظام (بديل prompt/confirm) ---------- */
function confirmSheet(title, msg, yesLabel, onYes, danger){
  sheet(title, '<div class="cdlg-txt">'+msg+'</div>'+
    '<div class="btnrow"><button class="btn block'+(danger?' red':'')+'" id="cdY">'+esc(yesLabel||'تأكيد')+'</button>'+
    '<button class="btn ghost" id="cdN">إلغاء</button></div>',
    function(ov, close){
      $('#cdY',ov).addEventListener('click', function(){ close(); onYes(); });
      $('#cdN',ov).addEventListener('click', close);
    });
}
function inputSheet(title, label, placeholder, goLabel, onGo, optional){
  sheet(title,
    '<label class="f">'+esc(label)+(optional?' <span class="muted small">(اختياري)</span>':'')+'</label>'+
    '<textarea class="f" id="inS" placeholder="'+esc(placeholder||'')+'"></textarea>'+
    '<div class="btnrow"><button class="btn block" id="inGo">'+esc(goLabel||'إرسال')+'</button></div>',
    function(ov, close){
      $('#inGo',ov).addEventListener('click', function(){
        var v=$('#inS',ov).value.trim();
        if(!v && !optional){ toast('اكتبي النص أولاً', true); return; }
        close(); onGo(v);
      });
    });
}

/* ---------- منع الإرسال المزدوج ---------- */
function busyWrap(btn, work){
  if(btn.classList.contains('busy')) return;
  btn.classList.add('busy');
  var p; try{ p=work(); }catch(e){ btn.classList.remove('busy'); throw e; }
  if(p && p.then) p.then(function(){ btn.classList.remove('busy'); }, function(){ btn.classList.remove('busy'); });
  else btn.classList.remove('busy');
  return p;
}

/* ---------- ضغط صورة (كاميرا → JPEG صغير) ---------- */
function pickPhoto(cb){
  var inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.capture='environment';
  inp.addEventListener('change', function(){
    var f=inp.files && inp.files[0]; if(!f) return;
    var img=new Image(), url=URL.createObjectURL(f);
    img.onload=function(){
      var max=800, w=img.width, h=img.height;
      if(w>h && w>max){ h=Math.round(h*max/w); w=max; } else if(h>=w && h>max){ w=Math.round(w*max/h); h=max; }
      var c=document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      URL.revokeObjectURL(url);
      cb(c.toDataURL('image/jpeg',0.7));
    };
    img.onerror=function(){ URL.revokeObjectURL(url); toast('تعذر قراءة الصورة', true); };
    img.src=url;
  });
  inp.click();
}
/* التقاط ثم رفع فوري إلى التخزين الخاص.
   المعاينة تظهر فوراً من الصورة المحلية، والمرسَل للخادم هو المفتاح لا الصورة.
   إن تعذّر الرفع (شبكة) نعيد الصورة نفسها كي لا تضيع على الموظفة — الخادم يقبل الحالتين. */
function pickUpload(usedBy, onPreview, onDone){
  pickPhoto(function(d){
    if(onPreview) onPreview(d);
    mediaPut('img', d, usedBy).then(
      function(k){ onDone(k, ''); },
      function(e){ toast((e && e.message) || 'تعذّر رفع الصورة — ستُرسل مع الطلب', true); onDone('', d); });
  });
}

/* ---------- هوية الجهاز والموقع (حماية الحضور) ---------- */
function devId(){
  try{
    var d=localStorage.getItem('rko_dev');
    if(!d){ d=uid(); localStorage.setItem('rko_dev', d); }
    return d;
  }catch(e){ return 'no-storage'; }
}
function devTok(){ try{ return localStorage.getItem('rko_devtok')||''; }catch(e){ return ''; } }
/* ---------- إشعارات الدفع (Web Push) ---------- */
function b64ToU8(base64){
  var pad='='.repeat((4-base64.length%4)%4);
  var b=(base64+pad).replace(/-/g,'+').replace(/_/g,'/');
  var raw=atob(b), arr=new Uint8Array(raw.length);
  for(var i=0;i<raw.length;i++) arr[i]=raw.charCodeAt(i);
  return arr;
}
function enablePush(vapid, cb){
  if(!('serviceWorker' in navigator) || !('PushManager' in window) || !vapid){ if(cb)cb(false); return; }
  Notification.requestPermission().then(function(perm){
    if(perm!=='granted'){ if(cb)cb(false); return; }
    navigator.serviceWorker.ready.then(function(reg){
      reg.pushManager.getSubscription().then(function(sub){
        // بعد تدوير مفتاح VAPID: ألغِ أي اشتراك قديم ثم اشترك بالمفتاح الحالي لضمان التطابق
        var p = (sub ? sub.unsubscribe().catch(function(){return true;}) : Promise.resolve(true))
          .then(function(){ return reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64ToU8(vapid)}); });
        p.then(function(s){
          var j=s.toJSON(), act=(S.role==='admin')?'push_admin_subscribe':'push_subscribe';
          var fn=(S.role==='admin')?aAct:sAct;
          fn(act, {endpoint:j.endpoint, p256dh:j.keys.p256dh, auth:j.keys.auth, ua:navigator.userAgent}, false)
            .then(function(){ PUSH_OK=true; toast('فُعّلت الإشعارات ✔'); if(cb)cb(true); });
        }).catch(function(){ if(cb)cb(false); });
      });
    });
  }).catch(function(){ if(cb)cb(false); });
}
/* الاشتراك الفعلي هو المعيار — لا إذن المتصفح.
   الإذن ممنوح لا يعني وجود اشتراك: بعد تدوير المفتاح أو مسح البيانات
   يبقى الإذن granted بلا اشتراك، فلا يصل إشعار ولا تظهر أي بطاقة. */
var PUSH_OK=null;                       // null=غير معروف, true/false=النتيجة
function ensurePush(cb){
  function done(v){ PUSH_OK=v; if(cb) cb(v); }
  if(!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)){
    done(true); return;                 // متصفح غير داعم — لا نحبس الموظفة
  }
  if(Notification.permission !== 'granted'){ done(false); return; }
  // حارس: لا تنتظر إلى الأبد إن تعذّر تسجيل عامل الخدمة
  var settled=false; var _done=done;
  done=function(v){ if(settled) return; settled=true; _done(v); };
  setTimeout(function(){ done(false); }, 8000);
  navigator.serviceWorker.ready.then(function(reg){
    reg.pushManager.getSubscription().then(function(sub){
      if(sub){                          // موجود: أعِد تسجيله على الخادم (يشفي أي فقد)
        pushSave(sub, function(){ done(true); });
        return;
      }
      // الإذن ممنوح بلا اشتراك ⇒ اشترك بصمت بلا إزعاج الموظفة
      var vapid=(S.state&&S.state.push&&S.state.push.vapid_public)||PUSHKEY;
      reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64ToU8(vapid)})
        .then(function(s){ pushSave(s, function(){ done(true); }); })
        .catch(function(){ done(false); });
    }).catch(function(){ done(false); });
  }).catch(function(){ done(false); });
}
function pushSave(sub, cb){
  var j=sub.toJSON();
  if(!j || !j.keys || !j.keys.p256dh){ if(cb) cb(); return; }
  var act=(S.role==='admin')?'push_admin_subscribe':'push_subscribe';
  var fn=(S.role==='admin')?aAct:sAct;
  fn(act, {endpoint:j.endpoint, p256dh:j.keys.p256dh, auth:j.keys.auth, ua:navigator.userAgent}, false)
    .then(function(){ if(cb) cb(); }).catch(function(){ if(cb) cb(); });
}
/* بوابة إجبارية: لا يُسمح للموظفة بالعمل دون تفعيل إشعارات الجهاز */
function pushGate(){
  if(S.role!=='staff') return;                              // للموظفات فقط
  if(!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) return; // متصفح لا يدعم — لا نحبسها
  // المعيار هو وجود اشتراك فعلي لا الإذن وحده
  ensurePush(function(ok){
    var g0=$('#pushGate');
    if(ok){ if(g0) g0.remove(); if(typeof drawTab==='function' && g0) drawTab(); return; }
    if(g0) return;                                          // معروضة أصلاً
    pushGateDraw();
  });
}
function pushGateDraw(){
  var vapid=(S.state&&S.state.push&&S.state.push.vapid_public)||PUSHKEY;
  var denied=(Notification.permission==='denied');
  var el=document.createElement('div');
  el.className='pushgate'; el.id='pushGate';
  el.innerHTML='<div class="pushgate-card">'+
    '<div class="pg-ic">'+IC.bell+'</div>'+
    '<h2>فعّلي إشعارات هاتفكِ</h2>'+
    '<p>لن تتمكني من متابعة العمل قبل تفعيل الإشعارات، لتصلكِ تنبيهات المهام وقرارات طلباتكِ على هاتفكِ حتى والتطبيق مغلق.</p>'+
    (denied
      ? '<div class="pg-warn">الإشعارات محظورة من إعدادات المتصفح. افتحي إعدادات الموقع (رمز القفل بجانب العنوان) ← الإشعارات ← «السماح»، ثم أعيدي التحميل.</div>'+
        '<button class="btn block" id="pgReload">أعيدي التحميل بعد السماح</button>'
      : '<button class="btn block" id="pgGo">تفعيل الإشعارات ✔</button>');
  el.innerHTML+='</div>';
  document.body.appendChild(el);
  var go=$('#pgGo',el); if(go) go.addEventListener('click', function(){
    go.disabled=true; go.textContent='جارٍ التفعيل…';
    enablePush(vapid, function(ok){
      if(ok){ el.remove(); }
      else { go.disabled=false; go.textContent='تفعيل الإشعارات ✔'; pushGate(); } // أُعيد الرسم (قد تكون رُفضت)
    });
  });
  var rl=$('#pgReload',el); if(rl) rl.addEventListener('click', function(){ location.reload(); });
}
function devLabel(){ try{ return localStorage.getItem('rko_devlabel')||''; }catch(e){ return ''; } }

/* ---------- كاميرا مباشرة (لا استوديو): للتحقق وتوثيق المهام ---------- */
function cameraSheet(opts, cb){
  if(!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)){
    toast('الكاميرا غير مدعومة على هذا المتصفح', true);
    if(opts.onFail) opts.onFail();
    return;
  }
  var stream=null;
  function stopCam(){ if(stream){ stream.getTracks().forEach(function(t){ t.stop(); }); stream=null; } }
  sheet(opts.title||'التصوير المباشر',
    '<div class="camwrap"><video id="camV" autoplay playsinline muted></video></div>'+
    '<div class="muted small center" style="margin-top:6px">تصوير مباشر فقط — لا يمكن الاختيار من الاستوديو، وتُختم الصورة بالوقت</div>'+
    '<div class="btnrow"><button class="btn block" id="camGo">التقاط</button></div>',
    function(ov, closeFn){
      var xb=$('.x',ov); if(xb) xb.addEventListener('click', stopCam);
      ov.addEventListener('click', function(e){ if(e.target===ov) stopCam(); });
      navigator.mediaDevices.getUserMedia({video:{facingMode:opts.facing||'environment', width:{ideal:1024}}, audio:false})
        .then(function(st){ stream=st; var v=$('#camV',ov); if(v) v.srcObject=st; else stopCam(); })
        .catch(function(){
          stopCam(); closeFn();
          toast('يجب السماح بالكاميرا — هذه العملية تتطلب تصويراً مباشراً', true);
          if(opts.onFail) opts.onFail();
        });
      $('#camGo',ov).addEventListener('click', function(){
        var v=$('#camV',ov);
        if(!stream || !v || !v.videoWidth){ toast('الكاميرا لم تجهز بعد — لحظة', true); return; }
        var max=800, w=v.videoWidth, h=v.videoHeight;
        if(w>h && w>max){ h=Math.round(h*max/w); w=max; } else if(h>=w && h>max){ w=Math.round(w*max/h); h=max; }
        var cv=document.createElement('canvas'); cv.width=w; cv.height=h;
        var ctx=cv.getContext('2d'); ctx.drawImage(v,0,0,w,h);
        ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(0,h-26,w,26);
        ctx.fillStyle='#fff'; ctx.font='13px sans-serif'; ctx.textAlign='right'; ctx.direction='rtl';
        ctx.fillText((opts.watermark||'')+' · '+new Date().toLocaleString('ar-JO'), w-8, h-8);
        stopCam(); closeFn(); cb(cv.toDataURL('image/jpeg',0.72));
      });
    });
}
function shiftEndCelebrate(){
  sAct('my_engage',{}).then(function(eg){
    if(!eg || !eg.ok) return;
    var m=eg.month||{};
    sheet('انتهى شفتكِ — أحسنتِ',
      '<div class="center" style="padding:4px 0 2px"><div style="font-size:42px;font-weight:800;color:var(--amber);line-height:1">'+(eg.points||0)+'</div><div class="muted">نقاط ريحانة</div></div>'+
      '<div class="row" style="gap:8px;margin-top:12px">'+
      '<div class="stat" style="flex:1"><div class="v">'+(eg.shift_streak||0)+'</div><div class="l">شفت متتالٍ</div></div>'+
      '<div class="stat" style="flex:1"><div class="v">'+(m.tasks_done||0)+'</div><div class="l">مهام هذا الشهر</div></div>'+
      '<div class="stat" style="flex:1"><div class="v">'+(m.ontime_days||0)+'</div><div class="l">يوم التزام</div></div></div>'+
      '<div class="card soft" style="margin-top:12px;text-align:center">شكراً لجهدكِ اليوم — نراكِ في شفتكِ القادم</div>');
  }).catch(function(){});
}
function getGeo(cb){
  if(!navigator.geolocation){ cb(null); return; }
  var done=false;
  var t=setTimeout(function(){ if(!done){ done=true; cb(null); } }, 6500);
  navigator.geolocation.getCurrentPosition(function(pos){
    if(done) return; done=true; clearTimeout(t);
    cb({lat:+pos.coords.latitude.toFixed(6), lng:+pos.coords.longitude.toFixed(6), acc:Math.round(pos.coords.accuracy||0)});
  }, function(){
    if(done) return; done=true; clearTimeout(t); cb(null);
  }, {enableHighAccuracy:true, timeout:6000, maximumAge:30000});
}
/* الحضور/الانصراف بلمسة واحدة: يوثَّق بمعرّف الجهاز والموقع تلقائياً.
   كلمة السر أو الصورة تُطلبان فقط إذا فعّلتهما الإدارة من الإعدادات. */
/* حضورٌ بلا شفت مجدول: نسأل عن المنطقة قبل الإرسال.
   بلا منطقة لا تُولَّد مهمة واحدة، فتقف الموظفة حاضرةً والنظام لا يعطيها
   شيئاً. ضغطةٌ واحدة من قائمة المناطق المفتوحة تُنهي المأزق، والخادم هو
   من يتحقّق أن المنطقة نشطة ومفتوحة في وقتها. */
function checkinFlow(){
  var st=S.state||{};
  if(st.shift && st.shift.id){ doAttendance('in'); return; }
  var areas=(st.areas||[]).filter(function(a){ return a && a.id; });
  if(!areas.length){ doAttendance('in'); return; }
  sheet('أين ستعملين اليوم؟',
    '<div class="muted small" style="margin-bottom:8px">لا شفت مجدول لكِ اليوم. '+
      'اختاري منطقتكِ لتصلكِ مهامها فوراً.</div>'+
    '<div class="navlist">'+areas.map(function(a){
      return '<button data-ar="'+(+a.id)+'"><span>'+esc(a.name)+'</span><span class="chev">‹</span></button>';
    }).join('')+'</div>',
    function(ov, close){
      $$('[data-ar]',ov).forEach(function(b){ b.addEventListener('click', function(){
        var aid=+b.getAttribute('data-ar'); close(); doAttendance('in', null, null, aid);
      }); });
    });
}

function doAttendance(kind, pin, selfie, areaId){
  var isOut = kind==='out';
  var sel='[data-a="'+(isOut?'checkout':'checkin')+'"]';
  $$(sel).forEach(function(b){ b.classList.add('busy'); });
  getGeo(function(geo){
    var p={geo:geo, device_token:devTok(), device_id:devId()};
    if(areaId) p.area_id=areaId;
    if(pin) p.pin=pin;
    if(selfie){ if(mediaIsKey(selfie)) p.selfie_key=selfie; else p.selfie=selfie; }
    sAct(isOut?'check_out':'check_in', p, false).then(function(res){
      $$(sel).forEach(function(b){ b.classList.remove('busy'); });
      if(res.ok){
        if(navigator.vibrate) navigator.vibrate(35);
        if(res.dup) toast('مسجّل مسبقاً');
        else if(res.unscheduled) toast('سُجّل حضورك (غير مجدول) — سيظهر للإدارة');
        else if(isOut){ qClear(function(x){ return /^(task_|blocker_|recur)/.test(x.action||''); }); toast('سُجّل انصرافك — يعطيك العافية'); shiftEndCelebrate(); }
        else toast('صباح النشاط سُجّل حضورك');
        refresh();
      } else if(res.blockers){
        sheet('لا يمكن الانصراف بعد','<ul style="padding-right:18px">'+res.blockers.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul>'+
          ((res.open_tasks&&res.open_tasks.length)?'<hr class="sep"><div class="small"><b>مهام لم تُغلق:</b></div><ul style="padding-right:18px" class="muted small">'+
            res.open_tasks.map(function(x){return '<li>'+esc(x.name)+(x.is_core?' <span class="chip red">أساسية</span>':'')+'</li>';}).join('')+'</ul>':'')+
          '<div class="muted small">أنهي هذه النقاط ثم أعيدي المحاولة.</div>');
      } else if(res.confirm_open){
        var lst=(res.open_tasks||[]).map(function(x){return '<li>'+esc(x.name)+'</li>';}).join('');
        sheet('لديكِ مهام لم تُغلق',
          '<div class="small">هذه المهام ما زالت مفتوحة:</div><ul style="padding-right:18px">'+lst+'</ul>'+
          '<div class="muted small">إن انصرفتِ الآن ستعود هذه المهام للتوزيع تلقائياً على زميلاتك — ولن تُحسب تقصيراً عليكِ.</div>'+
          '<div class="btnrow"><button class="btn block" id="coGo">انصراف وإعادتها للتوزيع</button></div>'+
          '<div class="btnrow"><button class="btn ghost block" id="coBack">أعود لإنهائها</button></div>',
          function(ov, close){
            $('#coGo',ov).addEventListener('click', function(){
              close();
              getGeo(function(g2){
                var p2={geo:g2, device_token:devTok(), device_id:devId(), ack_open:true};
                if(pin) p2.pin=pin;
                if(selfie){ if(mediaIsKey(selfie)) p2.selfie_key=selfie; else p2.selfie=selfie; }
                sAct('check_out', p2, false).then(function(r2){
                  if(r2.ok){ qClear(function(x){ return /^(task_|blocker_|recur)/.test(x.action||''); });
                    toast('سُجّل انصرافك — أُعيدت المهام للتوزيع'); refresh(); }
                  else toast(r2.error||'خطأ', true);
                });
              });
            });
            $('#coBack',ov).addEventListener('click', function(){ close(); });
          });
      } else if(res.need_pin){
        pinSheet(kind, selfie, areaId);
      } else if((res.error||'').indexOf('صورة التحقق')>-1){
        cameraSheet({facing:'user', title:'صورة التحقق المباشرة', watermark:(S.me?S.me.name:'')+(isOut?' · انصراف':' · حضور')},
          function(d){
            /* الصورة ترتفع للتخزين الخاص أولاً؛ الصف يحمل المفتاح فقط.
               وإن تعثّرت الشبكة لا نمنع الموظفة من تسجيل حضورها. */
            mediaPut('img', d, 'attendance').then(
              function(k){ doAttendance(kind, pin, k, areaId); },
              function(){ doAttendance(kind, pin, d, areaId); });
          });
      } else toast(res.error||'خطأ', true);
    }).catch(function(){ $$(sel).forEach(function(b){ b.classList.remove('busy'); }); });
  });
}
/* المنطقة تُمرَّر عبر مسارَي إعادة المحاولة (كلمة السر وصورة التحقق)
   وإلا ضاعت بينهما وعاد الشفت بلا منطقة من حيث لا تدري الموظفة. */
function pinSheet(kind, selfie, areaId){
  sheet('تأكيد الهوية',
    '<div class="muted small">الإدارة فعّلت طبقة تحقق إضافية — أدخلي كلمة سرك.</div>'+
    '<label class="f">كلمة السر</label><input class="f" id="apn" type="password" inputmode="numeric" autocomplete="off">'+
    '<div class="btnrow"><button class="btn block" id="apnGo">تأكيد</button></div>',
    function(ov, close){
      var inp=$('#apn',ov); setTimeout(function(){ inp.focus(); },100);
      function go(){ if(!inp.value){ toast('أدخلي كلمة سرك', true); return; } close(); doAttendance(kind, inp.value, selfie, areaId); }
      $('#apnGo',ov).addEventListener('click', go);
      inp.addEventListener('keydown', function(e){ if(e.key==='Enter') go(); });
    });
}

/* ---------- أيقونات SVG ---------- */
var LOGO_IMG='data:image/png;base64,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';
function logoImg(w){ return '<img src="'+LOGO_IMG+'" alt="ريحانة كافيه" style="width:'+(w||150)+'px;height:auto;display:block;margin:0 auto">'; }
function brandMark(sz){ sz=sz||40; return '<img src="'+LOGO_IMG+'" alt="ريحانة كافيه" style="display:block;height:'+sz+'px;width:auto">'; }
function svgi(body){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+body+'</svg>'; }
/* وجوه المزاج — أيقونات خطية أنيقة بدل الرموز التعبيرية */
var MOOD_MOUTH=['','M8 16.4 Q12 12.4 16 16.4','M8.5 15.9 Q12 14.1 15.5 15.9','M8.5 15 H15.5','M8.5 14.6 Q12 16.4 15.5 14.6','M8 14 Q12 18 16 14'];
function moodFace(lvl, sz){ sz=sz||26; var m=MOOD_MOUTH[lvl]||MOOD_MOUTH[3];
  return '<svg viewBox="0 0 24 24" width="'+sz+'" height="'+sz+'" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
    '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01"/><path d="M15 10h.01"/><path d="'+m+'"/></svg>'; }
var MI={
  _def: svgi('<circle cx="12" cy="12" r="8"/>'),
  dayphase: svgi('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/><path d="M12 12l3.5-2"/>'),
  openshifts: svgi('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3.5 2"/><path d="M19 5l2-2"/>'),
  bottleneck: svgi('<path d="M5 4h14l-5 7v6l-4 2v-8L5 4Z"/>'),
  geo: svgi('<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10Z"/><circle cx="12" cy="11" r="2.2"/>'),
  errors: svgi('<path d="M12 4.5 21 19H3L12 4.5Z"/><path d="M12 10v4M12 16.5v.5"/>'),
  assignkpi: svgi('<path d="M4 20V4M4 20h16"/><path d="M7 16l4-5 3 3 5-7"/>'),
  availability: svgi('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>'),
  board: svgi('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  live:  svgi('<path d="M5 12a7 7 0 0 1 14 0"/><path d="M8.5 12a3.5 3.5 0 0 1 7 0"/><circle cx="12" cy="12" r="1"/>'),
  broadcast: svgi('<path d="M4 10v4M8 8l9-4v16l-9-4M8 8v8"/>'),
  issues: svgi('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6 2 2 6-6a4 4 0 0 0 5.4-5.4L13 6l3-3"/>'),
  logbook: svgi('<path d="M5 4h13a1 1 0 0 1 1 1v15l-3-2-3 2-3-2-3 2V5a1 1 0 0 1 1-1Z"/><path d="M9 8h6M9 12h6"/>'),
  analytics: svgi('<path d="M4 20V4M4 20h16"/><rect x="7" y="12" width="3" height="5"/><rect x="12" y="8" width="3" height="9"/><rect x="17" y="5" width="3" height="12"/>'),
  employees: svgi('<circle cx="8" cy="9" r="3"/><path d="M2 20c1-3.6 3.4-5 6-5s5 1.4 6 5"/><path d="M16 6a3 3 0 0 1 0 6M22 20c-.6-2.5-2-3.8-4-4.4"/>'),
  shifts: svgi('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>'),
  types: svgi('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'),
  areas: svgi('<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10Z"/><circle cx="12" cy="11" r="2"/>'),
  templates: svgi('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'),
  tasks: svgi('<circle cx="12" cy="12" r="8.5"/><path d="m8.6 12.3 2.3 2.3 4.5-5"/>'),
  attendance: svgi('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'),
  skills: svgi('<path d="M12 21v-7"/><path d="M12 14c0-4.2-3.1-7-8-7 0 4.2 3.1 7 8 7Z"/><path d="M12 12.2c0-3.4 2.5-5.7 6.8-5.7 0 3.4-2.5 5.7-6.8 5.7Z"/>'),
  training: svgi('<path d="M3 8l9-4 9 4-9 4-9-4Z"/><path d="M7 10v5c0 1.5 2.2 3 5 3s5-1.5 5-3v-5"/>'),
  absence: svgi('<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'),
  coop: svgi('<path d="M8 13l2 2 4-4"/><path d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z"/>'),
  evals: svgi('<path d="M12 3l2.4 5 5.6.7-4 3.9 1 5.4L12 15l-5 2.9 1-5.4-4-3.9 5.6-.7Z"/>'),
  awards: svgi('<circle cx="12" cy="9" r="5"/><path d="M9 13l-1 7 4-2 4 2-1-7"/>'),
  requests: svgi('<path d="M4 5h16v11H8l-4 4V5Z"/>'),
  handovers: svgi('<path d="M7 8h10l-3-3M17 16H7l3 3"/>'),
  reports: svgi('<path d="M6 3h9l4 4v14H6V3Z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>'),
  devices: svgi('<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M11 18h2"/>'),
  settings: svgi('<circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.5 7.5 0 0 0 0-2l1.9-1.4-2-3.4-2.2 1a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.4 2.7a7.5 7.5 0 0 0-1.7 1l-2.2-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-1.9 1.4 2 3.4 2.2-1a7.5 7.5 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.5 7.5 0 0 0 1.7-1l2.2 1 2-3.4Z"/>'),
  audit: svgi('<path d="M6 3h9l4 4v14H6V3Z"/><path d="M9 12l2 2 4-4"/>'),
  flags: svgi('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  hours: svgi('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>'),
  sops: svgi('<path d="M6 3h9l4 4v14H6V3Z"/><path d="M14 3v4h4M9 12h6M9 16h4"/>'),
  digest: svgi('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6"/>'),
  ptt: svgi('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  cover: svgi('<path d="M7 8h11l-3-3M17 16H6l3 3"/>'),
  prep: svgi('<path d="M9 3h6M10 3v4l-4 7a5 5 0 0 0 4.4 7.5h3.2A5 5 0 0 0 18 14l-4-7V3"/><path d="M7.5 14h9"/>'),
  heat: svgi('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" stroke="none"/>'),
  ops: svgi('<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>')
};
var IC={
  home:  svgi('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5h4v5"/>'),
  tasks: svgi('<circle cx="12" cy="12" r="8.5"/><path d="m8.6 12.3 2.3 2.3 4.5-5"/>'),
  shift: svgi('<path d="M7 8h10l-3-3"/><path d="M17 16H7l3 3"/>'),
  grow:  svgi('<path d="M12 21v-7"/><path d="M12 14c0-4.2-3.1-7-8-7 0 4.2 3.1 7 8 7Z"/><path d="M12 12.2c0-3.4 2.5-5.7 6.8-5.7 0 3.4-2.5 5.7-6.8 5.7Z"/>'),
  more:  svgi('<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>'),
  refresh: svgi('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 3.5V8h-4.5"/>'),
  mic: svgi('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  user:  svgi('<circle cx="12" cy="8" r="3.4"/><path d="M5 20c1.2-3.6 3.6-5.4 7-5.4s5.8 1.8 7 5.4"/>'),
  bell:  svgi('<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
  moon:  svgi('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>'),
  sun:   svgi('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>'),
  auto:  svgi('<circle cx="12" cy="12" r="8"/><path d="M12 4v16" /><path d="M12 4a8 8 0 0 0 0 16" fill="currentColor" stroke="none"/>'),
  ready: svgi('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1H9V4Z"/><path d="m9.3 13 1.9 1.9 3.5-4"/>'),
  temp:  svgi('<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z"/><path d="M12 9v6"/>'),
  lock:  svgi('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>')
};

/* ---------- هيكل تحميل (شيمر) ---------- */
function skel(n){ var s=''; for(var i=0;i<(n||3);i++) s+='<div class="skel"></div>'; return s; }

/* ---------- ترجمة مصطلحات ---------- */
var PHASE={opening:'الافتتاح', during:'أثناء الدوام', closing:'الإغلاق', adhoc:'مهمة إضافية'};
var TSTAT={open:'لم تبدأ', running:'قيد التنفيذ', paused:'موقوفة مؤقتاً', done:'منجزة', approved:'معتمدة', returned:'مُعادة للتنفيذ', carried:'رُحّلت للغد', cancelled:'أُلغيت',
  claimed_done:'قيد القبول التلقائي', accepted:'مقبولة', verified:'مُتحقَّق منها', review_required:'تحتاج مراجعة', reopened:'أُعيد فتحها', blocked:'موقوفة بمانع'};
var WFPH={pre_shift:'قبل الافتتاح', opening:'الافتتاح', normal:'تشغيل طبيعي', peak:'ذروة', recovery:'تعافٍ', closing:'إغلاق', finalized:'أُقفل اليوم'};
var WAIT={none:'لا انتظار', low:'انتظار خفيف', high:'انتظار مرتفع'};
var REQSTAT={pending:'قيد المراجعة', approved:'مقبول', rejected:'مرفوض'};
/* أدوار الشفت وأسباب الإسناد — قائمة مغلقة يطابقها قيد في قاعدة البيانات */
var SROLES=[['floor','الصالة'],['kitchen','المطبخ'],['hookah','الأراجيل'],['cashier','الكاش'],
            ['runner','نقل الطلبات'],['barista','المشروبات'],['support','مساندة'],
            ['opener','الافتتاح'],['closer','الإغلاق']];
var SREASONS=[['manual','إسناد يدوي'],['rotation','دور بالتناوب'],['skill','مهارة مطلوبة'],
              ['coverage_gap','سدّ فجوة تغطية'],['request','بطلب منها'],['training','تدريب'],
              ['auto_schedule','جدولة تلقائية']];
function sRoleName(k){ var n=k||'—'; SROLES.forEach(function(r){ if(r[0]===k) n=r[1]; }); return n; }
var TRSTAT={created:'جديد', practiced:'تم التطبيق', tested:'تم الاختبار', approved:'معتمد'};

/* ============================ شاشة الدخول ============================ */
var logoTaps=0, logoTapT=null;
function renderLogin(){
  document.body.className='no-nav';
  APP.innerHTML =
    '<div class="login-hero">'+
      '<div class="logo hero" id="loginLogo">'+logoImg(160)+'</div>'+
      '<h1 style="font-size:24px;margin:0">ريحانة</h1>'+
      '<div style="opacity:.75;font-size:13.5px">نظام التشغيل اليومي</div>'+
    '</div>'+
    '<div class="wrap" style="max-width:420px">'+
      '<div class="card" style="margin-top:-26px;position:relative;z-index:2;border-radius:18px">'+
        '<h3 style="justify-content:center">تسجيل الدخول</h3>'+
        '<label class="f">اسم المستخدم</label><input class="f" id="luU" autocomplete="username" autocapitalize="none" spellcheck="false">'+
        '<label class="f">كلمة السر</label><input class="f" id="luP" type="password" inputmode="numeric" autocomplete="current-password">'+
        '<div class="btnrow"><button class="btn block" id="luGo">دخول</button></div>'+
      '</div>'+
      '<div class="center small" id="devLine" style="margin-top:12px"></div>'+
      '<div class="center small muted" style="margin-top:14px">الجهاز مشترك — الجلسة تُغلق تلقائياً بعد دقائق من عدم الاستخدام.</div>'+
    '</div>';
  // دخول الإدارة: ٥ لمسات على الشعار
  $('#loginLogo').addEventListener('click', function(){
    logoTaps++; clearTimeout(logoTapT);
    logoTapT=setTimeout(function(){ logoTaps=0; },1600);
    if(logoTaps>=5){ logoTaps=0; adminLoginSheet(); }
  });
  function paintDev(dev){
    var el=$('#devLine'); if(!el) return;
    if(dev && dev.valid){
      try{ localStorage.setItem('rko_devlabel', dev.label||''); }catch(e){}
      el.innerHTML='<span class="chip green">جهاز مفعّل: '+esc(dev.label||'جهاز الكافيه')+'</span>';
    } else {
      el.innerHTML='<span class="chip orange">جهاز غير مفعّل</span> <button class="btn sm ghost" id="devAct">تفعيل الجهاز</button>'+
        '<div class="muted small" style="margin-top:4px">تسجيل الحضور يتطلب جهازاً مفعّلاً بحساب من الإدارة</div>';
      var b=$('#devAct'); if(b) b.addEventListener('click', deviceSheet);
    }
  }
  paintDev(devTok() ? {valid:true, label:devLabel()} : null);
  rawRpc('rko_staff','login_list',{device_token:devTok()}).then(function(res){
    if(res && res.ok){
      if(devTok() && !res.device){ try{ localStorage.removeItem('rko_devtok'); localStorage.removeItem('rko_devlabel'); }catch(e){} paintDev(null); }
      else paintDev(res.device);
    }
  }).catch(function(){});
  function go(){
    var u=$('#luU').value.trim(), pw=$('#luP').value;
    if(!u || !pw){ toast('أدخلي اسم المستخدم وكلمة السر', true); return; }
    busyWrap($('#luGo'), function(){
      return rpc('rko_staff','login',{username:u, password:pw, device:devId(), device_token:devTok()}).then(function(res){
        if(!res.ok){ toast(res.error||'خطأ', true, res.device_locked?6000:0); $('#luP').value=''; return; }
        S.token=res.token; S.role='staff'; S.me=res.me; saveSess(); startStaff();
      });
    });
  }
  $('#luGo').addEventListener('click', go);
  [$('#luU'),$('#luP')].forEach(function(i){ i.addEventListener('keydown', function(e){ if(e.key==='Enter') go(); }); });
}
function deviceSheet(){
  sheet('تفعيل جهاز الكافيه',
    '<div class="muted small">حساب الجهاز تنشئه الإدارة من قسم «أجهزة الكافيه» — يُدخل مرة واحدة على هذا الجهاز فقط.</div>'+
    '<label class="f">اسم مستخدم الجهاز</label><input class="f" id="dvU" autocapitalize="none" spellcheck="false">'+
    '<label class="f">كلمة سر الجهاز</label><input class="f" id="dvP" type="password">'+
    '<div class="btnrow"><button class="btn block" id="dvGo">تفعيل</button></div>',
    function(ov, close){
      $('#dvGo',ov).addEventListener('click', function(){
        var u=$('#dvU',ov).value.trim(), pw=$('#dvP',ov).value;
        if(!u || !pw){ toast('أدخلي بيانات حساب الجهاز', true); return; }
        busyWrap(this, function(){
          return rawRpc('rko_staff','device_login',{username:u, password:pw}).then(function(res){
            if(!res.ok){ toast(res.error||'خطأ', true); return; }
            try{ localStorage.setItem('rko_devtok', res.device_token); localStorage.setItem('rko_devlabel', res.label||''); }catch(e){}
            close(); toast('فُعّل الجهاز ✔'); renderLogin();
          });
        });
      });
    });
}
function adminLoginSheet(){
  sheet('دخول الإدارة',
    '<label class="f">كلمة سر الإدارة</label><input class="f" id="ap" type="password" autocomplete="off">'+
    '<div class="btnrow"><button class="btn orange block" id="ago">دخول</button></div>',
    function(ov, close){
      var inp=$('#ap',ov); setTimeout(function(){ inp.focus(); },100);
      function go(){
        if(!inp.value){ toast('أدخلي كلمة السر', true); return; }
        busyWrap($('#ago',ov), function(){
          return rpc('rko_admin','login',{password:inp.value}).then(function(res){
            if(!res.ok){ toast(res.error||'خطأ', true); inp.value=''; return; }
            S.token=res.token; S.role='admin'; S.me=res.me; saveSess(); close(); startAdmin();
          });
        });
      }
      $('#ago',ov).addEventListener('click', go);
      inp.addEventListener('keydown', function(e){ if(e.key==='Enter') go(); });
    });
}

/* ============================ واجهة الموظفة ============================ */
var tickT=null;
function initPullRefresh(){
  if(initPullRefresh._done) return; initPullRefresh._done=true;
  var ptr=document.createElement('div'); ptr.id='ptr';
  ptr.innerHTML='<div class="ptr-c">'+IC.refresh+'</div>';
  document.body.appendChild(ptr);
  var startY=0, pulling=false, dy=0, TH=72;
  function sc(){ return document.scrollingElement||document.documentElement; }
  function reset(){ ptr.className=''; ptr.style.transform='translateY(-56px)'; }
  document.addEventListener('touchstart', function(e){
    if(S.role!=='staff' || sc().scrollTop>4 || e.touches.length!==1){ pulling=false; return; }
    startY=e.touches[0].clientY; pulling=true; dy=0;
  }, {passive:true});
  document.addEventListener('touchmove', function(e){
    if(!pulling) return;
    dy=e.touches[0].clientY-startY;
    if(dy<=0 || sc().scrollTop>4){ reset(); if(sc().scrollTop>4) pulling=false; return; }
    var pull=Math.min(dy*0.5, 80);
    ptr.classList.add('on'); ptr.classList.toggle('ready', dy>TH);
    ptr.style.transform='translateY('+(pull-56)+'px)';
    var ic=ptr.querySelector('svg'); if(ic) ic.style.transform='rotate('+Math.min(dy*2,540)+'deg)';
  }, {passive:true});
  document.addEventListener('touchend', function(){
    if(!pulling) return; pulling=false;
    if(dy>TH){
      ptr.classList.add('spin','on'); ptr.style.transform='translateY(8px)';
      if(navigator.vibrate) navigator.vibrate(14);
      refresh(); qSync(); loadNotifs();
      setTimeout(reset, 850);
    } else reset();
    dy=0;
  }, {passive:true});
}
function startStaff(){
  document.body.className='';
  S.tab='now';
  APP.innerHTML =
    /* الترويسة كانت تعيد الاسم والشفت والمنطقة والتاريخ — وكلّها تظهر
       في كتل الشاشة تحتها مباشرة. أربعة أسطر تُقرأ مرّتين تأكل خُمس
       الشاشة. بقي فيها ما لا يتكرّر: التحية والزرّان. */
    '<div class="top"><div class="brand"><div class="logo">'+brandMark(42)+'</div><div class="binfo"><h1 id="hiName"></h1></div></div>'+
    '<div class="left"><span class="presdot" id="presDot" title="تأكيد التواجد"></span><span class="dot" id="syncdot"></span><button class="pill icbtn bellbtn" id="bellBtn" aria-label="الإشعارات">'+IC.bell+'<span class="bellcount" id="bellCount"></span></button><button class="pill icbtn" id="rfBtn" aria-label="تحديث">'+IC.refresh+'</button></div></div>'+
    '<div class="wrap" id="view"></div>'+
    /* زر التخاطب كان طبقةً عائمة فوق المحتوى، فكان يغطّي نصوص البطاقات
       وأزرارها أثناء التمرير — وهو ما ظهر في الشاشة المُبلَّغة. وُضع الآن
       داخل شريط التنقّل نفسه: لا طبقة عائمة، فلا احتمال تغطية أصلاً، وهو
       عند الإبهام حيث اليد أساساً. ومحدّد المستهدَف انتقل إلى ورقة الضغط
       المطوّل بدل شريحة عائمة ثانية. */
    /* ثلاثة تبويبات لا خمسة. «المهام» صار داخل «الآن» — المهمة الحالية
       والتالية هما كل ما تحتاجه الموظفة، وقائمة المهام الكاملة ورقةٌ
       تُفتح عند الحاجة لا تبويبٌ دائم. و«الشفت» اندمج في كتلة الحالة
       أعلى «الآن». والتخاطب الصوتي أُخرج من الشريط. */
    '<nav class="bottom">'+
      '<button data-t="now"><span class="ic">'+IC.home+'</span>الآن</button>'+
      '<button data-t="floor"><span class="ic">'+TIC.map+'</span>الصالة</button>'+
      '<button data-t="more"><span class="ic">'+IC.more+'</span>المزيد</button>'+
    '</nav>'+
    '<div id="pttToast" class="ptt-toast"></div>';
  var hh=new Date().getHours();
  $('#hiName').textContent=(hh<12?'صباح الخير ':hh<17?'نهارك سعيد ':'مساء الخير ')+(S.me?S.me.name:'');
  $('#rfBtn').addEventListener('click', function(){
    var b=this; b.classList.add('spin');
    refresh(); qSync(); loadNotifs();
    setTimeout(function(){ b.classList.remove('spin'); }, 900);
  });
  $('#bellBtn').addEventListener('click', openNotifs);
  var _th=$('#thBtn'); if(_th) _th.addEventListener('click', toggleTheme);
  loadNotifs();
  clearInterval(notifT); notifT=setInterval(loadNotifs, 90000);
  $$('nav.bottom button').forEach(function(b){
    b.addEventListener('click', function(){ S.tab=b.getAttribute('data-t'); paintTabs(); drawTab(); });
  });
  updateDot(); idleReset(); paintTabs(); initPullRefresh();
  // كاش آخر حالة لعرض فوري
  try{ var c=JSON.parse(localStorage.getItem('rko_state')||'null'); if(c){ S.state=c; drawTab(); } }catch(e){}
  // أثناء أول تحميل بلا كاش: هيكل تحميل (.sk) بدل شاشة فاضية
  if(!S.state){ var _sv=$('#view'); if(_sv) _sv.innerHTML='<section class="today"><div class="sk sk--block"></div><div class="sk sk--block"></div><div class="sk sk--block"></div></section>'; }
  refresh();
  /* updateTimers لا يمسّ إلا ‎.timer‎ (ثوانٍ)، وtmTick يمسّ ‎.tdur‎ (دقائق).
     كان الثاني بلا محرّك خارج ورقة الطاولة، فيبقى «منذ كم» ثابتاً — وعدّاد
     المساندة الجارية يظهر فارغاً أصلاً لأن نصّه يُكتب من النبضة وحدها. */
  clearInterval(tickT); tickT=setInterval(function(){
    if(S.role!=='staff') return;
    if(S.tab==='tasks'||S.tab==='now'||S.tab==='shift'||S.tab==='floor'){ updateTimers(); tmTick(); }
  }, 1000);
  startPresence();
  pttInit();
  qSync();
}
function paintTabs(){
  $$('nav.bottom button').forEach(function(b){ b.className = b.getAttribute('data-t')===S.tab ? 'on' : ''; });
}

/* ============ التخاطب الصوتي المباشر بين الموظفات (Push-to-Talk) ============ */
var PTT = { rec:null, chunks:[], stream:null, since:0, primed:false, playing:false, queue:[], timer:null, recording:false, t0:0, unlock:null, target:{t:'all',label:'الجميع'} };
function pttSupported(){ return recSupported(); }
function pttInit(){
  var btn=$('#pttBtn'); if(!btn) return;
  if(!pttSupported()){ btn.style.display='none'; return; }
  PTT.queue=[]; PTT.playing=false; PTT.primed=false;
  var down=function(e){ if(e){ e.preventDefault(); try{ if(e.pointerId!=null) btn.setPointerCapture(e.pointerId); }catch(_){} } pttUnlock(); pttStart(); };
  var up=function(e){ if(e){ e.preventDefault(); } pttStop(); };
  btn.onpointerdown=down; btn.onpointerup=up;
  btn.onpointercancel=up;
  // احتياط: أي إفلات في أي مكان يُنهي التسجيل (لو خرج الإصبع عن الزر)
  if(!PTT.upbound){ PTT.upbound=true; window.addEventListener('pointerup', function(){ if(PTT.recording) pttStop(); }, true); }
  var tg=$('#pttTarget'); if(tg) tg.onclick=pttPickTarget;   /* صار داخل ورقة الاستهداف */
  pttUpdateTarget();
  // فتح قفل الصوت عند أول لمسة في أي مكان — ليسمع الفريق النداءات الواردة تلقائياً
  if(!PTT.gbound){ PTT.gbound=true; document.addEventListener('pointerdown', pttUnlock, true); document.addEventListener('touchstart', pttUnlock, true); }
  clearInterval(PTT.timer); PTT.timer=setInterval(pttPollTick, 2500); pttPollTick();
}
function pttUpdateTarget(){ var b=$('#pttTarget'); if(!b) return; var tg=PTT.target||{t:'all'};
  b.textContent = tg.t==='all' ? 'الجميع' : (tg.t==='area' ? ('منطقة: '+(tg.label||'')) : ('لـ '+(tg.label||''))); }
function pttPickTarget(){
  pttUnlock();
  sAct('ptt_targets',{}).then(function(r){
    if(!r || !r.ok){ toast('التخاطب متاح أثناء شفتك', true); return; }
    var opts=[['all','الجميع — كل من على الشفت']];
    (r.areas||[]).forEach(function(a){ opts.push(['area:'+a.id+':'+a.name, 'منطقة: '+a.name]); });
    (r.mates||[]).forEach(function(m){ opts.push(['emp:'+m.id+':'+m.name, 'زميلة: '+m.name]); });
    var html='<div class="muted small" style="margin-bottom:8px">اختاري من يسمع رسالتك الصوتية</div>'+
      opts.map(function(o){ return '<button class="btn ghost block pttopt" data-v="'+esc(o[0])+'" style="margin-bottom:8px;justify-content:flex-start">'+esc(o[1])+'</button>'; }).join('');
    sheet('من يسمع؟', html, function(ov, close){
      $$('.pttopt',ov).forEach(function(b){ b.addEventListener('click', function(){
        var v=b.getAttribute('data-v');
        if(v==='all') PTT.target={t:'all',label:'الجميع'};
        else { var parts=v.split(':'); PTT.target={t:(parts[0]==='area'?'area':'emp'), id:+parts[1], label:parts.slice(2).join(':')}; }
        pttUpdateTarget(); close();
      }); });
    });
  });
}
function pttUnlock(){
  try{
    if(!PTT.actx){ var AC=window.AudioContext||window.webkitAudioContext; if(AC) PTT.actx=new AC(); }
    if(PTT.actx && PTT.actx.state==='suspended') PTT.actx.resume();
    // إلغاء قفل تشغيل الصوت على الجوال بتشغيل نغمة صامتة داخل إيماءة المستخدم
    if(!PTT.unlock){ PTT.unlock=new Audio('data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTEFNRTMuOTkuNVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV'); PTT.unlock.volume=0; }
    var pr=PTT.unlock.play(); if(pr&&pr.catch) pr.catch(function(){});
    PTT.audioOK=true;
  }catch(e){}
}
/* ===== مسجّل WAV مشترك — يُسجَّل ويُشغَّل على كل الأجهزة (آيفون/أندرويد) ===== */
var REC=null, WAVSR=12000;
function recSupported(){ return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext||window.webkitAudioContext)); }
function recStart(){
  return navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
    var AC=window.AudioContext||window.webkitAudioContext; var ac=new AC();
    if(ac.state==='suspended'){ try{ ac.resume(); }catch(e){} }
    var src=ac.createMediaStreamSource(stream);
    var proc=ac.createScriptProcessor?ac.createScriptProcessor(4096,1,1):ac.createJavaScriptNode(4096,1,1);
    var gain=ac.createGain(); gain.gain.value=0; var bufs=[];
    proc.onaudioprocess=function(e){ bufs.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    src.connect(proc); proc.connect(gain); gain.connect(ac.destination);
    REC={stream:stream,ac:ac,src:src,proc:proc,gain:gain,bufs:bufs,sr:ac.sampleRate,active:true};
    return true;
  });
}
function recStop(){
  var r=REC; REC=null; if(!r || !r.active) return null; r.active=false;
  try{ r.proc.onaudioprocess=null; r.proc.disconnect(); r.gain.disconnect(); r.src.disconnect(); }catch(e){}
  if(r.stream){ try{ r.stream.getTracks().forEach(function(t){t.stop();}); }catch(e){} }
  var len=0,i; for(i=0;i<r.bufs.length;i++) len+=r.bufs[i].length;
  var flat=new Float32Array(len), off=0; for(i=0;i<r.bufs.length;i++){ flat.set(r.bufs[i],off); off+=r.bufs[i].length; }
  try{ r.ac.close(); }catch(e){}
  if(!flat.length) return null;
  return recWav(recDownsample(flat, r.sr, WAVSR), WAVSR);
}
function recDownsample(buf, from, to){ if(to>=from) return buf; var ratio=from/to, nlen=Math.floor(buf.length/ratio), out=new Float32Array(nlen);
  for(var i=0;i<nlen;i++){ var s=Math.floor(i*ratio), e=Math.floor((i+1)*ratio), sum=0,c=0; for(var j=s;j<e&&j<buf.length;j++){ sum+=buf[j]; c++; } out[i]=c?sum/c:0; } return out; }
function recWav(samples, sr){ var n=samples.length, buf=new ArrayBuffer(44+n*2), v=new DataView(buf);
  function w(o,s){ for(var i=0;i<s.length;i++) v.setUint8(o+i,s.charCodeAt(i)); }
  w(0,'RIFF'); v.setUint32(4,36+n*2,true); w(8,'WAVE'); w(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); w(36,'data'); v.setUint32(40,n*2,true);
  var off=44; for(var i=0;i<n;i++){ var s=Math.max(-1,Math.min(1,samples[i])); v.setInt16(off, s<0?s*0x8000:s*0x7FFF, true); off+=2; }
  var bytes=new Uint8Array(buf), bin='', CH=0x8000; for(var k=0;k<bytes.length;k+=CH){ bin+=String.fromCharCode.apply(null, bytes.subarray(k,k+CH)); }
  return 'data:audio/wav;base64,'+btoa(bin);
}
function recOverlay(on){ var o=document.getElementById('recOverlay');
  if(on){ if(!o){ o=document.createElement('div'); o.id='recOverlay'; o.innerHTML='<div class="rec-card"><div class="rec-mic">'+IC.mic+'</div><div class="rec-txt">يسجّل صوتك…</div><div class="rec-sub">أفلتي الزر للإرسال</div></div>'; document.body.appendChild(o); } o.className='rec-ov show'; }
  else if(o){ o.className='rec-ov'; } }

/* ===== حقل مذكرة صوتية مشترك (التسليم/البلاغات/الملاحظات) — ضغطة للبدء وضغطة للإيقاف ===== */
var VOICE={};
/* مفتاح المذكرة في التخزين الخاص بعد رفعها — هو ما يُرسل للخادم، لا الصوت نفسه */
var VOICEK={};
/* ما يُرسل مع الطلب: المفتاح إن نجح الرفع، وإلا الصوت نفسه كي لا تضيع المذكرة */
function voicePayload(id){
  return VOICEK[id] ? { voice_key: VOICEK[id] } : (VOICE[id] ? { voice: VOICE[id] } : {});
}
function voiceFieldHtml(id, label){
  return '<div class="vnote" id="vn_'+id+'">'+
    '<button type="button" class="vn-rec">'+IC.mic+'<span class="vn-lab">'+esc(label||'أضيفي مذكرة صوتية')+'</span></button>'+
    '<div class="vn-body" style="display:none"><audio class="vn-audio" controls preload="none"></audio>'+
    '<button type="button" class="vn-del">حذف</button></div></div>';
}
function voiceReset(scope, id){
  VOICE[id]=null; VOICEK[id]=null;
  var w=scope?$('#vn_'+id,scope):$('#vn_'+id); if(!w) return;
  var b=$('.vn-body',w); if(b) b.style.display='none';
  var a=$('.vn-audio',w); if(a){ try{a.pause();}catch(e){} a.removeAttribute('src'); }
  var l=$('.vn-lab',w); if(l) l.textContent='أضيفي مذكرة صوتية';
  var btn=$('.vn-rec',w); if(btn) btn.classList.remove('on');
}
function voiceWire(scope, id){
  VOICE[id]=null; VOICEK[id]=null;
  var w=scope?$('#vn_'+id,scope):$('#vn_'+id); if(!w) return;
  var btn=$('.vn-rec',w), lab=$('.vn-lab',w), body=$('.vn-body',w), au=$('.vn-audio',w), del=$('.vn-del',w);
  if(!recSupported()){ if(btn) btn.disabled=true; if(lab) lab.textContent='التسجيل الصوتي غير مدعوم على هذا المتصفح'; return; }
  var rec=false, t0=0, tick=null, maxT=null, base='أضيفي مذكرة صوتية';
  function fmt(s){ var m=Math.floor(s/60), ss=s%60; return m+':'+(ss<10?'0':'')+ss; }
  function paint(){ lab.textContent='● يسجّل '+fmt(Math.floor((Date.now()-t0)/1000))+' — اضغطي للإيقاف'; }
  function start(){
    if(rec) return;
    if(REC){ try{ recStop(); }catch(e){} }
    rec=true; t0=Date.now(); btn.classList.add('on'); paint();
    tick=setInterval(paint,500);
    maxT=setTimeout(function(){ if(rec) stop(); }, 60000);
    recStart().catch(function(){ rec=false; clearInterval(tick); clearTimeout(maxT); btn.classList.remove('on'); lab.textContent='تعذّر الوصول للميكروفون — اسمحي به وأعيدي المحاولة'; });
  }
  function stop(){
    if(!rec) return; rec=false; clearInterval(tick); clearTimeout(maxT); btn.classList.remove('on'); lab.textContent=base;
    var dur=(Date.now()-t0)/1000, wav=recStop();
    if(!wav || dur<0.4){ toast('تسجيل قصير جداً', true); return; }
    VOICE[id]=wav; VOICEK[id]=null; au.src=wav; body.style.display='flex';
    /* ترفع المذكرة للتخزين الخاص فور انتهاء التسجيل، فلا ينتظر الإرسال لاحقاً */
    lab.textContent='يُحفَظ التسجيل…';
    mediaPut('aud', wav, 'voice:'+id).then(
      function(k){ if(VOICE[id]===wav){ VOICEK[id]=k; } lab.textContent=base; },
      function(){ lab.textContent=base; });
  }
  btn.addEventListener('click', function(){ rec?stop():start(); });
  if(del) del.addEventListener('click', function(){ voiceReset(scope,id); });
}
function voicePlayHtml(dataUrl, cap){
  if(!dataUrl) return '';
  var slot = mediaSlot('aud', dataUrl);
  if(!slot) return '';
  return '<div class="vn-play"><span class="vn-ic">'+IC.mic+'</span>'+slot+(cap?'<span class="vn-cap">'+esc(cap)+'</span>':'')+'</div>';
}

/* ===== بطاقة تسليم الشفت الذكية — تُبنى من أحداث اليوم الفعلية ===== */
function prepRemainShort(mins){
  mins=+mins||0;
  if(mins<=0) return '(منتهية)';
  if(mins<60) return '('+mins+' د)';
  var h=Math.floor(mins/60), m=mins%60;
  return '('+h+' س'+(m?' '+m+' د':'')+')';
}
function handoverBriefCard(b, receiver){
  if(!b || !b.shift) return '';
  var rows=[], first=' first';
  function row(k,v){ rows.push('<div class="hb-row'+first+'"><span class="hb-k">'+k+'</span><span class="hb-v">'+v+'</span></div>'); first=''; }
  var left=(b.tasks_left||[]);
  row('المهام', (b.tasks_done||0)+' منجزة'+(left.length?' · <b class="warn">'+left.length+' متبقّية</b>':' · لا متبقّي'));
  if(left.length) rows.push('<div class="hb-sub">'+left.slice(0,8).map(function(t){return '<span class="chip '+(t.phase==='closing'?'red':'')+'">'+esc(t.name)+'</span>';}).join(' ')+'</div>');
  if(b.recurring_done) row('الروتين', b.recurring_done+' مهمة اليوم');
  var iss=(b.issues||[]);
  if(iss.length){ row('بلاغات مفتوحة', '<b class="warn">'+iss.length+'</b>');
    rows.push('<div class="hb-sub">'+iss.slice(0,6).map(function(i){return '<span class="chip '+(i.priority==='high'?'red':'')+'">'+esc(i.title)+'</span>';}).join(' ')+'</div>'); }
  var prep=(b.prep||[]);
  if(prep.length){ var soon=prep.filter(function(p){return p.soon;});
    row('التحضيرات', prep.length+' شاف فعّال'+(soon.length?' · <b class="warn">'+soon.length+' قرب الانتهاء</b>':''));
    rows.push('<div class="hb-sub">'+prep.slice(0,8).map(function(p){return '<span class="chip '+(p.soon?'red':'')+'">'+esc(p.name)+' '+prepRemainShort(p.mins_left)+'</span>';}).join(' ')+'</div>'); }
  if((b.logbook||[]).length) row('سجل الشفت', b.logbook.length+' مدخل');
  if(b.help) row('طلبات مساعدة', b.help);
  if(b.pressure) row('ملاحظة', '<b class="warn">كان في ضغط/تكدّس اليوم</b>');
  return '<div class="card hb"><div class="hb-h"><span>بطاقة تسليم الشفت الذكية</span><span class="hb-badge">تلقائي من أحداث اليوم</span></div>'+
    (b.shift?'<div class="hb-shift">'+esc(b.shift)+'</div>':'')+rows.join('')+
    '<div class="hb-note">'+(receiver?'هذا ملخّص الشفت الذي تسلّمتِه — مبنيّ تلقائياً من النظام.':'ملخّص يُبنى تلقائياً من النظام ويُرفق مع تسليمك — راجعيه وأضيفي ما يلزم بالأسفل.')+'</div></div>';
}
function handoverPrefill(b){
  var pre={};
  var left=(b.tasks_left||[]);
  if(left.length) pre.pending=left.slice(0,8).map(function(t){return t.name;}).join('، ');
  var notes=[];
  var soon=(b.prep||[]).filter(function(p){return p.soon;});
  if(soon.length) notes.push('تحضيرات قرب الانتهاء: '+soon.map(function(p){return p.name;}).join('، '));
  if((b.issues||[]).length) notes.push('بلاغات مفتوحة: '+b.issues.map(function(i){return i.title;}).join('، '));
  if(b.pressure) notes.push('كان في ضغط اليوم');
  if(notes.length) pre.notes=notes.join(' — ');
  return pre;
}

function pttStart(){
  if(PTT.recording) return;
  if(!recSupported()){ toast('التسجيل غير مدعوم على هذا المتصفح', true); return; }
  PTT.recording=true; PTT.t0=Date.now(); recOverlay(true);
  var btn=$('#pttBtn'); if(btn) btn.classList.add('rec');
  clearTimeout(PTT._max); PTT._max=setTimeout(function(){ if(PTT.recording) pttStop(); }, 15000);
  recStart().then(function(){ if(!PTT.recording){ recStop(); recOverlay(false); } })
   .catch(function(){ PTT.recording=false; recOverlay(false); var b=$('#pttBtn'); if(b) b.classList.remove('rec'); toast('اسمحي بالوصول للميكروفون لاستخدام التخاطب', true); });
}
function pttStop(){
  if(!PTT.recording) return;
  PTT.recording=false; clearTimeout(PTT._max);
  var btn=$('#pttBtn'); if(btn) btn.classList.remove('rec'); recOverlay(false);
  var dur=(Date.now()-PTT.t0)/1000; var wav=recStop();
  if(!wav || dur<0.35){ return; }
  if(wav.length>420000){ pttFlash('المقطع طويل — اجعليه أقصر'); return; }
  var tg=PTT.target||{t:'all'};
  pttFlash('يُرسل صوتك… ('+(tg.t==='all'?'للجميع':(tg.label||''))+')');
  var area=(S.state && S.state.shift && S.state.shift.area_id) || null;
  sAct('ptt_send', {audio:wav, dur:Math.round(dur*10)/10, area_id:area,
    to_emp:(tg.t==='emp'?tg.id:null), to_area:(tg.t==='area'?tg.id:null)}, false).then(function(r){
    if(r && r.ok){ pttFlash('وصل صوتك ✓'); if(r.id && r.id>PTT.since) PTT.since=r.id; }
    else pttFlash((r&&r.error)||'تعذّر الإرسال');
  }).catch(function(){ pttFlash('لا اتصال — أعيدي المحاولة'); });
}
function pttPollTick(){
  if(S.role!=='staff'){ clearInterval(PTT.timer); return; }
  sAct('ptt_poll', {since:PTT.since}).then(function(r){
    if(!r || !r.ok) return;
    var tgb=$('#pttTarget'); if(tgb) tgb.style.opacity = r.off ? '.5' : '1';
    PTT.off = !!r.off;
    if(!PTT.primed){ PTT.primed=true; if(typeof r.last==='number') PTT.since=r.last; return; }
    (r.clips||[]).forEach(function(c){ PTT.queue.push(c); });
    if(typeof r.last==='number' && r.last>PTT.since) PTT.since=r.last;
    pttDrain();
  }).catch(function(){});
}
function pttDrain(){
  if(PTT.playing || !PTT.queue.length) return;
  var c=PTT.queue.shift(); PTT.playing=true;
  var btn=$('#pttBtn'); if(btn) btn.classList.add('speaking');
  pttFlash((c.direct?'رسالة خاصة من ':'يتحدّث ')+esc(c.from)+(c.area?' · '+esc(c.area):''));
  var done=function(){ PTT.playing=false; if(btn) btn.classList.remove('speaking'); pttDrain(); };
  var a=new Audio(c.audio); a.onended=done; a.onerror=done;
  var pr=a.play();
  if(pr && pr.catch) pr.catch(function(){ if(btn) btn.classList.remove('speaking'); pttTapToPlay(c, done); });
}
function pttTapToPlay(c, done){
  var t=$('#pttToast'); if(!t){ done(); return; }
  clearTimeout(PTT._ft);
  t.innerHTML='▶ اضغطي لسماع رسالة '+esc(c.from);
  t.classList.add('show','tap');
  t.onclick=function(){ t.onclick=null; t.classList.remove('tap'); pttUnlock();
    var a=new Audio(c.audio); a.onended=done; a.onerror=done; var p=a.play(); if(p&&p.catch) p.catch(function(){ done(); });
    clearTimeout(PTT._ft); PTT._ft=setTimeout(function(){ t.classList.remove('show'); }, 800); };
}
function pttFlash(msg){ var t=$('#pttToast'); if(!t) return; t.onclick=null; t.classList.remove('tap'); t.innerHTML=msg; t.classList.add('show'); clearTimeout(PTT._ft); PTT._ft=setTimeout(function(){ t.classList.remove('show'); }, 2800); }
var notifT=null, notifCache=[];
function applyTheme(t){ try{ if(t) localStorage.setItem('rko_theme', t); }catch(e){} var m=t||curTheme();
  var root=document.documentElement;
  if(m==='auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', m);
  var meta=document.querySelector('meta[name=theme-color]'); if(meta) meta.setAttribute('content', (m==='dark'||(m==='auto'&&window.matchMedia&&matchMedia('(prefers-color-scheme:dark)').matches))?'#14110D':'#274233');
}
function curTheme(){ try{ return localStorage.getItem('rko_theme')||'auto'; }catch(e){ return 'auto'; } }
function sysDark(){ return !!(window.matchMedia && matchMedia('(prefers-color-scheme:dark)').matches); }
function effDark(){ var t=curTheme(); if(t==='dark') return true; if(t==='light') return false; return sysDark(); }
function toggleTheme(){ var nx = effDark() ? 'light' : 'dark'; applyTheme(nx); toast(nx==='dark'?'الوضع الليلي':'الوضع النهاري'); var b=$('#thBtn'); if(b) b.innerHTML=THI(); var b2=$('#thBtnA'); if(b2) b2.innerHTML=THI(); }
function THI(){ return effDark()?IC.sun:IC.moon; }
function loadNotifs(){
  if(S.role!=='staff') return;
  pushGate();                                               // بوابة إجبارية: تفعيل الإشعارات قبل العمل
  sAct('notif_list',{}).then(function(res){
    if(!res.ok) return;
    notifCache=res.rows||[];
    var c=$('#bellCount'); if(c){ c.textContent=res.unread>0?(res.unread>9?'9+':res.unread):''; c.style.display=res.unread>0?'flex':'none'; }
  }).catch(function(){});
}
/* وجهة الإشعار: ما الشاشة التي يتحدث عنها، وكيف نصل إليها بضغطة واحدة */
var NTGO = {shift:'جدول شفتاتي', tasks:'مهامي', cover:'الطلبات والتغطية', handover:'الطلبات والتغطية',
            requests:'الطلبات والتغطية', issues:'البلاغات', contrib:'شاشة اليوم',
            tables:'شاشة اليوم', grow:'تطوّري', now:'شاشة اليوم'};
function notifGo(t){
  if(t === 'shift' || t === 'tasks' || t === 'grow' || t === 'now'){
    S.tab = t; paintTabs(); drawTab(); return;
  }
  /* الباقي أقسام داخل «المزيد» — نفتح القسم مباشرة لا قائمته */
  var sec = {cover:'requests', requests:'requests', handover:'requests',
             issues:'issues', contrib:null, tables:null}[t];
  if(!sec){ S.tab = 'now'; paintTabs(); drawTab(); return; }
  S.tab = 'more'; S.moreSec = sec; paintTabs(); drawTab();
}
function openNotifs(){
  var pushRow = ('Notification' in window && Notification.permission!=='granted')
    ? '<div class="btnrow"><button class="btn ghost sm block" id="notifPush">تفعيل الإشعارات على هذا الجهاز</button></div>' : '';
  sheet('الإشعارات',
    pushRow +
    (notifCache.length ? notifCache.map(function(n, i){
      /* الإشعار يفتح الشاشة التي يتحدث عنها بدل أن يترك الموظفة تبحث عنها */
      return '<button class="ncard'+(n.read?' seen':'')+'" data-nt="'+i+'">'+
        '<span class="nc-t"><b>'+esc(n.title)+'</b>'+(n.read?'':'<span class="chip orange">جديد</span>')+'</span>'+
        (n.body?'<span class="nc-b">'+esc(n.body)+'</span>':'')+
        '<span class="nc-f"><span class="muted small">'+fmtD(n.ts)+' '+fmtT(n.ts)+'</span>'+
        (n.target?'<span class="nc-go">'+esc(NTGO[n.target]||'افتحي')+'</span>':'')+'</span></button>';
    }).join('') : '<div class="empty">لا إشعارات</div>'),
    function(ov, close){
      var pb=$('#notifPush',ov); if(pb) pb.addEventListener('click', function(){ enablePush((S.state&&S.state.push&&S.state.push.vapid_public)||PUSHKEY, function(){}); });
      $$('[data-nt]',ov).forEach(function(b){ b.addEventListener('click', function(){
        var n=notifCache[+b.getAttribute('data-nt')]; if(!n||!n.target) return;
        close(); notifGo(n.target);
      });});
    });
  sAct('notif_read',{}).then(function(){ loadNotifs(); });
}
/* فحص نشاط سريع مُعلن: يظهر في وقت غير متوقّع ويطلب إثبات عمل حقيقي (صورة منطقتك الآن) خلال مهلة قصيرة */
var scOpen=false;
function showSpotcheck(sc){
  if(!sc || !sc.id || scOpen) return;
  scOpen=true;
  var secs=sc.seconds_left||480, timerEl;
  var close=sheet('فحص نشاط سريع',
    '<div class="muted small">هذا الفحص يظهر في أوقات غير متوقّعة أثناء شفتك. صوّري منطقتك/محطتك الآن لإثبات نشاطك. مهلة: <b id="scTimer">'+secFmt(secs)+'</b></div>'+
    '<div class="btnrow"><button class="btn block" id="scGo">تصوير منطقتي الآن</button></div>'+
    '<div class="small muted center" style="margin-top:6px">تجاهل الفحص يُسجَّل للإدارة (بلا عقوبة تلقائية).</div>',
    function(ov, closeFn){
      timerEl=$('#scTimer',ov);
      $('#scGo',ov).addEventListener('click', function(){
        cameraSheet({facing:'environment', title:'صورة إثبات النشاط', watermark:(S.me?S.me.name:'')+' · فحص نشاط'},
          function(d){
            function send(p){
              sAct('spotcheck_answer', p, false).then(function(res){
                if(res.ok){ toast(res.msg||'سُجّل نشاطك ✔'); scDone(); refresh(); }
                else toast(res.error||'خطأ', true);
              });
            }
            mediaPut('img', d, 'spotcheck').then(
              function(k){ send({id:sc.id, photo_key:k}); },
              function(){ send({id:sc.id, photo:d}); });
          });
      });
    });
  function scDone(){ scOpen=false; clearInterval(scT); if(close) close(); }
  var scT=setInterval(function(){
    secs--; if(timerEl) timerEl.textContent=secFmt(Math.max(0,secs));
    if(secs<=0){ clearInterval(scT); }
  }, 1000);
  // إن أغلقتها الموظفة يدوياً نُبقي الحالة قابلة لإعادة الظهور بالنبضة التالية
  scOpen=true;
  window._scReset=function(){ scOpen=false; clearInterval(scT); };
}
function maybeSpotcheck(sc){ if(sc && sc.id && !scOpen) showSpotcheck(sc); }

/* تأكيد تواجد شفّاف ومُعلن: أثناء الشفت فقط، ومؤشر ظاهر للموظفة نفسها. لا تتبع خارج الدوام. */
var hbT=null, hbGuard=null;
function setPresenceDot(state){
  var d=$('#presDot'); if(!d) return;
  d.className='presdot '+(state||'');
  d.title = state==='in' ? 'داخل نطاق الكافيه' : state==='out' ? 'خارج نطاق الكافيه' : 'يُحدَّث…';
}
function beat(){
  if(S.role!=='staff' || !S.token) return;
  var st=S.state, sh=st&&st.shift, att=st&&st.attendance;
  if(!sh || !att || !att['in'] || att.out){ setPresenceDot(''); return; } // فقط بعد الحضور وقبل الانصراف
  if(document.hidden) return;
  var g=(st&&st.guard)||hbGuard;
  getGeo(function(geo){
    var inGeo=null;
    if(g && g.lat && geo){
      var R=6371000, dLat=(geo.lat-g.lat)*Math.PI/180, dLng=(geo.lng-g.lng)*Math.PI/180;
      var aa=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(g.lat*Math.PI/180)*Math.cos(geo.lat*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
      inGeo=(2*R*Math.asin(Math.sqrt(aa))) <= (g.radius_m||250);
    }
    setPresenceDot(inGeo===false?'out':'in'); idleReset();
    sAct('heartbeat',{geo:geo, in_geo:inGeo, batt:window._battPct}, false).then(function(res){ if(res&&res.spotcheck) maybeSpotcheck(res.spotcheck); }).catch(function(){});
  });
}
/* مستوى بطارية الجهاز يُرافق نبضة التواجد — دليل موضوعي عند ادعاء «انطفأ شحني» */
(function(){ try{ if(navigator.getBattery) navigator.getBattery().then(function(b){
  function upd(){ window._battPct=Math.round(b.level*100); }
  upd(); b.addEventListener('levelchange', upd);
}); }catch(e){} })();
function startPresence(){
  clearInterval(hbT);
  hbT=setInterval(beat, 60000);
  beat();
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) beat(); });
}
function refresh(){
  if(S.role==='staff'){
    sAct('state',{}).then(function(res){
      if(!res.ok){ toast(res.error||'خطأ', true); return; }
      S.state=res; S.cacheTs=Date.now();
      if(res.guard) hbGuard=res.guard;
      if(res.spotcheck) maybeSpotcheck(res.spotcheck); else if(window._scReset) window._scReset();
      try{ localStorage.setItem('rko_state', JSON.stringify(res)); }catch(e){}
      var st=res.shift;
      /* الشفت والمنطقة انتقلا إلى كتلتَي الشاشة، فلا يُكتبان في الترويسة */
      // زر التخاطب يظهر فقط أثناء الشفت وبعد تسجيل الحضور
      var pw=$('#pttWrap'); if(pw){ var a2=res.attendance; pw.style.display=(a2&&a2['in']&&!a2.out)?'':'none'; }
      // نقطة على تبويب الشفت إذا في تسليم وارد
      var sb=$$('nav.bottom button').filter(function(b){return b.getAttribute('data-t')==='shift';})[0];
      if(sb){ if(res.handover_in && !S.stateHandled) sb.classList.add('bdg'); else sb.classList.remove('bdg'); }
      /* محطّة الكاش: شفتها في منطقة الكاش، فصلاحيتها أصلاً كاملة على
         الصالتين. شاشتها الأولى هي اللوحة لا «الآن» — الجهاز ثابتٌ أمامها
         طوال الوقت، ووظيفته أن يُري الأرضية كلها. تحويلٌ مرّة واحدة عند
         أول تحميل فقط، فلا يُصادر اختيارها إن انتقلت بنفسها. */
      if(res.cash_desk && !S.cashHomed){ S.cashHomed=true; S.tab='floor'; paintTabs(); }
      drawTab(); updateDot();
    }).catch(function(){});
  } else if(S.role==='admin'){ drawAdmin(); }
}
function drawTab(){
  var v=$('#view'); if(!v) return;
  /* مغادرة شاشة الأرضية تأكيدٌ ضمنيّ للإجراء المعلّق: يُنفَّذ، ولا يبقى
     شريط التراجع طافياً فوق شاشةٍ لا تخصّه. قبل كل الفروع، فحتى شاشة
     تعذّر التحميل لا تترك شريطاً معلّقاً. */
  if(S.tab!=='floor' && _undoT) _undoT.commit();
  if(!S.state){
    v.innerHTML='<div class="empty">تعذر تحميل بياناتك — تحققي من الاتصال</div><div class="btnrow"><button class="btn ghost block" id="reTry">إعادة المحاولة</button></div>';
    var rb=$('#reTry',v); if(rb) rb.addEventListener('click', function(){ v.innerHTML=skel(3); refresh(); });
    return;
  }
  if(S.tab==='now') v.innerHTML=viewNow();
  else if(S.tab==='tasks') v.innerHTML=viewTasks();
  else if(S.tab==='floor') v.innerHTML=viewFloor();
  else if(S.tab==='shift') v.innerHTML=viewShift();
  else if(S.tab==='grow'){ v.innerHTML=skel(3); loadGrow(v); }
  else v.innerHTML=viewMore();
  wireTab(v); animIn(v);
  if(S.tab==='now'){ loadPrepCard(); loadOpsCard(); loadTablesCard(); loadVerifyCard(); loadContribCard(); loadSignalsCard(); }
  /* وضع ملء الشاشة للأرضية: يختفي الرأس وشريط التنقّل فتأخذ الصالة
     الشاشة كلّها — وهو ما تحتاجه أداةٌ تُفتح عشرات المرات في الشفت. */
  document.body.classList.toggle('floormode', S.tab==='floor');
  if(S.tab==='floor') loadFloor();
  else { clearInterval(FLR.timer); clearInterval(FLR.tick); flrLandscape(false); }
  if($('#vn_nt',v)) voiceWire(v,'nt');
  if($('#vn_is',v)) voiceWire(v,'is');
}
function animIn(el){ if(!el) return; el.classList.remove('vin'); void el.offsetWidth; el.classList.add('vin'); }


/* ================= Realtime: نبضة تغيير بلا بيانات =================
   جداول RKO كلها deny-all، فلا يجوز الاشتراك المباشر بها. نشترك بقناة
   rko_rt_pulse التي تحمل نوع الحدث ومنطقة ومعرّفاً فقط — بلا محتوى —
   ثم نعيد الجلب عبر البوابة. الاستطلاع يبقى احتياطاً بطيئاً. */
var RT = {sock:null, on:false, subs:[], tries:0, timer:null, off:false};

function rtOn(kind, cb){ RT.subs.push({kind:kind, cb:cb}); }
function rtFire(row){
  RT.subs.forEach(function(s){
    if(s.kind === '*' || s.kind === row.kind){ try{ s.cb(row); }catch(e){} }
  });
}
function rtConnect(){
  if(RT.sock || !S.token) return;
  RT.off = false;
  var key = getKey(), url;
  try{ url = CONFIG.SUPABASE_URL.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' +
             encodeURIComponent(key) + '&vsn=1.0.0'; }catch(e){ return; }
  var sock;
  try{ sock = new WebSocket(url); }catch(e){ return; }
  RT.sock = sock;
  var ref = 0, hb;

  sock.onopen = function(){
    RT.on = true; RT.tries = 0;
    sock.send(JSON.stringify({
      topic:'realtime:rko', event:'phx_join', ref:String(++ref),
      payload:{config:{postgres_changes:[{event:'INSERT', schema:'public', table:'rko_rt_pulse'}]}}
    }));
    hb = setInterval(function(){
      if(sock.readyState === 1)
        sock.send(JSON.stringify({topic:'phoenix', event:'heartbeat', payload:{}, ref:String(++ref)}));
    }, 25000);
  };
  sock.onmessage = function(e){
    var m; try{ m = JSON.parse(e.data); }catch(x){ return; }
    if(m.event === 'postgres_changes' && m.payload && m.payload.data && m.payload.data.record){
      rtFire(m.payload.data.record);
    }
  };
  function down(){
    clearInterval(hb); RT.on = false; RT.sock = null;
    if(RT.off) return;                       /* إغلاق مقصود: لا إعادة اتصال */
    /* تراجع أسّي مع سقف — لا نغرق الشبكة */
    RT.tries = Math.min(RT.tries + 1, 6);
    clearTimeout(RT.timer);
    RT.timer = setTimeout(function(){ if(S.token && !document.hidden) rtConnect(); }, 1000 * Math.pow(2, RT.tries));
  }
  sock.onclose = down;
  sock.onerror = function(){ try{ sock.close(); }catch(e){} };
}
/* إغلاق مقصود. كان يُلغي onclose ليمنع إعادة الاتصال، فلا تعمل down ولا
   تُلغى نبضة الـ٢٥ ثانية — فيتراكم مؤقّت معلّق مع كل دورة اتصال/إغلاق.
   الآن ندع down تعمل لتنظّف نفسها، ونمنع إعادة الاتصال براية صريحة. */
function rtStop(){
  clearTimeout(RT.timer);
  RT.off = true;
  if(RT.sock){ try{ RT.sock.close(); }catch(e){} }
  RT.sock = null; RT.on = false; RT.subs = [];
}
document.addEventListener('visibilitychange', function(){
  if(document.hidden) return;
  if(S.token && !RT.sock) rtConnect();
});

/* ================= مركز إدارة الطاولات =================
   أداة تشغيل ضيافة: الحالة والوقت والمسؤولة في أماكن ثابتة، تُقرأ في ثانيتين
   عند 25 طاولة. ليست POS: لا أسعار ولا طلبات ولا مبيعات. */

/* أيقونات Lucide بخط موحّد 1.8 — لا Emoji ولا رموز مخترعة */
var TIC = (function(){
  function s(p, fill){
    return '<svg viewBox="0 0 24 24" fill="'+(fill||'none')+'" stroke="currentColor" stroke-width="1.8" '+
           'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+p+'</svg>';
  }
  return {
    free:        s('<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>'),
    reserved:    s('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
    seated:      s('<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>'),
    ordered:     s('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="m9 14 2 2 4-4"/>'),
    preparing:   s('<path d="M12 2a3 3 0 0 0-3 3 3 3 0 0 0-2 5.2V12h10v-1.8A3 3 0 0 0 15 5a3 3 0 0 0-3-3Z"/><path d="M7 15h10"/><path d="M8 22h8a2 2 0 0 0 2-2v-5H6v5a2 2 0 0 0 2 2Z"/>'),
    ready:       s('<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M4 2a17 17 0 0 0-2 5"/><path d="M22 7a17 17 0 0 0-2-5"/><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>'),
    served:      s('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    bill:        s('<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 8h8"/><path d="M8 12h6"/>'),
    clean:       s('<path d="M3 3h.01"/><path d="M7 5h.01"/><path d="M11 7h.01"/><path d="M3 7h.01"/><path d="M7 9h.01"/><path d="M3 11h.01"/><rect x="15" y="5" width="4" height="4" rx="1"/><path d="m19 9 1.5 1.5a2.1 2.1 0 0 1 0 3L18 16"/><path d="M13 14h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z"/>'),
    cleaning:    s('<path d="M21 12a9 9 0 1 1-6.2-8.6"/><path d="M21 3v6h-6"/>'),
    oos:         s('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'),
    alert:       s('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    clock:       s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    handover:    s('<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>'),
    note:        s('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    guests:      s('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>'),
    map:         s('<path d="M14.1 4.1 20 2v16l-5.9 2.1"/><path d="M14.1 4.1 8.9 2.4"/><path d="M8.9 2.4 4 4v16l4.9-1.6"/><path d="M8.9 2.4v16.4"/><path d="M14.1 4.1v16.4"/>'),
    list:        s('<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>'),
    refresh:     s('<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>'),
    grid:        s('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>')
  };
})();

/* تعبئة صلبة ونصّ يُقرأ من بعيد. والحالات ستّ بعد إلغاء الحجز والتجهيز
   والجاهز، فسقط التعليق القديم عن ثماني صبغات.
   solid = التعبئة الصلبة، bg = خلفية فاتحة للبطاقة، c = نص على الفاتح. */
/* ===== مفردات الطاولة =====
   كانت إحدى عشرة حالة بإحدى عشرة صبغة من لوحة أجنبية عن هوية التطبيق
   (بنفسجي وأزرق وفيروزي)، وكان الأسوأ منطقياً: served («مشغولة») بالأحمر
   وfree بالأخضر — فمقهى ممتلئ يظهر كحالة طوارئ، ومقهى فارغ كإنجاز.
   والحالتان needs_clean وcleaning شبه مترادفتين بلونين متقاربين.
   القاعدة الجديدة: قناة بصرية واحدة لكل سؤال.
     • اللون يجيب «مَن يحتاجني الآن؟» — ثلاث درجات إلحاح من رموز التطبيق.
     • الأيقونة والاسم يجيبان «ما حالتها؟» — ثمانية أسماء بعد إلغاء الحجز والتجهيز والجاهز.
   فلا يُطلب من أحد حفظ إحدى عشرة دلالة لونية. */
var TMS = {
  free:           {ar:'متاحة',          sh:'متاحة',   ic:'free'},
  reserved:       {ar:'محجوزة',         sh:'محجوزة',  ic:'reserved'},
  seated:         {ar:'جلسن — الطلب؟',  sh:'الطلب؟',  ic:'seated'},
  ordered:        {ar:'تم أخذ الطلب',   sh:'أُخذ الطلب', ic:'ordered'},
  preparing:      {ar:'قيد التجهيز',    sh:'تجهيز',   ic:'preparing'},
  ready:          {ar:'جاهز للتقديم',   sh:'جاهز',    ic:'ready'},
  served:         {ar:'يتناولن',        sh:'يتناولن', ic:'served'},
  bill_requested: {ar:'طلبن الحساب',    sh:'الحساب',  ic:'bill'},
  needs_clean:    {ar:'غادرن — تنظيف',  sh:'تنظيف',   ic:'clean'},
  cleaning:       {ar:'يجري التنظيف',   sh:'يُنظَّف',  ic:'cleaning'},
  out_of_service: {ar:'خارج الخدمة',    sh:'موقوفة',  ic:'oos'}
};
/* درجات الإلحاح الثلاث + الموقوفة. القيم رموز CSS فتتبع السمة تلقائياً،
   بخلاف الست عشرية الثابتة التي كانت لا تنقلب في الوضع الداكن. */
var TMU = [
  {k:'calm', ar:'على ما يرام',   solid:'var(--tm-calm)'},
  {k:'soon', ar:'اقترب وقتها',   solid:'var(--tm-soon)'},
  {k:'due',  ar:'تحتاج انتباهاً',solid:'var(--tm-soon)'},
  {k:'late', ar:'تجاوزت وقتها',  solid:'var(--tm-late)'}
];
/* الطاولة المتاحة ليست «إلحاحاً صفر» بل حالة محيّدة: تُميَّز بلا لون تحذير */
function tmTint(x){
  if(x.oos) return 'var(--tm-oos)';
  if(x.state==='free') return 'var(--tm-free)';
  if(x.state==='reserved') return 'var(--tm-oos)';
  return TMU[tmUrg(x)].solid;
}
function tmUrgName(x){ return x.oos?'موقوفة':(x.state==='free'?'متاحة':TMU[tmUrg(x)].ar); }
/* الإجراء كما تقوله الموظفة، لا اسم الحالة */
var TMACT = {
  seated:         {t:'جلس الضيفات',          s:'تبدأ مدة الطاولة الآن'},
  ordered:        {t:'تم أخذ الطلب',         s:''},
  served:         {t:'تم تقديم الطلب',       s:'الطاولة مشغولة'},
  bill_requested: {t:'طلبن الحساب',          s:''},
  needs_clean:    {t:'غادرن — تحتاج تنظيفاً', s:''},
  cleaning:       {t:'بدأ التنظيف',          s:''},
  free:           {t:'تم تجهيز الطاولة',     s:'عادت متاحة'}
};

var TM = {area:null, data:null, timer:null, tick:null, admin:false,
          view:'floor', filter:'all', st:null, emp:null, skew:0, sel:null, busy:false,
          /* وضع الدمج: مجموعة كبيرة تجلس على طاولتين ملتصقتين فتُعامَلان كوحدة
             واحدة. merge = الوضع مفعّل، pick = مفاتيح الطاولات المختارة. */
          merge:false, pick:{}};

function tmIc(k){ return '<span class="ti">'+(TIC[k]||'')+'</span>'; }
function tmInitials(n){
  n = String(n||'').trim(); if(!n) return '؟';
  var p = n.split(/\s+/);
  return p.length > 1 ? (p[0][0] + p[1][0]) : n.slice(0, 2);
}
/* وقت الخادم هو المرجع — لا نثق بساعة الجهاز */
function tmNow(){ return Date.now() - TM.skew; }
/* أُبقي الاسم لأن وحدة الطاولات تستدعيه في مواضع كثيرة، لكنه صار غلافاً
   على fmtT فلا يبقى تنفيذان للوقت يفترقان مع الوقت. */
function tmClock(ts){ return fmtT(ts); }
function tmDur(mins){
  mins = Math.max(0, Math.round(+mins || 0));
  if(mins < 60) return mins + ' د';
  return Math.floor(mins / 60) + ' س ' + (mins % 60) + ' د';
}
function tmMinsSince(ts){ return ts ? (tmNow() - new Date(ts).getTime()) / 60000 : 0; }

/* الحالة المعروضة: خارج الخدمة يتقدم على كل شيء */
function tmState(x){ return x.oos ? 'out_of_service' : x.state; }
/* درجة الإلحاح — تُستخدم للترتيب والفرز فقط، ولا تُحرّك الطاولات على المخطط */
function tmUrg(x){
  if(x.oos) return 0;
  if(x.overdue) return 3;
  if(x.since_seen > 25 && ['served','ordered','preparing'].indexOf(x.state) >= 0) return 2;
  if(x.long_stay) return 1;
  return 0;
}

/* ---------- شريط القيادة ---------- */
function tmCommandBar(all, meta){
  var act = all.filter(function(x){ return x.state !== 'free' && !x.oos; });
  var freeN = all.filter(function(x){ return x.state === 'free' && !x.oos; }).length;
  var need = all.filter(function(x){ return tmUrg(x) >= 2; }).length;
  var bill = all.filter(function(x){ return x.state === 'bill_requested'; }).length;
  var seats = all.reduce(function(s, x){ return s + (x.oos ? 0 : (+x.seats || 0)); }, 0);
  var occSeats = act.reduce(function(s, x){ return s + (+x.seats || 0); }, 0);
  var occ = seats ? Math.round(occSeats / seats * 100) : 0;
  var open = all.filter(function(x){ return x.opened_at; });
  var avg = open.length ? open.reduce(function(s, x){ return s + tmMinsSince(x.opened_at); }, 0) / open.length : 0;

  function cell(label, val, cls){
    return '<div class="tcb-i'+(cls ? ' ' + cls : '')+'"><b>'+val+'</b><span>'+esc(label)+'</span></div>';
  }
  return '<div class="tcb">'+
    cell('مشغولة', act.length) +
    cell('متاحة', freeN) +
    cell('الإشغال', occ + '%') +
    cell('تحتاج تدخلاً', need, need ? 'bad' : '') +
    cell('طلبت الحساب', bill, bill ? 'info' : '') +
    cell('متوسط الجلوس', avg ? tmDur(avg) : '—') +
    cell('الضغط', esc(meta.band || '—'), meta.bandCls) +
    '<div class="tcb-i tcb-end"><b>'+tmClock(tmNow())+'</b>'+
      '<span class="'+(meta.online ? 'ok' : 'warn')+'">'+
      (meta.online ? 'متزامن ' + tmClock(meta.synced) : 'بلا اتصال')+'</span></div>'+
    '</div>';
}

/* ---------- بطاقة الطاولة: أماكن المعلومات ثابتة في كل بطاقة ---------- */
function tmCard(x){
  var k = tmState(x), st = TMS[k] || TMS.free, u = tmUrg(x);
  var tint = tmTint(x);
  var flags = '';
  if(u >= 3)        flags += '<span class="tf bad" title="تجاوزت وقتها الطبيعي">'+tmIc('alert')+'</span>';
  else if(u === 2)  flags += '<span class="tf warn" title="بلا متابعة">'+tmIc('clock')+'</span>';
  else if(x.long_stay) flags += '<span class="tf mild" title="جلوس طويل">'+tmIc('clock')+'</span>';
  if(x.handed)   flags += '<span class="tf" title="تم تسليمها">'+tmIc('handover')+'</span>';
  if(x.has_note) flags += '<span class="tf" title="عليها ملاحظة">'+tmIc('note')+'</span>';

  /* سطر الوقت: مفتوحة ← «فُتحت 7:42 م · 48 د» */
  var timeLine = (x.state === 'free' && !x.oos) ? 'جاهزة للاستقبال'
    : x.opened_at
      ? 'فُتحت ' + tmClock(x.opened_at) + ' · <b class="tdur" data-since="' + x.opened_at + '">' +
        tmDur(tmMinsSince(x.opened_at)) + '</b>'
      : 'منذ <b class="tdur" data-mins="' + (+x.mins) + '">' + tmDur(x.mins) + '</b>';

  var le = x.last_event || {};
  var leTxt = le.at ? (esc(le.reason || (TMS[le.to] || {}).ar || '') + ' · ' + tmClock(le.at)) : '';

  return '<button class="tcard s-'+esc(k)+(u >= 3 ? ' urg' : '')+'" data-t="'+x.id+'" '+
    'aria-label="طاولة '+(+x.no)+' — '+esc(st.ar)+(x.owner ? ' — المسؤولة '+esc(x.owner) : '')+'">'+
    '<span class="tc-edge"></span>'+
    '<span class="tc-top">'+
      '<span class="tc-no">'+(+x.no)+'</span>'+
      '<span class="tc-st">'+tmIc(st.ic)+'<span>'+esc(st.ar)+'</span></span>'+
      '<span class="tc-flags">'+flags+'</span>'+
    '</span>'+
    '<span class="tc-time">'+timeLine+
      (x.round > 1 ? '<span class="tc-rnd">جولة '+(+x.round)+'</span>' : '')+
      (x.guests ? '<span class="tc-g">'+tmIc('guests')+(+x.guests)+'</span>' : '')+
    '</span>'+
    '<span class="tc-bot">'+
      (x.owner
        ? '<span class="tc-own"><span class="tc-av">'+esc(tmInitials(x.owner))+'</span>'+esc(x.owner)+'</span>'
        : '<span class="tc-own none">بلا مسؤولة</span>')+
      (leTxt ? '<span class="tc-le">'+leTxt+'</span>' : '')+
    '</span>'+
    '</button>';
}

/* ---------- أرضية الصالة: كل الطاولات في شاشة واحدة ----------
   الطاولة قطعة أثاث ملوّنة بحالتها، لا بطاقة نصية. الرقم يُقرأ من مسافة،
   والدقائق والمسؤولة والتنبيه شارات على الحواف فلا تزاحم الرقم. */
function tmTile(x){
  var k = tmState(x), st = TMS[k] || TMS.free, u = tmUrg(x);
  var tint = tmTint(x);
  var fl = '';
  if(u >= 3)           fl = '<span class="tt-fl bad" title="تجاوزت وقتها">'+tmIc('alert')+'</span>';
  else if(u === 2)     fl = '<span class="tt-fl warn" title="بلا متابعة">'+tmIc('clock')+'</span>';
  else if(x.has_note)  fl = '<span class="tt-fl" title="عليها ملاحظة">'+tmIc('note')+'</span>';
  else if(x.handed)    fl = '<span class="tt-fl" title="سُلِّمت">'+tmIc('handover')+'</span>';

  var busy = k !== 'free' && !x.oos;
  var sub = x.oos ? 'موقوفة'
          : busy && x.guests ? (+x.guests) + ' ضيفات'
          : st.sh;
  return '<button class="tt '+esc(x.type || '')+(u >= 3 ? ' urg' : '')+(x.oos ? ' oos' : '')+
      (x.group_id ? ' grouped' : '')+(TM.merge && TM.pick[x.id] ? ' sel' : '')+
      '" data-t="'+x.id+'" style="--tcol:'+tint+'" '+
      'aria-label="طاولة '+(+x.no)+' — '+esc(st.ar)+(x.owner ? ' — '+esc(x.owner) : '')+
      (busy && x.mins ? ' — '+tmDur(x.mins) : '')+'">'+
    fl+
    (busy && x.mins > 0
      ? '<span class="tt-min"><b class="tdur" data-mins="'+(+x.mins)+'">'+tmDur(x.mins)+'</b></span>' : '')+
    '<span class="tt-no">'+(+x.no)+'</span>'+
    '<span class="tt-sub">'+esc(sub)+'</span>'+
    (x.owner ? '<span class="tt-own" title="'+esc(x.owner)+'">'+esc(tmInitials(x.owner))+'</span>' : '')+
    '</button>';
}
/* مفتاح الإلحاح: ثلاث درجات لا إحدى عشرة حالة. يعمل مرشّحاً أيضاً.
   الحالة نفسها تُقرأ من الأيقونة والاسم على البلاطة، فلا حاجة لتلوينها. */
function tmLegend(all){
  var groups=[
    {k:'late', ar:'تجاوزت وقتها',  col:'var(--tm-late)', f:function(x){ return !x.oos && x.state!=='free' && tmUrg(x)>=3; }},
    {k:'soon', ar:'تحتاج انتباهاً',col:'var(--tm-soon)', f:function(x){ return !x.oos && x.state!=='free' && tmUrg(x)>0 && tmUrg(x)<3; }},
    {k:'busy', ar:'تسير طبيعياً',  col:'var(--tm-calm)', f:function(x){ return !x.oos && x.state!=='free' && tmUrg(x)===0; }},
    {k:'free', ar:'متاحة',         col:'var(--tm-free)', f:function(x){ return !x.oos && x.state==='free'; }},
    {k:'oos',  ar:'موقوفة',        col:'var(--tm-oos)',  f:function(x){ return !!x.oos; }}
  ];
  var btns=groups.map(function(g){
    var n=all.filter(g.f).length; if(!n) return '';
    return '<button class="tleg-b'+(TM.st===g.k?' on':'')+'" data-st="'+g.k+'" '+
      'style="--tcol:'+g.col+'"><span class="sw"></span>'+esc(g.ar)+
      '<span class="n">'+n+'</span></button>';
  }).join('');
  return btns ? '<div class="tleg">'+
    '<button class="tleg-b'+(TM.st?'':' on')+'" data-st="" style="--tcol:var(--muted)">'+
    '<span class="sw"></span>الكل<span class="n">'+all.length+'</span></button>'+btns+'</div>' : '';
}
/* المرشّح صار على درجة الإلحاح، فتغيّر معنى TM.st */
function tmMatchGroup(x, k){
  if(!k) return true;
  if(k==='oos')  return !!x.oos;
  if(k==='free') return !x.oos && x.state==='free';
  if(k==='busy') return !x.oos && x.state!=='free' && tmUrg(x)===0;
  if(k==='soon') return !x.oos && x.state!=='free' && tmUrg(x)>0 && tmUrg(x)<3;
  if(k==='late') return !x.oos && x.state!=='free' && tmUrg(x)>=3;
  return true;
}
/* ---------- المخطط: نفس البيانات بترتيب مكاني ---------- */
function tmLandmarks(areaId){
  if(areaId === 2){
    return '<div class="tm-land pool" style="left:6%;top:44%;width:54%;height:38%">المسبح</div>'+
           '<div class="tm-land glass" style="left:4%;top:4%;width:88%;height:4%"></div>'+
           '<div class="tm-land door" style="left:66%;top:94%;width:24%;height:5%">المدخل</div>';
  }
  return '<div class="tm-land glass" style="left:4%;top:3%;width:92%;height:4%"></div>'+
         '<div class="tm-land zone" style="left:38%;top:12%;width:38%;height:50%"></div>'+
         '<div class="tm-land door" style="left:4%;top:94%;width:20%;height:5%">المدخل</div>';
}
function tmSeats(type, n){
  n = Math.max(2, Math.min(8, +n || 4));
  if(type === 'booth') return '<span class="tm-back"></span>';
  var pos = [];
  if(type === 'curved'){
    for(var i = 0; i < n; i++){
      var ang = (i / n) * 2 * Math.PI - Math.PI / 2;
      pos.push([50 + 44 * Math.cos(ang), 50 + 44 * Math.sin(ang)]);
    }
  } else if(type === 'two_seat'){ pos = [[-9, 50], [109, 50]]; }
  else { pos = [[-9, 30], [-9, 70], [109, 30], [109, 70], [30, -9], [70, -9]].slice(0, n); }
  return pos.map(function(p){
    return '<span class="tm-seat" style="left:'+p[0]+'%;top:'+p[1]+'%;margin:-3px 0 0 -3px"></span>';
  }).join('');
}
function tmPlan(tables, areaId){
  return '<div class="tm-board">'+tmLandmarks(areaId)+
    tables.map(function(x){
      var k = tmState(x), st = TMS[k] || TMS.free, u = tmUrg(x);
  var tint = tmTint(x);
      return '<button class="tm-t '+esc(x.type)+' s-'+esc(k)+(u >= 3 ? ' urg' : '')+
        (x.group_id ? ' grouped' : '')+'" data-t="'+x.id+'" style="left:'+(+x.x)+'%;top:'+(+x.y)+'%" '+
        'aria-label="طاولة '+(+x.no)+' — '+esc(st.ar)+'">'+
        '<span class="tm-body">'+tmSeats(x.type, x.seats)+
          (x.state !== 'free' && x.mins > 0
            ? '<span class="tm-badge"><b class="tdur" data-mins="'+(+x.mins)+'">'+tmDur(x.mins)+'</b></span>' : '')+
          '<span class="tm-no">'+(+x.no)+'</span>'+
          '<span class="tm-lbl">'+esc(st.sh)+'</span>'+
          (x.owner ? '<span class="tm-own">'+esc(tmInitials(x.owner))+'</span>' : '')+
        '</span></button>';
    }).join('')+'</div>';
}

/* ---------- الرسم الكامل ---------- */
function tmRender(){
  var host = $('#tmHost'); if(!host || !TM.data) return;
  var res = TM.data, all = res.tables || [];
  var pr = res.pressure || {}, open = (res.open || {}).open;
  var BANDS = {quiet:'هادئ', normal:'طبيعي', high:'مرتفع', peak:'ذروة'};

  var view = all.slice();
  if(TM.filter === 'attention') view = view.filter(function(x){ return tmUrg(x) >= 2; });
  else if(TM.filter === 'bill') view = view.filter(function(x){ return x.state === 'bill_requested'; });
  else if(TM.filter === 'busy') view = view.filter(function(x){ return x.state !== 'free' && !x.oos; });
  else if(TM.filter === 'free') view = view.filter(function(x){ return x.state === 'free' && !x.oos; });
  if(TM.emp) view = view.filter(function(x){ return String(x.owner_id) === String(TM.emp); });
  if(TM.st)  view = view.filter(function(x){ return tmMatchGroup(x, TM.st); });

  var h = '';
  h += tmCommandBar(all, {
    band: pr.counted ? (BANDS[pr.band] || pr.band) : 'غير محسوب',
    bandCls: pr.band === 'peak' ? 'bad' : (pr.band === 'high' ? 'info' : ''),
    online: navigator.onLine !== false, synced: TM.synced});

  if(!open){
    h += '<div class="tm-closed">'+tmIc('clock')+'<div><b>خارج ساعات الخدمة</b>'+
         '<div>تفتح '+esc((res.area || {}).svc_open || '')+' — لا تنبيهات ولا احتساب ضغط قبل ذلك.</div></div></div>';
  }

  /* المرشّحات */
  /* المرشّحات هنا عرضية فقط — الحالات نفسها يرشّحها مفتاح الألوان، فلا تكرار */
  var F = TM.view === 'floor'
    ? [['all','الكل'],['attention','تحتاج تدخلاً']]
    : [['all','الكل'],['attention','تحتاج تدخلاً'],['bill','طلبت الحساب'],['busy','مشغولة'],['free','متاحة']];
  h += '<div class="tfl">'+F.map(function(f){
      return '<button class="tfl-b'+(TM.filter === f[0] ? ' on' : '')+'" data-f="'+f[0]+'">'+esc(f[1])+'</button>';
    }).join('')+
    '<select class="tfl-s" id="tflEmp"><option value="">كل الموظفات</option>'+
    ((res.load || {}).rows || []).map(function(r){
      return '<option value="'+r.employee_id+'"'+(String(TM.emp) === String(r.employee_id) ? ' selected' : '')+'>'+
             esc(r.name)+' ('+r.active+')</option>';
    }).join('')+'</select>'+
    (TM.admin ? '<button class="tfl-b'+(TM.merge ? ' on' : '')+'" id="tmMerge">دمج طاولات</button>' : '')+
    '<button class="tfl-v" id="tmView" title="'+(TM.view === 'plan' ? 'عرض الأرضية' : (TM.view === 'floor' ? 'عرض التفاصيل' : 'عرض المخطط'))+'">'+
    tmIc(TM.view === 'floor' ? 'map' : (TM.view === 'plan' ? 'list' : 'grid'))+'</button>'+
    '</div>';

  /* شريط الدمج: يظهر فقط داخل الوضع، ويقول بوضوح ما يُختار وما لا يُختار */
  if(TM.admin && TM.merge){
    var picked = all.filter(function(x){ return TM.pick[x.id]; });
    h += '<div class="tmg"><div class="tmg-h">'+tmIc('handover')+
      '<b>اختاري طاولتين متجاورتين أو أكثر</b></div>'+
      '<div class="tmg-n">تُدمج المتاحة غير المدموجة فقط. الدمج ليوم واحد ويُفصل تلقائياً عند الإقفال، '+
        'ويُسجَّل في أحداث الطاولات.</div>'+
      '<div class="tmg-p">'+(picked.length
        ? picked.map(function(x){ return '<span>'+(+x.no)+'</span>'; }).join('')
        : '<span class="tmg-e">لم تُختر طاولة بعد</span>')+'</div>'+
      '<div class="btnrow"><button class="btn grow" id="tmgGo"'+(picked.length < 2 ? ' disabled' : '')+'>'+
        'دمج '+(picked.length || '')+'</button>'+
        '<button class="btn ghost grow" id="tmgX">إلغاء</button></div></div>';
  }

  /* المجموعات القائمة: نُشتقّها من group_id على الطاولات نفسها — لا نداء إضافي */
  if(TM.admin && !TM.merge){
    var gm = {};
    all.forEach(function(x){ if(x.group_id){ (gm[x.group_id] = gm[x.group_id] || []).push(x); } });
    var gks = Object.keys(gm);
    if(gks.length){
      h += '<div class="tmg"><div class="tmg-h">'+tmIc('handover')+'<b>طاولات مدموجة الآن</b></div>'+
        gks.map(function(g){
          var nos = gm[g].map(function(x){ return +x.no; }).sort(function(a,b){ return a-b; });
          return '<div class="row" style="justify-content:space-between;gap:8px;margin-top:8px">'+
            '<div class="tmg-p" style="margin:0">'+nos.map(function(n){ return '<span>'+n+'</span>'; }).join('')+'</div>'+
            '<button class="btn ghost" data-ungrp="'+esc(g)+'" data-nos="'+esc(nos.join(' + '))+'">فصل</button>'+
          '</div>';
        }).join('')+'</div>';
    }
  }

  /* مفتاح الألوان يسبق الأرضية: اللون يصير مفهوماً قبل أن يُقرأ */
  if(TM.view === 'floor') h += tmLegend(all);

  h += '<div class="tfloor-h"><b>'+esc((res.area || {}).name || 'الطاولات')+'</b>'+
       '<span>'+view.length+' من '+all.length+' طاولة</span></div>';

  if(!view.length){
    h += '<div class="empty">لا طاولات ضمن هذا المرشّح</div>';
  } else if(TM.view === 'plan'){
    h += tmPlan(view, (res.area || {}).id);
  } else if(TM.view === 'list'){
    h += '<div class="tgrid">'+view.map(tmCard).join('')+'</div>';
  } else {
    h += '<div class="tfloor">'+view.map(tmTile).join('')+'</div>';
  }

  /* أين عنق الزجاجة؟ الصالة أم المطبخ أم الكاش — القرار يختلف تماماً */
  var bn = res.bottleneck || {};
  if((bn.bottlenecks || []).length){
    var OWN = {'المطبخ':'kitchen','الكاش':'cash'};
    h += '<div class="bneck '+(OWN[bn.primary_owner] || 'floor')+'">'+
      '<div class="bneck-h">'+tmIc('alert')+'<b>'+esc(bn.headline)+'</b>'+
      '<span class="bneck-own">'+esc(bn.primary_owner || '')+'</span></div>'+
      bn.bottlenecks.map(function(x){
        return '<div class="bneck-i"><b>'+esc(x.label)+' · '+(+x.tables)+'</b>'+
          '<span>'+esc(x.why)+'</span>'+
          '<span class="bneck-do">'+esc(x.action)+'</span></div>';
      }).join('')+
      '<div class="bneck-note">مشتق من أزمنة حالات الطاولات — ليس مبيعات ولا نظام طلبات.</div></div>';
  }

  /* ما يحتاج تدخلاً الآن — مقدمة العرض، بلا تحريك مواقع الطاولات */
  var al = res.alerts || [];
  if(al.length){
    h += '<div class="tal"><div class="tal-h">'+tmIc('alert')+'يحتاج تدخلاً الآن <span>'+al.length+'</span></div>'+
      '<div class="tal-list">'+al.slice(0, 6).map(function(a){
        return '<button class="tal-i sev-'+esc(a.sev)+'" data-t="'+a.table_id+'">'+
          '<b>'+esc(a.title)+'</b><span>'+esc(a.why)+(a.owner ? ' · '+esc(a.owner) : '')+'</span></button>';
      }).join('')+'</div></div>';
  }
  var sug = (res.load || {}).suggestion;
  if(sug){
    h += '<div class="tsug">'+tmIc('handover')+'<div><b>'+esc(sug.text)+'</b><span>'+esc(sug.why)+'</span></div></div>';
  }


  /* توزيع الحمل */
  var lr = (res.load || {}).rows || [];
  if(lr.length){
    h += '<div class="tload"><div class="tload-h">توزيع الحمل</div>'+lr.map(function(r){
      var mx = Math.max.apply(null, lr.map(function(z){ return z.active; })) || 1;
      return '<div class="tload-r"><span class="tc-av">'+esc(tmInitials(r.name))+'</span>'+
        '<span class="tload-n">'+esc(r.name)+'</span>'+
        '<span class="tload-bar"><i style="width:'+Math.round(r.active / mx * 100)+'%"></i></span>'+
        '<span class="tload-v">'+r.active+'/'+r.tables+'</span></div>';
    }).join('')+'</div>';
  }

  host.innerHTML = h;

  $$('[data-t]', host).forEach(function(b){
    b.addEventListener('click', function(){
      var id = +b.getAttribute('data-t');
      /* داخل وضع الدمج النقر يختار، لا يفتح التفاصيل — وإلا لن تُفهم الشاشة */
      if(TM.admin && TM.merge){
        var t = null;
        (TM.data.tables || []).forEach(function(x){ if(+x.id === id) t = x; });
        if(!t) return;
        if(t.oos){ toast('طاولة موقوفة عن الخدمة — لا تُدمج', true); return; }
        if(t.group_id){ toast('هذه الطاولة مدموجة أصلاً — افصليها أولاً', true); return; }
        if(tmState(t) !== 'free'){ toast('الدمج للطاولات المتاحة فقط', true); return; }
        if(TM.pick[id]) delete TM.pick[id]; else TM.pick[id] = true;
        tmRender();
        return;
      }
      tmDetail(id);
    });
  });
  var mb2 = $('#tmMerge', host);
  if(mb2) mb2.addEventListener('click', function(){
    TM.merge = !TM.merge; TM.pick = {}; tmRender();
  });
  var mgX = $('#tmgX', host);
  if(mgX) mgX.addEventListener('click', function(){ TM.merge = false; TM.pick = {}; tmRender(); });
  var mgGo = $('#tmgGo', host);
  if(mgGo) mgGo.addEventListener('click', function(){
    var ids = Object.keys(TM.pick).map(Number);
    if(ids.length < 2){ toast('اختاري طاولتين على الأقل', true); return; }
    busyWrap(this, function(){
      return aAct('tbl_group', {area_id: TM.area, tables: ids}).then(function(r){
        if(r && r.ok){ TM.merge = false; TM.pick = {}; toast('دُمجت الطاولات ✔'); tmLoad(TM.area); }
        else toast((r && r.error) || 'تعذّر الدمج', true);
      });
    });
  });
  $$('[data-ungrp]', host).forEach(function(b){
    b.addEventListener('click', function(){
      var gid = b.getAttribute('data-ungrp'), nos = b.getAttribute('data-nos');
      confirmSheet('فصل ' + nos, 'تعود كل طاولة وحدةً مستقلة، ويُسجَّل الفصل في أحداث اليوم. تابعي؟',
        'افصلي', function(){
          aAct('tbl_ungroup', {group_id: gid}).then(function(r){
            if(r && r.ok){ toast('فُصلت الطاولات ✔'); tmLoad(TM.area); }
            else toast((r && r.error) || 'تعذّر الفصل', true);
          });
        });
    });
  });
  $$('[data-f]', host).forEach(function(b){
    b.addEventListener('click', function(){ TM.filter = b.getAttribute('data-f'); tmRender(); });
  });
  var se = $('#tflEmp', host);
  if(se) se.addEventListener('change', function(){ TM.emp = se.value || null; tmRender(); });
  $$('[data-st]', host).forEach(function(b){
    b.addEventListener('click', function(){ TM.st = b.getAttribute('data-st') || null; tmRender(); });
  });
  var vb = $('#tmView', host);
  /* ثلاث طرق عرض: الأرضية (افتراضي) ← المخطط المكاني ← قائمة التفاصيل */
  if(vb) vb.addEventListener('click', function(){
    TM.view = TM.view === 'floor' ? 'plan' : (TM.view === 'plan' ? 'list' : 'floor');
    tmRender();
  });
}

/* المؤقتات تتحرك دون إعادة تحميل ودون استدعاء الخادم.
   ثلاث حالات: طابعٌ زمنيّ مطلق (data-since) · دقائقُ من الخادم مع لحظة
   الرسم (data-mins + data-at) فينمو العدّ من لحظته هو لا من عدّادٍ مشترك ·
   ودقائقُ بلا لحظة، وهي ورقة الطاولة التي تُحرّك عدّادها بنفسها. */
function tmTick(){
  $$('.tdur').forEach(function(el){
    var s = el.getAttribute('data-since'), v;
    if(s) v = tmDur(tmMinsSince(s));
    else {
      var m = +el.getAttribute('data-mins') || 0;
      var at = +el.getAttribute('data-at') || 0;
      v = tmDur(at ? m + Math.floor((Date.now() - at) / 60000) : m + (tmTick._n || 0));
    }
    /* لا نكتب إلا عند التغيّر: النبضة ثانويّة والدقّة بالدقيقة، فالكتابة
       المتكرّرة تُبطل تخطيط النصّ بلا فائدة. */
    if(el.textContent !== v) el.textContent = v;
  });
}

/* ---------- لوحة تفاصيل الطاولة ---------- */
function tmDetail(tid){
  var fn = TM.admin ? aAct : sAct;
  fn('tbl_detail', {table_id: tid}).then(function(r){
    if(!r || !r.ok){ toast((r && r.error) || 'تعذر فتح التفاصيل', true); return; }
    var t = r.table, st = TMS[t.oos ? 'out_of_service' : t.state] || TMS.free;
    var s = r.session || {};

    var b = '<div class="td-hd s-'+esc(t.oos ? 'out_of_service' : t.state)+'">'+
      '<span class="td-no">'+(+t.no)+'</span>'+
      '<div><b>'+tmIc(st.ic)+esc(st.ar)+'</b>'+
      '<span>'+esc(t.area)+' · '+(+t.seats)+' مقاعد'+(t.guests ? ' · '+(+t.guests)+' ضيفات' : '')+'</span></div></div>';

    /* الوقت بصيغة واضحة: مفتوحة أو منتهية */
    if(t.opened_at){
      b += '<div class="td-time">'+ (s.cleaned_at
        ? tmClock(s.opened_at)+' – '+tmClock(s.cleaned_at)+' · المدة '+tmDur((new Date(s.cleaned_at)-new Date(s.opened_at))/60000)
        : 'فُتحت '+tmClock(t.opened_at)+' · المدة <b class="tdur" data-since="'+t.opened_at+'">'+tmDur(t.open_mins)+'</b>')+
        '<span>آخر متابعة منذ '+tmDur(t.since_seen)+'</span></div>';
    }

    (r.alerts || []).forEach(function(a){
      b += '<div class="td-al sev-'+esc(a.sev)+'">'+tmIc('alert')+'<div><b>'+esc(a.title)+'</b><span>'+esc(a.why)+'</span></div></div>';
    });

    b += '<div class="td-kv">'+
      '<div><span>المسؤولة</span><b>'+(r.owner ? esc(r.owner.name) : 'بلا مسؤولة')+'</b></div>'+
      (s.staff && s.staff.length > 1 ? '<div><span>تعاملن معها</span><b>'+esc(s.staff.join('، '))+'</b></div>' : '')+
      (s.ordered_at ? '<div><span>أخذ الطلب</span><b>'+tmClock(s.ordered_at)+'</b></div>' : '')+
      (s.served_at ? '<div><span>التقديم</span><b>'+tmClock(s.served_at)+'</b></div>' : '')+
      (s.bill_at ? '<div><span>طلب الحساب</span><b>'+tmClock(s.bill_at)+'</b></div>' : '')+
      '</div>';

    /* الإجراء الرئيسي أولاً، ثم الثانوية، ثم الأقل استخداماً */
    var nx = t.next || [];
    /* الطاولة المتاحة: عدد الضيفات والفتح بضغطة واحدة — لا لوحة ثانية */
    if(nx.indexOf('seated') >= 0){
      b += '<div class="td-lbl">جلس الضيفات — كم عددهن؟</div><div class="gseat">'+
        [1,2,3,4,5,6,8,10].filter(function(n){ return n <= (t.seats + 4); }).map(function(n){
          return '<button class="gseat-b" data-seat="'+n+'">'+n+'</button>';
        }).join('')+
        '<button class="gseat-b alt" data-seat="0">بلا عدد</button></div>';
      nx = nx.filter(function(k){ return k !== 'seated'; });
    }
    if(nx.length){
      var prim = nx[0], a0 = TMACT[prim] || {t: prim, s: ''};
      b += '<button class="btn block td-prim" data-go="'+esc(prim)+'">'+esc(a0.t)+'</button>';
      if(nx.length > 1){
        b += '<div class="td-sec">'+nx.slice(1).map(function(k){
          var a = TMACT[k] || {t: k};
          return '<button class="btn sm ghost" data-go="'+esc(k)+'">'+esc(a.t)+'</button>';
        }).join('')+'</div>';
      }
    }
    b += '<details class="td-more"><summary>إجراءات أخرى</summary>'+
      '<div class="btnrow"><button class="btn sm ghost" id="tdFu">تسجيل متابعة</button>'+
      '<button class="btn sm ghost" id="tdHo">تسليم لموظفة</button>'+
      (TM.admin && (r.free_tables || []).length ? '<button class="btn sm ghost" id="tdMv">نقل الطاولة</button>' : '')+
      '</div></details>';

    b += '<div class="td-tl"><b>سجل الطاولة اليوم</b>'+
      ((r.timeline || []).length ? (r.timeline || []).map(function(e){
        var lbl = e.source === 'handover' ? 'تسليم'
                : e.source === 'followup' ? 'متابعة'
                : e.source === 'move' ? 'نقل'
                : e.source === 'verify' ? 'تحقق'
                : ((TMS[e.to] || {}).ar || e.to);
        return '<div class="td-tli"><span class="td-tlt">'+tmClock(e.at)+'</span>'+
          '<div><b>'+esc(lbl)+'</b>'+(e.reason ? '<span>'+esc(e.reason)+'</span>' : '')+
          (e.by ? '<span class="muted">'+esc(e.by)+'</span>' : '')+'</div></div>';
      }).join('') : '<div class="muted small">لا أحداث بعد</div>')+'</div>';

    sheet('طاولة '+(+t.no), b, function(ov, close){
      function act(fnName, payload, okMsg){
        if(TM.busy) return; TM.busy = true;
        $$('button', ov).forEach(function(x){ x.disabled = true; });
        (TM.admin ? aAct : sAct)(fnName, payload, true).then(function(res){
          TM.busy = false;
          if(res && res.ok){ toast(okMsg || 'تم'); close(); tmLoad(TM.area, true); }
          else {
            $$('button', ov).forEach(function(x){ x.disabled = false; });
            if(res && res.code === 'conflict'){ toast(res.error, true, 4200); close(); tmLoad(TM.area, true); }
            else if(res && res.code === 'kitchen_scope') toast(res.error, true, 4200);
            else toast((res && res.error) || 'تعذر التنفيذ', true);
          }
        }).catch(function(){
          TM.busy = false;
          $$('button', ov).forEach(function(x){ x.disabled = false; });
          toast('تعذر الاتصال — أعيدي المحاولة', true);
        });
      }

      /* ضغطة واحدة تفتح الطاولة وتسجّل العدد معاً */
      $$('[data-seat]', ov).forEach(function(bt){
        bt.addEventListener('click', function(){
          var g = +bt.getAttribute('data-seat') || null;
          act('tbl_set', {table_id: t.id, to: 'seated', version: t.version,
                          guests: g, client_event_id: uid()}, 'فُتحت الطاولة');
        });
      });
      $$('[data-go]', ov).forEach(function(bt){
        bt.addEventListener('click', function(){
          act('tbl_set', {table_id: t.id, to: bt.getAttribute('data-go'),
                          version: t.version, client_event_id: uid()});
        });
      });

      var fu = $('#tdFu', ov);
      if(fu) fu.addEventListener('click', function(){
        act('tbl_followup', {table_id: t.id, note: 'متابعة الطاولة'}, 'سُجّلت المتابعة');
      });

      var ho = $('#tdHo', ov);
      if(ho) ho.addEventListener('click', function(){
        sheet('تسليم الطاولة', '<label class="f">إلى</label><select class="f" id="thE">'+
          (r.candidates || []).map(function(c){ return '<option value="'+c.id+'">'+esc(c.name)+'</option>'; }).join('')+
          '</select><label class="f">ملاحظة (اختياري)</label><input class="f" id="thN">'+
          '<div class="btnrow"><button class="btn block" id="thOk">تسليم</button></div>',
          function(ov2, close2){
            $('#thOk', ov2).addEventListener('click', function(){
              var to = +$('#thE', ov2).value, nt = $('#thN', ov2).value.trim();
              close2(); act('tbl_handover', {table_id: t.id, to_emp: to, note: nt || null}, 'تم التسليم');
            });
          });
      });

      var mv = $('#tdMv', ov);
      if(mv) mv.addEventListener('click', function(){
        sheet('نقل الطاولة', '<label class="f">إلى طاولة متاحة</label><select class="f" id="tmE">'+
          (r.free_tables || []).map(function(c){ return '<option value="'+c.id+'">طاولة '+(+c.no)+'</option>'; }).join('')+
          '</select><label class="f">السبب (اختياري)</label><input class="f" id="tmN">'+
          '<div class="btnrow"><button class="btn block" id="tmOk">نقل</button></div>',
          function(ov2, close2){
            $('#tmOk', ov2).addEventListener('click', function(){
              var to = +$('#tmE', ov2).value, nt = $('#tmN', ov2).value.trim();
              close2(); act('tbl_move', {from_id: t.id, to_id: to, note: nt || null}, 'نُقلت الطاولة');
            });
          });
      });
    });
  }).catch(function(){ toast('تعذر الاتصال', true); });
}

/* ---------- التحميل والمزامنة ---------- */
function tmLoad(areaId, quiet){
  TM.area = areaId;
  var host = $('#tmHost'); if(!host) return;
  if(!quiet) host.innerHTML = skel(3);
  (TM.admin ? aAct : sAct)('tbl_board', {area_id: areaId}).then(function(res){
    if(!$('#tmHost')) return;
    if(!res || !res.ok){
      $('#tmHost').innerHTML = '<div class="empty">'+esc((res && res.error) || 'تعذر تحميل اللوحة')+'</div>';
      return;
    }
    if(res.server_now) TM.skew = Date.now() - new Date(res.server_now).getTime();
    TM.synced = tmNow();
    TM.data = res;
    tmTick._n = 0;
    tmRender();
  }).catch(function(){
    if(!TM.data && $('#tmHost')) $('#tmHost').innerHTML = '<div class="empty">تعذر الاتصال — سيعاد المحاولة</div>';
  });
}

function tmOpen(areaId, areaName, isAdmin){
  TM.admin = !!isAdmin; TM.filter = 'all'; TM.emp = null; TM.data = null;
  TM.merge = false; TM.pick = {};
  sheet('مركز الطاولات — ' + areaName, '<div id="tmHost">'+skel(3)+'</div>', function(ov, close){
    tmLoad(areaId);
    /* النبضة تعطي الفورية، والاستطلاع يتباعد إلى دقيقة كاحتياط فقط */
    rtConnect();
    rtOn('table_state', function(row){
      if(+row.area_id !== +areaId) return;
      if(!document.body.contains(ov)) return;
      if(document.querySelectorAll('.overlay').length > 1) return;
      clearTimeout(TM.rt);
      TM.rt = setTimeout(function(){ tmLoad(areaId, true); }, 400);  /* تجميع النبضات المتقاربة */
    });
    clearInterval(TM.timer); clearInterval(TM.tick);
    /* عدّاد محلي كل ٣٠ ثانية، ومزامنة كل ١٥ ثانية — بلا استطلاع في الخلفية */
    TM.tick = setInterval(function(){
      if(!document.body.contains(ov)){ clearInterval(TM.tick); return; }
      tmTick._n = (tmTick._n || 0) + 0.5; tmTick();
    }, 30000);
    TM.timer = setInterval(function(){
      if(!document.body.contains(ov)){ clearInterval(TM.timer); return; }
      if(document.hidden) return;
      if(document.querySelectorAll('.overlay').length > 1) return;  /* لا تحديث أثناء إجراء مفتوح */
      tmLoad(areaId, true);
    }, RT.on ? 60000 : 15000);
  });
}

/* سؤال التحقق: ضغطة واحدة، بلا استجواب، ولا يُحسب على أحد */
function loadVerifyCard(){
  var w = $('#vfWrap'); if(!w) return;
  sAct('tbl_verify_pending', {}).then(function(r){
    var c = (r && r.check) || {};
    if(!c.pending){ w.innerHTML = ''; return; }
    w.innerHTML = '<div class="card tm-vf"><h3>'+esc(c.question)+'</h3>'+
      '<div class="tm-vf-note">'+esc(c.note)+'</div>'+
      '<div class="tm-vf-opts">'+
      (c.options || []).map(function(o){
        var st = TMS[o.state] || TMS.free;
        return '<button class="tm-vf-opt" data-vs="'+esc(o.state)+'">'+
               tmIc(st.ic)+esc(st.ar)+'</button>';
      }).join('')+'</div></div>';
    $$('[data-vs]', w).forEach(function(b){
      b.addEventListener('click', function(){
        $$('[data-vs]', w).forEach(function(x){ x.disabled = true; x.style.opacity = '.55'; });
        sAct('tbl_verify_answer', {check_id: c.id, state: b.getAttribute('data-vs')}, true).then(function(res){
          toast((res && res.msg) || 'شكراً'); w.innerHTML = '';
        }).catch(function(){
          $$('[data-vs]', w).forEach(function(x){ x.disabled = false; x.style.opacity = ''; });
          toast('تعذر الإرسال', true);
        });
      });
    });
  }).catch(function(){});
}


/* ================= المساهمات الإضافية =================
   زر ثانوي واضح ضمن شريط الإجراءات، لا زر عائم يغطي المحتوى ولا منافس للمهمة. */
var CCAT = [
  ['support_colleague','مساندة زميلة'],
  ['cover_area','تغطية منطقة'],
  ['proactive','عمل استباقي'],
  ['fix_blocker','حل عائق أو نقص'],
  ['handle_report','معالجة بلاغ'],
  ['training','تدريب أو تسليم'],
  ['emergency','خدمة أو موقف طارئ'],
  ['other','عمل آخر']
];
var CSTAT = {captured:'مسجّلة', pending_confirmation:'بانتظار تأكيد الزميلة',
  verified:'مؤكَّدة', approved:'معتمدة', disputed:'محل مراجعة', rejected:'غير معتمدة'};

function loadContribCard(){
  var w = $('#cbWrap'); if(!w) return;
  sAct('contrib_mine', {}).then(function(r){
    if(!r || !r.ok){ w.innerHTML = ''; return; }
    var h = '';

    /* مساندة جارية: مؤقت وزر إنهاء */
    if(r.live){
      h += '<div class="card cb-live"><div class="cb-live-h">'+tmIc('handover')+
        '<div><b>مساندة جارية</b><span class="tdur" data-since="'+r.live.started_at+'"></span></div></div>'+
        '<button class="btn block" id="cbEnd">أنهيت المساندة</button></div>';
    }

    /* طلب تأكيد من زميلة — لا يُستخدم لإدانة أحد */
    (r.to_confirm || []).forEach(function(c){
      h += '<div class="card cb-cf"><b>'+esc(c.who)+' سجّلت أنها ساعدتك</b>'+
        (c.what ? '<div class="small muted" style="margin:3px 0">'+esc(c.what)+'</div>' : '')+
        '<div class="small muted">'+(+c.minutes || 0)+' دقيقة</div>'+
        '<div class="btnrow" style="margin-top:7px">'+
        '<button class="btn sm" data-cy="'+c.id+'">نعم</button>'+
        '<button class="btn sm ghost" data-cp="'+c.id+'">جزئياً</button>'+
        '<button class="btn sm ghost" data-cn="'+c.id+'">لم تحدث</button></div></div>';
    });

    h += '<div class="btnrow" style="margin-top:2px">'+
         '<button class="btn ghost block" id="cbNew">+ مساهمة إضافية</button></div>';
    w.innerHTML = h;

    var eb = $('#cbEnd', w);
    if(eb) eb.addEventListener('click', function(){
      eb.disabled = true;
      sAct('contrib_end', {id: r.live.id}, true).then(function(x){
        toast((x && x.msg) || 'تم'); loadContribCard();
      }).catch(function(){ eb.disabled = false; toast('تعذر الإرسال', true); });
    });

    function answer(id, a){
      sAct('contrib_confirm', {id: id, answer: a}, true).then(function(x){
        toast((x && x.msg) || 'شكراً'); loadContribCard();
      });
    }
    $$('[data-cy]', w).forEach(function(b){ b.addEventListener('click', function(){ answer(+b.getAttribute('data-cy'), 'yes'); }); });
    $$('[data-cp]', w).forEach(function(b){ b.addEventListener('click', function(){ answer(+b.getAttribute('data-cp'), 'partial'); }); });
    $$('[data-cn]', w).forEach(function(b){ b.addEventListener('click', function(){ answer(+b.getAttribute('data-cn'), 'no'); }); });

    $('#cbNew', w).addEventListener('click', contribSheet);
  }).catch(function(){});
}

/* قائمة سفلية سريعة، لا صفحة طويلة */
function contribSheet(){
  var areas = ((S.state || {}).areas) || [];
  var mates = ((S.state || {}).mates) || [];
  sheet('مساهمة إضافية',
    '<div class="cb-two">'+
      '<button class="cb-opt" data-k="live"><b>سأساعد الآن</b><span>يبدأ المؤقت ويُحدَّث حِملك</span></button>'+
      '<button class="cb-opt" data-k="after"><b>أنجزت عملاً إضافياً</b><span>تسجيل بعد الإنجاز</span></button>'+
    '</div><div id="cbPre"></div><div id="cbForm"></div>',
    function(ov, close){
      /* الفحص المسبق يُنادى عند الفتح لا عند الإرسال: الموظفة تعرف قبل أن
         تكتب أن لا شفت نشطاً لها أو أن هناك مساندة جارية، بدل أن تملأ
         النموذج ثم تُرفض. الخادم يظل هو من يمنع فعلياً. */
      sAct('contrib_precheck', {}).then(function(pc){
        var box = $('#cbPre', ov); if(!box) return;
        if(pc && pc.ok){
          if((pc.warnings || []).length){
            box.innerHTML = '<div class="cbpre warn">'+esc((pc.warnings[0] || {}).text || '')+'</div>';
          }
          return;
        }
        box.innerHTML = '<div class="cbpre bad">'+esc((pc && pc.error) || 'لا يمكن التسجيل الآن')+'</div>';
        $$('.cb-opt', ov).forEach(function(x){ x.disabled = true; });
      }).catch(function(){});
      $$('.cb-opt', ov).forEach(function(b){
        b.addEventListener('click', function(){
          $$('.cb-opt', ov).forEach(function(x){ x.classList.remove('on'); });
          b.classList.add('on');
          var kind = b.getAttribute('data-k');
          $('#cbForm', ov).innerHTML =
            '<label class="f">نوع العمل</label><select class="f" id="cbC">'+
              CCAT.map(function(c){ return '<option value="'+c[0]+'">'+esc(c[1])+'</option>'; }).join('')+'</select>'+
            '<label class="f">المنطقة</label><select class="f" id="cbA"><option value="">—</option>'+
              areas.map(function(a){ return '<option value="'+a.id+'">'+esc(a.name)+'</option>'; }).join('')+'</select>'+
            '<label class="f">الزميلة المستفيدة (عند الحاجة)</label><select class="f" id="cbB"><option value="">—</option>'+
              mates.map(function(m){ return '<option value="'+m.id+'">'+esc(m.name)+'</option>'; }).join('')+'</select>'+
            '<label class="f">وصف قصير</label><input class="f" id="cbD" maxlength="200" placeholder="مثال: ساعدت ليان بتنظيف أربع طاولات">'+
            (kind === 'after' ? '<label class="f">المدة التقريبية (دقيقة)</label><input class="f" id="cbM" type="number" min="3" max="180" value="15">' : '')+
            '<div class="btnrow"><button class="btn block" id="cbGo">'+
              (kind === 'live' ? 'ابدئي المساندة' : 'سجّلي المساهمة')+'</button></div>'+
            '<div class="muted" style="font-size:11px;margin-top:6px">تُسجَّل ولا تُعتمد مباشرة — يتحقق منها النظام أو الزميلة. لا مقارنة بينك وبين غيرك.</div>';

          $('#cbGo', ov).addEventListener('click', function(){
            var btn = this; btn.disabled = true;
            var payload = {
              category: $('#cbC', ov).value,
              area_id: $('#cbA', ov).value || null,
              beneficiary: $('#cbB', ov).value || null,
              description: $('#cbD', ov).value.trim()
            };
            if(kind === 'after') payload.minutes = +$('#cbM', ov).value || 0;
            sAct(kind === 'live' ? 'contrib_start' : 'contrib_log', payload, true).then(function(x){
              btn.disabled = false;
              if(x && x.ok){
                toast(x.msg || 'تم');
                if((x.warnings || []).length){
                  toast((x.warnings[0] || {}).text || '', true, 4500);
                }
                close(); loadContribCard();
              } else toast((x && x.error) || 'تعذر التسجيل', true, 4200);
            }).catch(function(){ btn.disabled = false; toast('تعذر الاتصال', true); });
          });
        });
      });
    });
}

/* ---------- تبويب: الآن ---------- */
/* ---------- بطاقات لوحة اليوم (تنبيهات + استراحة + عمليات الشفت) ---------- */
function dashAlerts(){
  var st=S.state, out=[];
  (st.recognitions||[]).forEach(function(r){
    out.push('<div class="card recog"><b>تقدير من الإدارة</b><div style="margin:6px 0">'+esc(r.text)+'</div><button class="btn sm ghost" data-a="ack">شكراً، قرأتها</button></div>');
  });
  if(st.handover_in){
    var hi=st.handover_in, hitems=hi.items||{};
    out.push('<div class="card beige"><h3>تسليم شفت من '+esc(hi.from)+'</h3>'+
      (hi.brief?handoverBriefCard(hi.brief,true):'')+
      handoverItemsHtml(hitems)+
      voicePlayHtml(hi.voice,'مذكرة صوتية من الزميلة')+
      '<label class="f">ملاحظتك (اختياري)</label><input class="f" id="hoNote">'+
      '<div class="btnrow"><button class="btn block" data-a="hoConfirm" data-id="'+hi.id+'">استلمت وفهمت ✔</button></div></div>');
  }
  if(st.cover_offer){
    out.push('<div class="card beige"><h3>طلب تغطية غياب</h3>'+
      '<div>الإدارة تطلب منك تغطية غياب <b>'+esc(st.cover_offer.from)+'</b> اليوم'+(st.cover_offer.area?' في <b>'+esc(st.cover_offer.area)+'</b>':'')+'.</div>'+
      '<div class="muted small" style="margin:6px 0">موافقتك تُسجَّل لصالحك في التغطيات. الاعتذار حقك ولن يُحسب ضدك.</div>'+
      '<div class="btnrow"><button class="btn block" data-a="covAccept" data-id="'+st.cover_offer.id+'">أوافق على التغطية ✔</button>'+
      '<button class="btn ghost red block" data-a="covDecline" data-id="'+st.cover_offer.id+'">أعتذر اليوم</button></div></div>');
  }
  return out.join('');
}
function dashBreak(){
  var st=S.state, sh=st.shift, att=st.attendance;
  if(!sh) return '';
  var inT = att && att['in'], outT = att && att.out;
  if(!(inT && !outT)) return '';
  var done=(st.breaks||[]).filter(function(b){return b.end;}).length;
  var openBr=(st.breaks||[]).filter(function(b){return !b.end;})[0];
  var alloc=+sh.break_minutes||0, noAlloc=alloc<=0;
  /* الشفت المخصص بلا نوع ⇒ استراحة مخصصة صفر. كانت البطاقة تعرض «المخصص: 0 د»
     بجانب «جارية 00:41» وتدعو لبدء استراحة — ثلاث رسائل متناقضة في بطاقة
     واحدة. الآن السبب مكتوب، ولا تُعرض دعوةٌ لما لا رصيد له، لكن إنهاء
     استراحة جارية يبقى متاحاً دائماً حتى لا تُحتجز الموظفة فيها. */
  return '<div class="card"><h3>الاستراحة'+(st.break_open&&openBr?' <span class="chip orange">جارية <b class="timer" data-brk="'+esc(openBr.start)+'">00:00</b></span>':'')+'</h3>'+
    (noAlloc
      ? '<div class="muted small">هذا الشفت بلا استراحة مخصّصة'+
        (st.break_open?' — الاستراحة الجارية تُحسب وقتاً غير مدفوع. أنهيها حين ترجعين.':'. إن احتجتِ استراحة فراسلي الإدارة.')+'</div>'
      : '<div class="muted small">الحد الأقصى 30 دقيقة (تُغلق تلقائياً عند تجاوزها) · المأخوذ اليوم: '+done+' من '+(sh.break_parts||1)+' · المخصص: '+mins(alloc)+'</div>')+
    '<div class="btnrow">'+
    (st.break_open
      ? '<button class="btn block" data-a="brEnd">أنهيت الاستراحة — رجعت</button>'
      : (noAlloc ? ''
        : '<button class="btn ghost" data-a="brStart">بدء استراحة</button><button class="btn ghost" data-a="brPost">تأجيل بسبب الضغط</button>'))+
    '</div></div>';
}
function dashOps(mode){
  var st=S.state, sh=st.shift, out=[];
  if(!sh) return '';
  var onlyDue=(mode==='due'), choresOnly=(mode==='chores');
  // ضغط منطقتي — إجراء سريع مطويّ افتراضياً
  var myP=null; (st.pressure||[]).forEach(function(p){ if(p.area_id===sh.area_id) myP=p; });
  if(!choresOnly && sh.area_id && (sh.tables||0)>0){
    var occ=myP?myP.occupied:0, wait=myP?myP.waiting:'none';
    out.push('<details class="qa"><summary>تحديث ضغط منطقتي '+(myP&&myP.stale?'<span class="chip orange">التحديث قديم</span>':(myP?'<span class="chip">'+occ+'/'+sh.tables+' طاولة</span>':''))+'</summary><div class="qa-body">'+
      '<div class="muted small">طاولات مشغولة من أصل '+sh.tables+'</div>'+
      '<div class="step" style="margin:8px 0"><button data-a="occ" data-d="-1">−</button><div class="val" id="occV" data-v="'+occ+'" data-max="'+sh.tables+'">'+occ+'</div><button data-a="occ" data-d="1">+</button></div>'+
      '<div class="seg" id="waitSeg">'+['none','low','high'].map(function(w){return '<button data-w="'+w+'" class="'+(w===wait?'on':'')+'">'+WAIT[w]+'</button>';}).join('')+'</div>'+
      '<div class="check"><input type="checkbox" id="backlogC" '+(myP&&myP.backlog?'checked':'')+'><span>يوجد تراكم طلبات</span></div>'+
      '<div class="check"><input type="checkbox" id="supC" '+(myP&&myP.needs_support?'checked':'')+'><span>أحتاج دعماً الآن</span></div>'+
      '<div class="btnrow"><button class="btn block" data-a="pSend">تحديث الضغط</button></div></div></details>');
  }
  // مهام دوّارة يتناوبها الجميع بعدالة
  // توجيه المحرك: إن كانت هناك مهمة أهمّ مُسندة (خدمة/تشغيل مباشر) غير مبدوءة، تُصبح الدوّارات ثانوية
  var directed=(st.tasks||[]).filter(function(x){return (x.status==='open'||x.status==='returned') && (x.tier<=2) && !x.started_at;})
    .sort(function(a,b){return ((b.wf_priority&&b.wf_priority.total)||0)-((a.wf_priority&&a.wf_priority.total)||0);})[0];
  (st.recurring||[]).forEach(function(rt){
    var pct = rt.target>0 ? Math.min(100, Math.round(100*rt.done/rt.target)) : 0;
    var full = rt.target>0 && rt.done>=rt.target;
    var overdue = !full && rt.cadence_min>0 && (!rt.last_ts || (Date.now()-new Date(rt.last_ts).getTime())/60000 >= rt.cadence_min);
    var mineTurn = rt.turn && S.me && rt.turn.id===S.me.id;
    var claim = rt.claim, claimedByOther = claim && !claim.mine, claimedByMe = claim && claim.mine;
    if(onlyDue && (full || !(mineTurn || overdue || claim))) return;
    var head='<h3>'+esc(rt.name)+' <span class="muted small" style="font-weight:400">'+esc(rt.area||'')+(rt.all_staff?' · للجميع':'')+'</span>'+
      (full?' <span class="chip green">اكتمل</span>':overdue?' <span class="chip orange">حان وقتها</span>':'')+'</h3>';
    var turnLine='';
    if(!full && !claim){
      if(mineTurn) turnLine='<div class="chip green" style="margin:3px 0">دورك الآن</div>';
      else if(rt.turn) turnLine='<div class="muted small" style="margin:3px 0">الدور التالي: <b>'+esc(rt.turn.name)+'</b> — وأي زميلة فاضية تقدر تسبقها</div>';
    }
    var counters = rt.target>0
      ? '<div class="muted small">المطلوب اليوم: '+rt.done+' من '+rt.target+' · نصيبك: '+rt.mine+'</div><div class="pbar"><i style="width:'+pct+'%"></i></div>'
      : '<div class="muted small">أُنجزت اليوم: '+rt.done+' مرة · نصيبك: '+rt.mine+'</div>';
    var recent = (rt.recent&&rt.recent.length)?'<div class="small muted" style="margin-top:6px">آخر من نفّذها: '+rt.recent.map(function(x){return esc(x.who)+' ('+fmtT(x.ts)+')';}).join('، ')+'</div>':'';
    var btns;
    /* «أنجزتُها» فعل لا رجعة فيه سهل: كان كبسةً واحدة، بينما المهمة العادية
       تطلب سحباً للتأكيد. توحيد القواعد: كل إعلان إنجاز يُسحب لا يُكبس،
       والبدء والتراجع يبقيان كبسة لأنهما قابلان للعكس. */
    if(full) btns='<div class="btnrow"><button class="btn sm block" disabled>اكتمل المطلوب</button></div>';
    else if(claimedByOther) btns='<div class="chip orange" style="display:block;text-align:center;padding:9px;margin-top:8px"><b>'+esc(claim.who)+'</b> تقوم بها الآن</div>';
    else if(claimedByMe) btns='<div style="margin-top:9px">'+
        swipeHtml('swRec'+rt.template_id,'اسحبي: أنجزتها')+
        '<div class="btnrow" style="margin-top:7px"><button class="btn sm ghost block" data-a="recRelease" data-id="'+rt.template_id+'">تراجع عن الحجز</button></div></div>';
    else btns='<div style="margin-top:9px">'+
        '<div class="btnrow"><button class="btn sm block" data-a="recClaim" data-id="'+rt.template_id+'">أنا بعملها الآن</button></div>'+
        '<div style="margin-top:7px">'+swipeHtml('swRec'+rt.template_id,'اسحبي: أنجزتها مباشرة')+'</div></div>';
    var steer='';
    if(directed && !full && !claimedByOther){
      steer='<div class="chip orange" style="display:block;text-align:center;padding:8px;margin-top:8px">الأهم الآن: '+esc(directed.name)+'</div>';
      btns=btns.replace('btn sm block','btn sm block ghost');
    }
    out.push('<div class="card'+((mineTurn&&!claim)||overdue?' beige':'')+(directed&&!full?' dim':'')+'">'+head+turnLine+counters+recent+steer+btns+'</div>');
  });
  // نداءات المساعدة — مفتوحة تلقائياً فقط عند وجود نداء
  if(!choresOnly){
    var helps=st.help_open||[];
    out.push('<details class="qa"'+(helps.length?' open':'')+'><summary>نداءات المساعدة'+(helps.length?' <span class="chip red">'+helps.length+'</span>':' <span class="chip">لا نداءات</span>')+'</summary><div class="qa-body">'+
      (helps.length ? helps.map(function(h){
        return '<div class="row" style="justify-content:space-between;border-bottom:1px dashed var(--line);padding:6px 0">'+
          '<div><b>'+esc(h.area)+'</b> <span class="muted small">'+esc(h.note||'')+'</span>'+(h.mine?' <span class="chip">ندائي</span>':'')+'</div>'+
          '<button class="btn sm ghost" data-a="helpClose" data-id="'+h.id+'">'+(h.mine?'إلغاء':'لبّيته ✔')+'</button></div>';
      }).join('') : '<div class="muted small">لا نداءات الآن</div>')+
      '<div class="btnrow"><button class="btn ghost block" data-a="helpNew">طلب مساعدة لمنطقتي</button></div></div></details>');
    out.push('<div id="sigWrap"></div>');
    out.push('<div id="cbWrap"></div>');
    out.push('<div id="vfWrap"></div>');
    out.push('<div id="tblWrap"></div>');
    out.push('<div id="opsWrap"></div>');
    out.push('<div id="prepWrap"></div>');
  }
  return out.join('');
}
/* بطاقة «المهمة الحالية» — بطاقة رئيسية بزرّ أساسي واحد حسب الحالة */
function heroTaskCard(t){
  var stTxt={open:'لم تبدأ',running:'قيد التنفيذ الآن',paused:'متوقفة مؤقتاً',returned:'مُعادة من الإدارة'}[t.status]||TSTAT[t.status]||'';
  var stCls={open:'',running:'green',paused:'orange',returned:'red'}[t.status]||'';
  if(t.status==='paused'&&t.blocked){ stTxt='متوقفة — يوجد مانع'; stCls='red'; }
  /* فرقٌ جوهري: توقّفٌ اختارته الموظفة، وتأجيلٌ قرّره المحرّك لأن الصالة
     مضغوطة. الثاني كان يظهر بنفس صورة الأول مع زرّ «استئناف» بلا سبب —
     فأيّ موظفة ستضغطه وتُبطل المعنى. الآن يُقرأ السبب قبل أيّ زر. */
  var deferred = (t.status==='paused' && !t.blocked && !!t.defer_reason);
  if(deferred){ stTxt='مؤجَّلة — الخدمة أولاً'; stCls='orange'; }
  var range='~'+t.expected+'–'+Math.round(t.expected*1.5)+' د';
  if(workLocked()){
    return '<div class="hero-task">'+
      '<div class="ht-k">مهمتك · '+esc(PHASE[t.phase]||'')+(t.is_core?' · أساسية':'')+'</div>'+
      '<div class="ht-name">'+esc(t.name)+'</div>'+
      '<div class="row" style="justify-content:space-between;margin-top:10px"><span class="chip '+stCls+'">'+stTxt+'</span></div>'+
      '<div class="card soft" style="margin:12px 0 0;padding:12px 14px;background:var(--surface-2);border:1px dashed var(--line)"><b>انتهى شفتك</b><div class="muted small" style="margin-top:2px">لا يمكن تنفيذ أو تعديل المهام خارج الشفت.</div></div></div>';
  }
  var prim, sec='';
  if(t.status==='running'){ prim=swipeHtml('swDone'+t.id,'اسحبي: أنجزت وأؤكد النتيجة'); sec='<button class="btn sm ghost" data-a="tPause" data-id="'+t.id+'">إيقاف مؤقت</button>'; }
  else if(t.status==='paused'&&t.blocked){ prim='<button class="btn block" data-a="tUnblock" data-id="'+t.id+'">أُزيل المانع واستأنف</button>'; }
  else if(deferred){ prim='<button class="btn block ghost" data-a="tResume" data-id="'+t.id+'">أستأنفها الآن على أي حال</button>'; }
  else if(t.status==='paused'){ prim='<button class="btn block" data-a="tResume" data-id="'+t.id+'">استئناف</button>'; }
  else { prim='<button class="btn block" data-a="tStart" data-id="'+t.id+'">بدأت التنفيذ</button>'; }
  var needs=[]; if(t.needs_photo||t.method==='photo') needs.push('تحتاج صورة'); if(t.needs_two||t.method==='two_person') needs.push('موظفتان'); if(t.method==='checklist') needs.push('قائمة تحقق'); if(t.needs_review||t.method==='review') needs.push('مراجعة إدارة');
  return '<div class="hero-task">'+
    '<div class="ht-k">مهمتك الآن · '+esc(PHASE[t.phase]||'')+(t.is_core?' · أساسية':'')+'</div>'+
    '<div class="ht-name">'+esc(t.name)+'</div>'+
    (t.description?'<div class="ht-meta" style="color:var(--ink)">'+esc(t.description)+'</div>':'')+
    (t.reason?'<div class="card soft" style="margin:9px 0 0;padding:9px 11px"><div class="small"><b>لماذا هذه المهمة:</b> '+esc(t.reason)+'</div>'+
      (t.impact?'<div class="muted small" style="margin-top:2px">إن لم تُنفَّذ: '+esc(t.impact)+'</div>':'')+'</div>':'')+
    (deferred?'<div class="card soft" style="margin:9px 0 0;padding:9px 11px;border:1px dashed var(--line)"><div class="small"><b>أجّلها النظام:</b> '+esc(t.defer_reason)+'</div><div class="muted small" style="margin-top:2px">تعود إلى قائمتك تلقائياً حين تهدأ الصالة — لا حاجة لأي إجراء.</div></div>':'')+
    '<div class="ht-meta">الوقت التقريبي '+range+(needs.length?' · '+needs.join(' · '):'')+'</div>'+
    (t.status==='returned'&&t.admin_note?'<div class="small" style="color:var(--red);margin-top:6px">ملاحظة الإدارة: '+esc(t.admin_note)+'</div>':'')+
    /* حُذف زرّان من هذا السطر:
       «لماذا أنا؟» — عرضُ سبب اختيار الموظفة لمهمة ممنوعٌ بنصّ الوثيقة،
       وهو يفتح جدالاً لا يُغلق ولا يغيّر شيئاً في المهمة نفسها.
       «كل المهام» — صار سطر «التالية» أسفل البطاقة يفتحها، فكان تكراراً
       لمقصدٍ واحد في موضعين. */
    '<div class="row" style="justify-content:space-between;margin-top:10px"><span class="chip '+stCls+'">'+stTxt+'</span></div>'+
    (t.status==='running'
      ? '<div style="margin-top:10px">'+prim+'</div>'+
        '<div class="btnrow" style="margin-top:6px">'+sec+
          '<button class="btn sm ghost" data-a="tCant" data-id="'+t.id+'">لم أستطع</button>'+
          (t.blocked?'':'<button class="btn sm ghost red" data-a="tBlock" data-id="'+t.id+'">يوجد مانع</button>')+'</div>'
      : '<div class="btnrow" style="margin-top:10px">'+prim+sec+
          (t.blocked?'':'<button class="btn sm ghost red" data-a="tBlock" data-id="'+t.id+'">يوجد مانع</button>')+'</div>')+
    '</div>';
}
/* شريط مرحلة اليوم: الموظفة كانت لا ترى أبداً في أي مرحلة الكافيه، فتقرأ
   الضغط من الطاولات وحدها. المرحلة تغيّر الأولويات فعلياً (ذروة ≠ تهدئة)،
   ولذلك تُعرض بوضوح مع السبب حين تُعلنه الإدارة.
   يتحدّث ذاتياً كل دقيقتين بنداء day_state الخفيف — لا بنداء state الكامل
   لأن ذاك يعيد توليد المهام في الخادم. */
var DPS_T=null;
function dayPhaseStrip(day){
  if(!day || !day.phase) return '';
  var hot=day.phase==='peak', declared=day.source==='owner';
  var lbl=(typeof dphName==='function')?dphName(day.phase):day.phase;
  clearInterval(DPS_T);
  DPS_T=setInterval(function(){
    var el=$('#dps'); if(!el){ clearInterval(DPS_T); return; }
    sAct('day_state',{}).then(function(r){
      if(!r || !r.ok || !r.day) return;
      if(S.state) S.state.day=r.day;
      var box=$('#dps'); if(box) box.outerHTML=dayPhaseStrip(r.day);
    });
  }, 120000);
  return '<div class="dps'+(hot?' hot':'')+'" id="dps">'+
    '<span class="dps-d" aria-hidden="true"></span>'+
    '<span class="dps-t">'+esc(lbl)+'</span>'+
    (day.reason?'<span class="dps-r">'+esc(day.reason)+'</span>':'')+
    (declared?'<span class="dps-b">من الإدارة</span>':'')+
  '</div>';
}
/* تحويل آمن لأي وقت قادم من الخادم: null و'' و undefined كلها «لا وقت»،
   لا صفر. كل حساب زمني في الواجهة يمرّ من هنا. */
function tsOrNull(v){
  if(v===null || v===undefined || v==='') return null;
  var t=new Date(v).getTime();
  return isFinite(t) ? t : null;
}
/* رأس الشفت المفتوح: يحلّ محل حلقة التقدّم. لا نسبة ولا وقت متبقٍّ، لأن
   النسبة بلا نهاية معروفة رقمٌ مُختلق — عدّاد تصاعدي وسببٌ مكتوب. */
function openShiftHeader(inT){
  var mins_ = inT ? Math.max(0, Math.round((Date.now()-new Date(inT).getTime())/60000)) : 0;
  return '<div class="ossh"><div class="ossh-h">'+
      '<span class="ossh-dot" aria-hidden="true"></span><b>شفت مفتوح</b>'+
      '<span class="ossh-tag">بلا وقت انتهاء محدّد</span></div>'+
    /* الصياغة نفسها التي تكتبها النبضة: لولا ذلك لتغيّر شكل الرقم بعد ثانية */
    (inT ? '<div class="ossh-t"><b class="tdur" data-since="'+esc(inT)+'">'+tmDur(mins_)+'</b>'+
           '<span>منذ الحضور '+fmtT(inT)+'</span></div>' : '')+
    '<div class="ossh-n">حضور غير مجدول: لا نهاية مخطّطة، فلا نسبة إنجاز ولا وضع إغلاق. '+
      'أنهي يومك بالانصراف حين تنتهين.</div></div>';
}
/* ============ شاشة «الآن» — أربع كتل ثابتة ============
   القاعدة التي تحكم هذا الملف: الموظفة في الذروة لا تقرأ الشاشة، بل تصل
   بيدها إلى موضعٍ حفظته. فترتيب الكتل لا يتغيّر بين شفت وآخر ولا بين
   حمولة وأخرى — يتغيّر ما بداخلها لا مكانها.

     ١) مَن أنا وما حالتي ووقت شفتي
     ٢) أين أعمل الآن
     ٣) ماذا أفعل الآن — زرّ واحد كبير، وتحته سطر: وماذا بعد
     ٤) أربعة اختصارات

   وسؤال الانصراف يعلو الكتل كلّها حين يوجد، لأنه الشيء الوحيد الذي
   يخصّ الأمس ويجب أن يُغلق قبل أن يبدأ اليوم. */
function nowPendingOut(){
  var po = S.state && S.state.pending_out;
  if(!po || !po.shift_id || S._outAsked) return '';
  var endTxt = po.shift_end ? fmtT(po.shift_end) : null;
  return '<div class="nx-ask" id="outAsk">'+
    '<b>شفتكِ أمس بقي مفتوحاً</b>'+
    '<span>أُغلق تلقائياً '+fmtT(po.closed_at)+'. متى غادرتِ فعلاً؟</span>'+
    '<div class="nx-ask-b">'+
      (endTxt?'<button data-oc="shift_end">نهاية الشفت<i>'+esc(endTxt)+'</i></button>':'')+
      (endTxt?'<button data-oc="minus_30">قبلها بنصف ساعة<i>'+esc(fmtT(new Date(new Date(po.shift_end).getTime()-1800000)))+'</i></button>':'')+
      '<button data-oc="custom">وقت آخر</button>'+
    '</div></div>';
}

/* الكتلة الثالثة: الفعل الواحد. محتواها يتبع المرحلة، وموضعها لا يتبعها. */
function nowAction(st, sh, inT, outT, pend, nearEnd, openBr){
  /* الاستراحة: حين تكون جارية فالسؤال «ماذا أفعل الآن؟» جوابه «ارجعي»،
     لا مهمة. وكانت الشاشة تبتلع الوقت تماماً بعد إلغاء بطاقة الاستراحة
     القديمة — تضغط الموظفة «استراحة» فلا يظهر لها شيء، فلا تعرف كم مضى
     ولا كم بقي قبل الإغلاق التلقائي عند الثلاثين. */
  if(openBr){
    var lim = 30;
    return '<div class="nx-do nx-do--brk">'+
      '<b>استراحة — <span class="timer" data-brk="'+esc(openBr.start)+'">00:00</span></b>'+
      '<span>تُغلق تلقائياً بعد '+lim+' دقيقة من بدايتها ('+fmtT(openBr.start)+').</span>'+
      '<button class="nx-btn" data-a="brEnd">رجعت — أنهيت الاستراحة</button></div>';
  }
  if(!sh){
    return '<div class="nx-do nx-do--go">'+
      '<b>لا شفت مجدول لكِ اليوم</b>'+
      '<span>إن كنتِ في الكافيه فعلاً، سجّلي حضورك ويصل وقتك للإدارة.</span>'+
      '<button class="nx-btn" data-a="checkin">تسجيل الحضور</button></div>';
  }
  if(!inT){
    return '<div class="nx-do nx-do--go">'+
      '<b>'+esc(sh.name||'شفتك')+' يبدأ '+fmtT(sh.start)+'</b>'+
      '<span>سجّلي حضورك من داخل الكافيه.</span>'+
      '<button class="nx-btn" data-a="checkin">تسجيل الحضور</button></div>';
  }
  if(outT){
    return '<div class="nx-do nx-do--done">'+
      '<b>أُغلق يومك</b>'+
      '<span>حضور '+fmtT(inT)+' · انصراف '+fmtT(outT)+'</span></div>';
  }
  if(pend.length) return heroTaskCard(pend[0]);

  /* لا مهام: إمّا الشفت بلا منطقة — وهو عطل تشغيلي تعرفه الإدارة لا
     الموظفة — أو انتهى كل شيء فالانصراف هو الفعل التالي. */
  if(!sh.area_id){
    return '<div class="nx-do nx-do--warn">'+
      '<b>شفتكِ بلا منطقة</b>'+
      '<span>لذلك لم تصلكِ مهام. أبلغي الإدارة وستظهر فوراً.</span>'+
      '<button class="nx-btn" data-a="helpNew">تنبيه الإدارة</button></div>';
  }
  if(nearEnd){
    return '<div class="nx-do nx-do--go">'+
      '<b>أنهيتِ كل شيء</b>'+
      '<span>لم يبقَ مطلوب منكِ — يمكنكِ الانصراف.</span>'+
      '<button class="nx-btn" data-a="checkout">تسجيل الانصراف</button></div>';
  }
  return '<div class="nx-do nx-do--idle">'+
    '<b>لا مهمة مطلوبة منكِ الآن</b>'+
    '<span>أنجزتِ ما عليكِ — استعدي لأي نداء.</span></div>';
}

function viewNow(){
  var st=S.state, sh=st.shift, att=st.attendance;
  var inT = att && att['in'], outT = att && att.out;
  var out=[];

  /* سؤال الأمس أوّلاً */
  out.push(nowPendingOut());

  /* ── الكتلة ١: الحالة ── */
  var stateTxt, stateCls;
  if(!inT)      { stateTxt='لم تبدئي بعد'; stateCls='off'; }
  else if(outT) { stateTxt='انتهى دوامك';  stateCls='off'; }
  else if(st.breaks && st.breaks.some(function(b){return !b.end;}))
                { stateTxt='في استراحة';   stateCls='brk'; }
  else          { stateTxt='قيد الدوام';   stateCls='on';  }

  var e0=tsOrNull(sh&&sh.end), now=Date.now();
  var timeTxt = !sh ? '' :
    (e0===null ? 'من '+fmtT(sh.start)+' — بلا وقت انتهاء محدّد'
               : fmtT(sh.start)+' → '+fmtT(sh.end));
  out.push('<div class="nx-id">'+
    '<div class="nx-id-t"><b>'+esc(S.me?S.me.name:'')+'</b>'+
      '<span class="nx-st '+stateCls+'">'+stateTxt+'</span></div>'+
    (timeTxt?'<div class="nx-id-s">'+esc(sh.name||'شفت')+' · '+esc(timeTxt)+'</div>':'')+
  '</div>');

  /* ── الكتلة ٢: المنطقة ── */
  var zone = (st.my_zone && st.my_zone.area) || (sh && sh.area) || null;
  out.push('<div class="nx-zone'+(zone?'':' none')+'">'+
    (zone ? '<b>'+esc(zone)+'</b><span>منطقتكِ الآن</span>'
          : '<b>بلا منطقة</b><span>لم تُحدَّد لكِ منطقة اليوم</span>')+'</div>');

  /* تنبيه عاجل — فوق الفعل مباشرة، ولا يظهر إلا إن وُجد */
  var urgent=(st.notifs||[]).filter(function(n){ return n.kind==='alert' && !n.read; });
  if(urgent.length) out.push('<div class="nx-urgent">'+IC.bell+
    '<div><b>'+esc(urgent[0].title||'تنبيه')+'</b>'+
    (urgent[0].body?'<span>'+esc(urgent[0].body)+'</span>':'')+'</div></div>');

  /* ── الكتلة ٣: الفعل ── */
  /* وقت الإغلاق: نهاية الشفت إن كانت معروفة، وإلا إغلاق المقهى. الشفت
     المفتوح كان يجعل كل مهام الإغلاق «مستحقّة الآن» فور الحضور — فتظهر
     «إغلاق الكاش» الساعة ٨:٤٤ م بوصفها مهمة اللحظة، وبقيّة الشفت أمامها. */
  var cfg=(st.cfg||{}), closeH=String(cfg.close||'23:30').split(':');
  var closeAt=new Date(); closeAt.setHours(+closeH[0]||23, +closeH[1]||30, 0, 0);
  var endRef = (e0!==null ? e0 : closeAt.getTime());
  var closingFrom = endRef - 60*60000;      /* آخر ساعة قبل النهاية */
  var inClosing = now >= closingFrom;

  var order={opening:0,during:1,adhoc:2,closing:3};
  /* مهمة «مستحقّة الآن»: مهام الإغلاق لا تكون كذلك قبل أوانها. لا تُخفى
     — تبقى في «كل المهام» ويمكن إنجازها مبكراً بإرادة الموظفة — لكنها
     لا تُنصَّب مهمةَ اللحظة ولا تسبق ما هو مطلوب فعلاً الآن. */
  function dueNow(t){ return !(t.phase==='closing' && !inClosing); }
  var pend=(st.tasks||[]).filter(function(t){return ['done','approved','carried','cancelled'].indexOf(t.status)<0;})
    .sort(function(a,b){
      var da=dueNow(a)?0:1, db=dueNow(b)?0:1;
      if(da!==db) return da-db;
      var pa=(a.wf_priority&&a.wf_priority.total)||0, pb=(b.wf_priority&&b.wf_priority.total)||0;
      if(pb!==pa) return pb-pa;
      return (order[a.phase]==null?9:order[a.phase])-(order[b.phase]==null?9:order[b.phase]);
    });
  var due=pend.filter(dueNow);
  var nearEnd = !!(inT && !outT && now >= endRef - 30*60000);
  var openBr=(st.breaks||[]).filter(function(b){ return !b.end; })[0];
  out.push(nowAction(st, sh, inT, outT, due, nearEnd, openBr));

  /* «وماذا بعد» — سطر خبر لا زرّ. جعلُه زرّاً يفتح قائمة المهام يُكرّر
     اختصار «مهمة منجزة» أدناه، ومقصدٌ واحد في موضعين هو ما نحذفه. */
  if(inT && !outT && due.length>1)
    out.push('<div class="nx-next">'+
      '<span class="k">التالية</span><b>'+esc(due[1].name)+'</b>'+
      (due.length>2?'<i>+'+(due.length-2)+'</i>':'')+'</div>');
  /* مهام الإغلاق موجودة لكنها ليست الآن: سطرٌ واحد يقول ذلك بلا أن
     تُزاحم مهمةَ اللحظة، فتعرف الموظفة أنها لم تُنسَ. */
  if(inT && !outT && !inClosing){
    var later=pend.filter(function(t){ return !dueNow(t); }).length;
    if(later) out.push('<div class="nx-later">'+later+' مهمة إغلاق تظهر قرب نهاية الشفت</div>');
  }

  /* ── الكتلة ٤: الاختصارات الأربعة ── */
  if(inT && !outT){
    out.push('<div class="nx-quick">'+
      '<button data-a="'+(openBr?'brEnd':'brStart')+'">'+IC.shift+
        '<span>'+(openBr?'إنهاء الاستراحة':'استراحة')+'</span></button>'+
      /* «سجّلي عملاً» لا «مهمة منجزة»: نصف عمل المقهى لا يُسنَد أصلاً —
         كبّة نفايات، زبونة طلبت شيئاً، عطل عولج في لحظته. القائمة كانت
         تعرض المسنَد فقط، فما تفعله الموظفة خارجه يضيع بلا أثر. */
      '<button data-a="workLog">'+IC.tasks+'<span>سجّلي عملاً</span></button>'+
      '<button data-a="helpNew">'+IC.user+'<span>مساعدة</span></button>'+
      '<button data-a="moreOpen" data-sec="requests">'+IC.shift+'<span>إجازة</span></button>'+
    '</div>');
    /* الانصراف: سطرٌ هادئ ما دام الشفت جارياً، ويصعد إلى الفعل نفسه
       في آخر نصف ساعة (انظري nowAction). */
    if(!nearEnd)
      out.push('<div class="nx-out"><button data-a="checkout">تسجيل الانصراف</button></div>');
  }

  return '<section class="today nowx">'+out.join('')+'</section>';
}
/* ===== محطة التحضير — تظهر فقط لمن لديها أصناف ضمن منطقتها ===== */
function prepRemain(exp){ var ms=new Date(exp).getTime()-Date.now(); if(ms<=0) return 'منتهية';
  var h=Math.floor(ms/3600000); if(h>=24) return 'باقٍ '+Math.floor(h/24)+' يوم'+(h%24? ' و'+(h%24)+'س':''); if(h>=1) return 'باقٍ '+h+' ساعة'; return 'باقٍ '+Math.max(1,Math.round(ms/60000))+' د'; }
/* ===== إشارات الأرضية =====
   الخادم يبني ضغط المنطقة من إشارات لها عمر ووزن، لكن لم يكن للموظفة أي
   طريقة لإرسال واحدة: كانت الإشارات تأتي من حالات الطاولات والمحرّك وحدهما.
   هذا الشريط يعطيها ضغطة واحدة لما تراه عينها ولا تراه الطاولة: دفعة وصلت
   على الباب، نقص تحضير، منطقتها تحتاج مساندة.
   لماذا لا تُحسب على أحد: الإشارة عن مكان لا عن شخص، وتنتهي بمهلتها ذاتياً. */
/* ثمانية أنواع كانت معروضة، وأربعة منها الخادم يعرفها أصلاً من حالة الطاولة:
   «بانتظار الطلب» = ordered، «بانتظار التقديم» = ready، «بانتظار الحساب» =
   bill_requested، «طاولة تحتاج ترتيب» = needs_clean. طلبُها يدوياً أنشأ
   حقيقتين للشيء نفسه، ولم يكن للإشارة رقم طاولة — فصار السؤال المحقّ:
   «طاولة تحتاج ترتيب… أي طاولة؟». الجواب أنها لا تُدخل من هنا إطلاقاً:
   تُغيَّر حالة الطاولة على الخريطة، ويستنتج الخادم الضغط منها.
   بقي ما لا تراه الطاولة ولا المحرّك — أربع إشارات عن المكان لا عن طاولة،
   فلا يحتاج أيٌّ منها رقماً. */
/* ===== طابور الباب =====
   كانت البطاقة ثماني «إشارات» مجرّدة، فبقيت غير مفهومة حتى بعد تقليصها إلى
   أربع. السبب أن ستّاً منها لها بيت آخر في النظام أصلاً، فكانت تسأل الموظفة
   أن تُدخل الحقيقة مرتين:
     • بانتظار الطلب/التقديم/الحساب وتحتاج ترتيب ← حالة الطاولة على الخريطة.
     • نقص مادة ← محطة التحضير، وهي تعرف الصنف والصلاحية.
     • أحتاج مساندة ← «نداء المساعدة» الموجود بزملاء يستجيبون وإغلاق للنداء.
     • دفعة مفاجئة ← حكم ذاتي، وطابور الباب قياسه الموضوعي.
   بقيت حقيقة واحدة لا يراها النظام من أي مصدر آخر: كم ضيفة واقفة تنتظر
   إجلاساً. فصارت البطاقة عدّاداً واحداً لها، مع أثرٍ مكتوب، ومسارٍ صريح
   لكل حقيقة أخرى إلى بيتها. حقيقة واحدة في مكان واحد. */
function loadSignalsCard(){
  var w=$('#sigWrap'); if(!w) return;
  var zone=((S.state||{}).my_zone||{}).area_id || ((S.state||{}).shift||{}).area_id || null;
  sAct('board_live', zone?{zone_id:zone}:{}).then(function(r){
    if(!r || !r.ok){ w.innerHTML=''; return; }
    var q=null; (r.live||[]).forEach(function(l){ if(l.type==='customer_arrived') q=l; });
    var n=q?(+q.count||0):0, waited=q?(+q.oldest_min||0):0;
    var hot = n>0 && waited>=5;
    w.innerHTML='<div class="card"><h3>طابور الباب</h3>'+
      '<div class="muted small" style="margin-bottom:10px">كم ضيفة تنتظر إجلاساً الآن. '+
        'هذا الرقم وحده لا يعرفه النظام من مكان آخر، ومنه يقرأ ضغط منطقتك.</div>'+
      '<div class="dq'+(hot?' hot':'')+'">'+
        '<div class="dq-n"><b>'+n+'</b><span>'+(n===1?'ضيفة تنتظر':'ضيفات تنتظرن')+'</span></div>'+
        (n>0?'<div class="dq-w'+(hot?' hot':'')+'">أطولهنّ انتظاراً '+waited+' د</div>':
             '<div class="dq-w">لا أحد ينتظر</div>')+
      '</div>'+
      '<div class="btnrow" style="margin-top:10px">'+
        '<button class="btn grow" id="dqAdd">وصلت ضيفة +</button>'+
        (n>0?'<button class="btn ghost grow" id="dqClear">أُجلسن — أخلِ الطابور</button>':'')+
      '</div>'+
      '<div class="muted small" style="margin-top:8px">الأثر: يرفع ضغط منطقتك فوراً فتُعاد ترتيب '+
        'أولويات مهامك، ويهبط وحده بعد المهلة إن لم يُخلَ.</div>'+
      '<div class="dqr"><div class="dqr-h">وأين تُسجَّل بقية الأمور؟</div>'+
        '<button class="dqr-i" data-dqr="tables"><b>طاولة تحتاج شيئاً</b><span>غيّري حالتها على خريطة الطاولات — النظام يقرأ الضغط منها</span></button>'+
        '<button class="dqr-i" data-dqr="prep"><b>نقص مادة أو شاف</b><span>محطة التحضير — تعرف الصنف والصلاحية</span></button>'+
        '<button class="dqr-i" data-dqr="help"><b>تحتاجين مساندة</b><span>نداء المساعدة — يصل زميلاتك والإدارة ويُغلق حين يُلبّى</span></button>'+
      '</div></div>';
    function send(op){
      return sAct('board_signal', {type:'customer_arrived', zone_id:zone, op:op||'add'}, true)
        .then(function(x){
          if(x && x.ok){ if(op==='close') toast('أُخلي الطابور'); loadSignalsCard(); }
          else toast((x && x.error)||'تعذّر الإرسال', true);
        });
    }
    var ab=$('#dqAdd',w);
    if(ab) ab.addEventListener('click', function(){ ab.disabled=true; send('add').catch(function(){ ab.disabled=false; }); });
    var cb=$('#dqClear',w);
    if(cb) cb.addEventListener('click', function(){ cb.disabled=true; send('close').catch(function(){ cb.disabled=false; }); });
    $$('[data-dqr]',w).forEach(function(b){ b.addEventListener('click', function(){
      var k=b.getAttribute('data-dqr');
      if(k==='tables'){ S.tab='floor'; paintTabs(); drawTab(); }
      else if(k==='prep'){ var p2=$('#prepWrap'); if(p2) p2.scrollIntoView({block:'center'});
        else toast('محطة التحضير غير مفعّلة لشفتك', true); }
      else { sAct('help_request',{},true).then(function(res){
        if(res && res.ok){ toast('أُرسل النداء لزميلاتك والإدارة'); refresh(); }
        else toast((res&&res.error)||'خطأ', true); }); }
    });});
  }).catch(function(){ w.innerHTML=''; });
}

function loadTablesCard(){
  var w = $('#tblWrap'); if(!w) return;
  /* كانت هنا شبكة بلاطات «طاولاتي اليوم» وقائمة أزرار المناطق — وهي التي
     أنتجت التشويش في منتصف «الآن»، وبلاطاتٍ بلون واحد لأن الحالة كانت
     «متاحة» في كلّها. الأرضية صارت صفحةً مستقلّة، فما يبقى هنا سطرٌ واحد
     يقول ما يحتاج حركةً الآن ويأخذها إلى هناك. */
  Promise.all([sAct('tbl_areas', {}), sAct('tbl_my_duty', {})]).then(function(rr){
    if(!$('#tblWrap')) return;
    var r = rr[0] || {}, duty = ((rr[1] || {}).tables) || [];
    var areas = ((r && r.areas) || []).filter(function(a){ return a.allowed; });
    if(!areas.length){ w.innerHTML = ''; return; }
    var busy = areas.reduce(function(s,a){ return s + (+a.busy||0); }, 0);
    var tot  = areas.reduce(function(s,a){ return s + (+a.total||0); }, 0);
    var need = duty.filter(function(t){ return ST_ACT.indexOf(t.state) >= 0; }).length;
    w.innerHTML = '<div class="card"><h3>الصالة الآن</h3>'+
      '<div class="muted small" style="margin-bottom:9px">'+
        busy+' مشغولة من '+tot+' طاولة'+
        (duty.length ? ' · مُسندة إليكِ '+duty.length : '')+
        (need ? ' · '+need+' منها تحتاج حركة' : '')+'</div>'+
      '<button class="btn block" data-a="goFloor">فتح صفحة الصالة</button></div>';
  }).catch(function(){});
}
/* ═══════════════════ صفحة الصالة ═══════════════════
   ثلاث شكاوى مُبلَّغة كانت كلّها من مصدرٍ واحد: الأرضية لم تكن صفحة.
   ١) «الطاولات تظهر بمنتصف الشاشة بتشويش» — كانت بطاقةً بين بطاقات «الآن».
   ٢) «لونهم بدون ضغط رمادي، تتغيّر الحالة بعد أن نضغط» — البلاطة كانت
      تُصبغ بلون الإلحاح، و«متاحة» إلحاحها صفر فلونها رمادي محيَّد. وأكثر
      طاولات الموظفة متاحة، فرأت صفّاً رمادياً لا يقول شيئاً.
   ٣) «الطاولات يجب أن تظهر لأي موظفة بالصالة» — كانت الرؤية محكومةً بنفس
      بوابة التعديل، فمن ليست منطقتها لا ترى الأرضية أصلاً.

   الآن: صفحة كاملة، واللون يقول الحالة لا الإلحاح، والإلحاح حلقةٌ حول
   البلاطة. والرؤية للجميع، والتعديل بحسب النطاق الذي يعلنه الخادم. */
var FLR = {area:null, areas:null, data:null, sel:null, f:'all', timer:null, tick:null,
           busy:false, skew:0, synced:0, at:0, mvFrom:null};

/* لون الحالة رمزُ CSS لا سُدسي ثابت، فينقلب مع السمة تلقائياً */
var STC = {
  free:'--st-free', reserved:'--st-reserved', seated:'--st-seated', ordered:'--st-ordered',
  preparing:'--st-preparing', ready:'--st-ready', served:'--st-served',
  bill_requested:'--st-bill-requested', needs_clean:'--st-needs-clean',
  cleaning:'--st-cleaning', out_of_service:'--st-out-of-service'
};
function stCol(k){ return 'var('+(STC[k]||STC.free)+')'; }
function stOn(k){ return 'var('+(STC[k]||STC.free)+'-on)'; }
/* الحالات التي تطلب فعلاً الآن — تُعدّ في العدّادات وتُرتَّب أولاً */
var ST_ACT = ['seated','ready','bill_requested','needs_clean'];

function viewFloor(){ return '<div id="flrHost">'+skel(3)+'</div>'; }

/* ═══ الوضع الأفقي ═══
   الصالة أعرض من طولها، والهاتف بالطول يحشر الخريطة في عمود ضيّق —
   ولهذا تراكبت البلاطات. عند فتح الصفحة نطلب ملء الشاشة ثم قفل الاتجاه
   أفقياً؛ وحين يرفض النظام (iOS لا يدعم القفل) نبقى بالطول ويتكفّل
   حساب الحجم أدناه بمنع أي تراكب. لا نفرض شيئاً لا يستطيعه الجهاز. */
/* ملء الشاشة وقفل الاتجاه: بطلبٍ صريح لا تلقائياً.
   كان يُفرض بمجرّد فتح «الصالة»، فتنقلب شاشة الهاتف عرضاً ويختفي شريط
   المتصفّح — فلا يبقى للموظفة مخرج ظاهر. وهو على الطرفيّة اللوحية بلا
   معنى أصلاً: هي عريضة بحكم وضعها على الحامل. صار زرّاً واحداً يُعرف
   حاله من شكله، ويعمل في الاتجاهين. */
function flrFull(){ return !!(document.fullscreenElement||document.webkitFullscreenElement); }

function flrLandscape(on){
  try{
    if(on){
      var el=document.documentElement;
      var rq=el.requestFullscreen||el.webkitRequestFullscreen;
      if(rq && !flrFull()){
        var p=rq.call(el);
        if(p&&p.catch) p.catch(function(){});
      }
      /* القفل يُطلب بعد ملء الشاشة لا قبله، ويُتجاهل فشله بصمت:
         المتصفّحات على سطح المكتب ترفضه، وهذا ليس خطأ. */
      if(screen.orientation && screen.orientation.lock){
        var q=screen.orientation.lock('landscape');
        if(q&&q.catch) q.catch(function(){});
      }
    } else {
      if(screen.orientation && screen.orientation.unlock)
        try{ screen.orientation.unlock(); }catch(e){}
      if(flrFull() && document.exitFullscreen){
        var x=document.exitFullscreen();
        if(x&&x.catch) x.catch(function(){});
      }
    }
  }catch(e){}
}

/* خروج الطوارئ: زرّ «رجوع» في الشريط قد لا تصله الموظفة إن علق شيء،
   فنجعل مفتاح الرجوع في النظام يُخرج من الوضع الكامل أيضاً. */
document.addEventListener('fullscreenchange', function(){
  var b=$('#flrFs'); if(!b) return;
  b.setAttribute('aria-pressed', flrFull()?'true':'false');
  b.setAttribute('aria-label', flrFull()?'خروج من ملء الشاشة':'ملء الشاشة');
});

/* حجم البلاطة يُشتقّ من أقرب طاولتين، فلا يمكن أن تتراكبا رياضياً.
   مربّعان متمركزان على نقطتين لا يتقاطعان إلا إذا كان الفارق الأكبر في
   أحد المحورين (مسافة تشيبيشيف) أصغر من ضلعهما — فنجعل الضلع أصغر منها. */
/* أيّ طاولتين هما المتلاصقتان؟ نقولها بالاسم كي تُصلَح من تخطيط الطاولات */

function loadFloor(){
  var w=$('#flrHost'); if(!w) return;
  /* لا ملء شاشة تلقائي — انظري flrLandscape */
  sAct('tbl_areas',{}).then(function(r){
    if(!$('#flrHost')) return;
    var areas=((r&&r.areas)||[]).filter(function(a){ return a.allowed; });
    FLR.areas=areas;
    if(!areas.length){
      w.innerHTML='<div class="empty">لا توجد مناطق جلوس مفتوحة الآن.<br>'+
        'تظهر الأرضية بعد تسجيل حضورك وفتح المنطقة للخدمة.</div>';
      return;
    }
    if(!FLR.area || !areas.some(function(a){ return +a.id===+FLR.area; })) FLR.area=+areas[0].id;
    flrBoard(false);
    clearInterval(FLR.timer); clearInterval(FLR.tick);
    /* «منذ كم» على البلاطات كانت لا تتحرّك: updateTimers لا يمسّ إلا ‎.timer‎،
       ومحرّك ‎.tdur‎ الوحيد كان داخل ورقة الطاولة. صارت تُحدَّث هنا كل ٣٠ ثانية
       من لحظة رسمها هي، فلا تنتظر استطلاع العشرين ثانية ولا تقفز معه. */
    FLR.tick=setInterval(function(){
      if(!$('#flrHost')){ clearInterval(FLR.tick); return; }
      updateTimers(); tmTick();
    },30000);
    FLR.timer=setInterval(function(){
      if(!$('#flrHost')){ clearInterval(FLR.timer); return; }
      flrBoard(true);
    },20000);
    rtConnect();
    rtOn('table_state', function(row){
      if(+row.area_id!==+FLR.area) return;
      if(!$('#flrHost')) return;
      clearTimeout(FLR.rt);
      FLR.rt=setTimeout(function(){ flrBoard(true); },400);
    });
    /* لا مستمع لتغيير المقاس: flrPaint لا يقرأ بُعداً واحداً — الأعمدة
       وحجم البلاطة من شبكة CSS واستعلامات الوسائط. كان هذا المستمع بقيّةً
       من المخطّط بالإحداثيات الذي حُذف، وكان يُعيد بناء الشبكة كاملة
       (innerHTML وإعادة ربط كل زرّ) عند كل حدث. ودوران الشاشة يُطلق
       عشرات الأحداث في أقل من ثانية، فتتراكم إعادات البناء ويبدو الجهاز
       معلّقاً. الإزالة تُصلح التعليق ولا تُفقد شيئاً. */
  }).catch(function(){
    if($('#flrHost')) $('#flrHost').innerHTML='<div class="empty">تعذّر الاتصال — سيُعاد المحاولة</div>';
  });
}

function flrBoard(quiet){
  var w=$('#flrHost'); if(!w) return;
  if(!quiet) w.innerHTML=skel(3);
  sAct('tbl_board',{area_id:FLR.area}).then(function(res){
    if(!$('#flrHost')) return;
    if(!res||!res.ok){
      $('#flrHost').innerHTML='<div class="empty">'+esc((res&&res.error)||'تعذّر تحميل الأرضية')+'</div>';
      return;
    }
    if(res.server_now) FLR.skew=Date.now()-new Date(res.server_now).getTime();
    FLR.synced=Date.now()-FLR.skew;
    /* لحظة الجلب بساعة الجهاز: مرجع «منذ كم» على البلاطات. الرسم قد يتكرّر
       بين استطلاعين (فلتر أو اختيار طاولة)، فلو أرّخنا من لحظة الرسم لعاد
       العدّاد إلى الوراء عند كل لمسة. */
    FLR.at=Date.now();
    FLR.data=res;
    flrPaint();
  }).catch(function(){
    if(!FLR.data && $('#flrHost')) $('#flrHost').innerHTML='<div class="empty">تعذّر الاتصال</div>';
  });
}

/* مرجع العدّ: لحظة آخر جلب، ويسقط إلى «الآن» قبل أول جلب فقط */
function flrAt(){ return FLR.at || Date.now(); }

function flrCan(t){
  var d=FLR.data||{}, sc=d.scope||'full';
  if(!d.can_edit) return false;
  if(t.oos) return false;
  if(sc==='view') return false;
  if(sc==='duty_tables') return (d.duty_tables||[]).map(Number).indexOf(+t.id)>=0;
  return true;
}
function flrMine(t){
  var d=FLR.data||{};
  return (d.duty_tables||[]).map(Number).indexOf(+t.id)>=0;
}

/* يُقاس بعد الرسم: عرض اللوح الفعلي ثم ضلع البلاطة المشتقّ منه.
   إن نزل الضلع تحت حدّ اللمس (٤٤px) فالمخطّط نفسه مزدحم — ننتقل إلى
   الشبكة ونقولها صراحةً بدل أن نعرض بلاطات متراكبة. */

/* ═══════ شبكة الطاولات — معيار طرفيّات الخدمة ═══════
   لماذا شبكة موحّدة لا مخطّط بالإحداثيات؟ لأن هذا ما تفعله كل الطرفيّات
   المهنية (Toast · Square · Lightspeed · TouchBistro)، ولسببٍ تشغيلي لا
   ذوقي: الموظفة تحفظ موضع الطاولة في الشبكة خلال يومين، والترتيب ثابت لا
   يتغيّر إن حُرّكت طاولة في الصالة. والمخطّط المرسوم يخدم سؤال المالكة
   («أين يزدحم المكان») لا سؤال الموظفة («أي طاولة تنتظرني الآن») — ولذلك
   بقي في لوحة الإدارة وخرج من شاشة الخدمة.

   الترتيب برقم الطاولة دائماً — لا يُعاد الترتيب بالإلحاح، فإعادة الترتيب
   تُبطل ذاكرة اليد وتجعل الضغط الخطأ أسهل. الإلحاح يُقرأ من اللون والحلقة،
   والعزل يتمّ بمرشّح لا بحركة. */
function flrPaint(){
  var w=$('#flrHost'); if(!w||!FLR.data) return;
  var res=FLR.data, all=res.tables||[], ar=res.area||{};
  var sel=null; all.forEach(function(x){ if(+x.id===+FLR.sel) sel=x; });

  var needN=all.filter(function(x){ return !x.oos && ST_ACT.indexOf(x.state)>=0; }).length;
  var mineN=all.filter(flrMine).length;
  var freeN=all.filter(function(x){ return !x.oos && x.state==='free'; }).length;
  var busyN=all.filter(function(x){ return !x.oos && x.state!=='free'; }).length;

  var view=all.filter(function(x){
    if(FLR.f==='need') return !x.oos && ST_ACT.indexOf(x.state)>=0;
    if(FLR.f==='mine') return flrMine(x);
    if(FLR.f==='free') return !x.oos && x.state==='free';
    return true;
  }).sort(function(a,b){ return (+a.no)-(+b.no); });

  var h='<div class="flrx'+(sel?' has-sel':'')+'">';

  /* الشريط: خروج · المناطق · مرشّحات · نبض */
  h+='<header class="flrx-bar">'+
    '<button class="flrx-x" id="flrExit" aria-label="رجوع">‹</button>'+
    (FLR.areas&&FLR.areas.length>1
      ? '<div class="flrx-seg">'+FLR.areas.map(function(a){
          return '<button data-fa="'+(+a.id)+'"'+(+a.id===+FLR.area?' class="on"':'')+'>'+
            esc(a.name.replace('الصالة ','').replace('الساحة ',''))+'</button>';
        }).join('')+'</div>'
      : '<div class="flrx-ttl"><b>'+esc(ar.name||'الصالة')+'</b></div>')+
    '<div class="flrx-f">'+
      [['all','الكل',all.length],['need','تحتاج حركة',needN],
       ['mine','طاولاتي',mineN],['free','متاحة',freeN]]
      .filter(function(f){ return f[0]==='all' || f[2]>0; })
      .map(function(f){
        return '<button data-ff="'+f[0]+'"'+((FLR.f||'all')===f[0]?' class="on"':'')+'>'+
          f[1]+'<i>'+f[2]+'</i></button>';
      }).join('')+
    '</div>'+
    '<div class="flrx-live"><span class="flrx-dot"></span>'+busyN+'/'+all.length+'</div>'+
    '<button class="flrx-fs" id="flrFs" aria-pressed="false" aria-label="ملء الشاشة">'+
      '<span class="fs-in"></span><span class="fs-out"></span></button>'+
  '</header>';

  h+='<main class="flrx-grid-wrap">'+
     (view.length
       ? '<div class="flrx-grid">'+view.map(flrCardTile).join('')+'</div>'
       : '<div class="empty">لا طاولة في هذا المرشّح</div>')+
     '</main>';

  h+='<aside class="flrx-side">'+(sel?flrSelPanel(sel, ar):flrSideEmpty())+'</aside>';
  h+='</div>';

  w.innerHTML=h;

  var ex=$('#flrExit',w);
  if(ex) ex.addEventListener('click', function(){
    flrLandscape(false); S.tab='now'; paintTabs(); drawTab(); });
  var fs=$('#flrFs',w);
  if(fs){
    fs.setAttribute('aria-pressed', flrFull()?'true':'false');
    fs.setAttribute('aria-label', flrFull()?'خروج من ملء الشاشة':'ملء الشاشة');
    fs.addEventListener('click', function(){ flrLandscape(!flrFull()); });
  }
  $$('[data-fa]',w).forEach(function(b){ b.addEventListener('click', function(){
    FLR.area=+b.getAttribute('data-fa'); FLR.sel=null; flrBoard(false); }); });
  $$('[data-ff]',w).forEach(function(b){ b.addEventListener('click', function(){
    FLR.f=b.getAttribute('data-ff'); flrPaint(); }); });
  $$('[data-ft]',w).forEach(function(b){ b.addEventListener('click', function(){
    var id=+b.getAttribute('data-ft');
    /* نقلٌ معلّق بعد تبديل المنطقة: أول لمسة على طاولة متاحة تُتمّه */
    if(FLR.mvFrom){
      var tb=null; ((FLR.data&&FLR.data.tables)||[]).forEach(function(x){ if(+x.id===id) tb=x; });
      if(tb && tb.state==='free' && !tb.oos){ flrMoveGo(FLR.mvFrom.id, id, FLR.mvFrom.ver); return; }
      toast('اختاري طاولة متاحة', true); return;
    }
    FLR.sel=(FLR.sel===id)?null:id; flrPaint(); }); });
  $$('[data-fcoal]',w).forEach(function(b){ b.addEventListener('click', function(){
    sAct('tbl_coal',{table_id:+b.getAttribute('data-fcoal')}, true).then(function(r){
      if(r&&r.ok){ toast('سُجّل تغيير الفحم'); flrBoard(true); }
      else toast((r&&r.error)||'تعذّر التسجيل', true); }); }); });
  $$('[data-fhk]',w).forEach(function(b){ b.addEventListener('click', function(){
    sAct('tbl_hookah',{table_id:+b.getAttribute('data-fid'),
                       on:b.getAttribute('data-fhk')==='on'}, true).then(function(r){
      if(r&&r.ok) flrBoard(true); else toast((r&&r.error)||'تعذّر التسجيل', true); }); }); });
  $$('[data-fmv]',w).forEach(function(b){ b.addEventListener('click', function(){
    flrMoveSheet(+b.getAttribute('data-fmv'), +b.getAttribute('data-fv2')); }); });
  var xb=$('#flrX',w); if(xb) xb.addEventListener('click', function(){ FLR.sel=null; flrPaint(); });
  $$('[data-fgo]',w).forEach(function(b){ b.addEventListener('click', function(){
    flrSet(+b.getAttribute('data-fid'), b.getAttribute('data-fgo'), +b.getAttribute('data-fv2'), b); }); });
  var dt=$('#flrDetail',w);
  if(dt) dt.addEventListener('click', function(){ TM.admin=false; tmDetail(+dt.getAttribute('data-fid')); });
  updateTimers(); tmTick();
}

function flrSideEmpty(){
  return '<div class="flrx-side-e">'+TIC.grid+'<b>اختاري طاولة</b>'+
    '<span>تظهر حالتها وأزرار تحديثها هنا</span></div>';
}

/* بطاقة الطاولة: رقمٌ يُقرأ من مترين، حالةٌ مكتوبة، ووقتٌ منذ آخر تغيير.
   الضيفات والمسؤولة في السطر السفلي — معلومة ثانوية لا تُزاحم الرقم. */
function flrCardTile(x){
  var k=tmState(x), st=TMS[k]||TMS.free, u=tmUrg(x);
  var busy=(k!=='free' && !x.oos);
  var cls='flrc'+(x.oos?' oos':'')+(u>=3?' late':(u>0?' soon':''))+
          (flrMine(x)?' mine':'')+(+FLR.sel===+x.id?' sel':'');
  var foot='';
  if(busy && x.guests) foot+='<span class="g">'+(+x.guests)+'</span>';
  if(x.owner) foot+='<span class="o">'+esc(tmInitials(x.owner))+'</span>';
  return '<button class="'+cls+'" data-ft="'+x.id+'" '+
    'style="--tc:'+stCol(k)+';--tc-on:'+stOn(k)+'" '+
    'aria-label="طاولة '+(+x.no)+' — '+esc(st.ar)+
      (busy&&x.mins?' — منذ '+esc(tmDur(x.mins)):'')+
      (flrMine(x)?' — من طاولاتك':'')+(u>=3?' — تجاوزت وقتها':'')+'">'+
    '<span class="flrc-no">'+(+x.no)+'</span>'+
    '<span class="flrc-st">'+esc(st.ar)+'</span>'+
    '<span class="flrc-f">'+
      (busy&&x.mins>0?'<span class="t tdur" data-mins="'+(+x.mins)+'" data-at="'+flrAt()+'">'+
        tmDur(x.mins)+'</span>':'<span class="t"></span>')+
      foot+'</span>'+
  '</button>';
}

function flrSelPanel(t, ar){
  var k=tmState(t), st=TMS[k]||TMS.free, can=flrCan(t);
  var d=FLR.data||{}, sc=d.scope||'full';
  var h='<div class="flr-sel" style="--tc:'+stCol(k)+';--tc-on:'+stOn(k)+'">'+
    '<div class="flr-sel-h"><span class="flr-sel-n">'+(+t.no)+'</span>'+
    '<span class="flr-sel-t"><b>طاولة '+(+t.no)+'</b><span>'+esc(st.ar)+
      ((k!=='free'&&!t.oos&&t.mins)?' · <b class="tdur" data-mins="'+(+t.mins)+
        '" data-at="'+flrAt()+'">'+esc(tmDur(t.mins))+'</b>':'')+
      (t.guests?' · '+(+t.guests)+' ضيفات':'')+(t.owner?' · '+esc(t.owner):'')+'</span></span>'+
    '<button class="flr-sel-i" id="flrDetail" data-fid="'+t.id+'" aria-label="سجلّ الطاولة">'+TIC.list+'</button>'+
    '<button class="flr-sel-x" id="flrX" aria-label="إغلاق">×</button></div>';

  if(t.oos){
    h+='<p class="flr-why">موقوفة عن الخدمة'+(t.oos_reason?' — '+esc(t.oos_reason):'')+'</p>';
  } else if(!can){
    h+='<p class="flr-why">'+
      (sc==='duty_tables' ? 'ليست من طاولاتك — نادي المسؤولة عنها'
       : (sc==='view' ? 'للعرض فقط — التحديث لمن أُسندت إليها المنطقة'
          : 'المنطقة غير مفتوحة للخدمة بعد'))+'</p>';
  } else {
    var next=(t.next||[]).filter(function(s){ return s!==k; });
    var head=next.slice(0,3), rest=next.slice(3);
    var btn=function(s, i){
      var a2=TMACT[s]||{t:(TMS[s]||{}).ar||s,s:''};
      return '<button class="btn'+(i===0?' st':' ghost')+'" data-fgo="'+s+'" data-fid="'+t.id+'" '+
        'data-fv2="'+(+t.version)+'" style="--ac:'+stCol(s)+';--ac-on:'+stOn(s)+'">'+
        esc(a2.t)+'</button>';
    };
    h+='<div class="flr-acts">'+head.map(btn).join('')+'</div>';

    /* الأرجيلة: أهمّ فعل مؤقَّت في مقهى أراجيل. حين يكون الفحم مستحقّاً
       يصعد زرّه فوق كل شيء — لأن تأخّره أسرع ما يُفسد جلسة. */
    if(FLR_LIVE[k]){
      if(t.hookah){
        h+='<div class="flr-hk'+(t.coal_due?' due':'')+'">'+
          '<span class="hk-t">الفحم منذ <b class="tdur" data-mins="'+(+t.coal_mins||0)+
            '" data-at="'+flrAt()+'">'+esc(tmDur(t.coal_mins||0))+'</b></span>'+
          '<button class="btn'+(t.coal_due?' st':' ghost')+'" data-fcoal="'+t.id+'">غُيّر الفحم</button>'+
          '<button class="btn ghost sm" data-fhk="off" data-fid="'+t.id+'">لا أرجيلة</button>'+
        '</div>';
      } else {
        h+='<div class="flr-hk"><button class="btn ghost block" data-fhk="on" data-fid="'+t.id+'">'+
          'نزّلت أرجيلة</button></div>';
      }
    }

    if(rest.length) h+='<details class="flr-more"><summary>حالات أخرى ('+rest.length+')</summary>'+
      '<div class="flr-acts">'+rest.map(function(s){ return btn(s,9); }).join('')+'</div></details>';

    /* النقل: الضيفات ينتقلن في منتصف الجلسة، وكان البديل إنهاء الطاولة
       وفتح غيرها — فيضيع وقتهن وأرجيلتهن ويُقطع سجلّ الجلسة نصفين. */
    if(FLR_LIVE[k])
      h+='<button class="flr-mv" data-fmv="'+t.id+'" data-fv2="'+(+t.version)+'">'+
         'نقل الضيفات إلى طاولة أخرى</button>';
  }
  return h+'</div>';
}

/* ورقة النقل: الطاولات المتاحة في كل المناطق المفتوحة — الانتقال من
   الداخل إلى الساحة يحدث كل مساء، فحصرُ الخيارات في المنطقة الحالية
   يجعل الميزة عديمة الفائدة في أكثر حالاتها شيوعاً. */
function flrMoveSheet(fromId, ver){
  var d=FLR.data||{};
  var here=((d.tables)||[]).filter(function(x){
    return x.state==='free' && !x.oos && +x.id!==+fromId; });
  sAct('tbl_areas',{}).then(function(r){
    var areas=((r&&r.areas)||[]).filter(function(a){
      return a.allowed && a.open && +a.id!==+FLR.area; });
    var body='<div class="muted small" style="margin-bottom:8px">'+
      'تنتقل الجلسة كما هي: وقتهن وعددهن وأرجيلتهن. والطاولة الحالية تصير «تحتاج تنظيف».</div>';
    body += here.length
      ? '<label class="f">في '+esc((d.area&&d.area.name)||'المنطقة')+'</label><div class="mv-g">'+
        here.map(function(x){ return '<button class="mv-b" data-mv="'+x.id+'">'+(+x.no)+'</button>'; }).join('')+'</div>'
      : '<div class="muted small">لا طاولة متاحة في هذه المنطقة.</div>';
    if(areas.length)
      body += '<label class="f" style="margin-top:10px">منطقة أخرى</label><div class="navlist">'+
        areas.map(function(a){
          return '<button data-mva="'+a.id+'"><span>'+esc(a.name)+'</span>'+
                 '<span class="chev">‹</span></button>'; }).join('')+'</div>';
    sheet('نقل الضيفات', body, function(ov, close){
      $$('[data-mv]',ov).forEach(function(b){ b.addEventListener('click', function(){
        close(); flrMoveGo(fromId, +b.getAttribute('data-mv'), ver); }); });
      /* منطقة أخرى: نُبدّل إليها أولاً ثم تختار الطاولة من الشبكة نفسها */
      $$('[data-mva]',ov).forEach(function(b){ b.addEventListener('click', function(){
        close();
        FLR.mvFrom={id:fromId, ver:ver};
        FLR.area=+b.getAttribute('data-mva'); FLR.sel=null; flrBoard(false);
        toast('اختاري الطاولة المتاحة هنا');
      }); });
    });
  }).catch(function(){ toast('تعذّر الاتصال', true); });
}

function flrMoveGo(fromId, toId, ver){
  sAct('tbl_move',{from_id:fromId, to_id:toId, version:ver}, true).then(function(r){
    if(r&&r.ok){ FLR.mvFrom=null; FLR.sel=toId; toast('انتقلت الجلسة'); flrBoard(true); }
    else toast((r&&r.error)||'تعذّر النقل', true);
  });
}

/* الحالات التي فيها جلسةٌ حيّة: ضيفاتٌ على الطاولة ومدّةٌ تعدّ ومسؤولةٌ لها */
var FLR_LIVE = {seated:1, ordered:1, preparing:1, ready:1, served:1, bill_requested:1};

/* لمسةٌ خاطئة على شبكةٍ من سبعٍ وعشرين بلاطة واردة. أكثر التحوّلات ضرراً
   هو إنهاء الجلسة — «غادرن» أو «عادت متاحة» على طاولةٍ ما زالت مشغولة:
   يُمحى عدد الضيفات والمدّة والمسؤولة، ولا تُعيدها ضغطةٌ عكسية لأن الجلسة
   نفسها أُغلقت. تُمنح هذه وحدها ثماني ثوانٍ للتراجع قبل الإرسال.
   وما عداها يُرسل فوراً: التحوّلات الأمامية رخيصةُ التصحيح، وتأخيرها على
   لوحةٍ يشترك فيها الجميع ضررٌ لا حماية. */
function flrSet(id, to, ver, btn){
  if(FLR.busy) return;
  var tbl=null;
  ((FLR.data&&FLR.data.tables)||[]).forEach(function(x){ if(+x.id===+id) tbl=x; });
  if(tbl && FLR_LIVE[tmState(tbl)] && (to==='needs_clean' || to==='free')){
    if(btn) btn.disabled=true;
    undoWindow('طاولة '+(+tbl.no)+' — '+((TMACT[to]||{}).t||'')+'؛ ستُغلق الجلسة', 8,
      function(){ if(btn) btn.disabled=false; flrSend(id, to, ver, btn); },
      function(){ if(btn) btn.disabled=false; toast('أُلغي — لم يتغيّر شيء'); });
    return;
  }
  flrSend(id, to, ver, btn);
}

function flrSend(id, to, ver, btn){
  if(FLR.busy) return;
  FLR.busy=true; if(btn) btn.disabled=true;
  sAct('tbl_set',{table_id:id, to:to, version:ver, client_event_id:uid()}).then(function(r){
    FLR.busy=false;
    if(r&&r.ok){
      toast((TMACT[to]||{}).t||'حُدّثت الطاولة');
      flrBoard(true);
    } else {
      if(btn) btn.disabled=false;
      toast((r&&r.error)||'تعذّر التحديث', true);
      if(r&&r.code==='conflict') flrBoard(true);
    }
  }).catch(function(){
    FLR.busy=false; if(btn) btn.disabled=false;
    toast('تعذّر الاتصال — لم يُحدَّث شيء', true);
  });
}

function loadPrepCard(){
  var w=$('#prepWrap'); if(!w) return;
  sAct('prep_list',{}).then(function(r){
    var items=(r&&r.items)||[];
    if(!items.length){ w.innerHTML=''; return; }
    var html='<div class="card"><h3>محطة التحضير</h3><div class="muted small" style="margin-bottom:6px">الشافات المحضّرة وصلاحيتها — اكتبي رقم الشاف على لاصق العبوة.</div>';
    items.forEach(function(it){
      html+='<div style="padding:7px 0;border-bottom:1px dashed var(--line)"><div class="row" style="justify-content:space-between"><b>'+esc(it.name)+'</b><button class="btn sm ghost" data-prepadd="'+it.id+'" data-nm="'+esc(it.name)+'">+ شاف</button></div>';
      if((it.batches||[]).length){
        html+='<div class="row" style="margin-top:5px">'+it.batches.map(function(b){
          var cls=b.state==='expired'?'red':(b.state==='near'?'orange':'green');
          return '<button class="chip '+cls+'" data-prepb="'+b.id+'" data-item="'+esc(it.name)+'" style="border:none;cursor:pointer">ش-'+b.id+' · '+prepRemain(b.expires_at)+(b.cosigned?' ✓✓':'')+'</button>';
        }).join('')+'</div>';
      } else html+='<div class="muted small" style="margin-top:3px">لا شافات — يلزم تحضير</div>';
      html+='</div>';
    });
    html+='</div>';
    w.innerHTML=html;
    $$('[data-prepadd]',w).forEach(function(bt){ bt.addEventListener('click', function(){
      var iid=+bt.getAttribute('data-prepadd'), nm=bt.getAttribute('data-nm');
      sheet('شاف جديد: '+nm,
        '<label class="f">الكمية (اختياري)</label><input class="f" id="ppQty" type="number" step="0.5" placeholder="مثال: 2">'+
        '<div class="btnrow"><button class="btn block" id="ppGo">سجّلي الشاف</button></div>',
        function(ov, close){
          $('#ppGo',ov).addEventListener('click', function(){
            busyWrap(this, function(){ return sAct('prep_add',{item_id:iid, qty:$('#ppQty',ov).value||null}, true).then(function(r2){
              if(!r2.ok){ toast(r2.error||'خطأ',true); return; }
              close();
              sheet('اكتبي على اللاصق','<div class="center" style="padding:8px 0"><div style="font-size:44px;font-weight:800;color:var(--amber)">'+esc(r2.code)+'</div><div class="muted small" style="margin-top:6px">اكتبي هذا الرمز وتاريخ اليوم على لاصق العبوة</div></div>');
              loadPrepCard();
            }); });
          });
        });
    }); });
    $$('[data-prepb]',w).forEach(function(bt){ bt.addEventListener('click', function(){
      var bid=+bt.getAttribute('data-prepb'), inm=bt.getAttribute('data-item');
      var binfo=null; items.forEach(function(it){ (it.batches||[]).forEach(function(b){ if(b.id===bid) binfo=b; }); });
      if(!binfo) return;
      var stTxt=binfo.state==='expired'?'<span class="chip red">منتهية — لا تُستخدم</span>':(binfo.state==='near'?'<span class="chip orange">تقارب الانتهاء</span>':'<span class="chip green">طازجة</span>');
      sheet('شاف ش-'+bid+' · '+esc(inm),
        '<div class="row" style="justify-content:space-between"><span>الحالة</span>'+stTxt+'</div>'+
        '<div class="row" style="justify-content:space-between;margin-top:6px"><span class="muted">حضّرتها</span><b>'+esc(binfo.by)+'</b></div>'+
        '<div class="row" style="justify-content:space-between;margin-top:4px"><span class="muted">تنتهي</span><b>'+fmtD(binfo.expires_at)+' '+fmtT(binfo.expires_at)+'</b></div>'+
        (!binfo.mine && !binfo.cosigned ? '<div class="card soft" style="margin-top:10px;padding:9px 12px"><div class="small">تأكدتِ أنها مغطاة وموسومة وطازجة؟ وقّعي توقيع الجودة الثاني — يُحسب لكما معاً.</div><div class="btnrow"><button class="btn sm" id="ppCo">توقيع الجودة ✓✓</button></div></div>' : '')+
        '<div class="btnrow" style="margin-top:10px"><button class="btn sm ghost" id="ppFin">خلصت (استُهلكت)</button><button class="btn sm ghost red" id="ppDis">إتلاف</button></div>',
        function(ov, close){
          var co=$('#ppCo',ov); if(co) co.addEventListener('click', function(){ busyWrap(this, function(){ return sAct('prep_cosign',{id:bid},true).then(function(r3){ toast(r3.msg||'تم'); close(); loadPrepCard(); }); }); });
          $('#ppFin',ov).addEventListener('click', function(){ busyWrap(this, function(){ return sAct('prep_close',{id:bid,outcome:'finished'},true).then(function(){ close(); loadPrepCard(); }); }); });
          $('#ppDis',ov).addEventListener('click', function(){
            inputSheet('إتلاف الشاف','سبب الإتلاف','مثال: انتهت الصلاحية','تأكيد الإتلاف',function(why){
              sAct('prep_close',{id:bid,outcome:'discarded',note:why||''},true).then(function(){ toast('سُجّل في سجل الهدر'); close(); loadPrepCard(); });
            }, true);
          });
        });
    }); });
  }).catch(function(){});
}

/* ===== مشرف الشفت الرقمي — جاهزية الافتتاح، سلامة الحرارة، توثيق الإغلاق ===== */
function opsChecklistHtml(title, icon, items, closing){
  var crit=items.filter(function(i){return i.critical;});
  var critOk=crit.filter(function(i){return i.status==='ok';}).length;
  var done=crit.length && critOk===crit.length;
  var anyFail=items.some(function(i){return i.status==='fail';});
  var h='<div class="card ops"><div class="ops-h">'+icon+'<span>'+title+'</span>'+
    (done?'<span class="chip green">'+(closing?'مكتمل ✔':'جاهز ✔')+'</span>':'<span class="chip '+(anyFail?'red':'orange')+'">'+critOk+'/'+crit.length+'</span>')+'</div>';
  if(done){
    h+='<div class="ops-ok">'+(closing?'تم توثيق إغلاق المنطقة باسمكِ ✔':'المنطقة جاهزة لاستقبال الضيفات ✔')+'</div>';
    if(anyFail) h+='<div class="muted small" style="margin-top:4px">بند غير مطابق رُفع للإدارة.</div>';
  } else {
    h+='<div class="muted small" style="margin:2px 0 7px">'+(closing?'قبل انصرافكِ أكّدي إغلاق منطقتكِ — يُوثّق باسمكِ للشفت التالي والإدارة.':'قبل الافتتاح أكّدي كل بند. أي بند غير مطابق يُرفع للإدارة فوراً كبلاغ.')+'</div>';
    items.forEach(function(it){
      h+='<div class="ops-item"><div class="ops-lbl">'+esc(it.label)+(it.critical?'':' <span class="muted small">(غير حرج)</span>')+
          (it.status==='fail'?' <span class="chip red">غير مطابق</span>':'')+'</div>'+
        '<div class="ops-btns">'+
          '<button class="ops-y'+(it.status==='ok'?' on':'')+'" data-rdy="'+it.id+'" data-s="ok" aria-label="مطابق">✓</button>'+
          '<button class="ops-n'+(it.status==='fail'?' on':'')+'" data-rdy="'+it.id+'" data-s="fail" aria-label="غير مطابق">✗</button>'+
        '</div></div>';
    });
  }
  return h+'</div>';
}
function loadOpsCard(){
  var w=$('#opsWrap'); if(!w) return;
  sAct('ops_now',{}).then(function(r){
    if(!r || !r.ready){ w.innerHTML=''; return; }
    var now=new Date(r.now).getTime(), endT=new Date(r.end).getTime();
    var open=r.opening||[], close=r.closing||[], temps=r.temps||[], html='';
    /* ===== لمن تظهر قوائم الجاهزية =====
       كانت جاهزية الافتتاح تظهر لكل موظفة بلا أي شرط، وجاهزية الإغلاق لكل
       من قاربت نهاية شفتها هي — فموظفة شفتها المسائي ترى «جاهزية الافتتاح»
       بعد أن فُتح المقهى منذ ساعات، وموظفة تنتهي ٨ مساءً ترى «توثيق الإغلاق»
       والمقهى يُغلق ١١:٣٠. شرطان معاً:
         • المرحلة: الافتتاح في مراحل ما قبل الفتح، والإغلاق في مراحل الإقفال.
         • الشفت: صاحبة الافتتاح من يبدأ شفتها مع فتح الخدمة، وصاحبة الإغلاق
           من ينتهي شفتها مع إقفالها — لا كل من قاربت نهايتها هي.
       من ليست معنيّة لا ترى القائمة إطلاقاً، فلا تزدحم شاشتها بما ليس دورها. */
    var day=(S.state||{}).day||{}, svc=day.service||{};
    var ph=day.phase||'';
    function svcMs(hhmm){
      if(!hhmm) return null;
      var p2=String(hhmm).split(':'); if(p2.length<2) return null;
      var d0=new Date(r.now); d0.setHours(+p2[0], +p2[1], 0, 0);
      return d0.getTime();
    }
    var openMs=svcMs(svc.open), closeMs=svcMs(svc.close);
    var myStart=(S.state.shift&&S.state.shift.start)?new Date(S.state.shift.start).getTime():null;
    var GRACE=75*60000;
    var isOpener = (openMs!=null && myStart!=null) ? Math.abs(myStart-openMs) <= GRACE : true;
    var isCloser = (closeMs!=null && isFinite(endT)) ? (endT >= closeMs - GRACE) : true;
    var openPhase  = ['closed','pre_open','opening','ready_for_first_guest'].indexOf(ph) >= 0;
    var closePhase = ['closing_prep','service_closed','closing','finalized'].indexOf(ph) >= 0;

    if(open.length && isOpener && (openPhase || !ph))
      html+=opsChecklistHtml('جاهزية الافتتاح', IC.ready, open, false);
    if(temps.length){
      html+='<div class="card ops"><div class="ops-h">'+IC.temp+'<span>سلامة الغذاء — الحرارة</span></div>'+
        '<div class="muted small" style="margin:2px 0 7px">سجّلي قراءة كل جهاز في وقتها. أي قراءة خارج النطاق تُرفع للإدارة وتعني فحص المواد فوراً.</div>';
      temps.forEach(function(t){
        var last=t.last, badge;
        if(t.due) badge='<span class="chip orange">مطلوب الآن</span>';
        else if(last && !last.in_range) badge='<span class="chip red">خارج النطاق ('+last.reading+'°)</span>';
        else if(last) badge='<span class="chip green">'+last.reading+'° ✔</span>';
        else badge='<span class="chip">—</span>';
        html+='<div class="ops-item"><div class="ops-lbl">'+esc(t.name)+
            '<div class="muted small">النطاق '+t.min+' إلى '+t.max+'°C'+(last?' · آخر قراءة '+fmtT(last.ts):'')+'</div></div>'+
          '<div class="ops-tr">'+badge+'<button class="btn sm '+(t.due?'':'ghost')+'" data-temp="'+t.id+'" data-nm="'+esc(t.name)+'" data-min="'+t.min+'" data-max="'+t.max+'">سجّلي</button></div></div>';
      });
      html+='</div>';
    }
    if(close.length && isCloser && (closePhase || now > endT - 90*60000))
      html+=opsChecklistHtml('توثيق الإغلاق', IC.lock, close, true);
    w.innerHTML=html;
    $$('[data-rdy]',w).forEach(function(b){ b.addEventListener('click', function(){
      var id=+b.getAttribute('data-rdy'), s=b.getAttribute('data-s');
      if(s==='fail'){
        inputSheet('بند غير مطابق','صِفي المشكلة (تُرفع للإدارة كبلاغ عاجل)','مثال: الثلاجة لا تبرّد جيداً','إرسال للإدارة',function(note){
          sAct('readiness_check',{item_id:id,status:'fail',note:note||''},true).then(function(){ toast('سُجّل ورُفع للإدارة'); loadOpsCard(); });
        });
      } else {
        sAct('readiness_check',{item_id:id,status:'ok'},true).then(function(){ loadOpsCard(); });
      }
    }); });
    $$('[data-temp]',w).forEach(function(b){ b.addEventListener('click', function(){
      var id=+b.getAttribute('data-temp'), nm=b.getAttribute('data-nm'), mn=b.getAttribute('data-min'), mx=b.getAttribute('data-max');
      sheet('قراءة حرارة: '+nm,
        '<div class="muted small">النطاق المسموح: '+mn+' إلى '+mx+'°C</div>'+
        '<label class="f">القراءة (°C)</label><input class="f" id="tcVal" type="number" step="0.1" inputmode="decimal" placeholder="مثال: 4">'+
        '<div class="btnrow"><button class="btn block" id="tcGo">سجّلي القراءة</button></div>',
        function(ov, close2){
          $('#tcGo',ov).addEventListener('click', function(){
            var val=$('#tcVal',ov).value; if(val===''){ toast('أدخلي القراءة',true); return; }
            busyWrap(this, function(){ return sAct('temp_check',{asset_id:id, reading:val},true).then(function(r2){
              close2();
              if(r2.out_of_range) toast('القراءة خارج النطاق — رُفعت للإدارة، تحقّقي من سلامة المواد',true);
              else toast('سُجّلت القراءة ✔');
              loadOpsCard();
            }); });
          });
        });
    }); });
  }).catch(function(){});
}
function handoverItemsHtml(items){
  var map={cash:'الكاش والفواتير', charcoal:'وضع الفحم', pending:'طلبات معلّقة', cleaning:'نظافة المنطقة', notes:'ملاحظات'};
  var keys=Object.keys(items||{});
  if(!keys.length) return '<div class="muted small">بلا تفاصيل</div>';
  return '<ul style="margin:8px 0;padding-right:18px">'+keys.map(function(k){
    return '<li><b>'+esc(map[k]||k)+':</b> '+esc(items[k])+'</li>';
  }).join('')+'</ul>';
}

/* ---------- تبويب: المهام ---------- */
function viewTasks(){
  var st=S.state, tasks=st.tasks||[], out=[];
  var hasChores=(st.recurring||[]).length>0;
  if(!tasks.length && !hasChores) return '<div class="empty">لا مهام لليوم — تُولَّد تلقائياً عند وجود شفت ومنطقة</div>';
  var doneL=tasks.filter(function(t){return t.status==='done'||t.status==='approved';});
  var pct=tasks.length?Math.round(100*doneL.length/tasks.length):0;
  if(tasks.length){ var dash=(97.4*pct/100).toFixed(1);
    out.push('<div class="card"><div class="tdone-hero">'+
      '<svg class="ring" width="62" height="62" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--surface-2)" stroke-width="4"/><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--brand)" stroke-width="4" stroke-linecap="round" stroke-dasharray="'+dash+' 200" transform="rotate(-90 18 18)"/></svg>'+
      '<div style="flex:1;min-width:0"><div class="muted small">إنجاز اليوم</div><div class="v">'+doneL.length+'<span style="font-size:15px;color:var(--muted);font-weight:700">/'+tasks.length+'</span></div>'+
      '<div class="muted small" style="margin-top:2px">'+(pct===100?'اكتمل اليوم — أحسنتِ ✔':((tasks.length-doneL.length)+' مهمة متبقية'))+'</div></div>'+
      '<span class="chip '+(pct===100?'green':pct>=50?'':'orange')+'" style="align-self:flex-start;font-weight:800">'+pct+'٪</span></div></div>');
  }
  // قسمة سياقية: الإغلاق «قادم» حتى آخر 75 دقيقة من الشفت
  var sh=st.shift, nearEnd = sh ? (Date.now() >= new Date(sh.end).getTime() - 75*60000) : true;
  var pend=tasks.filter(function(t){return ['done','approved','carried','cancelled'].indexOf(t.status)<0;});
  var nowL=pend.filter(function(t){return nearEnd || t.phase!=='closing';});
  var laterL=pend.filter(function(t){return !nearEnd && t.phase==='closing';});
  out.push('<h3 style="margin:14px 2px 8px">الآن</h3>');
  if(nowL.length) nowL.forEach(function(t){ out.push(taskCard(t)); });
  else if(!hasChores) out.push('<div class="card muted small center">لا مهام مطلوبة الآن</div>');
  if(hasChores) out.push(dashOps('chores'));
  if(laterL.length){
    out.push('<h3 style="margin:14px 2px 8px">قادمة</h3><div class="list">'+laterL.map(function(t){
      return '<div class="row"><div class="row__body"><div class="row__title">'+esc(t.name)+'</div><div class="row__sub">'+esc(PHASE[t.phase]||'')+' · '+mins(t.expected)+(t.is_core?' · أساسية':'')+'</div></div><span class="badge badge--muted">في وقتها</span></div>';
    }).join('')+'</div>');
  }
  if(doneL.length){
    out.push('<details class="qa" style="margin-top:14px"><summary>مكتملة <span class="chip green">'+doneL.length+'</span></summary><div class="qa-body"><div class="list">'+doneL.map(function(t){
      return '<div class="row"><div class="row__body"><div class="row__title" style="color:var(--muted)">'+esc(t.name)+'</div><div class="row__sub">'+esc(PHASE[t.phase]||'')+'</div></div><span class="badge badge--success">'+(t.status==='approved'?'معتمدة':'منجزة')+'</span></div>';
    }).join('')+'</div></div></details>');
  }
  return out.join('');
}
function taskCard(t){
  var stChip = {open:'',running:'green',paused:'orange',done:'green',approved:'green',returned:'red',
    claimed_done:'',accepted:'green',verified:'green',review_required:'orange',reopened:'red',blocked:'red'}[t.status]||'';
  var stLbl = TSTAT[t.status];
  if(t.status==='paused'&&t.blocked){ stChip='red'; stLbl='مانع — موقوفة'; }
  var deferred = (t.status==='paused' && !t.blocked && !!t.defer_reason);
  if(deferred){ stChip='orange'; stLbl='مؤجَّلة — الخدمة أولاً'; }
  var running = t.status==='running';
  var CLS={live:{t:'خدمة',c:'amber'},support:{t:'دعم',c:'brand'},maintenance:{t:'صيانة',c:'muted'}};
  var cl=CLS[t.op_class]||CLS.support;
  var prog=(running && t.expected)?'<div class="pbar" style="margin-top:9px"><i style="width:'+Math.min(100,Math.round(((t.net||0)/60)/t.expected*100))+'%"></i></div>':'';
  var html='<div class="task'+(t.is_core?' core':'')+(t.status==='done'||t.status==='approved'?' done':'')+'" data-task="'+t.id+'">'+
    '<div class="t-h"><div style="min-width:0"><span class="name">'+esc(t.name)+'</span> <span class="tclass '+cl.c+'">'+cl.t+'</span>'+(t.is_core?' <span class="chip orange">أساسية</span>':'')+(t.phase==='adhoc'?' <span class="chip ink">من الإدارة</span>':'')+
    '<div class="muted small" style="margin-top:3px">متوقعة '+mins(t.expected)+' · صافي <span class="timer" data-net="'+(t.net||0)+'" data-run="'+(running?1:0)+'" data-since="'+Date.now()+'">'+secFmt(t.net)+'</span></div></div>'+
    '<span class="chip '+stChip+'">'+stLbl+'</span></div>'+prog;
  if(t.status==='returned' && t.admin_note) html+='<div class="small" style="color:var(--red);margin-top:4px">ملاحظة الإدارة: '+esc(t.admin_note)+'</div>';
  if(deferred) html+='<div class="small muted" style="margin-top:4px">'+esc(t.defer_reason)+' — تعود تلقائياً حين تهدأ الصالة.</div>';
  if(workLocked()){ html+='<div class="muted small" style="margin-top:8px">انتهى شفتك — العرض فقط</div></div>'; return html; }
  /* قاعدة واحدة في التطبيق كله: ما لا رجعة فيه يُسحب، وما يُعكس يُكبس.
     كان «إنهاء ✔» كبسةً واحدة في قائمة المهام بينما البطاقة الرئيسية تطلب
     سحباً لنفس الفعل — فاختلفت القاعدة بين شاشتين، وضغطةٌ بالخطأ تُعلن
     إنجازاً. الآن الإنهاء سحبٌ في كل مكان. */
  html+='<div class="btnrow">';
  if(t.status==='open'||t.status==='returned') html+='<button class="btn sm" data-a="tStart" data-id="'+t.id+'">بدأت التنفيذ</button>';
  if(running) html+='<button class="btn sm ghost" data-a="tPause" data-id="'+t.id+'">إيقاف مؤقت (خدمة ضيف)</button>';
  if(t.status==='paused'&&t.blocked) html+='<button class="btn sm" data-a="tUnblock" data-id="'+t.id+'">أُزيل المانع واستأنف</button>';
  else if(deferred) html+='<button class="btn sm ghost" data-a="tResume" data-id="'+t.id+'">أستأنفها الآن على أي حال</button>';
  else if(t.status==='paused') html+='<button class="btn sm ghost" data-a="tResume" data-id="'+t.id+'">استئناف</button>';
  html+='</div>';
  if(running || (t.status==='paused' && !t.blocked))
    html+='<div style="margin-top:8px">'+swipeHtml('swT'+t.id,'اسحبي: أنهيت المهمة')+'</div>';
  html+='</div>';
  return html;
}
function updateTimers(){
  $$('.timer').forEach(function(el){
    var brk=el.getAttribute('data-brk');
    if(brk){ var bs=(Date.now()-new Date(brk).getTime())/1000;
      if(bs>=1800){ el.style.color='var(--red)'; el.textContent=secFmt(bs)+' — انتهت (30 د)'; }
      else { el.style.color=(bs>=1500?'var(--amber)':''); el.textContent=secFmt(bs); }
      return; }
    if(el.getAttribute('data-run')!=='1') return;
    var base=+el.getAttribute('data-net'), since=+el.getAttribute('data-since');
    el.textContent=secFmt(base+(Date.now()-since)/1000);
  });
}
function findTask(id){ var f=null; (S.state.tasks||[]).forEach(function(t){ if(t.id===id) f=t; }); return f; }
/* مسار إنجاز المهمة الدوّارة: كان محصوراً داخل معالج الكبسة، فاستُخرج كما هو
   ليستدعيه السحب أيضاً. لا تغيير في الحمولة ولا في التوثيق بالصورة. */
function recurringDone(tid, needPhoto, nm){
  function send(extra){
    var rp={template_id:tid}; for(var rk in (extra||{})) rp[rk]=extra[rk];
    sAct('recurring_done', rp, false).then(function(res){
      if(res && res.ok){ toast(res.msg||'سُجّلت'); refresh(); }
      else toast((res&&res.error)||'خطأ', true);
    });
  }
  if(needPhoto) cameraSheet({facing:'environment', title:'توثيق: '+nm, watermark:(S.me?S.me.name:'')+' · '+nm},
    function(d){ mediaPut('img', d, 'recurring:'+tid).then(
      function(k){ send({photo_key:k}); }, function(){ send({photo:d}); }); });
  else send(null);
}

/* ---------- السحب للتأكيد ---------- */
function swipeHtml(id, label){
  return '<div class="swipe" id="'+id+'"><div class="swipe-fill"></div>'+
    '<div class="swipe-lbl">'+esc(label)+'</div>'+
    '<div class="swipe-knob">›</div></div>';
}
/* يفعّل السحب. onDone تُستدعى عند اكتمال السحب فقط. reason!=null ⇒ معطّل مع سبب */
function swipeBind(el, onDone, reason){
  if(!el) return;
  var knob=el.querySelector('.swipe-knob'), fill=el.querySelector('.swipe-fill'), lbl=el.querySelector('.swipe-lbl');
  if(reason){ el.classList.add('off'); lbl.textContent=reason; knob.textContent='✕'; return; }
  var dragging=false, startX=0, dx=0, max=0, rtl=(getComputedStyle(el).direction==='rtl');
  function maxTravel(){ return el.clientWidth - knob.offsetWidth - 10; }
  function setPos(v){
    dx=Math.max(0, Math.min(maxTravel(), v));
    knob.style.transform='translateX('+(rtl?-dx:dx)+'px)';
    fill.style.width=(dx+knob.offsetWidth)+'px';
  }
  function reset(){ knob.style.transition='transform .18s'; fill.style.transition='width .18s';
    setPos(0); setTimeout(function(){ knob.style.transition=''; fill.style.transition=''; },200); }
  function down(x){ dragging=true; max=maxTravel(); startX=x; }
  function move(x){ if(!dragging) return; setPos(rtl?(startX-x):(x-startX)); }
  function up(){
    if(!dragging) return; dragging=false;
    if(dx >= maxTravel()*0.85){
      el.classList.add('done'); lbl.textContent='تم ✔'; knob.textContent='✔';
      onDone();
    } else reset();
  }
  el.addEventListener('touchstart',function(e){ down(e.touches[0].clientX); },{passive:true});
  el.addEventListener('touchmove', function(e){ move(e.touches[0].clientX); },{passive:true});
  el.addEventListener('touchend',  up);
  el.addEventListener('mousedown', function(e){ down(e.clientX); e.preventDefault(); });
  window.addEventListener('mousemove', function(e){ move(e.clientX); });
  window.addEventListener('mouseup', up);
}
/* ---------- نافذة تراجع: الفعل الخاطئ لا يكلّف شيئاً ---------- */
var _undoT=null;
function undoWindow(msg, secs, onCommit, onUndo){
  if(_undoT){ clearInterval(_undoT.iv); if(_undoT.el) _undoT.el.remove(); _undoT.commit(); }
  var left=secs||10;
  var bar=document.createElement('div'); bar.className='undobar';
  bar.innerHTML='<div class="ub-txt">'+esc(msg)+'</div><span class="ub-ring">'+left+'</span>'+
                '<button class="ub-btn">تراجع</button>';
  document.body.appendChild(bar);
  var done=false;
  function finish(commit){
    if(done) return; done=true;
    clearInterval(iv); bar.remove(); _undoT=null;
    if(commit) onCommit(); else if(onUndo) onUndo();
  }
  var iv=setInterval(function(){
    left--; var r=bar.querySelector('.ub-ring'); if(r) r.textContent=left;
    if(left<=0) finish(true);
  },1000);
  bar.querySelector('.ub-btn').addEventListener('click', function(){ finish(false); });
  _undoT={iv:iv, el:bar, commit:function(){ finish(true); }};
}
/* ---------- «لم أستطع» — بنفس سهولة «تم» ---------- */
var CANTR=[['busy','كنت مشغولة بخدمة ضيفة'],['blocker','يوجد مانع (عطل/نقص)'],['tools','ينقصني أدوات'],
           ['help','أحتاج مساعدة'],['time','لم يكفِ الوقت'],['other','سبب آخر']];
function cannotFlow(t, after){
  sheet('لم أستطع إكمال: '+t.name,
    '<div class="muted small" style="margin-bottom:8px">لا مشكلة — الأهم أن نعرف الحقيقة. ستعود المهمة للتوزيع تلقائياً.</div>'+
    CANTR.map(function(r){ return '<div class="check"><input type="radio" name="cantr" value="'+r[0]+'"'+(r[0]==='busy'?' checked':'')+'><span>'+r[1]+'</span></div>'; }).join('')+
    '<label class="f">تفاصيل (اختياري)</label><input class="f" id="cantNote">'+
    '<div class="btnrow"><button class="btn block" id="cantGo">إرسال</button></div>',
    function(ov, close){
      $('#cantGo',ov).addEventListener('click', function(){
        var sel=ov.querySelector('input[name=cantr]:checked');
        busyWrap(this, function(){
          return sAct('task_cannot',{id:t.id, reason:sel?sel.value:'other', note:$('#cantNote',ov).value}, false)
            .then(function(res){
              if(!res.ok){ toast(res.error||'خطأ', true); return; }
              close(); toast(res.msg||'أُعيدت للتوزيع'); if(after) after(); refresh();
            });
        });
      });
    });
}
function completeFlow(t){
  // طرق «صورة» و«موظفتان» تستلزم متطلباتها حتى لو نُسي تفعيل الخيار في القالب
  t=Object.assign({}, t, {
    needs_photo: t.needs_photo || t.method==='photo',
    needs_two:   t.needs_two   || t.method==='two_person'
  });
  var body='';
  if(t.method==='checklist'){
    var cl=t.checklist||[];
    body+='<div class="muted small" style="margin-bottom:6px">علّمي كل بند بعد تنفيذه فعلياً:</div>'+
      cl.map(function(c,i){ return '<div class="check"><input type="checkbox" class="tick" data-i="'+i+'"><span>'+esc(c)+'</span></div>'; }).join('');
  }
  if(t.method==='number'){
    body+='<label class="f">الرقم / الكمية</label><input class="f" id="tNum" type="number" inputmode="decimal">';
  }
  if(t.needs_photo){
    body+='<div class="btnrow"><button class="btn ghost block" id="tPhoto">توثيق مباشر بالكاميرا (لا يقبل صوراً قديمة)</button></div><img id="tPhotoPrev" style="display:none;width:100%;border-radius:10px;margin-top:8px">';
  }
  if(t.needs_two){
    body+='<hr class="sep"><b>تأكيد موظفة ثانية</b><div class="muted small">تختار اسمها وتدخل كلمة سرها بنفسها</div>'+
      '<label class="f">الزميلة</label><select class="f" id="tCoId">'+ (S.state.colleagues||[]).map(function(c){return '<option value="'+c.id+'">'+esc(c.name)+'</option>';}).join('') +'</select>'+
      '<label class="f">كلمة سرها</label><input class="f" id="tCoPw" type="password" autocomplete="off">';
  }
  body+='<label class="f">ملاحظة (اختياري)</label><input class="f" id="tNote">'+
    '<div class="btnrow"><button class="btn block" id="tGo">أنجزت وأؤكد النتيجة</button></div>'+
    '<div class="btnrow"><button class="btn ghost block" id="tCant">لم أستطع إكمالها</button></div>';
  sheet('إنهاء: '+t.name, body, function(ov, close){
    var cb=$('#tCant',ov); if(cb) cb.addEventListener('click', function(){ close(); cannotFlow(t); });
    var photo='', photoKey='';
    var pb=$('#tPhoto',ov);
    if(pb) pb.addEventListener('click', function(){
      cameraSheet({facing:'environment', title:'توثيق المهمة — تصوير مباشر',
        watermark:(S.me?S.me.name:'')+' · '+t.name},
        function(d){
          photo=d; photoKey=''; var im=$('#tPhotoPrev',ov); im.src=d; im.style.display='block';
          pb.textContent='يُحفَظ التوثيق…'; pb.disabled=true;
          /* الصورة ترتفع للتخزين الخاص أثناء كتابة الملاحظة، فلا تنتظر عند الإرسال */
          mediaPut('img', d, 'task:'+t.id).then(
            function(k){ if(photo===d){ photoKey=k; photo=''; } pb.textContent='إعادة الالتقاط'; pb.disabled=false; },
            function(){ pb.textContent='إعادة الالتقاط'; pb.disabled=false; });
        });
    });
    $('#tGo',ov).addEventListener('click', function(){
      var p={id:t.id};
      if(t.method==='checklist'){
        var ticks=$$('.tick',ov).filter(function(c){return c.checked;}).map(function(c){return +c.getAttribute('data-i');});
        if(ticks.length < (t.checklist||[]).length){ toast('أكملي كل البنود أولاً', true); return; }
        p.ticks=ticks;
      }
      if(t.method==='number'){ var n=$('#tNum',ov).value; if(n==='' ){ toast('أدخلي الرقم', true); return; } p.number=+n; }
      if(t.needs_photo){
        if(!photo && !photoKey){ toast('الصورة مطلوبة لهذه المهمة', true); return; }
        if(photoKey) p.photo_key=photoKey; else p.photo=photo;
      }
      if(t.needs_two){ p.confirm_id=+$('#tCoId',ov).value; p.confirm_password=$('#tCoPw',ov).value; }
      var note=$('#tNote',ov).value; if(note) p.note=note;
      busyWrap(this, function(){
        return sAct('task_complete', p, false).then(function(res){
          if(!res.ok){ toast(res.error||'خطأ', true); return; }
          close();
          toast(res.needs_review ? 'سُجّل إنجازك — بانتظار مراجعة الإدارة'
              : res.claimed ? ('سُجّل إنجازك، والنتيجة قيد القبول التلقائي خلال '+(res.accept_min||20)+' د')
              : 'سُجّل إنجازك ✔');
          refresh();
        });
      });
    });
  });
}

/* ---------- تبويب: الشفت ---------- */
function viewShift(){
  var st=S.state, sh=st.shift, out=[];
  if(!sh) return '<div class="empty">لا يوجد شفت اليوم</div>';
  out.push('<div class="card beige"><h3>تفاصيل الشفت</h3>'+
    '<div>'+esc(sh.name)+' · '+esc(sh.area||'')+((sh.extra_areas&&sh.extra_areas.length)?' <span class="chip green">+ '+sh.extra_areas.map(esc).join(' + ')+'</span>':'')+'</div>'+
    '<div class="muted">'+fmtT(sh.start)+' → '+fmtT(sh.end)+'</div>'+
    (sh.daily_role?'<div style="margin-top:6px"><b>دورك اليوم:</b> '+esc(sh.daily_role)+'</div>':'')+'</div>');
  out.push('<div id="upNext"></div>');
  // زميلات اليوم
  var cols=st.colleagues||[];
  out.push('<div class="card"><h3>زميلات اليوم</h3>'+(cols.length?cols.map(function(c){return '<span class="chip green" style="margin:2px">'+esc(c.name)+'</span>';}).join(' '):'<div class="muted small">وحدك اليوم</div>')+'</div>');
  // تسليم الشفت
  if(sh.requires_handover){
    out.push('<div class="card"><h3>تسليم الشفت</h3>'+
      (st.handover_sent
        ? '<div class="chip green">أرسلتِ التسليم — بانتظار تأكيد الزميلة</div>'
        : '<div class="muted small">قبل الانصراف: سلّمي الشفت لزميلة موجودة، وتأكيدها شرط.</div><div class="btnrow"><button class="btn block" data-a="hoNew">تعبئة نموذج التسليم</button></div>')+'</div>');
  }
  // اختيار الأكثر تعاوناً
  out.push('<div class="card"><h3>الأكثر تعاوناً معي اليوم</h3>'+
    (st.coop_done
      ? '<div class="chip green">تم اختيارك لهذا اليوم — النتائج سرية وتظهر للإدارة فقط</div>'
      : '<div class="muted small">بنهاية شفتك: اختاري موظفة أو اثنتين ساعدتاك فعلاً اليوم. سري تماماً.</div><div class="btnrow"><button class="btn ghost block" data-a="coopNew">اختيار الآن</button></div>')+'</div>');
  out.push('<div class="btnrow"><button class="btn ghost block" data-a="goMore">طلب إجازة / إذن تأخير من الإدارة</button></div>');
  return out.join('');
}
function handoverSheet(){
  var cols=S.state.colleagues||[];
  if(!cols.length){ toast('لا توجد زميلة في شفت اليوم لتسليمها', true); return; }
  toast('جارٍ تجهيز ملخّص الشفت…');
  sAct('handover_brief',{}).then(function(bres){
    var brief=(bres&&bres.ok&&bres.brief)||{}, pre=handoverPrefill(brief);
    var fields=[['cash','الكاش والفواتير'],['charcoal','وضع الفحم'],['pending','طلبات ومهام معلّقة'],['cleaning','نظافة المنطقة'],['notes','ملاحظات أخرى']];
    sheet('تسليم الشفت الذكي',
      handoverBriefCard(brief,false)+
      '<label class="f">التسليم إلى</label><select class="f" id="hoTo">'+cols.map(function(c){return '<option value="'+c.id+'">'+esc(c.name)+'</option>';}).join('')+'</select>'+
      fields.map(function(f){return '<label class="f">'+f[1]+'</label><input class="f ho-i" data-k="'+f[0]+'" value="'+esc(pre[f[0]]||'')+'">';}).join('')+
      voiceFieldHtml('ho','أضيفي مذكرة صوتية للزميلة (اختياري)')+
      '<div class="btnrow"><button class="btn block" id="hoGo">إرسال التسليم</button></div>',
      function(ov, close){
        voiceWire(ov,'ho');
        $('#hoGo',ov).addEventListener('click', function(){
          var items={};
          $$('.ho-i',ov).forEach(function(i){ if(i.value.trim()) items[i.getAttribute('data-k')]=i.value.trim(); });
          busyWrap(this, function(){
            var hp={to_emp:+$('#hoTo',ov).value, items:items};
            var vp=voicePayload('ho'); for(var vk in vp) hp[vk]=vp[vk];
            return sAct('handover_send', hp, true).then(function(res){
              if(res.ok){ close(); toast('أُرسل التسليم — بانتظار تأكيدها'); refresh(); }
              else toast(res.error||'خطأ', true);
            });
          });
        });
      });
  }).catch(function(){ toast('تعذّر تجهيز الملخّص', true); });
}
function coopSheet(){
  var cols=S.state.colleagues||[];
  if(!cols.length){ toast('لا زميلات اليوم', true); return; }
  var reasons=S.state.coop_reasons||['غطّت منطقتي','ساعدتني وقت الضغط','علّمتني شيئاً','بادرت بلا طلب'];
  function block(n){
    return '<div class="card" style="margin-bottom:8px"><b>الاختيار '+n+(n===2?' (اختياري)':'')+'</b>'+
      '<select class="f co-e" style="margin-top:6px"><option value="">— لا أحد —</option>'+cols.map(function(c){return '<option value="'+c.id+'">'+esc(c.name)+'</option>';}).join('')+'</select>'+
      '<select class="f co-r" style="margin-top:6px">'+reasons.map(function(r){return '<option>'+esc(r)+'</option>';}).join('')+'</select>'+
      '<input class="f co-n" style="margin-top:6px" placeholder="مثال محدد (اختياري)"></div>';
  }
  sheet('الأكثر تعاوناً — سري',
    '<div class="muted small" style="margin-bottom:8px">لا يظهر اختيارك لأحد غير الإدارة. اختاري بصدق من ساعدك فعلاً اليوم.</div>'+
    block(1)+block(2)+
    '<div class="btnrow"><button class="btn block" id="coGo">إرسال</button></div>',
    function(ov, close){
      $('#coGo',ov).addEventListener('click', function(){
        var es=$$('.co-e',ov), rs=$$('.co-r',ov), ns=$$('.co-n',ov), choices=[];
        for(var i=0;i<es.length;i++){ if(es[i].value) choices.push({employee_id:+es[i].value, reason:rs[i].value, note:ns[i].value}); }
        if(!choices.length){ toast('اختاري موظفة واحدة على الأقل', true); return; }
        sAct('coop_vote',{choices:choices}, false).then(function(res){
          if(res.ok){ close(); toast('شكراً — وصل للإدارة بسرية'); refresh(); }
          else toast(res.error||'خطأ', true);
        });
      });
    });
}

/* ---------- تبويب: تطوري ---------- */
/* ألوان المراتب كانت خمس قيم سُدسية سطرية لا تنقلب مع السمة. صارت رموزاً
   في ورقة الأنماط، فتتبع السمة كبقية النظام. */
function tierOf(pts){ pts=pts||0;
  if(pts>=600) return ['بلاتينية','var(--tier-4)'];
  if(pts>=300) return ['ذهبية','var(--tier-3)'];
  if(pts>=120) return ['فضية','var(--tier-2)'];
  if(pts>=40)  return ['برونزية','var(--tier-1)'];
  return ['بداية الطريق','var(--tier-0)']; }
function loadGrow(v){
  Promise.all([sAct('my_progress',{}), sAct('my_month',{}).catch(function(){return {};}),
               sAct('my_engage',{}).catch(function(){return {};}),
               sAct('my_eval',{}).catch(function(){return {};})]).then(function(rs){
    var res=rs[0], mm=rs[1]||{}, eg=rs[2]||{}, me=rs[3]||{};
    if(!res.ok){ v.innerHTML='<div class="empty">'+esc(res.error||'خطأ')+'</div>'; return; }
    var out=[];
    /* تقييمها هي وحدها: لا ترتيب ولا مقارنة بزميلاتها — وأساس كل بُعد ظاهر
       كي يكون التقييم أداة تحسّن لا رقماً مبهماً تتلقّاه آخر الشهر. */
    if(me.ok && me.row){
      var r=me.row, b=r.basis||{};
      out.push('<div class="card evc'+(r.total==null?' na':'')+'">'+
        '<div class="row" style="justify-content:space-between;align-items:center">'+
          '<b>تقييمي — '+esc(me.month||'')+'</b>'+
          (r.total!=null ? '<span class="evtot"><b>'+r.total+'</b><span>من ١٠٠</span></span>'
                         : '<span class="chip orange">لم تكتمل الأدلة بعد</span>')+
        '</div>'+
        '<div class="muted small" style="margin-top:2px">'+(+r.shifts||0)+' شفت هذا الشهر</div>'+
        (r.total!=null
          ? '<div class="evds">'+EVD.map(function(d){ return evBar(r[d[0]], d[1]); }).join('')+'</div>'
          : '')+
        '<div class="evbasis">'+
          '<span>مهام: <b>'+(b.tasks_done||0)+'</b>/'+(b.tasks_total||0)+'</span>'+
          '<span>تأخير: <b>'+(b.late_over_10||0)+'</b></span>'+
          '<span>فحوص فائتة: <b>'+(b.spotchecks_missed||0)+'</b></span>'+
          '<span>مساهمات معتمدة: <b>'+(b.contrib_approved||0)+'</b></span>'+
          '<span>تدريب: <b>'+(b.trainings_delivered||0)+'</b></span>'+
        '</div>'+
        ((r.notes||[]).length
          ? '<div class="evnotes">'+r.notes.map(function(n){ return '<div>'+esc(n)+'</div>'; }).join('')+'</div>'
          : '')+
        '<div class="evnotes">تقييمك خاص بك — لا يُعرض لزميلاتك ولا يوجد ترتيب بينكن.</div>'+
      '</div>');
    }
    // ===== إنجازاتي: نقاط ريحانة + السلسلة =====
    if(eg.ok){
      var tier=tierOf(eg.points), tc=eg.team_core||{}, done=tc.done||0, tot=tc.total||0, pct=tot>0?Math.round(100*done/tot):0;
      out.push('<div class="card" style="background:var(--hero);color:var(--on-hero);border:none">'+
        '<div class="row" style="justify-content:space-between;align-items:center"><div><div style="font-size:13px;opacity:.85">نقاط ريحانة</div>'+
        '<div style="font-size:34px;font-weight:800;line-height:1">'+(eg.points||0)+'</div></div>'+
        '<div style="text-align:center"><div style="width:54px;height:54px;border-radius:50%;background:'+tier[1]+';color:var(--tier-on);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;margin:0 auto">'+(eg.points>=40?'★':'٭')+'</div>'+
        '<div style="font-size:11.5px;margin-top:4px;opacity:.9">'+tier[0]+'</div></div></div>'+
        '<div class="row" style="gap:8px;margin-top:12px">'+
        '<div style="flex:1;background:rgba(255,255,255,.12);border-radius:12px;padding:8px;text-align:center"><div style="font-size:20px;font-weight:800">'+(eg.shift_streak||0)+'</div><div style="font-size:11px;opacity:.85">شفت متتالٍ بلا غياب</div></div>'+
        '<div style="flex:1;background:rgba(255,255,255,.12);border-radius:12px;padding:8px;text-align:center"><div style="font-size:20px;font-weight:800">'+((eg.month||{}).ontime_days||0)+'</div><div style="font-size:11px;opacity:.85">يوم التزام هذا الشهر</div></div></div>'+
        '<div class="muted small" style="color:rgba(244,239,228,.7);margin-top:8px">نقاطك تزيد بالحضور في الوقت، إنجاز المهام، وتغطية زميلاتك.</div></div>');
      // ===== هدف الفريق اليومي =====
      if(tot>0){
        out.push('<div class="card '+(pct>=100?'soft':'')+'" style="'+(pct>=100?'border:1.5px solid var(--green)':'')+'"><div class="row" style="justify-content:space-between"><b>هدف الفريق اليوم</b><span class="chip '+(pct>=100?'green':'')+'">'+done+'/'+tot+' مهمة أساسية</span></div>'+
          '<div class="pbar" style="margin-top:8px"><i style="width:'+pct+'%"></i></div>'+
          '<div class="small '+(pct>=100?'':'muted')+'" style="margin-top:6px">'+(pct>=100?'أنجز الفريق كل المهام الأساسية اليوم — عمل رائع منكن جميعاً':'كل مهمة أساسية تُنجزها تقرّب الفريق من الهدف.')+'</div></div>');
      }
      // ===== بوصلة تطويرك =====
      if(eg.dev_focus){
        out.push('<div class="card beige"><h3>بوصلة تطويرك هذا الأسبوع</h3><div style="font-size:15px;font-weight:600">'+esc(eg.dev_focus)+'</div><div class="muted small" style="margin-top:4px">هدف تركّزين عليه لتطوير مهاراتك — من إدارتك.</div></div>');
      }
      // ===== جدار الشكر =====
      if((eg.kudos||[]).length){
        out.push('<div class="card"><h3>جدار الشكر</h3>'+eg.kudos.map(function(k){
          return '<div style="padding:5px 0;border-bottom:1px dashed var(--line)"><b>'+esc(k.who)+'</b> — '+esc(k.text)+'<div class="muted small">'+fmtD(k.ts)+'</div></div>';
        }).join('')+'</div>');
      }
    }
    if(mm.ok){
      var at=mm.attendance||{}, tk=mm.tasks||{};
      var tpct=(tk.total||0)>0?Math.round(100*(tk.done||0)/tk.total):0, tdash=(97.4*tpct/100).toFixed(1);
      out.push('<h3 style="margin:8px 2px 8px">شهري بلمحة</h3>'+
        '<div class="card"><div class="tdone-hero">'+
          '<svg class="ring" width="62" height="62" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--surface-2)" stroke-width="4"/><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--brand)" stroke-width="4" stroke-linecap="round" stroke-dasharray="'+tdash+' 200" transform="rotate(-90 18 18)"/></svg>'+
          '<div style="flex:1;min-width:0"><div class="muted small">إنجاز المهام هذا الشهر</div><div class="v">'+(tk.done||0)+'<span style="font-size:15px;color:var(--muted);font-weight:700">/'+(tk.total||0)+'</span></div>'+
            '<div class="muted small" style="margin-top:2px">'+tpct+'٪ من مهامك مُنجزة</div></div>'+
          '<span class="chip '+(tpct>=80?'green':tpct>=50?'':'orange')+'" style="align-self:flex-start;font-weight:800">'+tpct+'٪</span></div></div>'+
        '<div class="statrow three" style="margin-top:10px">'+
          '<div class="stat good"><b>'+(at.days||0)+'</b><span>يوم حضور</span></div>'+
          '<div class="stat'+((at.late_times||0)>2?' warn2':'')+'"><b>'+(at.late_min||0)+'</b><span>دقيقة تأخير</span></div>'+
          '<div class="stat"><b>'+((eg.month||{}).ontime_days||at.ontime_days||0)+'</b><span>يوم التزام</span></div>'+
        '</div>'+((mm.coverage||0)>0?'<div class="card soft" style="padding:10px 12px;margin-top:10px">غطّيتِ زميلاتك <b>'+mm.coverage+'</b> مرة هذا الشهر — الإدارة تراه وتقدّره</div>':''));
    }
    // المهارات لا تُعرض للموظفات إطلاقاً — إدارتها ومستوياتها لدى الإدارة فقط
    if((res.learning||[]).length){
      out.push('<div class="card"><h3>قيد التعلّم</h3>'+res.learning.map(function(l){
        return '<div style="padding:4px 0">'+esc(l.skill)+' — مع '+esc(l.trainer)+' <span class="chip">'+(TRSTAT[l.status]||l.status)+'</span></div>';
      }).join('')+'</div>');
    }
    if((res.trained_others||[]).length){
      out.push('<div class="card"><h3>علّمتُ زميلاتي</h3><div class="muted small" style="margin-bottom:6px">ما علّمتِه لغيرك يُحسب لك عند اعتماده</div>'+res.trained_others.map(function(l){
        return '<div style="padding:4px 0">'+esc(l.skill)+' → '+esc(l.trainee)+' '+(l.approved?'<span class="chip green">اعتُمد ✔</span>':'<span class="chip">قيد المتابعة</span>')+'</div>';
      }).join('')+'</div>');
    }
    out.push('<div class="card"><h3>سجل التقدير</h3>'+
      ((res.recognitions||[]).length ? res.recognitions.map(function(r){
        return '<div style="padding:5px 0;border-bottom:1px dashed var(--line)">'+esc(r.text)+'<div class="muted small">'+fmtD(r.ts)+'</div></div>';
      }).join('') : '<div class="muted small">سيظهر هنا كل تقدير يصلك من الإدارة</div>')+'</div>');
    v.innerHTML=out.join('');
  });
}

/* ---------- تبويب: المزيد ---------- */
var COVST={open:'مفتوح',pending:'بانتظار الإدارة',approved:'اعتُمد',rejected:'مرفوض',cancelled:'ملغى'};
function openCover(){
  Promise.all([sAct('cover_board',{}), sAct('cover_mine',{})]).then(function(rs){
    var board=(rs[0]&&rs[0].rows)||[], mine=(rs[1]&&rs[1].rows)||[];
    var html='<div class="btnrow"><button class="btn block" id="cvNew">أحتاج تغطية / تبديل شفت</button></div>'+
      '<h3 style="margin-top:14px">طلبات يمكنكِ تغطيتها</h3>'+
      (board.length? board.map(function(c){
        return '<div class="card" style="padding:10px 12px"><b>'+esc(c.requester)+'</b> — '+fmtD(c.day)+' '+fmtHM(c.start)+'→'+fmtHM(c.end)+(c.area?' · '+esc(c.area):'')+(c.kind==='swap'?' <span class="chip">تبديل</span>':'')+(c.reason?'<div class="small muted">'+esc(c.reason)+'</div>':'')+'<div class="btnrow"><button class="btn sm" data-cvtake="'+c.id+'" data-kind="'+c.kind+'">'+(c.kind==='swap'?'أبادل':'أغطّي')+'</button></div></div>';
      }).join('') : '<div class="muted small">لا طلبات مفتوحة حالياً</div>')+
      '<h3 style="margin-top:14px">طلباتي</h3>'+
      (mine.length? mine.map(function(c){
        return '<div class="card" style="padding:9px 12px"><b>'+fmtD(c.day)+'</b> '+(c.kind==='swap'?'<span class="chip">تبديل</span> ':'')+'<span class="chip '+(c.status==='approved'?'green':c.status==='rejected'?'red':'')+'">'+(COVST[c.status]||c.status)+'</span>'+(c.volunteer?'<div class="small">المتطوعة: '+esc(c.volunteer)+'</div>':'')+(c.status==='open'?'<div class="btnrow"><button class="btn sm ghost red" data-cvcancel="'+c.id+'">إلغاء</button></div>':'')+'</div>';
      }).join('') : '<div class="muted small">لا طلبات لكِ</div>');
    sheet('تبديل وتغطية الشفتات', html, function(ov, close){
      $('#cvNew',ov).addEventListener('click', function(){ close(); coverNew(); });
      $$('[data-cvtake]',ov).forEach(function(b){ b.addEventListener('click', function(){
        var id=+b.getAttribute('data-cvtake'), kind=b.getAttribute('data-kind');
        if(kind==='swap'){ close(); coverTakeSwap(id); }
        else busyWrap(b, function(){ return sAct('cover_take',{id:id},true).then(function(r){ if(r.ok){ toast('عرضكِ وصل للإدارة للاعتماد ✔'); close(); } else toast(r.error||'خطأ',true); }); });
      }); });
      $$('[data-cvcancel]',ov).forEach(function(b){ b.addEventListener('click', function(){
        busyWrap(b, function(){ return sAct('cover_cancel',{id:+b.getAttribute('data-cvcancel')},true).then(function(){ close(); openCover(); }); });
      }); });
    });
  });
}
function loadUpNext(){
  sAct('my_upcoming',{}).then(function(r){
    var el=$('#upNext'); if(!el || !r || !r.ok) return;
    var td=today();
    var next=(r.shifts||[]).filter(function(s){ return s.day > td; }).slice(0,3);
    if(!next.length){ el.innerHTML=''; return; }
    el.innerHTML='<h3 style="margin:14px 2px 8px">شفتاتي القادمة</h3>'+next.map(function(s){
      var ex=(s.expected||[]), wk=(s.works||[]);
      return '<div class="card" style="padding:12px 14px">'+
        '<div class="row" style="justify-content:space-between"><b>'+fmtD(s.day)+'</b>'+
          '<span class="muted small">'+esc(s.shift||'شفت')+'</span></div>'+
        '<div class="muted small" style="margin-top:2px">'+
          (s.no_area?'<span style="color:var(--amber)">بلا منطقة — راجعي الإدارة</span>':esc(s.area||''))+
          (s.start?' · '+fmtHM(s.start)+'→'+fmtHM(s.end):'')+'</div>'+
        (ex.length?'<div style="margin-top:8px"><div class="small"><b>المتوقّع ('+ex.length+')</b></div>'+
          '<ul class="muted small" style="margin:4px 0 0;padding-inline-start:18px">'+
          ex.slice(0,6).map(function(x){return '<li>'+esc(x.name)+(x.min?' · ~'+x.min+'د':'')+'</li>';}).join('')+
          (ex.length>6?'<li>و'+(ex.length-6)+' غيرها…</li>':'')+'</ul></div>':'')+
        (wk.length?'<div class="muted small" style="margin-top:6px">أعمال المنطقة: '+wk.slice(0,4).map(esc).join(' · ')+'</div>':'')+
        '<div class="muted small" style="margin-top:6px">تُسنَد لكِ صباح الشفت بعد تسجيل الحضور.</div></div>';
    }).join('');
  }).catch(function(){});
}
function coverNew(){
  sAct('my_upcoming',{}).then(function(r){
    var sh=(r&&r.shifts)||[];
    if(!sh.length){ toast('لا شفتات قادمة لكِ',true); return; }
    var html='<label class="f">الشفت</label><select class="f" id="cvSh">'+sh.map(function(s){return '<option value="'+s.id+'">'+fmtD(s.day)+' · '+fmtHM(s.start)+'→'+fmtHM(s.end)+(s.area?' · '+esc(s.area):'')+'</option>';}).join('')+'</select>'+
      '<label class="f">النوع</label><select class="f" id="cvKind"><option value="cover">تغطية (تأخذ زميلة شفتي)</option><option value="swap">تبديل (أبدّل بشفت زميلة)</option></select>'+
      '<label class="f">السبب (اختياري)</label><input class="f" id="cvReason" placeholder="مثال: ظرف عائلي">'+
      '<div class="btnrow"><button class="btn block" id="cvGo">إرسال الطلب</button></div>';
    sheet('طلب تغطية / تبديل', html, function(ov, close){
      $('#cvGo',ov).addEventListener('click', function(){
        busyWrap(this, function(){ return sAct('cover_create',{shift_id:+$('#cvSh',ov).value, kind:$('#cvKind',ov).value, reason:$('#cvReason',ov).value},true).then(function(r){ if(r.ok){ toast('أُرسل طلبك — سيراه الفريق ✔'); close(); } else toast(r.error||'خطأ',true); }); });
      });
    });
  });
}
function coverTakeSwap(id){
  sAct('my_upcoming',{}).then(function(r){
    var sh=(r&&r.shifts)||[];
    if(!sh.length){ toast('تحتاجين شفتاً لتبادلي به',true); return; }
    var html='<div class="muted small">اختاري شفتكِ الذي تعطينه مقابل هذا الشفت:</div><label class="f">شفتي</label><select class="f" id="cvGive">'+sh.map(function(s){return '<option value="'+s.id+'">'+fmtD(s.day)+' · '+fmtHM(s.start)+'→'+fmtHM(s.end)+'</option>';}).join('')+'</select>'+
      '<div class="btnrow"><button class="btn block" id="cvSwapGo">تأكيد التبديل</button></div>';
    sheet('تبديل شفت', html, function(ov, close){
      $('#cvSwapGo',ov).addEventListener('click', function(){
        busyWrap(this, function(){ return sAct('cover_take',{id:id, give_shift_id:+$('#cvGive',ov).value},true).then(function(rr){ if(rr.ok){ toast('عرض التبديل وصل للإدارة ✔'); close(); } else toast(rr.error||'خطأ',true); }); });
      });
    });
  });
}
/* أربعة أقسام لا تسعة. ما خرج ولماذا:
   «نسيتِ الحضور أو الانصراف؟» ← صار سؤالاً يظهر من نفسه عند فتح التطبيق،
   فلا معنى لأن تبحث عنه الموظفة · «التواصل مع الإدارة» ← اندمج في البلاغ:
   قناة واحدة لا قناتان لنفس الغرض · «سجل الشفت» و«أدلة العمل» ← مؤجَّلان
   حتى ثلاثين يوماً من التشغيل · «ملفّي» ← إداريّ لا يخصّ يوم الموظفة. */
var MORE_SECS=[
  ['myhours','ساعاتي','ساعات عملكِ آخر ٣٠ يوماً وكيف حُسبت', IC.tasks],
  ['requests','الطلبات والإجازات','إجازة، إذن، تبديل وتغطية الشفتات', IC.shift],
  ['issues','بلاغ أو ملاحظة للإدارة','عطل، نقص مستلزمات، سلامة، أو ملاحظة', IC.bell],
  ['settings','إعدادات العرض','السمة، حجم الخط، التثبيت', IC.more]
];
function viewMore(){
  var st=S.state;
  if(!S.moreSec){
    return '<div class="navlist">'+
      MORE_SECS.map(function(s){
      return '<button data-a="moreOpen" data-sec="'+s[0]+'"><span class="ic">'+s[3]+'</span><span>'+s[1]+'<span class="nl-sub">'+s[2]+'</span></span><span class="chev">‹</span></button>';
    }).join('')+'</div>'+
    '<div class="navlist" style="margin-top:12px"><button class="danger" data-a="logout"><span class="ic">'+IC.shift+'</span><span>تسجيل الخروج</span></button></div>';
  }
  var t=''; MORE_SECS.forEach(function(s){ if(s[0]===S.moreSec) t=s[1]; });
  var back='<div class="backbar"><button data-a="moreBack">‹ رجوع</button><h2>'+esc(t)+'</h2></div>';
  return back + moreSection(S.moreSec, st);
}
function moreSection(sec, st){
  if(sec==='myhours') return moreHoursCard();
  if(sec==='requests') return moreReqCard(st)+
    '<div class="card"><h3>تبديل وتغطية الشفتات</h3>'+
    '<div class="muted small">تحتاجين تغطية شفتكِ أو تبديله؟ أو تساعدين زميلة؟ نظّميها هنا — بموافقة الإدارة.</div>'+
    '<div class="btnrow"><button class="btn ghost block" data-a="coverOpen">فتح تبديل وتغطية</button></div></div>';
  /* البلاغ والملاحظة قناة واحدة: كلاهما «أريد أن تعرف الإدارة شيئاً»،
     وقناتان لغرضٍ واحد تجعلان الموظفة تتردّد أيّهما تختار. */
  if(sec==='issues') return moreIssueCard()+moreNoteCard();
  if(sec==='settings') return '<div class="card"><h3>إعدادات العرض</h3>'+
    '<div class="btnrow" style="flex-wrap:wrap"><button class="btn ghost" data-a="themeToggle">تبديل السمة (فاتح/داكن)</button>'+
    '<button class="btn ghost" data-a="fontToggle">حجم الخط: '+((function(){try{return localStorage.getItem('rko_font')==='lg';}catch(e){return false;}})()?'كبير':'عادي')+'</button>'+
    '<button class="btn ghost" data-a="installApp">تثبيت التطبيق على الجهاز</button></div></div>'+
    /* كل موظفة على هاتفها، والمالكة هي من أنشأت الحساب ووضعت كلمة السر.
       ما دامت الموظفة لا تستطيع تغييرها، فحضورها وساعاتها ليست منسوبةً
       إليها وحدها. هذا هو موضع تغييرها. */
    '<div class="card"><h3>كلمة السر</h3>'+
    '<div class="muted small">حسابك على هاتفك أنتِ. غيّري كلمة سرك لتصير لكِ وحدك — '+
      'ولا تشاركيها مع أحد.</div>'+
    '<div class="btnrow"><button class="btn ghost block" data-a="pwChange">تغيير كلمة السر</button></div></div>';
  return '';
}
/* ساعاتي: الموظفة ترى ساعاتها هي فقط (الخادم يقصرها على هويتها، لا الواجهة).
   الأهم أن ترى كيف حُسبت — لأن رقماً بلا قاعدة يولّد شكوى لا حواراً.
   ولا نسمّيها كشف راتب: البيانات يدوية ولا تُعتبر دقيقة مالياً. */
var MHST={ full:['green','شفت كامل'], full_with_overtime:['green','كامل + إضافي'],
  short:['orange','ناقص عن المخطط'], incomplete:['orange','تسجيل غير مكتمل'],
  no_checkin:['red','بلا تسجيل حضور'], open:['orange','ما زال مفتوحاً'] };
function moreHoursCard(){
  setTimeout(function(){
    var box=$('#mhB'); if(!box) return;
    sAct('my_hours',{}).then(function(res){
      if(!res || !res.ok){ box.innerHTML='<div class="empty">تعذّر تحميل ساعاتكِ — حدّثي الصفحة</div>'; return; }
      var rows=(res.rows||[]).slice().sort(function(a,b){ return a.day<b.day?1:-1; });
      var t=res.totals||{}, pol=(res.rules||{}).policy||{};
      box.innerHTML=
        '<div class="statrow" style="margin-bottom:10px">'+
          '<div class="stat"><b>'+(t.worked_hours!=null?t.worked_hours:'—')+'</b><span>ساعة عمل</span></div>'+
          '<div class="stat"><b>'+(t.shifts||0)+'</b><span>شفت</span></div>'+
          '<div class="stat"><b>'+(t.full||0)+'</b><span>كامل</span></div>'+
        '</div>'+
        (rows.length
          ? '<div class="scrollx"><table class="tbl"><tr><th>اليوم</th><th>الحالة</th><th>حضور فعلي</th><th>عمل محتسب</th></tr>'+
            rows.map(function(r){
              var s=MHST[r.status]||['', r.status||'—'];
              return '<tr><td>'+fmtD(r.day)+'</td>'+
                '<td><span class="chip '+s[0]+'">'+esc(s[1])+'</span>'+
                  (r.note?'<div class="muted small">'+esc(r.note)+'</div>':'')+'</td>'+
                '<td>'+hm(r.present_minutes)+'</td>'+
                '<td><b>'+hm(r.worked_minutes)+'</b>'+
                  ((r.break_minutes||0)>0?'<div class="muted small">− '+r.break_minutes+'د استراحة</div>':'')+
                  ((r.overtime_minutes||0)>0?'<div class="muted small">+ '+r.overtime_minutes+'د إضافي</div>':'')+'</td></tr>';
            }).join('')+'</table></div>'
          : '<div class="empty">لا شفتات في آخر ٣٠ يوماً</div>')+
        '<details class="qa" style="margin-top:12px"><summary>كيف تُحسب الساعات؟</summary>'+
          '<div class="small" style="line-height:1.85;padding:2px 2px 6px">'+
            '<div>• <b>وقت العمل المحتسب</b> = وقت تواجدكِ ناقص الاستراحات'+(pol.break_paid?' (الاستراحة مدفوعة)':' (الاستراحة غير مدفوعة)')+'.</div>'+
            (pol.full_shift_ratio!=null?'<div>• <b>الشفت الكامل</b> يتحقق عند إتمام '+Math.round(pol.full_shift_ratio*100)+'% من المخطّط — لا بمجرد التسجيل.</div>':'')+
            (pol.late_grace_minutes!=null?'<div>• تأخير حتى '+pol.late_grace_minutes+' دقائق لا يُحسب تأخيراً.</div>':'')+
            (pol.min_countable_minutes!=null?'<div>• أقل من '+pol.min_countable_minutes+' دقيقة لا يُحتسب شفتاً.</div>':'')+
            (pol.overtime_after_minutes!=null?'<div>• الوقت الإضافي يبدأ بعد '+pol.overtime_after_minutes+' دقيقة من نهاية الشفت.</div>':'')+
            '<div style="margin-top:6px">• هذه <b>ليست كشف راتب</b>: الأرقام مبنية على تسجيل يدوي، وأي فرق يُراجَع مع الإدارة.</div>'+
          '</div></details>';
      tblResponsive(box);
    });
  },0);
  return '<div class="card"><h3>ساعاتي — آخر ٣٠ يوماً</h3><div id="mhB">'+skel(3)+'</div></div>';
}
function hm(min){
  if(min==null) return '—';
  var h=Math.floor(min/60), m=Math.round(min%60);
  return h? (h+'س'+(m?' '+m+'د':'')) : (m+'د');
}
function moreFixCard(){
  return '<div class="card"><h3>نسيتِ تسجيل الحضور/الانصراف؟</h3>'+
    '<div class="muted small">يُرسل للإدارة للمراجعة ولا يُعتمد تلقائياً.</div>'+
    '<label class="f">النوع</label><select class="f" id="fgKind"><option value="in">نسيت تسجيل الحضور</option><option value="out">نسيت تسجيل الانصراف</option></select>'+
    '<label class="f">الوقت التقريبي</label><input class="f" id="fgTime" type="time">'+
    '<label class="f">السبب</label><input class="f" id="fgReason" placeholder="مثال: كان في ضغط على الباب">'+
    '<div class="btnrow"><button class="btn ghost block" data-a="fgSend">إرسال للمراجعة</button></div></div>';
}
function moreReqCard(st){
  return '<div class="card"><h3>طلب إجازة / إذن / تبديل</h3>'+
    '<label class="f">نوع الطلب</label><select class="f" id="rqType">'+(st.request_types||['إجازة','إذن تأخير','مغادرة مبكرة','تبديل شفت','ملاحظة تشغيلية','أخرى']).map(function(t){return '<option>'+esc(t)+'</option>';}).join('')+'</select>'+
    '<label class="f">التاريخ المطلوب (اختياري)</label><input class="f" id="rqDate" type="date">'+
    '<label class="f">التفاصيل</label><textarea class="f" id="rqDet" placeholder="مثال: أحتاج إجازة يوم الجمعة لظرف عائلي"></textarea>'+
    '<div class="btnrow"><button class="btn block" data-a="rqSend">إرسال الطلب</button><button class="btn ghost" data-a="rqMine">طلباتي السابقة</button></div></div>';
}
function moreNoteCard(){
  return '<div class="card"><h3>ملاحظة سريعة للإدارة</h3>'+
    '<textarea class="f" id="ntText" placeholder="أي شيء تريدين إيصاله"></textarea>'+
    voiceFieldHtml('nt','أو سجّلي ملاحظة صوتية')+
    '<div class="btnrow"><button class="btn ghost block" data-a="ntSend">إرسال الملاحظة</button></div></div>';
}
function moreLogCard(){
  return '<div class="card"><h3>سجل الشفت</h3>'+
    '<div class="muted small">ملاحظة تشغيلية يراها الشفت التالي والإدارة (نقص مخزون، حادثة، حالة المنطقة).</div>'+
    '<label class="f">النوع</label><select class="f" id="lgCat"><option value="note">ملاحظة عامة</option><option value="lowstock">نقص مخزون</option><option value="incident">حادثة</option><option value="maintenance">عطل/صيانة</option><option value="cash">كاش/فواتير</option></select>'+
    '<textarea class="f" id="lgText" placeholder="التفاصيل"></textarea>'+
    '<div class="btnrow"><button class="btn block" data-a="lgAdd">أضيفي للسجل</button><button class="btn ghost" data-a="lgView">سجل اليوم</button></div></div>';
}
function moreIssueCard(){
  return '<div class="card"><h3>بلاغ عطل أو نقص</h3>'+
    '<div class="muted small">يصل الإدارة كتذكرة بحالة متابعة، مع صورة إن لزم.</div>'+
    '<label class="f">العنوان</label><input class="f" id="isTitle" placeholder="مثال: ماكينة القهوة لا تسخّن">'+
    '<label class="f">النوع</label><select class="f" id="isCat"><option value="maintenance">عطل/صيانة</option><option value="supply">نقص مستلزمات</option><option value="safety">سلامة</option><option value="cleanliness">نظافة</option><option value="other">أخرى</option></select>'+
    '<label class="f">الأولوية</label><select class="f" id="isPri"><option value="normal">عادية</option><option value="high">عاجلة</option><option value="low">منخفضة</option></select>'+
    '<textarea class="f" id="isDet" placeholder="تفاصيل (اختياري)"></textarea>'+
    '<div class="btnrow"><button class="btn ghost block" id="isPhoto">إرفاق صورة (اختياري)</button></div><img id="isPrev" style="display:none;width:120px;border-radius:10px;margin-top:6px">'+
    voiceFieldHtml('is','أو صِفي العطل بصوتك (اختياري)')+
    '<div class="btnrow"><button class="btn block" data-a="isSend">إرسال البلاغ</button><button class="btn ghost" data-a="isMine">بلاغاتي</button></div></div>';
}

/* ---------- ربط أحداث تبويبات الموظفة ---------- */
function wireTab(v){
  /* سؤال «متى غادرتِ أمس؟» — ثلاثة خيارات جاهزة، والثالث يفتح منتقي وقت
     لا حقلَ كتابة. والتحقّق كلّه خادميّ: هذه الأزرار تُرسل خياراً لا وقتاً
     موثوقاً به. */
  $$('[data-oc]', v).forEach(function(b){ b.addEventListener('click', function(){
    var ch=b.getAttribute('data-oc');
    var po=(S.state&&S.state.pending_out)||{};
    function send(extra){
      var pl={shift_id:po.shift_id, choice:ch};
      for(var k in (extra||{})) pl[k]=extra[k];
      sAct('checkout_confirm', pl, true).then(function(r){
        if(r&&r.ok){ S._outAsked=true; toast('شكراً — سُجّل وقتك'); refresh(); }
        else toast((r&&r.error)||'تعذّر التسجيل', true);
      });
    }
    if(ch!=='custom'){ send(); return; }
    /* منتقي وقت لا حقل كتابة: الأصابع لا تكتب في الذروة */
    var day = po.day || String(po.closed_at||'').slice(0,10);
    var pre = po.shift_end ? fmtHM(po.shift_end) : '22:00';
    sheet('متى غادرتِ؟',
      '<label class="f">وقت مغادرتك</label>'+
      '<input class="f" id="ocT" type="time" step="300" value="'+esc(pre)+'">'+
      '<div class="btnrow"><button class="btn block" id="ocGo">تأكيد</button></div>',
      function(ov, close){
        $('#ocGo',ov).addEventListener('click', function(){
          var val=$('#ocT',ov).value;
          if(!/^\d{2}:\d{2}$/.test(val||'')){ toast('اختاري وقتاً', true); return; }
          close();
          send({at: new Date(day+'T'+val+':00').toISOString()});
        });
      });
  }); });
  /* شفتاتي القادمة + مهامها المتوقّعة (الفعلية تُولَّد صباح الشفت) */
  if($('#upNext', v)) loadUpNext();
  /* السحب للتأكيد على بطاقة المهمة + البوابة تمنع مسبقاً بسبب معروض */
  $$('.swipe', v).forEach(function(el){
    var m=/^swDone(\d+)$/.exec(el.id||''); if(!m) return;
    var tid=+m[1], g=(S.state&&S.state.gates)||{}, why=null;
    if(g.next_complete_at && new Date(g.next_complete_at) > new Date()){
      var mins=Math.max(1,Math.ceil((new Date(g.next_complete_at)-new Date())/60000));
      why='بقيت '+mins+' د قبل التسجيل التالي';
    }
    var t0=findTask(tid);
    if(!why && g.priority_block && t0 && g.priority_block.name!==t0.name
       && (g.priority_block.tier||9) < (t0.tier||9)){
      why='أنجزي «'+g.priority_block.name+'» أولاً — الأهم';
    }
    swipeBind(el, function(){ var t=findTask(tid); if(t) completeFlow(t); }, why);
  });
  /* سحب إنهاء المهمة في قائمة المهام — نفس مسار completeFlow الذي كان
     خلف زر «إنهاء ✔»، بلا تغيير في المنطق. */
  $$('.swipe[id^="swT"]', v).forEach(function(el){
    var tid=+el.id.replace('swT','');
    if(!tid) return;
    swipeBind(el, function(){ var t=findTask(tid); if(t) completeFlow(t); });
  });
  /* سحب إنجاز المهمة الدوّارة — نفس قواعد السحب، ومسار recurring_done نفسه
     الذي كان خلف الكبسة، بلا تغيير في المنطق ولا في الحمولة. */
  $$('.swipe[id^="swRec"]', v).forEach(function(el){
    var tid=+el.id.replace('swRec','');
    var rt=null; (S.state.recurring||[]).forEach(function(x){ if(+x.template_id===tid) rt=x; });
    if(!rt) return;
    swipeBind(el, function(){ recurringDone(tid, !!rt.needs_photo, rt.name); });
  });
  /* السؤال التشغيلي العابر */
  $$('[data-obs]', v).forEach(function(b){
    b.addEventListener('click', function(){
      var s=b.getAttribute('data-obs'), ar=+b.getAttribute('data-area');
      S._askDone=true;
      var c=$('#askCard'); if(c) c.remove();
      if(s!=='skip') sAct('zone_observe',{area_id:ar, state:s}, false).then(function(){ toast('شكراً'); });
    });
  });
  $$('[data-a]', v).forEach(function(b){
    var a=b.getAttribute('data-a'), id=+b.getAttribute('data-id');
    b.addEventListener('click', function(){
      if(a==='ack') sAct('ack_recognition',{},true).then(refresh);
      else if(a==='hoConfirm') sAct('handover_confirm',{id:id, note:($('#hoNote')||{}).value||''},true).then(function(res){ if(res.ok) toast('تم تأكيد الاستلام ✔'); else toast(res.error||'خطأ',true); refresh(); });
      else if(a==='checkin') checkinFlow();
      else if(a==='checkout') doAttendance('out');
      else if(a==='goMore'){ S.tab='more'; S.moreSec=null; paintTabs(); drawTab(); }
      else if(a==='goTasks'){ S.tab='tasks'; paintTabs(); drawTab(); }
      else if(a==='goFloor'){ S.tab='floor'; paintTabs(); drawTab(); }
      else if(a==='goGrow'){ S.tab='grow'; paintTabs(); drawTab(); }
      /* تُستدعى الآن من اختصارات شاشة «الآن» أيضاً، لا من قائمة «المزيد»
         وحدها — فلا بدّ من نقل التبويب معها وإلا بقيت الشاشة مكانها. */
      else if(a==='moreOpen'){ S.tab='more'; S.moreSec=b.getAttribute('data-sec'); paintTabs(); drawTab(); }
      else if(a==='moreBack'){ S.moreSec=null; drawTab(); }
      /* تسجيل عملٍ غير مسنَد: اقتراحاتٌ تُضغط، وكتابةٌ لما ليس فيها.
         الوقت بثلاثة خيارات جاهزة لا حقلٍ رقميّ — لا أحد يقيس بالدقيقة
         وهو واقف. */
      else if(a==='workLog'){
        sAct('work_log_options',{}).then(function(r){
          var opts=(r&&r.options)||[];
          sheet('سجّلي عملاً أنجزتِه',
            '<div class="muted small" style="margin-bottom:8px">عملٌ لم يكن مُسنَداً إليكِ — يصل للإدارة باسمك.</div>'+
            (opts.length?'<div class="wl-opts">'+opts.map(function(o){
              return '<button class="wl-o" data-wl="'+esc(o)+'">'+esc(o)+'</button>';
            }).join('')+'</div>':'')+
            '<label class="f">ماذا عملتِ؟</label>'+
            '<input class="f" id="wlN" placeholder="مثال: كبّة النفايات">'+
            '<label class="f">كم أخذ منكِ؟</label>'+
            '<div class="wl-opts" id="wlM">'+
              [[5,'٥ دقائق'],[15,'ربع ساعة'],[30,'نصف ساعة']].map(function(m,i){
                return '<button class="wl-o'+(i===0?' on':'')+'" data-wm="'+m[0]+'">'+m[1]+'</button>';
              }).join('')+'</div>'+
            '<div class="btnrow"><button class="btn block" id="wlGo">سجّلي</button></div>',
            function(ov, close){
              var mins=5;
              $$('[data-wl]',ov).forEach(function(b2){ b2.addEventListener('click', function(){
                $('#wlN',ov).value=b2.getAttribute('data-wl');
              }); });
              $$('[data-wm]',ov).forEach(function(b2){ b2.addEventListener('click', function(){
                mins=+b2.getAttribute('data-wm');
                $$('[data-wm]',ov).forEach(function(x){ x.classList.remove('on'); });
                b2.classList.add('on');
              }); });
              $('#wlGo',ov).addEventListener('click', function(){
                var nm=$('#wlN',ov).value.trim();
                if(nm.length<3){ toast('اكتبي ماذا عملتِ', true); return; }
                busyWrap(this, function(){
                  return sAct('work_log',{name:nm, minutes:mins}, true).then(function(res){
                    if(res&&res.ok){ close(); toast('سُجّل — شكراً لكِ'); refresh(); }
                    else toast((res&&res.error)||'تعذّر التسجيل', true);
                  });
                });
              });
            });
        }).catch(function(){ toast('تعذّر الاتصال', true); });
      }
      else if(a==='pwChange'){
        sheet('تغيير كلمة السر',
          '<label class="f">كلمة السر الحالية</label>'+
          '<input class="f" id="pwC" type="password" autocomplete="current-password">'+
          '<label class="f">الجديدة</label>'+
          '<input class="f" id="pwN" type="password" autocomplete="new-password">'+
          '<label class="f">أعيدي كتابتها</label>'+
          '<input class="f" id="pwN2" type="password" autocomplete="new-password">'+
          '<div class="muted small">٦ خانات على الأقل. بعد التغيير تُغلق جلساتك على أي جهاز آخر.</div>'+
          '<div class="btnrow"><button class="btn block" id="pwGo">حفظ</button></div>',
          function(ov, close){
            $('#pwGo',ov).addEventListener('click', function(){
              var c=$('#pwC',ov).value, n1=$('#pwN',ov).value, n2=$('#pwN2',ov).value;
              if(!c){ toast('اكتبي كلمة سرك الحالية', true); return; }
              if(n1.length<6){ toast('الجديدة ٦ خانات على الأقل', true); return; }
              /* التطابق يُفحص هنا لأنه خطأ كتابةٍ لا خطأ صلاحية —
                 والخادم يفحص الباقي كلّه ولا يثق بشيء من هنا. */
              if(n1!==n2){ toast('الكلمتان غير متطابقتين', true); return; }
              busyWrap(this, function(){
                return sAct('change_password',{current:c, new:n1}, true).then(function(r){
                  if(r&&r.ok){ close(); toast('تغيّرت كلمة سرك'); }
                  else toast((r&&r.error)||'تعذّر التغيير', true);
                });
              });
            });
          });
      }
      else if(a==='themeToggle'){ toggleTheme(); }
      else if(a==='enablePush'){ enablePush((S.state&&S.state.push&&S.state.push.vapid_public)||PUSHKEY, function(ok){ if(ok) drawTab(); }); }
      else if(a==='tCant'){ var tc=findTask(id); if(tc) cannotFlow(tc); }
      else if(a==='tWhy'){ sAct('task_why',{task_id:id}).then(function(r){ sheet('لماذا هذه المهمة لكِ؟','<div class="cdlg-txt">'+esc(r.why||'')+'</div>'); }); }
      else if(a==='tBlock'){
        inputSheet('يوجد مانع','صِفي المانع (أداة معطلة، نقص مواد، منطقة مشغولة...)','مثال: ماكينة الجلي معطلة','تسجيل المانع',function(note){
          sAct('blocker_report',{task_id:id, note:note},true).then(function(r){ if(r.ok){ toast(r.msg||'سُجّل'); refresh(); } else toast(r.error||'خطأ',true); });
        });
      }
      else if(a==='tUnblock'){
        confirmSheet('إزالة المانع','هل زال المانع وتريدين استئناف المهمة؟','نعم، أُزيل واستأنف',function(){
          sAct('blocker_resolve',{task_id:id},true).then(function(r){ if(r.ok){ toast(r.msg||'استؤنفت'); refresh(); } else toast(r.error||'خطأ',true); });
        });
      }
      /* بطاقة المزاج أُزيلت بقرار سابق، فلم يبق في الواجهة أي data-a="mood".
         حُذف المعالج معها كي لا يبقى فرع ميت يوهم بوجود الميزة. */
      else if(a==='covAccept') sAct('coverage_respond',{id:id, accept:true}, false).then(function(res){ if(res.ok) toast(res.msg||'شكراً لكِ'); else toast(res.error||'خطأ',true); refresh(); });
      else if(a==='covDecline'){
        confirmSheet('الاعتذار عن التغطية','هل تؤكدين الاعتذار عن تغطية الغياب اليوم؟ الاعتذار حقك ولن يُحسب ضدك.','أعتذر اليوم',function(){
          sAct('coverage_respond',{id:id, accept:false}, false).then(function(res){ if(res.ok) toast(res.msg||'سُجّل اعتذارك'); else toast(res.error||'خطأ',true); refresh(); });
        }, true);
      }
      else if(a==='brStart') sAct('break_start',{},false).then(function(res){ if(res.ok){toast('استراحة هنية');refresh();} else toast(res.error||'خطأ',true); });
      else if(a==='brEnd') sAct('break_end',{},true).then(function(res){ if(res.ok) toast('أهلاً بعودتك'); else toast(res.error||'خطأ',true); refresh(); });
      else if(a==='brPost') sAct('break_postpone',{reason:'ضغط في المنطقة'},true).then(function(res){ toast(res.msg||'سُجّل التأجيل'); refresh(); });
      else if(a==='occ'){ var el=$('#occV'), val=+el.getAttribute('data-v')+(+b.getAttribute('data-d')); val=Math.max(0,Math.min(val,+el.getAttribute('data-max'))); el.setAttribute('data-v',val); el.textContent=val; }
      else if(a==='pSend'){
        var w='none'; $$('#waitSeg button').forEach(function(x){ if(x.classList.contains('on')) w=x.getAttribute('data-w'); });
        sAct('pressure_update',{area_id:S.state.shift.area_id, occupied:+$('#occV').getAttribute('data-v'), waiting:w, backlog:$('#backlogC').checked, needs_support:$('#supC').checked}, true)
          .then(function(res){ if(res.ok) toast('تم تحديث الضغط'); else toast(res.error||'خطأ',true); refresh(); });
      }
      else if(a==='helpNew') sAct('help_request',{},true).then(function(res){ if(res.ok) toast('أُرسل النداء لزميلاتك والإدارة'); else toast(res.error||'خطأ',true); refresh(); });
      else if(a==='helpClose') sAct('help_close',{id:id},true).then(function(){ refresh(); });
      else if(a==='tStart') sAct('task_start',{id:id},true).then(refresh);
      else if(a==='tPause') sAct('task_pause',{id:id,reason:'خدمة ضيف'},false).then(function(res){ if(!res.ok)toast(res.error||'خطأ',true); refresh(); });
      else if(a==='tResume') sAct('task_resume',{id:id},true).then(refresh);
      else if(a==='tDone'){ var t=findTask(id); if(t) completeFlow(t); }
      else if(a==='hoNew') handoverSheet();
      else if(a==='coopNew') coopSheet();
      else if(a==='fgSend'){
        var tm=$('#fgTime').value; if(!tm){ toast('حددي الوقت التقريبي', true); return; }
        sAct('forgot_attendance',{kind:$('#fgKind').value, approx_time: today()+'T'+tm+':00', reason:$('#fgReason').value}, true)
          .then(function(res){ toast(res.msg||'أُرسل للمراجعة'); });
      }
      else if(a==='rqSend'){
        var det=$('#rqDet').value.trim(), rqd=($('#rqDate')||{}).value;
        var ty=$('#rqType').value;
        if(!det && !rqd){ toast('اكتبي تفاصيل الطلب أو حددي التاريخ', true); return; }
        if(ty==='إجازة' && !rqd){ toast('حددي تاريخ الإجازة حتى يفحص النظام التعارض مع الزميلات', true); return; }
        sAct('request_send',{type:ty, details:det, date:rqd||null}, false).then(function(res){
          if(res.ok){ toast(res.msg||'أُرسل — سيصلك الرد في «طلباتي السابقة»'); $('#rqDet').value=''; if($('#rqDate'))$('#rqDate').value=''; }
          else toast(res.error||'خطأ', true);
        });
      }
      else if(a==='rqMine') sAct('my_requests',{}).then(function(res){
        sheet('طلباتي', (res.requests||[]).map(function(r){
          return '<div style="border-bottom:1px dashed var(--line);padding:7px 0"><b>'+esc(r.type)+'</b>'+(r.date?' <span class="chip">'+esc(r.date)+'</span>':'')+' <span class="chip '+(r.status==='approved'?'green':r.status==='rejected'?'red':'')+'">'+(REQSTAT[r.status]||r.status)+'</span>'+
            '<div class="small">'+esc(r.details||'')+'</div>'+(r.admin_note?'<div class="small muted">رد الإدارة: '+esc(r.admin_note)+'</div>':'')+'</div>';
        }).join('')||'<div class="empty">لا طلبات</div>');
      });
      else if(a==='ntSend'){
        var x=$('#ntText').value.trim();
        if(!x&&!VOICE.nt){toast('اكتبي الملاحظة أو سجّليها صوتاً',true);return;}
        var ntp={text:x}, ntv=voicePayload('nt'); for(var nk in ntv) ntp[nk]=ntv[nk];
        sAct('note_send', ntp, true).then(function(){ toast('وصلت ملاحظتك'); $('#ntText').value=''; voiceReset(null,'nt'); });
      }
      else if(a==='lgAdd'){ var lt=$('#lgText').value.trim(); if(!lt){toast('اكتبي التفاصيل',true);return;} sAct('logbook_add',{category:$('#lgCat').value, text:lt},true).then(function(res){ toast(res.msg||'أُضيف'); $('#lgText').value=''; }); }
      else if(a==='lgView') sAct('logbook_day',{}).then(function(res){
        var CATL={note:'ملاحظة',lowstock:'نقص مخزون',incident:'حادثة',maintenance:'عطل',cash:'كاش'};
        sheet('سجل اليوم',(res.rows||[]).map(function(l){
          return '<div style="border-bottom:1px dashed var(--line);padding:7px 0"><span class="chip">'+esc(CATL[l.category]||l.category)+'</span> <b>'+esc(l.who)+'</b> <span class="muted small">'+fmtT(l.ts)+'</span><div class="small">'+esc(l.text)+'</div></div>';
        }).join('')||'<div class="empty">لا مدخلات اليوم</div>');
      });
      else if(a==='isSend'){
        var it=$('#isTitle').value.trim(); if(!it){toast('اكتبي عنوان البلاغ',true);return;}
        var isp={title:it, category:$('#isCat').value, priority:$('#isPri').value, detail:$('#isDet').value};
        if(window._isPhotoKey) isp.photo_key=window._isPhotoKey; else if(window._isPhoto) isp.photo=window._isPhoto;
        var isv=voicePayload('is'); for(var ik in isv) isp[ik]=isv[ik];
        sAct('issue_report', isp, true).then(function(res){
          toast(res.msg||'أُرسل'); $('#isTitle').value=''; $('#isDet').value='';
          window._isPhoto=''; window._isPhotoKey='';
          var pv=$('#isPrev'); if(pv)pv.style.display='none'; voiceReset(null,'is');
        });
      }
      else if(a==='isMine') sAct('my_issues',{}).then(function(res){
        var IST={open:'مفتوح',in_progress:'قيد المعالجة',resolved:'تم الحل'};
        sheet('بلاغاتي',(res.rows||[]).map(function(i){
          return '<div style="border-bottom:1px dashed var(--line);padding:7px 0"><b>'+esc(i.title)+'</b> <span class="chip '+(i.status==='resolved'?'green':i.status==='in_progress'?'orange':'')+'">'+(IST[i.status]||i.status)+'</span>'+(i.admin_note?'<div class="small muted">'+esc(i.admin_note)+'</div>':'')+'</div>';
        }).join('')||'<div class="empty">لا بلاغات</div>');
      });
      else if(a==='recDone'){
        recurringDone(id, b.getAttribute('data-photo')==='1', b.getAttribute('data-name'));
      }
      else if(a==='recClaim'){ sAct('recur_claim',{template_id:id},false).then(function(res){ if(res.ok) refresh(); else toast(res.error||'خطأ',true); }); }
      else if(a==='recRelease'){ sAct('recur_release',{template_id:id},false).then(function(){ refresh(); }); }
      else if(a==='coverOpen') openCover();
      else if(a==='sopOpen') sAct('sops_list',{}).then(function(res){
        var rows=(res&&res.rows)||[];
        if(!rows.length){ sheet('أدلة العمل','<div class="empty">لا أدلة متاحة بعد</div>'); return; }
        var byc={}; rows.forEach(function(r){ (byc[r.category]=byc[r.category]||[]).push(r); });
        var html=SOP_CATS.map(function(c){
          var g=byc[c[0]]; if(!g||!g.length) return '';
          return '<h3 style="margin:12px 2px 6px;font-size:14px;color:var(--muted)">'+c[1]+'</h3>'+g.map(function(s){
            return '<div class="card" style="padding:10px 12px"><b>'+esc(s.title)+'</b>'+(s.area?' <span class="chip">'+esc(s.area)+'</span>':'')+
              mediaSlot('img', s.photo, 'width:100%;border-radius:10px;margin:8px 0')+
              '<ol style="margin:6px 0 0;padding-inline-start:20px;line-height:1.8">'+(s.steps||[]).map(function(st){return '<li>'+esc(st)+'</li>';}).join('')+'</ol></div>';
          }).join('');
        }).join('');
        sheet('أدلة العمل', html);
      });
      else if(a==='fontToggle'){ var lg=(function(){try{return localStorage.getItem('rko_font')==='lg';}catch(e){return false;}})(); try{ localStorage.setItem('rko_font', lg?'':'lg'); }catch(e){} applyFont(); toast(lg?'حجم عادي':'حجم كبير'); drawTab(); }
      else if(a==='installApp'){ if(deferredPrompt){ deferredPrompt.prompt(); deferredPrompt=null; } else toast('من قائمة المتصفح: «إضافة إلى الشاشة الرئيسية»'); }
      else if(a==='logout'){ sAct('logout',{}); clearSess(); renderLogin(); }
    });
  });
  var isPB=$('#isPhoto',v);
  if(isPB) isPB.addEventListener('click', function(){
    cameraSheet({facing:'environment', title:'صورة البلاغ', watermark:(S.me?S.me.name:'')+' · بلاغ'}, function(d){
      window._isPhoto=d; window._isPhotoKey='';
      var pv=$('#isPrev',v); if(pv){ pv.src=d; pv.style.display='block'; }
      isPB.textContent='يُحفَظ…'; isPB.disabled=true;
      mediaPut('img', d, 'issue').then(
        function(k){ if(window._isPhoto===d){ window._isPhotoKey=k; window._isPhoto=''; } isPB.textContent='إعادة الالتقاط'; isPB.disabled=false; },
        function(){ isPB.textContent='إعادة الالتقاط'; isPB.disabled=false; });
    });
  });
  // مقاطع الانتظار
  $$('#waitSeg button', v).forEach(function(x){
    x.addEventListener('click', function(){ $$('#waitSeg button').forEach(function(y){y.className='';}); x.className='on'; });
  });
}

/* ============================ واجهة الإدارة ============================ */
var A = { emps:null, areas:null, types:null, skills:null };
function startAdmin(){
  document.body.className='';
  APP.innerHTML =
    '<div class="top"><div class="brand"><div class="logo">'+brandMark(42)+'</div><div class="binfo"><h1>لوحة الإدارة</h1><div class="sub">ريحانة — نظام التشغيل</div></div></div>'+
    '<div class="left"><button class="pill icbtn" id="thBtnA" aria-label="السمة">'+THI()+'</button><button class="pill" id="admHome">الرئيسية</button><button class="pill" id="admOut">خروج</button></div></div>'+
    '<div class="wrap" id="view"></div>';
  $('#admOut').addEventListener('click', function(){ aAct('logout',{}); clearSess(); renderLogin(); });
  var _tha=$('#thBtnA'); if(_tha) _tha.addEventListener('click', toggleTheme);
  $('#admHome').addEventListener('click', function(){ S.adminSec=null; drawAdmin(); });
  updateDot(); S.adminSec=null; drawAdmin();
}
var SECS=[
  ['dash','','اليوم'],['board','','لوحة العمليات'],['ocdecisions','','مركز القرارات'],['live','','المتابعة الحية'],['heat','','خريطة النشاط'],['broadcast','','الإعلانات'],
  ['issues','','البلاغات'],['logbook','','سجل الشفت'],['timeline','','قصة اليوم'],['ptt','','التخاطب الصوتي'],['digest','','تقرير إغلاق اليوم'],['ocanalytics','','مركز التحليلات'],['analytics','','التحليلات'],['hours','','سجل الساعات'],['employees','','الموظفات'],['shifts','','الشفتات'],['roster','','جدولة تلقائية'],
  ['types','','أنواع الشفتات'],['areas','','المناطق'],['tables','','خريطة الطاولات'],['templates','','قوالب المهام'],
  ['tasks','','مهام اليوم'],['prep','','محطة التحضير'],['ops','','الجاهزية والسلامة'],['attendance','','الحضور'],['skills','','المهارات'],
  ['training','','التدريب'],['sops','','أدلة العمل'],['cover','','تبديل وتغطية'],['absence','','الغياب والتغطية'],['coop','','التعاون'],
  ['contrib','','المساهمات الإضافية'],['evals','','التقييم الشهري'],['awards','','التقدير'],['requests','','الطلبات'],
  ['handovers','','التسليمات'],['reports','','التقارير'],['devices','','الأجهزة'],['settings','','الإعدادات'],
  ['audit','','سجل التدقيق'],['flags','','إشارات المراجعة'],
  ['dayphase','','مرحلة اليوم'],['openshifts','','شفتات لم تُقفل'],['bottleneck','','عنق الزجاجة'],
  ['geo','','قرارات الموقع'],['errors','','أخطاء تقنية'],
  ['assignkpi','','كفاءة الإسناد'],['availability','','توفّر الموظفات']
];
function secTitle(k){ var t=''; SECS.forEach(function(s){ if(s[0]===k) t=s[2]; }); return t; }
var AGROUPS=[
  ['تشغيل اليوم','g1',['board','dayphase','ocdecisions','live','tables','bottleneck','heat','roster','shifts','tasks','prep','ops','attendance','openshifts','cover','absence','handovers','issues','logbook','timeline','ptt']],
  ['التواصل والتحليل','g2',['ocanalytics','digest','broadcast','analytics','hours','assignkpi','requests','reports']],
  ['الفريق','g2',['employees','availability','skills','training','coop','contrib','evals','awards']],
  ['الإعداد والجودة','g3',['types','areas','templates','sops','flags']],
  ['النظام','g4',['devices','settings','audit','geo','errors']]
];
function drawAdmin(){
  var v=$('#view'); if(!v) return;
  clearInterval(dashT);
  if(!S.adminSec){
    // خمس مجموعات مطوية بدل شبكة أزرار ضخمة — الأولى مفتوحة افتراضياً
    var menuHtml='<h3 style="margin:16px 2px 8px;font-size:14px;color:var(--muted)">الأقسام</h3>'+AGROUPS.map(function(g,gi){
      return '<details class="acc"'+(gi===0?' open':'')+'><summary>'+g[0]+'<span class="chev">‹</span></summary><div class="acc-body">'+
        g[2].map(function(k){
          var s=null; SECS.forEach(function(x){ if(x[0]===k) s=x; });
          if(!s) return '';
          return '<button data-sec="'+s[0]+'"><span class="ic">'+(MI[s[0]]||MI._def)+'</span>'+s[2]+'</button>';
        }).join('')+'</div></details>';
    }).join('');
    v.innerHTML='<div class="row" style="margin-bottom:10px"><input class="f grow" id="admQ" placeholder="بحث سريع: موظفة، شفت، طلب، بلاغ، مهمة، قسم..." autocomplete="off"></div><div id="admQR"></div>'+
      '<div id="dashTop">'+skel(2)+'</div>'+menuHtml;
    $$('.acc-body button',v).forEach(function(b){ b.addEventListener('click', function(){ S.adminSec=b.getAttribute('data-sec'); drawAdmin(); }); });
    // البحث الشامل — نتائج مجمّعة، النقر يفتح القسم المناسب
    (function(){
      var qEl=$('#admQ'), qr=$('#admQR'), qt=null;
      function go(sec){ S.adminSec=(sec&&ADMIN[sec])?sec:null; drawAdmin(); }
      qEl.addEventListener('input', function(){
        clearTimeout(qt); var q=qEl.value.trim();
        if(q.length<2){ qr.innerHTML=''; return; }
        qt=setTimeout(function(){
          // أقسام مطابقة (محلي) + نتائج الخادم
          var secHits=SECS.filter(function(s){ return s[2].indexOf(q)>-1; }).slice(0,4);
          aAct('admin_search',{q:q}).then(function(r){
            if(!r.ok || qEl.value.trim()!==q) return;
            var out=[];
            function grp(title, rows, fmt, sec){
              if(!rows||!rows.length) return;
              out.push('<div class="card" style="padding:9px 12px;margin-bottom:8px"><div class="muted small" style="font-weight:700;margin-bottom:4px">'+title+'</div>'+
                rows.map(function(x){ return '<button class="btn sm ghost block" data-qgo="'+sec+'" style="justify-content:flex-start;text-align:right;margin:2px 0">'+fmt(x)+'</button>'; }).join('')+'</div>');
            }
            if(secHits.length) grp('الأقسام', secHits, function(s){return esc(s[2]);}, '');
            secHits.forEach(function(){});
            grp('الموظفات', r.employees, function(x){return esc(x.name)+(x.active?'':' <span class="chip red">موقوفة</span>');}, 'employees');
            grp('شفتات هذا الأسبوع', r.shifts, function(x){return esc(x.employee)+' · '+fmtD(x.day)+(x.area?' · '+esc(x.area):'');}, 'shifts');
            grp('الطلبات', r.requests, function(x){return esc(x.employee)+' — '+esc(x.type)+' <span class="chip '+(x.status==='pending'?'orange':'')+'">'+(REQSTAT[x.status]||x.status)+'</span>';}, 'requests');
            grp('البلاغات', r.issues, function(x){return esc(x.title)+(x.reporter?' <span class="muted small">'+esc(x.reporter)+'</span>':'');}, 'issues');
            grp('مهام اليوم', r.tasks, function(x){return esc(x.name)+' — '+esc(x.employee);}, 'tasks');
            qr.innerHTML = out.length ? out.join('') : '<div class="card center muted small">لا نتائج لـ«'+esc(q)+'»</div>';
            // أزرار الأقسام المطابقة تفتح قسمها مباشرة
            var si=0;
            $$('[data-qgo]',qr).forEach(function(b){
              var sec=b.getAttribute('data-qgo');
              if(sec==='') { var s=secHits[si++]; b.addEventListener('click', function(){ go(s?s[0]:null); }); }
              else b.addEventListener('click', function(){ go(sec); });
            });
          }).catch(function(){});
        }, 300);
      });
    })();
    animIn(v);
    loadDash($('#dashTop'));
    // تحديث تلقائي للوحة اليوم كل دقيقة
    dashT=setInterval(function(){
      if(S.role==='admin' && !S.adminSec){ var d=$('#dashTop'); if(d) loadDash(d); }
      else clearInterval(dashT);
    }, 60000);
    return;
  }
  v.innerHTML='<div class="row" style="margin-bottom:10px"><button class="btn sm ghost" id="backB"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M9 6l6 6-6 6"/></svg> رجوع</button><h2 style="margin:0;font-size:18px">'+secTitle(S.adminSec)+'</h2></div><div id="sec"></div>';
  $('#backB').addEventListener('click', function(){ S.adminSec=null; drawAdmin(); });
  $('#sec').innerHTML=skel(3);
  animIn(v);
  var r=ADMIN[S.adminSec]; if(r) r($('#sec'));
}
function lookups(cb){
  var need=[];
  if(!A.emps) need.push(aAct('employees_list',{}).then(function(r){ A.emps=r.employees||[]; }));
  if(!A.areas) need.push(aAct('areas_list',{}).then(function(r){ A.areas=r.areas||r.rows||[]; }));
  if(!A.types) need.push(aAct('shift_types',{}).then(function(r){ A.types=r.types||r.rows||[]; }));
  Promise.all(need).then(cb);
}
function staffOpts(sel){ return (A.emps||[]).filter(function(e){return e.role==='staff'&&e.active;}).map(function(e){return '<option value="'+e.id+'"'+(sel===e.id?' selected':'')+'>'+esc(e.name)+'</option>';}).join(''); }
function areaOpts(sel){ return (A.areas||[]).map(function(a){return '<option value="'+a.id+'"'+(sel===a.id?' selected':'')+'>'+esc(a.name)+'</option>';}).join(''); }
function typeOpts(sel){ return (A.types||[]).map(function(t){return '<option value="'+t.id+'"'+(sel===t.id?' selected':'')+'>'+esc(t.name)+'</option>';}).join(''); }

/* ---------- لوحة اليوم ---------- */
var dashT=null;
/* شريط اليوم: شكل اليوم كاملاً — من حاضرة ومتى، وأين نحن الآن */
function drawDayTimeline(res){
  var el=$('#dashTL'); if(!el) return;
  var rows=(res.onshift||[]).slice(0,10);
  if(!rows.length){ el.innerHTML=''; return; }
  var H0=7, H1=24, span=(H1-H0)*60;                       // نافذة اليوم 7ص → 12م
  function toMin(ts){ if(!ts) return null; var d=new Date(ts); return d.getHours()*60+d.getMinutes(); }
  function pctOf(m){ return Math.max(0, Math.min(100, ((m-H0*60)/span)*100)); }
  var now=new Date(), nowM=now.getHours()*60+now.getMinutes();
  var html='<h3 style="margin:4px 2px 8px">شريط اليوم <span class="muted small" style="font-weight:400">الحضور مقابل المخطط</span></h3>'+
    '<div class="cc-tl"><div class="cc-tl-now" style="inset-inline-start:calc(70px + (100% - 82px) * '+(pctOf(nowM)/100).toFixed(3)+')"></div>';
  rows.forEach(function(o){
    var s=toMin(o['in']), e=o.out?toMin(o.out):(o['in']?nowM:null);
    var seg='';
    if(s!=null && e!=null && e>s){
      var a=pctOf(s), b=pctOf(e);
      seg='<i style="inset-inline-start:'+a+'%;width:'+Math.max(2,(b-a))+'%"></i>';
    } else {
      seg='<i class="pend" style="inset-inline-start:0;width:100%"></i>';
    }
    html+='<div class="cc-tl-row"><div class="cc-tl-name">'+esc(o.name||'')+'</div>'+
      '<div class="cc-tl-track">'+seg+'</div></div>';
  });
  html+='<div class="cc-tl-axis"><span>٧ص</span><span>١٢ظ</span><span>٥م</span><span>١٢م</span></div></div>';
  el.innerHTML=html;
}
/* لوحة محرك الإسناد: ما قرره المحرك أولاً، وما يحتاج قرار المالك فقط */
var FAILAR={not_present:'غير حاضرة',shift_ended:'انتهى شفتها',absent:'غائبة اليوم',
  has_other_active:'مشغولة بمهمة',active_non_interruptible:'مهمتها لا تُقاطع',
  not_in_zone:'خارج مناطقها',exclusive_conflict:'تعارض منطقة حصرية',
  missing_skill:'ينقصها المهارة',task_blocked:'المهمة موقوفة بمانع',
  task_not_open:'المهمة ليست مفتوحة',day_finalized:'اليوم مُقفل'};
function loadAssignBoard(el){
  aAct('wf_exceptions',{}).then(function(b){
    if(!b || !b.ok) return;
    var k=b.kpi||{}, need=b.needs_owner||[], auto=b.auto_today||[], ovr=b.overrides_today||[];
    var ae=$('#ccAuto'); if(ae) ae.textContent='الإسناد: '+auto.length+' تلقائي'+(need.length?' · '+need.length+' معلّق':'');
    if(need.length){ var hero=$('#ccHero'); if(hero && !hero.classList.contains('bad')) hero.classList.add('warn'); }
    var pct=function(x){ return x==null?'—':Math.round(x*100)+'٪'; };
    var h='<h3 style="margin:2px 2px 8px">محرك الإسناد اليوم <span class="muted small" style="font-weight:400">يوزّع تلقائياً — تتدخّلين في الاستثناء فقط</span></h3>';
    h+='<div class="card" style="padding:12px 14px"><div class="row" style="flex-wrap:wrap;gap:6px">'+
       '<span class="chip green">أسند تلقائياً: '+auto.length+'</span>'+
       '<span class="chip'+(need.length?' orange':'')+'">ينتظر قرارك: '+need.length+'</span>'+
       '<span class="chip'+(k.unassigned_critical_tasks?' red':'')+'">حرجة بلا مرشحة: '+(k.unassigned_critical_tasks||0)+'</span>'+
       '<span class="chip'+(k.manual_rate_breached?' red':'')+'">إسناد يدوي: '+pct(k.manual_assignment_rate)+'</span>'+
       '<span class="chip">نجاح المحرك: '+pct(k.auto_assignment_success_rate)+'</span>'+
       (k.time_to_assignment_sec!=null?'<span class="chip">زمن الإسناد: '+Math.round(k.time_to_assignment_sec)+'ث</span>':'')+
       '</div>'+
       (k.manual_rate_breached?'<div class="muted small" style="margin-top:6px;color:var(--red)">نسبة الإسناد اليدوي تجاوزت الهدف ('+pct(k.manual_assignment_target)+') — المحرك لا يغطي التشغيل كما ينبغي.</div>':'')+
       '</div>';
    if(need.length){
      h+='<h3 style="margin:14px 2px 8px">تحتاج قرارك ('+need.length+')</h3>'+need.map(function(u){
        var ex=(u.excluded||[]).map(function(x){
          var f=(x.fails||[]).map(function(c){return FAILAR[c]||c;})[0]||'—';
          return esc(x.name)+': '+f; }).join(' · ');
        var alt=u.best_alternative||{};
        return '<div class="card" style="padding:11px 13px;border-inline-start:3px solid var('+(u.critical?'--red':'--amber')+')">'+
          '<div class="row" style="justify-content:space-between"><b>'+esc(u.task||'مهمة')+'</b>'+
            (u.critical?'<span class="chip red">حرجة</span>':'')+'</div>'+
          '<div class="muted small" style="margin-top:3px">'+esc(u.area||'')+(u.waiting_min!=null?' · منتظرة '+u.waiting_min+'د':'')+'</div>'+
          '<div class="small" style="margin-top:6px"><b>لماذا توقف المحرك:</b> لا مرشحة اجتازت الشروط</div>'+
          (ex?'<div class="muted small" style="margin-top:2px">المستبعدات: '+ex+'</div>':'')+
          (alt.name?'<div class="muted small" style="margin-top:2px">أقرب بديل: '+esc(alt.name)+' — '+esc(alt.blocker||'')+'</div>':'')+
          '<div class="small" style="margin-top:6px"><b>الموصى به:</b> '+esc(u.recommended||'')+'</div>'+
          '<div class="btnrow" style="margin-top:8px"><button class="btn sm" data-exass="'+u.task_id+'" data-exname="'+esc(u.task||'')+'">إسناد يدوي</button>'+
          '<button class="btn sm ghost" data-exskip="'+u.id+'">تأجيل</button></div></div>';
      }).join('');
    } else {
      h+='<div class="card" style="padding:11px 13px"><div class="small">لا شيء ينتظر قرارك — المحرك يغطي التشغيل ✔</div></div>';
    }
    if(ovr.length){
      h+='<h3 style="margin:14px 2px 8px">تدخّلاتك اليوم ('+ovr.length+')</h3>'+ovr.map(function(o){
        return '<div class="card" style="padding:10px 12px"><div class="small"><b>'+esc(o.task||'')+'</b> → '+esc(o.employee||'')+'</div>'+
          '<div class="muted small">سببك: '+esc(o.reason||'')+(o.engine_choice?' · اختيار المحرك كان: '+esc(o.engine_choice):'')+'</div></div>';
      }).join('');
    }
    el.insertAdjacentHTML('afterbegin', h);
    $$('[data-exskip]',el).forEach(function(bt){ bt.addEventListener('click',function(){
      aAct('wf_exception_resolve',{id:+bt.getAttribute('data-exskip'),resolution:'deferred_by_owner'})
        .then(function(){ toast('أُجّلت'); var dt=$('#dashTop'); if(dt) loadDash(dt); }); }); });
    $$('[data-exass]',el).forEach(function(bt){ bt.addEventListener('click',function(){
      var tid=+bt.getAttribute('data-exass');
      lookups(function(){
        sheet('إسناد يدوي: '+bt.getAttribute('data-exname'),
          '<label class="f">الموظفة</label><select class="f" id="exE">'+staffOpts()+'</select>'+
          '<label class="f">سبب التدخل (إلزامي)</label><input class="f" id="exR" placeholder="مثال: لا بديل والمهمة لا تحتمل التأجيل">'+
          '<div class="muted small">يُحفظ سببك بجانب قرار المحرك ولا يُلغيه.</div>'+
          '<div class="btnrow"><button class="btn block" id="exGo">تأكيد</button></div>',
          function(ov,close){
            $('#exGo',ov).addEventListener('click',function(){
              var r=$('#exR',ov).value.trim();
              if(r.length<3){ toast('اكتبي سبب التدخل',true); return; }
              busyWrap(this,function(){
                return aAct('task_reassign',{id:tid,employee_id:+$('#exE',ov).value,reason:r}).then(function(res){
                  if(!res.ok){ toast(res.error||'خطأ',true); return; }
                  close(); toast('أُسندت ✔'); var dt=$('#dashTop'); if(dt) loadDash(dt);
                });
              });
            });
          });
      });
    }); });
  }).catch(function(){});
}
function loadDash(v){
  Promise.all([aAct('dashboard',{}), aAct('tasks_day',{day:today()}).catch(function(){return {tasks:[]};})]).then(function(rs){
    var res=rs[0], tks=(rs[1]&&rs[1].tasks)||[];
    if(!res.ok){ v.innerHTML='<div class="empty">'+esc(res.error||'خطأ')+'</div>'; return; }
    if(!v.isConnected) return;
    var out=[];
    var onshift=res.onshift||[], inN=onshift.filter(function(o){return o['in']&&!o.out;}).length;
    var notIn=onshift.filter(function(o){return !o['in'];}).length;
    var doneN=tks.filter(function(t){return t.status==='done'||t.status==='approved';}).length;
    var highN=(res.alerts||[]).filter(function(a){return a.sev==='high';}).length;
    var alN=(res.alerts||[]).length;
    var SVG_PPL='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c1-3.2 3.4-4.6 6-4.6s5 1.4 6 4.6" stroke-linecap="round"/></svg>';
    var SVG_CLK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" stroke-linecap="round"/></svg>';
    var SVG_CHK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M9 12l2 2 4-4M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var SVG_ALERT='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 8v5M12 16h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    /* شريط حالة الفرع الحيّ (يُملأ من wf_status) + بطاقات KPI */
    /* رأس الحالة: يجيب سؤالاً واحداً — هل الفرع بخير الآن؟ */
    var ccCls = highN ? 'bad' : (alN||notIn) ? 'warn' : '';
    var ccTxt = highN ? 'الفرع يحتاج تدخّلك الآن'
              : (alN||notIn) ? 'الفرع يعمل — مع نقاط تحتاج انتباهك'
              : 'الفرع بخير — لا شيء يحتاج قرارك';
    var ccSub = highN ? (highN+' حالة حرجة بانتظار قرارك')
              : alN ? (alN+' نقطة تحتاج مراجعة'+(notIn?' · '+notIn+' لم تحضر بعد':''))
              : (notIn ? notIn+' لم تحضر بعد' : 'الحضور والمهام تسير كما هو مخطط');
    out.push('<div class="cc-hero '+ccCls+'" id="ccHero">'+
      '<div class="cc-state">'+ccTxt+'</div><div class="cc-sub">'+ccSub+'</div>'+
      '<div class="cc-facts">'+
        '<span class="cc-fact">حاضرات '+inN+'</span>'+
        '<span class="cc-fact">مهام '+doneN+'/'+tks.length+'</span>'+
        (alN?'<span class="cc-fact">قرارات '+alN+'</span>':'')+
        '<span class="cc-fact" id="ccBand">الضغط —</span>'+
        '<span class="cc-fact" id="ccAuto">الإسناد —</span>'+
      '</div></div>');
    out.push('<div class="kgrid">'+
      '<button class="kcard good" data-go="attendance"><div class="kl">'+SVG_PPL+'حاضرات الآن</div><div class="kv">'+inN+'</div><div class="ks">على الشفت الآن</div></button>'+
      '<button class="kcard'+(notIn?' warn':'')+'" data-go="attendance"><div class="kl">'+SVG_CLK+'لم تحضر بعد</div><div class="kv">'+notIn+'</div><div class="ks">من المجدولات</div></button>'+
      '<button class="kcard'+(tks.length&&doneN<tks.length?' warn':' ok')+'" data-go="tasks"><div class="kl">'+SVG_CHK+'مهام اليوم</div><div class="kv">'+doneN+'<span style="font-size:16px;color:var(--muted);font-weight:700">/'+tks.length+'</span></div><div class="ks">'+(tks.length?Math.round(100*doneN/tks.length)+'٪ إنجاز':'لا مهام')+'</div></button>'+
      '<button class="kcard'+(highN?' bad':(alN?' warn':''))+'" data-go="#alerts"><div class="kl">'+SVG_ALERT+'يحتاج قراراً</div><div class="kv">'+alN+'</div><div class="ks">'+(highN?highN+' حرجة':'لا حرجة')+'</div></button>'+
    '</div>');
    out.push('<div class="cc-grid">');
    /* شريط اليوم الزمني — شكل اليوم لا لقطة منه */
    out.push('<section class="cc-sec"><div id="dashTL"></div></section>');
    /* الفريق الآن — بطاقات حالة مختصرة */
    out.push('<section class="cc-sec"><h3 style="margin:4px 2px 8px">الفريق الآن</h3>');
    if(!(res.onshift||[]).length) out.push('<div class="card center muted small">لا شفتات اليوم</div>');
    else out.push('<div class="list">'+res.onshift.map(function(o){
      var stB = o.out ? '<span class="badge badge--muted">انصرفت</span>'
              : o['in'] ? '<span class="badge badge--success">على الشفت</span>'
              : '<span class="badge badge--warn">لم تحضر</span>';
      return '<div class="row"><div class="row__avatar">'+esc((o.name||'؟').charAt(0))+'</div>'+
        '<div class="row__body"><div class="row__title">'+esc(o.name)+'</div>'+
        '<div class="row__sub">'+esc(o.area||'بلا منطقة')+(o['in']?' · دخلت '+fmtT(o['in']):'')+'</div></div>'+stB+'</div>';
    }).join('')+'</div>');
    out.push('</section>');
    var al=res.alerts||[];
    out.push('<section class="cc-sec"><h3 id="alertsH" style="margin:12px 2px 8px">يحتاج قراراً ('+al.length+')</h3>');
    if(!al.length) out.push('<div class="card center muted">كل شيء تحت السيطرة ✔</div>');
    al.sort(function(a,b){return (a.sev==='high'?0:1)-(b.sev==='high'?0:1);}).forEach(function(a){
      out.push('<div class="card decision" style="padding:12px 14px'+(a.sev==='high'?';border-inline-start-color:var(--red)':'')+'"><b>'+esc(a.what)+'</b>'+
        (a.impact?'<div class="muted small" style="margin-top:2px">الأثر: '+esc(a.impact)+'</div>':'')+
        (a.action?'<div class="btnrow"><button class="btn sm" data-go="'+esc(mapAction(a.action))+'">فتح واتخاذ قرار</button></div>':'')+'</div>');
    });
    out.push('</section>');
    /* مرحلة اليوم + قرارات المحرك (RCOS Workflow) */
    out.push('<section class="cc-sec"><div id="dashWf"></div></section>');
    /* الحالة التشغيلية المستنتَجة + تركّز المهارات (محرك RCOS) */
    out.push('<section class="cc-sec"><div id="dashEngine"></div></section>');
    /* طابور مراجعة النزاهة — حالات مشبوهة فقط */
    out.push('<section class="cc-sec"><div id="dashIntegrity"></div></section>');
    /* ضغط المناطق — من آخر تحديث لكل منطقة اليوم */
    var prs=res.pressure||[];
    if(prs.length){
      out.push('<section class="cc-sec"><h3 style="margin:12px 2px 8px">ضغط المناطق</h3><div class="list">'+prs.map(function(p){
        var lvl = p.support ? '<span class="badge badge--danger">تحتاج دعماً</span>'
                : p.waiting==='high' ? '<span class="badge badge--warn">انتظار مرتفع</span>'
                : (p.occupied>=p.tables*0.8) ? '<span class="badge badge--warn">شبه ممتلئة</span>'
                : '<span class="badge badge--success">طبيعي</span>';
        return '<div class="row"><div class="row__body"><div class="row__title">'+esc(p.area)+'</div>'+
          '<div class="row__sub num">'+(p.occupied||0)+'/'+(p.tables||0)+' طاولة · آخر تحديث '+fmtT(p.ts)+'</div></div>'+lvl+'</div>';
      }).join('')+'</div></section>');
    }
    out.push('<section class="cc-sec"><h3 style="margin:12px 2px 8px">آخر الأحداث <button class="btn sm ghost" data-go="timeline" style="float:left">عرض الكل</button></h3><div id="dashEv" class="list"><div class="row"><div class="row__body muted small">جارٍ التحميل…</div></div></div></section>');
    out.push('</div>');
    v.innerHTML=out.join('');
    drawDayTimeline(res);
    /* الحالة التشغيلية المستنتَجة + تركّز المهارات (محرك RCOS — بلا إدخال يدوي) */
    aAct('wf_engine',{}).then(function(eng){
      var el=$('#dashEngine'); if(!el||!eng.ok) return;
      var ZST={stable:{t:'مستقرة',c:'green'},under_observation:{t:'تحت الملاحظة',c:''},needs_attention:{t:'تحتاج انتباه',c:'orange'},unverified:{t:'غير مؤكَّدة',c:''},handover_pending:{t:'بانتظار تسليم',c:'orange'},critical:{t:'حرجة',c:'red'}};
      var zones=eng.zones||[], zhtml='';
      if(zones.length){
        zhtml='<h3 style="margin:14px 2px 8px">خريطة المناطق <span class="muted small" style="font-weight:400">نتيجة تشغيل لا عدد مهام</span></h3><div class="cc-tiles">'+
          zones.map(function(z){
            var s=ZST[z.state]||{t:z.state,c:''};
            var cls = s.c==='red'?'bad' : s.c==='orange'?'warn' : s.c==='green'?'ok' : '';
            var cf = z.confidence!=null?Math.round(z.confidence*100):0;
            return '<button class="cc-tile '+cls+'" data-zmanage="'+z.area_id+'" data-zname="'+esc(z.area)+'">'+
              '<div class="cc-tname">'+esc(z.area)+'</div>'+
              '<div class="cc-tmeta">'+s.t+(z.owner?'<br>'+esc(z.owner):'')+'</div>'+
              '<div class="cc-bar '+(cf<50?'bad':cf<80?'warn':'')+'"><i style="width:'+cf+'%"></i></div>'+
              '<div class="cc-tmeta" style="margin-top:3px">ثقة '+cf+'٪</div></button>';
          }).join('')+'</div>';
      }
      var bc=(eng.snapshot&&eng.snapshot.business_context)||{}, comp=bc.components||{};
      var ROLEAR={cashier:'الكاشير',barista:'الباريستا',floor_service:'خدمة الصالة',table_service:'تجهيز الطاولات',bussing:'ترتيب الطاولات',kitchen_support:'دعم المطبخ',hookah:'الأراجيل',cleaning:'التنظيف',opening:'الافتتاح',closing:'الإغلاق'};
      /* الضغط بلا دقة زائفة: نطاق نصّي + مصدر + ثقة + الأدلة التي بُني عليها */
      var SRCAR={estimated:'تقديري',observed:'ملاحَظ',mixed:'مختلط',none:'—'};
      var CONFAR={low:'منخفضة',medium:'متوسطة',high:'مرتفعة',none:'—'};
      var bandTxt={high:'ضغط مرتفع',medium:'ضغط متوسط',calm:'هادئ',unknown:'غير معروف'}[bc.band]||'—';
      var bandCls=bc.band==='high'?'red':bc.band==='medium'?'orange':(bc.band==='calm'?'green':'');
      var enough=(bc.sufficient!==false);
      var ago=bc.last_evidence_at?Math.max(0,Math.round((Date.now()-new Date(bc.last_evidence_at))/60000)):null;
      var html=zhtml+'<h3 style="margin:14px 2px 8px">الحالة التشغيلية <span class="muted small" style="font-weight:400">مستنتَجة — لا مقيسة</span></h3>';
      if(!enough){
        html+='<div class="card" style="padding:12px 14px;border-inline-start:3px solid var(--muted)">'+
          '<b>لا توجد بيانات كافية</b>'+
          '<div class="muted small" style="margin-top:4px">لم تصل أي إشارة تشغيلية. الصمت ليس هدوءاً — قد يكون الفرع مزدحماً والنظام لا يعلم.</div>'+
          '<div class="muted small" style="margin-top:4px">المصدر الوحيد المتاح اليوم هو حركة المهام وطلبات المساعدة.</div></div>';
      } else {
        html+='<div class="card" style="padding:12px 14px">'+
          '<div class="row" style="justify-content:space-between"><b>'+bandTxt+'</b>'+
            '<span class="chip '+bandCls+'">ثقة '+(CONFAR[bc.confidence_level]||'—')+'</span></div>'+
          '<div class="muted small" style="margin-top:4px">المصدر: '+(SRCAR[bc.source]||'—')+
            (ago!=null?' · آخر دليل قبل '+ago+' د':'')+'</div>'+
          ((bc.reasons&&bc.reasons.length)?'<div style="margin-top:8px"><div class="small"><b>بُني على:</b></div>'+
            '<ul class="muted small" style="margin:4px 0 0;padding-inline-start:18px">'+
            bc.reasons.map(function(r){return '<li>'+esc(r)+'</li>';}).join('')+'</ul></div>':'')+
          '</div>';
      }
      var conc=(eng.concentration||[]).filter(function(x){return x.risk&&x.risk!=='ok';});
      if(conc.length){
        html+='<h3 style="margin:14px 2px 8px">تركّز المهارات <span class="muted small" style="font-weight:400">(bus-factor)</span></h3>'+conc.map(function(x){
          var t=x.risk==='single_point'?'نقطة تعطّل وحيدة':'تركّز عالٍ';
          return '<div class="card" style="padding:10px 12px;border-inline-start:3px solid var('+(x.risk==='single_point'?'--red':'--amber')+')"><div class="small"><b>'+esc(ROLEAR[x.role]||x.role)+'</b> — '+t+'</div>'+
            '<div class="muted small" style="margin-top:2px">يؤدّيه غالبًا شخص واحد ('+Math.round((x.top_share||0)*100)+'٪ من التنفيذ) — يُنصح بتدريب زميلة لتوزيع الاعتماد.</div></div>';
        }).join('');
      }
      var self=(eng.selfeval||[]);
      if(self.length){
        html+='<h3 style="margin:14px 2px 8px">تقييم النظام لنفسه <span class="muted small" style="font-weight:400">خلل نظاميّ لا فردي</span></h3>'+self.map(function(f){
          return '<div class="card" style="padding:10px 12px;border-inline-start:3px solid var('+(f.severity==='warn'?'--amber':'--brand')+')"><div class="small"><b>'+esc(f.title)+'</b>'+(f.affected?' <span class="muted">('+f.affected+' موظفات)</span>':'')+'</div>'+
            '<div class="muted small" style="margin-top:2px">'+esc(f.detail||'')+'</div></div>';
        }).join('');
      }
      var mg=(eng.settings&&eng.settings.min_gap_min)||5;
      html+='<h3 style="margin:14px 2px 8px">إعدادات سريعة</h3>'+
        '<div class="card" style="padding:12px 14px"><label class="f" style="margin-top:0">أقل مدة بين إنجاز مهمتين (دقائق)</label>'+
        '<div class="row" style="gap:8px"><input class="f" id="mgInput" type="number" min="0" value="'+mg+'" style="margin:0"><button class="btn sm" id="mgSave" style="white-space:nowrap">حفظ</button></div>'+
        '<div class="muted small" style="margin-top:6px">تُطبَّق على المهام والدوّارات معًا.</div></div>';
      el.innerHTML=html;
      var bandEl=$('#ccBand'); if(bandEl) bandEl.textContent = enough ? ('الضغط: '+bandTxt) : 'الضغط: لا بيانات';
      loadAssignBoard(el);
      var mgs=$('#mgSave',el); if(mgs) mgs.addEventListener('click',function(){ var m=+$('#mgInput',el).value; if(!(m>=0))m=0; aAct('cfg_set',{key:'integrity.min_completion_gap_sec',value:m*60}).then(function(r){ toast(r.ok?'حُفظ ✔':(r.error||'خطأ'),!r.ok); }); });
      $$('[data-zmanage]',el).forEach(function(b){ b.addEventListener('click',function(){
        var aid=+b.getAttribute('data-zmanage'), an=b.getAttribute('data-zname');
        var cur=(zones||[]).filter(function(z){return z.area_id===aid;})[0]||{};
        lookups(function(){
          sheet('إدارة منطقة: '+an,
            '<label class="f">المسؤولة عن المنطقة</label><select class="f" id="zEmp">'+staffOpts()+'</select>'+
            '<label class="f">المدّة (دقائق)</label><input class="f" id="zMin" type="number" value="'+(cur.owner_min||30)+'">'+
            '<label class="f">أعمال المنطقة (سطر لكل عمل)</label><textarea class="f" id="zWorks" rows="4">'+esc((cur.works||[]).join('\n'))+'</textarea>'+
            '<div class="btnrow"><button class="btn block" id="zSave">حفظ وإسناد</button></div>',
            function(ov,close){
              $('#zSave',ov).addEventListener('click',function(){
                var emp=+$('#zEmp',ov).value, m=+$('#zMin',ov).value||30;
                var works=$('#zWorks',ov).value.split('\n').map(function(x){return x.trim();}).filter(Boolean);
                Promise.all([aAct('wf_zone_assign',{area_id:aid,employee_id:emp,minutes:m}),aAct('zone_works_set',{area_id:aid,works:works})]).then(function(){ toast('حُفظ ✔'); close(); var dt=$('#dashTop'); if(dt) loadDash(dt); });
              });
            });
        });
      }); });
    }).catch(function(){});
    /* طابور مراجعة النزاهة — يظهر فقط عند وجود حالات مشبوهة */
    aAct('wf_integrity',{}).then(function(iq){
      var el=$('#dashIntegrity'); if(!el||!iq.ok) return;
      var rows=iq.rows||[]; if(!rows.length){ el.innerHTML=''; return; }
      el.innerHTML='<h3 style="margin:14px 2px 8px">مراجعة النزاهة <span class="chip orange">'+rows.length+'</span> <span class="muted small" style="font-weight:400">وقائع للمراجعة لا أحكام</span></h3>'+
        rows.slice(0,8).map(function(r){
          return '<div class="card" style="padding:10px 12px;border-inline-start:3px solid var(--amber)"><div class="row" style="justify-content:space-between"><div class="small"><b>'+esc(r.employee||'؟')+'</b> — '+esc(r.task||'دوّارة')+'</div><span class="muted small num">'+fmtT(r.ts)+'</span></div>'+
            '<div class="muted small" style="margin-top:2px">سُجِّل إنجاز بفارق قصير جدًا عن السابق — تحقّقي من التنفيذ الفعلي.</div></div>';
        }).join('');
    }).catch(function(){});
    /* مرحلة التشغيل + قرارات المحرك مع إمكانية التجاوز الموثق */
    Promise.all([aAct('wf_status',{}), aAct('wf_decisions',{})]).then(function(rs){
      var wfEl=$('#dashWf'); if(!wfEl) return;
      var wst=rs[0]||{}, dec=(rs[1]&&rs[1].rows)||[];
      var phTxt=WFPH[wst.phase]||wst.phase||'';
      var prLvl=+wst.pressure||0;
      var prTxt = prLvl>=2 ? 'ضغط مرتفع' : prLvl===1 ? 'ضغط خفيف' : 'هادئ';
      /* شريط حالة الفرع الحيّ — المرحلة + الضغط + منذ متى */
      var bb=$('#branchBar');
      if(bb){
        bb.innerHTML='<span class="bpulse"></span><div class="binfo"><b>'+(phTxt?esc(phTxt):'الفرع يعمل')+'</b>'+
          '<div class="bmeta">'+(wst.since?'منذ '+fmtT(wst.since)+' · ':'')+'يُدار آليًا حسب الحضور والضغط والوقت</div></div>'+
          '<span class="bchip">'+esc(prTxt)+'</span>';
      }
      var h='';
      if(dec.length){
        h+='<h3 style="margin:12px 2px 8px">قرارات المحرك اليوم ('+dec.length+')</h3>'+dec.slice(0,5).map(function(x){
          return '<div class="card" style="padding:10px 12px"><div class="small"><b>'+esc(x.task||x.kind)+'</b>'+(x.employee?' — '+esc(x.employee):'')+'</div>'+
            '<div class="muted small" style="margin-top:2px">'+esc(x.explanation)+'</div>'+
            '<div class="row" style="justify-content:space-between;margin-top:5px"><span class="muted small num">'+fmtT(x.ts)+'</span>'+
            (x.override_actor?'<span class="chip orange">تجاوزه المالك</span>':'<button class="btn sm ghost" data-wfov="'+x.id+'">تجاوز مع سبب</button>')+'</div></div>';
        }).join('');
      }
      wfEl.innerHTML=h;
      $$('[data-wfov]',wfEl).forEach(function(b){ b.addEventListener('click', function(){
        inputSheet('تجاوز قرار المحرك','سبب التجاوز (يُحفظ مع القرار الأصلي)','مثال: أعرف ظرف الموظفة اليوم','تسجيل التجاوز',function(reason){
          aAct('wf_override',{id:+b.getAttribute('data-wfov'), reason:reason}).then(function(r){ if(r.ok){ toast('سُجّل التجاوز ✔'); } else toast(r.error||'خطأ',true); });
        });
      });});
    }).catch(function(){});
    /* آخر ٨ أحداث مهمة من قصة اليوم */
    aAct('timeline',{day:today()}).then(function(tl){
      var evEl=$('#dashEv'); if(!evEl||!tl.ok) return;
      var KIND2={in:'حضور',out:'انصراف',task:'مهمة',recurring:'دوّارة',help:'مساعدة',issue:'بلاغ',miss:'فحص فائت'};
      var ev=(tl.events||[]).slice().sort(function(a,b){return new Date(b.ts)-new Date(a.ts);}).slice(0,8);
      evEl.innerHTML = ev.length ? ev.map(function(e){
        return '<div class="row"><div class="row__body"><div class="row__title" style="font-size:14px">'+(e.who?'<b>'+esc(e.who)+'</b> — ':'')+esc(e.text)+'</div>'+
          '<div class="row__sub num">'+fmtT(e.ts)+(KIND2[e.kind]?' · '+KIND2[e.kind]:'')+'</div></div></div>';
      }).join('') : '<div class="row"><div class="row__body muted small">لا أحداث بعد اليوم</div></div>';
    }).catch(function(){});
    aAct('briefing',{}).then(function(bf){ var w=$('#briefWrap'); if(!w||!bf.ok) return;
      w.innerHTML='<div class="card" style="background:var(--hero);color:var(--on-hero);border:none"><h3 style="color:var(--on-hero);display:flex;gap:8px;align-items:center">'+brandMark(26)+' موجز اليوم</h3>'+
        (bf.lines||[]).map(function(l){ return '<div style="padding:3px 0;font-size:14px;opacity:.95">• '+esc(l)+'</div>'; }).join('')+'</div>';
    }).catch(function(){});
    // شارات العدادات على أزرار الأقسام
    var bc={};
    (res.alerts||[]).forEach(function(a2){ var s2=mapAction(a2.action||''); if(s2 && s2!=='dash') bc[s2]=(bc[s2]||0)+1; });
    $$('.acc-body button').forEach(function(mb){
      var s2=mb.getAttribute('data-sec');
      var old=mb.querySelector('.n'); if(old) old.remove();
      if(bc[s2]) mb.insertAdjacentHTML('beforeend','<span class="n">'+bc[s2]+'</span>');
    });
    $$('[data-go]',v).forEach(function(b){ b.addEventListener('click', function(){
      var sec=b.getAttribute('data-go');
      if(sec==='#alerts'){ var h=$('#alertsH'); if(h) h.scrollIntoView({behavior:'smooth'}); return; }
      // الأقسام غير المعروفة أو «dash» ترجع للوحة الرئيسية بدل شاشة معلقة
      S.adminSec = (sec && ADMIN[sec]) ? sec : null;
      drawAdmin();
    }); });
  });
}
function mapAction(a){ return {absence:'absence',pressure:'reports',skills:'skills',breaks:'attendance',tasks:'tasks',handovers:'handovers',requests:'requests',attendance:'attendance',training:'training',flags:'flags',coverage:'absence'}[a]||'dash'; }

var ADMIN={};

/* ---------- مركز القرارات + الحوادث (المجلد الرابع) ---------- */
ADMIN.ocdecisions=function(v){
  var SEVL={critical:{t:'حرج',c:'red'},warning:{t:'تحذير',c:'orange'},info:{t:'معلومة',c:''},emergency:{t:'طارئ',c:'red'}};
  var STL={open:'جديد',approved:'اعتُمد',postponed:'مؤجَّل',dismissed:'مُستبعَد',overridden:'تجاوزته المالكة',info_requested:'طلب توضيح'};
  function incCard(x){ var s=SEVL[x.severity]||SEVL.info;
    return '<div class="card" style="padding:10px 12px;border-inline-start:4px solid var(--'+(s.c||'line')+')"><div class="row" style="justify-content:space-between"><b>'+esc(x.type)+'</b><span class="chip '+s.c+'">'+s.t+'</span></div>'+
      '<div class="muted small" style="margin-top:2px">'+esc(x.affected||'')+' · منذ '+fmtT(x.since)+(x.auto_close?'':' · لا يُغلق تلقائياً')+'</div></div>'; }
  function decCard(x){ var s=SEVL[x.severity]||SEVL.info, acts='';
    if(x.needs_action){ acts='<div class="btnrow" style="margin-top:8px">'+
      '<button class="btn sm" data-ocd="approve" data-id="'+x.id+'">اعتماد</button>'+
      '<button class="btn sm ghost" data-ocd="override" data-id="'+x.id+'" data-to="'+esc(x.to_state||'')+'">تجاوز مع سبب</button>'+
      '<button class="btn sm ghost" data-ocd="postpone" data-id="'+x.id+'">تأجيل</button>'+
      '<button class="btn sm ghost" data-ocd="dismiss" data-id="'+x.id+'">استبعاد</button></div>'; }
    else { acts='<div class="muted small" style="margin-top:6px">الحالة: '+(STL[x.oc_status]||x.oc_status)+(x.override_reason?' — «'+esc(x.override_reason)+'»':'')+'</div>'; }
    return '<div class="card decision" style="padding:12px'+(x.severity==='critical'?';border-inline-start-color:var(--red)':x.severity==='warning'?';border-inline-start-color:var(--amber)':'')+'">'+
      '<div class="row" style="justify-content:space-between"><b>'+esc(x.type_label)+'</b><span class="chip '+s.c+'">'+s.t+'</span></div>'+
      '<div style="margin-top:3px;font-size:14px">'+esc(x.affected||'')+(x.employee?' · '+esc(x.employee):'')+'</div>'+
      '<div class="muted small" style="margin-top:4px">التوصية: '+esc(x.recommendation||'')+'</div>'+
      '<div class="muted small">الأثر المتوقع: '+esc(x.impact||'')+'</div>'+
      '<div class="muted small num" style="margin-top:2px">'+fmtT(x.ts)+'</div>'+acts+'</div>'; }
  function wire(scope){ $$('[data-ocd]',scope).forEach(function(b){ b.addEventListener('click',function(){
      var act=b.getAttribute('data-ocd'), id=+b.getAttribute('data-id');
      if(act==='approve'){ confirmSheet('اعتماد التوصية','هل تعتمدين توصية المحرك كما هي؟','اعتماد',function(){ aAct('oc_decide',{id:id,act:'approve'}).then(function(r){ if(r.ok){toast('اعتُمد ✔');load();} else toast(r.error||'خطأ',true); }); }); }
      else if(act==='override'){ var to=b.getAttribute('data-to')||''; inputSheet('تجاوز القرار','السبب إلزامي — يُحفظ مع القرار الأصلي'+(to?' · الحالة الناتجة: '+to:''),'مثال: أعرف ظرف الموظفة اليوم','تسجيل التجاوز',function(reason){ if(!reason){toast('السبب إلزامي',true);return;} aAct('wf_override',{id:id,reason:reason}).then(function(r){ if(r.ok){toast('سُجّل التجاوز ✔');load();} else toast(r.error||'خطأ',true); }); }); }
      else if(act==='postpone'){ inputSheet('تأجيل القرار','حددي شرط أو وقت المراجعة','مثال: أراجعه بعد ساعة الذروة','تأجيل',function(reason){ if(!reason){toast('حددي شرط المراجعة',true);return;} aAct('oc_decide',{id:id,act:'postpone',reason:reason}).then(function(r){ if(r.ok){toast('أُجّل');load();} else toast(r.error||'خطأ',true); }); }); }
      else if(act==='dismiss'){ confirmSheet('استبعاد القرار','هل تستبعدين هذا القرار (لم يعد ذا صلة)؟','استبعاد',function(){ aAct('oc_decide',{id:id,act:'dismiss'}).then(function(r){ if(r.ok){toast('استُبعد');load();} else toast(r.error||'خطأ',true); }); },true); }
    }); }); }
  function load(){
    v.innerHTML='<div id="ocdInc"></div><div id="ocdBody">'+skel(3)+'</div>';
    Promise.all([aAct('oc_incidents',{}), aAct('oc_decisions',{})]).then(function(rs){
      var inc=rs[0]||{}, dec=rs[1]||{}, ie=$('#ocdInc'), irows=(inc.rows||[]);
      if(irows.length){ ie.innerHTML='<h3 style="margin:6px 2px 8px">حوادث الآن <span class="chip red">'+((inc.counts&&inc.counts.critical)||0)+' حرج</span> <span class="chip orange">'+((inc.counts&&inc.counts.warning)||0)+' تحذير</span></h3>'+irows.map(incCard).join(''); }
      else { ie.innerHTML='<div class="card center muted" style="padding:14px">لا حوادث نشطة الآن ✔</div>'; }
      var body=$('#ocdBody'), rows=(dec.rows||[]), pend=rows.filter(function(r){return r.needs_action;}), rest=rows.filter(function(r){return !r.needs_action;}), out=[];
      out.push('<h3 style="margin:14px 2px 8px">قرارات بحاجة إليكِ '+(pend.length?'<span class="chip red">'+pend.length+'</span>':'<span class="chip green">0</span>')+'</h3>');
      out.push(pend.length? pend.map(decCard).join('') : '<div class="card center muted" style="padding:12px">لا قرارات معلّقة الآن</div>');
      if(rest.length){ out.push('<details class="qa" style="margin-top:12px"><summary>قرارات المحرك الأخيرة <span class="chip">'+rest.length+'</span></summary><div class="qa-body">'+rest.map(decCard).join('')+'</div></details>'); }
      body.innerHTML=out.join(''); wire(body);
    }).catch(function(){ $('#ocdBody').innerHTML='<div class="empty">تعذّر جلب القرارات</div>'; });
  }
  load();
};

/* ---------- مركز التحليلات (المجلد الرابع) ---------- */
ADMIN.ocanalytics=function(v){
  var preset=7;
  function bar(label,val){ var col = val>=80?'':(val>=50?'var(--amber)':'var(--red)');
    return '<div style="margin:0 0 8px"><div class="row" style="justify-content:space-between;font-size:13px"><span>'+esc(label)+'</span><span class="num" style="font-weight:800">'+val+'</span></div>'+
      '<div class="pbar"><i style="width:'+Math.max(0,Math.min(100,val))+'%'+(col?';background:'+col:'')+'"></i></div></div>'; }
  function tile(label,val,sub,ins){ return '<div class="card" style="padding:10px 12px"><div class="muted small">'+esc(label)+'</div>'+
    '<div class="num" style="font-size:20px;font-weight:800">'+(ins?'—':esc(val))+'</div><div class="muted small">'+(ins?'بيانات غير كافية':esc(sub||''))+'</div></div>'; }
  function render(r){
    var h=r.health, c=h.components, out=[];
    var hc = h.score>=80?'green':h.score>=60?'':'orange', hl=h.score>=80?'جيد':h.score>=60?'مقبول':'يحتاج مراجعة';
    out.push('<div class="card" style="padding:14px"><div class="row" style="justify-content:space-between;align-items:flex-end">'+
      '<div><div class="muted small">مؤشر الصحة التشغيلية</div><div class="num" style="font-size:38px;font-weight:900;line-height:1">'+h.score+'<span style="font-size:15px;color:var(--muted)"> / 100</span></div></div>'+
      '<span class="chip '+hc+'">'+hl+'</span></div><div style="margin-top:12px">'+
      bar('كفاية الطاقم',c.staffing)+bar('إتمام المهام الحرجة',c.critical)+bar('زمن رفع الموانع',c.blocker)+bar('الحمل المتأخر',c.overdue)+bar('استقرار المراحل',c.phase)+
      '</div><div class="muted small" style="margin-top:6px">الفترة '+esc(r.period.from)+' → '+esc(r.period.to)+' · '+r.period.tasks+' مهمة (الملغاة مستثناة)</div></div>');
    if((r.findings||[]).length){ out.push('<h3 style="margin:14px 2px 8px">أهم الملاحظات</h3>'+r.findings.map(function(f){
      return '<div class="card decision" style="padding:10px 12px'+(f.severity==='warning'?';border-inline-start-color:var(--amber)':'')+'"><b>'+esc(f.text)+'</b>'+
        '<div class="muted small" style="margin-top:2px">'+esc(f.recommend)+' · عيّنة '+f.sample+'</div></div>';
    }).join('')); }
    out.push('<h3 style="margin:14px 2px 8px">مقاييس تشغيلية</h3><div class="statrow three">'+
      tile('المهام الحرجة',(r.critical.pct==null?'—':r.critical.pct+'%'),r.critical.done+'/'+r.critical.total+' · فات '+r.critical.missed,r.critical.insufficient)+
      tile('وسيط رفع المانع',r.blocker.median_min+' د','أعلى 90%: '+r.blocker.p90_min+' د · '+r.blocker.count+' مانع',r.blocker.insufficient)+
      tile('نسبة الترحيل',r.carryover.pct+'%',r.carryover.total+' مهمة',false)+'</div>');
    var fr=r.fairness;
    if((fr.rows||[]).length){ var mx=1; fr.rows.forEach(function(x){ if(x.total_weighted>mx) mx=x.total_weighted; });
      out.push('<h3 style="margin:14px 2px 8px">توزيع العدالة — حِمل موزون + عمل خفي</h3><div class="card" style="padding:12px">'+fr.rows.map(function(x){
        var pw=Math.round(100*x.total_weighted/mx);
        return '<div style="margin:0 0 8px"><div class="row" style="justify-content:space-between;font-size:13px"><span>'+esc(x.name)+(x.insufficient?' <span class="chip">عيّنة قليلة</span>':'')+'</span>'+
          '<span class="num">'+x.total_weighted+' د'+(x.hidden_min?' · خفي '+x.hidden_min:'')+'</span></div><div class="pbar"><i style="width:'+pw+'%"></i></div></div>';
      }).join('')+'<div class="muted small" style="margin-top:6px">أقل عيّنة معتمدة '+fr.min_sample+' شفت · التباين '+fr.variance+' · لا تصنيف علني بين الموظفات</div></div>');
    }
    out.push('<div class="muted small" style="margin:12px 2px;padding:10px;border:1px dashed var(--line);border-radius:10px">'+esc(r.rules.note)+'</div>');
    return out.join('');
  }
  function fetch2(){ var body=$('#ocBody'); if(!body) return; body.innerHTML=skel(3);
    var to=today(), from=addDays(to,-(preset-1));
    aAct('oc_analytics',{from:from,to:to}).then(function(r){ if(!r||!r.ok){ body.innerHTML='<div class="empty">تعذّر جلب التحليلات</div>'; return; } body.innerHTML=render(r); })
      .catch(function(){ body.innerHTML='<div class="empty">تعذّر جلب التحليلات</div>'; }); }
  v.innerHTML='<div class="row" style="gap:8px;margin-bottom:10px">'+[7,30,90].map(function(p){ return '<button class="btn sm'+(p===preset?'':' ghost')+'" data-p="'+p+'">'+(p===7?'٧ أيام':p===30?'٣٠ يوم':'٩٠ يوم')+'</button>'; }).join('')+'</div><div id="ocBody">'+skel(3)+'</div>';
  $$('[data-p]',v).forEach(function(b){ b.addEventListener('click',function(){ preset=+b.getAttribute('data-p'); $$('[data-p]',v).forEach(function(x){ x.classList.toggle('ghost', x!==b); }); fetch2(); }); });
  fetch2();
};

/* ---------- الموظفات ---------- */
ADMIN.employees=function(v){
  aAct('employees_list',{}).then(function(res){
    A.emps=res.employees||[];
    v.innerHTML='<div class="btnrow" style="margin-bottom:10px"><button class="btn sm" id="empNew">+ موظفة جديدة</button></div>'+
      A.emps.map(function(e){
        return '<div class="card" style="padding:10px 12px"><div class="row" style="justify-content:space-between">'+
        '<div><span class="avatar" style="display:inline-flex;width:30px;height:30px;font-size:14px;border-radius:50%;background:'+esc(e.color||'var(--brand)')+';color:var(--on-brand);align-items:center;justify-content:center">'+esc(e.name.charAt(0))+'</span> <b>'+esc(e.name)+'</b> <span class="chip" style="direction:ltr">'+esc(e.username||'')+'</span> '+
        (e.role==='admin'?'<span class="chip ink">إدارة</span>':'')+(e.flexible?'<span class="chip orange">جوكر</span>':'')+(!e.active?'<span class="chip red">موقوفة</span>':'')+'</div>'+
        '<div class="btnrow" style="margin:0"><button class="btn sm ghost" data-edit="'+e.id+'">تعديل</button><button class="btn sm ghost" data-pw="'+e.id+'">كلمة السر</button></div></div></div>';
      }).join('');
    $('#empNew').addEventListener('click', function(){ empForm(null); });
    $$('[data-edit]',v).forEach(function(b){ b.addEventListener('click', function(){
      var e=null; A.emps.forEach(function(x){ if(x.id===+b.getAttribute('data-edit')) e=x; }); empForm(e);
    });});
    $$('[data-pw]',v).forEach(function(b){ b.addEventListener('click', function(){
      sheet('إعادة تعيين كلمة السر','<label class="f">كلمة السر الجديدة</label><input class="f" id="npw"><div class="btnrow"><button class="btn block" id="npwGo">حفظ (تُغلق جلساتها)</button></div>',
        function(ov, close){ $('#npwGo',ov).addEventListener('click', function(){
          var pw=$('#npw',ov).value;
          if(!pw || pw.length<4){ toast('كلمة السر ٤ خانات على الأقل', true); return; }
          aAct('reset_password',{id:+b.getAttribute('data-pw'), password:pw}).then(function(r){ if(r.ok){close();toast('تم ✔');} else toast(r.error||'خطأ',true); });
        });});
    });});
  });
  function empForm(e){
    sheet(e?'تعديل: '+e.name:'موظفة جديدة',
      '<label class="f">الاسم</label><input class="f" id="eN" value="'+(e?esc(e.name):'')+'">'+
      '<label class="f">اسم المستخدم (للدخول)</label><input class="f" id="eU" autocapitalize="none" spellcheck="false" value="'+(e&&e.username?esc(e.username):'')+'">'+
      '<label class="f">اللون</label><input class="f" id="eC" type="color" value="'+(e&&e.color?esc(e.color):'#3E6B4C')+'" style="height:46px">'+
      (e?'':'<label class="f">كلمة السر الأولى</label><input class="f" id="eP" value="0000">')+
      (e?'<div class="check"><input type="checkbox" id="eA" '+(e.active?'checked':'')+'><span>مفعّلة</span></div>'+
         '<div class="check"><input type="checkbox" id="eF" '+(e.flexible?'checked':'')+'><span>مرنة (جوكر) — يظهر للإدارة فقط</span></div>'+
         '<div class="check"><input type="checkbox" id="eNR" '+(e.no_rotate?'checked':'')+'><span>استثناء من التدوير التلقائي للمهام</span></div>'+
         '<label class="f">بوصلة التطوير (هدف أسبوعي يظهر لها)</label><input class="f" id="eDF" value="'+(e&&e.dev_focus?esc(e.dev_focus):'')+'" placeholder="مثال: إتقان تحضير اللاتيه آرت">'+
         /* الوصول: خانتان صريحتان بدل قاعدةٍ واحدة تُطبَّق على الجميع.
            الأصل في الاثنتين «مغلق»، ويُفتح لموظفةٍ بعينها بقرارٍ مكتوب
            من الإدارة — لا بإعدادٍ عام يُرخي القبضة عن الكلّ. */
         '<div class="card soft" style="padding:10px 12px;margin-top:10px">'+
           '<b class="small">الوصول</b>'+
           '<div class="check" style="margin-top:6px"><input type="checkbox" id="eMD" '+(e.multi_device?'checked':'')+'>'+
             '<span>تدخل من أكثر من جهاز<br><span class="muted small">الأصل: حسابها مربوط بأول جهاز فقط'+
             (e.bound?'':' — لم ترتبط بجهازٍ بعد')+'</span></span></div>'+
           '<div class="check"><input type="checkbox" id="eAO" '+(e.allow_outside?'checked':'')+'>'+
             '<span>تسجّل الحضور من خارج المقهى<br><span class="muted small">'+
             'الأصل: داخل النطاق فقط. يبقى موقعها مسجّلاً في كل الحالات.</span></span></div>'+
           '<div class="small muted" style="margin-top:8px">لاعتماد هاتفٍ جديد لها بدل القديم دون فتح الحساب على كل الأجهزة:</div>'+
           '<div class="btnrow"><button class="btn sm ghost" id="eUnbind" type="button">اعتماد جهاز جديد (فك الارتباط)</button></div>'+
         '</div>':'')+
      '<div class="btnrow"><button class="btn block" id="eGo">حفظ</button></div>',
      function(ov, close){
        var ub=$('#eUnbind',ov); if(ub) ub.addEventListener('click', function(){ busyWrap(this, function(){ return aAct('unbind_device',{employee_id:e.id}).then(function(r){ if(r.ok) toast('تم — تستطيع الموظفة الدخول من جهازها الجديد الآن ✔'); else toast(r.error||'خطأ',true); }); }); });
        $('#eGo',ov).addEventListener('click', function(){
          var p={name:$('#eN',ov).value.trim(), color:$('#eC',ov).value, username:$('#eU',ov).value.trim()};
          if(!p.name){ toast('اكتبي الاسم', true); return; }
          if(e){ p.id=e.id; p.active=$('#eA',ov).checked; p.flexible=$('#eF',ov).checked; p.no_rotate=$('#eNR',ov).checked;
                 p.multi_device=$('#eMD',ov).checked; p.allow_outside=$('#eAO',ov).checked; }
          else{
            p.password=$('#eP',ov).value;
            if(!p.password || p.password.length<4){ toast('كلمة السر ٤ خانات على الأقل', true); return; }
          }
          var dfEl=$('#eDF',ov), df=dfEl?dfEl.value:null;
          busyWrap(this, function(){
            return aAct('employee_save',p).then(function(r){
              if(!r.ok){ toast(r.error||'خطأ',true); return; }
              var after=function(){ close(); toast('تم الحفظ ✔'); ADMIN.employees(v); };
              if(e && dfEl && df!==(e.dev_focus||'')) aAct('set_dev_focus',{employee_id:e.id, focus:df}).then(after);
              else after();
            });
          });
        });
      });
  }
};

/* ---------- أنواع الشفتات ---------- */
ADMIN.types=function(v){
  aAct('shift_types',{}).then(function(res){
    var ts=res.types||res.rows||[]; A.types=ts;
    v.innerHTML='<div class="btnrow" style="margin-bottom:10px"><button class="btn sm" id="tyNew">+ نوع جديد</button></div>'+
      ts.map(function(t){
        return '<div class="card" style="padding:10px 12px"><div class="row" style="justify-content:space-between">'+
          '<div><b>'+esc(t.name)+'</b><div class="muted small">'+fmtHM(t.start_time||t.start)+' → '+fmtHM(t.end_time||t.end)+' · استراحة '+mins(t.break_minutes)+(t.break_parts>1?' على '+t.break_parts+' أجزاء':'')+'</div></div>'+
          '<button class="btn sm ghost" data-ed="'+t.id+'">تعديل</button></div></div>';
      }).join('');
    $('#tyNew').addEventListener('click', function(){ form(null); });
    $$('[data-ed]',v).forEach(function(b){ b.addEventListener('click', function(){ var t=null; ts.forEach(function(x){if(x.id===+b.getAttribute('data-ed'))t=x;}); form(t); });});
    function form(t){
      sheet(t?'تعديل النوع':'نوع شفت جديد',
        '<label class="f">الاسم</label><input class="f" id="tN" value="'+(t?esc(t.name):'')+'">'+
        '<div class="row"><div class="grow"><label class="f">البداية</label><input class="f" id="tS" type="time" value="'+(t?fmtHM(t.start_time||t.start):'09:30')+'"></div>'+
        '<div class="grow"><label class="f">النهاية</label><input class="f" id="tE" type="time" value="'+(t?fmtHM(t.end_time||t.end):'18:30')+'"></div></div>'+
        '<div class="row"><div class="grow"><label class="f">دقائق الاستراحة</label><input class="f" id="tB" type="number" value="'+(t?t.break_minutes:60)+'"></div>'+
        '<div class="grow"><label class="f">عدد الأجزاء</label><input class="f" id="tP" type="number" value="'+(t?t.break_parts:1)+'"></div></div>'+
        '<div class="btnrow"><button class="btn block" id="tGo2">حفظ</button></div>',
        function(ov, close){
          $('#tGo2',ov).addEventListener('click', function(){
            var p={name:$('#tN',ov).value.trim(), start_time:$('#tS',ov).value, end_time:$('#tE',ov).value, break_minutes:+$('#tB',ov).value, break_parts:+$('#tP',ov).value};
            if(!p.name){ toast('اكتبي اسم النوع', true); return; }
            if(!p.start_time || !p.end_time){ toast('حددي وقتي البداية والنهاية', true); return; }
            if(!(p.break_parts>=1)) p.break_parts=1;
            if(t) p.id=t.id;
            aAct('shift_type_save',p).then(function(r){ if(r.ok){close();A.types=null;ADMIN.types(v);toast('تم ✔');} else toast(r.error||'خطأ',true); });
          });
        });
    }
  });
};

/* ---------- المناطق ---------- */
ADMIN.areas=function(v){
  aAct('areas_list',{}).then(function(res){
    var as=res.areas||res.rows||[]; A.areas=as;
    v.innerHTML='<div class="btnrow" style="margin-bottom:10px"><button class="btn sm" id="arNew">+ منطقة</button></div>'+
      as.map(function(a){
        return '<div class="card" style="padding:10px 12px"><div class="row" style="justify-content:space-between">'+
          '<div><b>'+esc(a.name)+'</b> '+(a.is_critical?'<span class="chip red">حرجة</span>':'')+(a.requires_skill?'<span class="chip">مهارة: '+esc(a.requires_skill)+'</span>':'')+
          '<div class="muted small">'+(a.tables_count||0)+' طاولة</div></div>'+
          '<button class="btn sm ghost" data-ed="'+a.id+'">تعديل</button></div></div>';
      }).join('');
    $('#arNew').addEventListener('click', function(){ form(null); });
    $$('[data-ed]',v).forEach(function(b){ b.addEventListener('click', function(){ var a=null; as.forEach(function(x){if(x.id===+b.getAttribute('data-ed'))a=x;}); form(a); });});
    function form(a){
      sheet(a?'تعديل المنطقة':'منطقة جديدة',
        '<label class="f">الاسم</label><input class="f" id="aN" value="'+(a?esc(a.name):'')+'">'+
        '<label class="f">عدد الطاولات</label><input class="f" id="aT" type="number" value="'+(a?a.tables_count:0)+'">'+
        '<label class="f">مهارة مطلوبة (كود، اختياري)</label><input class="f" id="aS" value="'+(a&&a.requires_skill?esc(a.requires_skill):'')+'">'+
        '<div class="check"><input type="checkbox" id="aC" '+(a&&a.is_critical?'checked':'')+'><span>منطقة حرجة</span></div>'+
        (a?'<div class="check"><input type="checkbox" id="aA" '+(a.active?'checked':'')+'><span>مفعّلة</span></div>':'')+
        '<div class="btnrow"><button class="btn block" id="aGo">حفظ</button></div>',
        function(ov, close){
          $('#aGo',ov).addEventListener('click', function(){
            var p={name:$('#aN',ov).value.trim(), tables_count:+$('#aT',ov).value, requires_skill:$('#aS',ov).value, is_critical:$('#aC',ov).checked};
            if(!p.name){ toast('اكتبي اسم المنطقة', true); return; }
            if(a){ p.id=a.id; p.active=$('#aA',ov).checked; }
            aAct('area_save',p).then(function(r){ if(r.ok){close();A.areas=null;ADMIN.areas(v);toast('تم ✔');} else toast(r.error||'خطأ',true); });
          });
        });
    }
  });
};

/* ---------- الشفتات ---------- */
ADMIN.shifts=function(v){
  lookups(function(){
    var sel=today();
    // بداية الأسبوع: السبت
    function wk0(d){ var x=new Date(d+'T12:00:00'); return addDays(d, -((x.getDay()+1)%7)); }
    var wkStart=wk0(sel), week=[];
    var DW=['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'];
    v.innerHTML='<input type="hidden" id="shDay" value="'+sel+'">'+
      '<div class="row" style="gap:6px;align-items:stretch"><button class="btn sm ghost" id="wkPrev" aria-label="الأسبوع السابق">›</button>'+
      '<div class="wkstrip grow" id="wkStrip"></div>'+
      '<button class="btn sm ghost" id="wkNext" aria-label="الأسبوع التالي">‹</button></div>'+
      '<div class="btnrow" style="margin:10px 0 0"><button class="btn sm" id="shNew">+ شفت</button><button class="btn sm ghost" id="shCopy">نسخ يوم</button><button class="btn sm ghost" id="shCov">تغطية المناطق</button></div>'+
      '<div id="shList" style="margin-top:10px"></div>';
    var cur=[];
    function paintStrip(){
      var tdy=today();
      $('#wkStrip').innerHTML=DW.map(function(nm,i){
        var d=addDays(wkStart,i), n=week.filter(function(s){return s.day===d && s.status!=='absent';}).length;
        return '<button class="wkd'+(d===sel?' on':'')+(d===tdy?' today':'')+'" data-wd="'+d+'"><span class="dw">'+nm+'</span><span class="dn num">'+(+d.slice(8))+'</span><span class="dc">'+(n? n+' شفت':'—')+'</span></button>';
      }).join('');
      $$('[data-wd]',v).forEach(function(b){ b.addEventListener('click', function(){ sel=b.getAttribute('data-wd'); $('#shDay').value=sel; paintStrip(); paintDay(); }); });
    }
    function paintDay(){
      cur=week.filter(function(s){ return s.day===sel; });
      $('#shList').innerHTML = cur.length ? cur.map(function(s){
        return '<div class="card" style="padding:10px 12px'+(s.status==='absent'?';opacity:.55':'')+'"><div class="row" style="justify-content:space-between">'+
          '<div><b>'+esc(s.employee)+'</b> — '+esc(s.type||'مخصص')+' · '+esc(s.area||'بلا منطقة')+((s.extra_area_names&&s.extra_area_names.length)?' <span class="chip green">+ '+s.extra_area_names.map(esc).join(' + ')+'</span>':'')+(s.status==='absent'?' <span class="chip red">غياب</span>':'')+
          '<div class="muted small">'+fmtHM(s.start)+' → '+fmtHM(s.end)+(s.daily_role?' · '+esc(s.daily_role):'')+'</div>'+
          '<div class="muted small">'+esc(sRoleName(s.role_on_shift))+
            (s.secondary_zone?' · تساند '+esc(s.secondary_zone):'')+
            (s.can_float===false?' · <span class="chip">لا تُنقل</span>':' · سحب '+(s.coverage_priority||3))+'</div></div>'+
          '<div class="btnrow" style="margin:0"><button class="btn sm ghost" data-edit="'+s.id+'">تعديل</button><button class="btn sm ghost red" data-del="'+s.id+'">حذف</button></div></div></div>';
      }).join('') : '<div class="empty">لا شفتات — '+DW[(new Date(sel+'T12:00:00').getDay()+1)%7]+' '+fmtD(sel)+'</div>';
      $$('[data-del]',v).forEach(function(b){ b.addEventListener('click', function(){
        confirmSheet('حذف الشفت','سيُحذف هذا الشفت مع حضوره ومهامه المرتبطة به لهذا اليوم.','حذف',function(){
          aAct('shift_delete',{id:+b.getAttribute('data-del')}).then(load);
        }, true);
      });});
      $$('[data-edit]',v).forEach(function(b){ b.addEventListener('click', function(){
        var s=null; cur.forEach(function(x){ if(x.id===+b.getAttribute('data-edit')) s=x; });
        if(s) form(s);
      });});
    }
    function load(){
      aAct('shifts_range',{from:wkStart,to:addDays(wkStart,6)}).then(function(res){
        week=res.shifts||[];
        // day قد يصل بتنسيقات مختلفة — طبّعيه إلى YYYY-MM-DD
        week.forEach(function(s){ if(s.day && s.day.length>10) s.day=s.day.slice(0,10); });
        paintStrip(); paintDay();
      });
    }
    $('#wkPrev').addEventListener('click', function(){ wkStart=addDays(wkStart,-7); sel=wkStart; $('#shDay').value=sel; load(); });
    $('#wkNext').addEventListener('click', function(){ wkStart=addDays(wkStart,7); sel=wkStart; $('#shDay').value=sel; load(); });
    function form(s){
      sheet(s ? 'تعديل شفت — '+s.employee : 'شفت جديد — '+$('#shDay').value,
        '<label class="f">الموظفة</label><select class="f" id="sE" '+(s?'disabled':'')+'>'+staffOpts(s?s.employee_id:null)+'</select>'+
        '<label class="f">نوع الشفت</label><select class="f" id="sT">'+typeOpts(s?s.type_id:null)+'</select>'+
        '<label class="f">المنطقة الأساسية</label><select class="f" id="sA">'+areaOpts(s?s.area_id:null)+'</select>'+
        '<label class="f">مناطق إضافية (أدوار متعددة بنفس الشفت — مثال: كاش + طلبات)</label>'+
        '<div>'+(A.areas||[]).map(function(ax){
          var cur=(s&&s.extra_areas)||[];
          var on=false; cur.forEach(function(cv){ if(+cv===ax.id) on=true; });
          return '<label class="check" style="margin:4px 0"><input type="checkbox" class="xa" value="'+ax.id+'" '+(on?'checked':'')+'><span>'+esc(ax.name)+'</span></label>';
        }).join('')+'</div>'+
        '<div class="row"><div class="grow"><label class="f">بداية مخصصة (اختياري)</label><input class="f" id="sS" type="time"></div>'+
        '<div class="grow"><label class="f">نهاية مخصصة (اختياري)</label><input class="f" id="sEn" type="time"></div></div>'+
        '<div class="muted small">اتركي الوقتين فارغين لاعتماد أوقات نوع الشفت'+(s?' (الحالي: '+fmtHM(s.start)+' → '+fmtHM(s.end)+')':'')+'.</div>'+
        '<label class="f">دور اليوم (جملة عمل حقيقية — لا شعارات)</label><input class="f" id="sR" placeholder="مثال: اليوم تضبطين سرعة تجهيز الأراجيل تحت 6 دقائق" value="'+(s?esc(s.daily_role||''):'')+'">'+
        /* إسناد المنطقة: بدونه لا يعرف المحرك من يُنقل حين يظهر الضغط في منطقة */
        '<hr class="sep"><b>إسناد المنطقة</b>'+
        '<div class="muted small">هذه الحقول هي ما يعتمد عليه النظام عند اكتشاف ضغط في منطقة: من يملكها، ومن يساندها، ومن يجوز نقلها، وبأي ترتيب.</div>'+
        '<div class="row"><div class="grow"><label class="f">دورها في هذا الشفت</label><select class="f" id="sRole">'+
          SROLES.map(function(r){ return '<option value="'+r[0]+'"'+((s&&s.role_on_shift===r[0])?' selected':'')+'>'+r[1]+'</option>'; }).join('')+'</select></div>'+
        '<div class="grow"><label class="f">منطقة المساندة (اختياري)</label><select class="f" id="sSec"><option value="">— بلا مساندة —</option>'+
          (A.areas||[]).map(function(ax){ return '<option value="'+ax.id+'"'+((s&&+s.secondary_zone_id===ax.id)?' selected':'')+'>'+esc(ax.name)+'</option>'; }).join('')+'</select></div></div>'+
        '<div class="row"><div class="grow"><label class="f">ترتيب السحب عند الضغط</label><select class="f" id="sPrio">'+
          [[1,'١ — تُسحب أولاً'],[2,'٢'],[3,'٣ — الوضع الطبيعي'],[4,'٤'],[5,'٥ — تُسحب أخيراً']].map(function(x){
            return '<option value="'+x[0]+'"'+((s?(+s.coverage_priority||3):3)===x[0]?' selected':'')+'>'+x[1]+'</option>'; }).join('')+'</select></div>'+
        '<div class="grow"><label class="f">سبب الإسناد</label><select class="f" id="sWhy">'+
          SREASONS.map(function(r){ return '<option value="'+r[0]+'"'+((s&&s.assignment_reason===r[0])?' selected':'')+'>'+r[1]+'</option>'; }).join('')+'</select></div></div>'+
        '<label class="check"><input type="checkbox" id="sFloat" '+((!s||s.can_float!==false)?'checked':'')+'><span>يجوز نقلها مؤقتاً لمنطقة أخرى عند الضغط</span></label>'+
        '<div class="btnrow"><button class="btn block" id="sGo">حفظ الشفت</button></div>',
        function(ov, close){
          $('#sGo',ov).addEventListener('click', function(){
            var p={day:$('#shDay').value, employee_id:+$('#sE',ov).value, type_id:+$('#sT',ov).value, area_id:+$('#sA',ov).value, daily_role:$('#sR',ov).value};
            p.extra_areas=$$('.xa',ov).filter(function(c){return c.checked;}).map(function(c){return +c.value;}).filter(function(idv){return idv!==p.area_id;});
            p.primary_zone_id=p.area_id;
            p.secondary_zone_id=$('#sSec',ov).value||'';
            if(p.secondary_zone_id && +p.secondary_zone_id===p.area_id){ toast('منطقة المساندة لا يمكن أن تكون نفس المنطقة الأساسية', true); return; }
            p.role_on_shift=$('#sRole',ov).value;
            p.coverage_priority=+$('#sPrio',ov).value||3;
            p.assignment_reason=$('#sWhy',ov).value;
            p.can_float=$('#sFloat',ov).checked;
            /* التزامن المتفائل: نرسل النسخة التي قرأناها فيرفض الخادم الحفظ فوق تعديل مديرة أخرى */
            if(s && s.zone_version) p.zone_version=s.zone_version;
            var st=$('#sS',ov).value, en=$('#sEn',ov).value;
            if(st) p.start_time=st;
            if(en) p.end_time=en;
            busyWrap(this, function(){
              return aAct('shift_save',p).then(function(r){
                if(r.ok){close();load();toast('تم ✔');}
                else if(r.code==='zone_conflict'){ close(); load(); toast(r.error, true, 5200); }
                else toast(r.error||'خطأ',true);
              });
            });
          });
        });
    }
    $('#shDay').addEventListener('change', load);
    $('#shNew').addEventListener('click', function(){ form(null); });
    /* تغطية المناطق: «مجدولة» لا تعني «موجودة» — المنطقة التي عليها اسم لم يحضر فجوة حقيقية */
    $('#shCov').addEventListener('click', function(){
      var day=$('#shDay').value;
      aAct('zone_coverage',{day:day}).then(function(res){
        if(!res.ok){ toast(res.error||'خطأ', true); return; }
        var zones=res.zones||[];
        var html='<div class="muted small">'+fmtD(day)+' — '+
          (res.gaps? '<b>'+res.gaps+'</b> منطقة بلا تغطية فعلية' : 'كل المناطق مغطاة')+
          (res.unassigned_shifts? ' · '+res.unassigned_shifts+' شفت بلا منطقة أساسية' : '')+'</div>';
        html+=zones.map(function(z){
          var own=z.owners||[], sup=z.supporters||[];
          var present=own.filter(function(o){ return o.present; }).length;
          var cls = own.length===0 ? 'red' : (present===0 ? 'orange' : 'green');
          var state = own.length===0 ? 'بلا مالكة مجدولة' : (present===0 ? 'مجدولة ولم تحضر' : present+' حاضرة');
          return '<div class="card" style="padding:10px 12px"><div class="row" style="justify-content:space-between">'+
            '<b>'+esc(z.zone)+'</b><span class="chip '+cls+'">'+state+'</span></div>'+
            (own.length? '<div class="small" style="margin-top:4px">'+own.map(function(o){
                return esc(o.name)+' <span class="muted">('+esc(sRoleName(o.role))+(o.present?'':' — لم تحضر')+
                  (o.can_float===false?' · لا تُنقل':'')+')</span>'; }).join('، ')+'</div>'
              : '<div class="small muted" style="margin-top:4px">لا أحد مسند لهذه المنطقة اليوم.</div>')+
            (sup.length? '<div class="small muted">مساندة: '+sup.map(function(o){return esc(o.name);}).join('، ')+'</div>':'')+
            ((own.length && present===0) || !own.length
              ? '<div class="btnrow" style="margin:6px 0 0"><button class="btn sm ghost" data-pull="'+z.zone_id+'">من يمكن نقلها هنا؟</button></div>' : '')+
            '</div>';
        }).join('');
        sheet('تغطية المناطق', html, function(ov){
          $$('[data-pull]',ov).forEach(function(b){ b.addEventListener('click', function(){
            var zid=+b.getAttribute('data-pull');
            aAct('zone_coverage',{day:day, to_zone:zid}).then(function(r2){
              var c=((r2.pull||{}).candidates)||[];
              sheet('مرشحات النقل', c.length ? c.map(function(x){
                  return '<div class="card" style="padding:9px 12px"><b>'+esc(x.name)+'</b>'+
                    (x.from_zone?' <span class="chip">من '+esc(x.from_zone)+'</span>':'')+
                    (x.leaves_gap?' <span class="chip red">سحبها يترك منطقتها بلا أحد</span>':'')+
                    '<div class="small muted" style="margin-top:3px">'+esc(x.why)+'</div></div>';
                }).join('') + '<div class="muted small" style="margin-top:8px">'+esc((r2.pull||{}).note||'')+'</div>'
                : '<div class="empty">لا أحد متاح للنقل الآن — كل الحاضرات إما مثبّتات أو سحبهن يترك فجوة.</div>');
            });
          });});
        });
      });
    });
    $('#shCopy').addEventListener('click', function(){
      sheet('نسخ شفتات يوم إلى '+$('#shDay').value,
        '<label class="f">اليوم المصدر</label><input class="f" id="cpFrom" type="date" value="'+addDays($('#shDay').value,-1)+'">'+
        '<div class="muted small">تُنسخ كل شفتات اليوم المصدر (النوع والمنطقة) إلى اليوم المعروض — يُستبدل شفت الموظفة إن كان موجوداً، ولا يُنسخ «دور اليوم».</div>'+
        '<div class="btnrow"><button class="btn block" id="cpGo">نسخ الجدول</button></div>',
        function(ov, close){
          $('#cpGo',ov).addEventListener('click', function(){
            var src=$('#cpFrom',ov).value, dst=$('#shDay').value;
            if(!src || src===dst){ toast('اختاري يوماً مصدراً مختلفاً', true); return; }
            busyWrap(this, function(){
              return aAct('shifts_range',{from:src,to:src}).then(function(res){
                var rows=(res.shifts||[]).filter(function(x){ return x.status!=='absent'; });
                if(!rows.length){ toast('لا شفتات في اليوم المصدر', true); return; }
                var chain=Promise.resolve(), n=0;
                rows.forEach(function(x){
                  var p2={day:dst, employee_id:x.employee_id, type_id:x.type_id, area_id:x.area_id, daily_role:''};
                  if(!x.type_id){ p2.start_time=fmtHM(x.start); p2.end_time=fmtHM(x.end); p2.break_minutes=x.break_minutes; }
                  chain=chain.then(function(){ return aAct('shift_save',p2).then(function(r){ if(r.ok) n++; }); });
                });
                return chain.then(function(){ close(); load(); toast('نُسخ '+n+' شفت ✔'); });
              });
            });
          });
        });
    });
    load();
  });
};

/* ---------- قوالب المهام ---------- */
/* مخاطر تغطية المهارات — يمنع اشتراط مهارة لا يتقنها أحد */
function loadSkillRisk(){
  aAct('skills_risk',{}).then(function(r){
    var el=$('#skRisk'); if(!el || !r || !r.ok) return;
    var m=r.risk||{}, sk=(m.skills||[]);
    var bad=sk.filter(function(s){ return s.risk!=='ok'; });
    var RISKAR={none:'لا أحد مؤهَّل',single_point:'شخص واحد فقط',thin:'تغطية ضعيفة'};
    if(!bad.length){ el.innerHTML='<div class="card soft" style="padding:11px 13px"><b>تغطية المهارات سليمة</b>'+
      '<div class="muted small">كل مهارة يتقنها '+(m.min_qualified||2)+' فأكثر.</div></div>'; return; }
    el.innerHTML='<h3 style="margin:4px 2px 8px">مخاطر تغطية المهارات ('+bad.length+')</h3>'+
      '<div class="muted small" style="margin:0 2px 8px">لا يمكن اشتراط مهارة على مهمة قبل تأهيل '+(m.min_qualified||2)+' على الأقل — وإلا صارت المهمة بلا مرشحة.</div>'+
      bad.map(function(s){
        var c = s.risk==='none' ? '--red' : s.risk==='single_point' ? '--amber' : '--muted';
        return '<div class="card" style="padding:10px 12px;border-inline-start:3px solid var('+c+')">'+
          '<div class="row" style="justify-content:space-between"><b>'+esc(s.name)+'</b>'+
            (s.critical?'<span class="chip red">حرجة</span>':'')+'</div>'+
          '<div class="muted small" style="margin-top:2px">'+(RISKAR[s.risk]||s.risk)+
            ((s.people&&s.people.length)?' · '+s.people.map(function(p){return esc(p.name);}).join('، '):'')+
            (s.used_by_templates?' · مشترطة في '+s.used_by_templates+' قالب':'')+'</div></div>';
      }).join('');
  }).catch(function(){});
}
/* ---------- الجدولة التلقائية: المحرك يبني الأسبوع، والمالك يراجع الاستثناء ---------- */
var DOWAR=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
ADMIN.roster=function(v){
  v.innerHTML='<div id="rsBody"><div class="skel" style="height:120px"></div></div>';
  function load(){
    aAct('roster_get',{}).then(function(res){
      var out=[], run=res.run, slots=res.slots||[];
      out.push('<div class="card" style="padding:13px 15px">'+
        '<div class="row" style="justify-content:space-between;align-items:flex-start">'+
          '<div><b>جدولة الأسبوع تلقائياً</b><div class="muted small" style="margin-top:2px">'+
          'يبني المحرك الجدول من التغطية والإجازات والتوافر والمهارات والإنصاف — وتراجعين الاستثناء فقط.</div></div></div>'+
        '<div class="row" style="gap:8px;margin-top:10px">'+
          '<input class="f" id="rsFrom" type="date" value="'+addDays(today(),1)+'" style="margin:0">'+
          '<select class="f" id="rsDays" style="margin:0"><option value="7">٧ أيام</option><option value="14">١٤ يوماً</option></select>'+
          '<button class="btn sm" id="rsGen" style="white-space:nowrap">توليد</button></div>'+
        '<div class="btnrow" style="margin-top:8px"><button class="btn sm ghost block" id="rsRules">قواعد التغطية والتوافر</button></div>'+
        '</div>');

      if(!run){
        out.push('<div class="empty">لا مسودّة حالياً — اضغطي «توليد» ليبني المحرك جدول الأسبوع.</div>');
      } else {
        var st=run.stats||{}, cov=st.coverage!=null?Math.round(st.coverage*100):0;
        var unf=slots.filter(function(s){return !s.employee_id;});
        out.push('<div class="card" style="padding:12px 14px;border-inline-start:3px solid var('+(unf.length?'--amber':'--green')+')">'+
          '<div class="row" style="flex-wrap:wrap;gap:6px">'+
            '<span class="chip'+(cov===100?' green':' orange')+'">التغطية '+cov+'٪</span>'+
            '<span class="chip">مملوءة: '+(st.filled||0)+'</span>'+
            (unf.length?'<span class="chip red">ناقصة: '+unf.length+'</span>':'')+
            '<span class="chip">'+fmtD(run.from)+' → '+fmtD(run.to)+'</span></div>'+
          '<div class="btnrow" style="margin-top:10px">'+
            '<button class="btn sm" id="rsPub">نشر الجدول</button>'+
            '<button class="btn sm ghost" id="rsDisc">إلغاء المسودّة</button></div></div>');

        if(unf.length){
          out.push('<h3 style="margin:14px 2px 8px">خانات لم يستطع المحرك ملأها ('+unf.length+')</h3>'+
            unf.map(function(s){
              var ex=(s.excluded||[]).slice(0,4).map(function(x){return esc(x.name)+': '+esc(x.why);}).join(' · ');
              return '<div class="card" style="padding:11px 13px;border-inline-start:3px solid var(--red)">'+
                '<div><b>'+esc(s.shift||'')+'</b> · '+fmtD(s.day)+' ('+DOWAR[new Date(s.day+'T00:00').getDay()]+')'+
                (s.area?' · '+esc(s.area):'')+'</div>'+
                (ex?'<div class="muted small" style="margin-top:4px">المستبعدات: '+ex+'</div>':'')+
                '<div class="small" style="margin-top:5px"><b>الموصى به:</b> '+esc(s.recommended||'')+'</div>'+
                '<div class="btnrow" style="margin-top:7px"><button class="btn sm" data-rsslot="'+s.id+'">تعيين يدوي</button></div></div>';
            }).join(''));
        }

        // الجدول مجمَّعاً بالأيام
        var byDay={};
        slots.forEach(function(s){ (byDay[s.day]=byDay[s.day]||[]).push(s); });
        out.push('<h3 style="margin:14px 2px 8px">المسودّة</h3>');
        Object.keys(byDay).sort().forEach(function(dk){
          out.push('<div class="card" style="padding:10px 12px"><div class="row" style="justify-content:space-between">'+
            '<b>'+DOWAR[new Date(dk+'T00:00').getDay()]+'</b><span class="muted small">'+fmtD(dk)+'</span></div>'+
            '<div class="list" style="margin-top:6px">'+byDay[dk].map(function(s){
              return '<div class="row"><button class="row__body" data-rsslot="'+s.id+'" style="text-align:right;background:none;border:none;padding:0;font:inherit;color:inherit;cursor:pointer">'+
                '<div class="row__title">'+(s.employee?esc(s.employee):'<span style="color:var(--red)">— شاغرة —</span>')+
                (s.manual?' <span class="chip orange">يدوي</span>':'')+'</div>'+
                '<div class="row__sub">'+esc(s.shift||'')+(s.area?' · '+esc(s.area):'')+
                (s.why&&s.why.length?' · '+esc(s.why[0]):'')+'</div></button></div>';
            }).join('')+'</div></div>');
        });
      }
      $('#rsBody').innerHTML=out.join('');

      $('#rsGen').addEventListener('click',function(){
        busyWrap(this,function(){
          return aAct('roster_generate',{from:$('#rsFrom').value, days:+$('#rsDays').value})
            .then(function(r){
              if(!r.ok){ toast(r.error||'خطأ',true); return; }
              var md=r.days_without_rules||[];
              if(md.length){
                sheet('أيام بلا قواعد تغطية',
                  '<div class="small">لم يولّد المحرك شفتات لهذه الأيام لأنها بلا قواعد:</div>'+
                  '<div style="margin:8px 0"><b>'+md.map(function(i){return DOWAR[i];}).join('، ')+'</b></div>'+
                  '<div class="muted small">افتحي «قواعد التغطية» ثم «انسخي لكل الأيام» لتعميم قواعد يوم على الأسبوع.</div>'+
                  '<div class="btnrow"><button class="btn block" id="mdGo">فتح قواعد التغطية</button></div>',
                  function(ov,close){ $('#mdGo',ov).addEventListener('click',function(){ close(); rosterRules(); }); });
              } else toast('وُلِّدت المسودّة ✔');
              load();
            });
        });
      });
      $('#rsRules').addEventListener('click', rosterRules);
      var pb=$('#rsPub'); if(pb) pb.addEventListener('click',function(){
        confirmSheet('نشر الجدول','سيُنشر الجدول وتصل الموظفات إشعاراً بشفتاتهن.','نشر',function(){
          busyWrap(pb,function(){ return aAct('roster_publish',{run_id:run.id}).then(function(r){
            if(r.ok){ toast('نُشر '+r.published+' شفت ✔'); load(); } else toast(r.error||'خطأ',true); }); });
        });
      });
      var db=$('#rsDisc'); if(db) db.addEventListener('click',function(){
        confirmSheet('إلغاء المسودّة','ستُحذف هذه المسودّة ولن تُنشر.','إلغاء المسودّة',function(){
          aAct('roster_discard',{run_id:run.id}).then(function(){ toast('أُلغيت'); load(); }); }, true);
      });
      $$('[data-rsslot]').forEach(function(b){ b.addEventListener('click',function(){
        var sid=+b.getAttribute('data-rsslot');
        lookups(function(){
          sheet('تعديل خانة الجدول',
            '<label class="f">الموظفة</label><select class="f" id="rsE"><option value="">— اتركيها شاغرة —</option>'+staffOpts()+'</select>'+
            '<label class="f">سبب التعديل (إلزامي)</label><input class="f" id="rsR" placeholder="مثال: طلبت التبديل معها">'+
            '<div class="muted small">يُحفظ سببكِ بجانب اختيار المحرك ولا يُلغيه.</div>'+
            '<div class="btnrow"><button class="btn block" id="rsSave">حفظ</button></div>',
            function(ov,close){
              $('#rsSave',ov).addEventListener('click',function(){
                var rr=$('#rsR',ov).value.trim();
                if(rr.length<3){ toast('اكتبي سبب التعديل',true); return; }
                busyWrap(this,function(){
                  return aAct('roster_slot_set',{slot_id:sid, employee_id:$('#rsE',ov).value, reason:rr})
                    .then(function(r){ if(r.ok){ close(); toast('حُفظ ✔'); load(); } else toast(r.error||'خطأ',true); });
                });
              });
            });
        });
      }); });
    });
  }
  function rosterRules(){
    aAct('roster_rules',{}).then(function(r){
      var dem=r.demand||[], skills=r.skills||[];
      var covered=[], missing=[];
      dem.forEach(function(d){ if(d.needed>0 && covered.indexOf(d.dow)<0) covered.push(d.dow); });
      for(var _i=0;_i<7;_i++) if(covered.indexOf(_i)<0) missing.push(_i);
      var html='<div class="muted small" style="margin-bottom:8px">كم موظفة تحتاجين لكل نوع شفت في كل يوم؟ المحرك يبني الجدول على هذا.</div>'+
        '<label class="f">نوع الشفت</label><select class="f" id="rdT">'+typeOpts()+'</select>'+
        '<label class="f">اليوم</label><select class="f" id="rdD">'+DOWAR.map(function(n,i){return '<option value="'+i+'">'+n+'</option>';}).join('')+'</select>'+
        '<label class="f">المنطقة</label><select class="f" id="rdA">'+areaOpts()+'</select>'+
        '<label class="f">العدد المطلوب</label><input class="f" id="rdN" type="number" min="0" value="1">'+
        '<label class="f">مهارة مطلوبة (اختياري)</label><select class="f" id="rdS"><option value="">— بلا —</option>'+
          skills.map(function(s){return '<option value="'+esc(s.code)+'">'+esc(s.name)+'</option>';}).join('')+'</select>'+
        '<div class="btnrow"><button class="btn block" id="rdSave">حفظ القاعدة</button></div>'+
        '<hr class="sep"><div class="small"><b>تعميم على الأسبوع</b></div>'+
        '<div class="muted small">المحرك لا يولّد شفتات ليوم بلا قواعد. إن كانت التغطية متشابهة، انسخي قواعد يوم إلى بقية الأيام بضغطة.</div>'+
        '<div class="row" style="gap:8px;margin-top:6px"><select class="f" id="rdFrom" style="margin:0">'+
          DOWAR.map(function(n,i){return '<option value="'+i+'"'+(covered.indexOf(i)>-1?'':' disabled')+'>'+n+(covered.indexOf(i)>-1?'':' (بلا قواعد)')+'</option>';}).join('')+'</select>'+
          '<button class="btn sm" id="rdCopy" style="white-space:nowrap">انسخي لكل الأيام</button></div>'+
        (missing.length?'<div class="muted small" style="margin-top:6px;color:var(--amber)">أيام بلا قواعد: '+missing.map(function(i){return DOWAR[i];}).join('، ')+'</div>':'')+
        '<hr class="sep"><div class="small"><b>القواعد الحالية</b></div><div class="list" style="margin-top:6px">'+
        (dem.length?dem.map(function(d){
          return '<div class="row"><div class="row__body"><div class="row__title">'+esc(d.shift||'')+' · '+DOWAR[d.dow]+'</div>'+
            '<div class="row__sub">'+(d.area?esc(d.area)+' · ':'')+'العدد: '+d.needed+(d.required_skill?' · مهارة: '+esc(d.required_skill):'')+'</div></div></div>';
        }).join(''):'<div class="empty">لا قواعد بعد</div>')+'</div>';
      sheet('قواعد التغطية', html, function(ov,close){
        $('#rdCopy',ov).addEventListener('click',function(){
          var fd=+$('#rdFrom',ov).value;
          busyWrap(this,function(){
            return aAct('roster_demand_copy',{from_dow:fd})
              .then(function(r){ if(r.ok){ close(); toast('عُمِّمت قواعد '+DOWAR[fd]+' على الأسبوع ✔'); } else toast(r.error||'خطأ',true); });
          });
        });
        $('#rdSave',ov).addEventListener('click',function(){
          busyWrap(this,function(){
            return aAct('roster_demand_set',{shift_type_id:+$('#rdT',ov).value, dow:+$('#rdD',ov).value,
              area_id:$('#rdA',ov).value, needed:+$('#rdN',ov).value, required_skill:$('#rdS',ov).value})
              .then(function(r){ if(r.ok){ close(); toast('حُفظت القاعدة ✔'); } else toast(r.error||'خطأ',true); });
          });
        });
      });
    });
  }
  lookups(load);
};

/* خريطة الطاولات للإدارة: متابعة المنطقتين + وضع تعديل التخطيط والترقيم */
ADMIN.tables=function(v){
  v.innerHTML=skel(3);
  /* تنبيهات كل المناطق معاً: المالكة تفتح هذه الشاشة أولاً، فيجب أن ترى ما
     يحتاج تدخلاً قبل أن تختار منطقة — لا أن تدخل كل منطقة لتكتشف. */
  Promise.all([aAct('tbl_areas',{}), aAct('tbl_alerts',{})]).then(function(rr){
    var res=rr[0]||{}, alr=rr[1]||{};
    var as=(res&&res.areas)||[];
    if(!as.length){ v.innerHTML='<div class="empty">لا توجد مناطق طاولات مُعرَّفة</div>'; return; }
    var BANDS={quiet:'هادئ',normal:'طبيعي',high:'مرتفع',peak:'ذروة',closed:'مغلقة',unknown:'غير معروف'};
    var alerts=(alr&&alr.alerts)||[], lrows=((alr&&alr.load)||{}).rows||[];
    var head='';
    if(alerts.length){
      head='<div class="tal"><div class="tal-h">'+tmIc('alert')+'يحتاج تدخلاً الآن <span>'+alerts.length+'</span></div>'+
        '<div class="tal-list">'+alerts.slice(0,6).map(function(a){
          return '<div class="tal-i sev-'+esc(a.sev||'')+'"><b>'+esc(a.title||'')+'</b>'+
            '<span>'+esc(a.why||'')+(a.owner?' · '+esc(a.owner):'')+'</span></div>';
        }).join('')+'</div></div>';
    } else {
      head='<div class="card" style="padding:11px 12px;margin-bottom:10px">'+
        '<span class="chip green">لا شيء يحتاج تدخلاً الآن</span>'+
        '<div class="muted small" style="margin-top:5px">التنبيهات تُحتسب داخل ساعات الخدمة فقط.</div></div>';
    }
    if(lrows.length){
      var mx=Math.max.apply(null, lrows.map(function(z){return z.active;}))||1;
      head+='<div class="tload" style="margin-bottom:10px"><div class="tload-h">توزيع الحمل الآن</div>'+
        lrows.map(function(r){
          return '<div class="tload-r"><span class="tc-av">'+esc(tmInitials(r.name))+'</span>'+
            '<span class="tload-n">'+esc(r.name)+'</span>'+
            '<span class="tload-bar"><i style="width:'+Math.round(r.active/mx*100)+'%"></i></span>'+
            '<span class="tload-v">'+r.active+'/'+r.tables+'</span></div>';
        }).join('')+'</div>';
    }
    head+='<div class="btnrow" style="margin-bottom:12px"><button class="btn ghost grow" id="tbVfNow">أطلقي سؤال تحقق الآن</button></div>'+
      '<div class="muted small" style="margin-bottom:12px">سؤال التحقق يُرسل للمسؤولة عن طاولة تأخّر تحديثها: '+
        '«هل الطاولة ما زالت كذا؟» بضغطة واحدة. الاختلاف مؤشر على تأخر التحديث لا دليل تقصير، ولا يدخل تقييم أحد.</div>';
    v.innerHTML=head+as.map(function(a){
      var open=a.open&&a.open.open, pr=a.pressure||{};
      return '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start">'+
        '<div><b>'+esc(a.name)+'</b>'+
          '<div class="muted small">'+(a.tables||0)+' طاولة · خدمة '+esc(a.svc_open||'')+' — '+esc(a.svc_close||'')+'</div>'+
          '<div style="margin-top:5px"><span class="chip'+(open?' green':'')+'">'+(open?'مفتوحة':'مغلقة الآن')+'</span>'+
          (pr.counted?'<span class="chip">الضغط: '+esc(BANDS[pr.band]||pr.band)+'</span>':'')+'</div></div>'+
        '</div>'+
        /* هرمية: «عرض الخريطة» هو الفعل الذي تفتح الإدارة الشاشة من أجله في
           تسع مرات من عشر، فيأخذ عرض البطاقة كاملاً. ما بعده إعداد ومراجعة
           تُفتح أحياناً، فتُطوى في صف ثانوي بدل سبعة أزرار متساوية الوزن
           تجعل الشاشة جداراً من الخيارات على ٣٦٠px. */
        '<div class="btnrow" style="margin-top:10px">'+
        '<button class="btn block" data-tv="'+a.id+'" data-nm="'+esc(a.name)+'">عرض الخريطة</button></div>'+
        (!open?'<div class="btnrow" style="margin-top:6px"><button class="btn ghost block" data-to="'+a.id+'" data-nm="'+esc(a.name)+'">فتح المنطقة مبكراً</button></div>':'')+
        '<details class="acc" style="margin-top:8px"><summary>إعداد ومراجعة<span class="chev">‹</span></summary>'+
        '<div class="btnrow" style="flex-wrap:wrap;margin-top:8px">'+
        '<button class="btn sm ghost" data-td="'+a.id+'" data-nm="'+esc(a.name)+'">مسؤولية الطاولات</button>'+
        '<button class="btn sm ghost" data-te="'+a.id+'" data-nm="'+esc(a.name)+'">تعديل التخطيط</button>'+
        '<button class="btn sm ghost" data-tlv="'+a.id+'" data-nm="'+esc(a.name)+'">نسخ التخطيط</button>'+
        '<button class="btn sm ghost" data-th="'+a.id+'">سجل الأحداث</button>'+
        '<button class="btn sm ghost" data-tvf="'+a.id+'">أسئلة التحقق</button>'+
        '</div></details></div>';
    }).join('');

    /* إطلاق دورة تحقق فوراً بدل انتظار الدورة المجدولة */
    $('#tbVfNow',v).addEventListener('click', function(){
      var btn=this;
      busyWrap(btn, function(){
        return aAct('tbl_verify_now',{}).then(function(r){
          if(!r || !r.ok){ toast((r&&r.error)||'تعذّر الإطلاق', true); return; }
          if(r.skipped==='disabled'){ toast('أسئلة التحقق مُعطّلة من الإعدادات', true); return; }
          var n=r.made!=null?r.made:((r.checks||[]).length||0);
          toast(n? ('أُرسل '+n+' سؤال ✔') : 'لا طاولة تأخّر تحديثها الآن');
        });
      });
    });

    /* نسخ التخطيط: من غيّر ترتيب الطاولات ومتى — التخطيط يمسّ الترقيم كله */
    $$('[data-tlv]',v).forEach(function(b){ b.addEventListener('click', function(){
      var aid=+b.getAttribute('data-tlv'), nm=b.getAttribute('data-nm');
      aAct('tbl_layout_versions',{area_id:aid}).then(function(r){
        var vs=(r&&r.versions)||[];
        sheet('نسخ تخطيط '+nm, vs.length
          ? vs.map(function(x){
              return '<div style="padding:8px 0;border-bottom:1px dashed var(--line)">'+
                '<b>نسخة '+(+x.version)+'</b>'+(x.current?' <span class="chip green">الحالية</span>':'')+
                '<div class="muted small">'+esc(x.by||'—')+' · '+fmtD(x.at)+' '+fmtT(x.at)+'</div>'+
                (x.note?'<div class="small">'+esc(x.note)+'</div>':'')+'</div>';
            }).join('')+'<div class="muted small" style="margin-top:9px">كل حفظ للتخطيط ينشئ نسخة جديدة، '+
              'فيبقى أثر من غيّر الترتيب ولماذا.</div>'
          : '<div class="empty">لا نسخ محفوظة — التخطيط ما زال على حالته الأولى</div>');
      });
    });});

    $$('[data-tv]',v).forEach(function(b){ b.addEventListener('click', function(){
      tmOpen(+b.getAttribute('data-tv'), b.getAttribute('data-nm'), true); }); });

    $$('[data-te]',v).forEach(function(b){ b.addEventListener('click', function(){
      tmEditor(+b.getAttribute('data-te'), b.getAttribute('data-nm')); }); });

    $$('[data-td]',v).forEach(function(b){ b.addEventListener('click', function(){
      tmDuty(+b.getAttribute('data-td'), b.getAttribute('data-nm'), v); }); });

    $$('[data-tvf]',v).forEach(function(b){ b.addEventListener('click', function(){
      aAct('tbl_verify_log',{}).then(function(r){
        var rows=(r&&r.rows)||[];
        sheet('سجل أسئلة التحقق', rows.length? rows.map(function(x){
          var tag = x.answered===false||!x.answered ? '<span class="chip">بانتظار الرد</span>'
                  : (x.agreement===true ? '<span class="chip green">مطابق</span>'
                  : (x.agreement===false ? '<span class="chip orange">اختلف — صُحّح</span>'
                  : '<span class="chip">انتهت المهلة</span>'));
          return '<div style="padding:7px 0;border-bottom:1px dashed var(--line)">'+
            '<b>طاولة '+(+x.no)+'</b> <span class="muted small">'+fmtT(x.at)+'</span> '+tag+
            '<div class="small muted">'+esc(x.who)+' · سجل النظام: '+esc((TMS[x.system]||{}).ar||x.system)+
            (x.answer?' · ردّت: '+esc((TMS[x.answer]||{}).ar||x.answer):'')+'</div></div>';
        }).join('')+'<div class="muted small" style="margin-top:9px">الاختلاف مؤشر على تأخر التحديث، لا دليل على تقصير. لا يدخل في تقييم أحد.</div>'
        : '<div class="empty">لا أسئلة اليوم</div>');
      });
    }); });

    $$('[data-to]',v).forEach(function(b){ b.addEventListener('click', function(){
      var aid=+b.getAttribute('data-to');
      sheet('فتح '+b.getAttribute('data-nm')+' مبكراً',
        '<div class="muted small" style="margin-bottom:8px">الفتح المبكر يُسجَّل بالسبب والوقت، وتدخل طاولات المنطقة فوراً في احتساب الضغط.</div>'+
        '<label class="f">سبب الفتح المبكر</label><input class="f" id="aoR" placeholder="مثال: مجموعة كبيرة متوقّعة الساعة ٤">'+
        '<div class="btnrow"><button class="btn block" id="aoGo">فتح المنطقة</button></div>',
        function(ov,close){
          $('#aoGo',ov).addEventListener('click', function(){
            var why=$('#aoR',ov).value.trim();
            if(!why){ toast('السبب مطلوب', true); return; }
            aAct('tbl_area_override',{area_id:aid, reason:why}).then(function(r){
              if(r&&r.ok){ toast('فُتحت المنطقة'); close(); ADMIN.tables(v); }
              else toast((r&&r.error)||'تعذر الفتح', true);
            });
          });
        });
    }); });

    $$('[data-th]',v).forEach(function(b){ b.addEventListener('click', function(){
      aAct('tbl_events',{}).then(function(r){
        var evs=(r&&r.events)||[];
        sheet('سجل أحداث الطاولات اليوم', evs.length? evs.map(function(e){
          return '<div style="padding:7px 0;border-bottom:1px dashed var(--line)">'+
            '<b>طاولة '+(+e.no)+'</b> <span class="muted small">'+fmtT(e.ts)+'</span>'+
            '<div class="small">'+esc((TMS[e.from]||{}).ar||e.from||'—')+' ← '+esc((TMS[e.to]||{}).ar||e.to)+'</div>'+
            '<div class="muted small">'+esc(e.by||'')+(e.reason?' · '+esc(e.reason):'')+'</div></div>';
        }).join('') : '<div class="empty">لا أحداث اليوم</div>');
      });
    }); });
  }).catch(function(){ v.innerHTML='<div class="empty">تعذر التحميل</div>'; });
};

/* مسؤولية الطاولات: الإدارة تحدد من تتابع أي طاولات — فردية أو مجموعة */
function tmDuty(areaId, areaName, host){
  Promise.all([aAct('tbl_duty_board',{area_id:areaId}), aAct('tbl_board',{area_id:areaId})])
  .then(function(rr){
    var db=rr[0]||{}, bd=rr[1]||{};
    if(!db.ok||!bd.ok){ toast('تعذر التحميل', true); return; }
    var tables=bd.tables||[], picked={};

    var body='<div class="muted small" style="margin-bottom:9px">اختاري الطاولات ثم الموظفة المسؤولة عنها. '+
      'المسؤولة هي من يسألها النظام عند التحقق، ويظهر اسمها على الطاولة.</div>';

    body+='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:11px">'+
      tables.map(function(t){
        return '<button class="chip" data-pk="'+t.id+'" style="border:1px solid var(--line);cursor:pointer">'+
          (+t.no)+(t.owner?' · '+esc(t.owner):'')+'</button>';
      }).join('')+'</div>';

    body+='<label class="f">الموظفة المسؤولة</label><select class="f" id="duEmp">'+
      '<option value="">— إزالة المسؤولية —</option>'+
      (db.candidates||[]).map(function(e){ return '<option value="'+e.id+'">'+esc(e.name)+'</option>'; }).join('')+
      '</select>'+
      '<div class="btnrow"><button class="btn block" id="duGo">إسناد المحدد</button></div>';

    body+='<hr class="sep"><b style="font-size:13px">التوزيع الحالي</b>'+
      ((db.assigned||[]).length ? (db.assigned||[]).map(function(a){
        return '<div style="padding:6px 0;border-bottom:1px dashed var(--line)"><b>'+esc(a.name)+'</b>'+
          '<div class="muted small">طاولات: '+(a.tables||[]).join('، ')+' · مشغولة الآن: '+(a.busy||0)+'</div></div>';
      }).join('') : '<div class="muted small" style="margin-top:5px">لا إسناد بعد</div>')+
      '<div class="muted small" style="margin-top:7px">بلا مسؤولة: '+((db.unassigned||[]).join('، ')||'—')+'</div>';

    sheet('مسؤولية الطاولات — '+areaName, body, function(ov, close){
      $$('[data-pk]',ov).forEach(function(b){
        b.addEventListener('click', function(){
          var id=+b.getAttribute('data-pk');
          if(picked[id]){ delete picked[id]; b.classList.remove('green'); }
          else { picked[id]=1; b.classList.add('green'); }
        });
      });
      $('#duGo',ov).addEventListener('click', function(){
        var ids=Object.keys(picked).map(Number);
        if(!ids.length){ toast('اختاري طاولة واحدة على الأقل', true); return; }
        var emp=$('#duEmp',ov).value;
        this.disabled=true;
        aAct('tbl_duty_set',{area_id:areaId, tables:ids, employee_id:emp||null}).then(function(r){
          if(r&&r.ok){ toast(emp?('أُسندت إلى '+r.employee):'أُزيلت المسؤولية'); close(); ADMIN.tables(host); }
          else toast((r&&r.error)||'تعذر الإسناد', true);
        });
      });
    });
  });
}

/* وضع تعديل الخريطة: سحب الطاولة، ترقيم، نوع، مقاعد، تعطيل — ثم حفظ نسخة */
function tmEditor(areaId, areaName){
  aAct('tbl_board',{area_id:areaId}).then(function(res){
    if(!res||!res.ok){ toast((res&&res.error)||'تعذر التحميل', true); return; }
    var T=(res.tables||[]).map(function(t){ return {id:t.id,no:t.no,type:t.type,seats:t.seats,x:+t.x,y:+t.y,is_active:true}; });
    var sel=null;

    function board(){
      return '<div class="muted small" style="margin-bottom:8px">اسحبي الطاولة لتغيير موقعها، أو اضغطيها لتعديل رقمها ونوعها.</div>'+
        '<div class="tm-board" id="edBoard">'+tmLandmarks(areaId)+
        T.map(function(t,i){
          return '<button class="tm-t '+esc(t.type)+' s-free" data-i="'+i+'" style="left:'+t.x+'%;top:'+t.y+'%">'+
                 '<span class="tm-box">'+(+t.no)+'</span></button>';
        }).join('')+'</div>'+
        '<div class="muted small" style="margin-top:8px">عدد الطاولات النشطة: <b id="edN">'+T.filter(function(t){return t.is_active;}).length+'</b></div>'+
        '<label class="f">سبب التغيير (إلزامي إذا اختلف العدد المعتمد)</label><input class="f" id="edNote">'+
        '<div class="btnrow"><button class="btn block" id="edSave">حفظ نسخة تخطيط جديدة</button></div>';
    }

    sheet('تعديل خريطة — '+areaName, board(), function(ov, close){
      var bd=$('#edBoard',ov);

      function redraw(){
        $$('.tm-t',bd).forEach(function(b){
          var t=T[+b.getAttribute('data-i')];
          b.style.left=t.x+'%'; b.style.top=t.y+'%';
          b.className='tm-t '+t.type+' s-free'+(t.is_active?'':' oos');
          $('.tm-box',b).textContent=t.no;
        });
        $('#edN',ov).textContent=T.filter(function(t){return t.is_active;}).length;
      }

      /* السحب باللمس والفأرة على نفس المسار */
      var drag=null;
      function pt(e){ var r=bd.getBoundingClientRect(); var c=e.touches?e.touches[0]:e;
        return {x:Math.max(3,Math.min(97,(c.clientX-r.left)/r.width*100)),
                y:Math.max(4,Math.min(96,(c.clientY-r.top)/r.height*100))}; }
      function down(e){ var b=e.target.closest('.tm-t'); if(!b) return;
        drag={i:+b.getAttribute('data-i'), moved:false, el:b}; }
      function move(e){ if(!drag) return; var p=pt(e); drag.moved=true;
        T[drag.i].x=Math.round(p.x); T[drag.i].y=Math.round(p.y);
        drag.el.style.left=T[drag.i].x+'%'; drag.el.style.top=T[drag.i].y+'%'; e.preventDefault(); }
      function up(){ if(drag && !drag.moved) edit(drag.i); drag=null; }
      bd.addEventListener('mousedown',down); bd.addEventListener('touchstart',down,{passive:true});
      bd.addEventListener('mousemove',move); bd.addEventListener('touchmove',move,{passive:false});
      bd.addEventListener('mouseup',up);     bd.addEventListener('touchend',up);
      bd.addEventListener('mouseleave',function(){ drag=null; });

      function edit(i){
        var t=T[i];
        sheet('طاولة '+t.no,
          '<label class="f">الرقم</label><input class="f" id="etNo" type="number" value="'+(+t.no)+'">'+
          '<label class="f">النوع</label><select class="f" id="etTy">'+
            [['standalone','مستقلة'],['two_seat','ثنائية'],['booth','جلسة كنب'],['curved','منحنية'],['high','مرتفعة']]
              .map(function(o){ return '<option value="'+o[0]+'"'+(t.type===o[0]?' selected':'')+'>'+o[1]+'</option>'; }).join('')+
          '</select>'+
          '<label class="f">عدد المقاعد</label><input class="f" id="etS" type="number" value="'+(+t.seats)+'">'+
          '<div class="check"><input type="checkbox" id="etA" '+(t.is_active?'checked':'')+'><span>نشطة</span></div>'+
          '<div class="btnrow"><button class="btn block" id="etOk">حفظ</button></div>',
          function(ov2, close2){
            $('#etOk',ov2).addEventListener('click', function(){
              t.no=+$('#etNo',ov2).value||t.no; t.type=$('#etTy',ov2).value;
              t.seats=+$('#etS',ov2).value||t.seats; t.is_active=$('#etA',ov2).checked;
              close2(); redraw();
            });
          });
      }

      $('#edSave',ov).addEventListener('click', function(){
        var btn=this; btn.disabled=true;
        aAct('tbl_layout_save',{area_id:areaId, tables:T, note:$('#edNote',ov).value.trim()||null}).then(function(r){
          btn.disabled=false;
          if(r&&r.ok){ toast('حُفظت النسخة '+r.version); close(); drawAdmin(); }
          else toast((r&&r.error)||'تعذر الحفظ', true, 4200);
        }).catch(function(){ btn.disabled=false; toast('تعذر الاتصال', true); });
      });
    });
  });
}

ADMIN.templates=function(v){
  lookups(function(){
    aAct('templates_list',{}).then(function(res){
      var ts=res.templates||[];
      v.innerHTML='<div class="btnrow" style="margin-bottom:10px"><button class="btn sm" id="tpNew">+ قالب</button></div>'+
        ts.map(function(t){
          return '<div class="card" style="padding:10px 12px'+(t.active?'':';opacity:.5')+'"><div class="row" style="justify-content:space-between">'+
            '<div><b>'+esc(t.name)+'</b> '+(t.is_core?'<span class="chip orange">أساسية</span>':'')+
            '<div class="muted small">'+esc(t.area||'')+' · '+(t.recurring?'متكررة'+(t.target_count?' ('+t.target_count+')':''):PHASE[t.phase])+' · '+mins(t.expected)+(t.needs_photo?' · صورة':'')+'</div></div>'+
            '<button class="btn sm ghost" data-ed="'+t.id+'">تعديل</button></div></div>';
        }).join('');
      $('#tpNew').addEventListener('click', function(){ form(null); });
      $$('[data-ed]',v).forEach(function(b){ b.addEventListener('click', function(){ var t=null; ts.forEach(function(x){if(x.id===+b.getAttribute('data-ed'))t=x;}); form(t); });});
      function form(t){
        sheet(t?'تعديل القالب':'قالب مهمة جديد',
          '<label class="f">الاسم</label><input class="f" id="pN" value="'+(t?esc(t.name):'')+'">'+
          '<label class="f">المنطقة</label><select class="f" id="pA">'+areaOpts(t?t.area_id:null)+'</select>'+
          '<div class="row"><div class="grow"><label class="f">المرحلة</label><select class="f" id="pPh">'+['opening','during','closing'].map(function(p){return '<option value="'+p+'"'+(t&&t.phase===p?' selected':'')+'>'+PHASE[p]+'</option>';}).join('')+'</select></div>'+
          '<div class="grow"><label class="f">الدقائق المتوقعة</label><input class="f" id="pX" type="number" value="'+(t?t.expected:10)+'"></div></div>'+
          '<label class="f">طريقة الإكمال</label><select class="f" id="pM">'+[['confirm','تأكيد'],['checklist','قائمة فحص'],['number','رقم/كمية'],['photo','صورة'],['two_person','موظفتان'],['review','مراجعة إدارة']].map(function(m){return '<option value="'+m[0]+'"'+(t&&t.method===m[0]?' selected':'')+'>'+m[1]+'</option>';}).join('')+'</select>'+
          '<label class="f">بنود القائمة (سطر لكل بند)</label><textarea class="f" id="pC">'+(t&&t.checklist?esc((t.checklist||[]).join('\n')):'')+'</textarea>'+
          '<div class="check"><input type="checkbox" id="pPhoto" '+(t&&t.needs_photo?'checked':'')+'><span>تحتاج صورة</span></div>'+
          '<div class="check"><input type="checkbox" id="pTwo" '+(t&&t.needs_two?'checked':'')+'><span>تحتاج موظفتين</span></div>'+
          '<div class="check"><input type="checkbox" id="pRev" '+(t&&t.needs_review?'checked':'')+'><span>تحتاج مراجعة إدارة</span></div>'+
          '<div class="check"><input type="checkbox" id="pCore" '+(t&&t.is_core?'checked':'')+'><span>أساسية (تمنع الانصراف)</span></div>'+
          '<hr class="sep"><div class="check"><input type="checkbox" id="pRec" '+(t&&t.recurring?'checked':'')+'><span>متكررة (يؤديها أكثر من موظفة عدة مرات — مثل الجلي وتشطيب الطاولات)</span></div>'+
          '<div class="check"><input type="checkbox" id="pAll" '+(t&&t.all_staff?'checked':'')+'><span>على الجميع — مهمة دوّارة يتناوبها كل الموظفات الحاضرات بالعدل (حمّام، واجهة، ساحة...)</span></div>'+
          '<label class="f">تكرار المهمة</label><select class="f" id="pFreq">'+[['daily','يومي'],['3day','كل 3 أيام'],['weekly','أسبوعي']].map(function(f){return '<option value="'+f[0]+'"'+(((t&&t.freq===f[0])||(!t&&f[0]==='daily'))?' selected':'')+'>'+f[1]+'</option>';}).join('')+'</select>'+
          '<div class="row"><div class="grow"><label class="f">العدد المطلوب يومياً (0 = بلا سقف)</label><input class="f" id="pTgt" type="number" value="'+(t?(t.target_count||0):0)+'"></div>'+
          '<div class="grow"><label class="f">أقل فاصل بين المرات (دقيقة)</label><input class="f" id="pCd" type="number" value="'+(t?(t.cooldown_min||0):0)+'"></div></div>'+
          '<label class="f">تدوير يومي على الموظفات — عدد المكلَّفات (0 = بلا تدوير، 2 = مثل مسح الواجهة)</label><input class="f" id="pRot" type="number" min="0" value="'+(t?(t.rotate_size||0):0)+'">'+
          '<div class="muted small">يُسنِد المهمة تلقائياً لهذا العدد من الموظفات بالتناوب العادل يومياً بين الحاضرات (يستثني المستثنيات).</div>'+
          (t?'<div class="btnrow" style="margin-top:8px"><button class="btn ghost block" type="button" id="pOrder">ترتيب دور الموظفات على هذه المهمة</button></div><div class="muted small">للمهام الدوّارة: رتّبي الموظفات يدوياً (هبه ← رؤى ← بشرى) فيمرّرها النظام بينهنّ بالترتيب. اتركيه فارغاً للتوزيع العادل التلقائي.</div>':'')+
          /* المهارة المشترطة تُحفظ بإجراء منفصل لأن له حارساً خاصاً على الخادم:
             لا يُقبل اشتراط مهارة لا تتقنها موظفات كافيات، وإلا صارت المهمة
             بلا مرشّحة فارتفع الإسناد اليدوي. لذلك لا تُدمج مع حفظ القالب. */
          (t?'<hr class="sep"><label class="f">مهارة مشترطة (اختياري)</label>'+
             '<select class="f" id="pSk"><option value="">لا اشتراط</option>'+
             (A.skills||[]).map(function(s){
               var nm=s.name||s;
               return '<option value="'+esc(nm)+'"'+(t.required_skill===nm?' selected':'')+'>'+esc(nm)+'</option>';
             }).join('')+'</select>'+
             '<div class="btnrow" style="margin-top:6px"><button class="btn ghost block" type="button" id="pSkGo">احفظي المهارة المشترطة</button></div>'+
             '<div class="muted small">لن يُسند النظام هذه المهمة إلا لمن تتقن المهارة. '+
               'إن لم يكن العدد كافياً سيرفض الحفظ ويخبرك — الاشتراط بلا مؤدّيات يعطّل المهمة لا يحميها.</div>':'')+
          '<label class="f">لماذا هذه المهمة مهمة</label><input class="f" id="pRe" value="'+(t?esc(t.reason||''):'')+'">'+
          '<label class="f">أثر إهمالها</label><input class="f" id="pIm" value="'+(t?esc(t.impact||''):'')+'">'+
          (t?'<div class="check"><input type="checkbox" id="pAct" '+(t.active?'checked':'')+'><span>مفعّل</span></div>':'')+
          '<div class="btnrow"><button class="btn block" id="pGo">حفظ</button></div>',
          function(ov, close){
            var _ob=$('#pOrder',ov); if(_ob) _ob.addEventListener('click', function(){ taskOrderSheet(t.id, t.name); });
            var _sk=$('#pSkGo',ov); if(_sk) _sk.addEventListener('click', function(){
              busyWrap(this, function(){
                return aAct('template_skill_set',{id:t.id, required_skill:$('#pSk',ov).value})
                  .then(function(r){
                    if(!r || !r.ok){ toast((r&&r.error)||'تعذّر الحفظ', true, 4500); return; }
                    toast(r.cleared? 'أُزيل الاشتراط ✔' : 'حُفظت المهارة المشترطة ✔');
                  });
              });
            });
            $('#pGo',ov).addEventListener('click', function(){
              var cl=$('#pC',ov).value.split('\n').map(function(x){return x.trim();}).filter(Boolean);
              var p={name:$('#pN',ov).value, area_id:+$('#pA',ov).value, phase:$('#pPh',ov).value, expected:+$('#pX',ov).value,
                method:$('#pM',ov).value, checklist:cl, needs_photo:$('#pPhoto',ov).checked, needs_two:$('#pTwo',ov).checked,
                needs_review:$('#pRev',ov).checked, is_core:$('#pCore',ov).checked, reason:$('#pRe',ov).value, impact:$('#pIm',ov).value,
                recurring:$('#pRec',ov).checked, target_count:+$('#pTgt',ov).value||0, cooldown_min:+$('#pCd',ov).value||0, rotate_size:+$('#pRot',ov).value||0, all_staff:$('#pAll',ov).checked, freq:$('#pFreq',ov).value};
              if(!p.name.trim()){ toast('اكتبي اسم المهمة', true); return; }
              if(p.method==='checklist' && !cl.length){ toast('طريقة «قائمة فحص» تحتاج بنوداً — سطر لكل بند', true); return; }
              if(!(p.expected>0)){ toast('الدقائق المتوقعة يجب أن تكون أكبر من صفر', true); return; }
              if(p.method==='photo') p.needs_photo=true;
              if(p.method==='two_person') p.needs_two=true;
              if(p.method==='review') p.needs_review=true;
              if(t){ p.id=t.id; p.active=$('#pAct',ov).checked; }
              busyWrap(this, function(){
                return aAct('template_save',p).then(function(r){ if(r.ok){close();ADMIN.templates(v);toast('تم ✔');} else toast(r.error||'خطأ',true); });
              });
            });
          });
      }
    });
  });
};

function taskOrderSheet(tid, name){
  aAct('task_order_get',{template_id:tid}).then(function(res){
    var order=(res.order||[]).slice(), emps=res.employees||[];
    sheet('ترتيب الدور — '+name, '<div id="ordWrap"></div>', function(ov, close){
      function paint(){
        var inIds=order.map(function(o){return o.employee_id;});
        var avail=emps.filter(function(e){return inIds.indexOf(e.id)<0;});
        var h='<div class="muted small" style="margin-bottom:8px">أول موظفة تبدأ، ثم التالية بعد كل تنفيذ. الغائبة تُتخطّى تلقائياً. اتركيه فارغاً للتوزيع العادل التلقائي (الأقل تنفيذاً).</div>';
        h+=(order.length?order.map(function(o,i){
          return '<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:7px 0"><div><b>'+(i+1)+'.</b> '+esc(o.name)+'</div>'+
            '<span class="btnrow" style="margin:0"><button class="btn sm ghost" data-up="'+i+'"'+(i===0?' disabled':'')+'>▲</button><button class="btn sm ghost" data-dn="'+i+'"'+(i===order.length-1?' disabled':'')+'>▼</button><button class="btn sm ghost red" data-rm="'+i+'">حذف</button></span></div>';
        }).join(''):'<div class="muted small" style="padding:6px 0">لا ترتيب محدد — التوزيع عادل تلقائياً.</div>');
        if(avail.length) h+='<label class="f" style="margin-top:10px">إضافة موظفة للترتيب</label><select class="f" id="ordAdd"><option value="">— اختاري —</option>'+avail.map(function(e){return '<option value="'+e.id+'">'+esc(e.name)+'</option>';}).join('')+'</select>';
        h+='<div class="btnrow" style="margin-top:12px"><button class="btn block" id="ordSave">حفظ الترتيب</button></div>';
        $('#ordWrap',ov).innerHTML=h;
        $$('[data-up]',ov).forEach(function(b){ b.addEventListener('click', function(){ var i=+b.getAttribute('data-up'); var t=order[i-1]; order[i-1]=order[i]; order[i]=t; paint(); }); });
        $$('[data-dn]',ov).forEach(function(b){ b.addEventListener('click', function(){ var i=+b.getAttribute('data-dn'); var t=order[i+1]; order[i+1]=order[i]; order[i]=t; paint(); }); });
        $$('[data-rm]',ov).forEach(function(b){ b.addEventListener('click', function(){ order.splice(+b.getAttribute('data-rm'),1); paint(); }); });
        var add=$('#ordAdd',ov); if(add) add.addEventListener('change', function(){ if(add.value){ var e=null; emps.forEach(function(x){if(x.id===+add.value)e=x;}); if(e) order.push({employee_id:e.id,name:e.name}); paint(); } });
        $('#ordSave',ov).addEventListener('click', function(){
          busyWrap(this, function(){ return aAct('task_order_set',{template_id:tid, employee_ids:order.map(function(o){return o.employee_id;})}).then(function(r){ if(r.ok){ close(); toast('حُفظ الترتيب ✔'); } else toast(r.error||'خطأ',true); }); });
        });
      }
      paint();
    });
  });
}
/* ---------- مهام اليوم + المراجعة ---------- */
ADMIN.tasks=function(v){
  lookups(function(){
    v.innerHTML='<div class="row"><input class="f grow" id="tkDay" type="date" value="'+today()+'"><button class="btn sm ghost" id="tkBal">التوازن</button><button class="btn sm" id="tkAssign">+ إسناد</button></div><div id="tkList" style="margin-top:10px"></div>';
    function load(){
      aAct('tasks_day',{day:$('#tkDay').value}).then(function(res){
        var ts=res.tasks||[];
        var review=ts.filter(function(t){return t.needs_review&&t.status==='done';});
        var out=[];
        if(review.length) out.push('<div class="row" style="justify-content:space-between"><h3 style="margin:0">بانتظار المراجعة ('+review.length+')</h3>'+
          (review.length>1?'<button class="btn sm ghost" id="tkBulk">اعتماد الكل ✔</button>':'')+'</div>');
        function card(t){
          return '<div class="card" style="padding:10px 12px"><div class="row" style="justify-content:space-between">'+
            '<div><b>'+esc(t.name)+'</b> — '+esc(t.employee||'؟')+'<div class="muted small">'+esc(t.area||'')+' · '+PHASE[t.phase]+' · صافي '+(t.net_min||0)+' د / متوقعة '+t.expected+' د'+(t.confirmed_by?' · أكدتها '+esc(t.confirmed_by):'')+'</div>'+
            (t.result&&t.result.note?'<div class="small">'+esc(t.result.note)+'</div>':'')+
            (t.result&&t.result.number!==undefined&&t.result.number!==null?'<div class="small">'+esc(t.result.number)+'</div>':'')+'</div>'+
            '<span class="chip '+(t.status==='approved'?'green':t.status==='returned'?'red':'')+'">'+(TSTAT[t.status]||t.status)+'</span></div>'+
            (t.photo?'<div class="btnrow"><button class="btn sm ghost" data-ph="'+t.id+'">عرض الصورة</button></div>':'')+
            (t.needs_review&&t.status==='done'?'<div class="btnrow"><button class="btn sm" data-ap="'+t.id+'">اعتماد ✔</button><button class="btn sm ghost red" data-rt="'+t.id+'">إعادة للتنفيذ</button></div>':'')+
            '</div>';
        }
        review.forEach(function(t){ out.push(card(t)); });
        out.push('<h3 style="margin-top:10px">كل المهام ('+ts.length+')</h3>');
        ts.filter(function(t){return !(t.needs_review&&t.status==='done');}).forEach(function(t){ out.push(card(t)); });
        if(!ts.length) out.push('<div class="empty">لا مهام بهذا اليوم</div>');
        $('#tkList').innerHTML=out.join('');
        $$('[data-ph]',v).forEach(function(b){ b.addEventListener('click', function(){
          var t=null; ts.forEach(function(x){if(x.id===+b.getAttribute('data-ph'))t=x;});
          if(t&&t.photo_data) sheet('صورة التوثيق', mediaSlot('img', t.photo_data, 'width:100%;border-radius:12px') || '<div class="muted small">تعذّر عرض الصورة — صيغة غير صالحة</div>');
        });});
        $$('[data-ap]',v).forEach(function(b){ b.addEventListener('click', function(){
          aAct('task_review',{id:+b.getAttribute('data-ap'), decision:'approve'}).then(load);
        });});
        $$('[data-rt]',v).forEach(function(b){ b.addEventListener('click', function(){
          var note=prompt('ملاحظة الإعادة (تظهر للموظفة):','تحتاج إعادة');
          if(note===null) return;
          aAct('task_review',{id:+b.getAttribute('data-rt'), decision:'return', note:note}).then(load);
        });});
        var bulk=$('#tkBulk',v);
        if(bulk) bulk.addEventListener('click', function(){
          if(!confirm('اعتماد كل المهام المنتظرة ('+review.length+')؟ راجعي الصور والأرقام أولاً.')) return;
          busyWrap(bulk, function(){
            var chain=Promise.resolve();
            review.forEach(function(t){ chain=chain.then(function(){ return aAct('task_review',{id:t.id, decision:'approve'}); }); });
            return chain.then(function(){ toast('اعتُمدت كلها ✔'); load(); });
          });
        });
      });
    }
    $('#tkDay').addEventListener('change', load);
    $('#tkBal').addEventListener('click', function(){
      aAct('balance_view',{day:$('#tkDay').value}).then(function(res){
        var rows=res.rows||[];
        if(!rows.length){ sheet('توازن التوزيع','<div class="empty">لا طاقم مجدول لهذا اليوم</div>'); return; }
        var maxm=Math.max.apply(null, rows.map(function(r){return r.min_total||0;}).concat([1]));
        var html='<div class="muted small" style="margin-bottom:8px">توزيع أحمال المهام على طاقم اليوم (بالدقائق المتوقعة). الشريط الأطول = حمل أكبر.</div>'+
          rows.map(function(r){ var w=Math.round(100*(r.min_total||0)/maxm);
            return '<div style="margin-bottom:11px"><div class="row" style="justify-content:space-between"><b>'+esc(r.name)+(r.area?' <span class="muted small">'+esc(r.area)+'</span>':'')+'</b><span class="muted small">'+(r.done||0)+'/'+(r.total||0)+' · '+(r.min_remaining||0)+'د متبقّية</span></div><div class="pbar"><i style="width:'+w+'%"></i></div></div>';
          }).join('')+
          '<div class="btnrow"><button class="btn block" id="tkRebal">توزيع تلقائي متوازن (المهام غير المبدوءة)</button></div>';
        sheet('توازن التوزيع', html, function(ov, close){
          $('#tkRebal',ov).addEventListener('click', function(){
            if(!confirm('سيُعاد توزيع المهام غير المبدوءة وغير الأساسية بالتوازن على طاقم اليوم. متابعة؟')) return;
            busyWrap(this, function(){ return aAct('rebalance',{day:$('#tkDay').value}).then(function(r){ if(r.ok){ close(); toast('أُعيد التوزيع بالتوازن ✔'); load(); } else toast(r.error||'خطأ',true); }); });
          });
        });
      });
    });
    $('#tkAssign').addEventListener('click', function(){
      sheet('مهمة جديدة',
        '<label class="f">المهمة</label><input class="f" id="qN">'+
        '<label class="f">من ينفّذها</label><select class="f" id="qE">'+
          '<option value="">المحرك يختار الأنسب تلقائياً ★</option>'+staffOpts()+'</select>'+
        '<div id="qRw" style="display:none">'+
          '<label class="f">سبب الاختيار اليدوي (إلزامي)</label>'+
          '<input class="f" id="qR" placeholder="مثال: طلب خاص من الزبونة">'+
          '<div class="muted small">يُحفظ سببك بجانب قرار المحرك ولا يُلغيه.</div></div>'+
        '<label class="f">المنطقة</label><select class="f" id="qA">'+areaOpts()+'</select>'+
        '<label class="f">دقائق متوقعة</label><input class="f" id="qX" type="number" value="10">'+
        '<div class="check"><input type="checkbox" id="qC"><span>أساسية (تمنع الانصراف)</span></div>'+
        '<div class="btnrow"><button class="btn block" id="qGo">إضافة</button></div>',
        function(ov, close){
          $('#qE',ov).addEventListener('change', function(){
            $('#qRw',ov).style.display = this.value ? '' : 'none';
          });
          $('#qGo',ov).addEventListener('click', function(){
            var nm=$('#qN',ov).value.trim();
            if(!nm){ toast('اكتبي اسم المهمة', true); return; }
            var emp=$('#qE',ov).value, rsn=(($('#qR',ov)||{}).value||'').trim();
            if(emp && rsn.length<3){ toast('اكتبي سبب الاختيار اليدوي', true); return; }
            busyWrap(this, function(){
              var pl={day:$('#tkDay').value, name:nm, area_id:+$('#qA',ov).value,
                      expected:+$('#qX',ov).value, is_core:$('#qC',ov).checked};
              if(emp){ pl.employee_id=+emp; pl.reason=rsn; }
              return aAct('task_assign', pl).then(function(r){
                if(!r.ok){ toast(r.error||'خطأ',true); return; }
                close(); load();
                toast(r.pending ? 'لا مرشحة الآن — في لوحة الاستثناءات' : (r.auto ? 'أسندها المحرك ✔' : 'تم الإسناد ✔'));
              });
            });
          });
        });
    });
    load();
  });
};

/* ---------- الحضور ---------- */
ADMIN.attendance=function(v){
  v.innerHTML='<input class="f" id="atDay" type="date" value="'+today()+'"><div id="atBody" style="margin-top:10px"></div>';
  function load(){
    aAct('attendance_day',{day:$('#atDay').value}).then(function(res){
      var out=[];
      var fixes=(res.fixes||[]).filter(function(f){return f.status==='pending';});
      if(fixes.length){
        out.push('<h3>تعديلات «نسيت أسجل» — تحتاج قرارك ('+fixes.length+')</h3>');
        fixes.forEach(function(f){
          out.push('<div class="card beige" style="padding:10px 12px"><b>'+esc(f.employee)+'</b> — '+(f.kind==='in'?'نسيت الحضور':'نسيت الانصراف')+' · وقت تقريبي '+fmtT(f.approx)+
            '<div class="small muted">'+esc(f.reason||'')+'</div>'+
            '<div class="btnrow"><button class="btn sm" data-fa="'+f.id+'">اعتماد الوقت التقريبي</button><button class="btn sm ghost red" data-fr="'+f.id+'">رفض</button></div></div>');
        });
      }
      out.push('<h3 style="margin-top:8px">حضور اليوم</h3><div class="scrollx"><table class="tbl"><tr><th>الموظفة</th><th>المنطقة</th><th>حضور</th><th>انصراف</th><th>تأخير</th><th>إضافي</th><th>تحقق</th><th>تعديل</th></tr>'+
        (res.rows||[]).map(function(r,ri){
          return '<tr><td><b>'+esc(r.employee)+'</b></td><td>'+esc(r.area||'—')+'</td><td>'+fmtT(r['in'])+'</td><td>'+fmtT(r.out)+'</td><td>'+(r.late>0?'<span class="chip orange">'+r.late+' د</span>':'—')+'</td><td>'+(r.ot>0?r.ot+' د':'—')+'</td><td>'+((r.in_selfie||r.out_selfie)?'<button class="btn sm ghost" data-selfie="'+ri+'"></button>':'—')+'</td><td><button class="btn sm ghost" data-edat="'+ri+'">تعديل</button></td></tr>';
        }).join('')+'</table></div>');
      var posts=(res.postpones||[]).filter(function(p){return !p.compensated;});
      if(posts.length){
        out.push('<h3 style="margin-top:12px">استراحات مؤجلة غير معوَّضة</h3>');
        posts.forEach(function(p){
          out.push('<div class="card" style="padding:9px 12px"><div class="row" style="justify-content:space-between"><div><b>'+esc(p.employee)+'</b> <span class="muted small">'+esc(p.reason||'')+' · '+fmtD(p.ts)+'</span></div><button class="btn sm ghost" data-comp="'+p.id+'">عُوِّضت ✔</button></div></div>');
        });
      }
      var brs=res.breaks||[];
      if(brs.length){
        out.push('<h3 style="margin-top:12px">استراحات اليوم</h3><div class="card" style="padding:8px 12px">'+brs.map(function(b){
          return '<div class="small" style="padding:3px 0">'+esc(b.employee)+': '+fmtT(b.start)+' → '+(b.end?fmtT(b.end):'<span class="chip orange">مفتوحة</span>')+'</div>';
        }).join('')+'</div>');
      }
      $('#atBody').innerHTML=out.join('');
      $$('[data-fa]',v).forEach(function(b){ b.addEventListener('click', function(){ aAct('fix_decide',{id:+b.getAttribute('data-fa'),decision:'approve'}).then(load); });});
      $$('[data-fr]',v).forEach(function(b){ b.addEventListener('click', function(){
        inputSheet('رفض التعديل','سبب الرفض','يظهر للموظفة','رفض',function(note){
          aAct('fix_decide',{id:+b.getAttribute('data-fr'),decision:'reject',note:note}).then(load);
        });
      });});
      $$('[data-comp]',v).forEach(function(b){ b.addEventListener('click', function(){ aAct('postpone_compensate',{id:+b.getAttribute('data-comp')}).then(load); });});
      $$('[data-selfie]',v).forEach(function(b){ b.addEventListener('click', function(){
        var r=(res.rows||[])[+b.getAttribute('data-selfie')]; if(!r) return;
        function geoTxt(g){ return g&&g.lat ? ''+g.lat+', '+g.lng+(g.acc?' (±'+g.acc+'م)':'') : 'بدون موقع'; }
        sheet('صور التحقق — '+r.employee,
          (r.in_selfie?'<b>الحضور '+fmtT(r['in'])+'</b><div class="small muted">'+geoTxt(r.in_geo)+'</div>'+mediaSlot('img', r.in_selfie, 'width:100%;border-radius:12px;margin:6px 0'):'<div class="muted small">لا صورة حضور</div>')+
          (r.out_selfie?'<hr class="sep"><b>الانصراف '+fmtT(r.out)+'</b><div class="small muted">'+geoTxt(r.out_geo)+'</div>'+mediaSlot('img', r.out_selfie, 'width:100%;border-radius:12px;margin:6px 0'):''));
      });});
      $$('[data-edat]',v).forEach(function(b){ b.addEventListener('click', function(){
        var r=(res.rows||[])[+b.getAttribute('data-edat')]; if(r) attEdit(r);
      });});
    });
  }
  function attEdit(r){
    if(!r.shift_id){ toast('لا يمكن التعديل — لا يوجد شفت مرتبط', true); return; }
    sheet('تعديل وقت — '+esc(r.employee),
      '<div class="muted small">الأوقات بتوقيت عمّان. اتركي الحقل فارغاً لعدم تغييره.</div>'+
      '<label class="f">الحضور</label><input class="f" id="edIn" type="time" value="'+(r['in']?fmtT(r['in']):'')+'">'+
      '<label class="f">الانصراف</label><input class="f" id="edOut" type="time" value="'+(r.out?fmtT(r.out):'')+'">'+
      '<div class="btnrow"><button class="btn block" id="edGo">حفظ</button></div>',
      function(ov, close){
        $('#edGo',ov).addEventListener('click', function(){
          busyWrap(this, function(){ return aAct('attendance_set',{shift_id:r.shift_id, in:$('#edIn',ov).value, out:$('#edOut',ov).value}).then(function(res){
            if(res.ok){ close(); toast('تم تعديل الوقت ✔'); load(); } else toast(res.error||'خطأ', true);
          }); });
        });
      });
  }
  $('#atDay').addEventListener('change', load); load();
};

/* ---------- المهارات ---------- */
ADMIN.skills=function(v){
  aAct('skills_matrix',{}).then(function(res){
    if(!res.ok){ v.innerHTML='<div class="empty">'+esc(res.error||'خطأ')+'</div>'; return; }
    var out=[];
    out.push('<div id="skRisk"></div>');
    setTimeout(loadSkillRisk, 0);
    out.push('<div class="card beige"><h3>تغطية المهارات الحرجة</h3>'+
      (res.coverage||[]).map(function(c){
        var h=c.holders||[];
        return '<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px dashed var(--line)"><b>'+esc(c.skill)+'</b>'+
          '<span>'+(h.length? h.map(function(n){return '<span class="chip green" style="margin:1px">'+esc(n)+'</span>';}).join('') : '<span class="chip red">لا معتمدة!</span>')+'</span></div>';
      }).join('')+'<div class="muted small" style="margin-top:6px">الهدف: أساسية + بديلة أولى وثانية لكل مهارة حرجة — هكذا لا تُستنزف موظفة واحدة.</div></div>');
    var emps=res.employees||[], skills=res.skills||[], mx={};
    (res.matrix||[]).forEach(function(m){ mx[m.employee_id+'-'+m.skill_id]=m; });
    out.push('<div class="scrollx"><table class="tbl"><tr><th>الموظفة \\ المهارة</th>'+skills.map(function(s){return '<th>'+esc(s.name)+(s.critical?'':'')+'</th>';}).join('')+'</tr>'+
      emps.map(function(e){
        return '<tr><td><b>'+esc(e.name)+'</b></td>'+skills.map(function(s){
          var m=mx[e.id+'-'+s.id];
          var txt = m ? (m.level+(m.approved?'✔':'⏳')+(m.can_train?'':'')) : '·';
          return '<td style="cursor:pointer;text-align:center" data-es="'+e.id+'-'+s.id+'">'+txt+'</td>';
        }).join('')+'</tr>';
      }).join('')+'</table></div><div class="muted small" style="margin-top:6px">✔ معتمدة · ⏳ بانتظار الاعتماد · يحق لها التدريب — اضغطي أي خلية للتعديل</div>');
    v.innerHTML=out.join('');
    $$('[data-es]',v).forEach(function(td){
      td.addEventListener('click', function(){
        var pp=td.getAttribute('data-es').split('-'), eid=+pp[0], sid=+pp[1];
        var e=null,s=null; emps.forEach(function(x){if(x.id===eid)e=x;}); skills.forEach(function(x){if(x.id===sid)s=x;});
        var m=mx[eid+'-'+sid]||{level:0,approved:false,can_train:false};
        sheet(e.name+' — '+s.name,
          '<label class="f">المستوى (0–4)</label><select class="f" id="mL">'+[0,1,2,3,4].map(function(l){return '<option value="'+l+'"'+(m.level===l?' selected':'')+'>'+l+' — '+['لا تعرفها','شاهدت','تطبق بإشراف','مستقلة','تعلّم غيرها'][l]+'</option>';}).join('')+'</select>'+
          '<div class="check"><input type="checkbox" id="mA" '+(m.approved?'checked':'')+'><span>معتمدة (بعد تطبيق فعلي أمامك)</span></div>'+
          '<div class="check"><input type="checkbox" id="mT" '+(m.can_train?'checked':'')+'><span>مؤهلة لتدريب غيرها</span></div>'+
          '<div class="btnrow"><button class="btn block" id="mGo">حفظ</button></div>',
          function(ov, close){
            $('#mGo',ov).addEventListener('click', function(){
              aAct('emp_skill_save',{employee_id:eid, skill_id:sid, level:+$('#mL',ov).value, approved:$('#mA',ov).checked, can_train:$('#mT',ov).checked})
                .then(function(r){ if(r.ok){close();ADMIN.skills(v);toast('تم ✔');} else toast(r.error||'خطأ',true); });
            });
          });
      });
    });
    A.skillList=skills;
  });
};

/* ---------- التدريب ---------- */
ADMIN.training=function(v){
  lookups(function(){
    Promise.all([aAct('trainings_list',{}), A.skillList?Promise.resolve({skills:A.skillList}):aAct('skills_matrix',{})]).then(function(rs){
      var ts=rs[0].trainings||[]; var skills=rs[1].skills||[]; A.skillList=skills;
      v.innerHTML='<div class="btnrow" style="margin-bottom:10px"><button class="btn sm" id="trNew">+ خطة تدريب</button></div>'+
        '<div class="muted small" style="margin-bottom:8px">المسار: جديد → طُبّق → اختُبر → معتمد. لا تُحتسب المهارة إلا بعد اختبار واعتماد منك.</div>'+
        (ts.length? ts.map(function(t){
          return '<div class="card" style="padding:10px 12px"><b>'+esc(t.skill)+'</b>: '+esc(t.trainer)+' تدرّب '+esc(t.trainee)+
            ' <span class="chip '+(t.status==='approved'?'green':'')+'">'+(TRSTAT[t.status]||t.status)+'</span>'+
            (t.notes?'<div class="small muted">'+esc(t.notes)+'</div>':'')+
            '<div class="btnrow">'+
            (t.status==='created'?'<button class="btn sm ghost" data-st="'+t.id+'" data-s="practiced">تم التطبيق</button>':'')+
            (t.status==='practiced'?'<button class="btn sm ghost" data-st="'+t.id+'" data-s="tested">تم الاختبار</button>':'')+
            (t.status==='tested'?'<button class="btn sm" data-appr="'+t.id+'">اعتماد المهارة ✔</button>':'')+
            '</div></div>';
        }).join('') : '<div class="empty">لا تدريبات</div>');
      $('#trNew').addEventListener('click', function(){
        sheet('خطة تدريب جديدة',
          '<label class="f">المهارة</label><select class="f" id="wS">'+skills.map(function(s){return '<option value="'+s.id+'">'+esc(s.name)+'</option>';}).join('')+'</select>'+
          '<label class="f">المدرِّبة (يجب أن تكون معتمدة ومؤهلة للتدريب)</label><select class="f" id="wR">'+staffOpts()+'</select>'+
          '<label class="f">المتدرِّبة</label><select class="f" id="wT">'+staffOpts()+'</select>'+
          '<label class="f">ملاحظات</label><input class="f" id="wN">'+
          '<div class="btnrow"><button class="btn block" id="wGo">إنشاء</button></div>',
          function(ov, close){
            $('#wGo',ov).addEventListener('click', function(){
              aAct('training_create',{skill_id:+$('#wS',ov).value, trainer_id:+$('#wR',ov).value, trainee_id:+$('#wT',ov).value, notes:$('#wN',ov).value})
                .then(function(r){ if(r.ok){close();ADMIN.training(v);toast('تم ✔');} else toast(r.error||'خطأ',true); });
            });
          });
      });
      $$('[data-st]',v).forEach(function(b){ b.addEventListener('click', function(){
        aAct('training_status',{id:+b.getAttribute('data-st'), status:b.getAttribute('data-s')}).then(function(){ ADMIN.training(v); });
      });});
      $$('[data-appr]',v).forEach(function(b){ b.addEventListener('click', function(){
        var lvl=prompt('مستوى الاعتماد للمتدربة (3 افتراضياً):','3'); if(lvl===null) return;
        aAct('training_approve',{id:+b.getAttribute('data-appr'), level:+lvl||3}).then(function(r){
          if(r.ok){ toast('اعتُمدت المهارة — ووصل تقدير للمدرّبة'); ADMIN.training(v); } else toast(r.error||'خطأ',true);
        });
      });});
    });
  });
};

/* ---------- الغياب والتغطية ---------- */
ADMIN.absence=function(v){
  lookups(function(){
    v.innerHTML='<div id="abToday"></div><div class="card"><h3>الإبلاغ عن غياب اليوم</h3>'+
      '<label class="f">الغائبة</label><select class="f" id="abE">'+staffOpts()+'</select>'+
      '<label class="f">السبب (اختياري)</label><input class="f" id="abR">'+
      '<div class="btnrow"><button class="btn orange block" id="abGo">توليد خطط التغطية</button></div></div>'+
      /* تغطية حدثت بلا خطة نظام: زميلة غطّت شفتاً بمكالمة، أو الإدارة رتّبتها
         هاتفياً. بلا هذا لا يظهر في سجل التغطية من حمل عن من، فيبدو رصيد
         التغطية أنقص مما هو، وهو رصيد يُقرأ عند طلب إجازة. */
      '<details class="acc" style="margin:0 0 12px"><summary>تدوين تغطية حدثت خارج النظام<span class="chev">‹</span></summary>'+
        '<div style="padding:4px 2px 2px">'+
        '<label class="f">من غطّت</label><select class="f" id="clE">'+staffOpts()+'</select>'+
        '<label class="f">نوع التغطية</label><select class="f" id="clK">'+
          '<option value="cover_absence">تغطية غياب</option>'+
          '<option value="cover_late">تغطية تأخير</option>'+
          '<option value="extra_shift">شفت إضافي</option>'+
          '<option value="stayed_late">بقيت بعد شفتها</option></select>'+
        '<label class="f">التفاصيل</label><input class="f" id="clD" maxlength="200" placeholder="مثال: غطّت شفت ليان المسائي باتفاق هاتفي">'+
        '<div class="btnrow"><button class="btn ghost block" id="clGo">دوّني التغطية</button></div>'+
        '<div class="muted small">يُسجَّل في سجل التغطية ليُقرأ عند طلبات الإجازة — لا يولّد شفتاً ولا يعدّل ساعات.</div>'+
        '</div></details><div id="abOut"></div>';
    var CVS={pending:'<span class="chip orange">بانتظار موافقتها</span>', accepted:'<span class="chip green">قبلت التغطية ✔</span>', declined:'<span class="chip red">اعتذرت — اختاري بديلة</span>'};
    function loadToday(){
      aAct('absences_day',{}).then(function(res){
        var rows=res.rows||[];
        $('#abToday').innerHTML = rows.length ? '<h3 style="margin:0 2px 8px">غيابات اليوم</h3>'+rows.map(function(x){
          return '<div class="card" style="padding:10px 12px"><b>'+esc(x.employee)+'</b> <span class="muted small">'+esc(x.reason||'')+'</span>'+
            '<div style="margin-top:4px">'+(x.cover?('التغطية: <b>'+esc(x.cover)+'</b> '+(CVS[x.cover_status]||esc(x.cover_status||''))):'<span class="chip">بلا تغطية بعد</span>')+'</div></div>';
        }).join('') : '';
      }).catch(function(){});
    }
    loadToday();
    $('#clGo').addEventListener('click', function(){
      var det=$('#clD').value.trim();
      if(det.length<4){ toast('اكتبي تفاصيل التغطية — السجل بلا تفصيل لا يُقرأ لاحقاً', true); return; }
      busyWrap(this, function(){
        return aAct('coverage_log_add',{employee_id:+$('#clE').value, kind:$('#clK').value, detail:det})
          .then(function(r){
            if(r && r.ok){ toast('دُوّنت التغطية ✔'); $('#clD').value=''; }
            else toast((r&&r.error)||'تعذّر التدوين', true);
          });
      });
    });
    $('#abGo').addEventListener('click', function(){
      aAct('absence_report',{employee_id:+$('#abE').value, reason:$('#abR').value}).then(function(res){
        if(!res.ok){ toast(res.error||'خطأ',true); return; }
        var out=[];
        if(res.reduced_plan) out.push('<div class="alert high"><b>⚠ '+esc(res.reduced_plan)+'</b></div>');
        out.push('<h3>الخطط المقترحة'+(res.area?' — منطقتها: '+esc(res.area):'')+(res.requires_skill?' · مهارة مطلوبة: '+esc(res.requires_skill):'')+'</h3>');
        (res.plans||[]).forEach(function(p,i){
          out.push('<div class="card" style="padding:10px 12px'+(p.qualified?'':';opacity:.55')+'"><div class="row" style="justify-content:space-between">'+
            '<div><b>'+(i+1)+'. '+esc(p.employee)+'</b> '+(p.flexible?'<span class="chip orange">جوكر</span>':'')+(p.qualified?'':'<span class="chip red">غير مؤهلة للمهارة</span>')+
            '<div class="small muted">'+esc(p.note||'')+(p.cover_count_30d?' · غطّت '+p.cover_count_30d+' مرة بآخر شهر':'')+'</div></div>'+
            '<button class="btn sm" data-pick="'+i+'">اختيار</button></div></div>');
        });
        out.push('<div class="card beige"><b>خيارات احتياطية:</b><ul style="padding-right:18px;margin:6px 0">'+
          (res.fallbacks||[]).filter(Boolean).map(function(f){return '<li>'+esc(f)+'</li>';}).join('')+'</ul></div>');
        $('#abOut').innerHTML=out.join('');
        $$('[data-pick]',v).forEach(function(b){ b.addEventListener('click', function(){
          var p=res.plans[+b.getAttribute('data-pick')];
          aAct('absence_choose',{id:res.absence_id, plan:p}).then(function(r){
            if(r.ok){
              toast('أُرسل طلب التغطية لـ'+p.employee+' — بانتظار موافقتها');
              $('#abOut').innerHTML='<div class="card soft center">أُرسل الطلب إلى <b>'+esc(p.employee)+'</b> — سيظهر لها فور فتح التطبيق، وستتحدث الحالة هنا</div>';
              loadToday();
            }
            else toast(r.error||'خطأ',true);
          });
        });});
      });
    });
  });
};

/* ---------- التعاون ---------- */
ADMIN.coop=function(v){
  v.innerHTML='<input class="f" id="cpM" type="month" value="'+thisMonth()+'"><div id="cpB" style="margin-top:10px"></div>';
  function load(){
    aAct('coop_overview',{month:$('#cpM').value}).then(function(res){
      var out=[];
      out.push('<div class="card"><h3>عدد الترشيحات (سري — لا يُعرض للموظفات)</h3>'+
        ((res.counts||[]).length? res.counts.map(function(c){
          return '<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px dashed var(--line)"><b>'+esc(c.employee)+'</b><span class="chip green">'+c.votes+'</span></div>';
        }).join(''):'<div class="muted small">لا ترشيحات هذا الشهر</div>')+'</div>');
      if((res.mutual_pairs||[]).length){
        out.push('<div class="card beige"><h3>⚠ أنماط تبادل متكرر</h3>'+res.mutual_pairs.map(function(m){
          return '<div>'+esc(m.a)+' ↔ '+esc(m.b)+' — '+m.days+' أيام</div>';
        }).join('')+'<div class="muted small">قد يكون تعاوناً حقيقياً — انظري بنفسك قبل أي استنتاج.</div></div>');
      }
      out.push('<div class="card"><h3>التفاصيل</h3>'+((res.reasons||[]).map(function(r){
        return '<div class="small" style="padding:4px 0;border-bottom:1px dashed var(--line)">'+fmtD(r.day)+': <b>'+esc(r.by)+'</b> اختارت <b>'+esc(r.employee)+'</b> — '+esc(r.reason||'')+(r.note?' («'+esc(r.note)+'»)':'')+'</div>';
      }).join('')||'<div class="muted small">—</div>')+'</div>');
      $('#cpB').innerHTML=out.join('');
    });
  }
  $('#cpM').addEventListener('change', load); load();
};

/* ---------- المساهمات الإضافية ----------
   المساهمة عمل تطوّعت به الموظفة خارج مهامها. البتّ فيها إنصاف لا إجراء
   إداري: الرفض يستلزم سبباً يصلها، والقيمة تُعرض بأسبابها لا كرقم مبهم. */
var CCAT_AR={support_colleague:'إسناد زميلة', cover_area:'تغطية منطقة', proactive:'عمل استباقي',
             fix_blocker:'إزالة عائق', handle_report:'معالجة بلاغ', training:'تدريب',
             emergency:'طارئ', other:'أخرى'};
var CST_AR={captured:'بانتظار القرار', pending_confirmation:'بانتظار تأكيد الزميلة',
            verified:'مؤكَّدة — بانتظار القرار', approved:'معتمدة', rejected:'مرفوضة',
            disputed:'محل خلاف'};
ADMIN.contrib=function(v){
  var showAll=false;
  v.innerHTML='<div class="card soft" style="padding:10px 12px"><div class="muted small">'+
    'المساهمة عمل إضافي تطوّعت به الموظفة. المعتمدة وحدها تدخل في التقييم والحمل. '+
    'الرفض يستلزم سبباً مكتوباً يصل الموظفة نصاً، ولا يُعرض ترتيب علني لأحد.'+
    '</div></div>'+
    '<div class="row" style="gap:6px;margin:10px 0"><input class="f grow" id="cbFrom" type="date">'+
    '<input class="f grow" id="cbTo" type="date"></div>'+
    '<div id="cbSum"></div><div id="cbList">'+skel(3)+'</div>';
  var to=today(), from=addDays(to,-14);
  $('#cbFrom',v).value=from; $('#cbTo',v).value=to;

  function load(){
    aAct('contrib_list',{from:$('#cbFrom',v).value, to:$('#cbTo',v).value}).then(function(res){
      if(!res.ok){ $('#cbList',v).innerHTML='<div class="empty">'+esc(res.error||'خطأ')+'</div>'; return; }
      var rows=res.rows||[], c=res.counts||{};
      /* المعلّقة أولاً: هي وحدها التي تنتظر قراراً */
      var pending=rows.filter(function(r){ return ['approved','rejected'].indexOf(r.status)<0; });
      var done=rows.filter(function(r){ return ['approved','rejected'].indexOf(r.status)>=0; });

      $('#cbSum',v).innerHTML='<div class="tcb">'+
        '<div class="tcb-i'+(c.pending?' bad':'')+'"><b>'+(c.pending||0)+'</b><span>تنتظر قراراً</span></div>'+
        '<div class="tcb-i"><b>'+(c.running||0)+'</b><span>جارية الآن</span></div>'+
        '<div class="tcb-i"><b>'+(c.approved_30||0)+'</b><span>اعتُمدت (٣٠ يوماً)</span></div>'+
        '<div class="tcb-i"><b>'+(c.rejected_30||0)+'</b><span>رُفضت (٣٠ يوماً)</span></div></div>';

      function card(r,i){
        var st=CST_AR[r.status]||r.status;
        var decided=['approved','rejected'].indexOf(r.status)>=0;
        var val=r.value||{};
        return '<div class="card cbc'+(decided?' done':'')+'" style="padding:11px 13px">'+
          '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px">'+
            '<div style="flex:1"><b>'+esc(r.who)+'</b> '+
              '<span class="chip">'+esc(CCAT_AR[r.category]||r.category)+'</span> '+
              '<span class="chip '+(r.status==='approved'?'green':(r.status==='rejected'?'red':'orange'))+'">'+esc(st)+'</span>'+
              (r.left_critical?' <span class="chip red">تركت مهمة حرجة</span>':'')+
              '<div class="small" style="margin-top:4px">'+esc(r.what||'—')+'</div>'+
              '<div class="muted small" style="margin-top:3px">'+fmtD(r.day)+
                (r.minutes?' · '+r.minutes+' دقيقة':'')+(r.area?' · '+esc(r.area):'')+
                (r.beneficiary?' · لصالح '+esc(r.beneficiary):'')+'</div>'+
            '</div>'+
            (val.value!=null?'<div class="cbv"><b>'+val.value+'</b><span>القيمة</span></div>':'')+
          '</div>'+
          /* الأسباب معروضة للإدارة فقط — الوثيقة تمنع كشف المعادلة للموظفات */
          ((val.reasons||[]).length?'<div class="cbwhy">'+val.reasons.map(function(x){
              return '<span>'+esc(x)+'</span>'; }).join('')+'</div>':'')+
          (r.confirm?'<div class="muted small">تأكيد الزميلة: '+
            esc({yes:'نعم',partial:'جزئياً',no:'لا'}[r.confirm]||r.confirm)+'</div>':'')+
          (decided
            ? '<div class="muted small" style="margin-top:6px">'+
              (r.status==='approved'?'اعتُمدت':'رُفضت')+'. القرار وصل الموظفة.</div>'
            : '<div class="btnrow" style="margin:8px 0 0">'+
              '<button class="btn sm" data-ok="'+i+'">اعتماد</button>'+
              '<button class="btn sm ghost red" data-no="'+i+'">رفض مع السبب</button></div>')+
          '</div>';
      }

      $('#cbList',v).innerHTML=
        (pending.length
          ? '<h3 style="margin:14px 2px 6px;font-size:14px">تنتظر قرارك ('+pending.length+')</h3>'+
            pending.map(function(r,i){ return card(r,i); }).join('')
          : '<div class="empty">لا مساهمة تنتظر قراراً في هذه المدة.</div>')+
        (done.length
          ? '<h3 style="margin:16px 2px 6px;font-size:14px;color:var(--muted)">مبتوت فيها ('+done.length+')</h3>'+
            done.slice(0, showAll?done.length:6).map(function(r,i){ return card(r,-1); }).join('')+
            (done.length>6?'<div class="btnrow"><button class="btn sm ghost block" id="cbMore">'+
              (showAll?'عرض أقل':'عرض الكل ('+done.length+')')+'</button></div>':'')
          : '');

      var mb=$('#cbMore',v); if(mb) mb.addEventListener('click', function(){ showAll=!showAll; load(); });
      $$('[data-ok]',v).forEach(function(b){ b.addEventListener('click', function(){
        var r=pending[+b.getAttribute('data-ok')]; if(!r) return;
        decide(r,'approve');
      });});
      $$('[data-no]',v).forEach(function(b){ b.addEventListener('click', function(){
        var r=pending[+b.getAttribute('data-no')]; if(!r) return;
        decide(r,'reject');
      });});
    });
  }

  function decide(r, dec){
    var isNo = dec==='reject';
    sheet(isNo?'رفض مساهمة '+r.who:'اعتماد مساهمة '+r.who,
      '<div class="muted small">'+esc(r.what||'')+'</div>'+
      '<label class="f">الدقائق المعتمدة</label>'+
      '<input class="f" id="cbMin" type="number" min="0" max="480" value="'+(+r.minutes||0)+'">'+
      '<label class="f">'+(isNo?'سبب الرفض (إلزامي — يصلها نصاً)':'ملاحظة للموظفة (اختياري)')+'</label>'+
      '<textarea class="f" id="cbNote" style="min-height:80px" placeholder="'+
        (isNo?'اشرحي لماذا لم تُعتمد — حقها أن تعرف':'مثال: تغطية حقيقية وفّرت افتتاحاً متأخراً')+'"></textarea>'+
      '<div class="btnrow"><button class="btn block'+(isNo?' ghost red':'')+'" id="cbGo">'+
      (isNo?'تأكيد الرفض':'اعتماد المساهمة')+'</button></div>',
      function(ov, close){
        $('#cbGo',ov).addEventListener('click', function(){
          var note=$('#cbNote',ov).value.trim();
          if(isNo && !note){ toast('اكتبي سبب الرفض — سيصل للموظفة نصاً', true); return; }
          busyWrap(this, function(){
            return aAct('contrib_decide',{id:r.id, decision:dec, minutes:$('#cbMin',ov).value, note:note})
              .then(function(x){
                if(x.ok){ close(); toast(isNo?'رُفضت وأُبلغت الموظفة':'اعتُمدت وأُبلغت الموظفة'); load(); }
                else toast(x.error||'خطأ', true);
              });
          });
        });
      });
  }
  $('#cbFrom',v).addEventListener('change', load);
  $('#cbTo',v).addEventListener('change', load);
  load();
};

/* ---------- التقييم الشهري ----------
   الرقم وحده يُساء استعماله. كل بُعد هنا يعرض أساسه الخام، ومن لم تكفِ
   أدلتها تُعلن قلة الأدلة بدل رقم يوحي بدقة غير موجودة. لا ترتيب علني. */
var EVD=[['ops','التشغيل','operations'],['reliability','الاعتمادية','reliability'],
         ['contribution','المبادرة','contribution'],['training','التدريب','training']];
function evBar(val, w){
  var pct = val==null ? 0 : Math.max(0, Math.min(100, +val));
  var cls = val==null ? 'na' : (pct>=80?'hi':(pct>=55?'mid':'lo'));
  return '<div class="evd"><span class="evd-l">'+esc(w)+'</span>'+
    '<span class="evd-bar '+cls+'"><i style="width:'+pct+'%"></i></span>'+
    '<span class="evd-v">'+(val==null?'—':Math.round(pct))+'</span></div>';
}
/* التقييم الشهري مؤجَّل حتى ثلاثين يوماً من تشغيل حقيقي.
   السبب مذكور للمالكة لا مخفيّ عنها: مدخلاته ساعاتٌ ومهامٌ مُقرَّة، ولم
   يُشغَّل النظام يوماً حقيقياً بعد. تقييمٌ بلا مدخلات يُنتج رقماً مُختلقاً
   يُقرأ على أنه حكم. لا حذف: الشاشة والدالّة والجدول كما هي، والراية
   واحدة (eval.enabled) تُعيدها في لحظة. */
ADMIN.evals=function(v){
  v.innerHTML=skel(2);
  aAct('settings_get',{}).then(function(sr){
    var ec=((sr&&sr.settings&&sr.settings.eval)||{});
    if(ec.enabled!==true){
      v.innerHTML='<div class="card"><h3>التقييم الشهري — مؤجَّل</h3>'+
        '<div class="muted small">يعتمد على ساعاتٍ ومهامٍ مُقرَّة من تشغيل حقيقي. '+
        'يُفتح بعد ثلاثين يوماً من بدء التشغيل الفعلي في المقهى، فيكون أول تقييم '+
        'مبنيّاً على عمل حقيقي لا على أرقامٍ ناقصة.</div>'+
        '<div class="muted small" style="margin-top:8px">لا شيء حُذف — الشاشة وحساباتها '+
        'وسجلّها كما هي، وتُفتح من الإعدادات متى قرّرتِ.</div></div>';
      return;
    }
    evalsRun(v);
  }).catch(function(){ v.innerHTML='<div class="empty">تعذّر تحميل الإعدادات</div>'; });
};
function evalsRun(v){
  v.innerHTML='<input class="f" id="evM" type="month" value="'+thisMonth()+'"><div id="evB" style="margin-top:10px">'+skel(3)+'</div>';
  function load(){
    aAct('month_eval',{month:$('#evM').value}).then(function(res){
      if(!res.ok){ $('#evB').innerHTML='<div class="empty">'+esc(res.error||'خطأ')+'</div>'; return; }
      var w=res.weights||{}, rows=res.rows||[];
      var out=['<div class="card soft" style="padding:10px 12px"><div class="muted small">'+
        esc(res.policy||'')+'<br>الأوزان: تشغيل '+(w.operations||45)+'٪ · اعتمادية '+(w.reliability||25)+
        '٪ · مبادرة '+(w.contribution||20)+'٪ · تدريب '+(w.training||10)+'٪ — تُعدَّل من الإعدادات.'+
        '</div></div>'];

      var scored=rows.filter(function(r){ return r.total!=null; });
      var unscored=rows.filter(function(r){ return r.total==null; });

      function card(r){
        var b=r.basis||{};
        return '<div class="card evc'+(r.total==null?' na':'')+'" style="padding:12px 13px">'+
          '<div class="row" style="justify-content:space-between;align-items:center">'+
            '<b>'+esc(r.employee)+'</b>'+
            (r.total!=null
              ? '<span class="evtot"><b>'+r.total+'</b><span>من ١٠٠</span></span>'
              : '<span class="chip orange">أدلة غير كافية</span>')+
          '</div>'+
          '<div class="muted small" style="margin-top:2px">'+(+r.shifts||0)+' شفت هذا الشهر</div>'+
          (r.total!=null
            ? '<div class="evds">'+EVD.map(function(d){ return evBar(r[d[0]], d[1]); }).join('')+'</div>'
            : '')+
          /* الأرقام الخام: من أين جاءت الدرجة فعلاً */
          '<div class="evbasis">'+
            '<span>مهام: <b>'+(b.tasks_done||0)+'</b>/'+(b.tasks_total||0)+
              (b.tasks_returned?' (مرجَعة '+b.tasks_returned+')':'')+'</span>'+
            '<span>تأخير: <b>'+(b.late_over_10||0)+'</b></span>'+
            '<span>نسيان بصمة: <b>'+(b.forgot_fixes||0)+'</b></span>'+
            '<span>فحوص فائتة: <b>'+(b.spotchecks_missed||0)+'</b></span>'+
            '<span>أسئلة تحقق فائتة: <b>'+(b.verify_missed||0)+'</b></span>'+
            '<span>مساهمات معتمدة: <b>'+(b.contrib_approved||0)+'</b></span>'+
            '<span>تدريب: <b>'+(b.trainings_delivered||0)+'</b></span>'+
            '<span>تغطيات: <b>'+(b.coverages||0)+'</b></span>'+
          '</div>'+
          ((r.notes||[]).length
            ? '<div class="evnotes">'+r.notes.map(function(n){ return '<div>'+esc(n)+'</div>'; }).join('')+'</div>'
            : '')+
        '</div>';
      }

      out.push(scored.length
        ? scored.map(card).join('')
        : '<div class="empty">لا تقييم قابل للإصدار هذا الشهر.</div>');
      if(unscored.length){
        out.push('<h3 style="margin:16px 2px 6px;font-size:14px;color:var(--muted)">لم تكتمل أدلتهن ('+unscored.length+')</h3>');
        out.push(unscored.map(card).join(''));
      }
      $('#evB').innerHTML=out.join('');
    });
  }
  $('#evM').addEventListener('change', load); load();
};

/* ---------- التقدير والجوائز ---------- */
ADMIN.awards=function(v){
  lookups(function(){
    var cats=['نجمة التشغيل','سيدة الهدوء وقت الضغط','المعلّمة','الأدق التزاماً','روح الفريق','الأكثر تطوراً','مبادرة الشهر'];
    v.innerHTML='<div class="card"><h3>إرسال تقدير فوري</h3>'+
      '<select class="f" id="rgE">'+staffOpts()+'</select>'+
      '<input class="f" id="rgT" style="margin-top:8px" placeholder="نص محدد: «إدارتك للفحم أمس وقت الذروة كانت مثالية»">'+
      '<div class="btnrow"><button class="btn block" id="rgGo">إرسال (يظهر لها وحدها)</button></div></div>'+
      '<div class="card"><h3>جائزة شهرية</h3>'+
      '<label class="f">الشهر</label><input class="f" id="awM" type="month" value="'+thisMonth()+'">'+
      '<label class="f">الموظفة</label><select class="f" id="awE">'+staffOpts()+'</select>'+
      '<label class="f">الفئة</label><select class="f" id="awC">'+cats.map(function(c){return '<option>'+c+'</option>';}).join('')+'</select>'+
      '<label class="f">عنوان علني (يصلها كتقدير)</label><input class="f" id="awT">'+
      '<label class="f">السبب الخاص (للإدارة فقط)</label><input class="f" id="awR">'+
      '<label class="f">المكافأة (اختياري)</label><input class="f" id="awW">'+
      '<div class="btnrow"><button class="btn orange block" id="awGo">حفظ الجائزة</button></div></div><div id="awList"></div>';
    $('#rgGo').addEventListener('click', function(){
      var t=$('#rgT').value.trim(); if(!t){toast('اكتبي نصاً محدداً',true);return;}
      var btn=this;
      busyWrap(btn, function(){
        return aAct('recognition_send',{employee_id:+$('#rgE').value, text:t}).then(function(r){
          if(r.ok){toast('وصلها التقدير');$('#rgT').value='';} else toast(r.error||'خطأ',true);
        });
      });
    });
    $('#awGo').addEventListener('click', function(){
      if(!$('#awM').value){ toast('حددي الشهر', true); return; }
      var btn=this;
      busyWrap(btn, function(){
        return aAct('award_save',{month:$('#awM').value, employee_id:+$('#awE').value, category:$('#awC').value, public_title:$('#awT').value, private_reason:$('#awR').value, reward:$('#awW').value})
          .then(function(r){ if(r.ok){toast('حُفظت ✔');loadList();} else toast(r.error||'خطأ',true); });
      });
    });
    var awAll=false;
    function loadList(){
      aAct('awards_list',{}).then(function(res){
        var all=res.awards||[], m=$('#awM')?$('#awM').value:'';
        var list=awAll?all:all.filter(function(a){return !m||a.month===m;});
        $('#awList').innerHTML='<div class="row" style="justify-content:space-between"><h3 style="margin:0">سجل الجوائز'+(awAll?'':' — '+esc(m||'الكل'))+'</h3>'+
          (all.length?'<button class="btn sm ghost" id="awTog">'+(awAll?'عرض الشهر المحدد':'عرض الكل')+'</button>':'')+'</div>'+
          (list.map(function(a){
            return '<div class="card" style="padding:9px 12px"><b>'+esc(a.employee)+'</b> — '+esc(a.category)+' <span class="chip">'+esc(a.month)+'</span>'+
              (a.public_title?'<div class="small">'+esc(a.public_title)+'</div>':'')+(a.reward?'<div class="small muted">'+esc(a.reward)+'</div>':'')+'</div>';
          }).join('')||'<div class="empty">لا جوائز بهذا الشهر</div>');
        var tg=$('#awTog'); if(tg) tg.addEventListener('click', function(){ awAll=!awAll; loadList(); });
      });
    }
    $('#awM').addEventListener('change', function(){ awAll=false; loadList(); });
    loadList();
  });
};

/* ---------- الطلبات والملاحظات ---------- */
ADMIN.requests=function(v){
  aAct('requests_list',{}).then(function(res){
    var out=[];
    var pend=(res.requests||[]).filter(function(r){return r.status==='pending';});
    out.push('<h3>طلبات تحتاج قرارك ('+pend.length+')</h3>');
    if(!pend.length) out.push('<div class="card center muted">لا طلبات معلقة</div>');
    pend.forEach(function(r){
      out.push('<div class="card" style="padding:10px 12px"><b>'+esc(r.employee)+'</b> — '+esc(r.type)+(r.date?' <span class="chip orange">'+esc(r.date)+'</span>':'')+'<div class="small">'+esc(r.details||'')+'</div><div class="muted small">'+fmtD(r.ts)+'</div>'+
        '<div class="btnrow"><button class="btn sm" data-rq="'+r.id+'" data-d="approved">قبول</button><button class="btn sm ghost red" data-rq="'+r.id+'" data-d="rejected">رفض</button></div></div>');
    });
    var notes=(res.notes||[]).filter(function(n){return !n.seen;});
    if(notes.length){
      out.push('<h3 style="margin-top:12px">ملاحظات جديدة</h3>');
      notes.forEach(function(n){
        out.push('<div class="card beige" style="padding:10px 12px"><b>'+esc(n.employee)+':</b> '+esc(n.text)+voicePlayHtml(n.voice,'ملاحظة صوتية')+'<div class="btnrow"><button class="btn sm ghost" data-nt="'+n.id+'">قرأتها ✔</button></div></div>');
      });
    }
    var done=(res.requests||[]).filter(function(r){return r.status!=='pending';}).slice(0,20);
    if(done.length){
      out.push('<h3 style="margin-top:12px">سجل الطلبات</h3>'+done.map(function(r){
        return '<div class="small" style="padding:4px 0;border-bottom:1px dashed var(--line)">'+esc(r.employee)+' — '+esc(r.type)+' <span class="chip '+(r.status==='approved'?'green':'red')+'">'+(REQSTAT[r.status]||r.status)+'</span></div>';
      }).join(''));
    }
    v.innerHTML=out.join('');
    $$('[data-rq]',v).forEach(function(b){ b.addEventListener('click', function(){
      var dec=b.getAttribute('data-d');
      inputSheet(dec==='approved'?'قبول الطلب':'رفض الطلب','ملاحظة للموظفة','تظهر للموظفة مع القرار',dec==='approved'?'قبول ✔':'رفض',function(note){
        aAct('request_decide',{id:+b.getAttribute('data-rq'), decision:dec, note:note||''}).then(function(){ toast(dec==='approved'?'قُبل الطلب ✔':'رُفض الطلب'); ADMIN.requests(v); });
      }, true);
    });});
    $$('[data-nt]',v).forEach(function(b){ b.addEventListener('click', function(){
      aAct('note_seen',{id:+b.getAttribute('data-nt')}).then(function(){ ADMIN.requests(v); });
    });});
  });
};

/* ---------- التسليمات ---------- */
ADMIN.handovers=function(v){
  v.innerHTML='<input class="f" id="hoDay" type="date" value="'+today()+'"><div id="hoB" style="margin-top:10px"></div>';
  function load(){
    aAct('handovers_day',{day:$('#hoDay').value}).then(function(res){
      $('#hoB').innerHTML=(res.handovers||[]).map(function(h){
        return '<div class="card" style="padding:10px 12px"><b>'+esc(h.from)+'</b> → <b>'+esc(h.to)+'</b> '+
          (h.status==='confirmed'?'<span class="chip green">مؤكَّد '+fmtT(h.confirmed)+'</span>':'<span class="chip orange">بانتظار التأكيد</span>')+
          (h.brief?handoverBriefCard(h.brief,true):'')+
          handoverItemsHtml(h.items)+voicePlayHtml(h.voice,'مذكرة صوتية من المسلِّمة')+(h.to_note?'<div class="small muted">ملاحظة المستلمة: '+esc(h.to_note)+'</div>':'')+'</div>';
      }).join('')||'<div class="empty">لا تسليمات بهذا اليوم</div>';
    });
  }
  $('#hoDay').addEventListener('change', load); load();
};

/* ---------- التقارير ---------- */
ADMIN.reports=function(v){
  var d=today(), d7=new Date(Date.now()-6*864e5), from=d7.getFullYear()+'-'+('0'+(d7.getMonth()+1)).slice(-2)+'-'+('0'+d7.getDate()).slice(-2);
  v.innerHTML='<div class="row">'+
    '<select class="f grow" id="rpT"><option value="attendance">الحضور والالتزام</option><option value="tasks">المهام</option><option value="pressure">الضغط</option><option value="coverage">التغطيات</option><option value="forgets">النسيان</option></select></div>'+
    '<div class="row" style="margin-top:8px"><input class="f grow" id="rpF" type="date" value="'+from+'"><input class="f grow" id="rpTo" type="date" value="'+d+'"><button class="btn sm" id="rpGo">عرض</button></div>'+
    '<div id="rpB" style="margin-top:10px"></div>';
  var COLS={employee:'الموظفة', days:'أيام حضور', late_times:'مرات التأخير', late_min:'دقائق التأخير',
    ot_min:'دقائق إضافية', early_min:'انصراف مبكر (د)', total:'الإجمالي', done:'منجزة', returned:'معادة',
    avg_net_min:'متوسط الصافي (د)', area:'المنطقة', day:'اليوم', peak:'ذروة الإشغال', updates:'التحديثات',
    support_calls:'نداءات الدعم', count:'العدد', kinds:'الأنواع'};
  function cellVal(x){ if(x===null||x===undefined) return '—'; if(typeof x==='object') return Array.isArray(x)?x.join('، '):JSON.stringify(x); return String(x); }
  $('#rpGo').addEventListener('click', function(){
    $('#rpB').innerHTML=skel(3);
    aAct('report',{type:$('#rpT').value, from:$('#rpF').value, to:$('#rpTo').value}).then(function(res){
      if(!res.ok){ $('#rpB').innerHTML='<div class="empty">'+esc(res.error||'خطأ')+'</div>'; return; }
      var rows=res.rows||[];
      if(!rows.length){ $('#rpB').innerHTML='<div class="empty">لا بيانات بهذا النطاق</div>'; return; }
      var keys=Object.keys(rows[0]);
      /* مؤشرات مختصرة أعلى التقرير */
      var SUMK=['days','late_min','ot_min','done','total','returned','count','support_calls','late_times'];
      var sums={}; keys.forEach(function(k){ if(SUMK.indexOf(k)>-1){ var s=0,num=true; rows.forEach(function(r){ var x=+r[k]; if(isNaN(x)) num=false; else s+=x; }); if(num) sums[k]=s; } });
      var kpiKeys=Object.keys(sums).slice(0,3);
      var kpi = kpiKeys.length ? '<div class="statrow three">'+kpiKeys.map(function(k){return '<div class="stat"><b class="num">'+sums[k]+'</b><span>'+esc(COLS[k]||k)+' (إجمالي)</span></div>';}).join('')+'</div>' : '';
      /* بطاقات قابلة للتوسعة بدل جدول كثيف */
      var TITLE_KEYS=['employee','area','day'];
      var tk=null; TITLE_KEYS.forEach(function(k){ if(!tk && keys.indexOf(k)>-1) tk=k; }); tk=tk||keys[0];
      var rest=keys.filter(function(k){return k!==tk;});
      $('#rpB').innerHTML=kpi+
        '<div class="btnrow" style="margin-bottom:8px"><span class="chip">'+rows.length+' سجل</span><button class="btn sm ghost" id="rpCsv">تصدير CSV</button></div>'+
        rows.map(function(r){
          var top=rest.slice(0,2).map(function(k){return esc(COLS[k]||k)+': <b class="num">'+esc(cellVal(r[k]))+'</b>';}).join(' · ');
          return '<details class="qa"><summary><span>'+esc(cellVal(r[tk]))+'<span class="nl-sub" style="display:block;font-size:12px;font-weight:400;color:var(--muted)">'+top+'</span></span></summary><div class="qa-body">'+
            rest.map(function(k){ return '<div class="row" style="justify-content:space-between;border-bottom:1px dashed var(--line);padding:5px 0"><span class="muted small">'+esc(COLS[k]||k)+'</span><b class="num">'+esc(cellVal(r[k]))+'</b></div>'; }).join('')+
          '</div></details>';
        }).join('');
      $('#rpCsv').addEventListener('click', function(){
        var lines=[keys.map(function(k){return '"'+(COLS[k]||k).replace(/"/g,'""')+'"';}).join(',')];
        rows.forEach(function(r){ lines.push(keys.map(function(k){ return '"'+cellVal(r[k]).replace(/"/g,'""')+'"'; }).join(',')); });
        var blob=new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
        var aL=document.createElement('a');
        aL.href=URL.createObjectURL(blob);
        aL.download='تقرير-'+$('#rpT').value+'-'+$('#rpF').value+'-'+$('#rpTo').value+'.csv';
        document.body.appendChild(aL); aL.click();
        setTimeout(function(){ URL.revokeObjectURL(aL.href); aL.remove(); }, 500);
      });
    });
  });
};

/* ---------- قصة اليوم (Timeline) ---------- */
ADMIN.timeline=function(v){
  v.innerHTML='<div class="row"><input class="f grow" id="tlDay" type="date" value="'+today()+'"><button class="btn sm" id="tlGo">عرض</button></div><div id="tlB" style="margin-top:12px"></div>';
  var KIND={in:['حضور','g'],out:['انصراف','w'],task:['مهمة','g'],recurring:['متكررة','g'],help:['مساعدة','o'],issue:['بلاغ','o'],miss:['فحص فائت','r']};
  function load(){
    aAct('timeline',{day:$('#tlDay').value}).then(function(res){
      var ev=res.events||[];
      if(!ev.length){ $('#tlB').innerHTML='<div class="empty">لا أحداث بهذا اليوم</div>'; return; }
      $('#tlB').innerHTML='<div class="tl">'+ev.map(function(e){ var k=KIND[e.kind]||['',''];
        return '<div class="tl-i"><div class="tl-dot '+k[1]+'"></div><div class="tl-c"><div class="tl-t">'+fmtT(e.ts)+' <span class="chip">'+k[0]+'</span></div><div>'+(e.who?'<b>'+esc(e.who)+'</b> — ':'')+esc(e.text)+'</div></div></div>';
      }).join('')+'</div>';
    });
  }
  $('#tlGo').addEventListener('click', load); load();
};

/* ---------- نبض الفريق (Wellbeing) ---------- */
ADMIN.pulse=function(v){
  aAct('pulse_overview',{}).then(function(res){
    if(!res.ok){ v.innerHTML='<div class="empty">خطأ</div>'; return; }
    var em=function(l){ return l?'<span style="display:inline-block;vertical-align:-4px;color:var(--amber)">'+moodFace(l,18)+'</span>':''; };
    var out=[];
    out.push('<div class="statgrid"><div class="stat"><div class="v">'+(res.today_avg!=null?res.today_avg:'—')+'</div><div class="l">مزاج اليوم /5</div></div>'+
      '<div class="stat"><div class="v">'+(res.today_count||0)+'</div><div class="l">شاركن اليوم</div></div>'+
      '<div class="stat'+((res.low_streak||0)>=3?' bad':'')+'"><div class="v">'+(res.low_streak||0)+'</div><div class="l">أيام منخفضة (7)</div></div></div>');
    if((res.low_streak||0)>=3) out.push('<div class="alert high">مؤشر إرهاق: مزاج الفريق منخفض عدة أيام — بادري بالتخفيف والتقدير.</div>');
    var tr=res.trend||[]; if(tr.length){
      var mx=5, bars=tr.map(function(t){ var h=Math.round((t.avg/mx)*60); return '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px"><div style="width:70%;height:'+h+'px;background:linear-gradient(180deg,var(--amber-2),var(--amber));border-radius:4px"></div><div class="muted" style="font-size:9px">'+(''+t.day).slice(8)+'</div></div>'; }).join('');
      out.push('<div class="card"><h3>اتجاه المزاج (أسبوعان)</h3><div style="display:flex;gap:4px;height:80px;align-items:flex-end">'+bars+'</div></div>');
    }
    out.push('<div class="card"><h3>ملاحظات سرية من الفريق</h3>'+((res.recent_notes||[]).length?res.recent_notes.map(function(n){return '<div style="padding:5px 0;border-bottom:1px dashed var(--line)">'+em(n.mood)+' '+esc(n.note)+'<div class="muted small">'+fmtD(n.ts)+'</div></div>';}).join(''):'<div class="muted small">لا ملاحظات</div>')+'</div>');
    v.innerHTML=out.join('');
  });
};

/* ---------- بثّ صوتي من الإدارة للفريق ---------- */
var ADMCAST={recording:false,t0:0};
function admCastStart(btn){
  if(ADMCAST.recording) return;
  if(!recSupported()){ toast('التسجيل غير مدعوم هنا',true); return; }
  ADMCAST.recording=true; ADMCAST.t0=Date.now(); btn.classList.add('rec'); btn.textContent='يسجّل… أفلتي للإرسال'; recOverlay(true);
  clearTimeout(ADMCAST._max); ADMCAST._max=setTimeout(function(){ if(ADMCAST.recording) admCastStop(btn); }, 15000);
  recStart().then(function(){ if(!ADMCAST.recording){ recStop(); recOverlay(false); } })
   .catch(function(){ ADMCAST.recording=false; recOverlay(false); btn.classList.remove('rec'); btn.textContent='اضغطي مع الاستمرار للبثّ الصوتي'; toast('اسمحي بالوصول للميكروفون',true); });
}
function admCastStop(btn){
  if(!ADMCAST.recording) return;
  ADMCAST.recording=false; clearTimeout(ADMCAST._max); btn.classList.remove('rec'); recOverlay(false);
  var dur=(Date.now()-ADMCAST.t0)/1000; var wav=recStop();
  var reset=function(){ btn.textContent='اضغطي مع الاستمرار للبثّ الصوتي'; };
  if(!wav || dur<0.35){ reset(); return; }
  if(wav.length>420000){ toast('المقطع طويل — أبقيه أقصر',true); reset(); return; }
  btn.textContent='… يُرسل';
  aAct('ptt_broadcast',{audio:wav,dur:Math.round(dur*10)/10}).then(function(r){
    if(r&&r.ok){ toast('وصل بثّك لـ '+(r.reached||0)+' على الشفت'); }
    else toast((r&&r.error)||'تعذّر البثّ',true); reset();
  }).catch(function(){ toast('لا اتصال',true); reset(); });
}
/* ---------- خريطة النشاط بالمناطق (منطقة × ساعة من أحداث حقيقية) ---------- */
ADMIN.heat=function(v){
  v.innerHTML='<div class="row"><input class="f grow" id="htDay" type="date" value="'+today()+'"><button class="btn sm" id="htGo">عرض</button></div><div id="htB" style="margin-top:10px">'+skel(2)+'</div>';
  function load(){
    $('#htB').innerHTML=skel(2);
    aAct('activity_map',{day:$('#htDay').value}).then(function(res){
      var cells=res.cells||[], b=$('#htB'); if(!b) return;
      if(!cells.length){ b.innerHTML='<div class="empty">لا نشاط مسجّل بهذا اليوم</div>'; return; }
      var areas=[], hset={}, maxc=1, key={};
      cells.forEach(function(c){ if(areas.indexOf(c.area)<0) areas.push(c.area); hset[c.hour]=1; if(c.count>maxc) maxc=c.count; key[c.area+'|'+c.hour]=c; });
      var hours=Object.keys(hset).map(Number).sort(function(a,b2){return a-b2;});
      var h0=hours[0], h1=hours[hours.length-1], allH=[]; for(var h=h0;h<=h1;h++) allH.push(h);
      var html='<div class="card soft" style="padding:9px 12px"><div class="muted small">خريطة مبنية من أحداث حقيقية (مهام، متكررة، نداءات، ضغط، تحضير، حضور/انصراف) — كل خلية: منطقة×ساعة، الأغمق = نشاط أكثر. اضغطي أي خلية للتفاصيل. كلما ربطتِ الشفتات بالمناطق صارت أدق.</div></div>';
      html+='<div class="scrollx"><table class="tbl" style="min-width:'+(90+allH.length*44)+'px"><tr><th>المنطقة</th>'+allH.map(function(h){return '<th style="text-align:center">'+h+'</th>';}).join('')+'</tr>';
      areas.forEach(function(a){
        html+='<tr><td style="white-space:nowrap"><b>'+esc(a)+'</b></td>'+allH.map(function(h){
          var c=key[a+'|'+h];
          if(!c) return '<td></td>';
          var alpha=(0.14+0.86*(c.count/maxc)).toFixed(2);
          return '<td style="text-align:center;padding:0"><button class="htc" data-a="'+esc(a)+'" data-h="'+h+'" style="width:100%;height:38px;border:none;cursor:pointer;font-weight:700;color:'+(c.count/maxc>0.55?'#fff':'var(--ink)')+';background:rgba(224,137,31,'+alpha+')">'+c.count+'</button></td>';
        }).join('')+'</tr>';
      });
      html+='</table></div>';
      b.innerHTML=html;
      $$('.htc',b).forEach(function(bt){ bt.addEventListener('click', function(){
        var c=key[bt.getAttribute('data-a')+'|'+bt.getAttribute('data-h')]; if(!c) return;
        var kinds=c.kinds||{};
        sheet('نشاط '+esc(c.area)+' — الساعة '+c.hour+':00',
          '<div class="row" style="margin-bottom:8px">'+(c.emps||[]).map(function(nm){return '<span class="chip green">'+esc(nm)+'</span>';}).join('')+'</div>'+
          Object.keys(kinds).map(function(k){ return '<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px dashed var(--line)"><span>'+esc(k)+'</span><b>'+kinds[k]+'</b></div>'; }).join(''));
      }); });
    });
  }
  $('#htGo').addEventListener('click', load);
  $('#htDay').addEventListener('change', load);
  load();
};

/* ---------- محطة التحضير (Mise en Place) ---------- */
/* ---------- مشرف الشفت: الجاهزية والسلامة ---------- */
function opsAreaOpts(sel){ return '<option value="">كل المناطق</option>'+(A.areas||[]).map(function(a){return '<option value="'+a.id+'"'+((sel!=null&&sel==a.id)?' selected':'')+'>'+esc(a.name)+'</option>';}).join(''); }
function opsTypeOpts(sel){ return '<option value="">كل الأنواع</option>'+(A.types||[]).map(function(t){return '<option value="'+t.id+'"'+((sel!=null&&sel==t.id)?' selected':'')+'>'+esc(t.name)+'</option>';}).join(''); }
ADMIN.ops=function(v){
  v.innerHTML='<div class="btnrow" style="flex-wrap:wrap"><button class="btn sm ghost" data-oc="ready">بنود الجاهزية</button><button class="btn sm ghost" data-oc="temp">أجهزة التبريد</button><button class="btn sm ghost" data-oc="log">سجل الحرارة</button></div><div id="opB">'+skel(3)+'</div>';
  function load(){
    aAct('ops_overview',{day:today()}).then(function(r){
      var out='', temps=r.temps||[];
      out+='<h3>سلامة الغذاء — الحرارة</h3>';
      if(!temps.length) out+='<div class="card muted small">لا أجهزة تبريد مُعرّفة بعد — أضيفيها من «أجهزة التبريد».</div>';
      temps.forEach(function(t){
        var last=t.last, cls=(t.today_out>0)?'red':(t.overdue?'orange':'green');
        out+='<div class="card" style="padding:11px 13px"><div class="row" style="justify-content:space-between"><b>'+esc(t.name)+'</b>'+
          '<span class="chip '+cls+'">'+(t.today_out>0?t.today_out+' خارج النطاق':(t.overdue?'فحص متأخّر':'منضبطة'))+'</span></div>'+
          '<div class="muted small">'+esc(t.area||'—')+' · النطاق '+t.min+' إلى '+t.max+'°C · كل '+t.interval+' د · '+t.today_readings+' قراءة اليوم</div>'+
          (last?'<div class="small" style="margin-top:3px">آخر قراءة: <b style="color:'+(last.in_range?'var(--green)':'var(--red)')+'">'+last.reading+'°</b> — '+esc(last.who||'')+' '+fmtT(last.ts)+'</div>':'<div class="small muted" style="margin-top:3px">لا قراءات اليوم</div>')+'</div>';
      });
      var shifts=r.shifts||[];
      out+='<h3 style="margin-top:12px">جاهزية الشفتات اليوم</h3>';
      if(!shifts.length) out+='<div class="card muted small">لا شفتات نشطة اليوم.</div>';
      shifts.forEach(function(s){
        out+='<div class="card" style="padding:10px 12px"><div class="row" style="justify-content:space-between"><b>'+esc(s.employee)+'</b><span class="muted small">'+esc(s.area||'')+'</span></div>'+
          '<div class="row" style="gap:6px;margin-top:5px"><span class="chip '+(s.opening_fail>0?'red':(s.opening_ok>0?'green':''))+'">افتتاح: '+s.opening_ok+' مطابق'+(s.opening_fail>0?' · '+s.opening_fail+' مشكلة':'')+'</span>'+
          '<span class="chip '+(s.closing_ok>0?'green':'')+'">إغلاق: '+s.closing_ok+'</span></div></div>';
      });
      var fails=r.fails||[];
      if(fails.length){
        out+='<h3 style="margin-top:12px">بنود غير مطابقة اليوم</h3>';
        fails.forEach(function(f){
          out+='<div class="card beige" style="padding:9px 12px"><b>'+esc(f.label)+'</b> <span class="chip">'+(f.phase==='opening'?'افتتاح':'إغلاق')+'</span><div class="small muted">'+esc(f.who||'')+' · '+fmtT(f.ts)+(f.note?' — '+esc(f.note):'')+'</div></div>';
        });
      }
      $('#opB').innerHTML=out;
    });
  }
  $$('[data-oc]',v).forEach(function(b){ b.addEventListener('click', function(){
    var k=b.getAttribute('data-oc');
    if(k==='ready') opsReadyConfig(load); else if(k==='temp') opsTempConfig(load); else opsTempLog();
  }); });
  load();
};
function opsReadyConfig(after){
  aAct('readiness_items',{}).then(function(r){
    var rows=r.rows||[];
    function list(ph){ return rows.filter(function(x){return x.phase===ph;}).map(function(it){
      return '<div class="card" style="padding:9px 12px"><div class="row" style="justify-content:space-between"><b>'+esc(it.label)+'</b><span>'+(it.critical?'<span class="chip red">حرج</span>':'')+(it.active?'':' <span class="chip">معطّل</span>')+'</span></div>'+
        '<div class="muted small">'+esc(it.area||'كل المناطق')+' · '+esc(it.type||'كل الأنواع')+'</div>'+
        '<div class="btnrow"><button class="btn sm ghost" data-redit="'+it.id+'">تعديل</button><button class="btn sm ghost red" data-rdel="'+it.id+'">حذف</button></div></div>';
    }).join('')||'<div class="muted small">لا بنود</div>'; }
    sheet('بنود الجاهزية',
      '<div class="muted small" style="margin-bottom:6px">قوائم يؤكّدها الفريق قبل الافتتاح وعند الإغلاق. البند «الحرج» يمنع اعتماد الجاهزية إن لم يُطابَق.</div>'+
      '<div class="btnrow"><button class="btn sm" id="rAdd">+ بند جديد</button></div>'+
      '<h3>الافتتاح</h3>'+list('opening')+'<h3 style="margin-top:10px">الإغلاق</h3>'+list('closing'),
      function(ov, close){
        function editor(it){
          it=it||{};
          sheet(it.id?'تعديل بند':'بند جديد',
            '<label class="f">المرحلة</label><select class="f" id="riPhase"><option value="opening"'+(it.phase==='closing'?'':' selected')+'>الافتتاح</option><option value="closing"'+(it.phase==='closing'?' selected':'')+'>الإغلاق</option></select>'+
            '<label class="f">البند</label><input class="f" id="riLabel" value="'+esc(it.label||'')+'">'+
            '<label class="f">المنطقة</label><select class="f" id="riArea">'+opsAreaOpts(it.area_id)+'</select>'+
            '<label class="f">نوع الشفت</label><select class="f" id="riType">'+opsTypeOpts(it.shift_type_id)+'</select>'+
            '<label class="row" style="gap:8px;margin-top:8px"><input type="checkbox" id="riCrit"'+(it.critical!==false?' checked':'')+'> حرج (يمنع الجاهزية إن لم يُطابَق)</label>'+
            '<label class="row" style="gap:8px"><input type="checkbox" id="riAct"'+(it.active!==false?' checked':'')+'> مفعّل</label>'+
            '<label class="f">الترتيب</label><input class="f" id="riSort" type="number" value="'+(it.sort||0)+'">'+
            '<div class="btnrow"><button class="btn block" id="riGo">حفظ</button></div>',
            function(ov2, close2){
              $('#riGo',ov2).addEventListener('click', function(){
                var lbl=$('#riLabel',ov2).value.trim(); if(!lbl){toast('اكتبي البند',true);return;}
                busyWrap(this, function(){ return aAct('readiness_item_save',{id:it.id||'', phase:$('#riPhase',ov2).value, label:lbl,
                  area_id:$('#riArea',ov2).value, shift_type_id:$('#riType',ov2).value,
                  critical:$('#riCrit',ov2).checked, active:$('#riAct',ov2).checked, sort:+$('#riSort',ov2).value||0}).then(function(res){
                  if(res.ok){ close2(); close(); opsReadyConfig(after); } else toast(res.error||'خطأ',true);
                }); });
              });
            });
        }
        $('#rAdd',ov).addEventListener('click', function(){ editor(null); });
        $$('[data-redit]',ov).forEach(function(b){ b.addEventListener('click', function(){ var it=null; rows.forEach(function(x){if(x.id==+b.getAttribute('data-redit'))it=x;}); editor(it); }); });
        $$('[data-rdel]',ov).forEach(function(b){ b.addEventListener('click', function(){ if(!confirm('حذف البند؟'))return; aAct('readiness_item_delete',{id:+b.getAttribute('data-rdel')}).then(function(){ close(); opsReadyConfig(after); }); }); });
      });
  });
}
function opsTempConfig(after){
  aAct('temp_assets',{}).then(function(r){
    var rows=r.rows||[];
    sheet('أجهزة التبريد',
      '<div class="muted small" style="margin-bottom:6px">لكل جهاز نطاق حرارة مسموح وفترة فحص. القراءة خارج النطاق تُنشئ بلاغاً عاجلاً تلقائياً.</div>'+
      '<div class="btnrow"><button class="btn sm" id="tAdd">+ جهاز جديد</button></div>'+
      (rows.map(function(it){
        return '<div class="card" style="padding:9px 12px"><div class="row" style="justify-content:space-between"><b>'+esc(it.name)+'</b>'+(it.active?'':'<span class="chip">معطّل</span>')+'</div>'+
          '<div class="muted small">'+esc(it.area||'—')+' · '+it.min+' إلى '+it.max+'°C · كل '+it.interval+' د</div>'+
          '<div class="btnrow"><button class="btn sm ghost" data-tedit="'+it.id+'">تعديل</button><button class="btn sm ghost red" data-tdel="'+it.id+'">حذف</button></div></div>';
      }).join('')||'<div class="muted small">لا أجهزة</div>'),
      function(ov, close){
        function editor(it){
          it=it||{};
          sheet(it.id?'تعديل جهاز':'جهاز جديد',
            '<label class="f">الاسم</label><input class="f" id="taName" value="'+esc(it.name||'')+'" placeholder="مثال: ثلاجة المطبخ">'+
            '<label class="f">المنطقة</label><select class="f" id="taArea">'+opsAreaOpts(it.area_id)+'</select>'+
            '<div class="row"><div class="grow"><label class="f">أدنى °C</label><input class="f" id="taMin" type="number" step="0.1" value="'+(it.min!=null?it.min:1)+'"></div><div class="grow"><label class="f">أعلى °C</label><input class="f" id="taMax" type="number" step="0.1" value="'+(it.max!=null?it.max:5)+'"></div></div>'+
            '<label class="f">الفترة بين الفحوصات (دقائق)</label><input class="f" id="taInt" type="number" value="'+(it.interval||240)+'">'+
            '<label class="row" style="gap:8px;margin-top:8px"><input type="checkbox" id="taAct"'+(it.active!==false?' checked':'')+'> مفعّل</label>'+
            '<div class="btnrow"><button class="btn block" id="taGo">حفظ</button></div>',
            function(ov2, close2){
              $('#taGo',ov2).addEventListener('click', function(){
                var nm=$('#taName',ov2).value.trim(); if(!nm){toast('اكتبي الاسم',true);return;}
                busyWrap(this, function(){ return aAct('temp_asset_save',{id:it.id||'', name:nm, area_id:$('#taArea',ov2).value,
                  min:$('#taMin',ov2).value, max:$('#taMax',ov2).value, interval:+$('#taInt',ov2).value||240, active:$('#taAct',ov2).checked}).then(function(res){
                  if(res.ok){ close2(); close(); opsTempConfig(after); } else toast(res.error||'خطأ',true);
                }); });
              });
            });
        }
        $('#tAdd',ov).addEventListener('click', function(){ editor(null); });
        $$('[data-tedit]',ov).forEach(function(b){ b.addEventListener('click', function(){ var it=null; rows.forEach(function(x){if(x.id==+b.getAttribute('data-tedit'))it=x;}); editor(it); }); });
        $$('[data-tdel]',ov).forEach(function(b){ b.addEventListener('click', function(){ if(!confirm('حذف الجهاز؟'))return; aAct('temp_asset_delete',{id:+b.getAttribute('data-tdel')}).then(function(){ close(); opsTempConfig(after); }); }); });
      });
  });
}
function opsTempLog(){
  var d7=addDays(today(),-7);
  sheet('سجل الحرارة (سلامة الغذاء)',
    '<div class="row"><input class="f grow" id="tlFrom" type="date" value="'+d7+'"><input class="f grow" id="tlTo" type="date" value="'+today()+'"><button class="btn sm" id="tlGo">عرض</button></div><div id="tlB" style="margin-top:10px">'+skel(2)+'</div>',
    function(ov){
      function load(){
        aAct('temp_log_range',{from:$('#tlFrom',ov).value, to:$('#tlTo',ov).value}).then(function(r){
          $('#tlB',ov).innerHTML=(r.rows||[]).map(function(l){
            return '<div class="card" style="padding:8px 11px"><div class="row" style="justify-content:space-between"><b>'+esc(l.asset)+'</b><span class="chip '+(l.in_range?'green':'red')+'">'+l.reading+'°'+(l.in_range?'':' خارج النطاق')+'</span></div><div class="muted small">'+esc(l.who||'')+' · '+fmtD(l.ts)+' '+fmtT(l.ts)+' · النطاق '+l.min+'–'+l.max+'°'+(l.note?' — '+esc(l.note):'')+'</div></div>';
          }).join('')||'<div class="empty">لا قراءات بهذا النطاق</div>';
        });
      }
      $('#tlGo',ov).addEventListener('click', load); load();
    });
}
ADMIN.prep=function(v){
  lookups(function(){
    Promise.all([aAct('prep_overview',{}), aAct('prep_items',{})]).then(function(rs){
      var ov=rs[0]||{}, items=(rs[1]&&rs[1].rows)||[];
      var out=['<div class="card soft" style="padding:10px 12px"><div class="muted small">أصناف التحضير (عصائر، صوصات…) بصلاحية محددة. النظام يحسب الانتهاء تلقائياً، يوسم المنتهي، يولّد مهمة «تحضير» عند الحاجة لمن هي على الشفت، ويسجّل الهدر. الساعة هي الحكم — لا أحد «يبلّغ» عن أحد.</div></div>'];
      // لوحة النضارة
      var board=ov.board||[];
      out.push('<h3 style="margin:12px 2px 6px">لوحة النضارة الآن</h3>');
      if(!board.length) out.push('<div class="muted small" style="margin:0 2px 8px">لا شافات محضّرة حالياً</div>');
      board.forEach(function(b){
        var cls=b.state==='expired'?'red':(b.state==='near'?'orange':'green');
        var lbl=b.state==='expired'?'منتهية':(b.state==='near'?'تقارب الانتهاء':'طازجة');
        out.push('<div class="card" style="padding:9px 12px"><div class="row" style="justify-content:space-between"><div><b>'+esc(b.item)+'</b> <span class="chip">'+esc(b.code)+'</span>'+(b.cosigned?' <span class="chip green">توقيع مزدوج</span>':'')+
          '<div class="muted small">'+esc(b.by)+' · حُضّرت '+fmtD(b.prepared_at)+' '+fmtT(b.prepared_at)+' · تنتهي '+fmtD(b.expires_at)+' '+fmtT(b.expires_at)+(b.qty?' · '+b.qty+' '+esc(b.unit||''):'')+'</div></div>'+
          '<span class="chip '+cls+'">'+lbl+'</span></div></div>');
      });
      // سجل الهدر
      var waste=ov.waste||[];
      if(waste.length){
        out.push('<div class="card"><h3>سجل الهدر (14 يوماً)</h3><div class="muted small" style="margin-bottom:4px">تكرار الإتلاف يعني كمية التحضير أكبر من الحاجة — قلّليها.</div>'+
          waste.map(function(wx){ return '<div class="row" style="justify-content:space-between;padding:3px 0;border-bottom:1px dashed var(--line)"><span>'+esc(wx.item)+'</span><span class="chip red">'+wx.count+' مرة</span></div>'; }).join('')+'</div>');
      }
      // الأصناف
      out.push('<div class="row" style="justify-content:space-between;margin-top:12px"><h3 style="margin:0">الأصناف</h3><button class="btn sm" id="ppNew">+ صنف</button></div>');
      if(!items.length) out.push('<div class="muted small" style="margin:6px 2px">أضيفي أول صنف (مثال: عصير ليمون — 72 ساعة)</div>');
      items.forEach(function(it){
        out.push('<div class="card" style="padding:9px 12px'+(it.active?'':';opacity:.5')+'"><div class="row" style="justify-content:space-between"><div><b>'+esc(it.name)+'</b><div class="muted small">صلاحية '+(it.shelf_hours>=48? (Math.round(it.shelf_hours/24))+' أيام' : it.shelf_hours+' ساعة')+' · '+esc(it.area||'يراها الجميع')+' · طازج الآن: '+(it.fresh||0)+'</div></div>'+
          '<button class="btn sm ghost" data-pped="'+it.id+'">تعديل</button></div></div>');
      });
      v.innerHTML=out.join('');
      function form(it){
        sheet(it?'تعديل الصنف':'صنف تحضير جديد',
          '<label class="f">الاسم</label><input class="f" id="pfN" placeholder="مثال: عصير ليمون" value="'+(it?esc(it.name):'')+'">'+
          '<div class="row"><div class="grow"><label class="f">الصلاحية (أيام)</label><input class="f" id="pfD" type="number" step="0.5" value="'+(it?Math.round(it.shelf_hours/24*10)/10:3)+'"></div>'+
          '<div class="grow"><label class="f">الوحدة</label><input class="f" id="pfU" value="'+(it?esc(it.unit||'لتر'):'لتر')+'"></div></div>'+
          '<label class="f">من يراها؟</label><select class="f" id="pfA"><option value="">كل الموظفات</option>'+ (A.areas||[]).map(function(a){ return '<option value="'+a.id+'"'+(it&&it.area_id===a.id?' selected':'')+'>منطقة: '+esc(a.name)+' فقط</option>'; }).join('')+'</select>'+
          (it?'<div class="check"><input type="checkbox" id="pfAct" '+(it.active?'checked':'')+'><span>مفعّل</span></div>':'')+
          (it?'<div class="btnrow"><button class="btn sm ghost red" id="pfDel" type="button">حذف الصنف</button></div>':'')+
          '<div class="btnrow"><button class="btn block" id="pfGo">حفظ</button></div>',
          function(ovv, close){
            if(it){ $('#pfDel',ovv).addEventListener('click', function(){ if(!confirm('حذف الصنف وكل شافاته؟')) return;
              busyWrap(this, function(){ return aAct('prep_item_delete',{id:it.id}).then(function(){ close(); ADMIN.prep(v); }); }); }); }
            $('#pfGo',ovv).addEventListener('click', function(){
              var nm=$('#pfN',ovv).value.trim(); if(!nm){ toast('اكتبي اسم الصنف',true); return; }
              var p={name:nm, shelf_hours:Math.max(1, Math.round((+$('#pfD',ovv).value||3)*24)), unit:$('#pfU',ovv).value, area_id:$('#pfA',ovv).value||null};
              if(it){ p.id=it.id; p.active=$('#pfAct',ovv).checked; }
              busyWrap(this, function(){ return aAct('prep_item_save',p).then(function(r){ if(r.ok){ close(); ADMIN.prep(v); toast('تم ✔'); } else toast(r.error||'خطأ',true); }); });
            });
          });
      }
      $('#ppNew').addEventListener('click', function(){ form(null); });
      $$('[data-pped]',v).forEach(function(b){ b.addEventListener('click', function(){ var it=null; items.forEach(function(x){ if(x.id===+b.getAttribute('data-pped')) it=x; }); form(it); }); });
    });
  });
};

/* ---------- تبديل وتغطية الشفتات ---------- */
ADMIN.cover=function(v){
  function load(){
    v.innerHTML=skel(2);
    aAct('cover_pending',{}).then(function(res){
      var rows=res.rows||[];
      var out=['<div class="card soft" style="padding:10px 12px"><div class="muted small">طلبات التغطية والتبديل بانتظار اعتمادكِ. الاعتماد يعيد إسناد الشفت تلقائياً ويُشعر الطرفين.</div></div>'];
      if(!rows.length) out.push('<div class="empty">لا طلبات معلّقة</div>');
      rows.forEach(function(c){
        out.push('<div class="card" style="padding:10px 12px"><b>'+esc(c.requester)+'</b> '+(c.kind==='swap'?'<span class="chip">تبديل</span>':'<span class="chip">تغطية</span>')+
          '<div class="small">'+fmtD(c.day)+' '+fmtHM(c.start)+'→'+fmtHM(c.end)+(c.area?' · '+esc(c.area):'')+'</div>'+
          '<div class="small">المتطوعة: <b>'+esc(c.volunteer||'—')+'</b>'+(c.give_day?' · تعطي بالمقابل '+fmtD(c.give_day):'')+'</div>'+
          (c.reason?'<div class="muted small">'+esc(c.reason)+'</div>':'')+
          '<div class="btnrow"><button class="btn sm" data-cvok="'+c.id+'">اعتماد ✔</button><button class="btn sm ghost red" data-cvno="'+c.id+'">رفض</button></div></div>');
      });
      v.innerHTML=out.join('');
      $$('[data-cvok]',v).forEach(function(b){ b.addEventListener('click', function(){ busyWrap(b, function(){ return aAct('cover_decide',{id:+b.getAttribute('data-cvok'),approve:true}).then(function(r){ if(r.ok){toast('اعتُمد وأُعيد الإسناد ✔');load();} else toast(r.error||'خطأ',true); }); }); }); });
      $$('[data-cvno]',v).forEach(function(b){ b.addEventListener('click', function(){ busyWrap(b, function(){ return aAct('cover_decide',{id:+b.getAttribute('data-cvno'),approve:false}).then(function(){ toast('رُفض'); load(); }); }); }); });
    });
  }
  load();
};

/* ---------- سجل التخاطب الصوتي (آخر 24 ساعة) ---------- */
ADMIN.ptt=function(v){
  function load(){
    v.innerHTML=skel(3);
    aAct('ptt_log',{}).then(function(r){
      if(!r.ok){ v.innerHTML='<div class="empty">'+esc(r.error||'خطأ')+'</div>'; return; }
      var cl=r.clips||[];
      var out=['<div class="card"><h3>بثّ صوتي للفريق</h3><div class="muted small" style="margin-bottom:8px">اضغطي مع الاستمرار وتحدّثي، وعند الإفلات يصل صوتك فوراً لكل من على الشفت الآن (ويصلهن إشعار إن كان التطبيق مغلقاً).</div><button id="admCast" class="btn block" style="touch-action:none;user-select:none">اضغطي مع الاستمرار للبثّ الصوتي</button></div>',
        '<div class="card soft" style="padding:10px 12px"><div class="muted small">كل النداءات الصوتية (بين الموظفات ومن الإدارة) محفوظة هنا 24 ساعة فقط ثم تُحذف تلقائياً.</div></div>'];
      if(!cl.length) out.push('<div class="empty">لا نداءات في آخر 24 ساعة</div>');
      cl.forEach(function(c){
        out.push('<div class="card" style="padding:10px 12px"><div class="row" style="justify-content:space-between;align-items:center">'+
          '<div><b>'+esc(c.from)+'</b> '+(c.to?'<span class="muted">→ '+esc(c.to)+'</span>':'<span class="chip">للجميع</span>')+
          (c.area?' <span class="chip">'+esc(c.area)+'</span>':'')+
          '<div class="muted small">'+fmtD(c.ts)+' '+fmtT(c.ts)+(c.dur?' · '+Math.round(c.dur)+'ث':'')+'</div></div>'+
          '<button class="btn sm ghost pttplay" data-a="'+esc(c.audio)+'">استماع</button></div></div>');
      });
      v.innerHTML=out.join('');
      var cb=$('#admCast',v);
      if(cb){ cb.onpointerdown=function(e){ e.preventDefault(); admCastStart(cb); };
        cb.onpointerup=function(e){ e.preventDefault(); admCastStop(cb); };
        cb.onpointerleave=function(){ if(ADMCAST.recording) admCastStop(cb); };
        cb.onpointercancel=function(){ if(ADMCAST.recording) admCastStop(cb); }; }
      $$('.pttplay',v).forEach(function(b){ b.addEventListener('click', function(){
        try{ var a=new Audio(b.getAttribute('data-a')); a.play(); b.textContent='… يُشغّل'; a.onended=function(){ b.textContent='استماع'; }; }catch(e){ toast('تعذّر التشغيل',true); }
      }); });
    });
  }
  load();
};

/* ---------- تقرير إغلاق اليوم — ملخّص تشغيلي شامل للمدير عن بُعد ---------- */
function hrsOf(min){ min=+min||0; var h=Math.floor(min/60), m=min%60; return h+':'+('0'+m).slice(-2); }
ADMIN.digest=function(v){
  var day=today();
  function load(){
    v.innerHTML='<div class="row" style="margin-bottom:10px;align-items:flex-end"><div class="grow"><label class="f">اليوم</label><input class="f" id="dgDay" type="date" value="'+day+'"></div><button class="btn sm ghost" id="dgDl">تنزيل</button></div><div id="dgBody">'+skel(3)+'</div>';
    $('#dgDay',v).addEventListener('change', function(){ day=this.value||today(); load(); });
    aAct('day_report',{day:day}).then(function(r){
      var b=$('#dgBody',v); if(!b) return;
      if(!r.ok){ b.innerHTML='<div class="empty">'+esc(r.error||'خطأ')+'</div>'; return; }
      var at=r.attendance||{}, tk=r.tasks||{}, iss=r.issues||{}, pr=r.pressure||{}, md=r.mood||{}, sc=r.spotchecks||{};
      var taskPct=tk.total>0?Math.round(100*tk.done/tk.total):0;
      var out=[];
      out.push('<div class="statgrid"><div class="stat"><div class="v">'+(at.present||0)+'/'+(at.scheduled||0)+'</div><div class="l">حضور</div></div>'+
        '<div class="stat'+((at.late_min||0)>0?' warn':'')+'"><div class="v">'+(at.late_min||0)+'</div><div class="l">دقائق تأخير</div></div>'+
        '<div class="stat"><div class="v">'+hrsOf(at.worked_min)+'</div><div class="l">ساعات العمل</div></div></div>');
      out.push('<div class="statgrid"><div class="stat'+(tk.total>0&&taskPct<100?' warn':'')+'"><div class="v">'+taskPct+'%</div><div class="l">إنجاز المهام</div></div>'+
        '<div class="stat'+((iss.open_now||0)>0?' bad':'')+'"><div class="v">'+(iss.open_now||0)+'</div><div class="l">بلاغات مفتوحة</div></div>'+
        '<div class="stat"><div class="v">'+(md.avg!=null?md.avg:'—')+'</div><div class="l">مزاج الفريق /5</div></div></div>');
      // الحضور التفصيلي
      var roster=r.roster||[];
      out.push('<div class="card"><h3>سجل الحضور</h3><div class="scrollx"><table class="tbl"><tr><th>الموظفة</th><th>المنطقة</th><th>حضور</th><th>انصراف</th><th>ساعات</th><th>تأخير</th></tr>'+
        (roster.length?roster.map(function(p){
          return '<tr><td>'+esc(p.name)+(p.role?' <span class="muted small">'+esc(p.role)+'</span>':'')+'</td><td>'+esc(p.area||'—')+'</td>'+
            '<td>'+(p.check_in?fmtT(p.check_in):(p.status==='absent'?'<span class="chip red">غياب</span>':'—'))+'</td>'+
            '<td>'+(p.check_out?fmtT(p.check_out):(p.check_in?'<span class="chip orange">مفتوح</span>':'—'))+(p.auto_closed?' <span class="chip">تلقائي</span>':'')+'</td>'+
            '<td>'+(p.worked_min!=null?hrsOf(p.worked_min):'—')+'</td>'+
            '<td>'+((p.late_minutes||0)>0?'<span class="chip orange">'+p.late_minutes+'د</span>':'—')+'</td></tr>';
        }).join(''):'<tr><td colspan="6" class="muted">لا شفتات لهذا اليوم</td></tr>')+'</table></div></div>');
      // المهام المتكررة
      var rec=r.recurring||[];
      if(rec.length) out.push('<div class="card"><h3>المهام المتكررة</h3>'+rec.map(function(t){return '<div class="row" style="justify-content:space-between;padding:3px 0;border-bottom:1px dashed var(--line)"><span>'+esc(t.name)+'</span><span class="chip green">'+t.count+'</span></div>';}).join('')+'</div>');
      // العمليات
      out.push('<div class="card"><h3>مؤشرات التشغيل</h3>'+
        row2('بلاغات فُتحت اليوم', iss.opened||0)+row2('بلاغات حُلّت اليوم', iss.resolved||0)+
        row2('نداءات مساعدة', r.help_calls||0)+
        row2('أعلى ازدحام', (pr.peak_occupied||0)+(pr.peak_area?' · '+esc(pr.peak_area):''))+
        row2('طلبات دعم منطقة', pr.support_calls||0)+
        row2('فحوصات النشاط', (sc.done||0)+'/'+(sc.total||0)+(sc.missed?' · فات '+sc.missed:'')+(sc.avg_sec!=null?' · متوسط '+sc.avg_sec+'ث':''))+
        row2('مشاركات المزاج', md.count||0)+'</div>');
      // التغطية
      var cov=r.coverage||[];
      if(cov.length) out.push('<div class="card"><h3>التغطية والغياب</h3>'+cov.map(function(c){return '<div class="small" style="padding:3px 0">'+esc(c.name)+' — '+esc(c.kind||'')+(c.detail?' ('+esc(c.detail)+')':'')+'</div>';}).join('')+'</div>');
      b.innerHTML=out.join('');
      function row2(k,val){ return '<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px dashed var(--line)"><span class="muted">'+k+'</span><b>'+val+'</b></div>'; }
      $('#dgDl',v).onclick=function(){
        var L=[];
        L.push('تقرير إغلاق اليوم — كافيه ريحانة');
        L.push('التاريخ: '+day); L.push('');
        L.push('الحضور: '+(at.present||0)+'/'+(at.scheduled||0)+'  |  تأخير: '+(at.late_min||0)+' دقيقة | ساعات العمل: '+hrsOf(at.worked_min));
        L.push('إنجاز المهام: '+taskPct+'%  |  بلاغات مفتوحة: '+(iss.open_now||0)+'  |  مزاج الفريق: '+(md.avg!=null?md.avg:'—')+'/5');
        L.push(''); L.push('— سجل الحضور —');
        roster.forEach(function(p){ L.push(p.name+' · '+(p.area||'')+' · '+(p.check_in?fmtT(p.check_in):'غياب')+' → '+(p.check_out?fmtT(p.check_out):'مفتوح')+(p.worked_min!=null?' ('+hrsOf(p.worked_min)+')':'')+((p.late_minutes||0)>0?' · تأخير '+p.late_minutes+'د':'')); });
        if(rec.length){ L.push(''); L.push('— المهام المتكررة —'); rec.forEach(function(t){ L.push(t.name+': '+t.count); }); }
        L.push(''); L.push('— التشغيل —');
        L.push('بلاغات فُتحت/حُلّت: '+(iss.opened||0)+'/'+(iss.resolved||0)+'  |  نداءات مساعدة: '+(r.help_calls||0));
        L.push('أعلى ازدحام: '+(pr.peak_occupied||0)+(pr.peak_area?' ('+pr.peak_area+')':'')+'  |  فحوصات النشاط: '+(sc.done||0)+'/'+(sc.total||0));
        if(cov.length){ L.push(''); L.push('— التغطية —'); cov.forEach(function(c){ L.push(c.name+' — '+(c.kind||'')); }); }
        dlFile('تقرير-اغلاق-'+day+'.txt', L.join('\n'));
      };
    });
  }
  load();
};

/* ---------- أدلة العمل (SOP) — مرجع الإجراءات القياسية للموظفات ---------- */
var SOP_CATS=[['opening','الافتتاح'],['closing','الإغلاق'],['hygiene','النظافة'],['service','الخدمة'],['safety','السلامة'],['machine','الآلات والمعدات'],['general','عام']];
function sopCatName(k){ var n=k; SOP_CATS.forEach(function(c){ if(c[0]===k) n=c[1]; }); return n; }
ADMIN.sops=function(v){
  lookups(function(){
    aAct('sops_all',{}).then(function(res){
      var rows=res.rows||[];
      var out=['<div class="card soft" style="padding:10px 12px"><div class="muted small">أدلة العمل هي خطوات الإجراءات القياسية (SOP) التي تراها كل موظفة داخل شفتها — طريقة تنظيف الآلة، خطوات الإغلاق، معايير الخدمة. مرجع موحّد يضمن نفس الجودة من الجميع.</div></div>',
        '<div class="btnrow" style="margin:10px 0"><button class="btn sm" id="spNew">+ دليل جديد</button></div>'];
      if(!rows.length) out.push('<div class="empty">لا أدلة بعد — أضيفي أول دليل لتوحيد طريقة العمل.</div>');
      var byc={}; rows.forEach(function(r){ (byc[r.category]=byc[r.category]||[]).push(r); });
      SOP_CATS.forEach(function(c){
        var g=byc[c[0]]; if(!g||!g.length) return;
        out.push('<h3 style="margin:14px 2px 6px;font-size:14px;color:var(--muted)">'+c[1]+'</h3>');
        g.forEach(function(s){
          out.push('<div class="card" style="padding:10px 12px'+(s.active?'':';opacity:.5')+'"><div class="row" style="justify-content:space-between;align-items:flex-start">'+
            '<div style="flex:1"><b>'+esc(s.title)+'</b>'+(s.area?' <span class="chip">'+esc(s.area)+'</span>':'')+(s.active?'':' <span class="chip">موقوف</span>')+
            '<div class="muted small" style="margin-top:3px">'+((s.steps||[]).length)+' خطوة'+(s.photo?' · مع صورة مرجعية':'')+'</div></div>'+
            '<button class="btn sm ghost" data-ed="'+s.id+'">تعديل</button></div></div>');
        });
      });
      v.innerHTML=out.join('');
      $('#spNew').addEventListener('click', function(){ form(null); });
      $$('[data-ed]',v).forEach(function(b){ b.addEventListener('click', function(){ var s=null; rows.forEach(function(x){ if(x.id===+b.getAttribute('data-ed')) s=x; }); form(s); }); });
      function form(s){
        sheet(s?'تعديل الدليل':'دليل عمل جديد',
          '<label class="f">العنوان</label><input class="f" id="spT" placeholder="مثال: تنظيف آلة الإسبريسو نهاية اليوم" value="'+(s?esc(s.title):'')+'">'+
          '<div class="row"><div class="grow"><label class="f">التصنيف</label><select class="f" id="spC">'+SOP_CATS.map(function(c){return '<option value="'+c[0]+'"'+(s&&s.category===c[0]?' selected':'')+'>'+c[1]+'</option>';}).join('')+'</select></div>'+
          '<div class="grow"><label class="f">المنطقة (اختياري)</label><select class="f" id="spA"><option value="">— كل المناطق —</option>'+areaOpts(s?s.area_id:null,true)+'</select></div></div>'+
          '<label class="f">الخطوات (سطر لكل خطوة، بالترتيب)</label><textarea class="f" id="spS" style="min-height:140px" placeholder="أطفئي الآلة وافصليها\nأفرغي وعاء التفل\nاشطفي المجموعة بالماء الساخن\n...">'+(s&&s.steps?esc((s.steps||[]).join('\n')):'')+'</textarea>'+
          '<label class="f">صورة مرجعية (اختياري)</label><div class="btnrow"><button class="btn sm ghost" id="spPB" type="button">'+(s&&s.photo?'تغيير الصورة':'إضافة صورة')+'</button><span class="muted small" id="spPL">'+(s&&s.photo?'صورة محفوظة':'لا صورة')+'</span></div>'+
          '<div id="spPV" style="margin-top:6px">'+(s&&s.photo?mediaSlot('img', s.photo, 'max-width:100%;border-radius:10px'):'')+'</div>'+
          '<label class="f">الترتيب داخل التصنيف</label><input class="f" id="spSort" type="number" value="'+(s?(s.sort||99):99)+'">'+
          (s?'<div class="check"><input type="checkbox" id="spAct" '+(s.active?'checked':'')+'><span>مفعّل (يظهر للموظفات)</span></div>':'')+
          (s?'<div class="btnrow"><button class="btn sm ghost red" id="spDel" type="button">حذف الدليل</button></div>':'')+
          '<div class="btnrow"><button class="btn block" id="spGo">حفظ</button></div>',
          function(ov, close){
            /* الدليل المحفوظ قد يحمل مفتاح تخزين أو صورة قديمة بترميز base64 — نميّز بينهما */
            var cur = (s&&s.photo)||'';
            var photo = mediaIsKey(cur) ? '' : cur, photoKey = mediaIsKey(cur) ? cur : '';
            $('#spPB',ov).addEventListener('click', function(){
              var lab=$('#spPL',ov);
              pickUpload('sop', function(d){
                photo=d; photoKey='';
                var pv=$('#spPV',ov); pv.innerHTML='';
                var im=mediaEl('img', d, 'max-width:100%;border-radius:10px'); if(im) pv.appendChild(im);
                lab.textContent='يُحفَظ…';
              }, function(k, fallback){
                if(k){ photoKey=k; photo=''; } else { photo=fallback; }
                lab.textContent='صورة جاهزة';
              });
            });
            if(s){ $('#spDel',ov).addEventListener('click', function(){
              if(!confirm('حذف هذا الدليل نهائياً؟')) return;
              busyWrap(this, function(){ return aAct('sop_delete',{id:s.id}).then(function(r){ if(r.ok){ close(); ADMIN.sops(v); toast('حُذف'); } else toast(r.error||'خطأ',true); }); });
            }); }
            $('#spGo',ov).addEventListener('click', function(){
              var steps=$('#spS',ov).value.split('\n').map(function(x){return x.trim();}).filter(Boolean);
              var title=$('#spT',ov).value.trim();
              if(!title){ toast('اكتبي عنوان الدليل', true); return; }
              if(!steps.length){ toast('أضيفي خطوة واحدة على الأقل', true); return; }
              var p={title:title, category:$('#spC',ov).value, area_id:$('#spA',ov).value||null, steps:steps,
                     photo:photo, photo_key:photoKey, sort:+$('#spSort',ov).value||99};
              if(s){ p.id=s.id; p.active=$('#spAct',ov).checked; }
              busyWrap(this, function(){
                return aAct('sop_save',p).then(function(r){ if(r.ok){ close(); ADMIN.sops(v); toast('تم ✔'); } else toast(r.error||'خطأ',true); });
              });
            });
          });
      }
    });
  });
};

/* ---------- لوحة العمليات (شاشة تابلت الكافيه) ---------- */
ADMIN.board=function(v){
  function load(){
    aAct('ops_board',{}).then(function(res){
      if(!res.ok){ v.innerHTML='<div class="empty">'+esc(res.error||'خطأ')+'</div>'; return; }
      var out=[], on=res.onshift||[];
      out.push('<div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">لوحة العمليات</h3><span class="muted small">'+new Date().toLocaleTimeString('ar-JO',{hour:'2-digit',minute:'2-digit'})+'</span></div>');
      out.push('<div class="card soft" style="padding:12px"><b>على الشفت ('+on.filter(function(o){return o['in']&&!o.out;}).length+')</b><div class="row" style="margin-top:6px">'+
        (on.length?on.map(function(o){var sc=o.out?'w':o.active?'g':o['in']?'o':'r';return '<span class="chip"><i class="sdot '+sc+'"></i>'+esc(o.name)+' · '+esc(o.area||'')+'</span>';}).join(''):'<span class="muted small">لا أحد</span>')+'</div></div>');
      var pr=res.pressure||[];
      if(pr.length) out.push('<div class="card"><b>ضغط المناطق</b>'+pr.map(function(p){var r=p.tables>0?Math.round(100*p.occupied/p.tables):0;return '<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px dashed var(--line)"><span>'+esc(p.area)+'</span><span><b>'+p.occupied+'/'+p.tables+'</b> '+(p.needs_support?'<span class="chip red">دعم</span>':p.waiting==='high'?'<span class="chip orange">انتظار</span>':'')+'</span></div>';}).join('')+'</div>');
      var help=res.help||[];
      if(help.length) out.push('<div class="card beige"><b>نداءات مساعدة مفتوحة</b>'+help.map(function(h){return '<div class="small" style="padding:3px 0">'+esc(h.area)+(h.note?' — '+esc(h.note):'')+'</div>';}).join('')+'</div>');
      var rec=res.recurring||[];
      if(rec.length) out.push('<div class="card"><b>المهام المتكررة</b>'+rec.map(function(t){return '<div class="row" style="justify-content:space-between;padding:3px 0"><span>'+esc(t.name)+'</span><span class="chip '+(t.target>0&&t.done>=t.target?'green':'')+'">'+t.done+(t.target>0?'/'+t.target:'')+'</span></div>';}).join('')+'</div>');
      if(res.open_issues>0) out.push('<div class="card"><b>بلاغات مفتوحة:</b> '+res.open_issues+'</div>');
      v.innerHTML=out.join('');
    });
  }
  load(); clearInterval(window._boardT); window._boardT=setInterval(function(){ if(S.adminSec==='board') load(); else clearInterval(window._boardT); }, 30000);
};

/* ---------- الإعلانات (Broadcast) ---------- */
ADMIN.broadcast=function(v){
  lookups(function(){
    v.innerHTML='<div class="card"><h3>إرسال إعلان</h3>'+
      '<label class="f">إلى</label><select class="f" id="bcScope"><option value="all_staff">كل الموظفات</option><option value="shift_today">شفت اليوم فقط</option><option value="employee">موظفة محددة</option></select>'+
      '<div id="bcEmpWrap" style="display:none"><label class="f">الموظفة</label><select class="f" id="bcEmp">'+staffOpts()+'</select></div>'+
      '<label class="f">العنوان</label><input class="f" id="bcTitle">'+
      '<label class="f">النص</label><textarea class="f" id="bcBody"></textarea>'+
      '<label class="f">يختفي بعد</label><select class="f" id="bcDays"><option value="1">يوم (٢٤ ساعة)</option><option value="3">٣ أيام</option><option value="7">أسبوع</option></select>'+
      '<div class="btnrow"><button class="btn block" id="bcGo">إرسال</button>'+
      (('Notification' in window && Notification.permission!=='granted')?'<button class="btn ghost" id="bcPush">تفعيل إشعاراتي</button>':'')+'</div></div><div id="bcList"></div>';
    $('#bcScope').addEventListener('change', function(){ $('#bcEmpWrap').style.display=this.value==='employee'?'block':'none'; });
    var bp=$('#bcPush'); if(bp) bp.addEventListener('click', function(){ enablePush(PUSHKEY,function(){}); });
    $('#bcGo').addEventListener('click', function(){
      var t=$('#bcTitle').value.trim(); if(!t){ toast('اكتبي العنوان', true); return; }
      var p={scope:$('#bcScope').value, title:t, body:$('#bcBody').value, days:+$('#bcDays').value||1};
      if(p.scope==='employee') p.employee_id=+$('#bcEmp').value;
      busyWrap(this, function(){ return aAct('broadcast',p).then(function(r){ if(r.ok){toast(r.msg||'أُرسل');$('#bcTitle').value='';$('#bcBody').value='';loadBL();} else toast(r.error||'خطأ',true); }); });
    });
    function loadBL(){
      aAct('broadcast_list',{}).then(function(res){
        var SC={all_staff:'الكل',shift_today:'شفت اليوم',employee:'موظفة'};
        var out='<h3 style="margin-top:12px">إعلانات سابقة</h3>'+((res.rows||[]).map(function(n){
          var rdrs=n.readers||[];
          return '<div class="card" style="padding:9px 12px"><b>'+esc(n.title)+'</b> <span class="chip">'+esc(SC[n.scope]||n.scope)+'</span> <span class="chip '+(n.reads>0?'green':'')+'">قرأها '+n.reads+'</span>'+(n.body?'<div class="small">'+esc(n.body)+'</div>':'')+
            (rdrs.length?'<div class="muted small" style="margin-top:3px">قرأنها: '+rdrs.map(esc).join('، ')+'</div>':'<div class="muted small" style="margin-top:3px">لم تُقرأ بعد</div>')+
            '<div class="muted small">'+fmtD(n.ts)+'</div></div>';
        }).join('')||'<div class="muted small">لا إعلانات</div>');
        if((res.admin_alerts||[]).length){
          out+='<h3 style="margin-top:12px">تنبيهات وصلتك</h3>'+res.admin_alerts.map(function(a){
            return '<div class="card beige" style="padding:9px 12px"><b>'+esc(a.title)+'</b>'+(a.body?' — '+esc(a.body):'')+'<div class="muted small">'+fmtD(a.ts)+' '+fmtT(a.ts)+'</div></div>';
          }).join('');
        }
        $('#bcList').innerHTML=out;
      });
    }
    loadBL();
  });
};

/* ---------- البلاغات (تذاكر) ---------- */
ADMIN.issues=function(v){
  function load(){
    aAct('issues_list',{}).then(function(res){
      var IST={open:'مفتوح',in_progress:'قيد المعالجة',resolved:'محلول'}, CAT={maintenance:'صيانة',supply:'مستلزمات',safety:'سلامة',cleanliness:'نظافة',other:'أخرى'};
      var rows=res.rows||[];
      v.innerHTML='<div class="muted small" style="margin-bottom:8px">'+rows.filter(function(i){return i.status!=='resolved';}).length+' بلاغ مفتوح</div>'+
        (rows.map(function(i){
          return '<div class="card" style="padding:11px 13px'+(i.status==='resolved'?';opacity:.6':'')+'"><div class="row" style="justify-content:space-between"><b>'+esc(i.title)+'</b><span class="chip '+(i.priority==='high'?'red':'')+'">'+esc(CAT[i.category]||i.category)+'</span></div>'+
            '<div class="muted small">'+esc(i.reporter||'')+' · '+fmtD(i.ts)+(i.area?' · '+esc(i.area):'')+'</div>'+
            (i.detail?'<div class="small" style="margin-top:3px">'+esc(i.detail)+'</div>':'')+
            (i.photo?'<div class="btnrow"><button class="btn sm ghost" data-iph="'+i.id+'">عرض الصورة</button></div>':'')+
            voicePlayHtml(i.voice,'مذكرة صوتية من المُبلِّغة')+
            (i.admin_note?'<div class="small muted">ملاحظتك: '+esc(i.admin_note)+'</div>':'')+
            '<div class="row" style="justify-content:space-between;margin-top:6px"><span class="chip '+(i.status==='resolved'?'green':i.status==='in_progress'?'orange':'')+'">'+(IST[i.status]||i.status)+'</span>'+
            '<span class="btnrow" style="margin:0">'+(i.status!=='in_progress'&&i.status!=='resolved'?'<button class="btn sm ghost" data-is="'+i.id+'" data-st="in_progress">بدء المعالجة</button>':'')+(i.status!=='resolved'?'<button class="btn sm" data-is="'+i.id+'" data-st="resolved">حُلّ</button>':'')+'<button class="btn sm ghost" data-isn="'+i.id+'">ملاحظة</button></span></div></div>';
        }).join('')||'<div class="empty">لا بلاغات</div>');
      $$('[data-is]',v).forEach(function(b){ b.addEventListener('click', function(){ aAct('issue_update',{id:+b.getAttribute('data-is'), status:b.getAttribute('data-st')}).then(load); }); });
      $$('[data-isn]',v).forEach(function(b){ b.addEventListener('click', function(){ var n=prompt('ملاحظة (تصل صاحبة البلاغ):',''); if(n===null)return; aAct('issue_update',{id:+b.getAttribute('data-isn'), note:n}).then(load); }); });
      $$('[data-iph]',v).forEach(function(b){ b.addEventListener('click', function(){ var i=null; rows.forEach(function(x){if(x.id===+b.getAttribute('data-iph'))i=x;}); if(i&&i.photo) sheet('صورة البلاغ', mediaSlot('img', i.photo, 'width:100%;border-radius:12px') || '<div class="muted small">تعذّر عرض الصورة — صيغة غير صالحة</div>'); }); });
    });
  }
  load();
};

/* ---------- سجل الشفت (للإدارة) ---------- */
ADMIN.logbook=function(v){
  var d7=addDays(today(),-7);
  v.innerHTML='<div class="row"><input class="f grow" id="lbFrom" type="date" value="'+d7+'"><input class="f grow" id="lbTo" type="date" value="'+today()+'"><button class="btn sm" id="lbGo">عرض</button></div><div id="lbB" style="margin-top:10px"></div>';
  function load(){
    aAct('logbook_range',{from:$('#lbFrom').value, to:$('#lbTo').value}).then(function(res){
      var CATL={note:'ملاحظة',lowstock:'نقص مخزون',incident:'حادثة',maintenance:'عطل',cash:'كاش',handoverall:'تسليم'};
      $('#lbB').innerHTML=(res.rows||[]).map(function(l){
        return '<div class="card" style="padding:9px 12px"><span class="chip">'+esc(CATL[l.category]||l.category)+'</span> <b>'+esc(l.who)+'</b> <span class="muted small">'+fmtD(l.day)+' '+fmtT(l.ts)+'</span><div class="small" style="margin-top:3px">'+esc(l.text)+'</div>'+(l.photo?'<div class="btnrow"><button class="btn sm ghost" data-lph="'+l.id+'">صورة</button></div>':'')+'</div>';
      }).join('')||'<div class="empty">لا مدخلات بهذا النطاق</div>';
      $$('[data-lph]',v).forEach(function(b){ b.addEventListener('click', function(){ var l=null;(res.rows||[]).forEach(function(x){if(x.id===+b.getAttribute('data-lph'))l=x;}); if(l&&l.photo)sheet('صورة', mediaSlot('img', l.photo, 'width:100%;border-radius:12px') || '<div class="muted small">تعذّر عرض الصورة — صيغة غير صالحة</div>'); }); });
    });
  }
  $('#lbGo').addEventListener('click', load); load();
};

/* ---------- التحليلات ---------- */
ADMIN.analytics=function(v){
  aAct('analytics',{}).then(function(res){
    if(!res.ok){ v.innerHTML='<div class="empty">'+esc(res.error||'خطأ')+'</div>'; return; }
    var out=['<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px"><span class="muted small">آخر 28 يوماً</span><button class="btn sm ghost" id="anExp">تصدير نسخة (JSON)</button></div>'];
    // خريطة الضغط بالساعة/اليوم
    var DOW=['أحد','إثن','ثلا','أرب','خمي','جمع','سبت'];
    var hm=res.heatmap||[], maxv=1; hm.forEach(function(c){ if(c.peak>maxv) maxv=c.peak; });
    if(hm.length){
      var grid={}; hm.forEach(function(c){ grid[c.dow+'-'+c.hour]=c.peak; });
      var hours=[]; for(var h=8;h<=23;h++) hours.push(h);
      var tbl='<div class="scrollx"><table class="tbl" style="font-size:11px"><tr><th></th>'+hours.map(function(h){return '<th>'+h+'</th>';}).join('')+'</tr>';
      for(var dw=0;dw<7;dw++){
        tbl+='<tr><td><b>'+DOW[dw]+'</b></td>'+hours.map(function(h){
          var val=grid[dw+'-'+h]||0, op=val/maxv;
          return '<td style="background:rgba(62,107,76,'+(op*0.85).toFixed(2)+');color:'+(op>0.5?'#fff':'inherit')+';text-align:center">'+(val||'')+'</td>';
        }).join('')+'</tr>';
      }
      tbl+='</table></div>';
      out.push('<div class="card"><h3>خريطة الضغط (ذروة الإشغال حسب اليوم/الساعة)</h3>'+tbl+'</div>');
    }
    // الموثوقية
    out.push('<div class="card"><h3>موثوقية الحضور</h3><div class="scrollx"><table class="tbl"><tr><th>الموظفة</th><th>شفتات</th><th>في الوقت</th><th>متأخرة</th><th>النسبة</th></tr>'+
      (res.reliability||[]).map(function(r){return '<tr><td><b>'+esc(r.employee)+'</b></td><td>'+r.shifts+'</td><td>'+r.ontime+'</td><td>'+r.late+'</td><td>'+(r.reliability_pct!=null?'<span class="chip '+(r.reliability_pct>=90?'green':r.reliability_pct>=75?'orange':'red')+'">'+r.reliability_pct+'%</span>':'—')+'</td></tr>';}).join('')+'</table></div></div>');
    // إنجاز المهام
    out.push('<div class="card"><h3>إنجاز المهام</h3><div class="scrollx"><table class="tbl"><tr><th>الموظفة</th><th>الكل</th><th>منجز</th><th>النسبة</th></tr>'+
      (res.tasks||[]).map(function(r){return '<tr><td><b>'+esc(r.employee)+'</b></td><td>'+r.total+'</td><td>'+r.done+'</td><td>'+(r.completion_pct!=null?'<span class="chip '+(r.completion_pct>=85?'green':r.completion_pct>=60?'orange':'red')+'">'+r.completion_pct+'%</span>':'—')+'</td></tr>';}).join('')+'</table></div></div>');
    // التغطيات
    if((res.coverage||[]).length) out.push('<div class="card"><h3>التغطيات (حِمل الفريق)</h3>'+(res.coverage||[]).map(function(r){return '<div class="row" style="justify-content:space-between;padding:3px 0;border-bottom:1px dashed var(--line)"><span>'+esc(r.employee)+'</span><span class="chip">'+r.covers+'</span></div>';}).join('')+'</div>');
    v.innerHTML=out.join('');
    var eb=$('#anExp',v); if(eb) eb.addEventListener('click', function(){
      aAct('export_all',{}).then(function(r){ if(r.ok){ dlFile('ريحانة-نسخة-'+today()+'.json', JSON.stringify(r,null,2), 'application/json'); toast('تم تنزيل النسخة'); } else toast(r.error||'خطأ',true); });
    });
  });
};

/* ---------- المتابعة الحية (نبض التواجد + المهام المتكررة) ---------- */
ADMIN.live=function(v){
  function load(){
    Promise.all([aAct('live_presence',{}), aAct('recurring_day',{})]).then(function(rs){
      var pr=rs[0]||{}, rc=rs[1]||{};
      var out=[];
      out.push('<div class="muted small" style="margin-bottom:8px">تأكيد تواجد شفّاف أثناء الشفت فقط — الموظفات يرين مؤشره على شاشتهن. يتحدث تلقائياً.</div>');
      var rows=pr.rows||[];
      out.push('<h3 style="margin:2px">على الشفت الآن ('+rows.filter(function(r){return r.checked_in&&!r.checked_out;}).length+')</h3>');
      if(!rows.length) out.push('<div class="empty">لا شفتات نشطة اليوم</div>');
      rows.forEach(function(r){
        var state = r.checked_out ? ['w','انصرفت',''] :
                    !r.checked_in ? ['o','لم تحضر بعد','orange'] :
                    (r.idle_min!=null && r.idle_min<3 && r.in_geo!==false) ? ['g','نشطة الآن','green'] :
                    (r.in_geo===false) ? ['r','خارج نطاق الكافيه','red'] :
                    (r.idle_min!=null && r.idle_min>=10) ? ['o','بلا نشاط '+r.idle_min+' د','orange'] : ['g','حاضرة','green'];
        out.push('<div class="card" style="padding:11px 13px"><div class="row" style="justify-content:space-between"><div>'+
          '<b>'+esc(r.employee)+'</b> <span class="muted small">'+esc(r.area||'')+'</span>'+
          '<div class="small" style="margin-top:3px"><span class="chip '+state[2]+'"><i class="sdot '+state[0]+'"></i>'+state[1]+'</span> '+
          (r.away_count>0?'<span class="chip orange">غادرت النطاق '+r.away_count+'×</span> ':'')+
          (r.battery!=null && r.checked_in && !r.checked_out?'<span class="chip '+(r.battery<=15?'red':'')+'">بطارية '+r.battery+'%</span> ':'')+
          '</div></div>'+
          '<div class="center small muted">مهام: <b>'+(r.done_tasks||0)+'</b>'+(r.recurring_done?' · متكررة: <b>'+r.recurring_done+'</b>':'')+
          '<br>فحوصات: <b class="'+((r.sc_missed||0)>0?'':'')+'">'+(r.sc_ok||0)+'</b> ✔'+((r.sc_missed||0)>0?' · <b style="color:var(--red)">'+r.sc_missed+'</b> فائت':'')+
          (r.sc_avg_sec!=null?'<br>ردّ خلال '+r.sc_avg_sec+' ث':'')+'</div>'+
          '</div></div>');
      });
      out.push('<div id="locMapWrap"></div>');
      var rr=rc.rows||[];
      if(rr.length){
        out.push('<h3 style="margin:14px 2px 6px">المهام المتكررة اليوم</h3>');
        rr.forEach(function(t){
          out.push('<div class="card" style="padding:10px 12px"><div class="row" style="justify-content:space-between"><b>'+esc(t.name)+'</b><span class="chip '+(t.target>0&&t.done>=t.target?'green':'')+'">'+t.done+(t.target>0?'/'+t.target:'')+'</span></div>'+
            '<div class="muted small">'+esc(t.area||'')+'</div>'+
            ((t.by&&t.by.length)?'<div class="small" style="margin-top:4px">'+t.by.map(function(x){return esc(x.who)+': '+x.count;}).join(' · ')+'</div>':'<div class="small muted">لم تُنفَّذ بعد</div>')+'</div>');
        });
      }
      v.innerHTML=out.join('');
      aAct('presence_map',{}).then(function(pm){
        var w=$('#locMapWrap'); if(!w||!pm.ok) return;
        var g=pm.center||{}, prows=(pm.rows||[]).filter(function(r){return r.last;});
        if(!g.lat || !prows.length){ w.innerHTML='<div class="card"><h3>خريطة المواقع أثناء الشفت</h3><div class="muted small">تظهر مواقع الموظفات أثناء شفتهن بعد أول نبضة (حدّدي موقع الكافيه من الإعدادات).</div></div>'; return; }
        var rad=(g.radius_m||250), mLat=111320, mLng=111320*Math.cos(g.lat*Math.PI/180);
        var W=320,H=220, cx=W/2, cy=H/2, span=rad*1.6;
        function px(la,ln){ return [cx+((ln-g.lng)*mLng)/span*(W/2), cy-((la-g.lat)*mLat)/span*(H/2)]; }
        var rpx=(rad/span)*(W/2);
        var pts=prows.map(function(r){ var p=px(r.last.lat,r.last.lng); var inside=Math.hypot(p[0]-cx,p[1]-cy)<=rpx;
          return '<g><circle cx="'+p[0].toFixed(0)+'" cy="'+p[1].toFixed(0)+'" r="6" fill="'+(inside?'var(--green)':'var(--red)')+'" opacity="0.85"/><text x="'+p[0].toFixed(0)+'" y="'+(p[1]-9).toFixed(0)+'" font-size="9" text-anchor="middle" fill="var(--ink)">'+esc(r.employee)+'</text></g>'; }).join('');
        w.innerHTML='<div class="card"><h3>خريطة المواقع أثناء الشفت</h3>'+
          '<div class="muted small" style="margin-bottom:6px">مواقع تقريبية (GPS داخلي محدود الدقة) — أثناء الدوام فقط. الأخضر داخل النطاق، الأحمر خارجه.</div>'+
          '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;background:var(--surface-2);border-radius:12px">'+
          '<circle cx="'+cx+'" cy="'+cy+'" r="'+rpx.toFixed(0)+'" fill="color-mix(in srgb,var(--green) 14%,transparent)" stroke="var(--green)" stroke-dasharray="4 4"/>'+
          '<circle cx="'+cx+'" cy="'+cy+'" r="3" fill="var(--muted)"/><text x="'+cx+'" y="'+(cy+16)+'" font-size="9" text-anchor="middle" fill="var(--muted)">الكافيه</text>'+
          pts+'</svg></div>';
      }).catch(function(){});
    });
  }
  load();
  clearInterval(window._liveT); window._liveT=setInterval(function(){ if(S.adminSec==='live'){ load(); } else clearInterval(window._liveT); }, 45000);
};

/* ---------- سجل الساعات ---------- */
ADMIN.hours=function(v){
  var d28=addDays(today(),-27);
  v.innerHTML='<div class="row"><input class="f grow" id="hrFrom" type="date" value="'+d28+'"><input class="f grow" id="hrTo" type="date" value="'+today()+'"><button class="btn sm" id="hrGo">عرض</button></div>'+
    /* ملخّص لكل موظفة (hours_ledger) للقرار السريع، وتفصيل يوم بيوم
       (hours_report) للحوار مع موظفة على يوم بعينه. عرضان لسؤالين مختلفين. */
    '<div class="tfl" style="margin-top:9px"><button class="tfl-b on" data-hv="sum">ملخّص</button>'+
      '<button class="tfl-b" data-hv="det">تفصيل يوم بيوم</button></div>'+
    '<div id="hrB" style="margin-top:10px"></div>';
  $$('[data-hv]',v).forEach(function(b){ b.addEventListener('click', function(){
    $$('[data-hv]',v).forEach(function(x){ x.className='tfl-b'; });
    b.className='tfl-b on';
    if(b.getAttribute('data-hv')==='det') loadDetail(); else load();
  });});
  function loadDetail(){
    $('#hrB').innerHTML=skel(3);
    aAct('hours_report',{from:$('#hrFrom').value, to:$('#hrTo').value}).then(function(res){
      if(!res||!res.ok){ $('#hrB').innerHTML='<div class="empty">تعذّر التحميل</div>'; return; }
      var rows=(res.rows||[]).slice().sort(function(a,b){
        return a.name===b.name ? (a.day<b.day?1:-1) : (a.name>b.name?1:-1); });
      var t=res.totals||{}, pol=((res.rules||{}).policy)||{};
      if(!rows.length){ $('#hrB').innerHTML='<div class="empty">لا سجلات بهذا النطاق</div>'; return; }
      $('#hrB').innerHTML=
        '<div class="statrow" style="margin-bottom:10px">'+
          '<div class="stat"><b>'+(t.worked_hours!=null?t.worked_hours:'—')+'</b><span>ساعة عمل</span></div>'+
          '<div class="stat"><b>'+(t.full||0)+'</b><span>شفت كامل</span></div>'+
          '<div class="stat"><b>'+(t.incomplete||0)+'</b><span>غير مكتمل</span></div>'+
        '</div>'+
        '<div class="scrollx"><table class="tbl"><tr><th>الموظفة</th><th>اليوم</th><th>الحالة</th>'+
          '<th>تواجد</th><th>عمل محتسب</th><th>إضافي</th></tr>'+
        rows.map(function(r){
          var s=MHST[r.status]||['', r.status||'—'];
          return '<tr><td><b>'+esc(r.name||'—')+'</b></td><td>'+fmtD(r.day)+'</td>'+
            '<td><span class="chip '+s[0]+'">'+esc(s[1])+'</span>'+
              (r.note?'<div class="muted small">'+esc(r.note)+'</div>':'')+'</td>'+
            '<td>'+hm(r.present_minutes)+'</td><td><b>'+hm(r.worked_minutes)+'</b></td>'+
            '<td>'+((r.overtime_minutes||0)>0?r.overtime_minutes+' د':'—')+'</td></tr>';
        }).join('')+'</table></div>'+
        '<div class="muted small" style="margin-top:10px;line-height:1.75">'+
          'القاعدة المطبَّقة: العمل المحتسب = التواجد ناقص الاستراحات'+(pol.break_paid?' (مدفوعة)':' (غير مدفوعة)')+
          (pol.full_shift_ratio!=null?' · الشفت الكامل عند '+Math.round(pol.full_shift_ratio*100)+'% من المخطّط':'')+
          (pol.min_countable_minutes!=null?' · أقل من '+pol.min_countable_minutes+' دقيقة لا يُحتسب':'')+
          '. <b>ليست بيانات مالية دقيقة</b> — التسجيل يدوي.</div>';
      tblResponsive($('#hrB'));
    });
  }
  function load(){
    $('#hrB').innerHTML=skel(3);
    aAct('hours_ledger',{from:$('#hrFrom').value, to:$('#hrTo').value}).then(function(res){
      var rows=res.rows||[];
      if(!rows.length){ $('#hrB').innerHTML='<div class="empty">لا سجلات بهذا النطاق</div>'; return; }
      var total=rows.reduce(function(a,r){return a+(r.worked_hours||0);},0);
      $('#hrB').innerHTML='<div class="btnrow" style="margin-bottom:8px"><button class="btn sm ghost" id="hrCsv">تصدير CSV</button><span class="chip green">إجمالي '+total.toFixed(1)+' ساعة</span></div>'+
        '<div class="scrollx"><table class="tbl"><tr><th>الموظفة</th><th>أيام الدوام</th><th>شفتات</th><th>ساعات</th><th>تأخير(د)</th><th>إضافي(د)</th><th>إغلاق تلقائي</th></tr>'+
        rows.map(function(r){return '<tr><td><b>'+esc(r.employee)+'</b></td><td><b>'+(r.days!=null?r.days:'—')+'</b></td><td>'+r.shifts+'</td><td><b>'+r.worked_hours+'</b></td><td>'+r.late_min+'</td><td>'+r.ot_min+'</td><td>'+(r.auto_closed>0?'<span class="chip orange">'+r.auto_closed+'</span>':'—')+'</td></tr>';}).join('')+'</table></div>';
      $('#hrCsv').addEventListener('click', function(){
        var keys=['employee','days','shifts','worked_hours','late_min','ot_min','auto_closed'], HH=['الموظفة','أيام الدوام','شفتات','ساعات','تأخير','إضافي','إغلاق تلقائي'];
        var lines=[HH.join(',')].concat(rows.map(function(r){return keys.map(function(k){return '"'+String(r[k]).replace(/"/g,'""')+'"';}).join(',');}));
        dlFile('سجل-الساعات-'+$('#hrFrom').value+'.csv', '\ufeff'+lines.join('\r\n'), 'text/csv');
      });
    });
  }
  /* زر «عرض» يحدّث العرض المفتوح حالياً، لا الملخّص دائماً */
  $('#hrGo').addEventListener('click', function(){
    var det=$('[data-hv="det"]'); if(det && det.className.indexOf('on')>-1) loadDetail(); else load();
  });
  load();
};

/* ---------- أجهزة الكافيه ---------- */
ADMIN.devices=function(v){
  aAct('devices_list',{}).then(function(res){
    var rows=res.rows||[];
    v.innerHTML='<div class="muted small" style="margin-bottom:8px">أنشئي حساباً لكل جهاز في الكافيه (تابلت الصالة مثلاً) وفعّليه من شاشة الدخول على الجهاز نفسه. مع «الوضع الصارم» في الإعدادات لا يُقبل دخول ولا حضور إلا من جهاز مفعّل.</div>'+
      '<div class="btnrow" style="margin-bottom:10px"><button class="btn sm" id="dvNew">+ جهاز جديد</button></div>'+
      (rows.map(function(d){
        return '<div class="card" style="padding:10px 12px'+(d.active?'':';opacity:.55')+'"><div class="row" style="justify-content:space-between">'+
          '<div><b>'+esc(d.label||'جهاز')+'</b> <span class="chip" style="direction:ltr">'+esc(d.username)+'</span>'+(d.active?'':' <span class="chip red">موقوف</span>')+
          '<div class="muted small">آخر استخدام: '+(d.last_seen?(fmtD(d.last_seen)+' '+fmtT(d.last_seen)):'لم يُستخدم بعد')+'</div></div>'+
          '<button class="btn sm ghost" data-dved="'+d.id+'">تعديل</button></div></div>';
      }).join('')||'<div class="empty">لا أجهزة بعد — أنشئي حساب الجهاز الأول</div>');
    function form(d){
      sheet(d?'تعديل جهاز — '+(d.label||''):'جهاز جديد',
        '<label class="f">اسم الجهاز (وصفي)</label><input class="f" id="dL" value="'+(d?esc(d.label):'تابلت الكافيه')+'">'+
        (d?'':'<label class="f">اسم المستخدم</label><input class="f" id="dU" autocapitalize="none" spellcheck="false" placeholder="مثال: tablet1">')+
        '<label class="f">كلمة السر'+(d?' (اتركيها فارغة للإبقاء عليها)':'')+'</label><input class="f" id="dP" type="password">'+
        (d?'<div class="check"><input type="checkbox" id="dA" '+(d.active?'checked':'')+'><span>مفعّل</span></div>'+
           '<div class="check"><input type="checkbox" id="dR"><span>إبطال التفعيلات السابقة — يعيد طلب التفعيل على الجهاز</span></div>':'')+
        '<div class="btnrow"><button class="btn block" id="dGo">حفظ</button></div>',
        function(ov, close){
          $('#dGo',ov).addEventListener('click', function(){
            var p={label:$('#dL',ov).value};
            if(d){
              p.id=d.id; p.active=$('#dA',ov).checked; p.rotate=$('#dR',ov).checked;
              if($('#dP',ov).value) p.password=$('#dP',ov).value;
            } else {
              p.username=$('#dU',ov).value.trim(); p.password=$('#dP',ov).value;
              if(!p.username){ toast('اسم مستخدم الجهاز مطلوب', true); return; }
              if(!p.password || p.password.length<4){ toast('كلمة سر ٤ خانات على الأقل', true); return; }
            }
            busyWrap(this, function(){
              return aAct('device_save',p).then(function(r){ if(r.ok){close();ADMIN.devices(v);toast('تم ✔');} else toast(r.error||'خطأ',true); });
            });
          });
        });
    }
    $('#dvNew').addEventListener('click', function(){ form(null); });
    $$('[data-dved]',v).forEach(function(b){ b.addEventListener('click', function(){
      var d=null; rows.forEach(function(x){ if(x.id===+b.getAttribute('data-dved')) d=x; }); if(d) form(d);
    });});
  });
};

/* ---------- الإعدادات ---------- */
ADMIN.settings=function(v){
  aAct('settings_get',{}).then(function(res){
    var st=res.settings||{};
    var guard=st.attendance_guard||{}; var sc=st.spotcheck||{};
    var labels={terms:'المصطلحات', hours:'ساعات العمل', eval_weights:'أوزان التقييم', session:'الجلسات', coop_reasons:'أسباب التعاون', request_types:'أنواع الطلبات', theme:'الألوان', privacy_note:'نص الخصوصية', phone_policy:'سياسة الهاتف'};
    var guardCard='<div class="card beige"><h3>حماية الحضور والانصراف</h3>'+
      '<div class="small muted">التسجيل يوثَّق تلقائياً بمعرّف الجهاز والموقع الجغرافي. أي شذوذ (جهاز غريب، موقع بعيد، بلا موقع) يظهر في «إشارات المراجعة» بلا عقوبة تلقائية — ويمكن تفعيل طبقات إضافية عند الحاجة.</div>'+
      '<div class="check"><input type="checkbox" id="agPin" '+(guard.require_pin?'checked':'')+'><span>طلب كلمة السر عند كل تسجيل (طبقة إضافية اختيارية)</span></div>'+
      '<div class="check"><input type="checkbox" id="agSelf" '+(guard.require_selfie?'checked':'')+'><span>صورة تحقق مباشرة إلزامية (طبقة إضافية اختيارية)</span></div>'+
      '<div class="check"><input type="checkbox" id="agGeo" '+(guard.require_geo?'checked':'')+'><span>إشارة مراجعة عند التسجيل بدون موقع</span></div>'+
      '<div class="check"><input type="checkbox" id="agDev" '+(guard.enforce_device?'checked':'')+'><span>الوضع الصارم: لا دخول ولا حضور إلا من أجهزة الكافيه المفعّلة (قسم «الأجهزة»)</span></div>'+
      '<label class="f">نصف قطر السماح حول الكافيه (متر)</label><input class="f" id="agRad" type="number" value="'+(guard.radius_m||250)+'">'+
      '<hr class="sep"><div class="check"><input type="checkbox" id="agSc" '+(sc.enabled?'checked':'')+'><span>فحوصات نشاط أثناء الشفت (تكشف من يتواجد دون عمل — معلنة للموظفة)</span></div>'+
      '<div class="row"><div class="grow"><label class="f">كل (دقيقة) تقريباً</label><input class="f" id="agScEvery" type="number" value="'+(sc.every_min||45)+'"></div>'+
      '<div class="grow"><label class="f">تفاوت عشوائي ±</label><input class="f" id="agScJit" type="number" value="'+(sc.jitter_min||20)+'"></div>'+
      '<div class="grow"><label class="f">مهلة الرد (دقيقة)</label><input class="f" id="agScWin" type="number" value="'+(sc.window_min||8)+'"></div></div>'+
      '<div class="small muted" style="margin-top:4px">موقع الكافيه: '+(guard.lat?('محدد ('+guard.lat+', '+guard.lng+')'):'<b>غير محدد — حدديه من داخل الكافيه</b>')+'</div>'+
      '<div class="btnrow">'+
        '<button class="btn sm" id="agLoc">اعتماد موقعي الحالي</button>'+
        '<button class="btn sm orange" id="agSave">حفظ إعدادات الحماية</button></div>'+
      '</div>';
    /* كانت الخلفية والحدّ ألواناً ست عشرية سطرية (#FBF1EE و#E5B8AB) لا تنقلب
       مع السمة، فيصير في الوضع الداكن نصٌّ فاتح على خلفية فاتحة بتباين 1.06 —
       أي غير مقروء تماماً في أخطر بطاقة في التطبيق. الصنف danger يحمل الآن
       اللونين من الرموز فينقلبان معها. */
    var resetCard='<div class="card danger-card"><h3 style="color:var(--red-ink)">تصفير بيانات التجربة</h3>'+
      '<div class="small muted">لمرحلة التجربة: يحذف السجلات المحددة نهائياً ولا يمس البنية (الموظفات، المناطق، أنواع الشفتات، قوالب المهام، المهارات، الأجهزة، الإعدادات).</div>'+
      '<div class="check"><input type="checkbox" id="rsOps" checked><span>العمليات اليومية: شفتات، حضور، مهام، استراحات، ضغط، نداءات، تسليمات، غياب وتغطية، تعاون، إشارات</span></div>'+
      '<div class="check"><input type="checkbox" id="rsReq"><span>الطلبات والملاحظات</span></div>'+
      '<div class="check"><input type="checkbox" id="rsRec"><span>التقدير والجوائز</span></div>'+
      '<div class="check"><input type="checkbox" id="rsTr"><span>خطط التدريب</span></div>'+
      '<div class="check"><input type="checkbox" id="rsAud"><span>سجل التدقيق</span></div>'+
      '<label class="f">كلمة سر الإدارة (للتأكيد)</label><input class="f" id="rsPw" type="password" autocomplete="off">'+
      '<div class="btnrow"><button class="btn red block" id="rsGo">تصفير البيانات المحددة نهائياً</button></div></div>';
    v.innerHTML=guardCard+resetCard+
      '<div class="muted small" style="margin:12px 0 8px">إعدادات متقدمة (JSON) — عدّلي بحذر ثم احفظي.</div>'+
      Object.keys(st).filter(function(k){return k!=='attendance_guard'&&k!=='trusted_devices'&&k!=='spotcheck';}).map(function(k){
        return '<div class="card" style="padding:10px 12px"><b>'+esc(labels[k]||k)+'</b> <span class="chip">'+esc(k)+'</span>'+
          '<textarea class="f stg" data-k="'+esc(k)+'" style="margin-top:6px;direction:ltr;text-align:left;font-size:12.5px">'+esc(JSON.stringify(st[k],null,1))+'</textarea>'+
          '<div class="btnrow"><button class="btn sm" data-sv="'+esc(k)+'">حفظ</button></div></div>';
      }).join('');
    function saveGuard(extra){
      var g={require_pin:$('#agPin',v).checked, require_selfie:$('#agSelf',v).checked, require_geo:$('#agGeo',v).checked, enforce_device:$('#agDev',v).checked, radius_m:+$('#agRad',v).value||250, lat:guard.lat, lng:guard.lng};
      if(extra) Object.assign(g, extra);
      return aAct('settings_save',{key:'attendance_guard', value:g}).then(function(r){
        if(r.ok){ toast('حُفظت إعدادات الحماية ✔'); ADMIN.settings(v); } else toast(r.error||'خطأ',true);
      });
    }
    $('#agSave',v).addEventListener('click', function(){
      busyWrap(this, function(){
        var scv={enabled:$('#agSc',v).checked, every_min:+$('#agScEvery',v).value||45, jitter_min:+$('#agScJit',v).value||20, window_min:+$('#agScWin',v).value||8, photo:true};
        return Promise.all([saveGuard(), aAct('settings_save',{key:'spotcheck', value:scv})]);
      });
    });
    $('#agLoc',v).addEventListener('click', function(){
      busyWrap(this, function(){
        return new Promise(function(resolve){
          getGeo(function(geo){
            if(!geo){ toast('تعذر تحديد الموقع — فعّلي إذن الموقع وحاولي داخل الكافيه', true); resolve(); return; }
            saveGuard({lat:geo.lat, lng:geo.lng}).then(resolve, resolve);
          });
        });
      });
    });
    $$('[data-sv]',v).forEach(function(b){ b.addEventListener('click', function(){
      var k=b.getAttribute('data-sv'), ta=$$('.stg',v).filter(function(t){return t.getAttribute('data-k')===k;})[0];
      var val; try{ val=JSON.parse(ta.value); }catch(e){ toast('صيغة JSON غير صحيحة', true); return; }
      aAct('settings_save',{key:k, value:val}).then(function(r){ if(r.ok) toast('حُفظ ✔'); else toast(r.error||'خطأ',true); });
    });});
    $('#rsGo',v).addEventListener('click', function(){
      var scopes={ops:$('#rsOps',v).checked, requests:$('#rsReq',v).checked, recognition:$('#rsRec',v).checked, training:$('#rsTr',v).checked, audit:$('#rsAud',v).checked};
      if(!scopes.ops && !scopes.requests && !scopes.recognition && !scopes.training && !scopes.audit){ toast('حددي ما تريدين تصفيره', true); return; }
      var pw=$('#rsPw',v).value;
      if(!pw){ toast('أدخلي كلمة سر الإدارة للتأكيد', true); return; }
      if(!confirm('تأكيد نهائي: ستُحذف السجلات المحددة ولا يمكن استرجاعها. متابعة؟')) return;
      busyWrap(this, function(){
        return aAct('data_reset', Object.assign({password:pw}, scopes)).then(function(r){
          if(r.ok){ toast(r.msg||'تم التصفير ✔'); $('#rsPw',v).value=''; }
          else toast(r.error||'خطأ', true);
        });
      });
    });
  });
};

/* ---------- سجل التدقيق ---------- */
ADMIN.audit=function(v, limit){
  limit=limit||100;
  aAct('audit_list',{limit:limit}).then(function(res){
    var rows=res.rows||res.audit||[];
    v.innerHTML=(rows.map(function(a){
      return '<div class="small" style="padding:5px 0;border-bottom:1px dashed var(--line)"><b>'+esc(a.actor_name||a.actor||'')+'</b> — '+esc(a.action)+' <span class="muted">'+fmtD(a.ts)+' '+fmtT(a.ts)+'</span>'+
        (a.detail?'<div class="muted" style="direction:ltr;text-align:left">'+esc(JSON.stringify(a.detail))+'</div>':'')+'</div>';
    }).join('')||'<div class="empty">السجل فارغ</div>')+
    (rows.length>=limit?'<div class="btnrow" style="margin-top:10px"><button class="btn sm ghost block" id="audMore">تحميل المزيد…</button></div>':'');
    var mb=$('#audMore',v); if(mb) mb.addEventListener('click', function(){ ADMIN.audit(v, limit+100); });
  });
};

/* ---------- إشارات المراجعة ---------- */
ADMIN.flags=function(v){
  aAct('flags_list',{}).then(function(res){
    var FK={fast_task:'مهمة أُنجزت أسرع من المعقول', photo_reuse:'صورة توثيق مكررة', forget_repeat:'نسيان متكرر للتسجيل', mutual_votes:'تبادل ترشيحات متكرر',
      unscheduled_checkin:'حضور بدون شفت مجدول', geo_missing:'تسجيل حضور/انصراف بدون موقع', geo_far:'تسجيل من موقع بعيد عن الكافيه', untrusted_device:'تسجيل من جهاز غير معتمد'};
    v.innerHTML='<div class="muted small" style="margin-bottom:8px">أنماط رصدها الخادم — <b>لا عقوبة تلقائية أبداً</b>. انظري وتحدثي ثم قرري.</div>'+
      ((res.rows||[]).map(function(f){
        return '<div class="card" style="padding:10px 12px'+(f.status!=='open'?';opacity:.55':'')+'"><b>'+esc(f.employee||'—')+'</b>: '+esc(FK[f.kind]||f.kind)+
          '<div class="small muted" style="direction:ltr;text-align:left">'+esc(JSON.stringify(f.detail||{}))+'</div>'+
          '<div class="muted small">'+fmtD(f.ts)+' · '+esc(f.status)+'</div>'+
          (f.status==='open'?'<div class="btnrow"><button class="btn sm ghost" data-fd="'+f.id+'" data-d="dismissed">اطّلعت — سليم</button><button class="btn sm ghost red" data-fd="'+f.id+'" data-d="reviewed">تمت متابعة</button></div>':'')+'</div>';
      }).join('')||'<div class="empty">لا إشارات</div>');
    $$('[data-fd]',v).forEach(function(b){ b.addEventListener('click', function(){
      aAct('flag_decide',{id:+b.getAttribute('data-fd'), decision:b.getAttribute('data-d')}).then(function(){ ADMIN.flags(v); });
    });});
  });
};

/* ---------- كفاءة الإسناد التلقائي ---------- */
/* محرّك الإسناد يوزّع المهام بلا مشرفة. سؤال المالكة الحقيقي ليس «هل يعمل؟»
   بل «كم مرة اضطررت لتصحيحه؟» — فالمقاييس معروضة كنسب مع هدفها، لا كأرقام
   مجرّدة، ومكتوب صراحةً ماذا يعني تجاوز الهدف. */
ADMIN.assignkpi=function(v){
  v.innerHTML=skel(2);
  var d14=addDays(today(),-13);
  aAct('wf_assign_kpi',{from:d14, to:today()}).then(function(res){
    var k=res.kpi||{}, c=k.counts||{};
    function pct(x){ return x==null?'—':(Math.round(x*1000)/10)+'%'; }
    function bar(label, val, target, invert, note){
      var v100=Math.max(0, Math.min(100, (val||0)*100));
      var bad = target!=null && (invert ? (val||0) > target : (val||0) < target);
      return '<div class="evd"><span class="evd-l">'+esc(label)+'</span>'+
        '<span class="evd-bar"><i class="'+(bad?'bad':'')+'" style="width:'+v100+'%"></i></span>'+
        '<span class="evd-v">'+pct(val)+'</span></div>'+
        (target!=null?'<div class="muted small" style="margin:-2px 0 7px 0">الهدف '+pct(target)+
          (bad?' — <b>متجاوَز</b>':' — ضمن الهدف')+(note?' · '+esc(note):'')+'</div>':'');
    }
    v.innerHTML=
      '<div class="muted small" style="margin-bottom:10px">آخر ١٤ يوماً. المقصود قياس المحرّك لا الموظفات: '+
        'كل نسبة هنا عن قرارات النظام، ولا شيء منها يدخل تقييم أحد.</div>'+
      '<div class="statrow" style="margin-bottom:12px">'+
        '<div class="stat"><b>'+(c.decisions||0)+'</b><span>قرار إسناد</span></div>'+
        '<div class="stat"><b>'+(c.auto||0)+'</b><span>تلقائي</span></div>'+
        '<div class="stat"><b>'+(c.manual||0)+'</b><span>يدوي</span></div>'+
      '</div>'+
      '<div class="card" style="padding:13px">'+
        bar('إسناد يدوي', k.manual_assignment_rate, k.manual_assignment_target, true,
            'ارتفاعه يعني أن المحرّك لا يجد مرشّحة — راجعي المهارات والتغطية')+
        bar('نجاح التلقائي', k.auto_assignment_success_rate, 0.85, false)+
        bar('تجاوز الإدارة', k.owner_override_rate, 0.1, true, 'تصحيح متكرر = قاعدة ناقصة لا موظفة مخطئة')+
        bar('إعادة إسناد', k.reassignment_rate, 0.1, true)+
      '</div>'+
      '<div class="cbwhy" style="margin-top:10px">'+
        '<span>استثناءات: '+(c.exceptions||0)+'</span>'+
        '<span>مهام حرجة بلا إسناد: '+(k.unassigned_critical_tasks||0)+'</span>'+
        '<span>فجوات تغطية: '+(c.coverage_uncovered||0)+'</span>'+
      '</div>'+
      (k.manual_rate_breached
        ? '<div class="card" style="padding:11px 12px;margin-top:10px;border:1.5px solid var(--amber)">'+
          '<b>الإسناد اليدوي فوق هدفه</b><div class="muted small" style="margin-top:4px">'+
          'المعنى العملي: المحرّك لا يجد من يصلح للمهمة فتتدخّلين أنتِ. '+
          'الأثر يظهر عادةً من مهارة مشترطة لا تتقنها موظفات كافيات، أو تغطية ناقصة في نوع شفت.'+
          '</div></div>' : '')+
      '<div class="btnrow" style="margin-top:12px"><button class="btn ghost block" id="akRun">شغّلي الإسناد التلقائي الآن</button></div>'+
      '<div class="muted small" style="margin-top:6px">يُشغّل دورة إسناد فوراً للمهام المعلّقة بدل انتظار الدورة المجدولة. '+
        'لا يُلغي إسناداً قائماً ولا يتجاوز تثبيت الإدارة.</div>'+
      /* سياسة الأدوار: مَن يحقّ له أداء أيّ نوع مهمة. تُملكها الإدارة لأن
         تقسيم العمل في المقهى قرارها لا ثابتٌ في الكود. */
      '<div class="card" style="padding:13px;margin-top:14px"><h3>مَن يؤدّي أيّ مهمة</h3>'+
        '<div class="muted small" style="margin-bottom:10px">لكل نوع مهمة قائمة أدوار مرتّبة: '+
          '<b>الأول صاحب الدور الأصلي</b> ومَن بعده مساندة. المحرّك يمنع من ليست في القائمة، '+
          'ويُقدّم الأصلي على المساند. الموظفة التي لا دور معلن لها على شفتها لا تُمنع — '+
          'فالسياسة تعمل حيث أسندتِ الأدوار.</div>'+
        '<div id="rmBox">'+skel(2)+'</div></div>';
    /* محرّر مصفوفة الأدوار */
    var RMT={table_service:'خدمة الطاولات',bussing:'تبويس وترتيب',cashier:'الكاش',
             kitchen:'المطبخ',hookah:'الأراجيل'};
    var RSH={floor:'الصالة',kitchen:'المطبخ',cashier:'الكاش',hookah:'الأراجيل',runner:'ناقلة'};
    function paintMatrix(){
      aAct('settings_get',{}).then(function(sr){
        var box=$('#rmBox',v); if(!box) return;
        var m=((sr&&sr.config)||{})['engine.role_matrix'] || ((sr&&sr.settings)||{})['engine.role_matrix'] || null;
        if(!m){ box.innerHTML='<div class="muted small">لم تُقرأ السياسة — تظهر بعد أول حفظ من الإعدادات.</div>'; return; }
        box.innerHTML=Object.keys(RMT).map(function(tr){
          var list=(m[tr]||[]);
          return '<div class="rmrow"><div class="rmrow-h">'+esc(RMT[tr])+'</div>'+
            '<div class="rmrow-b">'+(list.length
              ? list.map(function(sr2,i){
                  return '<span class="rmchip'+(i===0?' prime':'')+'">'+esc(RSH[sr2]||sr2)+
                    (i===0?'<i>أصلي</i>':'<i>مساندة</i>')+'</span>';
                }).join('')
              : '<span class="muted small">بلا قاعدة — لا يُمنع أحد</span>')+'</div></div>';
        }).join('')+
        '<div class="muted small" style="margin-top:9px">للتعديل: الإعدادات ← '+
          '<span class="chip">engine.role_matrix</span></div>';
      });
    }
    paintMatrix();
    $('#akRun',v).addEventListener('click', function(){
      busyWrap(this, function(){
        return aAct('wf_autoassign_now',{}).then(function(r){
          if(r && r.ok){ toast((r.assigned||0)? ('أُسندت '+r.assigned+' مهمة ✔') : 'لا مهمة معلّقة قابلة للإسناد'); ADMIN.assignkpi(v); }
          else toast((r&&r.error)||'تعذّر التشغيل', true);
        });
      });
    });
  });
};

/* ---------- توفّر الموظفات الأسبوعي ---------- */
/* المحرّك يبني الجدول على التوفّر، ولم تكن هناك طريقة لإدخاله — فكانت
   القاعدة الافتراضية «الكل متاح دائماً»، وهي غير صحيحة عملياً. */
var AVST=[['available','متاحة',''],['preferred','تفضّل هذا اليوم','green'],['unavailable','غير متاحة','red']];
ADMIN.availability=function(v){
  v.innerHTML=skel(3);
  lookups(function(){
    var emps=(A.emps||[]).filter(function(e){ return e.active && e.role==='staff'; });
    /* roster_rules هو من يحمل availability (لا roster_get، فذاك للمسوّدة) */
    aAct('roster_rules',{}).then(function(res){
      var av={};
      ((res&&res.availability)||[]).forEach(function(a){ av[a.employee_id+'|'+a.dow]=a.state; });
      if(!emps.length){ v.innerHTML='<div class="empty">لا موظفات نشطات</div>'; return; }
      v.innerHTML='<div class="muted small" style="margin-bottom:10px">'+
          'الجدولة التلقائية تقرأ هذا الجدول. «غير متاحة» قيد صارم لا يخترقه المحرّك، '+
          'و«تفضّل» ترجيح لا ضمان. الافتراضي متاحة.</div>'+
        emps.map(function(e){
          return '<div class="card" style="padding:11px 12px"><b>'+esc(e.name)+'</b>'+
            '<div class="avg">'+DOWAR.map(function(dn,i){
              var st=av[e.id+'|'+i]||'available';
              var cls=st==='unavailable'?'no':(st==='preferred'?'pref':'');
              return '<button class="avg-d '+cls+'" data-av="'+e.id+'" data-dow="'+i+'" '+
                'data-st="'+st+'" aria-label="'+esc(e.name+' — '+dn)+'">'+
                '<b>'+esc(dn.slice(0,3))+'</b><span>'+
                (st==='unavailable'?'لا':(st==='preferred'?'يُفضّل':'متاحة'))+'</span></button>';
            }).join('')+'</div></div>';
        }).join('')+
        '<div class="muted small" style="margin-top:8px">اضغطي اليوم لتتبدّل حالته: متاحة ← تفضّل ← غير متاحة.</div>';
      $$('[data-av]',v).forEach(function(b){ b.addEventListener('click', function(){
        var cur=b.getAttribute('data-st');
        var order=['available','preferred','unavailable'];
        var next=order[(order.indexOf(cur)+1)%3];
        b.disabled=true;
        aAct('roster_availability_set',{employee_id:+b.getAttribute('data-av'),
          dow:+b.getAttribute('data-dow'), state:next}).then(function(r){
          b.disabled=false;
          if(!r || !r.ok){ toast((r&&r.error)||'تعذّر الحفظ', true); return; }
          b.setAttribute('data-st', next);
          b.className='avg-d '+(next==='unavailable'?'no':(next==='preferred'?'pref':''));
          $('span',b).textContent = next==='unavailable'?'لا':(next==='preferred'?'يُفضّل':'متاحة');
        }).catch(function(){ b.disabled=false; toast('تعذّر الاتصال', true); });
      });});
    });
  });
};

/* ---------- شفتات لم تُقفل ---------- */
/* لماذا شاشة مستقلة: المالكة غائبة كثيراً، والشفت المفتوح يفسد الساعات
   والتقييم وحساب الحضور معاً. الإغلاق القسري يُدوَّن في سجل التدقيق. */
ADMIN.openshifts=function(v){
  v.innerHTML=skel(2);
  aAct('open_shifts',{}).then(function(res){
    var rows=res.rows||[];
    if(!rows.length){
      v.innerHTML='<div class="empty">لا شفت مفتوح الآن — كل من سجّلت حضوراً سجّلت انصرافها.</div>';
      return;
    }
    var nowMs=Date.now();
    v.innerHTML='<div class="muted small" style="margin-bottom:10px">شفتات سُجّل فيها حضور بلا انصراف. '+
        'الإغلاق القسري يضع وقت الانصراف على نهاية الشفت المخطّطة، ويُسجَّل باسمك في سجل التدقيق — '+
        'ولا يُحسب تأخيراً ولا وقتاً إضافياً على الموظفة.</div>'+
      rows.map(function(r){
        var hrs=r.check_in?((nowMs-new Date(r.check_in).getTime())/3600000):0;
        var late=hrs>=12;
        return '<div class="card" style="padding:11px 12px"><div class="row" style="justify-content:space-between;gap:8px">'+
          '<div style="min-width:0"><b>'+esc(r.employee||'—')+'</b>'+
            (late?' <span class="chip red">'+Math.floor(hrs)+' ساعة مفتوحة</span>':' <span class="chip orange">'+hrs.toFixed(1)+' ساعة</span>')+
            '<div class="muted small">'+fmtD(r.day)+' · '+esc(r.area||'بلا منطقة')+' · حضور '+fmtT(r.check_in)+'</div></div>'+
          /* ليس btn sm: إغلاق شفت قسراً إجراء ذو أثر على ساعات موظفة —
           حجم الزر يتبع أثره، لا كثافة الصف. */
        '<button class="btn ghost" data-fc="'+r.shift_id+'" data-who="'+esc(r.employee||'')+'">إغلاق</button>'+
        '</div></div>';
      }).join('');
    $$('[data-fc]',v).forEach(function(b){ b.addEventListener('click', function(){
      var sid=+b.getAttribute('data-fc'), who=b.getAttribute('data-who');
      confirmSheet('إغلاق شفت '+who, 'سيُسجَّل الانصراف على نهاية الشفت المخطّطة، ويظهر الإجراء باسمك في سجل التدقيق. تابعي؟',
        'أغلقي الشفت', function(){
          aAct('force_checkout',{shift_id:sid}).then(function(r){
            if(r.ok){ toast('أُغلق الشفت ✔'); ADMIN.openshifts(v); } else toast(r.error||'تعذّر الإغلاق', true);
          });
        });
    });});
  });
};

/* ---------- مرحلة اليوم ---------- */
/* المحرّك يستنتج المرحلة من الساعة وحالة الطاولات. هذه الشاشة تُظهر استنتاجه
   ومستوى ثقته، وتسمح للمالكة بإعلان مرحلة مختلفة لمدة محددة بسبب مكتوب —
   لأن المحرّك لا يرى انقطاع كهرباء ولا حجزاً خاصاً. */
var DPH=[
  ['closed','مغلق','خارج ساعات العمل'],
  ['pre_open','قبل الفتح','الفريق في الطريق'],
  ['opening','التجهيز','مهام الافتتاح'],
  ['ready_for_first_guest','جاهز لأول ضيفة','التجهيز انتهى'],
  ['normal','خدمة عادية','إيقاع مستقر'],
  ['peak','ذروة','ضغط عالٍ — الأولوية للضيفات'],
  ['recovery','تهدئة','استرجاع الترتيب بعد الذروة'],
  ['closing_prep','تحضير الإقفال','بدء مهام الإغلاق'],
  ['service_closed','أُقفلت الخدمة','لا ضيفات جديدة'],
  ['closing','الإقفال','تنظيف وتسليم'],
  ['finalized','مُقفل نهائياً','اليوم مُرحَّل']
];
function dphName(k){ var n=k; DPH.forEach(function(x){ if(x[0]===k) n=x[1]; }); return n; }
function dphNote(k){ var n=''; DPH.forEach(function(x){ if(x[0]===k) n=x[2]; }); return n; }
ADMIN.dayphase=function(v){
  v.innerHTML=skel(2);
  aAct('day_state',{}).then(function(res){
    var d=res.day||{};
    var conf=d.confidence==='declared'?['orange','مُعلنة منك']
            :d.confidence==='high'?['green','ثقة عالية']:['','ثقة متوسطة'];
    v.innerHTML=
      '<div class="card" style="padding:14px"><div class="muted small">المرحلة الآن</div>'+
        '<div style="font-size:22px;font-weight:800;letter-spacing:-.01em;margin:2px 0 4px">'+esc(dphName(d.phase))+'</div>'+
        '<div class="muted small">'+esc(d.reason||dphNote(d.phase))+'</div>'+
        '<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:9px">'+
          '<span class="chip '+conf[0]+'">'+conf[1]+'</span>'+
          '<span class="chip">'+(d.source==='owner'?'إعلان الإدارة':'استنتاج المحرّك')+'</span>'+
          '<span class="chip">منذ '+fmtT(d.since)+'</span>'+
          '<span class="chip '+(d.is_service_open?'green':'')+'">'+(d.is_service_open?'الخدمة مفتوحة':'الخدمة مغلقة')+'</span>'+
        '</div>'+
        '<div class="muted small" style="margin-top:8px">يوم العمل '+esc(d.business_date||'—')+
          ' · دوام الخدمة '+esc((d.service||{}).open||'—')+'–'+esc((d.service||{}).close||'—')+
          (d.override?' · التجاوز ساري':'')+'</div>'+
      '</div>'+
      '<div class="btnrow" style="margin:4px 0 12px"><button class="btn ghost grow" id="dpTick">أعيدي الحساب الآن</button>'+
        '<button class="btn grow" id="dpDec">أعلني مرحلة</button></div>'+
      '<div class="muted small">إعادة الحساب تُشغّل المحرّك فوراً بدل انتظار الدورة. الإعلان يتجاوز المحرّك '+
        'لمدة تحدّدينها بسبب مكتوب، ثم يعود المحرّك تلقائياً — لا تجاوز دائم.</div>';

    $('#dpTick',v).addEventListener('click', function(){
      busyWrap(this, function(){
        return aAct('day_tick_now',{}).then(function(r){
          if(r.ok){ toast('أُعيد الحساب ✔'); ADMIN.dayphase(v); } else toast(r.error||'تعذّر', true);
        });
      });
    });
    $('#dpDec',v).addEventListener('click', function(){
      sheet('إعلان مرحلة',
        '<label class="f">المرحلة</label><select class="f" id="dpP">'+
          DPH.map(function(x){ return '<option value="'+x[0]+'"'+(x[0]===d.phase?' selected':'')+'>'+esc(x[1])+' — '+esc(x[2])+'</option>'; }).join('')+
        '</select>'+
        '<label class="f">لمدة (دقائق)</label><select class="f" id="dpM">'+
          [30,60,120,180,240].map(function(m){ return '<option value="'+m+'"'+(m===60?' selected':'')+'>'+m+' دقيقة</option>'; }).join('')+
        '</select>'+
        '<label class="f">السبب (يظهر للفريق وفي السجل)</label>'+
        '<textarea class="f" id="dpR" rows="2" placeholder="مثال: عطل في مكيّف الصالة من ٧ إلى ٩"></textarea>'+
        '<div class="btnrow"><button class="btn block" id="dpGo">أعلني</button></div>',
        function(ov, close){
          $('#dpGo',ov).addEventListener('click', function(){
            var reason=$('#dpR',ov).value.trim();
            if(reason.length<4){ toast('اكتبي سبباً واضحاً — الفريق سيقرأه', true); return; }
            var btn=this;
            busyWrap(btn, function(){
              return aAct('day_override',{phase:$('#dpP',ov).value, minutes:+$('#dpM',ov).value, reason:reason})
                .then(function(r){
                  if(r.ok){ close(); toast('أُعلنت المرحلة ✔'); ADMIN.dayphase(v); }
                  else toast(r.error||'تعذّر الإعلان', true);
                });
            });
          });
        });
    });
  });
};

/* ---------- عنق الزجاجة ---------- */
ADMIN.bottleneck=function(v){
  v.innerHTML=skel(2);
  aAct('ops_bottleneck',{}).then(function(res){
    var all=res.all||{}, areas=res.by_area||[];
    function block(b, title){
      var list=b.bottlenecks||[];
      return '<div class="card" style="padding:12px">'+
        '<div class="row" style="justify-content:space-between"><b>'+esc(title)+'</b>'+
          (b.open_tables!=null?'<span class="chip">'+b.open_tables+' طاولة مشغولة</span>':'')+'</div>'+
        '<div style="font-size:15px;font-weight:700;margin:5px 0 2px">'+esc(b.headline||'—')+'</div>'+
        (list.length
          ? '<div class="cbwhy" style="margin-top:6px">'+list.map(function(x){
              return '<span>'+esc(x.label||x.kind||'')+(x.minutes!=null?' · '+x.minutes+'د':'')+'</span>';
            }).join('')+'</div>'
          : '<div class="muted small">لا اختناق مرصود.</div>')+
        (b.primary_owner?'<div class="muted small" style="margin-top:6px">الجهة المعنية: '+esc(b.primary_owner)+'</div>':'')+
      '</div>';
    }
    v.innerHTML='<div class="muted small" style="margin-bottom:10px">'+
        esc(all.note||'مشتق من أزمنة حالات الطاولات — ليس مبيعات ولا نظام طلبات')+'</div>'+
      block(all,'الكافيه كله')+
      (areas.length?'<h3 style="margin:14px 2px 8px;font-size:14px">حسب المنطقة</h3>'+
        areas.map(function(a){ return block(a.detail||{}, a.name||'منطقة'); }).join(''):'');
  });
};

/* ---------- أخطاء تقنية ---------- */
/* الأخطاء تُسجَّل في rko_errors مع رقم مرجعي يُعطى للموظفة. بلا هذه الشاشة
   يبقى الرقم بلا معنى لأن أحداً لا يستطيع البحث عنه. */
ADMIN.errors=function(v){
  v.innerHTML=skel(2);
  aAct('errors_list',{}).then(function(res){
    var rows=res.rows||[];
    v.innerHTML='<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">'+
        '<span class="chip'+((res.last_24h||0)>0?' orange':' green')+'">آخر ٢٤ ساعة: '+(res.last_24h||0)+'</span>'+
        '<span class="chip">الإجمالي: '+(res.total||0)+'</span></div>'+
      '<div class="muted small" style="margin-bottom:10px">إذا أعطى النظام موظفةً رقماً مرجعياً، ابحثي عنه هنا. '+
        'الموظفة لا ترى تفاصيل تقنية أبداً — ترى رسالة عربية ورقماً فقط.</div>'+
      (rows.length
        ? '<div class="scrollx"><table class="tbl"><tr><th>#</th><th>الوقت</th><th>الإجراء</th><th>من</th><th>الرمز</th><th>الرسالة</th></tr>'+
          rows.map(function(x){
            return '<tr><td style="direction:ltr">'+x.id+'</td><td>'+fmtD(x.ts)+' '+fmtT(x.ts)+'</td>'+
              '<td style="direction:ltr;text-align:left">'+esc(x.action||'—')+'</td><td>'+esc(x.who||'—')+'</td>'+
              '<td style="direction:ltr">'+esc(x.sqlstate||'—')+'</td>'+
              '<td class="small">'+esc(x.message||'—')+'</td></tr>';
          }).join('')+'</table></div>'
        : '<div class="empty">لا أخطاء مسجّلة — النظام لم يرفع خطأ داخلياً واحداً.</div>');
  });
};

/* ---------- سجل قرارات الموقع ---------- */
/* عن قصد: يُعرض مستوى الثقة والمخاطر لكل قرار. الموقع لا يمنع التلاعب
   مئة بالمئة، وإخفاء ذلك أخطر من إظهاره. */
ADMIN.geo=function(v){
  v.innerHTML=skel(2);
  aAct('geo_log',{}).then(function(res){
    var rows=res.rows||[];
    var RK={low:['green','منخفض'], medium:['orange','متوسط'], high:['red','مرتفع']};
    var DC={accept:['green','مقبول'], reject:['red','مرفوض'], warn:['orange','بتحذير']};
    v.innerHTML='<div class="muted small" style="margin-bottom:10px">'+
        'قرارات قبول أو رفض تسجيل الحضور والانصراف بحسب الموقع. '+
        '<b>الموقع لا يمنع التلاعب تماماً</b> — دقّة الهاتف تتفاوت، ولذلك يُسجَّل مستوى ثقة ومخاطرة لكل قرار '+
        'بدل الاكتفاء بنعم/لا. اقرئي العمود الأخير قبل أي حديث مع موظفة.</div>'+
      (rows.length
        ? '<div class="scrollx"><table class="tbl"><tr><th>الوقت</th><th>من</th><th>النوع</th><th>القرار</th>'+
          '<th>المسافة</th><th>الدقّة</th><th>الثقة</th><th>المخاطرة</th></tr>'+
          rows.map(function(g){
            var dc=DC[g.decision]||['', g.decision||'—'], rk=RK[g.risk]||['', g.risk||'—'];
            return '<tr><td>'+fmtD(g.at)+' '+fmtT(g.at)+'</td><td>'+esc(g.who||'—')+'</td>'+
              '<td>'+(g.kind==='out'?'انصراف':'حضور')+'</td>'+
              '<td><span class="chip '+dc[0]+'">'+esc(dc[1])+'</span>'+(g.code?'<div class="muted small" style="direction:ltr">'+esc(g.code)+'</div>':'')+'</td>'+
              '<td>'+(g.distance_m!=null?g.distance_m+' م':'—')+'</td>'+
              '<td>'+(g.accuracy_m!=null?'±'+g.accuracy_m+' م':'—')+'</td>'+
              '<td>'+esc(g.confidence||'—')+'</td>'+
              '<td><span class="chip '+rk[0]+'">'+esc(rk[1])+'</span></td></tr>';
          }).join('')+'</table></div>'
        : '<div class="empty">لا قرارات موقع مسجّلة بعد</div>');
  });
};

/* ============================ الإقلاع ============================ */
// تحديث تلقائي: عند تغيّر نسخة البناء يُنظَّف الكاش القديم ذاتياً دون تدخل
(function(){
  try{
    var prev=localStorage.getItem('rko_build');
    if(prev && prev!==BUILD){
      localStorage.removeItem('rko_state');   // كاش العرض فقط — الجلسة تبقى
      if('caches' in window){ caches.keys().then(function(ks){ ks.forEach(function(k){ caches.delete(k); }); }); }
    }
    localStorage.setItem('rko_build', BUILD);
  }catch(e){}
  // دعم رابط الطوارئ ?reset=1 (اختياري) دون الاعتماد عليه
  var q=location.search||'';
  if(q.indexOf('reset=')>-1){
    try{ localStorage.removeItem('rko_sess'); localStorage.removeItem('rko_state'); localStorage.removeItem('rko_q');
      if(q.indexOf('reset=all')>-1){ localStorage.removeItem('rko_key'); localStorage.removeItem('rko_devtok'); } }catch(e){}
    history.replaceState(null,'',location.pathname);
  }
})();
var deferredPrompt=null;
window.addEventListener('beforeinstallprompt', function(e){ e.preventDefault(); deferredPrompt=e; });
/* تحديث تلقائي للجميع: يسحب أحدث نسخة فور نشرها دون تدخل من المستخدم */
var _upBusy=false;
function checkUpdate(){
  if(_upBusy) return; _upBusy=true;
  try{
    fetch('version.json?t='+Date.now(), {cache:'no-store'}).then(function(r){ return r.ok?r.json():null; }).then(function(j){
      _upBusy=false;
      if(j && j.build && j.build!==BUILD){
        try{ localStorage.removeItem('rko_state'); }catch(e){}
        // لا يكفي حذف الكاش: عامل الخدمة القديم يبقى مسيطراً ويعيد تقديم النسخة القديمة
        var swDone = ('serviceWorker' in navigator)
          ? navigator.serviceWorker.getRegistrations()
              .then(function(rs){ return Promise.all(rs.map(function(r){ return r.update().catch(function(){}); })); })
              .catch(function(){})
          : Promise.resolve();
        var cacheDone = ('caches' in window)
          ? caches.keys().then(function(ks){ return Promise.all(ks.map(function(k){ return caches.delete(k); })); }).catch(function(){})
          : Promise.resolve();
        Promise.all([swDone, cacheDone]).then(function(){ location.reload(true); });
      }
    }).catch(function(){ _upBusy=false; });
  }catch(e){ _upBusy=false; }
}
setInterval(checkUpdate, 150000);
document.addEventListener('visibilitychange', function(){ if(!document.hidden) checkUpdate(); });
window.addEventListener('focus', checkUpdate);
function applyFont(){ try{ document.documentElement.classList.toggle('font-lg', localStorage.getItem('rko_font')==='lg'); }catch(e){} }
function boot(){
  applyTheme(); applyFont();
  var K=getKey();
  if(!K || K.indexOf('هنا')>-1){
    document.body.className='no-nav';
    APP.innerHTML='<div class="login-hero"><div class="logo">ر</div><h1 style="font-size:24px;margin:0">ريحانة</h1><div style="opacity:.75;font-size:13.5px">إعداد أول مرة</div></div>'+
      '<div class="wrap"><div class="card" style="margin-top:14px"><h3>ربط قاعدة البيانات</h3>'+
      '<div class="small muted">من Supabase: Settings ← API ← انسخي مفتاح <b>anon public</b> والصقيه هنا. يُحفظ على هذا الجهاز فقط ولا يُطلب مرة أخرى.</div>'+
      '<label class="f">مفتاح anon</label><textarea class="f" id="setKey" style="direction:ltr;text-align:left;font-size:12px"></textarea>'+
      '<div class="btnrow"><button class="btn block" id="setGo">حفظ وبدء التشغيل</button></div></div></div>';
    $('#setGo').addEventListener('click', function(){
      var k=$('#setKey').value.trim();
      if(k.length<30){ toast('المفتاح غير مكتمل', true); return; }
      try{ localStorage.setItem('rko_key', k); }catch(e){}
      boot2();
    });
    return;
  }
  boot2();
}
function boot2(){
  loadSess();
  if(S.token && S.role==='staff') startStaff();
  else if(S.token && S.role==='admin') startAdmin();
  else renderLogin();
}
/* عامل الخدمة: شرط لا غنى عنه لإشعارات الدفع.
   الكود السابق كان يُلغي تسجيله في كل فتحة ولا يسجّله أبداً، فاستحال وصول أي إشعار:
   بلا عامل نشط لا يكتمل navigator.serviceWorker.ready فيتوقف الاشتراك بصمت.
   حماية النسخة القديمة تتم عبر فحص version.json + reg.update() لا بإلغاء التسجيل. */
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').then(function(reg){
    try{ reg.update(); }catch(e){}
    navigator.serviceWorker.ready.then(function(){
      try{ if(S && S.token) ensurePush(function(){}); }catch(e){}
    });
  }).catch(function(){});
}
boot();
})();
