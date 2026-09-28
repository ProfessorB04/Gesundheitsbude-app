// Supabase Edge Function "invite-user"
// Gesundheitsbude-App. Legt Zugänge mit Einmalpasswort an (Rolle: client oder team), erzeugt
// für bestehende Nutzer:innen ein neues Einmalpasswort oder löscht Zugänge. Nur eingeloggte Admins dürfen das.
// Außerdem: Login per Benutzername (action "login", ohne Anmeldung aufrufbar) und Benutzernamen setzen (Admin).
// Zugänge ohne E-Mail bekommen eine interne Platzhalter-Adresse (@ohne-email.gesundheitsbude.de), an die nie gesendet wird.
// Das Einmalpasswort wird an den Admin zurückgegeben, der es selbst weitergibt
// (E-Mail an beliebige Adresse, WhatsApp …). Bei der ersten Anmeldung muss es geändert werden.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Gut lesbares Einmalpasswort ohne verwechselbare Zeichen (0/O, 1/l/I)
function tempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let pw = "";
  for (const b of bytes) pw += chars[b % chars.length];
  return pw.slice(0, 5) + "-" + pw.slice(5);
}

const NOMAIL = "ohne-email.gesundheitsbude.de";
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const isPlaceholder = (email?: string | null) => !!email && email.toLowerCase().endsWith("@" + NOMAIL);
function randSuffix(): string {
  const b = new Uint8Array(4); crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const body = await req.json();

    // ---- Anmeldung mit Benutzername (öffentlich): E-Mail bleibt auf dem Server ----
    if (body.action === "login") {
      const uname = String(body.username ?? "").trim().toLowerCase();
      const pw = String(body.password ?? "");
      const fail = async () => { await new Promise((r) => setTimeout(r, 400)); return json({ error: "Benutzername oder Passwort falsch." }, 400); };
      if (!USERNAME_RE.test(uname) || !pw) return await fail();
      const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
      const { data: prof } = await svc.from("profiles").select("id").eq("username", uname).maybeSingle();
      if (!prof) return await fail();
      const { data: u } = await svc.auth.admin.getUserById(prof.id);
      if (!u || !u.user || !u.user.email) return await fail();
      const fwd = req.headers.get("x-forwarded-for") ?? "";
      const anon = createClient(url, anonKey, {
        auth: { persistSession: false },
        global: { headers: fwd ? { "X-Forwarded-For": fwd } : {} },
      });
      const { data: sess, error: sErr } = await anon.auth.signInWithPassword({ email: u.user.email, password: pw });
      if (sErr || !sess.session) return await fail();
      return json({ ok: true, access_token: sess.session.access_token, refresh_token: sess.session.refresh_token });
    }

    // Wer ruft auf?
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Nicht angemeldet." }, 401);

    const admin = createClient(url, serviceKey);

    // ---- Eigenen Benutzernamen ändern (jede angemeldete Person, nur für sich selbst) ----
    if (body.action === "setOwnUsername") {
      const uname = String(body.username ?? "").trim().toLowerCase();
      if (uname && !USERNAME_RE.test(uname)) return json({ error: "Benutzername: 3–30 Zeichen, nur a–z, 0–9, Punkt, Bindestrich, Unterstrich." }, 400);
      if (!uname && isPlaceholder(user.email)) return json({ error: "Ohne E-Mail brauchst du einen Benutzernamen zum Anmelden." }, 400);
      if (uname) {
        const { data: taken } = await admin.from("profiles").select("id").eq("username", uname).neq("id", user.id).maybeSingle();
        if (taken) return json({ error: "Benutzername „" + uname + "“ ist schon vergeben." }, 409);
      }
      const { error } = await admin.from("profiles").update({ username: uname || null }).eq("id", user.id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, username: uname || null });
    }

    const { data: me } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!me || me.role !== "admin") {
      return json({ error: "Nur Admins dürfen Zugänge verwalten." }, 403);
    }

    const password = tempPassword();

    // ---- Benutzername setzen / ändern / entfernen ----
    if (body.action === "setUsername") {
      const uname = String(body.username ?? "").trim().toLowerCase();
      if (uname && !USERNAME_RE.test(uname)) return json({ error: "Benutzername: 3–30 Zeichen, nur a–z, 0–9, Punkt, Bindestrich, Unterstrich." }, 400);
      const { data: target } = await admin.from("profiles").select("id").eq("id", body.userId).single();
      if (!target) return json({ error: "Nutzer:in nicht gefunden." }, 404);
      if (!uname) {
        const { data: tu } = await admin.auth.admin.getUserById(body.userId);
        if (tu && tu.user && isPlaceholder(tu.user.email)) return json({ error: "Zugang ohne E-Mail braucht einen Benutzernamen." }, 400);
      } else {
        const { data: taken } = await admin.from("profiles").select("id").eq("username", uname).neq("id", body.userId).maybeSingle();
        if (taken) return json({ error: "Benutzername „" + uname + "“ ist schon vergeben." }, 409);
      }
      const { error } = await admin.from("profiles").update({ username: uname || null }).eq("id", body.userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, username: uname || null });
    }

    // ---- Person löschen (inkl. Profil und zugehöriger Daten per Cascade) ----
    if (body.action === "delete") {
      if (body.userId === user.id) return json({ error: "Du kannst dich nicht selbst löschen." }, 403);
      const { data: target } = await admin.from("profiles").select("role, name").eq("id", body.userId).single();
      if (!target) return json({ error: "Nutzer:in nicht gefunden." }, 404);
      if (target.role === "admin") return json({ error: "Admin-Zugänge können hier nicht gelöscht werden." }, 403);
      const { error } = await admin.auth.admin.deleteUser(body.userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, name: target.name });
    }

    // ---- Neues Einmalpasswort für bestehende Person ----
    if (body.action === "reset") {
      const { data: target } = await admin.from("profiles").select("role, name").eq("id", body.userId).single();
      if (!target) return json({ error: "Nutzer:in nicht gefunden." }, 404);
      if (target.role === "admin") return json({ error: "Admin-Zugänge hier nicht zurücksetzbar." }, 403);
      const { data, error } = await admin.auth.admin.updateUserById(body.userId, {
        password,
        email_confirm: true,
        user_metadata: { name: target.name, must_change_password: true },
      });
      if (error) return json({ error: error.message }, 400);
      const { data: up } = await admin.from("profiles").select("username").eq("id", body.userId).single();
      return json({ ok: true, userId: body.userId, email: isPlaceholder(data.user.email) ? "" : data.user.email,
        username: up ? up.username : null, name: target.name, password });
    }

    // ---- Neuen Zugang anlegen ----
    const name = String(body.name ?? "").trim();
    const username = String(body.username ?? "").trim().toLowerCase();
    let email = String(body.email ?? "").trim().toLowerCase();
    if (!name) return json({ error: "Name ist Pflicht." }, 400);
    if (!email && !username) return json({ error: "Bitte E-Mail oder Benutzername angeben." }, 400);
    if (username && !USERNAME_RE.test(username)) return json({ error: "Benutzername: 3–30 Zeichen, nur a–z, 0–9, Punkt, Bindestrich, Unterstrich." }, 400);
    if (username) {
      const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
      if (taken) {
        const { data: tu } = await admin.auth.admin.getUserById(taken.id);
        if (!email || !tu || !tu.user || tu.user.email !== email) return json({ error: "Benutzername „" + username + "“ ist schon vergeben." }, 409);
      }
    }
    const noEmail = !email;
    if (noEmail) email = username + "." + randSuffix() + "@" + NOMAIL;
    const newRole = body.role === "team" ? "team" : "client";

    let userId: string;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, must_change_password: true },
    });
    if (createErr) {
      // Gibt es die Adresse schon (z. B. alte Einladung ohne Passwort)? Dann Passwort neu setzen.
      const { data: existing } = await admin.rpc("find_user_id_by_email", { p_email: email });
      if (!existing) return json({ error: createErr.message }, 400);
      const { data: exProf } = await admin.from("profiles").select("role").eq("id", existing).single();
      if (exProf && exProf.role === "admin") {
        return json({ error: "Diese E-Mail gehört zu einem Admin-Zugang und kann hier nicht neu angelegt werden." }, 403);
      }
      const { data: upd, error: updErr } = await admin.auth.admin.updateUserById(existing, {
        password,
        email_confirm: true,
        user_metadata: { name, must_change_password: true },
      });
      if (updErr) return json({ error: updErr.message }, 400);
      userId = upd.user.id;
    } else {
      userId = created.user.id;
    }

    // Profil wird per Trigger als 'client' angelegt -> Name + gewählte Rolle setzen
    const { data: prof } = await admin.from("profiles").select("role").eq("id", userId).single();
    if (prof && prof.role !== "admin") {
      const upd: Record<string, unknown> = { name, role: newRole };
      if (username) upd.username = username;
      const { error: profErr } = await admin.from("profiles").update(upd).eq("id", userId);
      if (profErr) return json({ error: "Zugang angelegt, aber Rolle nicht gesetzt: " + profErr.message }, 500);
    }

    return json({ ok: true, userId, email: noEmail ? "" : email, username: username || null, name, role: newRole, password });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
