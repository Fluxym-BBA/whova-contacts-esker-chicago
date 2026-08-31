-- ==========================================================================
-- Correction de stamp_funnel : remise a zero explicite
-- DEJA APPLIQUEE EN BASE le 31 aout 2026.
--
-- Trouve en testant les six enchainements possibles dans une transaction
-- annulee : repasser une fiche a « A contacter » apres un detour par
-- « Sans suite » laissait les jalons en place, donc une fiche affichee
-- « A contacter » valait encore neuf points. « A contacter » signifie que
-- rien n'a ete fait : les quatre jalons doivent tomber, quel que soit le
-- statut d'ou l'on vient. Le cas n'etait pas couvert par le test de retour en
-- arriere, car « Sans suite » est hors entonnoir et son rang est null.
-- ==========================================================================
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

  -- Remise a zero explicite : « A contacter » veut dire rien n'a ete fait.
  if rn = 0 then
    new.funnel_msg_at     := null;
    new.funnel_replied_at := null;
    new.funnel_rdv_at     := null;
    new.funnel_met_at     := null;
    return new;
  end if;

  -- Sans suite est une sortie de l'entonnoir, pas un retour en arriere : les
  -- jalons deja acquis restent. Quelqu'un a bien pu etre rencontre avant
  -- d'etre classe sans suite.
  if rn is null then return new; end if;

  -- On ne pose que le jalon de l'etape atteinte. Aller directement a
  -- Rencontre ne pose donc pas les trois jalons precedents, et c'est tout
  -- l'interet : le score peut distinguer les deux parcours.
  if rn = 1 and new.funnel_msg_at     is null then new.funnel_msg_at     := now(); end if;
  if rn = 2 and new.funnel_replied_at is null then new.funnel_replied_at := now(); end if;
  if rn = 3 and new.funnel_rdv_at     is null then new.funnel_rdv_at     := now(); end if;
  if rn = 4 and new.funnel_met_at     is null then new.funnel_met_at     := now(); end if;

  -- Correction d'une fausse manoeuvre : redescendre le statut retire les
  -- jalons au-dessus, sinon vingt points restent acquis pour un appui de
  -- pouce. Le changement de statut est deja journalise par touch_attendee.
  if ro is not null and rn < ro then
    if rn < 4 then new.funnel_met_at     := null; end if;
    if rn < 3 then new.funnel_rdv_at     := null; end if;
    if rn < 2 then new.funnel_replied_at := null; end if;
  end if;

  return new;
end $$;

revoke execute on function public.stamp_funnel() from anon, authenticated, public;
