-- Priorisation v2 : formule affinee, tracabilite, et reprise en main humaine.

alter table public.attendees
  add column if not exists priority_auto   text,
  add column if not exists priority_why    text,
  add column if not exists priority_manual boolean not null default false,
  add column if not exists priority_by     text;

comment on column public.attendees.priority        is 'Priorite effective, celle qui s''affiche et qui filtre.';
comment on column public.attendees.priority_auto   is 'Priorite suggeree par la formule. Jamais ecrasee par un humain.';
comment on column public.attendees.priority_why    is 'Phrase expliquant la suggestion, affichee dans la fiche.';
comment on column public.attendees.priority_manual is 'Vrai si un membre a force la priorite a la main.';
comment on column public.attendees.priority_by     is 'Qui a force la priorite.';

-- Formule : segment, seniorite, fonction, puis un cran de bonus si plusieurs
-- personnes de la meme societe sont inscrites (un compte qui deplace 4 personnes
-- a un projet, c'est un signal plus fort que l'intitule d'un individu isole).
create or replace function public.priority_calc(
  p_segment text, p_seniority text, p_function text, p_company_size int)
returns jsonb language plpgsql immutable as $$
declare
  core     text[] := array['AP / P2P','AR / O2C / Credit','Finance / Treasury','IT / ERP / Data','Direction generale'];
  users    text[] := array['AP / P2P','AR / O2C / Credit'];
  senior   boolean := p_seniority in ('C-level / VP','Director');
  p        text;
  why      text;
  bumped   boolean := false;
begin
  if p_segment = 'Fluxym (nous)' then
    return jsonb_build_object('p', null, 'why', 'Collegue Fluxym : hors perimetre de prospection.');
  end if;

  -- Esker : interlocuteurs partenaires, pas cibles de vente. Plafonnes a B pour
  -- que la file A reste la file commerciale.
  if p_segment = 'Esker (hote)' then
    if senior then
      return jsonb_build_object('p','B','why','Esker, ' || p_seniority || ' : relation partenaire a entretenir (plafonne a B, la file A est reservee aux clients et prospects).');
    end if;
    return jsonb_build_object('p','C','why','Esker, ' || coalesce(p_seniority,'?') || ' : a saluer si l''occasion se presente.');
  end if;

  if p_segment = 'Analyste / Presse' then
    return jsonb_build_object('p','C','why','Analyste ou presse : utile pour la visibilite, pas pour le pipeline.');
  end if;

  if p_segment = 'Ecosysteme (exposant/sponsor)' then
    return jsonb_build_object('p','B','why','Exposant ou sponsor : partenariat possible, pas un prospect direct.');
  end if;

  -- Client / Prospect
  if senior and p_function = any(core) then
    p := 'A'; why := p_seniority || ' sur ' || p_function || ' : decideur sur notre coeur de cible.';
  elsif p_seniority = 'Manager' and p_function = 'Sales / Marketing / Partner' then
    p := 'C'; why := 'Manager, mais fonction commerciale ou marketing : hors de notre sujet.';
  elsif p_seniority = 'Manager' then
    p := 'B'; why := 'Manager sur ' || p_function || ' : influence le choix, rarement seul decideur.';
  elsif p_seniority = 'Contributeur' and p_function = any(users) then
    p := 'B'; why := 'Utilisateur quotidien (' || p_function || ') : meilleur prescripteur interne, et facile a aborder sur un stand.';
  elsif senior then
    p := 'C'; why := p_seniority || ', mais fonction ' || coalesce(p_function,'?') || ' : hors de notre sujet, ou intitule trop vague pour trancher.';
  else
    p := 'C'; why := coalesce(p_seniority,'?') || ' sur ' || coalesce(p_function,'?') || ' : pas de signal fort.';
  end if;

  if p_company_size >= 4 then
    if p = 'C' then p := 'B'; bumped := true;
    elsif p = 'B' then p := 'A'; bumped := true;
    end if;
    if bumped then
      why := why || ' Remonte d''un cran : ' || p_company_size || ' personnes de cette societe sont inscrites.';
    end if;
  end if;

  return jsonb_build_object('p', p, 'why', why);
end $$;

-- Recalcul complet. Le bonus societe ne compte que les clients et prospects :
-- une equipe Esker ou un stand d'exposant a 6 personnes n'est pas un projet.
create or replace function public.recompute_priorities() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with sizes as (
    select company, count(*) as n from public.attendees
    where segment = 'Client / Prospect' and coalesce(company,'') <> ''
    group by company)
  update public.attendees a
     set priority_auto = c.j->>'p',
         priority_why   = c.j->>'why'
    from (select id, company, segment, seniority, job_function from public.attendees) src
    left join sizes s on s.company = src.company
    cross join lateral public.priority_calc(src.segment, src.seniority, src.job_function,
                                            coalesce(s.n,1)::int) as c(j)
   where a.id = src.id;

  update public.attendees
     set priority = priority_auto
   where not priority_manual and priority is distinct from priority_auto;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.recompute_priorities() from anon, authenticated, public;

select public.recompute_priorities();
