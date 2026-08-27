-- Advisor Supabase : une fonction sans search_path fige peut etre detournee en
-- creant un objet homonyme dans un schema en tete de chemin. Les deux nouvelles
-- fonctions n'y echappent pas, meme si l'une est immutable.
alter function public.priority_calc(text, text, text, int) set search_path = public;
alter function public.freeze_computed_priority() set search_path = public;
