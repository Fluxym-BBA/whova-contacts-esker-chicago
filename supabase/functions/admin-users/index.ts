/* ==========================================================================
   admin-users — administration des comptes
   Fluxym · Stand Esker All Access 2026

   Cette fonction est le SEUL endroit du systeme qui detient la cle
   `service_role`. Elle ne doit jamais etre appelee sans avoir d'abord
   etabli que l'appelant est un proprietaire actif.

   L'autorisation se fait en quatre etapes, dans cet ordre :
     1. un jeton est present dans l'en-tete Authorization ;
     2. Supabase valide sa signature et nous rend l'utilisateur ;
     3. la fiche `team` de cet utilisateur est lue AVEC SES PROPRES DROITS,
        ce qui interdit qu'une regle RLS mal ecrite elargisse sa vue ;
     4. et seulement alors, la cle privilegiee est instanciee.
   ========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const URL_    = Deno.env.get('SUPABASE_URL') ?? '';
const ANON    = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/* Domaines admis pour la creation de comptes. Vide = aucun controle. */
const DOMAINS = ['fluxym.com'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (message: string, status = 400) => json({ error: message }, status);

/* --------------------------------------------------------------------------
   Mot de passe provisoire.
   Il sera dicte de vive voix ou colle dans un message : lisible avant d'etre
   long. Trois groupes de quatre signes, sans les caracteres qu'on confond
   (0/O, 1/l/I). Alphabet de 31 signes sur 12 positions, environ 59 bits.
   -------------------------------------------------------------------------- */
function makePassword(): string {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const n = new Uint32Array(12);
  crypto.getRandomValues(n);
  const c = [...n].map(x => A[x % A.length]);
  return `${c.slice(0,4).join('')}-${c.slice(4,8).join('')}-${c.slice(8,12).join('')}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const isUuid = (s: unknown) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

function checkEmail(raw: unknown): string {
  const email = String(raw || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw { status: 400, message: 'Adresse e-mail invalide' };
  if (DOMAINS.length) {
    const dom = email.split('@')[1];
    if (!DOMAINS.includes(dom))
      throw { status: 400, message: `Domaine non autorise : ${dom}. Domaines admis : ${DOMAINS.join(', ')}` };
  }
  return email;
}

function checkPassword(raw: unknown): { password: string; generated: boolean } {
  if (raw == null || String(raw).trim() === '') return { password: makePassword(), generated: true };
  const password = String(raw);
  if (password.length < 8) throw { status: 400, message: 'Le mot de passe doit faire au moins 8 caracteres' };
  return { password, generated: false };
}

/* Etape 4. Un seul endroit lit la cle privilegiee. */
const elevated = () => createClient(URL_, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false }
});

/* Etapes 1 a 3. Renvoie la fiche de l'appelant, ou leve. */
async function authorize(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!jwt) throw { status: 401, message: 'Authentification requise' };

  const asCaller = createClient(URL_, ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: u, error: uErr } = await asCaller.auth.getUser();
  if (uErr || !u?.user) throw { status: 401, message: 'Session invalide ou expiree' };

  const { data: me, error: pErr } = await asCaller
    .from('team').select('id, user_id, name, email, is_owner, active')
    .eq('user_id', u.user.id).maybeSingle();

  if (pErr) throw { status: 500, message: `Lecture du profil impossible : ${pErr.message}` };
  if (!me)  throw { status: 403, message: 'Aucune fiche associee a ce compte' };
  if (!me.active)   throw { status: 403, message: 'Compte desactive' };
  if (!me.is_owner) throw { status: 403, message: 'Action reservee au proprietaire' };
  return me;
}

/* ==========================================================================
   ACTIONS
   ========================================================================== */

/** Fiches `team` croisees avec ce que voit `auth` : derniere connexion, etc. */
async function actionList(db: ReturnType<typeof elevated>) {
  const seen: Record<string, any> = {};
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw { status: 500, message: error.message };
    const batch = data?.users || [];
    batch.forEach(x => seen[x.id] = {
      created_at: x.created_at,
      last_sign_in_at: x.last_sign_in_at ?? null,
      email_confirmed_at: x.email_confirmed_at ?? null
    });
    if (batch.length < 200) break;
  }

  const { data: team, error } = await db.from('team').select('*').order('sort_order').order('name');
  if (error) throw { status: 500, message: error.message };

  const { data: att } = await db.from('attendees').select('owner, status');
  const load: Record<string, { total: number; done: number }> = {};
  (att || []).forEach(a => {
    if (!a.owner) return;
    load[a.owner] ??= { total: 0, done: 0 };
    load[a.owner].total++;
    if (a.status !== 'A contacter') load[a.owner].done++;
  });

  return {
    users: (team || []).map(t => ({
      ...t,
      ...(t.user_id ? seen[t.user_id] : {}),
      orphan: !t.user_id,
      portfolio: load[t.name]?.total ?? 0,
      contacted: load[t.name]?.done ?? 0
    }))
  };
}

async function actionCreate(db: ReturnType<typeof elevated>, body: any, me: any) {
  const email = checkEmail(body.email);
  const { password, generated } = checkPassword(body.password);
  const name = String(body.name || '').trim();
  if (!name) throw { status: 400, message: 'Le nom affiche est obligatoire' };

  const { data, error } = await db.auth.admin.createUser({
    email, password,
    /* Sans cette ligne le compte existe mais ne peut pas se connecter, et
       l'echec ressemble a un mot de passe errone. L'application n'envoie
       aucun courriel : la confirmation se fait donc ici. */
    email_confirm: true,
    user_metadata: { display_name: name, role: body.role || null, color: body.color || null }
  });

  if (error) {
    const m = String(error.message || '');
    if (/already|exists|registered|duplicate/i.test(m))
      throw { status: 409, message: `Un compte existe deja pour ${email}` };
    throw { status: 400, message: m };
  }

  const userId = data.user!.id;

  /* Le declencheur handle_new_user a deja cree la fiche, en membre.
     On n'applique donc que les ecarts demandes. */
  const patch: Record<string, unknown> = { is_owner: body.is_owner === true, active: true };
  if (name)       patch.name  = name;
  if (body.role)  patch.role  = String(body.role).trim();
  if (body.color) patch.color = String(body.color).trim();

  const { data: prof } = await db.from('team').update(patch).eq('user_id', userId).select().maybeSingle();

  /* Fiche absente = declencheur non installe. Le compte existe deja :
     mieux vaut creer la ligne que laisser un compte inadministrable. */
  if (!prof) {
    await db.from('team').insert({ user_id: userId, email, name, ...patch });
  }

  return { user_id: userId, email, name, password, generated, created_by: me.name };
}

async function actionPassword(db: ReturnType<typeof elevated>, body: any) {
  if (!isUuid(body.user_id)) throw { status: 400, message: 'Identifiant de compte invalide' };
  const { password, generated } = checkPassword(body.password);

  const { data, error } = await db.auth.admin.updateUserById(String(body.user_id), {
    password,
    /* Un compte jamais confirme resterait bloque a la connexion, sans
       rapport apparent avec le mot de passe. */
    email_confirm: true
  });
  if (error) throw { status: 400, message: error.message };
  return { user_id: data.user!.id, email: data.user!.email, password, generated };
}

/** Renommage, role, couleur, niveau d'acces, activation. */
async function actionUpdate(db: ReturnType<typeof elevated>, body: any, me: any) {
  if (!isUuid(body.user_id)) throw { status: 400, message: 'Identifiant de compte invalide' };

  const patch: Record<string, unknown> = {};
  if (body.name  !== undefined) patch.name  = String(body.name).trim();
  if (body.role  !== undefined) patch.role  = String(body.role).trim() || null;
  if (body.color !== undefined) patch.color = String(body.color).trim();
  if (body.is_owner !== undefined) patch.is_owner = body.is_owner === true;
  if (body.active   !== undefined) patch.active   = body.active === true;

  if (body.user_id === me.user_id && (patch.is_owner === false || patch.active === false)) {
    throw { status: 400, message: 'Vous ne pouvez pas retirer vos propres droits' };
  }
  if (!Object.keys(patch).length) throw { status: 400, message: 'Rien a modifier' };

  const { data, error } = await db.from('team').update(patch).eq('user_id', body.user_id).select().maybeSingle();
  if (error) throw { status: 400, message: error.message };
  return { updated: true, profile: data };
}

async function actionDelete(db: ReturnType<typeof elevated>, body: any, me: any) {
  const id = String(body.user_id || '');
  if (!isUuid(id)) throw { status: 400, message: 'Identifiant de compte invalide' };
  if (id === me.user_id) throw { status: 400, message: 'Vous ne pouvez pas supprimer votre propre compte' };

  const { data: target } = await db.from('team').select('*').eq('user_id', id).maybeSingle();

  /* Le dernier proprietaire actif est protege ici et de nouveau par un
     declencheur en base. La double barriere est volontaire : une suppression
     lancee depuis le tableau de bord Supabase ne passe pas par cette fonction. */
  if (target?.is_owner && target?.active) {
    const { count } = await db.from('team')
      .select('id', { count: 'exact', head: true })
      .eq('is_owner', true).eq('active', true).neq('user_id', id);
    if (!count) throw { status: 409, message: 'Impossible : ce compte est le dernier proprietaire actif' };
  }

  /* Compte avant, pour pouvoir dire ce qui a reellement change. */
  let released = 0;
  if (target?.name) {
    const { count } = await db.from('attendees')
      .select('id', { count: 'exact', head: true }).eq('owner', target.name);
    released = count || 0;
    await db.from('attendees').update({ owner: null }).eq('owner', target.name);
  }

  const { error } = await db.auth.admin.deleteUser(id);
  if (error) throw { status: 400, message: error.message };
  if (target?.id) await db.from('team').delete().eq('id', target.id);

  return { deleted: true, user_id: id, email: target?.email ?? null,
           name: target?.name ?? null, contacts_released: released };
}

/* ==========================================================================
   POINT D'ENTREE
   ========================================================================== */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('Methode non autorisee', 405);
  if (!URL_ || !ANON || !SERVICE)
    return fail("Fonction mal configuree : variables d'environnement absentes", 500);

  let me: any;
  try { me = await authorize(req); }
  catch (e: any) { return fail(e.message || 'Acces refuse', e.status || 403); }

  let body: any = {};
  try { body = await req.json(); } catch { /* corps vide accepte pour `list` */ }

  const db = elevated();
  try {
    switch (String(body.action || 'list')) {
      case 'list':     return json(await actionList(db));
      case 'create':   return json(await actionCreate(db, body, me));
      case 'password': return json(await actionPassword(db, body));
      case 'update':   return json(await actionUpdate(db, body, me));
      case 'delete':   return json(await actionDelete(db, body, me));
      default:         return fail(`Action inconnue : ${body.action}`, 400);
    }
  } catch (e: any) {
    return fail(e.message || 'Erreur interne', e.status || 500);
  }
});
