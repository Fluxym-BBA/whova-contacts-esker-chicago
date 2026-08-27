create extension if not exists pgcrypto;

-- ============ EQUIPE FLUXYM ============
create table public.team (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,
  email       text,
  role        text,
  color       text not null default '#6366f1',
  active      boolean not null default true,
  sort_order  int not null default 100
);

-- ============ PARTICIPANTS ============
create table public.attendees (
  id            text primary key,
  full_name     text not null,
  first_name    text,
  last_name     text,
  title         text,
  company       text,
  location      text,
  whova_tags    text[] not null default '{}',
  segment       text,
  job_function  text,
  seniority     text,
  priority      text,
  page_whova    int,
  photo         text,
  owner         text references public.team(name) on update cascade on delete set null,
  status        text not null default 'A contacter',
  contacted_at  timestamptz,
  meeting_slot  text,
  interest      text,
  notes         text,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

create index attendees_owner_idx    on public.attendees(owner);
create index attendees_priority_idx on public.attendees(priority);
create index attendees_segment_idx  on public.attendees(segment);
create index attendees_company_idx  on public.attendees(company);
create index attendees_search_idx   on public.attendees
  using gin (to_tsvector('simple', coalesce(full_name,'')||' '||coalesce(company,'')||' '||coalesce(title,'')));

-- ============ JOURNAL ============
create table public.activity_log (
  id           bigserial primary key,
  attendee_id  text,
  attendee_name text,
  actor        text,
  action       text,
  detail       jsonb,
  created_at   timestamptz not null default now()
);
create index activity_log_created_idx on public.activity_log(created_at desc);

-- ============ TRIGGER ============
create or replace function public.touch_attendee()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  who := coalesce(nullif(current_setting('request.jwt.claims', true)::json->>'email',''), new.updated_by, 'system');
  new.updated_at := now();
  new.updated_by := who;
  if old.owner is distinct from new.owner then
    insert into public.activity_log(attendee_id, attendee_name, actor, action, detail)
    values (new.id, new.full_name, who, 'assign',
            jsonb_build_object('from', old.owner, 'to', new.owner));
  end if;
  if old.status is distinct from new.status then
    insert into public.activity_log(attendee_id, attendee_name, actor, action, detail)
    values (new.id, new.full_name, who, 'status',
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end $$;

create trigger touch_attendee_trg before update on public.attendees
for each row execute function public.touch_attendee();

-- ============ RLS ============
alter table public.attendees    enable row level security;
alter table public.team         enable row level security;
alter table public.activity_log enable row level security;

create policy att_read   on public.attendees    for select to authenticated using (true);
create policy att_write  on public.attendees    for update to authenticated using (true) with check (true);
create policy team_read  on public.team         for select to authenticated using (true);
create policy log_read   on public.activity_log for select to authenticated using (true);

-- ============ VUES ============
create view public.stats with (security_invoker = true) as
select
  count(*)                                                       as total,
  count(*) filter (where segment = 'Client / Prospect')          as prospects,
  count(*) filter (where priority = 'A')                         as prio_a,
  count(*) filter (where owner is not null)                      as assigned,
  count(*) filter (where owner is null
        and segment not in ('Esker (hote)','Fluxym (nous)'))     as unassigned,
  count(*) filter (where status <> 'A contacter')                as touched,
  count(*) filter (where status in ('RDV planifie','Rencontre')) as won
from public.attendees;

create view public.leaderboard with (security_invoker = true) as
select t.name, t.color, t.role,
       count(a.id)                                            as portefeuille,
       count(a.id) filter (where a.status <> 'A contacter')    as contactes,
       count(a.id) filter (where a.status = 'RDV planifie')    as rdv,
       count(a.id) filter (where a.status = 'Rencontre')       as rencontres
from public.team t
left join public.attendees a on a.owner = t.name
where t.active
group by t.name, t.color, t.role, t.sort_order
order by t.sort_order, t.name;
