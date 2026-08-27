-- Emails de connexion de l'equipe
update public.team set email='bbartoli@fluxym.com'   where name='Bruno BARTOLI';
update public.team set email='vlounaouci@fluxym.com' where name='Vincent Lounaouci';
update public.team set email='crivayran@fluxym.com'  where name='Christophe Rivayran';
update public.team set email='mbalanger@fluxym.com'  where name='Marie Pierre Balanger';
update public.team set email='lucas@fluxym.com'      where name='Lucas (a confirmer)';

-- Creation des comptes
do $$
declare r record; uid uuid;
begin
  for r in select * from (values
      ('bbartoli@fluxym.com','Fluxym-Esker-7412'),
      ('vlounaouci@fluxym.com','Fluxym-Esker-3856'),
      ('crivayran@fluxym.com','Fluxym-Esker-9203'),
      ('mbalanger@fluxym.com','Fluxym-Esker-5178'),
      ('lucas@fluxym.com','Fluxym-Esker-6034')
    ) as t(mail, pwd)
  loop
    if not exists (select 1 from auth.users where email = r.mail) then
      uid := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                              email_confirmed_at, created_at, updated_at,
                              raw_app_meta_data, raw_user_meta_data,
                              confirmation_token, email_change, email_change_token_new, recovery_token)
      values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated','authenticated',
              r.mail, crypt(r.pwd, gen_salt('bf')), now(), now(), now(),
              '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                   last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, uid::text,
              jsonb_build_object('sub', uid::text, 'email', r.mail, 'email_verified', true),
              'email', now(), now(), now());
    end if;
  end loop;
end $$;

-- Verrou : seuls les emails presents dans public.team peuvent lire/ecrire
create or replace function public.is_fluxym()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team
    where active and lower(email) = lower(coalesce(auth.jwt()->>'email',''))
  );
$$;

drop policy if exists att_read  on public.attendees;
drop policy if exists att_write on public.attendees;
drop policy if exists team_read on public.team;
drop policy if exists log_read  on public.activity_log;

create policy att_read   on public.attendees    for select to authenticated using (public.is_fluxym());
create policy att_write  on public.attendees    for update to authenticated using (public.is_fluxym()) with check (public.is_fluxym());
create policy team_read  on public.team         for select to authenticated using (public.is_fluxym());
create policy log_read   on public.activity_log for select to authenticated using (public.is_fluxym());
