/* ============================================================================
   RCOS — محرّك التشغيل: الضغط، الرواق، وبوابة الدور
   التاريخ: 2026-07-30   ·   الإصدار المرافق: 2026-07-30.4
   ----------------------------------------------------------------------------
   هذا الملف سجلٌّ موثّق لما طُبّق فعلاً على قاعدة البيانات، مع مسار تراجع
   لكل بند. الترتيب هو ترتيب التطبيق.

   الدافع: مراجعة تشغيلية بعين صاحب المقهى — من دخول الموظفة إلى خروجها،
   في الذروة وفي الرواق. المراجعة كشفت أربعة عيوب مقيسة، لا آراء:

   ع١ — مصفوفة الأدوار ناقصة: ١١ قالباً من ٢٨ (٣٩٪) بأدوار
        cleaning و kitchen_support غير مذكورة في engine.role_matrix، فترجع
        rko__role_allowed قيمة NULL ⇒ لا حكم دور، و rko__role_rank قيمة
        NULL ⇒ وزن role_match (٣٥ نقطة) لا يعمل. أي: «المحرّك الواعي
        بالدور» كان أعمى على ٣٩٪ من العمل.

   ع٢ — البوابة الصلبة تستطيع تجميد عملٍ حرج: في يوم 2026-07-29 كانت
        الأدوار الثلاثة كلها floor، فصارت قوالب الأراجيل الستّ وقوالب
        الكاش الثلاثة (٩ قوالب) ممنوعةً على كل حاضرة — ومنها «إطفاء الفحم
        بالكامل» عند الإغلاق. بوابةٌ تمنع إطفاء الفحم ليست ذكاءً.

   ع٣ — التصنيف التشغيلي كان يُخمَّن من كلمات اسم المهمة بالعربية، فأخطأ:
        «تفقّد مخزون التحضير» (طبقة ٣) ⇒ live بسبب «تحضير»
        «تنظيف أسطح التحضير» (طبقة ٣) ⇒ live للسبب نفسه
        «ترتيب رفوف الخدمة»  (طبقة ٤) ⇒ live بسبب «خدمة»
        أثره مزدوج: مهمة تنظيف تُعامل كطلب زبونة (criticality وغير قابلة
        للإيقاف)، وترفع إنذار «الخدمة أولاً» بلا زبونة واحدة.

   ع٤ — مقياس الضغط لا مدخلات له: rko_pressure فيها ٤ صفوف في عمر
        المشروع، والإشارات المفتوحة ٠ ⇒ pressure_level = 0 دائماً ⇒ لا
        سلوك ذروة ولا سلوك رواق أصلاً. وخريطة الطاولات — التي تُحدَّث
        فعلاً من الموظفات — لم تكن تُقرأ.
   ==========================================================================*/


/* ---------------------------------------------------------------------------
   ١) role_gate_coverage_aware_and_full_matrix
   إكمال المصفوفة + مسار مساندة لكل دور. الترتيب معنوي: الأول = الدور
   الأصلي (وزن ١٫٠)، وما بعده = مساندة مقبولة (٠٫٣٥). والتمييز يبقى قائماً:
   floor أصلٌ في ١٣ قالباً، hookah في ٦، kitchen في ٦، cashier في ٣.
   --------------------------------------------------------------------------*/
update rko_wf_config set
  value = jsonb_build_object(
    'table_service',   jsonb_build_array('floor','cashier'),
    'floor_service',   jsonb_build_array('floor','cashier'),
    'bussing',         jsonb_build_array('floor','kitchen'),
    'cashier',         jsonb_build_array('cashier','floor'),
    'kitchen',         jsonb_build_array('kitchen','floor'),
    'kitchen_support', jsonb_build_array('kitchen','floor'),
    'hookah',          jsonb_build_array('hookah','floor'),
    'cleaning',        jsonb_build_array('floor','kitchen','hookah','cashier')
  ),
  config_version = coalesce(config_version,0)+1,
  reason = 'إكمال المصفوفة + مسار مساندة لكل دور حتى لا تبقى مهمة بلا من يأخذها',
  updated_at = now()
where key='engine.role_matrix';

/* هل يوجد الآن — بين الحاضرات فعلاً — من يسمح دورها بهذه المهمة؟
   هذا هو الفرق بين توزيعٍ بالدور وقفلٍ يوقف العمل. */
