/* ===================== الوصفات — وحدة مستقلّة =====================
   لا تُحمَّل إلا حين تفتح الموظفة القسم. موظفة السيرفس التي لن تفتحه
   أبداً لا تنزل على هاتفها بايتاً واحداً منه، وapp.js لا يكبر.

   لا تُعرّف هذه الوحدة أدواتها: تستعمل جسر app.js نفسه (esc/sheet/
   toast/sAct) فلا يتكرّر منطقٌ ولا يتناقض تنسيقٌ بين الشاشتين.

   والتصميم يقرأ رموز النظام نفسها من app.css — لا لون سطريّ ولا قياس
   ثابت — فينقلب مع السمة الليلية والنهارية معه لا ضدّه. */
(function(){
"use strict";
/* الجسر يُلتقط عند الفتح لا عند التحميل: ترتيب تحميل الملفّين ليس
   مضموناً (تخزين مؤقّت، عامل خدمة، حزمة اختبار)، والتقاطُه مبكراً
   يجعل الوحدة تنكسر على ترتيبٍ لا تتحكّم فيه. */
var B = window.__RKO || {};
var $  = function(s, r){ return (r||document).querySelector(s); };
var $$ = function(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };

var RC = {rows:null, q:'', cat:'', host:null, tmr:null};


/* ---------- الفهرس ---------- */
function paint(){
  var h = RC.host; if(!h) return;
  if(!RC.rows){ h.innerHTML = '<div class="empty">جارٍ التحميل…</div>'; return; }
  if(!RC.rows.length){ h.innerHTML = '<div class="empty">لا أصناف مُفعّلة</div>'; return; }

  var cats = [], seen = {};
  RC.rows.forEach(function(r){ var c=r.cat||'أخرى'; if(!seen[c]){ seen[c]=1; cats.push(c); } });

  var nq = norm(RC.q);
  var list = RC.rows.filter(function(r){
    if(RC.cat && (r.cat||'أخرى') !== RC.cat) return false;
    if(!nq) return true;
    return norm(r.name).indexOf(nq) >= 0 || norm(r.cat||'').indexOf(nq) >= 0;
  });

  var html =
    '<div class="rcp-bar">'+
      '<input class="rcp-s" id="rcpQ" type="search" inputmode="search" '+
        'placeholder="ابحثي عن صنف" value="'+B.esc(RC.q)+'" autocomplete="off">'+
      '<button class="rcp-quiz" id="rcpQuiz">راجعي معي</button>'+
    '</div>'+
    '<div class="rcp-cats">'+
      '<button class="rcp-c'+(RC.cat?'':' on')+'" data-c="">الكل<i>'+RC.rows.length+'</i></button>'+
      cats.map(function(c){
        var n = RC.rows.filter(function(r){ return (r.cat||'أخرى')===c; }).length;
        return '<button class="rcp-c'+(RC.cat===c?' on':'')+'" data-c="'+B.esc(c)+'">'+
               B.esc(c)+'<i>'+n+'</i></button>';
      }).join('')+
    '</div>';

  if(!list.length){
    html += '<div class="empty">لا صنف بهذا الاسم</div>';
  } else {
    var cur = '';
    html += list.map(function(r){
      var head = '';
      if(!RC.cat && (r.cat||'أخرى') !== cur){ cur = r.cat||'أخرى'; head = '<div class="rcp-h">'+B.esc(cur)+'</div>'; }
      return head +
        '<button class="rcp-i" data-id="'+B.esc(r.id)+'">'+
          '<span class="rcp-n">'+B.esc(r.name)+'</span>'+
          '<span class="rcp-m">'+
            (r.cup?'<span>'+B.esc(r.cup)+'</span>':'')+
            (r.blender?'<span>خلاط</span>':'')+
            (r.ahead&&!r.now?'<span>يُحضَّر مسبقاً</span>':'')+
          '</span>'+
        '</button>';
    }).join('');
  }
  h.innerHTML = html;

  var qi = $('#rcpQ', h);
  qi.addEventListener('input', function(){
    RC.q = qi.value;
    var at = qi.selectionStart;
    paint();
    var nqi = $('#rcpQ', RC.host); if(nqi){ nqi.focus(); try{ nqi.setSelectionRange(at, at); }catch(e){} }
  });
  $('#rcpQuiz', h).addEventListener('click', quizStart);
  $$('[data-c]', h).forEach(function(b){ b.addEventListener('click', function(){
    RC.cat = b.getAttribute('data-c'); paint(); }); });
  $$('[data-id]', h).forEach(function(b){ b.addEventListener('click', function(){
    openItem(b.getAttribute('data-id')); }); });
}

function fmtSec(n){
  n = Math.max(0, n|0);
  return n >= 60 ? (Math.floor(n/60)+':'+('0'+(n%60)).slice(-2)) : (n+' ث');
}
/* مؤقّت يدٌ واحدة تُشغّله: زرٌّ واحد يبدأ ويوقف ويُصفّر بعد الانتهاء.
   وينتهي بنبضة اهتزاز إن سمح الجهاز — الصوت لا يُسمع في مطبخٍ عامل. */
function wireTimer(ov){
  var box = $('#rcpTm', ov); if(!box) return;
  var total = +box.getAttribute('data-s') || 0, left = total, t = null;
  var val = $('#rcpTv', ov), btn = $('#rcpTb', ov);
  /* الوافل مدّته تتغيّر، فالموظفة تضبطها بنصف دقيقة في كل ضغطة —
     لا حقل رقميّ تكتب فيه ويداها مشغولتان. */
  $$('[data-tadj]', ov).forEach(function(pb){ pb.addEventListener('click', function(){
    if(t) return;
    total = Math.min(1800, Math.max(30, total + (+pb.getAttribute('data-tadj'))));
    left = total; val.textContent = fmtSec(left);
  }); });
  /* طبقةٌ تملأ الشاشة أثناء العدّ: الموظفة تنظر إليها من بعيد ويداها
     مشغولتان، فالرقم وحده يجب أن يُقرأ — لا وصفة تحته ولا زرّ يشتّت. */
  var ovl = null, buzz = null;
  function layer(name){
    if(ovl) return ovl;
    ovl = document.createElement('div');
    ovl.className = 'rcp-tovl';
    ovl.innerHTML = '<div class="tov-n">'+B.esc(name||'')+'</div>'+
      '<div class="tov-v" id="tovV">'+fmtSec(left)+'</div>'+
      '<button class="tov-x" id="tovX">إلغاء</button>';
    document.body.appendChild(ovl);
    ovl.querySelector('#tovX').addEventListener('click', function(){
      if(t){ stop(); left = total; paintT(); } else { hush(); }
    });
    return ovl;
  }
  function drop(){ if(ovl && ovl.parentNode) ovl.parentNode.removeChild(ovl); ovl = null; }
  /* الاهتزاز يستمرّ دقيقة كاملة حتى تلمسه: نبضةٌ واحدة تضيع في الضغط */
  function hush(){ clearInterval(buzz); buzz = null;
    try{ if(navigator.vibrate) navigator.vibrate(0); }catch(e){}
    drop(); box.classList.remove('done'); }

  function paintT(){
    val.textContent = fmtSec(left);
    var tv = ovl && ovl.querySelector('#tovV'); if(tv) tv.textContent = fmtSec(left);
  }
  function stop(){ clearInterval(t); t = null; btn.textContent = 'ابدئي';
    box.classList.remove('run'); drop(); }
  function done(){
    clearInterval(t); t = null; btn.textContent = 'ابدئي'; box.classList.remove('run');
    left = 0; paintT(); box.classList.add('done');
    if(ovl){ ovl.classList.add('done');
      var tv = ovl.querySelector('#tovV'); if(tv) tv.textContent = 'انتهى';
      var xb = ovl.querySelector('#tovX'); if(xb) xb.textContent = 'تمام';
    }
    var untilT = Date.now() + 60000;
    function pulse(){
      if(Date.now() > untilT){ hush(); left = total; paintT(); return; }
      try{ if(navigator.vibrate) navigator.vibrate([420,260]); }catch(e){}
    }
    pulse(); buzz = setInterval(pulse, 700);
  }
  btn.addEventListener('click', function(){
    if(t){ stop(); left = total; paintT(); return; }
    if(buzz){ hush(); left = total; paintT(); return; }
    box.classList.remove('done'); btn.textContent = 'إيقاف'; box.classList.add('run');
    layer(box.getAttribute('data-name') || '');
    paintT();
    t = setInterval(function(){
      left--; paintT();
      if(left <= 0) done();
    }, 1000);
  });
  /* مغادرة الورقة تُوقف العدّاد: مؤقّتٌ يعمل بلا شاشة يُربك لا يُساعد */
  var mo = new MutationObserver(function(){
    if(!document.body.contains(box)){ stop(); hush(); mo.disconnect(); }
  });
  mo.observe(document.body, {childList:true, subtree:true});
}

/* تسوية البحث: الموظفة تكتب «لاتيه» و«لاته»، و«آيس» و«ايس» */
function norm(t){
  return String(t||'').replace(/[ً-ْـ]/g,'')
    .replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')
    .replace(/\s+/g,' ').trim().toLowerCase();
}

/* ---------- صفحة الصنف ---------- */
function openItem(id){
  B.sAct('recipe', {id:id}).then(function(r){
    if(!r || !r.ok || !r.item){ B.toast('تعذّر فتح الصنف', true); return; }
    var it = r.item, h = '';

    /* الصورة أولاً: الشكل النهائي هو المرجع الذي تقيس عليه. تُبنى بـ
       createElement لا بنصّ داخل innerHTML — لا تُركَّب وسائط من نصّ. */
    if(it.photo) h += '<div class="rcp-ph big" id="rcpPh"></div>';

    var chips = [];
    if(it.cup)  chips.push('الكوب: '+it.cup);
    if(it.ice)  chips.push('الثلج: '+it.ice);
    if(it.fill_line) chips.push('خطّ التعبئة: '+it.fill_line);
    if(!it.timer && it.mix_seconds) chips.push('الخلط: '+it.mix_seconds+' ثانية');
    else if(!it.timer && it.mix_text) chips.push('الخلط: '+it.mix_text);
    if(it.blender) chips.push('خلاط');
    if(chips.length)
      h += '<div class="rcp-chips">'+chips.map(function(c){
        return '<span>'+B.esc(c)+'</span>'; }).join('')+'</div>';

    /* ملاحظة الضغط أولاً: هي ما تُقرأ والمقهى مزدحم، وما عداها يُقرأ
       في الهدوء. ترتيبٌ يتبع لحظة الاستعمال لا ترتيب الجدول. */
    /* المؤقّت التنازليّ: ٢٥ ثانية للفرابيه، ودقائق الوافل. يعمل داخل
       الصفحة نفسها فلا تخرج الموظفة لتطبيق ساعة وتعود. */
    var tsec = +it.timer || +it.mix_seconds || 0;
    var manual = !!it.timer_manual || (!tsec && it.blender);
    if(tsec || manual){
      h += '<div class="rcp-tm'+(manual&&!tsec?' man':'')+'" id="rcpTm" data-s="'+(tsec||60)+'"'+
        ' data-name="'+B.esc(it.name||'')+'">'+
        '<div class="tm-l">'+B.esc(it.timer_label||(manual?'المدّة تختلف — حدّديها':'المؤقّت'))+'</div>'+
        '<div class="tm-row">'+
          (manual?'<button class="tm-pm" data-tadj="-30" aria-label="أنقص">−</button>':'')+
          '<div class="tm-v" id="rcpTv">'+fmtSec(tsec||60)+'</div>'+
          (manual?'<button class="tm-pm" data-tadj="30" aria-label="زد">+</button>':'')+
        '</div>'+
        '<button class="tm-b" id="rcpTb">ابدئي</button></div>';
    }

    if(it.busy) h += '<div class="rcp-busy"><b>وقت الضغط</b><span>'+B.esc(it.busy)+'</span></div>';
    if(it.warn) h += '<div class="rcp-warn"><b>انتبهي</b><span>'+B.esc(it.warn)+'</span></div>';

    var ing = it.ingredients || [];
    if(ing.length){
      h += '<div class="rcp-sec">المكوّنات</div><div class="rcp-ing">'+
        ing.map(function(x){
          var q = (x.qty!=null? x.qty : '') + (x.unit? ' '+x.unit : '');
          return '<div class="rcp-ir"><b>'+B.esc(x.name||'')+'</b>'+
                 (q.trim()?'<span>'+B.esc(q.trim())+'</span>':'')+
                 (x.note?'<i>'+B.esc(x.note)+'</i>':'')+'</div>';
        }).join('')+'</div>';
    }

    var st = it.steps || [];
    if(st.length){
      h += '<div class="rcp-sec">الخطوات</div><ol class="rcp-st">'+
        st.map(function(s){ return '<li>'+B.esc(String(s))+'</li>'; }).join('')+'</ol>';
    }

    var tl = it.tools || [];
    if(tl.length)
      h += '<div class="rcp-sec">الأدوات</div><div class="rcp-chips">'+
        tl.map(function(t){ return '<span>'+B.esc(typeof t==='string'?t:(t.name||''))+'</span>'; }).join('')+'</div>';

    if(it.garnish) h += '<div class="rcp-sec">التزيين</div><p class="rcp-p">'+B.esc(it.garnish)+'</p>';
    if(it.success) h += '<div class="rcp-ok"><b>علامات النجاح</b><span>'+B.esc(it.success)+'</span></div>';
    if(it.notes)   h += '<div class="rcp-sec">ملاحظات الوصفة</div><p class="rcp-p">'+B.esc(it.notes)+'</p>';

    /* ملاحظات الفريق: ما تعلّمه الفريق بالتجربة يبقى مع الصنف نفسه،
       فلا يُعاد اكتشافه مع كل موظفة جديدة. وهذا هو ثبات الجودة. */
    var tn = it.team_notes || [];
    h += '<div class="rcp-sec">ملاحظات الفريق'+(tn.length?' ('+tn.length+')':'')+'</div>';
    h += tn.length
      ? '<div class="rcp-tn">'+tn.map(function(n){
          return '<div class="rcp-tnr"><span>'+B.esc(n.text)+'</span>'+
                 '<i>'+B.esc(n.who||'')+'</i></div>'; }).join('')+'</div>'
      : '<div class="rcp-p muted">لا ملاحظات بعد — أضيفي ما تعلّمتِه.</div>';
    h += '<div class="rcp-add"><input class="f" id="rcpN" placeholder="ملاحظة تُثبّت الجودة">'+
         '<button class="btn sm" id="rcpNGo">أضيفي</button></div>';

    B.sheet(it.name, h, function(ov, close){
      var phb = $('#rcpPh', ov);
      if(phb && typeof it.photo === 'string' && /^data:image\//.test(it.photo)){
        var im = document.createElement('img');
        im.alt = it.name || ''; im.src = it.photo;
        phb.appendChild(im);
      }
      wireTimer(ov);
      /* الخطوة تُلمَس فتُشطَب: الوصفة صارت شيئاً تعملين عليه لا نصّاً
         تقرئينه. لا يُحفظ شيء في الخادم — هذا أثرٌ لعينها لا سجلّ عليها. */
      $$('.rcp-st li', ov).forEach(function(li){
        li.setAttribute('role','button');
        li.setAttribute('tabindex','0');
        function flip(){ li.classList.toggle('on');
          li.setAttribute('aria-pressed', li.classList.contains('on')?'true':'false'); }
        li.addEventListener('click', flip);
        li.addEventListener('keydown', function(e){
          if(e.key===' '||e.key==='Enter'){ e.preventDefault(); flip(); }
        });
      });
      var nb = $('#rcpNGo', ov);
      nb.addEventListener('click', function(){
        var t = ($('#rcpN', ov)||{}).value || '';
        if(!t.trim()){ B.toast('اكتبي الملاحظة', true); return; }
        nb.disabled = true;
        B.sAct('recipe_note_add', {item_id:id, text:t}, true).then(function(x){
          nb.disabled = false;
          if(x && x.ok){ close(); openItem(id); }
        }, function(){ nb.disabled = false; });
      });
    });
  }).catch(function(){ B.toast('تعذّر الاتصال', true); });
}

/* ---------- الاختبار: بلا خيارات ----------
   الخيارات تُدرِّب على التعرّف لا على الاستدعاء. وموظفةٌ أمام الآلة
   تستدعي من ذاكرتها ولا تُعرض عليها أربعة احتمالات. فالسؤال مفتوح،
   والتصحيح متسامحٌ مع الإملاء لا مع الجهل. */
function quizStart(){
  B.sAct('recipe_quiz_new', {}).then(function(q){
    if(!q || !q.ok) return;                       /* البوابة تُظهر الخطأ */
    B.sheet('مراجعة سريعة',
      '<p class="rcp-q">'+B.esc(q.q).replace(/\n/g,'<br>')+'</p>'+
      (q.kind==='ing'
        ? '<div class="rcp-p muted">اكتبي ما تتذكّرينه — الترتيب لا يهمّ.</div>'
        : '')+
      '<textarea class="f" id="rcpA" rows="3" placeholder="إجابتك"></textarea>'+
      '<div class="btnrow"><button class="btn block" id="rcpAGo">شوفي إجابتي</button></div>',
      function(ov, close){
        $('#rcpAGo', ov).addEventListener('click', function(){
          var a = ($('#rcpA', ov)||{}).value || '';
          if(!a.trim()){ B.toast('اكتبي إجابتك', true); return; }
          this.disabled = true;
          B.sAct('recipe_quiz_answer', {id:q.id, answer:a}, true).then(function(r){
            if(!r || !r.ok) return;
            close();
            B.sheet('كيف كانت؟',
              '<div class="rcp-res '+B.esc(r.verdict)+'">'+
                '<b>'+(+r.hits)+' من '+(+r.total)+'</b>'+
                '<span>'+B.esc(r.msg||'')+'</span></div>'+
              '<div class="btnrow">'+
                '<button class="btn block" id="rcpSee">افتحي الوصفة</button>'+
                '<button class="btn ghost block" id="rcpMore">صنف آخر</button></div>',
              function(ov2, close2){
                $('#rcpSee', ov2).addEventListener('click', function(){ close2(); openItem(r.item_id); });
                $('#rcpMore', ov2).addEventListener('click', function(){ close2(); quizStart(); });
              });
          });
        });
      });
  }).catch(function(){ B.toast('تعذّر الاتصال', true); });
}

/* الشاشة تُطمَس حين يخرج التطبيق للخلفية: جهازٌ متروك على الطاولة لا
   يبقى عارضاً وصفةً لمن يمرّ. هذا يعمل فعلاً — بخلاف منع اللقطة. */
function blurGuard(){
  if(blurGuard._on) return; blurGuard._on = true;
  document.addEventListener('visibilitychange', function(){
    document.body.classList.toggle('rcp-hide', document.hidden);
  });
}

window.RCP = {
  open: function(host){
    B = window.__RKO || B;
    RC.host = host; blurGuard();
    if(RC.rows){ paint(); return; }
    paint();
    B.sAct('recipes', {}).then(function(r){
      if(!r || !r.ok){ host.innerHTML = '<div class="empty">'+B.esc((r&&r.error)||'تعذّر التحميل')+'</div>'; return; }
      RC.rows = r.rows || []; paint();
    }).catch(function(){ host.innerHTML = '<div class="empty">تعذّر الاتصال</div>'; });
  }
};
})();
