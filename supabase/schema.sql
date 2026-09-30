-- =====================================================================
--  DATA NOVICE AREA (D.N.A) — Schéma Supabase
--  À exécuter UNE fois dans Supabase > SQL Editor (projet vierge).
--
--  Principe de sécurité : la clé publique du navigateur ne donne accès
--  qu'à ce que les politiques RLS ci-dessous autorisent. Toute action
--  sensible (inscription, quiz, progression, paiement, rôles) passe par
--  des fonctions SQL qui vérifient les droits côté serveur.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0. Utilitaires
-- ---------------------------------------------------------------------
create or replace function public.try_uuid(p text)
returns uuid language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 1. Profils et rôles
--    student = apprenant · instructor = formateur · admin = gestion
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '' check (char_length(full_name) <= 120),
  role        text not null default 'student' check (role in ('student','instructor','admin')),
  headline    text check (char_length(headline) <= 160),
  bio         text check (char_length(bio) <= 2000),
  avatar_url  text check (avatar_url is null or avatar_url ~ '^https://'),
  country     text check (char_length(country) <= 60),
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name', ''), 120));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_instructor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('instructor','admin') from public.profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------
-- 2. Catalogue : cours > modules > leçons
-- ---------------------------------------------------------------------
create table public.courses (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  title            text not null check (char_length(title) between 3 and 140),
  subtitle         text check (char_length(subtitle) <= 240),
  description      text check (char_length(description) <= 20000),
  category         text not null default 'excel' check (category in ('excel','powerbi','python','sql','data','autre')),
  level            text not null default 'debutant' check (level in ('debutant','intermediaire','avance')),
  cover_url        text check (cover_url is null or cover_url ~ '^https://'),
  price_eur_cents  integer not null default 0 check (price_eur_cents between 0 and 10000000),
  price_xaf        integer not null default 0 check (price_xaf between 0 and 100000000),
  is_free          boolean generated always as (price_eur_cents = 0 and price_xaf = 0) stored,
  status           text not null default 'draft' check (status in ('draft','review','published','archived')),
  instructor_id    uuid not null references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.courses (status);
create index on public.courses (instructor_id);

create trigger courses_touch before update on public.courses
  for each row execute function public.touch_updated_at();

-- Seul un admin publie ; un formateur ne peut pas changer de propriétaire.
create or replace function public.guard_course_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    raise exception 'Seul un administrateur peut publier une formation.';
  end if;
  if tg_op = 'UPDATE' and new.instructor_id <> old.instructor_id then
    raise exception 'Le formateur d''une formation ne peut pas être modifié.';
  end if;
  return new;
end $$;

create trigger courses_guard before insert or update on public.courses
  for each row execute function public.guard_course_changes();

create table public.modules (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 160),
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index on public.modules (course_id, position);

create table public.lessons (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references public.courses(id) on delete cascade,
  module_id       uuid not null references public.modules(id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 160),
  summary         text check (char_length(summary) <= 500),
  position        integer not null default 0,
  is_free_preview boolean not null default false,
  duration_min    integer check (duration_min between 0 and 600),
  created_at      timestamptz not null default now()
);
create index on public.lessons (module_id, position);
create index on public.lessons (course_id);

create or replace function public.guard_lesson_module()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.modules m where m.id = new.module_id and m.course_id = new.course_id) then
    raise exception 'Le module ne correspond pas à la formation.';
  end if;
  return new;
end $$;
create trigger lessons_guard before insert or update on public.lessons
  for each row execute function public.guard_lesson_module();

