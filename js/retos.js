// Retos en familia
// Tres módulos:
//  - Usuarios: crear usuarios, entrar, perfil y lista de jugadores.
//  - Retos: crear retos (con un juez), hacer fotos en el momento y marcar las fotos
//    de otros con "aceptar" o "denunciar". El juez de cada reto acepta o elimina fotos;
//    solo cuentan las aceptadas.
//  - Administrador (con clave): elimina usuarios y retos y restablece claves.
(function () {
  "use strict";

  var BUCKET = "retos-fotos";
  var TOKEN_KEY = "retos_token";
  var SEEN_KEY = "retos_vistos";
  var AVATARS = ["👩", "👨", "👧", "👦", "🧒", "👵", "👴", "🧑", "👶", "🦸", "🧙", "🐱", "🐶", "🦊", "🐼", "🦁"];
  var PRESETS = [
    { emoji: "🐕", que: "perros negros" }, { emoji: "🚗", que: "coches rojos" }, { emoji: "🐈", que: "gatos" },
    { emoji: "🌸", que: "flores amarillas" }, { emoji: "🚲", que: "bicicletas" }, { emoji: "🎩", que: "gente con sombrero" }
  ];
  var DURATIONS = [
    { min: 15, label: "15 min" }, { min: 30, label: "30 min" }, { min: 60, label: "1 hora" },
    { min: 180, label: "3 horas" }, { min: 1440, label: "1 día" }, { min: 10080, label: "1 semana" }
  ];
  var ESTADOS = { activo: "En marcha", terminado: "Terminado", cancelado: "Cancelado" };
  var ERRORS = {
    credenciales_incorrectas: "Usuario o clave incorrectos.",
    usuario_existe: "Ese usuario ya existe. Elige otro o entra con tu clave.",
    usuario_invalido: "El usuario debe tener de 3 a 20 letras o números, sin espacios ni tildes.",
    clave_corta: "La clave debe tener al menos 4 caracteres.",
    sesion_invalida: "Tu sesión terminó. Vuelve a entrar.",
    clave_admin_incorrecta: "Clave de administrador incorrecta.",
    ya_hay_reto_activo: "Ya hay un reto en marcha. Terminadlo primero.",
    reto_cerrado: "El reto ya se cerró. ¡Alguien llegó antes o se acabó el tiempo!",
    el_juez_no_compite: "Eres el juez de este reto: no puedes subir fotos.",
    solo_el_juez: "Solo el juez de este reto puede hacer eso.",
    no_puedes_votar_tu_foto: "No puedes marcar tus propias fotos.",
    no_participas: "No participas en este reto.",
    sin_participantes: "Elige al menos un participante (que no sea el juez).",
    juez_no_existe: "El juez elegido ya no existe. Elige otro.",
    foto_no_existe: "Esa foto ya no existe.",
    duracion_invalida: "Elige una duración válida.",
    usuario_no_existe: "Ese usuario ya no existe.",
    reto_no_existe: "Ese reto ya no existe.",
    campeonato_sin_retos: "Elige al menos un reto para el campeonato.",
    campeonato_no_existe: "Ese campeonato ya no existe.",
    nombre_invalido: "Escribe un nombre (máximo 60 caracteres).",
    fuera_de_horario: "Ahora no se pueden crear retos: estás fuera del horario permitido.",
    horario_invalido: "La hora de inicio debe ser anterior a la de fin.",
    zona_invalida: "Esa zona horaria no existe."
  };

  var $app = document.getElementById("app");
  var cfg = window.RETOS_CONFIG || {};
  var db = null;
  var token = load(TOKEN_KEY);
  var me = null;                 // usuario con sesión iniciada
  var view = "login";            // login | registro | retos | usuarios | admin-login | admin
  var adminClave = null;         // solo en memoria
  var data = null;               // { usuarios, retos, puntajes, fotos }
  var busy = false;
  var draft = { emoji: "🎯", que: "", meta: 10, min: 60, juez: null, todos: true, parts: [] };
  var sel = null;                // reto abierto en el módulo Retos
  var creating = false;          // mostrando el formulario "crear reto"
  var campForm = null;           // formulario de campeonato del administrador: { id, nombre, retos: [] }
  var justCreated = null;        // id del reto recién creado: muestra "Avisar por WhatsApp" destacado
  // Enlace directo a un reto: retos.html?reto=<id> (lo trae el mensaje de WhatsApp)
  (function () {
    try {
      var q = new URLSearchParams(location.search).get("reto");
      if (q) { sel = q; history.replaceState(null, "", location.pathname); }
    } catch (e) {}
  })();
  var newUser = null;            // formulario "crear usuario para otra persona"
  var channel = null, pollTimer = null, tickTimer = null, reloadTimer = null;

  // ------------------------------------------------------------ utilidades
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg, ms) {
    var t = el("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, ms || 3200);
  }
  function errMsg(e) {
    var m = (e && (e.message || e.error_description || e.error)) || String(e);
    for (var k in ERRORS) if (m.indexOf(k) >= 0) return ERRORS[k];
    if (/fetch|network|Failed/i.test(m)) return "Sin conexión. Inténtalo de nuevo.";
    if (/schema cache|Could not find the function/i.test(m)) return "La base de datos aún no está instalada en Supabase.";
    return "Algo salió mal: " + m;
  }
  function must(res) { if (res.error) throw res.error; return res.data; }
  function photoUrl(ruta) { return db.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl; }
  function user(id) {
    return (data && data.usuarios.filter(function (u) { return u.id === id; })[0]) || { nombre: "Alguien", avatar: "🙂", usuario: "" };
  }
  function juezDe(r) { return r ? (r.juez_id || r.creado_por) : null; }
  function retoById(id) { return data && data.retos.filter(function (r) { return r.id === id; })[0]; }
  function activos() { return data ? data.retos.filter(function (r) { return r.estado === "activo"; }) : []; }
  // ¿Compite este usuario en el reto? (no es el juez y el reto es para todos o está en la lista)
  function compite(r, uid) {
    if (!r || uid === juezDe(r)) return false;
    if (r.para_todos !== false) return true;
    return data.participantes.some(function (x) { return x.reto_id === r.id && x.usuario_id === uid; });
  }
  function competidores(r) { return data.usuarios.filter(function (u) { return compite(r, u.id); }); }
  function fmtLeft(ms) {
    if (ms <= 0) return "¡Tiempo!";
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    function p(n) { return n < 10 ? "0" + n : n; }
    if (d) return d + "d " + h + "h " + p(m) + "m";
    if (h) return h + ":" + p(m) + ":" + p(x);
    return p(m) + ":" + p(x);
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return ""; }
  }
  function say(text) {
    if (!("speechSynthesis" in window)) return;
    try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(text); u.lang = "es-ES"; speechSynthesis.speak(u); } catch (e) {}
  }
  async function guard(fn) {
    try { await fn(); }
    catch (e) {
      if (String(e && e.message).indexOf("sesion_invalida") >= 0) { logout(true); return; }
      toast(errMsg(e), 4500);
    }
  }
  function avatarPicker(id, current) {
    return '<div class="avatars" id="' + id + '">' + AVATARS.map(function (a) {
      return '<button type="button" class="av' + (a === current ? " on" : "") + '" data-a="' + a + '">' + a + '</button>';
    }).join("") + '</div>';
  }
  function bindAvatarPicker(id, onPick) {
    el(id).onclick = function (e) {
      var b = e.target.closest(".av"); if (!b) return;
      onPick(b.dataset.a);
      [].forEach.call(this.children, function (c) { c.classList.toggle("on", c === b); });
    };
  }
  function setHeader() {
    var logged = !!me, inApp = view === "retos" || view === "podio" || view === "usuarios" || view === "admin" || view === "admin-login";
    el("barTitle").textContent = { retos: "Retos", podio: "Podio", usuarios: "Usuarios", admin: "Administrador", "admin-login": "Administrador" }[view] || "Retos en familia";
    el("barSub").hidden = !logged;
    el("barSub").textContent = logged ? "@" + me.usuario : "";
    el("meBtn").hidden = !logged;
    if (logged) el("meBtn").textContent = me.avatar;
    el("tabs").hidden = !(logged && inApp);
    [].forEach.call(document.querySelectorAll("#tabs [data-tab]"), function (b) {
      var t = b.dataset.tab;
      b.classList.toggle("on", t === view || (t === "admin" && view === "admin-login"));
    });
  }
  function goTab(t) {
    if (t === "admin") { view = adminClave ? "admin" : "admin-login"; render(); return; }
    if (t === "retos") { sel = null; creating = false; }
    view = t; render(); window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------ arranque
  async function start() {
    if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase) {
      $app.innerHTML = '<section class="card"><h2>Falta conectar la base de datos</h2><p>Revisa <code>js/retos-config.js</code>.</p></section>';
      return;
    }
    db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
    el("meBtn").onclick = function () { goTab("usuarios"); };
    [].forEach.call(document.querySelectorAll("#tabs [data-tab]"), function (b) { b.onclick = function () { goTab(b.dataset.tab); }; });
    if (token) {
      try {
        me = must(await db.rpc("yo", { p_token: token }));
        if (me && me.id) return enterGame();
      } catch (e) {
        if (String(e && e.message).indexOf("sesion_invalida") < 0) toast(errMsg(e), 5000);
      }
      token = null; me = null; save(TOKEN_KEY, null);
    }
    view = "login"; render();
  }

  function render() {
    setHeader();
    if (view === "login") return renderLogin();
    if (view === "registro") return renderRegister();
    if (view === "admin-login") return renderAdminLogin();
    if (!data) { $app.innerHTML = '<p class="loading">Cargando…</p>'; return; }
    if (view === "admin") return renderAdmin();
    if (view === "usuarios") return renderUsers();
    if (view === "podio") return renderPodio();
    return renderGame();
  }

  // ============================================================ MÓDULO USUARIOS
  function renderLogin() {
    stopLive();
    $app.innerHTML =
      '<section class="hero"><div class="logo-mark" aria-hidden="true"></div><h1>Retos en familia</h1>' +
      '<p class="sub">Alguien lanza un reto, todos salen a hacer fotos y el primero que llega a la meta gana.</p></section>' +
      '<section class="card"><h2>Entrar</h2>' +
      '<form id="loginForm" class="stack-form">' +
      '<input id="lUser" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Usuario" required>' +
      '<input id="lPass" type="password" autocomplete="current-password" placeholder="Clave" required>' +
      '<button class="btn primary wide">Entrar</button></form>' +
      '<p class="hint">¿Aún no tienes usuario?</p>' +
      '<button class="btn wide" id="goRegister">Crear mi usuario</button></section>' +
      '<button class="btn ghost wide" id="goAdmin">Entrar como administrador</button>';
    el("loginForm").onsubmit = function (e) {
      e.preventDefault();
      guard(async function () {
        var res = must(await db.rpc("iniciar_sesion", { p_usuario: el("lUser").value, p_clave: el("lPass").value }));
        loginDone(res);
      });
    };
    el("goRegister").onclick = function () { view = "registro"; render(); };
    el("goAdmin").onclick = function () { view = "admin-login"; render(); };
  }

  var reg = { avatar: AVATARS[0] };
  function renderRegister() {
    $app.innerHTML =
      '<section class="card"><h2>Crear mi usuario</h2>' +
      '<form id="regForm" class="stack-form">' +
      '<label class="label" for="rUser">Usuario (para entrar)</label>' +
      '<input id="rUser" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" placeholder="Ej: wilson" required>' +
      '<label class="label" for="rName">Nombre que verá la familia</label>' +
      '<input id="rName" maxlength="30" placeholder="Ej: Papá Wilson" required>' +
      '<label class="label" for="rPass">Clave (mínimo 4 caracteres)</label>' +
      '<input id="rPass" type="password" autocomplete="new-password" required>' +
      '<input id="rPass2" type="password" autocomplete="new-password" placeholder="Repite la clave" required>' +
      '<p class="label">Elige tu avatar</p>' + avatarPicker("rAvatars", reg.avatar) +
      '<button class="btn primary wide">Crear usuario y entrar</button></form>' +
      '<button class="btn ghost wide" id="goLogin">Ya tengo usuario</button></section>';
    bindAvatarPicker("rAvatars", function (a) { reg.avatar = a; });
    el("goLogin").onclick = function () { view = "login"; render(); };
    el("regForm").onsubmit = function (e) {
      e.preventDefault();
      if (el("rPass").value !== el("rPass2").value) return toast("Las dos claves no coinciden");
      guard(async function () {
        var res = must(await db.rpc("registrar_usuario", {
          p_usuario: el("rUser").value, p_clave: el("rPass").value, p_nombre: el("rName").value, p_avatar: reg.avatar
        }));
        toast("¡Usuario creado! Bienvenido/a, " + res.usuario.nombre);
        loginDone(res);
      });
    };
  }

  function loginDone(res) {
    token = res.token; me = res.usuario; save(TOKEN_KEY, token);
    enterGame();
  }

  function logout(expired) {
    if (token && !expired) db.rpc("cerrar_sesion", { p_token: token });
    token = null; me = null; save(TOKEN_KEY, null);
    view = "login"; render();
    if (expired) toast(ERRORS.sesion_invalida);
  }

  function renderUsers() {
    var p = { avatar: me.avatar };
    var pts = {}, wins = {};
    data.puntajes.forEach(function (x) { pts[x.usuario_id] = (pts[x.usuario_id] || 0) + x.puntos; if (x.puesto === 1) wins[x.usuario_id] = (wins[x.usuario_id] || 0) + 1; });
    var nu = newUser;
    $app.innerHTML =
      '<section class="card"><h2>Jugadores (' + data.usuarios.length + ')</h2>' +
      '<ul class="admin-list">' + data.usuarios.map(function (u) {
        return '<li' + (u.id === me.id ? ' class="is-me"' : "") + '><div class="admin-info"><b>' + esc(u.avatar + " " + u.nombre) + (u.id === me.id ? " (tú)" : "") + '</b>' +
          '<small>@' + esc(u.usuario) + " · " + (pts[u.id] || 0) + " pts" + (wins[u.id] ? " · " + wins[u.id] + (wins[u.id] === 1 ? " victoria" : " victorias") : "") + '</small></div></li>';
      }).join("") + '</ul>' +
      (nu
        ? '<form id="nuForm" class="stack-form new-user"><h3>Crear usuario para otra persona</h3>' +
          '<input id="nuUser" autocapitalize="none" spellcheck="false" maxlength="20" placeholder="Usuario (ej: abuela)" required value="' + esc(nu.usuario) + '">' +
          '<input id="nuName" maxlength="30" placeholder="Nombre que verá la familia" required value="' + esc(nu.nombre) + '">' +
          '<input id="nuPass" type="password" autocomplete="new-password" placeholder="Clave (mínimo 4)" required>' +
          '<p class="label">Avatar</p>' + avatarPicker("nuAvatars", nu.avatar) +
          '<div class="row"><button type="button" class="btn ghost" id="nuCancel">Cancelar</button><button class="btn primary">Crear usuario</button></div>' +
          '<p class="hint">Dale a esa persona su usuario y su clave para que entre desde su móvil.</p></form>'
        : '<button class="btn wide" id="nuOpen">Crear usuario para otra persona</button>') +
      '<button class="btn ghost wide" id="invite">Compartir enlace del juego</button></section>' +
      '<section class="card"><h2>Mi perfil</h2>' +
      '<p class="sub">Usuario: <b>@' + esc(me.usuario) + '</b></p>' +
      '<form id="profForm" class="stack-form">' +
      '<label class="label" for="pName">Nombre</label>' +
      '<input id="pName" maxlength="30" required value="' + esc(me.nombre) + '">' +
      '<p class="label">Avatar</p>' + avatarPicker("pAvatars", me.avatar) +
      '<button class="btn primary wide">Guardar</button></form></section>' +
      '<section class="card"><h2>Cambiar mi clave</h2>' +
      '<form id="passForm" class="stack-form">' +
      '<input id="pOld" type="password" autocomplete="current-password" placeholder="Clave actual" required>' +
      '<input id="pNew" type="password" autocomplete="new-password" placeholder="Clave nueva" required>' +
      '<button class="btn wide">Cambiar clave</button></form></section>' +
      '<button class="btn ghost wide" id="logout">Cerrar sesión</button>';
    el("invite").onclick = invite;
    if (el("nuOpen")) el("nuOpen").onclick = function () { newUser = { usuario: "", nombre: "", avatar: AVATARS[0] }; renderUsers(); el("nuUser").focus(); };
    if (el("nuForm")) {
      el("nuUser").oninput = function () { newUser.usuario = this.value; };
      el("nuName").oninput = function () { newUser.nombre = this.value; };
      bindAvatarPicker("nuAvatars", function (a) { newUser.avatar = a; });
      el("nuCancel").onclick = function () { newUser = null; renderUsers(); };
      el("nuForm").onsubmit = function (e) {
        e.preventDefault();
        guard(async function () {
          var res = must(await db.rpc("registrar_usuario", { p_usuario: newUser.usuario, p_clave: el("nuPass").value, p_nombre: newUser.nombre, p_avatar: newUser.avatar }));
          db.rpc("cerrar_sesion", { p_token: res.token });   // tú sigues con tu sesión
          toast("Usuario @" + res.usuario.usuario + " creado");
          newUser = null; await reload(); renderUsers();
        });
      };
    }
    bindAvatarPicker("pAvatars", function (a) { p.avatar = a; });
    el("profForm").onsubmit = function (e) {
      e.preventDefault();
      guard(async function () {
        me = must(await db.rpc("editar_perfil", { p_token: token, p_nombre: el("pName").value, p_avatar: p.avatar }));
        toast("Perfil guardado"); await reload(); renderUsers(); setHeader();
      });
    };
    el("passForm").onsubmit = function (e) {
      e.preventDefault();
      guard(async function () {
        must(await db.rpc("cambiar_clave", { p_token: token, p_actual: el("pOld").value, p_nueva: el("pNew").value }));
        toast("Clave cambiada"); el("passForm").reset();
      });
    };
    el("logout").onclick = function () { logout(false); };
  }

  // ============================================================ DATOS EN VIVO
  async function enterGame() {
    view = "retos"; data = null; render();
    await reload();
    startLive();
  }

  async function reload() {
    try {
      await db.rpc("revisar_retos");
      var r = await Promise.all([
        db.from("usuarios").select("*").order("creado_en"),
        db.from("retos").select("*").order("inicia_en", { ascending: false }).limit(300),
        db.from("puntajes").select("*"),
        db.from("participantes").select("*"),
        db.from("campeonatos").select("*").order("creado_en", { ascending: false }),
        db.from("campeonato_retos").select("*")
      ]);
      var next = { usuarios: must(r[0]), retos: must(r[1]), puntajes: must(r[2]), participantes: must(r[3]),
        campeonatos: must(r[4]), campeonatoRetos: must(r[5]), fotos: [], votos: [], reglas: null };
      try { var rg = await db.rpc("reglas_juego"); if (!rg.error) next.reglas = rg.data; } catch (e) {}
      var ids = next.retos.filter(function (x) { return x.estado === "activo" || x.id === sel; }).map(function (x) { return x.id; });
      var fv = await Promise.all(ids.map(function (id) {
        return Promise.all([
          db.from("fotos").select("*").eq("reto_id", id).order("creado_en", { ascending: false }),
          db.from("votos").select("*").eq("reto_id", id)
        ]);
      }));
      fv.forEach(function (pair) { next.fotos = next.fotos.concat(must(pair[0])); next.votos = next.votos.concat(must(pair[1])); });
      if (sel && !next.retos.some(function (x) { return x.id === sel; })) sel = null;   // el administrador lo eliminó
      if (me) {
        var fresh = next.usuarios.filter(function (u) { return u.id === me.id; })[0];
        if (!fresh) { data = next; logout(true); return; }   // el administrador eliminó este usuario
        me = fresh;
      }
      el("offline").hidden = true;
      var prev = data;
      data = next;
      if (me) celebrateIfNew(prev);
      if ((view === "admin" && !(campForm && prev)) || (view === "retos" && !(creating && prev))) render();   // no borrar el formulario mientras se escribe
      else if (view === "podio") render();
      else if (view === "usuarios" && !prev) render();   // no borrar lo que se escribe en Usuarios
    } catch (e) {
      el("offline").hidden = false;
      if (!data) $app.innerHTML = '<section class="card"><p>' + esc(errMsg(e)) + '</p><button class="btn" id="retry">Reintentar</button></section>';
      if (el("retry")) el("retry").onclick = reload;
    }
  }

  function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(reload, 350); }

  function startLive() {
    stopLive();
    channel = db.channel("retos-en-familia");
    ["usuarios", "retos", "fotos", "puntajes", "votos", "participantes", "campeonatos", "campeonato_retos"].forEach(function (t) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: t }, scheduleReload);
    });
    channel.subscribe();
    pollTimer = setInterval(reload, 30000);   // respaldo si el móvil corta la conexión
    tickTimer = setInterval(updateClock, 1000);
  }
  function stopLive() {
    if (channel) { try { db.removeChannel(channel); } catch (e) {} channel = null; }
    clearInterval(pollTimer); clearInterval(tickTimer);
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && data && (view === "retos" || view === "podio" || view === "admin" || view === "usuarios")) reload();
  });

  // Cuenta atrás de todos los retos en pantalla
  function updateClock() {
    var vencido = false;
    $app.querySelectorAll("[data-left]").forEach(function (c) {
      var r = retoById(c.dataset.left);
      if (!r || r.estado !== "activo") return;
      var left = new Date(r.termina_en) - Date.now();
      c.textContent = fmtLeft(left);
      c.classList.toggle("hurry", left < 5 * 60000);
      if (left <= 0) vencido = true;
    });
    if (vencido && !updateClock.asked) { updateClock.asked = true; setTimeout(function () { updateClock.asked = false; reload(); }, 1500); }
  }

  // Fotos por jugador en un reto: aceptadas y pendientes
  function counts(retoId) {
    var c = {};
    data.fotos.forEach(function (f) {
      if (f.reto_id !== retoId) return;
      var x = c[f.usuario_id] || (c[f.usuario_id] = { ok: 0, pend: 0 });
      if (f.estado === "aceptada") x.ok++; else x.pend++;
    });
    return c;
  }
  function votosDe(fotoId) {
    var v = { acepta: 0, denuncia: 0, mio: null };
    data.votos.forEach(function (x) {
      if (x.foto_id !== fotoId) return;
      v[x.tipo]++;
      if (me && x.usuario_id === me.id) v.mio = x.tipo;
    });
    return v;
  }

  // ------------------------------------------------------------ avisos por WhatsApp
  // Abre WhatsApp con el mensaje ya escrito; la persona elige el chat o grupo y lo envía.
  var WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3a2.9 2.9 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.6 11.6 0 0 0 4.4 3.9c1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>';
  function gameUrl(r) { return location.origin + location.pathname + (r ? "?reto=" + r.id : ""); }
  function fmtFin(r) {
    try { return new Date(r.termina_en).toLocaleString("es", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return ""; }
  }
  function textoReto(r, nuevo) {
    var juez = user(juezDe(r));
    var quien = r.para_todos !== false ? "Todos" : competidores(r).map(function (u) { return u.nombre; }).join(", ");
    return (nuevo ? "🎯 *¡Nuevo reto!*" : "⏱️ *Reto en marcha* (quedan " + fmtLeft(new Date(r.termina_en) - Date.now()) + ")") + "\n\n" +
      r.emoji + " Gana el primero en conseguir *" + r.meta + (r.meta === 1 ? " foto" : " fotos") + "* de: *" + r.que_buscar + "*\n" +
      "👥 Participan: " + quien + "\n" +
      "⚖️ Juez: " + juez.nombre + " (acepta o elimina las fotos)\n" +
      "🏁 Termina: " + fmtFin(r) + "\n\n" +
      "Entra y haz tus fotos aquí 👇\n" + gameUrl(r);
  }
  function textoResultado(r) {
    var w = r.ganador_id ? user(r.ganador_id) : null;
    var pos = data.puntajes.filter(function (p) { return p.reto_id === r.id; }).sort(function (a, b) { return a.puesto - b.puesto; });
    var medallas = ["🥇", "🥈", "🥉"];
    return "🏆 *Resultado del reto*\n\n" + r.emoji + " " + r.meta + (r.meta === 1 ? " foto" : " fotos") + " de: *" + r.que_buscar + "*\n\n" +
      (w ? "¡Ganó *" + w.nombre + "*! " + (r.motivo === "meta" ? "Llegó primero a la meta." : "Tenía más fotos aceptadas al acabar el tiempo.") + "\n"
         : "Nadie consiguió fotos aceptadas.\n") +
      (pos.length ? "\n" + pos.map(function (p) {
        return (medallas[p.puesto - 1] || p.puesto + ".") + " " + user(p.usuario_id).nombre + " · " + p.fotos + (p.fotos === 1 ? " foto" : " fotos") + " · +" + p.puntos + " pts";
      }).join("\n") + "\n" : "") +
      "\nVer el reto 👇\n" + gameUrl(r);
  }
  function waButton(text, label, extra) {
    return '<a class="btn wa' + (extra ? " " + extra : "") + '" target="_blank" rel="noopener" href="https://wa.me/?text=' +
      encodeURIComponent(text) + '">' + WA_ICON + '<span>' + label + '</span></a>';
  }

  // ============================================================ MÓDULO RETOS
  function renderGame() {
    var r = sel && retoById(sel);
    var html;
    if (creating) html = renderNewForm();
    else if (r) html = '<button class="btn ghost back-btn" id="backList">← Todos los retos</button>' + (r.estado === "activo" ? renderActive(r) : renderFinished(r));
    else html = renderList() + renderRanking() + renderHistory();
    $app.innerHTML = html;
    bindGame(r);
    updateClock();
  }

  function rolBadge(r) {
    if (juezDe(r) === me.id) return '<span class="role judge">Juez</span>';
    if (compite(r, me.id)) return '<span class="role in">Participas</span>';
    return '<span class="role out">No participas</span>';
  }

  // ------------------------------------------------------------ horario para crear retos
  var ZONAS = [
    ["America/Bogota", "Colombia"], ["America/Mexico_City", "México (centro)"], ["America/Lima", "Perú"],
    ["America/Guayaquil", "Ecuador"], ["America/Panama", "Panamá"], ["America/Caracas", "Venezuela"],
    ["America/Santo_Domingo", "República Dominicana"], ["America/Puerto_Rico", "Puerto Rico"],
    ["America/La_Paz", "Bolivia"], ["America/Santiago", "Chile"], ["America/Asuncion", "Paraguay"],
    ["America/Argentina/Buenos_Aires", "Argentina"], ["America/Montevideo", "Uruguay"], ["America/Sao_Paulo", "Brasil (São Paulo)"],
    ["America/Guatemala", "Guatemala / Centroamérica"], ["America/New_York", "EE. UU. (este)"], ["America/Chicago", "EE. UU. (centro)"],
    ["America/Los_Angeles", "EE. UU. (pacífico)"], ["Europe/Madrid", "España"]
  ];
  function nombreZona(z) {
    var m = ZONAS.filter(function (x) { return x[0] === z; })[0];
    return m ? m[1] : z;
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function horaEnZona(z) {
    try {
      var parts = new Intl.DateTimeFormat("en-GB", { timeZone: z, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
      var h = +parts.filter(function (x) { return x.type === "hour"; })[0].value, m = +parts.filter(function (x) { return x.type === "minute"; })[0].value;
      return { h: h % 24, m: m };
    } catch (e) { return null; }
  }
  // ¿Se pueden crear retos ahora? (la base de datos lo vuelve a comprobar al crear)
  function horario() {
    var rg = data && data.reglas;
    if (!rg) return { abierto: true, texto: "" };
    var t = horaEnZona(rg.zona_horaria), abierto = t ? (t.h >= rg.hora_inicio && t.h < rg.hora_fin) : rg.abierto;
    var ahora = t ? pad2(t.h) + ":" + pad2(t.m) : rg.hora_local;
    return {
      abierto: abierto, ahora: ahora,
      rango: pad2(rg.hora_inicio) + ":00 a " + pad2(rg.hora_fin) + ":00",
      zona: nombreZona(rg.zona_horaria)
    };
  }

  function renderList() {
    var act = activos();
    // primero los retos donde participo o soy juez
    act.sort(function (a, b) {
      var pa = (juezDe(a) === me.id || compite(a, me.id)) ? 0 : 1, pb = (juezDe(b) === me.id || compite(b, me.id)) ? 0 : 1;
      return pa - pb || new Date(a.termina_en) - new Date(b.termina_en);
    });
    var hz = horario();
    return (hz.abierto
        ? '<button class="btn primary wide new-reto" id="newReto">+ Crear reto</button>'
        : '<div class="card closed-box"><b>Fuera del horario para crear retos</b>Los retos se crean de <b>' + hz.rango + '</b> (hora de ' + esc(hz.zona) + '). ' +
          'Ahora son las ' + hz.ahora + '. Los retos en marcha siguen igual.</div>') +
      '<section class="card"><h2>En marcha <span class="count">' + act.length + '</span></h2>' +
      (act.length ? '<ul class="reto-list">' + act.map(function (r) {
        var c = counts(r.id), mine = c[me.id] || { ok: 0, pend: 0 };
        var pend = data.fotos.filter(function (f) { return f.reto_id === r.id && f.estado !== "aceptada"; }).length;
        var quien = r.para_todos !== false ? "Todos" : competidores(r).map(function (u) { return u.avatar; }).join(" ");
        return '<li><button class="reto-card" data-open="' + r.id + '">' +
          '<span class="reto-emoji">' + esc(r.emoji) + '</span>' +
          '<span class="reto-body"><b>' + r.meta + " fotos · " + esc(r.que_buscar) + '</b>' +
          '<small>Juez ' + esc(user(juezDe(r)).nombre) + ' · ' + esc(quien) + ' · <span data-left="' + r.id + '"></span></small>' +
          rolBadge(r) +
          (compite(r, me.id) ? '<small>Tus fotos aceptadas: <b>' + mine.ok + '/' + r.meta + '</b>' + (mine.pend ? " · " + mine.pend + " esperando" : "") + '</small>' : "") +
          (juezDe(r) === me.id && pend ? '<small class="to-review">' + pend + ' foto' + (pend === 1 ? "" : "s") + ' por revisar</small>' : "") +
          '</span><span class="reto-go">›</span></button></li>';
      }).join("") + '</ul>' : '<p class="hint">No hay retos en marcha.' + (hz.abierto ? ' ¡Crea uno!' : '') + '</p>') +
      '</section>';
  }

  function renderActive(r) {
    var c = counts(r.id), juez = user(juezDe(r)), soyJuez = juezDe(r) === me.id, participo = compite(r, me.id);
    var mine = c[me.id] || { ok: 0, pend: 0 };
    var lista = competidores(r).sort(function (a, b) { return ((c[b.id] || {}).ok || 0) - ((c[a.id] || {}).ok || 0); });
    var fotos = data.fotos.filter(function (f) { return f.reto_id === r.id; });
    if (soyJuez) fotos.sort(function (a, b) {   // al juez: primero pendientes y las más denunciadas
      var pa = a.estado === "aceptada" ? 1 : 0, pb = b.estado === "aceptada" ? 1 : 0;
      return pa - pb || votosDe(b.id).denuncia - votosDe(a.id).denuncia || new Date(a.creado_en) - new Date(b.creado_en);
    });
    var pendientes = fotos.filter(function (f) { return f.estado !== "aceptada"; }).length;
    var accion;
    if (soyJuez) {
      accion = '<div class="judge-box"><b>Eres el juez de este reto</b>No compites. Acepta las fotos que valen y elimina las que no. ' +
        'Solo cuentan las que aceptes.<div class="judge-count">' + pendientes + ' foto' + (pendientes === 1 ? "" : "s") + ' por revisar</div></div>';
    } else if (participo) {
      accion = '<div class="mine"><b>' + mine.ok + '</b> / ' + r.meta + '<small>tus fotos aceptadas' + (mine.pend ? " · " + mine.pend + " esperando al juez" : "") + '</small></div>' +
        '<button class="btn camera' + (busy ? " busy" : "") + '" id="shot">' + (busy ? "Subiendo…" : "Tomar foto") + '</button>' +
        '<p class="hint">Solo valen fotos hechas en el momento con la cámara del juego. El juez decide si cuentan.</p>';
    } else {
      accion = '<div class="judge-box out-box"><b>No participas en este reto</b>Puedes ver cómo va, pero no hacer fotos ni marcarlas.</div>';
    }
    var aviso = justCreated === r.id
      ? '<section class="card wa-card"><h2>Reto creado</h2><p class="sub">Avisa a los participantes para que empiecen a buscar. ' +
        'Se abrirá WhatsApp con el mensaje escrito: elige el grupo o la persona y envíalo.</p>' +
        waButton(textoReto(r, true), "Avisar por WhatsApp", "wide") + '</section>'
      : "";
    return aviso + '<section class="card active">' +
      '<div class="tag live">En marcha</div>' +
      '<div class="big-emoji">' + esc(r.emoji) + '</div>' +
      '<h2>Gana el primero en conseguir <span class="goal">' + r.meta + ' fotos aceptadas</span> de: <span class="goal">' + esc(r.que_buscar) + '</span></h2>' +
      '<p class="sub">Juez: <b>' + esc(juez.avatar + " " + juez.nombre) + '</b> · lo creó ' + esc(user(r.creado_por).nombre) + '<br>' +
      (r.para_todos !== false ? "Para todos" : "Solo para: " + esc(lista.map(function (u) { return u.nombre; }).join(", "))) + '</p>' +
      '<div class="clock-wrap"><span data-left="' + r.id + '"></span></div>' +
      accion +
      '<ul class="race">' + lista.map(function (u) {
        var x = c[u.id] || { ok: 0, pend: 0 }, pct = Math.min(100, Math.round(x.ok / r.meta * 100));
        return '<li' + (u.id === me.id ? ' class="is-me"' : "") + '>' +
          '<span class="who">' + esc(u.avatar) + " " + esc(u.nombre) + '</span>' +
          '<span class="track"><i style="width:' + pct + '%"></i></span>' +
          '<span class="n">' + x.ok + "/" + r.meta + (x.pend ? ' <small>+' + x.pend + ' pend.</small>' : "") + '</span></li>';
      }).join("") + '</ul>' +
      '</section>' +
      (justCreated === r.id ? "" : '<div class="wa-row">' + waButton(textoReto(r, false), "Recordar por WhatsApp", "ghost-wa") + '</div>') +
      '<section class="card"><h2>Fotos <span class="count">' + fotos.length + '</span></h2>' +
      (fotos.length
        ? (participo ? '<p class="hint">Si una foto de otro jugador vale, márcala como «Válida»; si no, «Denunciar». El juez lo verá.</p>' : "") +
          '<ul class="photo-list">' + fotos.map(function (f) { return photoItem(f, r, soyJuez, participo); }).join("") + '</ul>'
        : '<p class="hint">Todavía no hay fotos.</p>') +
      '</section>';
  }

  function renderFinished(r) {
    var w = r.ganador_id ? user(r.ganador_id) : null;
    var fotos = data.fotos.filter(function (f) { return f.reto_id === r.id && f.estado === "aceptada"; });
    var pos = data.puntajes.filter(function (p) { return p.reto_id === r.id; }).sort(function (a, b) { return a.puesto - b.puesto; });
    return '<section class="card result">' +
      '<div class="tag">' + (r.estado === "cancelado" ? "Reto cancelado" : "Reto terminado") + ' · ' + fmtDate(r.inicia_en) + '</div>' +
      '<div class="big-emoji">' + esc(r.emoji) + '</div>' +
      '<h2>' + r.meta + ' fotos de: ' + esc(r.que_buscar) + '</h2>' +
      (w ? '<p class="winner">Ganó <b>' + esc(w.avatar + " " + w.nombre) + '</b><br><small>' +
           (r.motivo === "meta" ? "Llegó primero a la meta con fotos aceptadas" : "Se acabó el tiempo y tenía más fotos aceptadas") + '</small></p>'
         : '<p class="sub">Nadie tenía fotos aceptadas.</p>') +
      (pos.length ? '<ol class="ranking">' + pos.map(function (p) {
        var u = user(p.usuario_id);
        return '<li><span class="pos">' + p.puesto + '</span><span class="who">' + esc(u.avatar + " " + u.nombre) + '</span>' +
          '<span class="wins">' + p.fotos + ' fotos</span><span class="pts">+' + p.puntos + ' pts</span></li>';
      }).join("") + '</ol>' : "") +
      '<p class="sub">Juez: ' + esc(user(juezDe(r)).nombre) + '</p>' +
      (fotos.length ? '<div class="gallery">' + fotos.map(thumb).join("") + '</div>' : "") +
      (r.estado === "terminado" ? waButton(textoResultado(r), "Compartir resultado por WhatsApp", "wide") : "") +
      '</section>';
  }

  function photoItem(f, r, soyJuez, participo) {
    var u = user(f.usuario_id), v = votosDe(f.id), mia = f.usuario_id === me.id, ok = f.estado === "aceptada";
    var acciones = "";
    if (soyJuez) {
      acciones = (ok ? "" : '<button class="btn small" data-act="aceptar" data-id="' + f.id + '">Aceptar</button>') +
        '<button class="btn small danger" data-act="eliminar" data-id="' + f.id + '">Eliminar</button>';
    } else if (participo && !mia) {
      acciones = '<button class="btn small vote' + (v.mio === "acepta" ? " on" : "") + '" data-act="acepta" data-id="' + f.id + '">Válida</button>' +
        '<button class="btn small vote report' + (v.mio === "denuncia" ? " on" : "") + '" data-act="denuncia" data-id="' + f.id + '">Denunciar</button>';
    }
    return '<li class="photo-item' + (v.denuncia ? " reported" : "") + '">' +
      '<button class="ph" data-id="' + f.id + '"><img loading="lazy" alt="" src="' + esc(photoUrl(f.ruta)) + '"></button>' +
      '<div class="photo-info"><b>' + esc(u.avatar + " " + u.nombre) + (mia ? " (tú)" : "") + '</b>' +
      '<span class="badge ' + (ok ? "ok" : "pend") + '">' + (ok ? "Aceptada" : "Pendiente") + '</span>' +
      '<small>' + v.acepta + ' a favor · ' + v.denuncia + ' denuncia' + (v.denuncia === 1 ? "" : "s") + ' · ' + fmtDate(f.creado_en) + '</small>' +
      (acciones ? '<div class="photo-actions">' + acciones + '</div>' : "") + '</div></li>';
  }

  function thumb(f) {
    var u = user(f.usuario_id);
    return '<button class="ph" data-id="' + f.id + '"><img loading="lazy" alt="" src="' + esc(photoUrl(f.ruta)) + '"><span>' + esc(u.avatar) + '</span></button>';
  }

  function renderNewForm() {
    if (!draft.juez || !data.usuarios.some(function (u) { return u.id === draft.juez; })) draft.juez = me.id;
    return '<button class="btn ghost back-btn" id="backList">← Volver a los retos</button>' +
      '<section class="card">' +
      '<h2>Nuevo reto</h2>' +
      (data.reglas ? '<p class="hint">Horario para crear retos: ' + horario().rango + ' (hora de ' + esc(horario().zona) + ').</p>' : "") +
      '<p class="label">¿Cuál es el reto? Escribe lo que quieras fotografiar</p>' +
      '<div class="row"><input id="rEmoji" class="emoji-in" maxlength="4" value="' + esc(draft.emoji) + '" aria-label="Emoji">' +
      '<input id="rQue" maxlength="60" value="' + esc(draft.que) + '" placeholder="Ej: gente con sombrero"></div>' +
      '<p class="label">Ideas (toca una para usarla)</p>' +
      '<div class="chips" id="presets">' + PRESETS.map(function (p) {
        return '<button type="button" class="chip' + (p.que === draft.que ? " on" : "") + '" data-e="' + p.emoji + '" data-q="' + esc(p.que) + '">' + p.emoji + " " + esc(p.que) + '</button>';
      }).join("") + '</div>' +
      '<p class="label">¿Cuántas fotos aceptadas hacen falta para ganar?</p>' +
      '<div class="stepper"><button type="button" class="btn" data-d="-1">−</button><b id="rMeta">' + draft.meta + '</b><button type="button" class="btn" data-d="1">+</button></div>' +
      '<p class="label">¿Cuánto dura el reto?</p>' +
      '<div class="chips" id="durs">' + DURATIONS.map(function (d) {
        return '<button type="button" class="chip' + (d.min === draft.min ? " on" : "") + '" data-m="' + d.min + '">' + d.label + '</button>';
      }).join("") + '</div>' +
      '<p class="label">Juez <span class="muted">· acepta o elimina las fotos y no compite</span></p>' +
      '<div class="chips" id="judges">' + data.usuarios.map(function (u) {
        return '<button type="button" class="chip' + (u.id === draft.juez ? " on" : "") + '" data-j="' + u.id + '">' + esc(u.avatar + " " + u.nombre) + (u.id === me.id ? " (yo)" : "") + '</button>';
      }).join("") + '</div>' +
      '<p class="label">Participantes</p>' +
      '<div class="seg" id="forWho"><button type="button" data-todos="1" class="' + (draft.todos ? "on" : "") + '">Para todos</button>' +
      '<button type="button" data-todos="0" class="' + (draft.todos ? "" : "on") + '">Solo para algunos</button></div>' +
      '<div id="partsBox"' + (draft.todos ? " hidden" : "") + '><p class="hint">Toca a los que participan (el juez no compite):</p>' +
      '<div class="chips" id="parts">' + data.usuarios.map(function (u) {
        var esJuez = u.id === draft.juez;
        return '<button type="button" class="chip' + (draft.parts.indexOf(u.id) >= 0 && !esJuez ? " on" : "") + (esJuez ? " disabled" : "") + '" data-p="' + u.id + '"' + (esJuez ? " disabled" : "") + '>' +
          esc(u.avatar + " " + u.nombre) + (u.id === me.id ? " (yo)" : "") + (esJuez ? " · juez" : "") + '</button>';
      }).join("") + '</div></div>' +
      '<button class="btn primary wide" id="launch">Lanzar reto</button>' +
      '</section>';
  }

  function renderRanking() {
    var pts = {}, wins = {};
    data.puntajes.forEach(function (p) {
      pts[p.usuario_id] = (pts[p.usuario_id] || 0) + p.puntos;
      if (p.puesto === 1) wins[p.usuario_id] = (wins[p.usuario_id] || 0) + 1;
    });
    var rows = data.usuarios.slice().sort(function (a, b) { return (pts[b.id] || 0) - (pts[a.id] || 0); });
    var medals = [];
    return '<section class="card">' +
      '<h2>Clasificación</h2>' +
      '<ol class="ranking">' + rows.map(function (u, i) {
        return '<li' + (u.id === me.id ? ' class="is-me"' : "") + '><span class="pos">' + (medals[i] || i + 1) + '</span>' +
          '<span class="who">' + esc(u.avatar) + " " + esc(u.nombre) + '</span>' +
          '<span class="wins">' + (wins[u.id] ? wins[u.id] + (wins[u.id] === 1 ? " victoria" : " victorias") : "") + '</span>' +
          '<span class="pts">' + (pts[u.id] || 0) + ' pts</span></li>';
      }).join("") + '</ol>' +
      '<p class="hint">Cada reto: 1º 3 pts · 2º 2 pts · 3º 1 pt (solo cuentan fotos aceptadas por el juez).</p>' +
      '</section>';
  }

  function renderHistory() {
    var done = data.retos.filter(function (r) { return r.estado !== "activo"; });
    if (!done.length) return "";
    return '<section class="card"><h2>Historial</h2><ul class="history">' +
      done.map(function (r) {
        var w = r.ganador_id ? user(r.ganador_id) : null;
        return '<li><button class="hist-item" data-open="' + r.id + '"><span>' + esc(r.emoji) + " " + r.meta + " · " + esc(r.que_buscar) + '<small>' + fmtDate(r.inicia_en) + " · juez " + esc(user(juezDe(r)).nombre) + '</small></span>' +
          '<span>' + (r.estado === "cancelado" ? "Cancelado" : w ? "Ganó " + esc(w.avatar + " " + w.nombre) : "Sin ganador") + ' ›</span></button></li>';
      }).join("") + '</ul></section>';
  }

  function openReto(id) { sel = id; creating = false; window.scrollTo(0, 0); reload(); render(); }
  function backToList() { sel = null; creating = false; justCreated = null; render(); window.scrollTo(0, 0); }

  function bindGame(r) {
    $app.querySelectorAll(".ph").forEach(function (b) { b.onclick = function () { openViewer(b.dataset.id); }; });
    $app.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () { openReto(b.dataset.open); }; });
    if (el("backList")) el("backList").onclick = backToList;
    if (el("newReto")) el("newReto").onclick = function () { creating = true; sel = null; render(); window.scrollTo(0, 0); };
    if (r && !creating) {
      if (el("shot")) el("shot").onclick = function () { openCamera(r); };
      $app.querySelectorAll("[data-act]").forEach(function (b) {
        b.onclick = function () { photoAction(b.dataset.act, b.dataset.id); };
      });
      return;
    }
    if (!creating) return;
    el("presets").onclick = function (e) {
      var b = e.target.closest(".chip"); if (!b) return;
      draft.emoji = b.dataset.e; draft.que = b.dataset.q;
      el("rEmoji").value = draft.emoji; el("rQue").value = draft.que;
      [].forEach.call(this.children, function (c) { c.classList.toggle("on", c === b); });
    };
    el("rQue").oninput = function () {
      draft.que = this.value;
      [].forEach.call(el("presets").children, function (c) { c.classList.toggle("on", c.dataset.q === draft.que); });
    };
    el("rEmoji").oninput = function () { draft.emoji = this.value; };
    $app.querySelectorAll(".stepper .btn").forEach(function (b) {
      b.onclick = function () { draft.meta = Math.max(1, Math.min(100, draft.meta + Number(b.dataset.d))); el("rMeta").textContent = draft.meta; };
    });
    el("durs").onclick = function (e) {
      var b = e.target.closest(".chip"); if (!b) return;
      draft.min = Number(b.dataset.m);
      [].forEach.call(this.children, function (c) { c.classList.toggle("on", c === b); });
    };
    el("judges").onclick = function (e) {
      var b = e.target.closest(".chip"); if (!b) return;
      draft.juez = b.dataset.j;
      draft.parts = draft.parts.filter(function (x) { return x !== draft.juez; });
      render();   // actualiza la lista de participantes (el juez no compite)
    };
    el("forWho").onclick = function (e) {
      var b = e.target.closest("button"); if (!b) return;
      draft.todos = b.dataset.todos === "1";
      if (!draft.todos && !draft.parts.length && draft.juez !== me.id) draft.parts = [me.id];
      render();
    };
    el("parts").onclick = function (e) {
      var b = e.target.closest(".chip"); if (!b || b.disabled) return;
      var id = b.dataset.p, i = draft.parts.indexOf(id);
      if (i >= 0) draft.parts.splice(i, 1); else draft.parts.push(id);
      b.classList.toggle("on", i < 0);
    };
    el("launch").onclick = function () {
      if (!draft.que.trim()) { el("rQue").focus(); return toast("Escribe cuál es el reto"); }
      var hz = horario();
      if (!hz.abierto) return toast("Solo se pueden crear retos de " + hz.rango + " (hora de " + hz.zona + "). Ahora son las " + hz.ahora + ".", 5000);
      var parts = draft.parts.filter(function (x) { return x !== draft.juez; });
      if (!draft.todos && !parts.length) return toast(ERRORS.sin_participantes);
      guard(async function () {
        var nuevo = must(await db.rpc("crear_reto", {
          p_token: token, p_que: draft.que, p_emoji: draft.emoji, p_meta: draft.meta, p_minutos: draft.min,
          p_juez: draft.juez, p_para_todos: draft.todos, p_participantes: draft.todos ? null : parts
        }));
        say("¡Reto lanzado! Gana el primero en conseguir " + draft.meta + " fotos de " + draft.que);
        draft.que = ""; draft.parts = []; draft.todos = true;
        creating = false; sel = nuevo.id; justCreated = nuevo.id;
        await reload();
      });
    };
  }

  // Acciones sobre fotos: el juez acepta/elimina; los competidores marcan 👍 o 🚩
  function photoAction(act, id) {
    var f = data.fotos.filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    var u = user(f.usuario_id);
    if (act === "eliminar") {
      if (!confirm("¿Eliminar esta foto de " + u.nombre + "? Dejará de contar y no se puede deshacer.")) return;
      return guard(async function () { must(await db.rpc("juez_eliminar_foto", { p_token: token, p_foto: id })); toast("Foto eliminada"); await reload(); });
    }
    if (act === "aceptar") {
      return guard(async function () {
        var res = must(await db.rpc("juez_aceptar_foto", { p_token: token, p_foto: id }));
        toast(res.gano ? "¡" + u.nombre + " llegó a la meta y gana el reto!" : "Foto aceptada: " + u.nombre + " lleva " + res.aceptadas);
        await reload();
      });
    }
    var v = votosDe(id), tipo = v.mio === act ? null : act;   // tocar otra vez quita la marca
    guard(async function () {
      must(await db.rpc("votar_foto", { p_token: token, p_foto: id, p_tipo: tipo }));
      if (tipo === "denuncia") toast("Foto denunciada. El juez la revisará.");
      await reload();
    });
  }

  function invite() {
    var url = location.origin + location.pathname;
    var text = "¡Únete a los Retos en familia! Crea tu usuario aquí:";
    if (navigator.share) navigator.share({ title: "Retos en familia", text: text, url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text + " " + url).then(function () { toast("Enlace copiado 📋"); });
    else prompt("Comparte este enlace:", url);
  }

  // ------------------------------------------------------------ cámara en vivo
  // Las fotos solo se hacen aquí, en el momento: no hay forma de adjuntar archivos.
  var cam = { stream: null, reto: null, facing: "environment", shot: null,
              zoom: 1, maxZoom: 5, hw: null, hwApplied: 1, digital: 1, pending: false };

  // ---- zoom: usa el zoom real de la cámara si el móvil lo permite; si no, zoom digital (recorta el centro)
  function zoomTrack() { return cam.stream && cam.stream.getVideoTracks()[0]; }
  function setupZoom() {
    cam.hw = null;
    var t = zoomTrack();
    try {
      var caps = t && t.getCapabilities ? t.getCapabilities() : null;
      if (caps && caps.zoom && caps.zoom.max > caps.zoom.min) cam.hw = { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 };
    } catch (e) {}
    cam.maxZoom = cam.hw ? Math.min(10, Math.max(5, cam.hw.max)) : 5;
    el("camZoom").max = cam.maxZoom;
    [].forEach.call(el("zoomPresets").children, function (b) { b.hidden = +b.dataset.z > cam.maxZoom; });
    setZoom(1, true);
  }
  function setZoom(z, now) {
    cam.zoom = Math.max(1, Math.min(cam.maxZoom, Math.round(z * 10) / 10));
    el("camZoom").value = cam.zoom;
    el("camZoomLabel").textContent = (cam.zoom % 1 ? cam.zoom.toFixed(1) : cam.zoom) + "×";
    el("camZoomLabel").classList.toggle("show", cam.zoom > 1);
    [].forEach.call(el("zoomPresets").children, function (b) { b.classList.toggle("on", Math.abs(+b.dataset.z - cam.zoom) < 0.05); });
    if (now) applyZoom(); else if (!cam.pending) { cam.pending = true; requestAnimationFrame(applyZoom); }
  }
  function applyZoom() {
    cam.pending = false;
    var z = cam.zoom, t = zoomTrack(), hwz = 1;
    if (cam.hw && t) {
      hwz = Math.max(cam.hw.min, Math.min(cam.hw.max, z));
      if (Math.abs(hwz - cam.hwApplied) > 0.01) {
        cam.hwApplied = hwz;
        t.applyConstraints({ advanced: [{ zoom: hwz }] }).catch(function () { cam.hw = null; cam.hwApplied = 1; applyZoom(); });
      }
    } else { cam.hwApplied = 1; }
    cam.digital = Math.max(1, z / (cam.hw ? hwz : 1));
    var mirror = cam.facing === "user" ? -1 : 1;
    el("camVideo").style.transform = "scale(" + (mirror * cam.digital) + ", " + cam.digital + ")";
  }
  // Pellizcar con dos dedos para hacer zoom
  (function () {
    var start = null;
    function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
    var view = el("camView");
    view.addEventListener("touchstart", function (e) { if (e.touches.length === 2) start = { d: dist(e.touches), z: cam.zoom }; }, { passive: true });
    view.addEventListener("touchmove", function (e) {
      if (start && e.touches.length === 2) { e.preventDefault(); setZoom(start.z * dist(e.touches) / start.d); }
    }, { passive: false });
    view.addEventListener("touchend", function (e) { if (e.touches.length < 2) start = null; });
  })();
  el("camZoom").oninput = function () { setZoom(+this.value); };
  el("zoomPresets").onclick = function (e) { var b = e.target.closest("button"); if (b) setZoom(+b.dataset.z); };
  function camMsg(text) { el("camMsg").textContent = text || ""; el("camMsg").hidden = !text; }

  async function startStream() {
    if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
    cam.stream = null;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      camMsg("Este navegador no deja usar la cámara aquí. Abre el juego en Chrome o Safari desde su enlace https.");
      return;
    }
    try {
      cam.stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: { ideal: cam.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      var v = el("camVideo");
      v.srcObject = cam.stream;
      v.classList.toggle("mirror", cam.facing === "user");
      await v.play().catch(function () {});
      cam.hwApplied = 1; setupZoom();
      camMsg(""); el("camShutter").disabled = false;
    } catch (e) {
      el("camShutter").disabled = true;
      if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
        camMsg("No hay permiso para la cámara. Toca el candado junto a la dirección, permite la Cámara y vuelve a intentarlo.");
      } else if (e && (e.name === "NotFoundError" || e.name === "OverconstrainedError")) {
        camMsg("No se encontró ninguna cámara en este dispositivo.");
      } else {
        camMsg("No se pudo abrir la cámara. Cierra otras apps que la estén usando y vuelve a intentarlo.");
      }
    }
  }
  function openCamera(r) {
    if (busy) return;
    cam.reto = r; cam.shot = null;
    el("camPreview").hidden = true; el("camLive").hidden = false; el("camera").hidden = false;
    el("camTitle").textContent = r.emoji + " " + r.que_buscar;
    startStream();
  }
  function closeCamera() {
    if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
    cam.stream = null; cam.shot = null; el("camVideo").srcObject = null; el("camera").hidden = true;
  }
  function takePhoto() {
    var v = el("camVideo");
    if (!v.videoWidth) return;
    // La foto sale con el zoom de la pantalla: con zoom digital se recorta el centro.
    var d = cam.digital || 1, sw = v.videoWidth / d, sh = v.videoHeight / d;
    var sx = (v.videoWidth - sw) / 2, sy = (v.videoHeight - sh) / 2;
    var k = Math.min(1, 1280 / Math.max(sw, sh));
    var cv = document.createElement("canvas");
    cv.width = Math.round(sw * k); cv.height = Math.round(sh * k);
    var g = cv.getContext("2d");
    if (cam.facing === "user") { g.translate(cv.width, 0); g.scale(-1, 1); }
    g.drawImage(v, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    cv.toBlob(function (b) {
      if (!b) return;
      cam.shot = b; el("camImg").src = URL.createObjectURL(b);
      el("camLive").hidden = true; el("camPreview").hidden = false;
    }, "image/jpeg", 0.82);
  }
  el("camShutter").onclick = takePhoto;
  el("camFlip").onclick = function () { cam.facing = cam.facing === "environment" ? "user" : "environment"; startStream(); };
  el("camClose").onclick = closeCamera;
  el("camRetake").onclick = function () {
    if (el("camImg").src) URL.revokeObjectURL(el("camImg").src);
    cam.shot = null; el("camPreview").hidden = true; el("camLive").hidden = false;
  };
  el("camUse").onclick = function () {
    var b = cam.shot, r = cam.reto;
    if (!b || !r) return;
    closeCamera(); upload(r, b);
  };

  async function upload(r, blob) {
    if (busy) return;
    busy = true; render();
    try {
      var ruta = r.id + "/" + me.id + "/" + Date.now() + ".jpg";
      must(await db.storage.from(BUCKET).upload(ruta, blob, { contentType: "image/jpeg", upsert: false }));
      var res = must(await db.rpc("registrar_foto", { p_token: token, p_reto: r.id, p_ruta: ruta }));
      toast("📸 Foto enviada. Tienes " + res.aceptadas + " aceptada" + (res.aceptadas === 1 ? "" : "s") + "; el juez revisará la nueva.");
      say("¡Foto enviada!");
    } catch (e) {
      if (String(e && e.message).indexOf("sesion_invalida") >= 0) { busy = false; return logout(true); }
      toast(errMsg(e), 4500);
    }
    busy = false;
    await reload();
  }

  // ------------------------------------------------------------ visor de fotos
  function openViewer(id) {
    var f = data.fotos.filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    var u = user(f.usuario_id);
    el("viewerImg").src = photoUrl(f.ruta);
    el("viewerCaption").textContent = u.avatar + " " + u.nombre + " · " + (f.estado === "aceptada" ? "✅ aceptada" : "⏳ esperando al juez") + " · " + fmtDate(f.creado_en);
    el("viewerDelete").hidden = true;
    el("viewer").hidden = false;
  }
  function closeViewer() { el("viewer").hidden = true; el("viewerImg").src = ""; }
  el("viewerClose").onclick = closeViewer;
  el("viewer").onclick = function (e) { if (e.target === this) closeViewer(); };

  // ------------------------------------------------------------ celebración
  function celebrateIfNew(prev) {
    var seen = load(SEEN_KEY) || [];
    var nuevos = data.retos.filter(function (r) {
      return r.estado === "terminado" && seen.indexOf(r.id) < 0 && (compite(r, me.id) || juezDe(r) === me.id);
    }).sort(function (a, b) { return new Date(b.cerrado_en) - new Date(a.cerrado_en); });
    if (!nuevos.length) return;
    nuevos.forEach(function (r) { seen.push(r.id); });
    save(SEEN_KEY, seen.slice(-100));
    var last = nuevos[0];
    if (!prev && Date.now() - new Date(last.cerrado_en) > 6 * 3600000) return;
    var w = last.ganador_id ? user(last.ganador_id) : null;
    var mine = data.puntajes.filter(function (p) { return p.reto_id === last.id && p.usuario_id === me.id; })[0];
    var iWon = w && last.ganador_id === me.id;
    el("partyEmoji").textContent = iWon ? "🏆" : w ? w.avatar : "⏱";
    el("partyTitle").textContent = iWon ? "¡Ganaste el reto!" : w ? "¡" + w.nombre + " ganó el reto!" : "Se acabó el tiempo";
    el("partyText").textContent = last.emoji + " " + last.meta + " · " + last.que_buscar + (mine ? " · Tú: " + mine.fotos + " fotos, +" + mine.puntos + " pts" : "");
    el("toast").hidden = true;
    el("party").hidden = false;
    say(iWon ? "¡Ganaste el reto!" : w ? w.nombre + " ganó el reto" : "Se acabó el tiempo");
    if (w) confetti();
  }
  el("partyClose").onclick = function () { el("party").hidden = true; };
  function confetti() {
    var bits = ["#ff5a36", "#111827", "#22c55e", "#f5b700", "#3b82f6", "#ff5a36"];
    for (var i = 0; i < 26; i++) {
      var s = document.createElement("span");
      s.className = "confetti"; s.style.background = bits[i % bits.length];
      s.style.left = Math.random() * 100 + "vw"; s.style.animationDelay = Math.random() * 0.8 + "s";
      document.body.appendChild(s);
      setTimeout(function (n) { n.remove(); }.bind(null, s), 3500);
    }
  }

  // ============================================================ PODIO (campeonatos)
  function retosDeCamp(c) {
    var ids = data.campeonatoRetos.filter(function (x) { return x.campeonato_id === c.id; }).map(function (x) { return x.reto_id; });
    return data.retos.filter(function (r) { return ids.indexOf(r.id) >= 0; })
      .sort(function (a, b) { return new Date(a.inicia_en) - new Date(b.inicia_en); });
  }
  // Suma los puntos de los retos del campeonato. Desempate: más retos ganados, luego más fotos aceptadas.
  function tabla(c) {
    var retos = retosDeCamp(c), ids = retos.map(function (r) { return r.id; }), filas = {};
    data.puntajes.forEach(function (p) {
      if (ids.indexOf(p.reto_id) < 0) return;
      var f = filas[p.usuario_id] || (filas[p.usuario_id] = { id: p.usuario_id, pts: 0, wins: 0, fotos: 0, por: {} });
      f.pts += p.puntos; f.fotos += p.fotos; if (p.puesto === 1) f.wins++;
      f.por[p.reto_id] = p.puntos;
    });
    var lista = Object.keys(filas).map(function (k) { return filas[k]; })
      .filter(function (f) { return data.usuarios.some(function (u) { return u.id === f.id; }); })
      .sort(function (a, b) { return b.pts - a.pts || b.wins - a.wins || b.fotos - a.fotos; });
    var puesto = 0;
    lista.forEach(function (f, i) {
      var prev = lista[i - 1];
      if (!prev || prev.pts !== f.pts || prev.wins !== f.wins || prev.fotos !== f.fotos) puesto = i + 1;
      f.puesto = puesto;
    });
    var terminados = retos.filter(function (r) { return r.estado !== "activo"; }).length;
    var lideres = lista.filter(function (f) { return f.puesto === 1; });
    return { retos: retos, filas: lista, lideres: lideres, terminados: terminados, final: retos.length > 0 && terminados === retos.length };
  }

  function pts(n) { return n + (n === 1 ? " pt" : " pts"); }
  function listaNombres(fs) {
    var n = fs.map(function (f) { return user(f.id).nombre; });
    return n.length > 1 ? n.slice(0, -1).join(", ") + " y " + n[n.length - 1] : n[0];
  }
  function textoPodio(c, t) {
    var med = ["🥇", "🥈", "🥉"];
    return "🏆 *" + c.nombre + "*\n" + (t.final ? "¡Campeonato terminado!" : "Retos terminados: " + t.terminados + " de " + t.retos.length) + "\n\n" +
      (t.filas.length ? t.filas.slice(0, 10).map(function (f) {
        return (med[f.puesto - 1] || f.puesto + ".") + " " + user(f.id).nombre + " · " + pts(f.pts);
      }).join("\n") : "Todavía no hay puntos.") +
      (t.final && t.lideres.length === 1 ? "\n\n👑 Campeón: *" + user(t.lideres[0].id).nombre + "*" : "") +
      (t.final && t.lideres.length > 1 ? "\n\n👑 Empate en el primer puesto: *" + listaNombres(t.lideres) + "*" : "") +
      "\n\nVer el podio 👇\n" + location.origin + location.pathname;
  }

  function renderPodio() {
    if (!data.campeonatos.length) {
      $app.innerHTML = '<section class="card empty-state"><h2>Podio</h2><p class="sub">Todavía no hay campeonatos. ' +
        'El administrador puede crear uno juntando varios retos: sus puntos se suman y sale un campeón.</p></section>';
      return;
    }
    $app.innerHTML = data.campeonatos.map(function (c) {
      var t = tabla(c), top = t.filas.slice(0, 3);
      var podium = top.length ? '<div class="podium">' + [1, 0, 2].map(function (i) {
        var f = top[i]; if (!f) return '<div class="step empty"></div>';
        var u = user(f.id);
        return '<div class="step p' + f.puesto + '"><div class="step-av">' + esc(u.avatar) + '</div>' +
          '<div class="step-name">' + esc(u.nombre) + '</div><div class="step-pts">' + pts(f.pts) + '</div>' +
          '<div class="step-block">' + f.puesto + '</div></div>';
      }).join("") + '</div>' : '<p class="hint">Todavía no hay puntos: ningún reto del campeonato ha terminado.</p>';
      var champ = t.final && t.lideres.length === 1 ? user(t.lideres[0].id) : null;
      var empate = t.final && t.lideres.length > 1;
      return '<section class="card camp">' +
        '<div class="tag ' + (t.final ? "done" : "live") + '">' + (t.final ? "Terminado" : "En juego") + '</div>' +
        '<h2>' + esc(c.nombre) + '</h2>' +
        '<p class="sub">' + t.terminados + ' de ' + t.retos.length + ' retos terminados</p>' +
        (champ ? '<div class="champion">👑 Campeón: <b>' + esc(champ.avatar + " " + champ.nombre) + '</b></div>'
         : empate ? '<div class="champion">👑 Empate en el primer puesto: <b>' + esc(listaNombres(t.lideres)) + '</b>' +
                    '<small>Tienen los mismos puntos, retos ganados y fotos aceptadas. El administrador puede añadir un reto de desempate al campeonato.</small></div>'
         : (t.filas.length ? '<div class="leader">Va ganando: <b>' + esc(listaNombres(t.lideres)) + '</b></div>' : "")) +
        podium +
        (t.filas.length ? '<div class="table-wrap"><table class="standings"><thead><tr><th>#</th><th>Jugador</th>' +
          t.retos.map(function (r, i) { return '<th title="' + esc(r.que_buscar) + '">R' + (i + 1) + '</th>'; }).join("") +
          '<th>Total</th></tr></thead><tbody>' +
          t.filas.map(function (f) {
            var u = user(f.id);
            return '<tr' + (me && f.id === me.id ? ' class="is-me"' : "") + '><td>' + f.puesto + '</td><td class="pl">' + esc(u.avatar + " " + u.nombre) + '</td>' +
              t.retos.map(function (r) { return '<td>' + (r.id in f.por ? f.por[r.id] : (r.estado === "activo" ? "·" : "–")) + '</td>'; }).join("") +
              '<td class="tot">' + f.pts + '</td></tr>';
          }).join("") + '</tbody></table></div>' : "") +
        '<ul class="camp-retos">' + t.retos.map(function (r, i) {
          var w = r.ganador_id ? user(r.ganador_id) : null;
          return '<li><button class="hist-item" data-reto="' + r.id + '"><span><b>R' + (i + 1) + '</b> ' + esc(r.emoji + " " + r.que_buscar) +
            '<small>' + fmtDate(r.inicia_en) + '</small></span><span>' +
            (r.estado === "activo" ? "En marcha" : r.estado === "cancelado" ? "Cancelado" : w ? "Ganó " + esc(w.nombre) : "Sin ganador") + ' ›</span></button></li>';
        }).join("") + '</ul>' +
        '<p class="hint">Cada reto da 3, 2 y 1 puntos a los tres primeros. Empate: gana quien tenga más retos ganados y luego más fotos aceptadas.</p>' +
        waButton(textoPodio(c, t), "Compartir podio por WhatsApp", "wide ghost-wa") +
        '</section>';
    }).join("");
    $app.querySelectorAll("[data-reto]").forEach(function (b) {
      b.onclick = function () { view = "retos"; sel = b.dataset.reto; creating = false; reload(); render(); window.scrollTo(0, 0); };
    });
  }

  // ============================================================ MÓDULO ADMINISTRADOR
  function renderAdminLogin() {
    if (!me) stopLive();
    $app.innerHTML =
      '<section class="card admin"><div class="tag admin-tag">Administrador</div>' +
      '<h2>Entrar al módulo de administrador</h2>' +
      '<p class="sub">Desde aquí se eliminan usuarios y retos y se restablecen claves.</p>' +
      '<form id="admForm" class="stack-form">' +
      '<input id="admPass" type="password" autocomplete="off" placeholder="Clave de administrador" required>' +
      '<button class="btn primary wide">Entrar</button></form>' +
      (me ? "" : '<button class="btn ghost wide" id="admBack">← Volver</button>') + '</section>';
    el("admPass").focus();
    if (el("admBack")) el("admBack").onclick = exitAdmin;
    el("admForm").onsubmit = function (e) {
      e.preventDefault();
      var clave = el("admPass").value;
      guard(async function () {
        must(await db.rpc("admin_entrar", { p_clave: clave }));
        adminClave = clave; view = "admin";
        if (me && data) render(); else { data = null; render(); await reload(); startLive(); }
        if (clave === "1234") toast("Recuerda cambiar la clave 1234 por una propia (abajo del todo).", 5000);
      });
    };
  }

  function renderAdmin() {
    var pts = {};
    data.puntajes.forEach(function (p) { pts[p.usuario_id] = (pts[p.usuario_id] || 0) + p.puntos; });
    $app.innerHTML =
      '<section class="card admin"><div class="tag admin-tag">Panel de administrador</div>' +
      '<h2>Retos</h2>' +
      '<p class="hint">Eliminar un reto lo borra con sus fotos y sus puntos (también si está en marcha).</p>' +
      (data.retos.length ? '<ul class="admin-list">' + data.retos.map(function (r) {
        return '<li><div class="admin-info"><b>' + esc(r.emoji) + " " + r.meta + " · " + esc(r.que_buscar) + '</b>' +
          '<small>' + ESTADOS[r.estado] + " · " + fmtDate(r.inicia_en) + " · " + esc(user(r.creado_por).nombre) + '</small></div>' +
          '<div class="admin-actions">' +
          '<button class="btn small danger" data-act="del-reto" data-id="' + r.id + '">Eliminar</button></div></li>';
      }).join("") + '</ul>' : '<p class="hint">No hay retos.</p>') +
      '</section>' +
      '<section class="card admin"><h2>Usuarios (' + data.usuarios.length + ')</h2>' +
      '<p class="hint">Eliminar un usuario borra también sus fotos y sus puntos.</p>' +
      (data.usuarios.length ? '<ul class="admin-list">' + data.usuarios.map(function (u) {
        return '<li><div class="admin-info"><b>' + esc(u.avatar + " " + u.nombre) + '</b>' +
          '<small>@' + esc(u.usuario) + " · " + (pts[u.id] || 0) + " pts · desde " + fmtDate(u.creado_en) + '</small></div>' +
          '<div class="admin-actions">' +
          '<button class="btn small" data-act="reset" data-id="' + u.id + '">Clave</button>' +
          '<button class="btn small danger" data-act="del-user" data-id="' + u.id + '">Eliminar</button></div></li>';
      }).join("") + '</ul>' : '<p class="hint">Todavía no hay usuarios.</p>') +
      '</section>' +
      renderReglasAdmin() +
      renderCampAdmin() +
      '<section class="card admin"><h2>Clave de administrador</h2>' +
      '<form id="admNewForm" class="row"><input id="admNew" type="password" autocomplete="new-password" placeholder="Nueva clave" required>' +
      '<button class="btn">Cambiar</button></form></section>' +
      '<button class="btn primary wide" id="admExit">Salir del administrador</button>';

    $app.querySelectorAll("[data-act]").forEach(function (b) { b.onclick = function () { adminAction(b.dataset.act, b.dataset.id); }; });
    el("admExit").onclick = exitAdmin;
    bindCampAdmin();
    bindReglasAdmin();
    el("admNewForm").onsubmit = function (e) {
      e.preventDefault();
      var nueva = el("admNew").value;
      guard(async function () {
        must(await db.rpc("admin_cambiar_clave", { p_clave: adminClave, p_nueva: nueva }));
        adminClave = nueva; toast("Clave de administrador cambiada"); el("admNewForm").reset();
      });
    };
  }

  function renderReglasAdmin() {
    var rg = data.reglas;
    if (!rg) return "";
    var movil = ""; try { movil = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
    var zonas = ZONAS.slice();
    [rg.zona_horaria, movil].forEach(function (z) { if (z && !zonas.some(function (x) { return x[0] === z; })) zonas.push([z, z]); });
    var horas = function (id, val, from, to) {
      var o = ""; for (var h = from; h <= to; h++) o += '<option value="' + h + '"' + (h === val ? " selected" : "") + '>' + pad2(h) + ':00' + '</option>';
      return '<select id="' + id + '">' + o + '</select>';
    };
    var hz = horario();
    return '<section class="card admin"><h2>Reglas</h2>' +
      '<p class="hint">Horario en el que se pueden crear retos. Fuera de este horario el botón «Crear reto» se bloquea; los retos en marcha no se ven afectados.</p>' +
      '<form id="reglasForm" class="stack-form">' +
      '<div class="row hours"><label>Desde' + horas("rgIni", rg.hora_inicio, 0, 23) + '</label><label>Hasta' + horas("rgFin", rg.hora_fin, 1, 24) + '</label></div>' +
      '<label class="label" for="rgZona">Zona horaria</label>' +
      '<select id="rgZona">' + zonas.map(function (z) { return '<option value="' + esc(z[0]) + '"' + (z[0] === rg.zona_horaria ? " selected" : "") + '>' + esc(z[1]) + '</option>'; }).join("") + '</select>' +
      (movil && movil !== rg.zona_horaria ? '<button type="button" class="btn small ghost" id="rgMovil" data-z="' + esc(movil) + '">Usar la hora de este móvil (' + esc(nombreZona(movil)) + ')</button>' : "") +
      '<p class="hint">Ahora mismo son las <b>' + hz.ahora + '</b> en ' + esc(hz.zona) + ': ' + (hz.abierto ? "se pueden crear retos." : "no se pueden crear retos.") + '</p>' +
      '<button class="btn primary wide">Guardar reglas</button></form></section>';
  }

  function bindReglasAdmin() {
    if (!el("reglasForm")) return;
    if (el("rgMovil")) el("rgMovil").onclick = function () { el("rgZona").value = this.dataset.z; };
    el("reglasForm").onsubmit = function (e) {
      e.preventDefault();
      var ini = +el("rgIni").value, fin = +el("rgFin").value, zona = el("rgZona").value;
      if (ini >= fin) return toast(ERRORS.horario_invalido);
      guard(async function () {
        var rg = must(await db.rpc("admin_guardar_reglas", { p_clave: adminClave, p_inicio: ini, p_fin: fin, p_zona: zona }));
        data.reglas = rg;
        toast("Reglas guardadas: retos de " + pad2(ini) + ":00 a " + pad2(fin) + ":00 (hora de " + nombreZona(zona) + ")", 4500);
        renderAdmin();
      });
    };
  }

  function renderCampAdmin() {
    var f = campForm;
    var html = '<section class="card admin" id="campSection"><h2>Campeonatos</h2>' +
      '<p class="hint">Junta varios retos en un campeonato: se suman sus puntos y sale un podio con su campeón (pestaña Podio).</p>';
    if (f) {
      html += '<form id="campForm" class="stack-form camp-form">' +
        '<label class="label" for="campName">' + (f.id ? "Editar campeonato" : "Nuevo campeonato") + '</label>' +
        '<input id="campName" maxlength="60" placeholder="Ej: Campeonato de noviembre" required value="' + esc(f.nombre) + '">' +
        '<p class="label">Retos que suman puntos</p>' +
        (data.retos.length ? '<ul class="check-list" id="campRetos">' + data.retos.map(function (r) {
          var on = f.retos.indexOf(r.id) >= 0;
          var n = r.para_todos !== false ? "todos" : competidores(r).length + " participantes";
          return '<li><label class="check' + (on ? " on" : "") + '"><input type="checkbox" value="' + r.id + '"' + (on ? " checked" : "") + '>' +
            '<span><b>' + esc(r.emoji + " " + r.que_buscar) + '</b><small>' + ESTADOS[r.estado] + ' · ' + fmtDate(r.inicia_en) + ' · ' + n + '</small></span></label></li>';
        }).join("") + '</ul>' : '<p class="hint">Todavía no hay retos.</p>') +
        '<div class="row"><button type="button" class="btn ghost" id="campCancel">Cancelar</button>' +
        '<button class="btn primary">' + (f.id ? "Guardar cambios" : "Crear campeonato") + '</button></div></form>';
    } else {
      html += (data.campeonatos.length ? '<ul class="admin-list">' + data.campeonatos.map(function (c) {
        var t = tabla(c);
        return '<li><div class="admin-info"><b>' + esc(c.nombre) + '</b><small>' + t.retos.length + ' retos · ' +
          (t.final ? "terminado" : t.terminados + " terminados") + '</small></div><div class="admin-actions">' +
          '<button class="btn small" data-camp="edit" data-id="' + c.id + '">Editar</button>' +
          '<button class="btn small danger" data-camp="del" data-id="' + c.id + '">Eliminar</button></div></li>';
      }).join("") + '</ul>' : "") +
      '<button class="btn wide" id="campNew">+ Crear campeonato</button>';
    }
    return html + '</section>';
  }

  function bindCampAdmin() {
    if (el("campNew")) el("campNew").onclick = function () { campForm = { id: null, nombre: "", retos: [] }; renderAdmin(); el("campSection").scrollIntoView(); el("campName").focus(); };
    $app.querySelectorAll("[data-camp]").forEach(function (b) {
      b.onclick = function () {
        var c = data.campeonatos.filter(function (x) { return x.id === b.dataset.id; })[0];
        if (!c) return;
        if (b.dataset.camp === "edit") {
          campForm = { id: c.id, nombre: c.nombre, retos: retosDeCamp(c).map(function (r) { return r.id; }) };
          renderAdmin(); el("campSection").scrollIntoView(); return;
        }
        if (!confirm("¿Eliminar el campeonato «" + c.nombre + "»? Los retos no se borran.")) return;
        guard(async function () {
          must(await db.rpc("admin_eliminar_campeonato", { p_clave: adminClave, p_id: c.id }));
          toast("Campeonato eliminado"); await reload();
        });
      };
    });
    if (!el("campForm")) return;
    el("campName").oninput = function () { campForm.nombre = this.value; };
    if (el("campRetos")) el("campRetos").onchange = function (e) {
      var cb = e.target; if (cb.type !== "checkbox") return;
      var i = campForm.retos.indexOf(cb.value);
      if (cb.checked && i < 0) campForm.retos.push(cb.value);
      if (!cb.checked && i >= 0) campForm.retos.splice(i, 1);
      cb.closest(".check").classList.toggle("on", cb.checked);
    };
    el("campCancel").onclick = function () { campForm = null; renderAdmin(); };
    el("campForm").onsubmit = function (e) {
      e.preventDefault();
      if (!campForm.retos.length) return toast(ERRORS.campeonato_sin_retos);
      guard(async function () {
        must(await db.rpc("admin_guardar_campeonato", { p_clave: adminClave, p_id: campForm.id, p_nombre: campForm.nombre, p_retos: campForm.retos }));
        toast(campForm.id ? "Campeonato guardado" : "Campeonato creado");
        campForm = null; await reload(); renderAdmin();
      });
    };
  }

  function adminAction(act, id) {
    var base = { p_clave: adminClave };
    if (act === "del-user" || act === "reset") {
      var u = user(id);
      if (act === "reset") {
        var nueva = prompt("Nueva clave para @" + u.usuario + " (mínimo 4 caracteres):");
        if (!nueva) return;
        return guard(async function () {
          must(await db.rpc("admin_restablecer_clave", Object.assign(base, { p_usuario: id, p_nueva: nueva })));
          toast("Clave de @" + u.usuario + " cambiada. Ya puede entrar con la nueva.");
        });
      }
      if (!confirm("¿Eliminar el usuario @" + u.usuario + " (" + u.nombre + ")? Se borrarán sus fotos y sus puntos. No se puede deshacer.")) return;
      return guard(async function () {
        must(await db.rpc("admin_eliminar_usuario", Object.assign(base, { p_usuario: id })));
        toast("Usuario eliminado"); await reload();
      });
    }
    var r = data.retos.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var name = r.meta + " · " + r.que_buscar;
    if (!confirm("¿Eliminar el reto «" + name + "»? Se borrarán sus fotos y sus puntos. No se puede deshacer.")) return;
    guard(async function () {
      must(await db.rpc("admin_eliminar_reto", Object.assign(base, { p_reto: id })));
      toast("Reto eliminado"); await reload();
    });
  }

  function exitAdmin() {
    adminClave = null; campForm = null;
    if (me) { view = "retos"; render(); } else { stopLive(); view = "login"; render(); }
  }

  start();
})();
