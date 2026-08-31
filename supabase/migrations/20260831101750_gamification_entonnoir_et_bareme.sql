-- ==========================================================================
-- Entonnoir de suivi et bareme de points
-- Fluxym / Stand Esker All Access 2026
--
-- DEJA APPLIQUEE EN BASE le 31 aout 2026. Ce fichier est la pour reference :
-- le pousser sur GitHub ne redeploie rien.
--
-- Pourquoi ces colonnes : `status` ne stocke que la derniere etape atteinte.
-- Impossible d'y lire un parcours, donc impossible de distinguer un contact
-- travaille etape par etape d'un contact classe directement Rencontre. Les
-- jalons ci-dessous portent le parcours ; le score s'en deduit.
-- ==========================================================================

alter table public.attendees
  add column if not exists funnel_msg_at     timestamptz,
  add column if not exists funnel_replied_at timestamptz,
  add column if not exists funnel_rdv_at     timestamptz,
  add column if not exists funnel_met_at     timestamptz,
  add column if not exists contest_at        timestamptz;

comment on column public.attendees.funnel_msg_at     is 'Jalon : premier passage au statut Message envoye. Pose par trigger, jamais par le front.';
comment on column public.attendees.funnel_replied_at is 'Jalon : premier passage au statut Repondu.';
comment on column public.attendees.funnel_rdv_at     is 'Jalon : premier passage au statut RDV planifie.';
comment on column public.attendees.funnel_met_at     is 'Jalon : premier passage au statut Rencontre.';
comment on column public.attendees.contest_at        is 'Date a laquelle le QR du concours 2 jours de consulting a ete propose au contact. Saisie a la main.';

-- --------------------------------------------------------------------------
-- Pose et retrait des jalons, cote base, comme priority_auto et
-- priority_manual. Deplacer cette regle vers le front la rendrait
-- contournable, et le score cesserait de vouloir dire quelque chose.
--
-- Le CASE est recopie ici plutot que sorti dans une fonction funnel_rank() :
-- le droit d'execution des fonctions internes est revoque pour authenticated,
-- et un trigger en security invoker appelant une fonction revoquee ferait
-- echouer l'UPDATE.
-- --------------------------------------------------------------------------
create or replace function public.stamp_funnel() returns trigger
language plpgsql
set search_path = public
as $$
declare rn int; ro int;
begin
  if new.status is not distinct from old.status then return new; end if;

  rn := case new.status when 'A contacter' then 0 when 'Message envoye' then 1
                        when 'Repondu' then 2 when 'RDV planifie' then 3
                        when 'Rencontre' then 4 else null end;
  ro := case old.status when 'A contacter' then 0 when 'Message envoye' then 1
                        when 'Repondu' then 2 when 'RDV planifie' then 3
                        when 'Rencontre' then 4 else null end;

  if rn = 1 and new.funnel_msg_at     is null then new.funnel_msg_at     := now(); end if;
  if rn = 2 and new.funnel_replied_at is null then new.funnel_replied_at := now(); end if;
  if rn = 3 and new.funnel_rdv_at     is null then new.funnel_rdv_at     := now(); end if;
  if rn = 4 and new.funnel_met_at     is null then new.funnel_met_at     := now(); end if;

  if ro is not null and rn < ro then
    if rn < 4 then new.funnel_met_at     := null; end if;
    if rn < 3 then new.funnel_rdv_at     := null; end if;
    if rn < 2 then new.funnel_replied_at := null; end if;
    if rn < 1 then new.funnel_msg_at     := null; end if;
  end if;

  return new;
end $$;

revoke execute on function public.stamp_funnel() from anon, authenticated, public;

drop trigger if exists trg_stamp_funnel on public.attendees;
create trigger trg_stamp_funnel
before update on public.attendees
for each row execute function public.stamp_funnel();

-- --------------------------------------------------------------------------
-- Le bareme. Le score n'est jamais stocke : il se recalcule a l'affichage.
-- Changer un poids renote donc tout le monde, sans migration de donnees et
-- sans risque d'echec a mi-chemin.
-- --------------------------------------------------------------------------
create table if not exists public.score_rules (
  key        text primary key,
  label      text not null,
  points     int  not null default 0,
  sort_order int  not null default 100,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.score_settings (
  id         boolean primary key default true check (id),
  fx2        int not null default 5,
  fx3        int not null default 16,
  updated_at timestamptz not null default now(),
  updated_by text
);

comment on column public.score_settings.fx2 is 'Points a partir desquels la celebration passe au palier 2 (halo).';
comment on column public.score_settings.fx3 is 'Points a partir desquels la celebration passe au palier 3 (confettis).';

insert into public.score_rules (key, label, points, sort_order) values
  ('msg',     'Message envoyé',                       3, 10),
  ('replied', 'Réponse obtenue',                      6, 20),
  ('rdv',     'Rendez-vous planifié',                12, 30),
  ('met',     'Rencontré au stand',                  20, 40),
  ('full',    'Bonus parcours complet dans l''ordre', 10, 50),
  ('prio_a',  'Bonus contact priorité A travaillé',    5, 60),
  ('dead',    'Sans suite qualifié avec une note',     1, 70),
  ('contest', 'Concours proposé',                      5, 80)
on conflict (key) do nothing;

insert into public.score_settings (id) values (true) on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- RLS : lecture pour l'equipe, ecriture pour le proprietaire seul.
-- Aucune policy de suppression : les cles du bareme sont fixes et la ligne
-- unique de score_settings ne doit pas pouvoir disparaitre.
-- --------------------------------------------------------------------------
alter table public.score_rules    enable row level security;
alter table public.score_settings enable row level security;

revoke all on table public.score_rules    from anon;
revoke all on table public.score_settings from anon;
grant select, update on table public.score_rules    to authenticated;
grant select, update on table public.score_settings to authenticated;

drop policy if exists score_rules_read     on public.score_rules;
drop policy if exists score_rules_write    on public.score_rules;
drop policy if exists score_settings_read  on public.score_settings;
drop policy if exists score_settings_write on public.score_settings;

create policy score_rules_read  on public.score_rules
  for select to authenticated using (is_fluxym());
create policy score_rules_write on public.score_rules
  for update to authenticated using (is_owner()) with check (is_owner());
create policy score_settings_read  on public.score_settings
  for select to authenticated using (is_fluxym());
create policy score_settings_write on public.score_settings
  for update to authenticated using (is_owner()) with check (is_owner());