create or replace function rko__role_covered(p_day date, p_task_role text, p_exclude integer default null)
returns boolean language plpgsql stable security definer set search_path to 'public' as $fn$
begin
  if coalesce(nullif(p_task_role,''),'') = '' then return false; end if;
  return exists(
    select 1
      from rko_shifts s
      join rko_attendance a on a.shift_id = s.id
     where s.day = p_day
       and s.status = 'active'
       and a.check_in is not null
       and a.check_out is null
       and (p_exclude is null or s.employee_id <> p_exclude)
       and coalesce(rko__role_allowed(s.role_on_shift, p_task_role), false)
  );
end $fn$;

revoke all on function rko__role_covered(date,text,integer) from public;
revoke all on function rko__role_covered(date,text,integer) from anon;
revoke all on function rko__role_covered(date,text,integer) from authenticated;
grant execute on function rko__role_covered(date,text,integer) to service_role;


/* ---------------------------------------------------------------------------
   ٢) role_mismatch_only_when_someone_else_can_take_it
   تُطبَّق على rko__wf_hard_check(integer,bigint) بنمط pg_get_functiondef +
   replace بمرساة واحدة. المنع يبقى — لكنه لا يقع إلا إذا كان هناك فعلاً
   حاضرةٌ أخرى يسمح دورها بالمهمة.
   --------------------------------------------------------------------------*/
do $mig$
declare src text; anchor text; repl text; n int;
begin
  src := pg_get_functiondef('rko__wf_hard_check(integer,bigint)'::regprocedure);
  anchor := '       t.service_role), true) = false then';
  repl   := '       t.service_role), true) = false' || E'\n' ||
            '     and rko__role_covered(d, t.service_role, p_emp) then';
  n := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'anchor count = % (expected 1)', n; end if;
  execute replace(src, anchor, repl);
end $mig$;


/* ---------------------------------------------------------------------------
   ٣) tier_drives_class_not_arabic_keyword_guess
   الطبقة (service_tier) قيمةٌ صريحة تضعها الإدارة، فيجب أن تحكم هي.
   تخمين الاسم يبقى احتياطاً حين لا طبقة ولا تصنيف.
   --------------------------------------------------------------------------*/
do $mig$
declare src text; anchor text; repl text; n int;
begin
  src := pg_get_functiondef('rko__task_attr_defaults()'::regprocedure);

  anchor :=
'  if new.operational_class is null then new.operational_class := rko__op_class(new.name); end if;' || E'\n' ||
'  -- five-tier: fallback from legacy operational_class when not provided' || E'\n' ||
'  if new.service_tier is null then' || E'\n' ||
'    new.service_tier := case new.operational_class when ''live'' then 1 when ''support'' then 3 when ''maintenance'' then 4 else 2 end;' || E'\n' ||
'  end if;';

  repl :=
'  -- الطبقة أولاً: هي القيمة الصريحة. عند غيابها فقط نلجأ للتخمين من الاسم.' || E'\n' ||
'  if new.service_tier is null then' || E'\n' ||
'    new.service_tier := case coalesce(new.operational_class, rko__op_class(new.name))' || E'\n' ||
'                          when ''live'' then 1 when ''support'' then 3 when ''maintenance'' then 4 else 2 end;' || E'\n' ||
'  end if;' || E'\n' ||
'  -- التصنيف القديم يُشتق من الطبقة، لا من كلمات الاسم.' || E'\n' ||
'  if new.operational_class is null then' || E'\n' ||
'    new.operational_class := case new.service_tier' || E'\n' ||
'      when 1 then ''live'' when 2 then ''live'' when 3 then ''support'' else ''maintenance'' end;' || E'\n' ||
'  end if;';

  n := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'anchor count = % (expected 1)', n; end if;
  execute replace(src, anchor, repl);
end $mig$;

update rko_task_templates
   set operational_class = case service_tier
         when 1 then 'live' when 2 then 'live' when 3 then 'support' else 'maintenance' end
 where active and operational_class is null and service_tier is not null;


/* ---------------------------------------------------------------------------
   ٤) cfg_int_arr_helper — قراءة مصفوفة أعداد من الإعدادات
   --------------------------------------------------------------------------*/