-- Contenu texte de la leçon (séparé pour pouvoir le protéger)
create table public.lesson_contents (
  lesson_id  uuid primary key references public.lessons(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,
  body       text not null default '' check (char_length(body) <= 100000),
  updated_at timestamptz not null default now()
);
create trigger lesson_contents_touch before update on public.lesson_contents
  for each row execute function public.touch_updated_at();

-- Fichiers, vidéos, audios, images, documents, liens
create table public.lesson_resources (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.lessons(id) on delete cascade,
  course_id    uuid not null references public.courses(id) on delete cascade,
  kind         text not null check (kind in ('video','audio','image','document','link')),
  title        text not null check (char_length(title) between 1 and 160),
  storage_path text check (char_length(storage_path) <= 500),
  external_url text check (external_url is null or external_url ~ '^https://'),
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  check ((storage_path is not null) <> (external_url is not null))
);
create index on public.lesson_resources (lesson_id, position);

-- Quiz : 2 à 4 questions par leçon, 2 à 4 réponses par question
create table public.quiz_questions (
  id         uuid primary key default gen_random_uuid(),
  lesson_id  uuid not null references public.lessons(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,
  prompt     text not null check (char_length(prompt) between 3 and 600),
  choices    jsonb not null check (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) between 2 and 4),
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index on public.quiz_questions (lesson_id, position);

create or replace function public.guard_quiz_size()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.quiz_questions where lesson_id = new.lesson_id) >= 4 then
    raise exception 'Une leçon contient au maximum 4 questions.';
  end if;
  return new;
end $$;
create trigger quiz_size before insert on public.quiz_questions
  for each row execute function public.guard_quiz_size();

-- Bonnes réponses : jamais lisibles par les apprenants
create table public.quiz_keys (
  question_id   uuid primary key references public.quiz_questions(id) on delete cascade,
  course_id     uuid not null references public.courses(id) on delete cascade,
  correct_index integer not null check (correct_index between 0 and 3),
  explanation   text check (char_length(explanation) <= 1000)
);

-- ---------------------------------------------------------------------
-- 3. Inscriptions, progression, quiz, paiements, contacts
-- ---------------------------------------------------------------------
create table public.enrollments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,
  source     text not null check (source in ('free','stripe','manual','admin')),
  status     text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  unique (user_id, course_id)
);
create index on public.enrollments (course_id);

create table public.lesson_progress (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  lesson_id    uuid not null references public.lessons(id) on delete cascade,
  course_id    uuid not null references public.courses(id) on delete cascade,
  completed_at timestamptz,
  best_score   integer,
  quiz_total   integer,
  updated_at   timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create index on public.lesson_progress (user_id, course_id);

create table public.quiz_attempts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  lesson_id  uuid not null references public.lessons(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,
  answers    jsonb not null,
  score      integer not null,
  total      integer not null,
  created_at timestamptz not null default now()
);
create index on public.quiz_attempts (user_id, lesson_id);

create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  course_id           uuid not null references public.courses(id) on delete restrict,
  provider            text not null check (provider in ('stripe','airtel_money','moov_money','virement')),
  amount              integer not null check (amount >= 0),
  currency            text not null check (currency in ('EUR','XAF')),
  status              text not null default 'pending' check (status in ('pending','paid','rejected','cancelled')),
  payer_reference     text check (char_length(payer_reference) <= 120),
  payer_phone         text check (char_length(payer_phone) <= 30),
  provider_session_id text unique,
  reviewed_by         uuid references public.profiles(id),
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now()
);
create index on public.payments (status);
create index on public.payments (user_id);

create table public.contact_requests (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('entreprise','particulier','formateur')),
  name       text not null check (char_length(name) between 2 and 120),
  email      text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 200),
  company    text check (char_length(company) <= 160),
  message    text not null check (char_length(message) between 5 and 4000),
  handled    boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. Fonctions de droits d'accès (utilisées par les politiques RLS)
-- ---------------------------------------------------------------------
create or replace function public.can_edit_course(p_course uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.courses c
    where c.id = p_course and c.instructor_id = auth.uid() and public.is_instructor()
  )
$$;

create or replace function public.course_is_visible(p_course uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.courses where id = p_course and status = 'published')
      or public.can_edit_course(p_course)
$$;

create or replace function public.has_course_access(p_course uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_edit_course(p_course) or exists (
    select 1 from public.enrollments e
    where e.course_id = p_course and e.user_id = auth.uid() and e.status = 'active'
  )
$$;

create or replace function public.can_access_lesson(p_lesson uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lessons l join public.courses c on c.id = l.course_id
    where l.id = p_lesson
      and ((c.status = 'published' and l.is_free_preview) or public.has_course_access(l.course_id))
  )
$$;

-- ---------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.courses           enable row level security;
alter table public.modules           enable row level security;
alter table public.lessons           enable row level security;
alter table public.lesson_contents   enable row level security;
alter table public.lesson_resources  enable row level security;
alter table public.quiz_questions    enable row level security;
alter table public.quiz_keys         enable row level security;
alter table public.enrollments       enable row level security;
alter table public.lesson_progress   enable row level security;
alter table public.quiz_attempts     enable row level security;
alter table public.payments          enable row level security;
alter table public.contact_requests  enable row level security;

-- Profils : chacun voit le sien ; les profils formateurs sont publics.
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or role in ('instructor','admin') or public.is_admin());
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
-- Le rôle ne peut pas être modifié par l'utilisateur (droits colonne par colonne)
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, headline, bio, avatar_url, country) on public.profiles to authenticated;

