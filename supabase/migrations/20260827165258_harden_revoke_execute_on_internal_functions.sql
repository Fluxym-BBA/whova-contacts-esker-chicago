-- Les fonctions de declencheur n'ont aucune raison d'etre appelables en RPC.
-- Un declencheur s'execute avec les droits du proprietaire de la table :
-- retirer EXECUTE aux roles exposes ne casse rien et ferme la porte.
revoke execute on function public.handle_new_user()    from anon, authenticated, public;
revoke execute on function public.protect_last_owner() from anon, authenticated, public;
revoke execute on function public.touch_attendee()     from anon, authenticated, public;

-- is_fluxym() et is_owner() sont evaluees dans les policies RLS : le role
-- appelant doit conserver EXECUTE. En revanche `anon` n'en a pas besoin,
-- et rien ne justifie de laisser un visiteur non authentifie les sonder.
revoke execute on function public.is_fluxym() from anon, public;
revoke execute on function public.is_owner()  from anon, public;
grant  execute on function public.is_fluxym() to authenticated;
grant  execute on function public.is_owner()  to authenticated;