create or replace function rko__cfg_int_arr(p_key text, p_field text)
returns integer[] language plpgsql stable security definer set search_path to 'public' as $fn$
declare v jsonb; out_arr integer[];
begin
  v := rko__cfg(p_key, '{}'::jsonb) -> p_field;
  if v is null or jsonb_typeof(v) <> 'array' then return '{}'::integer[]; end if;
  select array_agg((e)::int) into out_arr from jsonb_array_elements_text(v) e;
  return coalesce(out_arr, '{}'::integer[]);
end $fn$;

revoke all on function rko__cfg_int_arr(text,text) from public;
revoke all on function rko__cfg_int_arr(text,text) from anon;
revoke all on function rko__cfg_int_arr(text,text) from authenticated;
grant execute on function rko__cfg_int_arr(text,text) to service_role;


/* ---------------------------------------------------------------------------
   ٥) crisis_and_quiet_time_use_tiers_not_guessed_class
   ثلاث مرساة داخل rko__wf_service_first():
   أ) إنذار الضغط من الطبقات المواجهة للزبونة (١ و٢) لا من كلمة في الاسم
   ب) ما يُؤجَّل = classification.deferrable_tiers (٤ و٥) + ما بقي من
      maintenance، وبشرط interruptible و can_pause
   ج) وما يُعاد عند الهدوء هو نفسه
   --------------------------------------------------------------------------*/
do $mig$
declare src text; a text; r text; n int;
begin
  src := pg_get_functiondef('rko__wf_service_first()'::regprocedure);

  a := 'select ( exists(select 1 from rko_tasks t where t.day=d and t.operational_class=''live''';
  r := 'select ( exists(select 1 from rko_tasks t where t.day=d'
       || ' and coalesce(t.service_tier, case t.operational_class when ''live'' then 1 else 2 end) <= 2';
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then raise exception 'anchor 1 = %', n; end if;
  src := replace(src, a, r);

  a := 'where day=d and status=''running'' and operational_class=''maintenance'' and coalesce(interruptible,true)';
  r := 'where day=d and status=''running''' || E'\n' ||
       '               and ( coalesce(service_tier,2) = any(rko__cfg_int_arr(''classification.deferrable_tiers'',''deferrable''))' || E'\n' ||
       '                     or operational_class=''maintenance'' )' || E'\n' ||
       '               and coalesce(interruptible,true) and coalesce(can_pause,true)';
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then raise exception 'anchor 2 = %', n; end if;
  src := replace(src, a, r);

  a := 'where t.day=d and t.status=''paused'' and t.operational_class=''maintenance''';
  r := 'where t.day=d and t.status=''paused''' || E'\n' ||
       '               and ( coalesce(t.service_tier,2) = any(rko__cfg_int_arr(''classification.deferrable_tiers'',''deferrable''))' || E'\n' ||
       '                     or t.operational_class=''maintenance'' )';
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then raise exception 'anchor 3 = %', n; end if;
  src := replace(src, a, r);

  execute src;
end $mig$;


/* ---------------------------------------------------------------------------
   ٦) pressure_reads_the_floor_from_table_board
   الأرضية تُقرأ من خريطة الطاولات: نسبة الإشغال، والحالات المتأخرة عن
   حدودها المعلنة في ops_thresholds. المدخل اليدوي وطلبات المساعدة تبقى
   كما هي مضافةً لا مستبدلة.
   ملاحظة: الإشغال يُحسب فقط للطاولات التي تغيّرت حالتها خلال ٨ ساعات،
   حتى لا تُحسب طاولة نُسيت على حالة «served» منذ أيام كأنها مشغولة الآن.
   --------------------------------------------------------------------------*/
create or replace function rko__wf_pressure_level()
returns integer language plpgsql stable security definer
set search_path to 'public', 'extensions' as $fn$
declare
  th jsonb := rko__cfg('ops_thresholds',
        '{"take_order_minutes":6,"serve_minutes":5,"bill_minutes":6,"reset_minutes":12}');
  score int := 0;
  occ_ratio numeric := 0; overdue int := 0;
