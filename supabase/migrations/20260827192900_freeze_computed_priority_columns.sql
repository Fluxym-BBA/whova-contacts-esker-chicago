-- priority_auto et priority_why sont le produit de la formule : le client a le
-- droit de les lire, pas de les reecrire. Le commentaire de colonne le disait,
-- rien ne l'empechait. On le rend vrai.
create or replace function public.freeze_computed_priority()
returns trigger language plpgsql as $$
begin
  new.priority_auto := old.priority_auto;
  new.priority_why  := old.priority_why;
  if new.priority is distinct from old.priority and new.priority_manual is not true then
    new.priority_manual := true;   -- filet : un changement de priorite est un choix humain
  end if;
  return new;
end $$;

revoke execute on function public.freeze_computed_priority() from anon, authenticated, public;

drop trigger if exists trg_freeze_computed_priority on public.attendees;
create trigger trg_freeze_computed_priority
  before update on public.attendees
  for each row execute function public.freeze_computed_priority();
