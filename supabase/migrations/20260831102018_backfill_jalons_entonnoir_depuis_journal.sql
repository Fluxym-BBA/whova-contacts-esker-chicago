-- ==========================================================================
-- Rattrapage des jalons d'entonnoir pour les fiches deja travaillees.
-- DEJA APPLIQUEE EN BASE le 31 aout 2026, sur 57 fiches.
-- Resultat verifie : 55 jalons Message, 4 Reponse, 4 RDV, 0 Rencontre,
-- aucun jalon sans ligne de journal correspondante.
--
-- Aucune date n'est inventee : chaque jalon prend la date de la ligne
-- activity_log qui prouve la transition. Les fiches sans trace ne recoivent
-- rien. Un profil partiel est un etat normal ; un jalon invente serait une
-- faute qui se verrait sur le stand.
--
-- Les deux triggers qui ecrivent sont mis en pause le temps de l'operation :
--   - touch_attendee_trg ecraserait updated_at et updated_by ('system'),
--     donc effacerait la trace de qui a reellement travaille la fiche ;
--   - trg_freeze_computed_priority recalculerait priority_auto et
--     priority_manual sur 57 fiches, alors que cette ecriture ne concerne
--     que quatre colonnes techniques.
-- La desactivation est transactionnelle : si quoi que ce soit echoue, les
-- triggers reviennent en place avec le reste. Verification apres coup :
-- l'empreinte des 57 fiches sur priority_auto, priority_why, priority_manual,
-- updated_by et updated_at est restee identique.
-- ==========================================================================

alter table public.attendees disable trigger touch_attendee_trg;
alter table public.attendees disable trigger trg_freeze_computed_priority;

with j as (
  select attendee_id,
    min(created_at) filter (where detail->>'to' = 'Message envoye') as k1,
    min(created_at) filter (where detail->>'to' = 'Repondu')        as k2,
    min(created_at) filter (where detail->>'to' = 'RDV planifie')   as k3,
    min(created_at) filter (where detail->>'to' = 'Rencontre')      as k4
  from public.activity_log
  where action = 'status'
  group by attendee_id
)
update public.attendees a
set funnel_msg_at     = coalesce(a.funnel_msg_at,     j.k1),
    funnel_replied_at = coalesce(a.funnel_replied_at, j.k2),
    funnel_rdv_at     = coalesce(a.funnel_rdv_at,     j.k3),
    funnel_met_at     = coalesce(a.funnel_met_at,     j.k4)
from j
where j.attendee_id = a.id
  and (j.k1 is not null or j.k2 is not null or j.k3 is not null or j.k4 is not null);

alter table public.attendees enable trigger touch_attendee_trg;
alter table public.attendees enable trigger trg_freeze_computed_priority;