begin
  select coalesce(sum(case when q.needs_support then 2 else 0 end
                   + case when q.waiting='high' then 1 else 0 end
                   + case when q.tables_count>0 and q.occupied >= q.tables_count*0.8 then 1 else 0 end),0)
    into score
  from (select distinct on (pr.area_id) pr.occupied, pr.waiting, pr.needs_support, a.tables_count
        from rko_pressure pr join rko_areas a on a.id=pr.area_id
        where pr.ts > now()-interval '45 minutes' order by pr.area_id, pr.ts desc) q;

  score := score + (select count(*) from rko_help_requests h
                     where h.status='open' and h.ts > now()-interval '30 minutes');

  select coalesce(
           sum(case when t.state in ('seated','ordered','preparing','ready','served','bill_requested')
                    then 1 else 0 end)::numeric
           / nullif(count(*),0), 0)
    into occ_ratio
  from rko_cafe_tables t join rko_areas a on a.id=t.area_id
  where t.is_active and not coalesce(t.out_of_service,false) and coalesce(a.is_dining,false)
    and coalesce(t.state_since, t.updated_at, now()) > now() - interval '8 hours';
  if occ_ratio >= 0.80 then score := score + 2;
  elsif occ_ratio >= 0.55 then score := score + 1; end if;

  select count(*) into overdue
  from rko_cafe_tables t join rko_areas a on a.id=t.area_id
  where t.is_active and not coalesce(t.out_of_service,false) and coalesce(a.is_dining,false)
    and t.state_since is not null
    and case t.state
          when 'seated'         then t.state_since < now() - make_interval(mins => (th->>'take_order_minutes')::int)
          when 'ready'          then t.state_since < now() - make_interval(mins => (th->>'serve_minutes')::int)
          when 'bill_requested' then t.state_since < now() - make_interval(mins => (th->>'bill_minutes')::int)
          when 'needs_clean'    then t.state_since < now() - make_interval(mins => (th->>'reset_minutes')::int)
          else false end;
  if overdue >= 4 then score := score + 3;
  elsif overdue >= 2 then score := score + 2;
  elsif overdue >= 1 then score := score + 1; end if;

  return case when score>=4 then 3 when score>=2 then 2 when score>0 then 1 else 0 end;
end $fn$;

revoke all on function rko__wf_pressure_level() from public;
revoke all on function rko__wf_pressure_level() from anon;
revoke all on function rko__wf_pressure_level() from authenticated;
grant execute on function rko__wf_pressure_level() to service_role;


/* ---------------------------------------------------------------------------
   ٧) quiet_time_lifts_deep_work_in_priority
   وقت الرواق كان محايداً تماماً في الأولوية. الآن العمل القابل للتأجيل
   يرتفع ١٢ نقطة حين يكون مقياس الضغط صفراً، ويهبط كما كان عند الضغط.
   --------------------------------------------------------------------------*/
do $mig$
declare src text; a text; r text; n int;
begin
  src := pg_get_functiondef('rko__wf_priority_recalc()'::regprocedure);
  a := '''pressure'',  case when lvl>=2 then (case when t.is_core or t.phase=''closing'' then 10 when t.expected_minutes>=15 then -20 else -5 end) else 0 end,';
  r := '''pressure'',  case when lvl>=2 then (case when t.is_core or t.phase=''closing'' then 10 when t.expected_minutes>=15 then -20 else -5 end)'
       || E'\n' || '                      when lvl=0 and coalesce(t.service_tier,2) = any(rko__cfg_int_arr(''classification.deferrable_tiers'',''deferrable'')) then 12'
       || E'\n' || '                      else 0 end,';
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then raise exception 'anchor = %', n; end if;
  execute replace(src, a, r);
end $mig$;


/* ---------------------------------------------------------------------------
   ٨) staff_task_payload_carries_defer_reason
   المحرّك يوقف مهمة عند الضغط، لكن الموظفة كانت ترى «متوقفة مؤقتاً» وزرّ
   «استئناف» بلا سبب — فأيّ موظفة ستضغطه ويسقط المعنى كله. نُرفق السبب مع
   المهمة حتى تُقرأ الحالة لا تُخمَّن.
   --------------------------------------------------------------------------*/
do $mig$
declare src text; a text; r text; n int;
begin
  src := pg_get_functiondef('rko__staff_impl(text,text,jsonb)'::regprocedure);
  a := '''blocked'',exists(select 1 from rko_wf_blockers bl where bl.task_id=k.id and bl.status=''open''))';
  r := '''blocked'',exists(select 1 from rko_wf_blockers bl where bl.task_id=k.id and bl.status=''open'')'
    || ',''defer_reason'',(select case when dx.reason_code=''service_first'' then dx.explanation end'
    || ' from rko_wf_decisions dx where dx.source_id=k.id and dx.business_date=k.day'
    || ' and dx.reason_code in (''service_first'',''service_restore'')'
    || ' order by dx.id desc limit 1))';
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then raise exception 'anchor count = % (expected 1)', n; end if;
  execute replace(src, a, r);
