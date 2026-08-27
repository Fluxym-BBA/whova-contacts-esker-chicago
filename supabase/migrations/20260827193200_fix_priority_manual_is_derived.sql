-- Correction : priority_manual doit etre entierement derive, sinon le bouton
-- "revenir a la suggestion" se faisait immediatement re-marquer comme manuel
-- par le trigger precedent. Le flag n'est plus une donnee que le client
-- affirme, c'est une consequence : la priorite differe-t-elle de la formule ?
create or replace function public.freeze_computed_priority()
returns trigger language plpgsql as $$
begin
  new.priority_auto := old.priority_auto;
  new.priority_why  := old.priority_why;

  if new.priority is distinct from new.priority_auto then
    new.priority_manual := true;
    if new.priority_by is null then new.priority_by := old.priority_by; end if;
  else
    new.priority_manual := false;
    new.priority_by     := null;
  end if;
  return new;
end $$;
