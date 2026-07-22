-- ============================================================================
-- RCOS — المجلد الثالث (محرك سير العمل) — سكربت التراجع الموثّق
-- RCOS Volume III (Workflow Engine) — documented rollback
-- ----------------------------------------------------------------------------
-- كل تغييرات المجلد الثالث إضافية وغير كاسرة. هذا الملف يوثّق كيفية إيقاف
-- المحرك أو إزالته بالكامل بأمان، على ثلاث درجات متدرّجة.
--
-- All Volume III changes are additive and backward-compatible. This file
-- documents how to halt or fully remove the engine safely, in three levels.
--
-- الترحيلات المعنية (بالترتيب):
--   rcos_wf_core, rcos_wf_engine, rcos_wf_actions_v2,
--   rcos_wf_state_priority, rcos_wf_hardening_core,
--   rcos_wf_blocker_resolve, rcos_wf_state_blocked
-- ============================================================================


-- ============================================================================
-- المستوى ١ — مفتاح الإيقاف الفوري (Kill switch) — بلا أي حذف
-- يوقف كل سلوك آلي للمحرك خلال ثوانٍ. آمن 100%، وقابل للعكس بإعادة الجدولة.
-- Instantly stops all automated engine behavior. Fully reversible.
-- ============================================================================
select cron.unschedule('rko_wf_tick');
select cron.unschedule('rko_wf_finalize');
-- لإعادة التشغيل لاحقاً:
--   select cron.schedule('rko_wf_tick','*/10 * * * *','select rko__wf_tick()');
--   select cron.schedule('rko_wf_finalize','50 20 * * *','select rko__wf_finalize_day()');  -- 23:50 عمّان


-- ============================================================================
-- المستوى ٢ — تعطيل التسجيل التلقائي على المهام (اختياري)
-- يوقف كتابة أحداث سير العمل عند تغيّر حالة/مكلّفة المهمة، دون حذف أي بيانات.
-- ============================================================================
drop trigger if exists rko__wf_task_trg on rko_tasks;


-- ============================================================================
-- المستوى ٣ — الإزالة الكاملة (Full teardown)
-- ----------------------------------------------------------------------------
-- ملاحظة مهمة عن الترتيب: دوال rko_staff و rko_admin تشير إلى جداول المحرك
-- (rko_wf_decisions/blockers/carryover). لذلك يجب أولاً إرجاع هاتين الدالتين
-- إلى نسختهما قبل المجلد الثالث، ثم حذف كائنات المحرك.
--
-- IMPORTANT ORDER: rko_staff/rko_admin reference the engine tables. Revert
-- those two functions to their pre-Volume-III definitions FIRST, then drop
-- the engine objects, otherwise the RPCs will error on missing tables.
-- ============================================================================

-- 3.1 — إرجاع دوال RPC إلى ما قبل المجلد الثالث
--   الطريقة الموصى بها: أعد تطبيق تعريف الدالتين من لقطة الترحيل السابقة
--   مباشرةً للترحيل rcos_wf_core (Supabase يحتفظ بتاريخ الترحيلات).
--   العناصر التي أضافها المجلد الثالث إلى الدالتين والتي يجب أن تختفي:
--     rko_staff : perform set_config('rko.actor', ...);  و 'wf_priority'/'blocked'
--                 في تسلسل action=state ؛ والإجراءات:
--                 blocker_report, blocker_resolve, task_why
--     rko_admin : perform set_config('rko.actor', ...);  والإجراءات:
--                 wf_status, wf_decisions, wf_override
--   (العميل القديم يتجاهل الحقول/الإجراءات الزائدة، لذا هذه الخطوة تجميلية
--    ما لم تُحذف الجداول في 3.3.)

-- 3.2 — حذف دوال المحرك
drop function if exists rko__wf_tick() cascade;
drop function if exists rko__wf_finalize_day() cascade;
drop function if exists rko__wf_phase_eval() cascade;
drop function if exists rko__wf_phase_set(text,text) cascade;
drop function if exists rko__wf_phase(date) cascade;
drop function if exists rko__wf_pressure_level() cascade;
drop function if exists rko__wf_workload(integer,date) cascade;
drop function if exists rko__wf_priority_recalc() cascade;
drop function if exists rko__wf_peak_defer() cascade;
drop function if exists rko__wf_recovery_restore() cascade;
drop function if exists rko__wf_reassign_absent() cascade;
drop function if exists rko__wf_task_trg() cascade;
drop function if exists rko__wf_log(text,bigint,text,text,text,text,text,jsonb) cascade;
drop function if exists rko__wf_actor() cascade;

-- 3.3 — حذف العرض والجداول
drop view if exists rko_wf_instances;
drop table if exists rko_wf_carryover;
drop table if exists rko_wf_decisions;
drop table if exists rko_wf_blockers;
drop table if exists rko_wf_events;
drop table if exists rko_wf_phases;

-- 3.4 — إرجاع تعديلات جدول rko_tasks
alter table rko_tasks drop column if exists wf_priority;
alter table rko_tasks drop column if exists carryover;
-- إرجاع قيد الحالة إلى مجموعته الأصلية (قبل carried/cancelled)
-- ملاحظة: نفّذه فقط بعد التأكد من عدم وجود صفوف بحالة carried/cancelled:
--   update rko_tasks set status='returned' where status in ('carried','cancelled');
alter table rko_tasks drop constraint if exists rko_tasks_status_check;
alter table rko_tasks add constraint rko_tasks_status_check
  check (status in ('open','running','paused','done','returned','approved'));

-- انتهى — بعد المستوى ٣ يعود النظام إلى ما كان عليه قبل المجلد الثالث تماماً.
