-- Message Whova reellement redige pour un participant.
-- Le modele calcule dans js/app.js reste un point de depart : des qu'un humain
-- ecrit ici, sa version prime et le modele ne reprend jamais la main tout seul.
-- La colonne ne prouve pas l'envoi, seuls status et contacted_at le font.
--
-- Deja appliquee en base le 28/08/2026 a 14:41 UTC. Ce fichier est ici pour
-- reference : le pousser dans le depot ne rejoue rien.
alter table public.attendees
  add column message    text,
  add column message_at timestamptz;

comment on column public.attendees.message is
  'Message Whova redige a la main. Null = la fiche affiche le modele calcule.';
comment on column public.attendees.message_at is
  'Horodatage du dernier enregistrement du message.';
