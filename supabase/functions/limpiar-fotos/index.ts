// Función de servidor "limpiar-fotos" (Supabase Edge Function).
//
// Supabase no deja borrar archivos de fotos desde la base de datos: hay que usar
// su API de almacenamiento con la clave privada (service role). Esta función la
// usa en el servidor, así la clave privada nunca llega a los móviles.
//
// Acciones (POST con JSON):
//   { accion: "eliminar_reto",    clave, reto_id }     administrador: borra el reto y sus fotos
//   { accion: "eliminar_usuario", clave, usuario_id }  administrador: borra el usuario y sus fotos
//   { accion: "eliminar_foto",    token, foto_id }     juez del reto: borra la foto y su archivo
//   { accion: "limpiar",          clave }              administrador: borra archivos sin foto en el juego
//
// Los permisos los comprueban las funciones de la base de datos (clave de
// administrador o sesión del juez), igual que desde la app.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const BUCKET = "retos-fotos";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

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
    const rutasDe = async (col: string, valor: string) => {
      const { data, error } = await db.from("fotos").select("ruta").eq(col, valor);
      if (error) throw new Error(error.message);
      return (data ?? []).map((f: { ruta: string }) => f.ruta);
    };

    const b = await req.json().catch(() => ({}));
    let rutas: string[] = [];
    switch (b.accion) {
      case "eliminar_reto":
        await rpc("admin_entrar", { p_clave: b.clave });                 // comprueba la clave
        rutas = await rutasDe("reto_id", b.reto_id);
        await rpc("admin_eliminar_reto", { p_clave: b.clave, p_reto: b.reto_id });
        break;
      case "eliminar_usuario":
        await rpc("admin_entrar", { p_clave: b.clave });
        rutas = await rutasDe("usuario_id", b.usuario_id);
        await rpc("admin_eliminar_usuario", { p_clave: b.clave, p_usuario: b.usuario_id });
        break;
      case "eliminar_foto":
        rutas = await rutasDe("id", b.foto_id);
        await rpc("juez_eliminar_foto", { p_token: b.token, p_foto: b.foto_id });   // comprueba que es el juez
        break;
      case "limpiar":
        await rpc("admin_entrar", { p_clave: b.clave });
        rutas = ((await rpc("fotos_huerfanas")) ?? []).map((x: unknown) =>
          typeof x === "string" ? x : (x as Record<string, string>).fotos_huerfanas);
        break;
      default:
        return json({ error: "accion_invalida" }, 400);
    }

    // Borrar los archivos (por tandas). Si un archivo ya no existe, no pasa nada.
    let borrados = 0;
    for (let i = 0; i < rutas.length; i += 500) {
      const { data, error } = await db.storage.from(BUCKET).remove(rutas.slice(i, i + 500));
      if (error) throw new Error("no_se_pudieron_borrar_archivos: " + error.message);
      borrados += data?.length ?? 0;
    }
    return json({ ok: true, archivos_borrados: borrados });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