-- Formations
create policy courses_select on public.courses for select
  using (status = 'published' or public.can_edit_course(id));
create policy courses_insert on public.courses for insert to authenticated
  with check (public.is_instructor() and instructor_id = auth.uid());
create policy courses_update on public.courses for update to authenticated
  using (public.can_edit_course(id)) with check (public.can_edit_course(id));
create policy courses_delete on public.courses for delete to authenticated
  using (public.is_admin() or (public.can_edit_course(id) and status in ('draft','review')));

-- Modules & leçons : le plan est visible, le contenu est protégé
create policy modules_select on public.modules for select using (public.course_is_visible(course_id));
create policy modules_write  on public.modules for all to authenticated
  using (public.can_edit_course(course_id)) with check (public.can_edit_course(course_id));

create policy lessons_select on public.lessons for select using (public.course_is_visible(course_id));
create policy lessons_write  on public.lessons for all to authenticated
  using (public.can_edit_course(course_id)) with check (public.can_edit_course(course_id));

create policy contents_select on public.lesson_contents for select using (public.can_access_lesson(lesson_id));
create policy contents_write  on public.lesson_contents for all to authenticated
  using (public.can_edit_course(course_id)) with check (public.can_edit_course(course_id));

create policy resources_select on public.lesson_resources for select using (public.can_access_lesson(lesson_id));
create policy resources_write  on public.lesson_resources for all to authenticated
  using (public.can_edit_course(course_id)) with check (public.can_edit_course(course_id));

create policy questions_select on public.quiz_questions for select using (public.can_access_lesson(lesson_id));
create policy questions_write  on public.quiz_questions for all to authenticated
  using (public.can_edit_course(course_id)) with check (public.can_edit_course(course_id));

create policy keys_editors on public.quiz_keys for all to authenticated
  using (public.can_edit_course(course_id)) with check (public.can_edit_course(course_id));

-- Inscriptions / progression / tentatives : lecture seule, écriture via fonctions
create policy enrollments_select on public.enrollments for select
  using (user_id = auth.uid() or public.can_edit_course(course_id));
create policy enrollments_admin on public.enrollments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy progress_select on public.lesson_progress for select
  using (user_id = auth.uid() or public.can_edit_course(course_id));

create policy attempts_select on public.quiz_attempts for select
  using (user_id = auth.uid() or public.can_edit_course(course_id));

create policy payments_select on public.payments for select
  using (user_id = auth.uid() or public.is_admin());

create policy contacts_admin on public.contact_requests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 6. Fonctions appelées par le site (RPC)
-- ---------------------------------------------------------------------

