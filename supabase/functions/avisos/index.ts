// Función de servidor "avisos" (Supabase Edge Function): notificaciones al móvil (Web Push).
//
// La llama pg_cron cada minuto (ver la sección "avisos al móvil" de supabase/retos.sql)
// y también la app justo después de crear, proponer o aprobar un reto, para que el
// aviso llegue al instante.
//
// Acciones (POST con JSON):
//   {}                   activa los retos programados que ya tocan y manda los avisos pendientes
//   { accion: "clave" }  devuelve la clave pública VAPID (la crea la primera vez)
//
// La clave privada VAPID se guarda en la tabla push_vapid, que solo puede leer el servidor.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Aviso = { endpoint: string; p256dh: string; auth: string; titulo: string; cuerpo: string; url: string; tag: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "metodo_no_permitido" }, 405);
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw new Error(error.message);
      return data;
    };

    // Claves VAPID: se crean una sola vez
    let claves = await rpc("push_vapid_leer") as { publica: string; privada: string } | null;
    if (!claves) {
      const k = webpush.generateVAPIDKeys();
      await rpc("push_vapid_guardar", { p_publica: k.publicKey, p_privada: k.privateKey });
      claves = await rpc("push_vapid_leer");
    }
    if (!claves) throw new Error("sin_claves");

    const body = await req.json().catch(() => ({}));
    if (body && body.accion === "clave") return json({ publica: claves.publica });

    await rpc("revisar_retos").catch(() => null);   // empieza los retos programados que ya tocan

    webpush.setVapidDetails("https://dartagnanmilsim.github.io/Juego-familia/", claves.publica, claves.privada);
    const avisos = (await rpc("tomar_avisos") as Aviso[] | null) || [];
    let enviados = 0, fallidos = 0, borrados = 0;
    await Promise.all(avisos.map(async (a) => {
      try {
        await webpush.sendNotification(
          { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
          JSON.stringify({ titulo: a.titulo, cuerpo: a.cuerpo, url: a.url, tag: a.tag }),
          { TTL: 60 * 60 * 6, urgency: "high" },
        );
        enviados++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {   // el móvil ya no tiene esa suscripción
          await rpc("push_desuscribir", { p_endpoint: a.endpoint }).catch(() => null);
          borrados++;
        } else fallidos++;
      }
    }));
    return json({ enviados, fallidos, borrados });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
