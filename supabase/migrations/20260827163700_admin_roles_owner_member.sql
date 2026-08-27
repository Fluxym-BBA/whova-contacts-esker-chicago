-- ============================================================
-- La table `team` devient le referentiel des comptes.
-- Deux niveaux seulement : proprietaire et membre.
-- ============================================================
alter table public.team
  add column if not exists user_id    uuid unique references auth.users(id) on delete set null,
  add column if not exists is_owner   boolean not null default false,
  add column if not exists created_at timestamptz not null default now();

-- Rattachement des comptes deja crees
update public.team t set user_id = u.id
from auth.users u where lower(u.email) = lower(t.email) and t.user_id is null;

-- Bruno est proprietaire
update public.team set is_owner = true where lower(email) = 'bbartoli@fluxym.com';

-- ============================================================
-- Tout compte cree cote auth obtient automatiquement sa fiche.
-- Sans ce declencheur, un compte cree depuis le tableau de bord
-- Supabase serait orphelin : il pourrait se connecter mais
-- n'aurait acces a rien, et le message d'erreur serait obscur.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare nm text; existing int;
begin
  nm := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
                 initcap(replace(split_part(new.email, '@', 1), '.', ' ')));

  update public.team set user_id = new.id
  where lower(email) = lower(new.email) and user_id is null;
  get diagnostics existing = row_count;

  if existing = 0 then
    insert into public.team (name, email, user_id, role, color, sort_order, active, is_owner)
    values (nm, lower(new.email), new.id,
            nullif(trim(new.raw_user_meta_data->>'role'), ''),
            coalesce(nullif(trim(new.raw_user_meta_data->>'color'), ''),
                     '#' || substr(md5(new.email), 1, 6)),
            100, true, false)
    on conflict (name) do update
      set email = excluded.email, user_id = excluded.user_id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users for each row execute function public.handle_new_user();

-- ============================================================
-- Le dernier proprietaire actif est protege dans la base elle-meme,
-- et pas seulement dans l'Edge Function : une manipulation faite
-- depuis le tableau de bord Supabase doit echouer aussi.
-- ============================================================
create or replace function public.protect_last_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare others int;
begin
  if tg_op = 'DELETE' then
    if not (old.is_owner and old.active) then return old; end if;
  else
    if not (old.is_owner and old.active) then return new; end if;
    if new.is_owner and new.active then return new; end if;
  end if;

  select count(*) into others from public.team
  where is_owner and active and id <> old.id;

  if others = 0 then
    raise exception 'Impossible : ce compte est le dernier proprietaire actif';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists protect_last_owner_trg on public.team;
create trigger protect_last_owner_trg
before update or delete on public.team
for each row execute function public.protect_last_owner();

-- ============================================================
-- Identite : on s'appuie sur user_id, pas sur l'email du jeton.
-- ============================================================
create or replace function public.is_fluxym()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team where active and user_id = auth.uid());
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team where active and is_owner and user_id = auth.uid());
$$;

-- ============================================================
-- RLS
-- ============================================================
drop policy if exists team_read   on public.team;
drop policy if exists team_write  on public.team;
create policy team_read  on public.team for select to authenticated using (public.is_fluxym());
create policy team_write on public.team for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Vue de confort : mon propre profil
create or replace view public.me with (security_invoker = true) as
select id, name, email, role, color, is_owner, active, created_at
from public.team where user_id = auth.uid();
