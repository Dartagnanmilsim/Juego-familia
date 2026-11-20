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
  var ESTADOS = { propuesto: "En votación", programado: "Programado", activo: "En marcha", terminado: "Terminado", cancelado: "Cancelado" };
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
    falta_motivo: "Escribe o elige el motivo.",
    estas_preso: "🚔 Estás en el calabozo: no puedes hacer eso hasta que salgas.",
    condena_invalida: "Elige una condena válida.",
    solo_quien_encarcelo: "Solo puede liberarlo quien lo encarceló o el administrador.",
    solo_el_preso: "Solo el preso puede pedir su votación.",
    ya_libre: "Ya está libre.",
    ya_pediste_votacion: "Ya pediste la votación del pueblo para esta condena.",
    votacion_cerrada: "La votación ya está cerrada.",
    no_puedes_votarte: "No puedes votar en tu propia votación.",
    pocos_participantes: "Elige al menos 2 participantes.",
    fechas_invalidas: "Revisa las fechas: el fin no puede ser antes del inicio.",
    premio_invalido: "Escribe el premio del campeón (hasta 100 caracteres).",
    torneo_terminado: "Este torneo ya terminó.",
    torneo_sin_dias: "Ya no quedan días libres en el torneo para este reto (1 reto por día hasta la fecha de fin).",
    torneo_no_existe: "Ese torneo ya no existe.",
    no_eres_del_torneo: "No eres participante de este torneo.",
    juez_no_es_del_torneo: "El juez tiene que ser participante del torneo.",
    ya_tienes_reto_en_torneo: "Ya tienes tu reto en este torneo (solo 1 por participante).",
    ya_tienes_propuesta: "Ya tienes una propuesta en votación en este torneo.",
    no_votas_tu_reto: "No puedes votar tu propio reto.",
    meta_invalida: "Elige cuántas fotos hacen falta (1 a 100).",
    reto_invalido: "Escribe cuál es el reto.",
    el_juez_no_vota: "Quien te encarceló no puede votar.",
    motivo_largo: "El motivo puede tener como máximo 200 caracteres.",
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
  var campForm = null;           // formulario de torneo del administrador: { id, nombre, parts: [] }
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
    el("barTitle").textContent = { retos: "Retos", podio: "Torneos", usuarios: "Usuarios", admin: "Administrador", "admin-login": "Administrador" }[view] || "Retos en familia";
    el("barSub").hidden = !logged;
    el("barSub").textContent = logged ? "@" + me.usuario : "";
    el("meBtn").hidden = !logged;
    if (logged) { el("meBtn").textContent = me.avatar; el("meBtn").classList.toggle("jailed-btn", !!(data && presoDe(me.id))); }
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
        return '<li' + (u.id === me.id ? ' class="is-me"' : "") + '><div class="admin-info"><b>' + esc(u.avatar) + " " + esc(u.nombre) + (u.id === me.id ? " (tú)" : "") +
          (condenasDe(u.id).length ? ' <span class="jail-tag">⛓️ preso en ' + condenasDe(u.id).map(function (pz) { return esc(nombreReto(pz.reto_id)); }).join(", ") + '</span>' : "") + '</b>' +
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
        db.from("campeonato_retos").select("*"),
        db.from("presos").select("*").order("desde", { ascending: false }).limit(300),
        db.from("votos_presos").select("*"),
        db.from("torneos").select("*").order("creado_en", { ascending: false }),
        db.from("torneo_participantes").select("*"),
        db.from("votos_retos").select("*")
      ]);
      var next = { usuarios: must(r[0]), retos: must(r[1]), puntajes: must(r[2]), participantes: must(r[3]),
        campeonatos: must(r[4]), campeonatoRetos: must(r[5]),
        presos: r[6].error ? [] : r[6].data, votosPresos: r[7].error ? [] : r[7].data,
        torneos: r[8].error ? [] : r[8].data, torneoParts: r[9].error ? [] : r[9].data, votosRetos: r[10].error ? [] : r[10].data,
        fotos: [], votos: [], reglas: null };
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
    ["usuarios", "retos", "fotos", "puntajes", "votos", "participantes", "campeonatos", "campeonato_retos", "presos", "votos_presos", "torneos", "torneo_participantes", "votos_retos"].forEach(function (t) {
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
    $app.querySelectorAll("[data-cierra]").forEach(function (c) {
      var left = new Date(c.dataset.cierra) - Date.now();
      c.textContent = left > 0 ? fmtLeft(left) : "cerrada";
      if (left <= 0 && left > -3000) vencido = true;
    });
    $app.querySelectorAll("[data-preso]").forEach(function (c) {
      var left = new Date(c.dataset.preso) - Date.now();
      c.textContent = left > 0 ? fmtLeft(left) : "¡libre!";
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
    var v = { acepta: 0, denuncia: 0, mio: null, miMotivo: "", denuncias: [] };
    data.votos.forEach(function (x) {
      if (x.foto_id !== fotoId) return;
      v[x.tipo]++;
      if (x.tipo === "denuncia") v.denuncias.push(x);
      if (me && x.usuario_id === me.id) { v.mio = x.tipo; v.miMotivo = x.motivo || ""; }
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
    else if (r) html = '<button class="btn ghost back-btn" id="backList">← ' + (desdeTorneo ? "Volver al torneo" : "Todos los retos") + '</button>' +
      (r.estado === "activo" ? renderActive(r) : r.estado === "propuesto" || r.estado === "programado" ? renderPendiente(r) : renderFinished(r));
    else html = renderList() + renderRanking() + renderHistory();
    $app.innerHTML = html;
    bindGame(r);
    updateClock();
  }

  // ------------------------------------------------------------ ficha (configuración) de un reto
  var desdeTorneo = false;   // se abrió el reto desde la pestaña Torneos
  function duracionTxt(r) {
    var min = r.duracion_min || Math.round((new Date(r.termina_en) - new Date(r.inicia_en)) / 60000);
    var d = DURATIONS.filter(function (x) { return x.min === min; })[0];
    if (d) return d.label;
    if (min % 1440 === 0) return (min / 1440) + " días";
    if (min % 60 === 0) return (min / 60) + " horas";
    return min + " min";
  }
  function nombres(ids) {
    return ids.map(function (id) { var u = user(id); return '<span class="ficha-chip">' + esc(u.avatar + " " + u.nombre) + '</span>'; }).join("");
  }
  function fichaReto(r, abierta) {
    var juez = user(juezDe(r)), votos = votosDeReto(r.id).slice().sort(function (a, b) { return new Date(a.creado_en) - new Date(b.creado_en); });
    var comp = competidores(r).map(function (u) { return u.id; });
    var horario = r.estado === "propuesto"
      ? '<span class="muted">Se fija cuando tenga ' + VOTOS_TORNEO + ' votos</span>'
      : 'Desde <b>' + fmtDate(r.inicia_en) + '</b><br>hasta <b>' + fmtDate(r.termina_en) + '</b>' +
        (r.cerrado_en && new Date(r.cerrado_en) < new Date(r.termina_en) - 60000 ? '<br><small>Terminó antes, el ' + fmtDate(r.cerrado_en) + (r.motivo === "meta" ? " (alguien llegó a la meta)" : "") + '</small>' : "");
    var filas = [
      r.torneo_id ? ["🏆 Torneo", esc(nombreTorneo(r.torneo_id))] : null,
      ["🎯 Reto", r.meta + " fotos aceptadas de " + esc(r.que_buscar)],
      ["✍️ " + (r.torneo_id ? "Lo propuso" : "Lo creó"), esc(user(r.creado_por).avatar + " " + user(r.creado_por).nombre)],
      ["⚖️ Juez", esc(juez.avatar + " " + juez.nombre)],
      ["⏱️ Duración", duracionTxt(r)],
      ["🕒 Horario", horario],
      r.torneo_id ? ["🗳️ Votos a favor", (votos.length ? votos.length + " / " + VOTOS_TORNEO + '<div class="ficha-chips">' + nombres(votos.map(function (v) { return v.usuario_id; })) + '</div>'
        : '<span class="muted">Ninguno todavía</span>')] : null,
      ["👥 Compiten (" + comp.length + ")", '<div class="ficha-chips">' + nombres(comp) + '</div>']
    ].filter(Boolean);
    return '<details class="ficha"' + (abierta ? " open" : "") + '><summary>⚙️ Configuración del reto</summary><dl>' +
      filas.map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>'; }).join("") + '</dl></details>';
  }
  function renderPendiente(r) {   // reto de torneo en votación o programado
    var vs = votosDeReto(r.id).length;
    return '<section class="card">' +
      '<div class="tag' + (r.estado === "programado" ? " live" : "") + '">' + ESTADOS[r.estado] + '</div>' +
      '<div class="big-emoji">' + esc(r.emoji) + '</div>' +
      '<h2>' + r.meta + ' fotos de: ' + esc(r.que_buscar) + '</h2>' +
      '<p class="sub">' + (r.estado === "programado" ? "Aprobado. Empieza el <b>" + fmtDate(r.inicia_en) + "</b>."
        : "En votación: " + vs + " / " + VOTOS_TORNEO + ' votos. Se elimina en <span data-cierra="' + r.propuesta_expira + '"></span> si no llega.') + '</p>' +
      fichaReto(r, true) + '</section>';
  }

  function rolBadge(r) {
    if (presoDe(me.id, r.id)) return '<span class="role jail">⛓️ Preso en este reto</span>';
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
    return misCondenas() + (hz.abierto
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
          (r.torneo_id ? '<small class="torneo-tag">🏆 ' + esc(nombreTorneo(r.torneo_id)) + '</small>' : "") +
          '<small>Juez ' + esc(user(juezDe(r)).nombre) + ' · ' + esc(quien) + ' · <span data-left="' + r.id + '"></span></small>' +
          rolBadge(r) +
          (compite(r, me.id) ? '<small>Tus fotos aceptadas: <b>' + mine.ok + '/' + r.meta + '</b>' + (mine.pend ? " · " + mine.pend + " esperando" : "") + '</small>' : "") +
          (juezDe(r) === me.id && pend ? '<small class="to-review">' + pend + ' foto' + (pend === 1 ? "" : "s") + ' por revisar</small>' : "") +
          '</span><span class="reto-go">›</span></button></li>';
      }).join("") + '</ul>' : '<p class="hint">No hay retos en marcha.' + (hz.abierto ? ' ¡Crea uno!' : '') + '</p>') +
      '</section>' + avisoPropuestas() + renderCalabozo();
  }

  function renderActive(r) {
    var c = counts(r.id), juez = user(juezDe(r)), soyJuez = juezDe(r) === me.id, participo = compite(r, me.id);
    RETO_CTX = r.id;
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
    } else if (participo && presoDe(me.id, r.id)) {
      accion = '<div class="mine"><b>' + mine.ok + '</b> / ' + r.meta + '<small>tus fotos aceptadas</small></div>' +
        '<div class="confiscada">📷🔒 <b>Cámara confiscada en este reto</b><small>Podrás volver a hacer fotos aquí en <span data-preso="' + presoDe(me.id, r.id).hasta + '"></span>. En los demás retos juegas normal.</small></div>';
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
    return aviso + (presoDe(me.id, r.id) ? carcelBanner(presoDe(me.id, r.id)) : "") + '<section class="card active">' +
      '<div class="tag live">En marcha</div>' +
      '<div class="big-emoji">' + esc(r.emoji) + '</div>' +
      '<h2>Gana el primero en conseguir <span class="goal">' + r.meta + ' fotos aceptadas</span> de: <span class="goal">' + esc(r.que_buscar) + '</span></h2>' +
      '<p class="sub">' + (r.torneo_id ? '🏆 Torneo <b>' + esc(nombreTorneo(r.torneo_id)) + '</b><br>' : "") +
      'Juez: <b>' + esc(juez.avatar + " " + juez.nombre) + '</b> · lo creó ' + esc(user(r.creado_por).nombre) + '<br>' +
      (r.para_todos !== false ? "Para todos" : "Solo para: " + esc(lista.map(function (u) { return u.nombre; }).join(", "))) + '</p>' +
      '<div class="clock-wrap"><span data-left="' + r.id + '"></span></div>' +
      accion +
      '<ul class="race">' + lista.map(function (u) {
        var x = c[u.id] || { ok: 0, pend: 0 }, pct = Math.min(100, Math.round(x.ok / r.meta * 100));
        return '<li' + (u.id === me.id ? ' class="is-me"' : "") + '>' +
          '<span class="who">' + avh(u, RETO_CTX) + " " + esc(u.nombre) + (RETO_CTX && presoDe(u.id, RETO_CTX) ? ' <span class="jail-tag">⛓️ preso</span>' : "") + '</span>' +
          '<span class="track"><i style="width:' + pct + '%"></i></span>' +
          '<span class="n">' + x.ok + "/" + r.meta + (x.pend ? ' <small>+' + x.pend + ' pend.</small>' : "") +
          (soyJuez && !presoDe(u.id, r.id) ? ' <button class="jail-btn" data-jail="' + u.id + '" title="Mandar al calabozo" aria-label="Mandar al calabozo a ' + esc(u.nombre) + '">🚔</button>' : "") + '</span></li>';
      }).join("") + '</ul>' +
      fichaReto(r, false) +
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
      fichaReto(r, !!r.torneo_id) +
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
    } else if (participo && !mia && !presoDe(me.id, r.id)) {
      acciones = '<button class="btn small vote' + (v.mio === "acepta" ? " on" : "") + '" data-act="acepta" data-id="' + f.id + '">Válida</button>' +
        '<button class="btn small vote report' + (v.mio === "denuncia" ? " on" : "") + '" data-act="denuncia" data-id="' + f.id + '">' + (v.mio === "denuncia" ? "Denunciada · cambiar" : "Denunciar") + '</button>';
    }
    return '<li class="photo-item' + (v.denuncia ? " reported" : "") + '">' +
      '<button class="ph" data-id="' + f.id + '"><img loading="lazy" alt="" src="' + esc(photoUrl(f.ruta)) + '"></button>' +
      '<div class="photo-info"><b>' + avh(u, f.reto_id) + " " + esc(u.nombre) + (mia ? " (tú)" : "") + '</b>' +
      '<span class="badge ' + (ok ? "ok" : "pend") + '">' + (ok ? "Aceptada" : "Pendiente") + '</span>' +
      '<small>' + v.acepta + ' a favor · ' + v.denuncia + ' denuncia' + (v.denuncia === 1 ? "" : "s") + ' · ' + fmtDate(f.creado_en) + '</small>' +
      (v.denuncias.length ? '<ul class="reports">' + v.denuncias.map(function (x) {
        var q = user(x.usuario_id);
        return '<li><b>' + esc(q.avatar + " " + q.nombre) + (me && x.usuario_id === me.id ? " (tú)" : "") + ':</b> ' +
          (x.motivo ? esc(x.motivo) : '<span class="muted">Sin motivo (denuncia anterior)</span>') + '</li>';
      }).join("") + '</ul>' : "") +
      (acciones ? '<div class="photo-actions">' + acciones + '</div>' : "") + '</div></li>';
  }

  function thumb(f) {
    var u = user(f.usuario_id);
    return '<button class="ph" data-id="' + f.id + '"><img loading="lazy" alt="" src="' + esc(photoUrl(f.ruta)) + '"><span>' + esc(u.avatar) + '</span></button>';
  }

  function renderNewForm() {
    var tor = draft.torneo && torneoById(draft.torneo);
    var jueces = tor ? partsDe(tor.id).map(user) : data.usuarios;
    if (!draft.juez || !jueces.some(function (u) { return u.id === draft.juez; })) draft.juez = me.id;
    return '<button class="btn ghost back-btn" id="backList">← ' + (tor ? "Volver al torneo" : "Volver a los retos") + '</button>' +
      '<section class="card">' +
      (tor ? '<h2>Proponer mi reto</h2><p class="sub">🏆 Torneo <b>' + esc(tor.nombre) + '</b>. Tu reto necesita ' + VOTOS_TORNEO +
        ' votos a favor de otros participantes en 24 horas para empezar. Solo puedes tener 1 reto en el torneo.</p>' : '<h2>Nuevo reto</h2>') +
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
      '<div class="chips" id="judges">' + jueces.map(function (u) {
        return '<button type="button" class="chip' + (u.id === draft.juez ? " on" : "") + '" data-j="' + u.id + '">' + esc(u.avatar + " " + u.nombre) + (u.id === me.id ? " (yo)" : "") + '</button>';
      }).join("") + '</div>' +
      (tor ? '<p class="label">Participantes</p><p class="hint">Compiten todos los participantes del torneo menos el juez.</p>' :
      '<p class="label">Participantes</p>' +
      '<div class="seg" id="forWho"><button type="button" data-todos="1" class="' + (draft.todos ? "on" : "") + '">Para todos</button>' +
      '<button type="button" data-todos="0" class="' + (draft.todos ? "" : "on") + '">Solo para algunos</button></div>' +
      '<div id="partsBox"' + (draft.todos ? " hidden" : "") + '><p class="hint">Toca a los que participan (el juez no compite):</p>' +
      '<div class="chips" id="parts">' + data.usuarios.map(function (u) {
        var esJuez = u.id === draft.juez;
        return '<button type="button" class="chip' + (draft.parts.indexOf(u.id) >= 0 && !esJuez ? " on" : "") + (esJuez ? " disabled" : "") + '" data-p="' + u.id + '"' + (esJuez ? " disabled" : "") + '>' +
          esc(u.avatar + " " + u.nombre) + (u.id === me.id ? " (yo)" : "") + (esJuez ? " · juez" : "") + '</button>';
      }).join("") + '</div></div>') +
      '<button class="btn primary wide" id="launch">' + (tor ? "Proponer reto (necesita " + VOTOS_TORNEO + " votos)" : "Lanzar reto") + '</button>' +
      '</section>';
  }

  function renderRanking() {
    RETO_CTX = null;
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
          '<span class="who">' + avh(u, RETO_CTX) + " " + esc(u.nombre) + (RETO_CTX && presoDe(u.id, RETO_CTX) ? ' <span class="jail-tag">⛓️ preso</span>' : "") + '</span>' +
          '<span class="wins">' + (wins[u.id] ? wins[u.id] + (wins[u.id] === 1 ? " victoria" : " victorias") : "") + '</span>' +
          '<span class="pts">' + (pts[u.id] || 0) + ' pts</span></li>';
      }).join("") + '</ol>' +
      '<p class="hint">Cada reto: 1º 3 pts · 2º 2 pts · 3º 1 pt (solo cuentan fotos aceptadas por el juez).</p>' +
      '</section>';
  }

  function renderHistory() {
    var done = data.retos.filter(function (r) { return r.estado === "terminado" || r.estado === "cancelado"; });
    if (!done.length) return "";
    return '<section class="card"><h2>Historial</h2><ul class="history">' +
      done.map(function (r) {
        var w = r.ganador_id ? user(r.ganador_id) : null;
        return '<li><button class="hist-item" data-open="' + r.id + '"><span>' + esc(r.emoji) + " " + r.meta + " · " + esc(r.que_buscar) + '<small>' + fmtDate(r.inicia_en) + " · juez " + esc(user(juezDe(r)).nombre) + '</small></span>' +
          '<span>' + (r.estado === "cancelado" ? "Cancelado" : w ? "Ganó " + esc(w.avatar + " " + w.nombre) : "Sin ganador") + ' ›</span></button></li>';
      }).join("") + '</ul></section>';
  }

  function openReto(id) { sel = id; creating = false; window.scrollTo(0, 0); reload(); render(); }
  function backToList() {
    if (desdeTorneo && !creating) { desdeTorneo = false; sel = null; view = "podio"; render(); window.scrollTo(0, 0); return; }
    if (creating && draft.torneo) { draft.torneo = null; creating = false; view = "podio"; render(); window.scrollTo(0, 0); return; }
    sel = null; creating = false; justCreated = null; render(); window.scrollTo(0, 0);
  }

  function bindGame(r) {
    $app.querySelectorAll(".ph").forEach(function (b) { b.onclick = function () { openViewer(b.dataset.id); }; });
    bindCalabozo(r);
    if (el("irTorneos")) el("irTorneos").onclick = function () { goTab("podio"); };
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
    if (el("forWho")) el("forWho").onclick = function (e) {
      var b = e.target.closest("button"); if (!b) return;
      draft.todos = b.dataset.todos === "1";
      if (!draft.todos && !draft.parts.length && draft.juez !== me.id) draft.parts = [me.id];
      render();
    };
    if (el("parts")) el("parts").onclick = function (e) {
      var b = e.target.closest(".chip"); if (!b || b.disabled) return;
      var id = b.dataset.p, i = draft.parts.indexOf(id);
      if (i >= 0) draft.parts.splice(i, 1); else draft.parts.push(id);
      b.classList.toggle("on", i < 0);
    };
    el("launch").onclick = function () {
      if (!draft.que.trim()) { el("rQue").focus(); return toast("Escribe cuál es el reto"); }
      var hz = horario();
      if (!hz.abierto) return toast("Solo se pueden crear retos de " + hz.rango + " (hora de " + hz.zona + "). Ahora son las " + hz.ahora + ".", 5000);
      if (draft.torneo) {
        var torId = draft.torneo;
        return guard(async function () {
          must(await db.rpc("proponer_reto", { p_token: token, p_torneo: torId, p_que: draft.que, p_emoji: draft.emoji,
            p_meta: draft.meta, p_minutos: draft.min, p_juez: draft.juez }));
          toast("🗳️ Reto propuesto. Necesita " + VOTOS_TORNEO + " votos a favor en 24 h.", 5000);
          draft.que = ""; draft.torneo = null; creating = false; sel = null; view = "podio";
          await reload(); render(); window.scrollTo(0, 0);
        });
      }
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
      return guard(async function () {
        await servidor({ accion: "eliminar_foto", token: token, foto_id: id },
          async function () { must(await db.rpc("juez_eliminar_foto", { p_token: token, p_foto: id })); });
        toast("Foto eliminada"); await reload();
      });
    }
    if (act === "aceptar") {
      return guard(async function () {
        var res = must(await db.rpc("juez_aceptar_foto", { p_token: token, p_foto: id }));
        toast(res.gano ? "¡" + u.nombre + " llegó a la meta y gana el reto!" : "Foto aceptada: " + u.nombre + " lleva " + res.aceptadas);
        await reload();
      });
    }
    var v = votosDe(id);
    if (act === "denuncia") return openReport(f, v);
    var tipo = v.mio === act ? null : act;   // tocar otra vez quita la marca
    guard(async function () {
      must(await db.rpc("votar_foto", { p_token: token, p_foto: id, p_tipo: tipo, p_motivo: null }));
      await reload();
    });
  }

  // ------------------------------------------------------------ calabozo 🚔
  var FRASES = [
    "Te toca pan y agua hasta que salgas.", "Puedes mirar, pero no tocar.", "Aprovecha para pensar en lo que hiciste.",
    "Tu cámara está en el depósito de pruebas.", "Las rejas son de mentira, pero la condena es de verdad.",
    "El abogado de oficio está de vacaciones.", "Buena conducta = menos tiempo (o no).", "Tranquilo: aquí dentro hay wifi."
  ];
  var CONDENAS = [[1, "1 hora"], [3, "3 horas"], [6, "6 horas"], [12, "12 horas"], [24, "1 día"], [72, "3 días"], [168, "1 semana"]];
  var CONDENAS_ADMIN = CONDENAS.concat([[336, "2 semanas"], [720, "30 días"]]);
  var DELITOS = ["Fotos falsas o tramposas", "Discutir con el juez", "Denuncias de mala fe", "Hacer trampa"];

  var RETO_CTX = null;   // reto que se está dibujando (las rejas solo se ven dentro de ese reto)
  // Condena activa de un usuario: en un reto concreto, o en cualquiera si no se indica
  function presoDe(uid, retoId) {
    var now = Date.now();
    return ((data && data.presos) || []).filter(function (p) {
      return p.usuario_id === uid && !p.liberado_en && new Date(p.hasta) > now && p.reto_id && (!retoId || p.reto_id === retoId);
    })[0] || null;
  }
  function condenasDe(uid) {
    var now = Date.now();
    return ((data && data.presos) || []).filter(function (p) { return p.usuario_id === uid && !p.liberado_en && new Date(p.hasta) > now && p.reto_id; });
  }
  function nombreReto(id) { var r = retoById(id); return r ? r.emoji + " " + r.que_buscar : "un reto"; }
  function presosActivos() {
    var now = Date.now();
    return ((data && data.presos) || []).filter(function (p) { return !p.liberado_en && new Date(p.hasta) > now && p.reto_id; });
  }
  // Avatar detrás de rejas si está preso
  function avh(u, retoId) { return u && u.id && retoId && presoDe(u.id, retoId) ? '<span class="jailed" title="En el calabozo en este reto">' + esc(u.avatar) + '</span>' : esc(u && u.avatar); }
  function frase(p) { var h = 0; for (var i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) >>> 0; return FRASES[h % FRASES.length]; }
  function quienEncarcelo(p) { return p.por_juez ? "el juez " + user(p.por_juez).nombre : "el administrador"; }
  function textoCarcel(p) {
    var u = user(p.usuario_id);
    return "🚔 *¡" + u.nombre + " va al calabozo!* ⛓️\n\nDelito: " + p.motivo + "\nCondena hasta: " +
      new Date(p.hasta).toLocaleString("es", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) +
      "\nReto: " + nombreReto(p.reto_id) + "\nLo encarceló " + quienEncarcelo(p) + ".\n\nNo podrá hacer fotos en ese reto hasta que salga 😅\n" + location.origin + location.pathname;
  }

  // ---- Libertad por el pueblo (votación) ----
  var VOTOS_NECESARIOS = 5;
  function votacionDe(p) {
    var vs = ((data && data.votosPresos) || []).filter(function (v) { return v.preso_id === p.id; });
    var mio = me ? vs.filter(function (v) { return v.usuario_id === me.id; })[0] : null;
    return {
      pedida: !!p.votacion_inicio, abierta: !!p.votacion_inicio && new Date(p.votacion_fin) > Date.now(),
      si: vs.filter(function (v) { return v.a_favor; }).length, no: vs.filter(function (v) { return !v.a_favor; }).length,
      mio: mio ? mio.a_favor : null
    };
  }
  function textoCampana(p, v) {
    var u = user(p.usuario_id);
    return "🗳️ *¡Vota para liberar a " + u.nombre + "!* ⛓️\n\nEstá en el calabozo del reto " + nombreReto(p.reto_id) + " por: " + p.motivo +
      "\nNecesita " + VOTOS_NECESARIOS + " votos a favor (lleva " + v.si + "). La votación cierra a las " +
      new Date(p.votacion_fin).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) + ".\n\nVota aquí 👇\n" + location.origin + location.pathname + "?reto=" + p.reto_id;
  }
  // Bloque de la votación para un preso (lo ven el preso y todos los demás)
  function bloqueVotacion(p) {
    var v = votacionDe(p), soyPreso = me && p.usuario_id === me.id, puedoVotar = me && !soyPreso && p.por_juez !== me.id;
    if (!v.pedida) {
      return soyPreso
        ? '<div class="pueblo"><b>🗳️ Libertad por el pueblo</b><small>Pon tu caso a votación (1 hora). Si consigues ' + VOTOS_NECESARIOS +
          ' votos a favor, sales libre al momento. Solo puedes pedirlo una vez por condena.</small>' +
          '<button class="btn small dark" data-indulto="' + p.id + '">🗳️ Pedir libertad al pueblo</button></div>'
        : "";
    }
    var barra = '<div class="pueblo-bar"><i style="width:' + Math.min(100, v.si / VOTOS_NECESARIOS * 100) + '%"></i></div>';
    if (!v.abierta) {
      return '<div class="pueblo cerrada"><b>🗳️ El pueblo decidió: sigue preso</b><small>Consiguió ' + v.si + ' de ' + VOTOS_NECESARIOS +
        ' votos a favor (' + v.no + ' en contra).</small></div>';
    }
    return '<div class="pueblo"><b>🗳️ Votación del pueblo: ' + v.si + ' / ' + VOTOS_NECESARIOS + ' a favor</b>' + barra +
      '<small>' + v.no + ' en contra · cierra en <span data-cierra="' + p.votacion_fin + '"></span></small>' +
      (puedoVotar ? '<div class="pueblo-votos">' +
        '<button class="btn small vote' + (v.mio === true ? " on" : "") + '" data-indultar="' + p.id + '" data-v="1">✋ Que salga</button>' +
        '<button class="btn small vote report' + (v.mio === false ? " on" : "") + '" data-indultar="' + p.id + '" data-v="0">👎 Que siga preso</button></div>'
        : soyPreso ? '<small>Pide a la familia que vote por ti 👇</small>' : '<small>Lo encarcelaste tú: no puedes votar.</small>') +
      (soyPreso ? waButton(textoCampana(p, v), "Hacer campaña por WhatsApp", "small ghost-wa") : "") + '</div>';
  }

  // Mi propia condena (si estoy preso)
  function carcelBanner(p) {
    if (!p) return "";
    return '<section class="card carcel-card"><div class="cell"><span class="cell-av">' + esc(me.avatar) + '</span><span class="cuffs">⛓️</span></div>' +
      '<h2>🚨 ¡Estás en el calabozo!</h2>' +
      '<p class="sub">Reto: <b>' + esc(nombreReto(p.reto_id)) + '</b><br>Delito: <b>' + esc(p.motivo) + '</b><br>Te encarceló ' + esc(quienEncarcelo(p)) + '.</p>' +
      '<div class="clock-wrap free-in"><span data-preso="' + p.hasta + '"></span></div>' +
      '<p class="hint">«' + esc(frase(p)) + '» En este reto no puedes hacer fotos, marcarlas ni denunciar. En los demás retos juegas normal.</p>' +
      bloqueVotacion(p) + '</section>';
  }
  function misCondenas() {
    var cs = condenasDe(me.id); if (!cs.length) return "";
    if (cs.length === 1) return carcelBanner(cs[0]);
    return '<section class="card carcel-card"><div class="cell"><span class="cell-av">' + esc(me.avatar) + '</span><span class="cuffs">⛓️</span></div>' +
      '<h2>🚨 ¡Estás preso en ' + cs.length + ' retos!</h2><ul class="mis-condenas">' + cs.map(function (p) {
        return '<li><b>' + esc(nombreReto(p.reto_id)) + '</b><small>' + esc(p.motivo) + ' · sales en <span data-preso="' + p.hasta + '"></span></small>' + bloqueVotacion(p) + '</li>';
      }).join("") + '</ul></section>';
  }

  // Lista de presos (pestaña Retos)
  function renderCalabozo() {
    var ps = presosActivos(); if (!ps.length) return "";
    return '<section class="card"><h2>🚔 Calabozo <span class="count">' + ps.length + '</span></h2><ul class="carcel-list">' +
      ps.map(function (p) {
        var u = user(p.usuario_id), puedo = p.por_juez && p.por_juez === me.id;
        return '<li><span class="cell mini"><span class="cell-av">' + esc(u.avatar) + '</span></span>' +
          '<div class="carcel-info"><b>' + esc(u.nombre) + (u.id === me.id ? " (tú)" : "") + '</b>' +
          '<small>Reto: ' + esc(nombreReto(p.reto_id)) + '</small>' +
          '<small>' + esc(p.motivo) + '</small><small>Sale en <b data-preso="' + p.hasta + '"></b> · lo encarceló ' + esc(quienEncarcelo(p)) + '</small>' +
          (u.id === me.id ? "" : bloqueVotacion(p)) +
          '<div class="carcel-actions">' + waButton(textoCarcel(p), "Contarlo", "small ghost-wa") +
          (puedo ? '<button class="btn small" data-free="' + p.id + '">Liberar</button>' : "") + '</div></div></li>';
      }).join("") + '</ul></section>';
  }

  function bindCalabozo(r) {
    $app.querySelectorAll("[data-jail]").forEach(function (b) { b.onclick = function () { openJail({ modo: "juez", reto: r, usuario: b.dataset.jail }); }; });
    $app.querySelectorAll("[data-free]").forEach(function (b) { b.onclick = function () { liberar(b.dataset.free, false); }; });
    $app.querySelectorAll("[data-indulto]").forEach(function (b) {
      b.onclick = function () {
        if (!confirm("¿Poner tu caso a votación? Dura 1 hora y solo puedes pedirlo una vez por esta condena. Necesitas " + VOTOS_NECESARIOS + " votos a favor.")) return;
        guard(async function () {
          must(await db.rpc("pedir_indulto", { p_token: token, p_preso: b.dataset.indulto }));
          toast("🗳️ ¡Votación abierta! Pide a la familia que vote por ti."); await reload();
        });
      };
    });
    $app.querySelectorAll("[data-indultar]").forEach(function (b) {
      b.onclick = function () {
        guard(async function () {
          var res = must(await db.rpc("votar_indulto", { p_token: token, p_preso: b.dataset.indultar, p_a_favor: b.dataset.v === "1" }));
          toast(res.liberado ? "🔓 ¡El pueblo ha hablado! Sale libre." : "🗳️ Voto registrado: " + res.a_favor + " / " + VOTOS_NECESARIOS + " a favor");
          if (res.liberado) confetti();
          await reload();
        });
      };
    });
  }

  function liberar(presoId, comoAdmin) {
    var p = (data.presos || []).filter(function (x) { return x.id === presoId; })[0]; if (!p) return;
    if (!confirm("¿Dar la libertad a " + user(p.usuario_id).nombre + " antes de tiempo?")) return;
    guard(async function () {
      if (comoAdmin) must(await db.rpc("admin_liberar", { p_clave: adminClave, p_preso: presoId }));
      else must(await db.rpc("juez_liberar", { p_token: token, p_preso: presoId }));
      toast("🔓 " + user(p.usuario_id).nombre + " está libre"); await reload();
    });
  }

  // Ventana para mandar al calabozo (juez o administrador)
  function openJail(o) {
    var u = user(o.usuario), opciones = o.modo === "admin" ? CONDENAS_ADMIN : CONDENAS, horas = 3, delito = "";
    var retosPosibles = o.modo === "admin" ? activos().filter(function (r) { return compite(r, o.usuario) && !presoDe(o.usuario, r.id); }) : [];
    if (o.modo === "admin" && !retosPosibles.length) return toast(u.nombre + " no juega en ningún reto en marcha (o ya está preso en todos).", 5000);
    var retoSel = o.modo === "admin" ? retosPosibles[0].id : o.reto.id;
    var ov = document.createElement("div");
    ov.className = "party report-ov";
    ov.innerHTML = '<form class="party-box report-box jail-box" id="jailForm">' +
      '<div class="cell big"><span class="cell-av">' + esc(u.avatar) + '</span><span class="cuffs">⛓️</span></div>' +
      '<h2>Mandar al calabozo a ' + esc(u.nombre) + '</h2><p>Solo en ' + (o.modo === "admin" ? "el reto que elijas" : "este reto") +
      ': ahí no podrá hacer fotos, marcarlas ni denunciar hasta que cumpla la condena. En los demás retos juega normal.</p>' +
      (o.modo === "admin" ? '<p class="label">Reto</p><div class="chips" id="jailReto">' + retosPosibles.map(function (r, i) {
        return '<button type="button" class="chip' + (i === 0 ? " on" : "") + '" data-r="' + r.id + '">' + esc(r.emoji + " " + r.que_buscar) + '</button>';
      }).join("") + '</div>' : '<p class="label">Reto: ' + esc(nombreReto(retoSel)) + '</p>') +
      '<p class="label">Condena</p><div class="chips" id="jailTime">' + opciones.map(function (c) {
        return '<button type="button" class="chip' + (c[0] === horas ? " on" : "") + '" data-h="' + c[0] + '">' + c[1] + '</button>';
      }).join("") + '</div>' +
      '<p class="label">Delito <span class="muted">(obligatorio)</span></p><div class="chips" id="jailWhy">' + DELITOS.map(function (d) {
        return '<button type="button" class="chip" data-d="' + esc(d) + '">' + esc(d) + '</button>';
      }).join("") + '</div>' +
      '<textarea id="jailText" maxlength="200" rows="2" placeholder="Ej: dijo que un gato era un perro negro"></textarea>' +
      '<div class="row report-actions"><button type="button" class="btn ghost" id="jailCancel">Cancelar</button>' +
      '<button class="btn danger-solid">🔒 Encerrar</button></div></form>';
    document.body.appendChild(ov);
    var txt = ov.querySelector("#jailText");
    function cerrar() { ov.remove(); }
    ov.onclick = function (e) { if (e.target === ov) cerrar(); };
    ov.querySelector("#jailCancel").onclick = cerrar;
    if (ov.querySelector("#jailReto")) ov.querySelector("#jailReto").onclick = function (e) {
      var b = e.target.closest(".chip"); if (!b) return; retoSel = b.dataset.r;
      [].forEach.call(this.children, function (c) { c.classList.toggle("on", c === b); });
    };
    ov.querySelector("#jailTime").onclick = function (e) {
      var b = e.target.closest(".chip"); if (!b) return; horas = +b.dataset.h;
      [].forEach.call(this.children, function (c) { c.classList.toggle("on", c === b); });
    };
    ov.querySelector("#jailWhy").onclick = function (e) {
      var b = e.target.closest(".chip"); if (!b) return; delito = b.classList.contains("on") ? "" : b.dataset.d;
      [].forEach.call(this.children, function (c) { c.classList.toggle("on", c === b && !!delito); });
    };
    ov.querySelector("#jailForm").onsubmit = function (e) {
      e.preventDefault();
      var extra = txt.value.trim(), motivo = delito ? delito + (extra ? ": " + extra : "") : extra;
      if (!motivo) { txt.focus(); return toast("Escribe o elige el delito."); }
      if (motivo.length > 200) return toast("El delito puede tener como máximo 200 caracteres.");
      guard(async function () {
        var p = o.modo === "admin"
          ? must(await db.rpc("admin_encarcelar", { p_clave: adminClave, p_reto: retoSel, p_usuario: o.usuario, p_horas: horas, p_motivo: motivo }))
          : must(await db.rpc("juez_encarcelar", { p_token: token, p_reto: o.reto.id, p_usuario: o.usuario, p_horas: horas, p_motivo: motivo }));
        await reload();
        ov.querySelector("#jailForm").innerHTML = '<div class="cell big"><span class="cell-av">' + esc(u.avatar) + '</span><span class="cuffs">⛓️</span></div>' +
          '<h2>¡' + esc(u.nombre) + ' está en el calabozo!</h2><p>En ' + esc(nombreReto(p.reto_id)) + '. Sale en ' + fmtLeft(new Date(p.hasta) - Date.now()) + '. ¿Lo cuentas en el grupo?</p>' +
          waButton(textoCarcel(p), "Contarlo por WhatsApp", "wide") + '<button type="button" class="btn ghost wide" id="jailOk">Cerrar</button>';
        ov.querySelector("#jailOk").onclick = cerrar;
      });
    };
  }

  // ------------------------------------------------------------ función de servidor "limpiar-fotos"
  // Borra también los archivos de las fotos. Si la función aún no está instalada en Supabase,
  // se hace como antes con la base de datos (los archivos se quedan guardados).
  async function servidor(body, fallback) {
    var res;
    try { res = await db.functions.invoke("limpiar-fotos", { body: body }); }
    catch (e) { res = { error: e }; }
    if (!res.error) return res.data || {};
    var info = null;
    try { if (res.error.context && res.error.context.json) info = await res.error.context.json(); } catch (x) {}
    if (info && info.error) throw new Error(info.error);
    if (fallback) { await fallback(); return { sinFuncion: true }; }
    throw new Error("funcion_no_instalada");
  }
  function msgBorrado(base, res) {
    if (res.sinFuncion) return base + " (sus fotos siguen guardadas: falta instalar la función limpiar-fotos)";
    var n = res.archivos_borrados || 0;
    return base + (n ? " y " + n + (n === 1 ? " foto borrada" : " fotos borradas") + " del almacenamiento" : "");
  }

  // ------------------------------------------------------------ denunciar con motivo
  var MOTIVOS = ["No es lo que pide el reto", "Foto repetida", "No se ve bien / borrosa", "Es foto de una pantalla o de otra foto"];
  function openReport(f, v) {
    var u = user(f.usuario_id), ov = document.createElement("div");
    // Separa el motivo guardado en "motivo rápido" + comentario (se guarda como "Motivo: comentario")
    var actual = v.mio === "denuncia" ? v.miMotivo : "", rapido = "", comentario = actual;
    MOTIVOS.forEach(function (m) {
      if (actual === m) { rapido = m; comentario = ""; }
      else if (actual.indexOf(m + ": ") === 0) { rapido = m; comentario = actual.slice(m.length + 2); }
    });
    if (actual && !rapido) rapido = "Otro motivo";
    ov.className = "party report-ov";
    ov.innerHTML = '<form class="party-box report-box" id="repForm">' +
      '<img class="report-img" alt="" src="' + esc(photoUrl(f.ruta)) + '">' +
      '<h2>¿Por qué denuncias esta foto?</h2><p>Foto de ' + esc(u.avatar + " " + u.nombre) + '. El juez verá tu motivo.</p>' +
      '<div class="chips report-chips" id="repChips">' + MOTIVOS.concat(["Otro motivo"]).map(function (m) {
        return '<button type="button" class="chip' + (m === rapido ? " on" : "") + '" data-m="' + esc(m) + '">' + esc(m) + '</button>';
      }).join("") + '</div>' +
      '<textarea id="repText" maxlength="200" rows="3" placeholder="Explica el motivo (obligatorio si eliges «Otro motivo»)">' +
      esc(comentario) + '</textarea>' +
      '<div class="rep-count"><span id="repN">0</span>/200</div>' +
      '<div class="row report-actions">' +
      (v.mio === "denuncia" ? '<button type="button" class="btn ghost" id="repQuitar">Quitar denuncia</button>' : '<button type="button" class="btn ghost" id="repCancel">Cancelar</button>') +
      '<button class="btn danger-solid">Denunciar</button></div></form>';
    document.body.appendChild(ov);
    var sel = rapido, txt = ov.querySelector("#repText");
    function count() { ov.querySelector("#repN").textContent = txt.value.length; }
    count(); txt.oninput = count;
    ov.querySelector("#repChips").onclick = function (e) {
      var b = e.target.closest(".chip"); if (!b) return;
      sel = b.dataset.m;
      [].forEach.call(this.children, function (c) { c.classList.toggle("on", c === b); });
      if (sel === "Otro motivo") txt.focus();
    };
    function cerrar() { ov.remove(); }
    ov.onclick = function (e) { if (e.target === ov) cerrar(); };
    if (ov.querySelector("#repCancel")) ov.querySelector("#repCancel").onclick = cerrar;
    if (ov.querySelector("#repQuitar")) ov.querySelector("#repQuitar").onclick = function () {
      guard(async function () {
        must(await db.rpc("votar_foto", { p_token: token, p_foto: f.id, p_tipo: null, p_motivo: null }));
        cerrar(); toast("Denuncia quitada"); await reload();
      });
    };
    ov.querySelector("#repForm").onsubmit = function (e) {
      e.preventDefault();
      var extra = txt.value.trim();
      var motivo = sel && sel !== "Otro motivo" ? sel + (extra ? ": " + extra : "") : extra;
      if (!motivo) { txt.focus(); return toast(sel === "Otro motivo" ? "Escribe cuál es el motivo." : ERRORS.falta_motivo); }
      if (motivo.length > 200) return toast(ERRORS.motivo_largo);
      guard(async function () {
        must(await db.rpc("votar_foto", { p_token: token, p_foto: f.id, p_tipo: "denuncia", p_motivo: motivo }));
        cerrar(); toast("Foto denunciada. El juez verá tu motivo."); await reload();
      });
    };
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
      // Esperar a que la imagen tenga tamaño antes de dejar disparar
      if (!v.videoWidth) await new Promise(function (ok) {
        var t = setTimeout(ok, 4000);
        v.addEventListener("loadedmetadata", function () { clearTimeout(t); ok(); }, { once: true });
      });
      if (!cam.stream) return;   // se cerró la cámara mientras tanto
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
    el("camShutter").disabled = true;   // se activa cuando la cámara está lista
    el("camPreview").hidden = true; el("camLive").hidden = false; el("camera").hidden = false;
    el("camTitle").textContent = r.emoji + " " + r.que_buscar;
    startStream();
  }
  function closeCamera() {
    if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
    cam.stream = null; cam.shot = null; el("camVideo").srcObject = null; el("camera").hidden = true;
    el("camShutter").disabled = true;
  }
  function takePhoto() {
    var v = el("camVideo");
    if (!v.videoWidth) return toast("La cámara aún se está preparando. Inténtalo en un segundo.");
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

  // ============================================================ TORNEOS
  var VOTOS_TORNEO = 5;
  // Fechas del torneo (AAAA-MM-DD) en la zona horaria del juego
  function hoyISO() {
    var z = data && data.reglas && data.reglas.zona_horaria;
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: z || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function sumarDias(iso, n) { var d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function fmtDia(iso) {
    if (!iso) return "";
    try { return new Date(iso + "T12:00:00Z").toLocaleDateString("es", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }); }
    catch (e) { return iso; }
  }
  function faseTorneo(t) {   // "proximo", "curso" o "terminado"
    var hoy = hoyISO();
    if (t.termina_el && hoy > t.termina_el) return "terminado";
    if (t.inicia_el && hoy < t.inicia_el) return "proximo";
    return "curso";
  }
  function fechasTorneo(t) { return t.inicia_el ? "Del " + fmtDia(t.inicia_el) + " al " + fmtDia(t.termina_el) : ""; }
  function premiosTorneo(t) {
    return [t.premio1, t.premio2, t.premio3].map(function (p, i) { return p ? { puesto: i + 1, premio: p } : null; }).filter(Boolean);
  }
  function torneoById(id) { return (data.torneos || []).filter(function (t) { return t.id === id; })[0]; }
  function nombreTorneo(id) { var t = torneoById(id); return t ? t.nombre : "Torneo"; }
  function partsDe(torId) { return (data.torneoParts || []).filter(function (x) { return x.torneo_id === torId; }).map(function (x) { return x.usuario_id; })
    .filter(function (id) { return data.usuarios.some(function (u) { return u.id === id; }); }); }
  function soyDelTorneo(torId) { return me && partsDe(torId).indexOf(me.id) >= 0; }
  function retosDeTorneo(torId) { return data.retos.filter(function (r) { return r.torneo_id === torId; }); }
  function votosDeReto(rid) { return (data.votosRetos || []).filter(function (v) { return v.reto_id === rid; }); }
  function propuestasPorVotar() {
    return data.retos.filter(function (r) {
      var t = torneoById(r.torneo_id);
      return r.estado === "propuesto" && new Date(r.propuesta_expira) > Date.now() && soyDelTorneo(r.torneo_id) && r.creado_por !== me.id &&
        t && faseTorneo(t) !== "terminado" &&
        !votosDeReto(r.id).some(function (v) { return v.usuario_id === me.id; });
    });
  }
  function avisoPropuestas() {
    var n = propuestasPorVotar().length; if (!n) return "";
    return '<button class="card aviso-torneo" id="irTorneos">🗳️ <b>' + n + (n === 1 ? " reto propuesto espera" : " retos propuestos esperan") +
      ' tu voto</b> en los torneos ›</button>';
  }

  // Suma los puntos de los retos del torneo. Desempate: 1) más fotos aceptadas, 2) menos denuncias.
  function tabla(retos) {
    var ids = retos.map(function (r) { return r.id; }), filas = {};
    data.puntajes.forEach(function (p) {
      if (ids.indexOf(p.reto_id) < 0) return;
      var f = filas[p.usuario_id] || (filas[p.usuario_id] = { id: p.usuario_id, pts: 0, fotos: 0, den: 0, por: {} });
      f.pts += p.puntos; f.fotos += p.fotos; f.den += p.denuncias || 0;
      f.por[p.reto_id] = p.puntos;
    });
    var lista = Object.keys(filas).map(function (k) { return filas[k]; })
      .filter(function (f) { return data.usuarios.some(function (u) { return u.id === f.id; }); })
      .sort(function (a, b) { return b.pts - a.pts || b.fotos - a.fotos || a.den - b.den; });
    var puesto = 0;
    lista.forEach(function (f, i) {
      var prev = lista[i - 1];
      if (!prev || prev.pts !== f.pts || prev.fotos !== f.fotos || prev.den !== f.den) puesto = i + 1;
      f.puesto = puesto;
    });
    return { filas: lista, lideres: lista.filter(function (f) { return f.puesto === 1; }) };
  }
  function pts(n) { return n + (n === 1 ? " pt" : " pts"); }
  function listaNombres(fs) {
    var n = fs.map(function (f) { return user(f.id).nombre; });
    return n.length > 1 ? n.slice(0, -1).join(", ") + " y " + n[n.length - 1] : n[0];
  }
  function textoReglas(t) {
    var ps = partsDe(t.id).map(function (id) { return user(id).nombre; });
    var med = ["🥇", "🥈", "🥉"];
    return "🏆 *Torneo: " + t.nombre + "*\n" +
      (t.inicia_el ? "📅 " + fechasTorneo(t) + "\n" : "") +
      (premiosTorneo(t).length ? "\n🎁 *Premios*\n" + premiosTorneo(t).map(function (p) { return med[p.puesto - 1] + " " + p.premio; }).join("\n") + "\n" : "") +
      "\n📜 *Reglas*\n" +
      "1️⃣ Cada participante propone *1 solo reto* en el torneo.\n" +
      "2️⃣ Solo empieza *1 reto por día*, entre la fecha de inicio y la de fin. Si un día ya tiene reto, el siguiente aprobado empieza otro día.\n" +
      "3️⃣ Un reto propuesto necesita *" + VOTOS_TORNEO + " votos a favor* de otros participantes para empezar. Si en *24 horas* no los consigue, se elimina y quien lo propuso puede proponer otro.\n" +
      "4️⃣ Cada reto da 3, 2 y 1 puntos a los tres primeros (solo cuentan fotos aceptadas por el juez). El *podio del torneo* suma los puntos de sus retos.\n" +
      "⚖️ *Desempate* (si hay los mismos puntos): 1) más fotos aceptadas; 2) menos denuncias recibidas.\n\n" +
      "👥 Participantes (" + ps.length + "): " + ps.join(", ") + "\n\n¡A jugar! 👇\n" + location.origin + location.pathname;
  }
  function textoPodio(t, tb) {
    var med = ["🥇", "🥈", "🥉"];
    var fin = faseTorneo(t) === "terminado";
    return "🏆 *" + (fin ? "Resultado final" : "Podio") + " del torneo: " + t.nombre + "*\n" + (t.inicia_el ? "📅 " + fechasTorneo(t) + "\n" : "") + "\n" +
      (tb.filas.length ? tb.filas.slice(0, 10).map(function (f) {
        var pr = f.puesto <= 3 && t["premio" + f.puesto];
        return (med[f.puesto - 1] || f.puesto + ".") + " " + user(f.id).nombre + " · " + pts(f.pts) + (pr ? " 🎁 " + pr : "");
      }).join("\n") : "Todavía no hay puntos.") + "\n\nVer el torneo 👇\n" + location.origin + location.pathname;
  }

  function renderPodio() {   // pestaña "Torneos"
    if (!(data.torneos || []).length) {
      $app.innerHTML = '<section class="card empty-state"><h2>Torneos</h2><p class="sub">Todavía no hay torneos. ' +
        'El administrador puede crear uno con un nombre y sus participantes.</p></section>';
      return;
    }
    var orden = { curso: 0, proximo: 1, terminado: 2 };
    var lista = data.torneos.slice().sort(function (a, b) {
      return orden[faseTorneo(a)] - orden[faseTorneo(b)] || (soyDelTorneo(b.id) ? 1 : 0) - (soyDelTorneo(a.id) ? 1 : 0);
    });
    $app.innerHTML = lista.map(renderTorneo).join("");
    bindTorneos();
    updateClock();
  }

  function renderTorneo(t) {
    var retos = retosDeTorneo(t.id), parts = partsDe(t.id), soy = soyDelTorneo(t.id), now = Date.now();
    var jugados = retos.filter(function (r) { return r.estado === "terminado" || r.estado === "activo" || r.estado === "cancelado"; })
      .sort(function (a, b) { return new Date(a.inicia_en) - new Date(b.inicia_en); });
    var programados = retos.filter(function (r) { return r.estado === "programado"; }).sort(function (a, b) { return new Date(a.inicia_en) - new Date(b.inicia_en); });
    var propuestas = faseTorneo(t) === "terminado" ? [] : retos.filter(function (r) { return r.estado === "propuesto" && new Date(r.propuesta_expira) > now; });
    var tb = tabla(jugados), top = tb.filas.slice(0, 3);
    var miReto = me && retos.filter(function (r) { return r.creado_por === me.id && r.estado !== "propuesto"; })[0];
    var miProp = me && propuestas.filter(function (r) { return r.creado_por === me.id; })[0];
    var sinReto = parts.filter(function (id) { return !retos.some(function (r) { return r.creado_por === id && r.estado !== "propuesto"; }); });
    var fase = faseTorneo(t), premios = premiosTorneo(t), med = ["🥇", "🥈", "🥉"];
    var tagTxt = fase === "terminado" ? "Terminado" : fase === "proximo" ? "Empieza " + fmtDia(t.inicia_el) : soy ? "Participas · en curso" : "En curso";

    var podium = top.length ? '<div class="podium">' + [1, 0, 2].map(function (i) {
      var f = top[i]; if (!f) return '<div class="step empty"></div>';
      var u = user(f.id);
      return '<div class="step p' + f.puesto + '"><div class="step-av">' + esc(u.avatar) + '</div>' +
        '<div class="step-name">' + esc(u.nombre) + '</div><div class="step-pts">' + pts(f.pts) + '</div>' +
        (t["premio" + f.puesto] ? '<div class="step-prize">🎁 ' + esc(t["premio" + f.puesto]) + '</div>' : "") +
        '<div class="step-block">' + f.puesto + '</div></div>';
    }).join("") + '</div>' : '<p class="hint">Todavía no hay puntos: ningún reto del torneo ha terminado.</p>';

    return '<section class="card camp torneo">' +
      '<div class="tag ' + (fase === "curso" ? "live" : "") + '">' + esc(tagTxt) + '</div>' +
      '<h2>🏆 ' + esc(t.nombre) + '</h2>' +
      (t.inicia_el ? '<p class="torneo-fechas">📅 ' + fechasTorneo(t) + '</p>' : "") +
      (premios.length ? '<ul class="premios">' + premios.map(function (p) {
        return '<li><span>' + med[p.puesto - 1] + '</span><span><small>' + (p.puesto === 1 ? "Campeón" : p.puesto + ".º puesto") + '</small><b>' + esc(p.premio) + '</b></span></li>';
      }).join("") + '</ul>' : "") +
      (fase === "terminado" && tb.lideres.length ? '<div class="campeon">🏆 ' + (tb.lideres.length > 1 ? "Empate en el primer puesto: <b>" + esc(listaNombres(tb.lideres)) + "</b>"
        : "Campeón: <b>" + esc(user(tb.lideres[0].id).nombre) + "</b>" + (t.premio1 ? " · se lleva " + esc(t.premio1) : "")) + '</div>' : "") +
      '<p class="sub">' + parts.length + ' participantes · ' + jugados.filter(function (r) { return r.estado === "terminado"; }).length + ' retos terminados · ' +
        sinReto.length + ' aún sin reto</p>' +
      '<div class="parts-row">' + parts.map(function (id) { var u = user(id); return '<span title="' + esc(u.nombre) + '">' + esc(u.avatar) + '</span>'; }).join("") + '</div>' +
      // reglas
      '<details class="reglas"><summary>📜 Reglas del torneo</summary><ol>' +
        '<li>Cada participante propone <b>1 solo reto</b> en el torneo.</li>' +
        '<li>Solo empieza <b>1 reto por día</b>' + (t.inicia_el ? ', entre el ' + fmtDia(t.inicia_el) + ' y el ' + fmtDia(t.termina_el) : "") + '. Si un día ya tiene reto, el siguiente aprobado empieza otro día a la hora de inicio.</li>' +
        '<li>Un reto propuesto necesita <b>' + VOTOS_TORNEO + ' votos a favor</b> de otros participantes para empezar. Si en <b>24 horas</b> no los consigue, se elimina y quien lo propuso puede proponer otro.</li>' +
        '<li>Cada reto da 3, 2 y 1 puntos a los tres primeros. El <b>podio del torneo</b> suma los puntos de sus retos.</li>' +
        '<li><b>Desempate</b> si hay los mismos puntos: 1) más fotos aceptadas; 2) menos denuncias recibidas.</li></ol>' +
        (parts.length < VOTOS_TORNEO + 1 ? '<p class="hint">⚠️ Con ' + parts.length + ' participantes ningún reto puede llegar a ' + VOTOS_TORNEO + ' votos: hacen falta al menos ' + (VOTOS_TORNEO + 1) + '.</p>' : "") +
        '</details>' +
      waButton(textoReglas(t), "Compartir reglas por WhatsApp", "small ghost-wa") +
      // mi situación
      (soy && fase === "terminado" ? "" : soy ? '<div class="mi-torneo">' + (miReto ? 'Tu reto en este torneo: <b>' + esc(miReto.emoji + " " + miReto.que_buscar) + '</b> (' + ESTADOS[miReto.estado].toLowerCase() + ').'
        : miProp ? 'Tu propuesta <b>' + esc(miProp.emoji + " " + miProp.que_buscar) + '</b> está en votación.'
        : '<button class="btn primary wide" data-proponer="' + t.id + '">+ Proponer mi reto</button>') + '</div>' : "") +
      // propuestas en votación
      (propuestas.length ? '<h3>🗳️ Propuestas en votación</h3><ul class="propuestas">' + propuestas.map(function (r) {
        var vs = votosDeReto(r.id), n = vs.length, mio = me && vs.some(function (v) { return v.usuario_id === me.id; }), autor = user(r.creado_por);
        var dur = DURATIONS.filter(function (d) { return d.min === r.duracion_min; })[0];
        return '<li><div class="prop-head"><span class="reto-emoji">' + esc(r.emoji) + '</span><div><b>' + r.meta + ' fotos · ' + esc(r.que_buscar) + '</b>' +
          '<small>Propone ' + esc(autor.nombre) + ' · juez ' + esc(user(juezDe(r)).nombre) + ' · dura ' + (dur ? dur.label : r.duracion_min + ' min') + '</small></div></div>' +
          '<div class="pueblo-bar"><i style="width:' + Math.min(100, n / VOTOS_TORNEO * 100) + '%"></i></div>' +
          '<small>' + n + ' / ' + VOTOS_TORNEO + ' votos a favor · se elimina en <span data-cierra="' + r.propuesta_expira + '"></span> si no llega</small>' +
          (soy && me && r.creado_por !== me.id ? '<button class="btn small vote' + (mio ? " on" : "") + '" data-apoyo="' + r.id + '" data-v="' + (mio ? 0 : 1) + '">' + (mio ? "✓ Lo apoyas · quitar" : "👍 Apoyar este reto") + '</button>' : "") +
          (me && r.creado_por === me.id ? '<button class="btn small ghost" data-retirar="' + r.id + '">Retirar mi propuesta</button>' : "") +
          (n ? '<small>Votaron a favor: ' + esc(vs.map(function (v) { return user(v.usuario_id).nombre; }).join(", ")) + '</small>' : "") +
          '<button class="link-btn" data-reto="' + r.id + '">Ver configuración ›</button></li>';
      }).join("") + '</ul>' : "") +
      // programados y jugados
      (programados.length ? '<h3>📅 Programados</h3><ul class="camp-retos">' + programados.map(function (r) {
        return '<li><button class="hist-item" data-reto="' + r.id + '"><span>' + esc(r.emoji + " " + r.que_buscar) + '<small>Empieza ' + fmtDate(r.inicia_en) +
          ' · juez ' + esc(user(juezDe(r)).nombre) + '</small></span><span>Ver ›</span></button></li>';
      }).join("") + '</ul>' : "") +
      '<h3>Podio</h3>' + podium +
      (tb.filas.length ? '<div class="table-wrap"><table class="standings"><thead><tr><th>#</th><th>Jugador</th>' +
        jugados.map(function (r, i) { return '<th title="' + esc(r.que_buscar) + '">R' + (i + 1) + '</th>'; }).join("") +
        '<th>Total</th><th title="Fotos aceptadas (1.er desempate)">📷</th><th title="Denuncias recibidas (2.º desempate)">🚩</th></tr></thead><tbody>' + tb.filas.map(function (f) {
          var u = user(f.id);
          return '<tr' + (me && f.id === me.id ? ' class="is-me"' : "") + '><td>' + f.puesto + '</td><td class="pl">' + esc(u.avatar + " " + u.nombre) + '</td>' +
            jugados.map(function (r) { return '<td>' + (r.id in f.por ? f.por[r.id] : (r.estado === "activo" ? "·" : "–")) + '</td>'; }).join("") +
            '<td class="tot">' + f.pts + '</td><td>' + f.fotos + '</td><td>' + f.den + '</td></tr>';
        }).join("") + '</tbody></table></div><p class="hint">📷 fotos aceptadas · 🚩 denuncias recibidas. Con los mismos puntos gana quien tenga más 📷 y, si siguen igual, menos 🚩.</p>' : "") +
      (jugados.length ? '<ul class="camp-retos">' + jugados.map(function (r, i) {
        var w = r.ganador_id ? user(r.ganador_id) : null;
        return '<li><button class="hist-item" data-reto="' + r.id + '"><span><b>R' + (i + 1) + '</b> ' + esc(r.emoji + " " + r.que_buscar) +
          '<small>' + fmtDate(r.inicia_en) + ' · de ' + esc(user(r.creado_por).nombre) + '</small></span><span>' +
          (r.estado === "activo" ? "En marcha" : r.estado === "cancelado" ? "Cancelado" : w ? "Ganó " + esc(w.nombre) : "Sin ganador") + ' ›</span></button></li>';
      }).join("") + '</ul>' : "") +
      (tb.filas.length ? waButton(textoPodio(t, tb), "Compartir podio por WhatsApp", "wide ghost-wa") : "") +
      '</section>';
  }

  function bindTorneos() {
    $app.querySelectorAll("[data-reto]").forEach(function (b) {
      b.onclick = function () { view = "retos"; sel = b.dataset.reto; creating = false; desdeTorneo = true; reload(); render(); window.scrollTo(0, 0); };
    });
    $app.querySelectorAll("[data-proponer]").forEach(function (b) {
      b.onclick = function () {
        var hz = horario();
        if (!hz.abierto) return toast("Solo se pueden proponer retos de " + hz.rango + " (hora de " + hz.zona + "). Ahora son las " + hz.ahora + ".", 5000);
        draft.torneo = b.dataset.proponer; draft.juez = null; view = "retos"; sel = null; creating = true; render(); window.scrollTo(0, 0);
      };
    });
    $app.querySelectorAll("[data-apoyo]").forEach(function (b) {
      b.onclick = function () {
        guard(async function () {
          var res = must(await db.rpc("votar_propuesta", { p_token: token, p_reto: b.dataset.apoyo, p_si: b.dataset.v === "1" }));
          if (res.aprobado) {
            toast(res.estado === "activo" ? "🎉 ¡Reto aprobado! Empieza ahora." : "🎉 ¡Reto aprobado! Empieza el " + fmtDate(res.inicia_en) + " (1 reto por día).", 5000);
            confetti();
          } else toast("🗳️ " + res.votos + " / " + VOTOS_TORNEO + " votos a favor");
          await reload();
        });
      };
    });
    $app.querySelectorAll("[data-retirar]").forEach(function (b) {
      b.onclick = function () {
        if (!confirm("¿Retirar tu propuesta? Podrás proponer otro reto.")) return;
        guard(async function () { must(await db.rpc("retirar_propuesta", { p_token: token, p_reto: b.dataset.retirar })); toast("Propuesta retirada"); await reload(); });
      };
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
        var cs = condenasDe(u.id);
        return '<li><div class="admin-info"><b>' + esc(u.avatar) + " " + esc(u.nombre) + '</b>' +
          '<small>@' + esc(u.usuario) + " · " + (pts[u.id] || 0) + " pts · desde " + fmtDate(u.creado_en) + '</small>' +
          cs.map(function (pz) {
            return '<small class="jail-small">⛓️ Preso en ' + esc(nombreReto(pz.reto_id)) + ': ' + esc(pz.motivo) + ' · sale en <span data-preso="' + pz.hasta + '"></span> ' +
              '<button class="link-btn" data-act="free" data-id="' + pz.id + '">Liberar</button></small>';
          }).join("") + '</div>' +
          '<div class="admin-actions">' +
          '<button class="btn small" data-act="jail" data-id="' + u.id + '" title="Mandar al calabozo en un reto">🚔</button>' +
          '<button class="btn small" data-act="reset" data-id="' + u.id + '">Clave</button>' +
          '<button class="btn small danger" data-act="del-user" data-id="' + u.id + '">Eliminar</button></div></li>';
      }).join("") + '</ul>' : '<p class="hint">Todavía no hay usuarios.</p>') +
      '</section>' +
      '<section class="card admin" id="almac"><h2>Almacenamiento</h2><p class="hint">Calculando…</p></section>' +
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
    cargarAlmacenamiento();
    el("admNewForm").onsubmit = function (e) {
      e.preventDefault();
      var nueva = el("admNew").value;
      guard(async function () {
        must(await db.rpc("admin_cambiar_clave", { p_clave: adminClave, p_nueva: nueva }));
        adminClave = nueva; toast("Clave de administrador cambiada"); el("admNewForm").reset();
      });
    };
  }

  function mb(b) { return (b / 1048576).toFixed(1).replace(".", ",") + " MB"; }
  async function cargarAlmacenamiento() {
    var box = el("almac"); if (!box) return;
    var r = await db.rpc("admin_almacenamiento", { p_clave: adminClave });
    box = el("almac"); if (!box) return;
    if (r.error) { box.querySelector(".hint").textContent = "No disponible: actualiza la base de datos para ver el almacenamiento."; return; }
    var a = r.data;
    box.innerHTML = '<h2>Almacenamiento</h2>' +
      '<div class="stats"><div><b>' + a.archivos + '</b><small>fotos guardadas</small></div><div><b>' + mb(a.bytes) + '</b><small>ocupado</small></div></div>' +
      (a.huerfanos
        ? '<p class="hint"><b>' + a.huerfanos + (a.huerfanos === 1 ? " foto sin usar" : " fotos sin usar") + '</b> (' + mb(a.bytes_huerfanos) +
          ') de retos, usuarios o fotos ya eliminados.</p><button class="btn wide" id="limpiar">Borrar fotos sin usar</button>'
        : '<p class="hint">No hay fotos sin usar. Al eliminar retos, usuarios o fotos se borran también sus archivos.</p>');
    if (el("limpiar")) el("limpiar").onclick = function () {
      if (!confirm("¿Borrar " + a.huerfanos + " fotos sin usar? No pertenecen a ningún reto y no se pueden recuperar.")) return;
      guard(async function () {
        var res;
        try { res = await servidor({ accion: "limpiar", clave: adminClave }); }
        catch (e) {
          if (String(e.message).indexOf("funcion_no_instalada") >= 0) return toast("Falta instalar la función limpiar-fotos en Supabase.", 5000);
          throw e;
        }
        toast((res.archivos_borrados || 0) + " fotos sin usar borradas");
        cargarAlmacenamiento();
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

  function renderCampAdmin() {   // sección "Torneos" del administrador
    var f = campForm;
    var html = '<section class="card admin" id="campSection"><h2>Torneos</h2>' +
      '<p class="hint">Crea un torneo con su nombre y sus participantes. Ellos proponen sus retos (1 por participante, 1 reto por día, ' + VOTOS_TORNEO + ' votos para empezar) y el podio suma los puntos del torneo.</p>';
    if (f) {
      html += '<form id="campForm" class="stack-form camp-form">' +
        '<label class="label" for="campName">' + (f.id ? "Editar torneo" : "Nuevo torneo") + '</label>' +
        '<input id="campName" maxlength="60" placeholder="Ej: Torneo de noviembre" required value="' + esc(f.nombre) + '">' +
        '<div class="row fechas"><label><span class="label">Empieza</span><input type="date" id="campIni" required value="' + esc(f.inicio) + '"></label>' +
        '<label><span class="label">Termina</span><input type="date" id="campFin" required value="' + esc(f.fin) + '"></label></div>' +
        '<label class="label" for="campP1">🥇 Premio para el campeón</label>' +
        '<input id="campP1" maxlength="100" required placeholder="Ej: Cena en el restaurante que elija" value="' + esc(f.p1) + '">' +
        '<label class="label" for="campP2">🥈 Premio para el 2.º <span class="muted">(opcional)</span></label>' +
        '<input id="campP2" maxlength="100" placeholder="Opcional" value="' + esc(f.p2) + '">' +
        '<label class="label" for="campP3">🥉 Premio para el 3.º <span class="muted">(opcional)</span></label>' +
        '<input id="campP3" maxlength="100" placeholder="Opcional" value="' + esc(f.p3) + '">' +
        '<p class="label">Participantes <span class="muted">(' + f.parts.length + ' elegidos; mínimo ' + (VOTOS_TORNEO + 1) + ' para que los retos puedan llegar a ' + VOTOS_TORNEO + ' votos)</span></p>' +
        '<div class="row"><button type="button" class="btn small ghost" id="campAll">Todos</button><button type="button" class="btn small ghost" id="campNone">Ninguno</button></div>' +
        '<ul class="check-list" id="campParts">' + data.usuarios.map(function (u) {
          var on = f.parts.indexOf(u.id) >= 0;
          return '<li><label class="check' + (on ? " on" : "") + '"><input type="checkbox" value="' + u.id + '"' + (on ? " checked" : "") + '>' +
            '<span><b>' + esc(u.avatar + " " + u.nombre) + '</b><small>@' + esc(u.usuario) + '</small></span></label></li>';
        }).join("") + '</ul>' +
        '<div class="row"><button type="button" class="btn ghost" id="campCancel">Cancelar</button>' +
        '<button class="btn primary">' + (f.id ? "Guardar cambios" : "Crear torneo") + '</button></div></form>';
    } else {
      html += ((data.torneos || []).length ? '<ul class="admin-list">' + data.torneos.map(function (t) {
        var rs = retosDeTorneo(t.id);
        return '<li><div class="admin-info"><b>🏆 ' + esc(t.nombre) + '</b><small>' + (t.inicia_el ? fechasTorneo(t) + ' · ' : "") +
          (t.premio1 ? '🥇 ' + esc(t.premio1) + '<br>' : "") + partsDe(t.id).length + ' participantes · ' +
          rs.filter(function (r) { return r.estado !== "propuesto"; }).length + ' retos · ' + rs.filter(function (r) { return r.estado === "propuesto"; }).length + ' en votación</small></div>' +
          '<div class="admin-actions"><button class="btn small" data-camp="edit" data-id="' + t.id + '">Editar</button>' +
          '<button class="btn small danger" data-camp="del" data-id="' + t.id + '">Eliminar</button></div></li>';
      }).join("") + '</ul>' : "") +
      '<button class="btn wide" id="campNew">+ Crear torneo</button>';
    }
    return html + '</section>';
  }

  function bindCampAdmin() {
    if (el("campNew")) el("campNew").onclick = function () { campForm = { id: null, nombre: "", parts: [], inicio: hoyISO(), fin: sumarDias(hoyISO(), 14), p1: "", p2: "", p3: "" }; renderAdmin(); el("campSection").scrollIntoView(); el("campName").focus(); };
    $app.querySelectorAll("[data-camp]").forEach(function (b) {
      b.onclick = function () {
        var t = torneoById(b.dataset.id); if (!t) return;
        if (b.dataset.camp === "edit") { campForm = { id: t.id, nombre: t.nombre, parts: partsDe(t.id), inicio: t.inicia_el || hoyISO(), fin: t.termina_el || sumarDias(hoyISO(), 14),
          p1: t.premio1 || "", p2: t.premio2 || "", p3: t.premio3 || "" }; renderAdmin(); el("campSection").scrollIntoView(); return; }
        if (!confirm("¿Eliminar el torneo «" + t.nombre + "»? Se borran sus propuestas y retos programados; los retos ya jugados quedan como retos libres.")) return;
        guard(async function () {
          must(await db.rpc("admin_eliminar_torneo", { p_clave: adminClave, p_id: t.id }));
          toast("Torneo eliminado"); await reload();
        });
      };
    });
    if (!el("campForm")) return;
    el("campName").oninput = function () { campForm.nombre = this.value; };
    [["campIni", "inicio"], ["campFin", "fin"], ["campP1", "p1"], ["campP2", "p2"], ["campP3", "p3"]].forEach(function (x) {
      el(x[0]).oninput = el(x[0]).onchange = function () { campForm[x[1]] = this.value; };
    });
    function marcar(ids) { campForm.parts = ids; renderAdmin(); el("campSection").scrollIntoView(); }
    el("campAll").onclick = function () { marcar(data.usuarios.map(function (u) { return u.id; })); };
    el("campNone").onclick = function () { marcar([]); };
    el("campParts").onchange = function (e) {
      var cb = e.target; if (cb.type !== "checkbox") return;
      var i = campForm.parts.indexOf(cb.value);
      if (cb.checked && i < 0) campForm.parts.push(cb.value);
      if (!cb.checked && i >= 0) campForm.parts.splice(i, 1);
      cb.closest(".check").classList.toggle("on", cb.checked);
    };
    el("campCancel").onclick = function () { campForm = null; renderAdmin(); };
    el("campForm").onsubmit = function (e) {
      e.preventDefault();
      if (campForm.parts.length < 2) return toast(ERRORS.pocos_participantes);
      if (!campForm.inicio || !campForm.fin || campForm.fin < campForm.inicio) return toast(ERRORS.fechas_invalidas);
      if (!campForm.p1.trim()) return toast(ERRORS.premio_invalido);
      guard(async function () {
        must(await db.rpc("admin_guardar_torneo", { p_clave: adminClave, p_id: campForm.id, p_nombre: campForm.nombre, p_participantes: campForm.parts,
          p_inicio: campForm.inicio, p_fin: campForm.fin, p_premio1: campForm.p1, p_premio2: campForm.p2, p_premio3: campForm.p3 }));
        toast(campForm.id ? "Torneo guardado" : "Torneo creado");
        campForm = null; await reload(); renderAdmin();
      });
    };
  }

  function adminAction(act, id) {
    var base = { p_clave: adminClave };
    if (act === "jail") return openJail({ modo: "admin", usuario: id });
    if (act === "free") return liberar(id, true);
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
        var res = await servidor({ accion: "eliminar_usuario", clave: adminClave, usuario_id: id },
          async function () { must(await db.rpc("admin_eliminar_usuario", Object.assign(base, { p_usuario: id }))); });
        toast(msgBorrado("Usuario eliminado", res), 5000); await reload();
      });
    }
    var r = data.retos.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var name = r.meta + " · " + r.que_buscar;
    if (!confirm("¿Eliminar el reto «" + name + "»? Se borrarán sus fotos y sus puntos. No se puede deshacer.")) return;
    guard(async function () {
      var res = await servidor({ accion: "eliminar_reto", clave: adminClave, reto_id: id },
        async function () { must(await db.rpc("admin_eliminar_reto", Object.assign(base, { p_reto: id }))); });
      toast(msgBorrado("Reto eliminado", res), 5000); await reload();
    });
  }

  function exitAdmin() {
    adminClave = null; campForm = null;
    if (me) { view = "retos"; render(); } else { stopLive(); view = "login"; render(); }
  }

  start();
})();