-- S'inscrire à une formation gratuite
create or replace function public.enroll_free(p_course uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if not exists (select 1 from courses where id = p_course and status = 'published' and is_free) then
    raise exception 'Cette formation n''est pas gratuite ou n''est pas disponible.';
  end if;
  insert into enrollments (user_id, course_id, source)
  values (auth.uid(), p_course, 'free')
  on conflict (user_id, course_id) do nothing;
end $$;

-- Marquer une leçon terminée (si la leçon a un quiz, il faut l'avoir réussi)
create or replace function public.mark_lesson_complete(p_lesson uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_course uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if not public.can_access_lesson(p_lesson) then raise exception 'Accès refusé.'; end if;
  select course_id into v_course from lessons where id = p_lesson;
  if exists (select 1 from quiz_questions where lesson_id = p_lesson)
     and not exists (select 1 from lesson_progress where user_id = auth.uid() and lesson_id = p_lesson and completed_at is not null) then
    raise exception 'Réussissez le quiz pour terminer cette leçon.';
  end if;
  insert into lesson_progress (user_id, lesson_id, course_id, completed_at)
  values (auth.uid(), p_lesson, v_course, now())
  on conflict (user_id, lesson_id) do update set completed_at = coalesce(lesson_progress.completed_at, now()), updated_at = now();
end $$;

-- Corriger un quiz côté serveur. Réussite : au moins 75 % de bonnes réponses.
create or replace function public.submit_quiz(p_lesson uuid, p_answers integer[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_course uuid;
  v_total int := 0;
  v_score int := 0;
  v_details jsonb := '[]'::jsonb;
  v_passed boolean;
  q record;
  v_answer int;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if not public.can_access_lesson(p_lesson) then raise exception 'Accès refusé.'; end if;
  select course_id into v_course from lessons where id = p_lesson;

  for q in
    select qq.id, k.correct_index, k.explanation
    from quiz_questions qq join quiz_keys k on k.question_id = qq.id
    where qq.lesson_id = p_lesson
    order by qq.position, qq.created_at
  loop
    v_total := v_total + 1;
    v_answer := p_answers[v_total];
    if v_answer is not null and v_answer = q.correct_index then v_score := v_score + 1; end if;
    v_details := v_details || jsonb_build_object(
      'question_id', q.id,
      'correct', (v_answer is not null and v_answer = q.correct_index),
      'correct_index', q.correct_index,
      'explanation', q.explanation);
  end loop;

  if v_total = 0 then raise exception 'Cette leçon n''a pas de quiz.'; end if;
  v_passed := v_score * 4 >= v_total * 3;

  insert into quiz_attempts (user_id, lesson_id, course_id, answers, score, total)
  values (auth.uid(), p_lesson, v_course, to_jsonb(p_answers), v_score, v_total);

  insert into lesson_progress (user_id, lesson_id, course_id, best_score, quiz_total, completed_at)
  values (auth.uid(), p_lesson, v_course, v_score, v_total, case when v_passed then now() end)
  on conflict (user_id, lesson_id) do update set
    best_score   = greatest(coalesce(lesson_progress.best_score, 0), excluded.best_score),
    quiz_total   = excluded.quiz_total,
    completed_at = coalesce(lesson_progress.completed_at, excluded.completed_at),
    updated_at   = now();

  return jsonb_build_object('score', v_score, 'total', v_total, 'passed', v_passed, 'details', v_details);
end $$;

-- Déclarer un paiement Mobile Money / virement (validé ensuite par un admin)
create or replace function public.declare_manual_payment(p_course uuid, p_provider text, p_reference text, p_phone text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c record;
  v_id uuid;
  v_amount int;
  v_currency text;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if p_provider not in ('airtel_money','moov_money','virement') then raise exception 'Moyen de paiement inconnu.'; end if;
  if coalesce(char_length(trim(p_reference)), 0) < 3 then raise exception 'Indiquez la référence de la transaction.'; end if;
  select * into c from courses where id = p_course and status = 'published' and not is_free;
  if not found then raise exception 'Formation introuvable.'; end if;
  if exists (select 1 from enrollments where user_id = auth.uid() and course_id = p_course and status = 'active') then
    raise exception 'Vous avez déjà accès à cette formation.';
  end if;
  if exists (select 1 from payments where user_id = auth.uid() and course_id = p_course and status = 'pending' and provider <> 'stripe') then
    raise exception 'Un paiement est déjà en cours de vérification pour cette formation.';
  end if;

  if p_provider = 'virement' and c.price_eur_cents > 0 then
    v_amount := c.price_eur_cents; v_currency := 'EUR';
  elsif c.price_xaf > 0 then
    v_amount := c.price_xaf; v_currency := 'XAF';
  else
    raise exception 'Ce moyen de paiement n''est pas disponible pour cette formation.';
  end if;

  insert into payments (user_id, course_id, provider, amount, currency, payer_reference, payer_phone)
  values (auth.uid(), p_course, p_provider, v_amount, v_currency, left(trim(p_reference), 120), left(trim(p_phone), 30))
  returning id into v_id;
  return v_id;
end $$;

-- Admin : valider ou refuser un paiement manuel
create or replace function public.review_payment(p_payment uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  select * into p from payments where id = p_payment for update;
  if not found then raise exception 'Paiement introuvable.'; end if;
  if p.status <> 'pending' then raise exception 'Ce paiement a déjà été traité.'; end if;

  update payments
     set status = case when p_approve then 'paid' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_payment;

  if p_approve then
    insert into enrollments (user_id, course_id, source)
    values (p.user_id, p.course_id, 'manual')
    on conflict (user_id, course_id) do update set status = 'active';
  end if;
end $$;

create or replace function public.admin_list_payments(p_status text default 'pending')
returns table (id uuid, created_at timestamptz, email text, full_name text, course_title text,
               provider text, amount int, currency text, status text, payer_reference text, payer_phone text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  return query
    select p.id, p.created_at, u.email::text, pr.full_name, c.title, p.provider, p.amount, p.currency,
           p.status, p.payer_reference, p.payer_phone
    from payments p
    join auth.users u on u.id = p.user_id
    join profiles pr on pr.id = p.user_id
    join courses c on c.id = p.course_id
    where p_status is null or p.status = p_status
    order by p.created_at desc
    limit 200;
end $$;

create or replace function public.admin_list_users(p_search text default '')
returns table (id uuid, email text, full_name text, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  return query
    select u.id, u.email::text, p.full_name, p.role, u.created_at
    from auth.users u join profiles p on p.id = u.id
    where coalesce(p_search, '') = ''
       or u.email ilike '%' || p_search || '%'
       or p.full_name ilike '%' || p_search || '%'
    order by u.created_at desc
    limit 200;
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  if p_role not in ('student','instructor','admin') then raise exception 'Rôle inconnu.'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'Vous ne pouvez pas retirer votre propre rôle admin.'; end if;
  update profiles set role = p_role where id = p_user;
end $$;

-- Admin : donner l'accès à une formation (ex. entreprise qui paie sur facture)
create or replace function public.admin_grant_access(p_email text, p_course uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'Aucun compte avec cet e-mail. La personne doit d''abord créer son compte.'; end if;
  insert into enrollments (user_id, course_id, source)
  values (v_user, p_course, 'admin')
  on conflict (user_id, course_id) do update set status = 'active';
end $$;

-- Droits d'exécution : rien pour le public par défaut, puis ouverture ciblée
revoke execute on all functions in schema public from public, anon;
grant execute on function public.can_access_lesson(uuid) to anon, authenticated;
grant execute on function public.is_admin(), public.is_instructor(),
  public.can_edit_course(uuid), public.course_is_visible(uuid), public.has_course_access(uuid),
  public.try_uuid(text) to anon, authenticated;
grant execute on function public.enroll_free(uuid), public.mark_lesson_complete(uuid),
  public.submit_quiz(uuid, integer[]), public.declare_manual_payment(uuid, text, text, text),
  public.review_payment(uuid, boolean), public.admin_list_payments(text), public.admin_list_users(text),
  public.admin_set_role(uuid, text), public.admin_grant_access(text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Stockage des fichiers
--   course-media  (privé)  : {course_id}/{lesson_id}/{fichier}
--   public-assets (public) : covers/{course_id}/{fichier} · avatars/{user_id}/{fichier}
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('course-media', 'course-media', false, 52428800)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('public-assets', 'public-assets', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy media_read on storage.objects for select
  using (bucket_id = 'course-media'
         and public.can_access_lesson(public.try_uuid((storage.foldername(name))[2])));
create policy media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'course-media'
              and public.can_edit_course(public.try_uuid((storage.foldername(name))[1])));
create policy media_update on storage.objects for update to authenticated
  using (bucket_id = 'course-media'
         and public.can_edit_course(public.try_uuid((storage.foldername(name))[1])));
create policy media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'course-media'
         and public.can_edit_course(public.try_uuid((storage.foldername(name))[1])));

create policy assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'public-assets' and (
    ((storage.foldername(name))[1] = 'covers' and public.can_edit_course(public.try_uuid((storage.foldername(name))[2])))
    or ((storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = auth.uid()::text)));
create policy assets_update on storage.objects for update to authenticated
  using (bucket_id = 'public-assets' and (
    ((storage.foldername(name))[1] = 'covers' and public.can_edit_course(public.try_uuid((storage.foldername(name))[2])))
    or ((storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = auth.uid()::text)));
create policy assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'public-assets' and (
    ((storage.foldername(name))[1] = 'covers' and public.can_edit_course(public.try_uuid((storage.foldername(name))[2])))
    or ((storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = auth.uid()::text)));
