/* --------------------------------------------------------------------------
   Configuration Supabase - projet "fluxym-esker-allaccess-2026"

   La cle "anon" est publique par conception : c'est le fonctionnement normal
   de Supabase. La securite ne repose pas sur son secret mais sur les regles
   RLS, qui n'ouvrent les donnees qu'aux comptes presents et actifs dans la
   table `team`. La cle `service_role`, elle, n'apparait nulle part ici : elle
   ne vit que dans l'Edge Function `admin-users`, cote serveur.
   -------------------------------------------------------------------------- */
window.FLUXYM_CONFIG = {
  SUPABASE_URL: "https://oyajqqowmzqclbloaxjc.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95YWpxcW93bXpxY2xibG9heGpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4Mjc0OTYsImV4cCI6MjEwMzQwMzQ5Nn0.iSacuN9fgDikHz4dkWBFuKvfU1Uq7M-5MXwz3akhwe0",
  /* Domaine recolle en coulisses. On ne saisit jamais l'adresse entiere :
     Chrome indexe ses mots de passe par couple (origine, identifiant), et
     nos applications partagent la meme origine github.io. Un identifiant
     court ici, une adresse complete ailleurs, et le gestionnaire cesse de
     confondre les deux comptes. */
  LOGIN_DOMAIN: "fluxym.com",
  EVENT: { name: "Esker All Access 2026", place: "Rosemont, IL", dates: "8-10 septembre 2026" }
};
