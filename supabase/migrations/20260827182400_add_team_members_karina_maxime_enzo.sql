-- Trois collegues Fluxym reperes dans la liste Whova mais absents de l'equipe applicative.
insert into public.team (name, email, role, color, active, sort_order, is_owner) values
  ('Karina Di Giovanni','kdigiovanni@fluxym.com','Director of North America','#0891b2',true,60,false),
  ('Maxime Febvay',      'mfebvay@fluxym.com',    'Consultant',              '#be185d',true,70,false),
  ('Enzo Bacalja',       'ebacalja@fluxym.com',   'Finance Consultant',      '#4d7c0f',true,80,false)
on conflict do nothing;

do $$
declare r record; uid uuid;
begin
  for r in select * from (values
      ('kdigiovanni@fluxym.com','Fluxym-Esker-2790'),
      ('mfebvay@fluxym.com',    'Fluxym-Esker-4615'),
      ('ebacalja@fluxym.com',   'Fluxym-Esker-8321')
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

-- Filet de securite si le trigger de liaison n'a pas joue
update public.team t set user_id = u.id
from auth.users u
where lower(u.email) = lower(t.email) and t.user_id is null;