end $mig$;


/* ============================================================================
   دليل القبول — نُفّذ داخل معاملة تُلغى بـ raise exception فلا تُبقي أثراً.
   النتائج المسجّلة فعلاً (٢٠٢٦-٠٧-٣٠):

   التصنيف من الطبقة:   طبقة ٤ ⇒ maintenance   ·   طبقة ١ ⇒ live
   رواق:   pressure_level = 0  ·  مركّبة الأولوية للطبقة ٤ = +12
           المهمة الجارية من الطبقة ٤ تبقى running
   أزمة (٢٣ من ٢٧ طاولة seated منذ ٢٥ دقيقة):
           pressure_level = 3  ·  مركّبة الأولوية للطبقة ٤ = −20
           الطبقة ٤ الجارية ⇒ paused مع نصّ:
             «خدمة الزبونات أولاً — أُوقفت مهمة الصيانة مؤقتاً حتى تهدأ الصالة.»
           الطبقة ١ الجارية ⇒ running (لم تُمَسّ)
   عودة الهدوء:  pressure_level = 0  ·  الطبقة ٤ ⇒ open مع نصّ:
             «هدأت الصالة — أُعيدت مهمة الصيانة إلى قائمتك لاستكمالها.»
   بوابة الدور — يوم كله floor:
           role_covered('hookah') = false ⇒ لا role_mismatch
           («إطفاء الفحم بالكامل» لم يبقَ مجمَّداً)
   بوابة الدور — بحضور موظفة أراجيل:
           role_covered('hookah') = true ⇒ floor يُمنع، وموظفة الأراجيل
           تمرّ بلا أي fail  ·  role_rank: hookah = 1.0 و floor = 0.35
   بعد إكمال المصفوفة: قوالب بلا حكم دور = 0  ·  قوالب لا يستطيع أي دور
           أخذها = 0

   الواجهة (٣٩٠×٩٠٠، السمتان):
           سبب التأجيل مقروء في البطاقة الرئيسية وفي قائمة المهام
           الشارة: «مؤجَّلة — الخدمة أولاً»
           زرّ الاستئناف للمؤجَّلة ثانويٌّ (ghost) ونصّه «أستأنفها الآن على
           أي حال»، بينما التوقّف الذي اختارته الموظفة يحتفظ بزرّ أساسي
           فشل تباين WCAG AA = 0  ·  أخطاء صفحة = 0
   ==========================================================================*/


/* ============================================================================
   مسار التراجع (بالترتيب المعاكس)
   ==========================================================================*/
/*
-- ٨) إسقاط defer_reason من حمولة الموظفة
--    (اعكسي الاستبدال: احذفي الجزء المضاف بعد 'blocked')

-- ٧) إعادة صيغة الأولوية إلى else 0 end

-- ٦) إعادة rko__wf_pressure_level إلى النسخة اليدوية:
--    (المدخل اليدوي + طلبات المساعدة فقط، بلا فرعي الإشغال والتأخير)

-- ٥) إعادة rko__wf_service_first إلى operational_class='live'/'maintenance'

-- ٤) drop function if exists rko__cfg_int_arr(text,text);
--    تنبيه: لا تُسقطيها قبل التراجع عن ٥ و٧ لأنهما تستدعيانها.

-- ٣) إعادة ترتيب rko__task_attr_defaults (التصنيف من الاسم ثم الطبقة منه)،
--    ثم — إن أردتِ — إرجاع القوالب الـ١١ إلى operational_class = null.

-- ٢) حذف شرط rko__role_covered من rko__wf_hard_check
--    تنبيه: هذا يُعيد ع٢ — تجميد إطفاء الفحم في يومٍ كله floor.

-- ١) drop function if exists rko__role_covered(date,text,integer);
--    وإرجاع engine.role_matrix إلى الخمسة مفاتيح السابقة:
--    {"hookah":["hookah"],"bussing":["floor","kitchen"],"cashier":["cashier"],
--     "kitchen":["kitchen"],"table_service":["floor"]}
--    تنبيه: هذا يُعيد ع١ — ٣٩٪ من العمل بلا حكم دور.
*/
