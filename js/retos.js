// Retos en familia
// Módulos: Usuarios (crear cuenta / entrar), Retos (jugar con fotos en el momento)
// y Administrador (clave propia: elimina usuarios y retos, cancela retos, restablece claves).
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
  var ESTADOS = { activo: "🔥 En marcha", terminado: "🏁 Terminado", cancelado: "⛔ Cancelado" };
  var ERRORS = {
    credenciales_incorrectas: "Usuario o clave incorrectos.",
    usuario_existe: "Ese usuario ya existe. Elige otro o entra con tu clave.",
    usuario_invalido: "El usuario debe tener de 3 a 20 letras o números, sin espacios ni tildes.",
    clave_corta: "La clave debe tener al menos 4 caracteres.",
    sesion_invalida: "Tu sesión terminó. Vuelve a entrar.",
    clave_admin_incorrecta: "Clave de administrador incorrecta.",
    ya_hay_reto_activo: "Ya hay un reto en marcha. Terminadlo primero.",
    reto_cerrado: "El reto ya se cerró. ¡Alguien llegó antes o se acabó el tiempo!",
    solo_quien_creo_el_reto: "Solo quien creó el reto puede cancelarlo.",
    duracion_invalida: "Elige una duración válida.",
    usuario_no_existe: "Ese usuario ya no existe.",
    reto_no_existe: "Ese reto ya no existe."
  };

  var $app = document.getElementById("app");
  var cfg = window.RETOS_CONFIG || {};
  var db = null;
  var token = load(TOKEN_KEY);
  var me = null;                 // usuario con sesión iniciada
  var view = "login";            // login | registro | juego | perfil | admin-login | admin
  var adminClave = null;         // solo en memoria
  var data = null;               // { usuarios, retos, puntajes, fotos }
  var busy = false;
  var draft = { emoji: "🎯", que: "", meta: 10, min: 60 };
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
  function activeReto() { return data && data.retos.filter(function (r) { return r.estado === "activo"; })[0]; }
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
    el("barTitle").textContent = view.indexOf("admin") === 0 ? "🛡️ Administrador" : "Retos en familia";
    el("barSub").hidden = !(me && (view === "juego" || view === "perfil"));
    el("barSub").textContent = me ? "@" + me.usuario : "";
    el("meBtn").hidden = !(me && (view === "juego" || view === "perfil"));
    if (me) el("meBtn").textContent = me.avatar;
  }

  // ------------------------------------------------------------ arranque
  async function start() {
    if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase) {
      $app.innerHTML = '<section class="card"><h2>Falta conectar la base de datos</h2><p>Revisa <code>js/retos-config.js</code>.</p></section>';
      return;
    }
    db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
    el("meBtn").onclick = function () { view = "perfil"; render(); };
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
    if (view === "perfil") return renderProfile();
    return renderGame();
  }

  // ============================================================ MÓDULO USUARIOS
  function renderLogin() {
    stopLive();
    $app.innerHTML =
      '<section class="hero"><div class="big-emoji bob">📸</div><h1>Retos en familia</h1>' +
      '<p class="sub">Alguien lanza un reto, todos salen a hacer fotos y el primero que llega a la meta gana.</p></section>' +
      '<section class="card"><h2>Entrar</h2>' +
      '<form id="loginForm" class="stack-form">' +
      '<input id="lUser" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Usuario" required>' +
      '<input id="lPass" type="password" autocomplete="current-password" placeholder="Clave" required>' +
      '<button class="btn primary wide">Entrar</button></form>' +
      '<p class="hint">¿Aún no tienes usuario?</p>' +
      '<button class="btn wide" id="goRegister">➕ Crear mi usuario</button></section>' +
      '<button class="btn ghost wide" id="goAdmin">🛡️ Entrar como administrador</button>';
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

  function renderProfile() {
    var p = { avatar: me.avatar };
    $app.innerHTML =
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
      '<button class="btn wide" id="back">← Volver a los retos</button>' +
      '<button class="btn ghost wide" id="logout">Cerrar sesión</button>';
    bindAvatarPicker("pAvatars", function (a) { p.avatar = a; });
    el("profForm").onsubmit = function (e) {
      e.preventDefault();
      guard(async function () {
        me = must(await db.rpc("editar_perfil", { p_token: token, p_nombre: el("pName").value, p_avatar: p.avatar }));
        toast("Perfil guardado"); view = "juego"; await reload();
      });
    };
    el("passForm").onsubmit = function (e) {
      e.preventDefault();
      guard(async function () {
        must(await db.rpc("cambiar_clave", { p_token: token, p_actual: el("pOld").value, p_nueva: el("pNew").value }));
        toast("Clave cambiada"); el("passForm").reset();
      });
    };
    el("back").onclick = function () { view = "juego"; render(); };
    el("logout").onclick = function () { logout(false); };
  }

  // ============================================================ DATOS EN VIVO
  async function enterGame() {
    view = "juego"; data = null; render();
    await reload();
    startLive();
  }

  async function reload() {
    try {
      await db.rpc("revisar_retos");
      var r = await Promise.all([
        db.from("usuarios").select("*").order("creado_en"),
        db.from("retos").select("*").order("inicia_en", { ascending: false }).limit(50),
        db.from("puntajes").select("*")
      ]);
      var next = { usuarios: must(r[0]), retos: must(r[1]), puntajes: must(r[2]), fotos: [] };
      var focus = next.retos.filter(function (x) { return x.estado === "activo"; })[0] || next.retos[0];
      if (focus) next.fotos = must(await db.from("fotos").select("*").eq("reto_id", focus.id).order("creado_en", { ascending: false }));
      if (me) {
        var fresh = next.usuarios.filter(function (u) { return u.id === me.id; })[0];
        if (!fresh) { data = next; logout(true); return; }   // el administrador eliminó este usuario
        me = fresh;
      }
      el("offline").hidden = true;
      var prev = data;
      data = next;
      if (view === "juego" || view === "perfil" || view === "admin") {
        if (view === "juego") celebrateIfNew(prev);
        if (!(view === "perfil" && prev)) render();   // no borrar lo que se escribe en el perfil
      }
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
    ["usuarios", "retos", "fotos", "puntajes"].forEach(function (t) {
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
    if (!document.hidden && data && (view === "juego" || view === "admin")) reload();
  });

  function updateClock() {
    var r = activeReto(), c = el("clock");
    if (!r || !c) return;
    var left = new Date(r.termina_en) - Date.now();
    c.textContent = fmtLeft(left);
    c.classList.toggle("hurry", left < 5 * 60000);
    if (left <= 0 && !updateClock.asked) { updateClock.asked = true; setTimeout(function () { updateClock.asked = false; reload(); }, 1500); }
  }

  function counts(retoId) {
    var c = {};
    data.fotos.forEach(function (f) { if (f.reto_id === retoId) c[f.usuario_id] = (c[f.usuario_id] || 0) + 1; });
    return c;
  }

  // ============================================================ MÓDULO RETOS
  function renderGame() {
    var r = activeReto();
    var html = r ? renderActive(r) : renderLastResult() + renderNewForm();
    html += renderRanking() + renderHistory();
    $app.innerHTML = html;
    bindGame(r);
    updateClock();
  }

  function renderActive(r) {
    var c = counts(r.id), mine = c[me.id] || 0;
    var rows = data.usuarios.slice().sort(function (a, b) { return (c[b.id] || 0) - (c[a.id] || 0); });
    var thumbs = data.fotos.filter(function (f) { return f.reto_id === r.id; });
    var creator = user(r.creado_por);
    return '<section class="card active">' +
      '<div class="tag">🔥 Reto en marcha</div>' +
      '<div class="big-emoji">' + esc(r.emoji) + '</div>' +
      '<h2>Gana el primero en conseguir <span class="goal">' + r.meta + ' fotos</span> de: <span class="goal">' + esc(r.que_buscar) + '</span></h2>' +
      '<p class="sub">Lo lanzó ' + esc(creator.avatar + " " + creator.nombre) + '</p>' +
      '<div class="clock-wrap">⏱️ <span id="clock"></span></div>' +
      '<div class="mine"><b>' + mine + '</b> / ' + r.meta + '<small>tus fotos</small></div>' +
      '<button class="btn camera' + (busy ? " busy" : "") + '" id="shot">' + (busy ? "Subiendo…" : "📸 Tomar foto") + '</button>' +
      '<p class="hint">Solo valen fotos hechas en el momento con la cámara del juego.</p>' +
      '<ul class="race">' + rows.map(function (u) {
        var n = c[u.id] || 0, pct = Math.min(100, Math.round(n / r.meta * 100));
        return '<li' + (u.id === me.id ? ' class="is-me"' : "") + '>' +
          '<span class="who">' + esc(u.avatar) + " " + esc(u.nombre) + '</span>' +
          '<span class="track"><i style="width:' + pct + '%"></i></span>' +
          '<span class="n">' + n + "/" + r.meta + '</span></li>';
      }).join("") + '</ul>' +
      (thumbs.length ? '<h3>Fotos del reto</h3><p class="hint">Toca una foto para verla. Si no aplica, se puede borrar.</p><div class="gallery">' + thumbs.map(thumb).join("") + '</div>' : "") +
      (r.creado_por === me.id ? '<button class="btn ghost" id="cancel">Cancelar reto</button>' : "") +
      '</section>';
  }

  function thumb(f) {
    var u = user(f.usuario_id);
    return '<button class="ph" data-id="' + f.id + '"><img loading="lazy" alt="" src="' + esc(photoUrl(f.ruta)) + '"><span>' + esc(u.avatar) + '</span></button>';
  }

  function renderLastResult() {
    var last = data.retos[0];
    if (!last || last.estado !== "terminado") return "";
    var w = last.ganador_id ? user(last.ganador_id) : null;
    var thumbs = data.fotos.filter(function (f) { return f.reto_id === last.id; });
    return '<section class="card result">' +
      '<div class="tag">Último reto · ' + esc(last.emoji) + " " + last.meta + " · " + esc(last.que_buscar) + '</div>' +
      (w ? '<div class="big-emoji">🏆' + esc(w.avatar) + '</div><h2>¡Ganó ' + esc(w.nombre) + '!</h2>' +
           '<p class="sub">' + (last.motivo === "meta" ? "Llegó primero a la meta" : "Se acabó el tiempo y tenía más fotos") + '</p>'
         : '<div class="big-emoji">⏰</div><h2>Se acabó el tiempo</h2><p class="sub">Nadie hizo fotos esta vez</p>') +
      (thumbs.length ? '<div class="gallery">' + thumbs.map(thumb).join("") + '</div>' : "") +
      '</section>';
  }

  function renderNewForm() {
    return '<section class="card">' +
      '<h2>🎯 Crear un reto nuevo</h2>' +
      '<p class="label">¿Cuál es el reto? Escribe lo que quieras fotografiar</p>' +
      '<div class="row"><input id="rEmoji" class="emoji-in" maxlength="4" value="' + esc(draft.emoji) + '" aria-label="Emoji">' +
      '<input id="rQue" maxlength="60" value="' + esc(draft.que) + '" placeholder="Ej: gente con sombrero"></div>' +
      '<p class="label">Ideas (toca una para usarla)</p>' +
      '<div class="chips" id="presets">' + PRESETS.map(function (p) {
        return '<button type="button" class="chip' + (p.que === draft.que ? " on" : "") + '" data-e="' + p.emoji + '" data-q="' + esc(p.que) + '">' + p.emoji + " " + esc(p.que) + '</button>';
      }).join("") + '</div>' +
      '<p class="label">¿Cuántas fotos hacen falta para ganar?</p>' +
      '<div class="stepper"><button type="button" class="btn" data-d="-1">−</button><b id="rMeta">' + draft.meta + '</b><button type="button" class="btn" data-d="1">+</button></div>' +
      '<p class="label">¿Cuánto dura el reto?</p>' +
      '<div class="chips" id="durs">' + DURATIONS.map(function (d) {
        return '<button type="button" class="chip' + (d.min === draft.min ? " on" : "") + '" data-m="' + d.min + '">' + d.label + '</button>';
      }).join("") + '</div>' +
      '<button class="btn primary wide" id="launch">🚀 ¡Lanzar reto a todos!</button>' +
      '</section>';
  }

  function renderRanking() {
    var pts = {}, wins = {};
    data.puntajes.forEach(function (p) {
      pts[p.usuario_id] = (pts[p.usuario_id] || 0) + p.puntos;
      if (p.puesto === 1) wins[p.usuario_id] = (wins[p.usuario_id] || 0) + 1;
    });
    var rows = data.usuarios.slice().sort(function (a, b) { return (pts[b.id] || 0) - (pts[a.id] || 0); });
    var medals = ["🥇", "🥈", "🥉"];
    return '<section class="card">' +
      '<h2>🏅 Clasificación</h2>' +
      '<ol class="ranking">' + rows.map(function (u, i) {
        return '<li' + (u.id === me.id ? ' class="is-me"' : "") + '><span class="pos">' + (medals[i] || i + 1) + '</span>' +
          '<span class="who">' + esc(u.avatar) + " " + esc(u.nombre) + '</span>' +
          '<span class="wins">' + (wins[u.id] ? "🏆×" + wins[u.id] : "") + '</span>' +
          '<span class="pts">' + (pts[u.id] || 0) + ' pts</span></li>';
      }).join("") + '</ol>' +
      '<p class="hint">Cada reto: 1º 3 pts · 2º 2 pts · 3º 1 pt. Para sumar a alguien, que abra este enlace y cree su usuario.</p>' +
      '<button class="btn ghost wide" id="invite">📤 Compartir el enlace del juego</button>' +
      '</section>';
  }

  function renderHistory() {
    var done = data.retos.filter(function (r) { return r.estado !== "activo"; });
    if (!done.length) return "";
    return '<section class="card"><h2>📜 Retos anteriores</h2><ul class="history">' +
      done.map(function (r) {
        var w = r.ganador_id ? user(r.ganador_id) : null;
        return '<li><span>' + esc(r.emoji) + " " + r.meta + " · " + esc(r.que_buscar) + '<small>' + fmtDate(r.inicia_en) + '</small></span>' +
          '<span>' + (r.estado === "cancelado" ? "Cancelado" : w ? "🏆 " + esc(w.avatar + " " + w.nombre) : "Sin ganador") + '</span></li>';
      }).join("") + '</ul></section>';
  }

  function bindGame(r) {
    $app.querySelectorAll(".ph").forEach(function (b) { b.onclick = function () { openViewer(b.dataset.id); }; });
    el("invite").onclick = invite;
    if (r) {
      el("shot").onclick = function () { openCamera(r); };
      if (el("cancel")) el("cancel").onclick = function () {
        if (!confirm("¿Cancelar el reto para todos? No se repartirán puntos.")) return;
        guard(async function () { must(await db.rpc("cancelar_reto", { p_token: token, p_reto: r.id })); await reload(); });
      };
      return;
    }
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
    el("launch").onclick = function () {
      if (!draft.que.trim()) { el("rQue").focus(); return toast("Escribe cuál es el reto"); }
      guard(async function () {
        must(await db.rpc("crear_reto", { p_token: token, p_que: draft.que, p_emoji: draft.emoji, p_meta: draft.meta, p_minutos: draft.min }));
        say("¡Reto lanzado! Gana el primero en conseguir " + draft.meta + " fotos de " + draft.que);
        draft.que = "";
        await reload();
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
  var cam = { stream: null, reto: null, facing: "environment", shot: null };
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
    var k = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    var cv = document.createElement("canvas");
    cv.width = Math.round(v.videoWidth * k); cv.height = Math.round(v.videoHeight * k);
    var g = cv.getContext("2d");
    if (cam.facing === "user") { g.translate(cv.width, 0); g.scale(-1, 1); }
    g.drawImage(v, 0, 0, cv.width, cv.height);
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
      if (!res.ganaste) {
        var left = r.meta - res.fotos;
        toast("¡Bien! " + res.fotos + " de " + r.meta + (left === 1 ? " · ¡te falta solo una!" : ""));
        say(left === 1 ? "¡Te falta solo una!" : "¡Llevas " + res.fotos + "!");
      }
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
    var u = user(f.usuario_id), r = activeReto();
    el("viewerImg").src = photoUrl(f.ruta);
    el("viewerCaption").textContent = u.avatar + " " + u.nombre + " · " + fmtDate(f.creado_en);
    el("viewerDelete").hidden = !(me && r && r.id === f.reto_id);
    el("viewerDelete").onclick = function () {
      var mine = f.usuario_id === me.id;
      if (!confirm(mine ? "¿Borrar tu foto? Dejará de contar." : "¿Borrar la foto de " + u.nombre + " porque no aplica? Dejará de contar.")) return;
      guard(async function () {
        must(await db.rpc("borrar_foto", { p_token: token, p_foto: f.id }));
        closeViewer(); await reload();
      });
    };
    el("viewer").hidden = false;
  }
  function closeViewer() { el("viewer").hidden = true; el("viewerImg").src = ""; }
  el("viewerClose").onclick = closeViewer;
  el("viewer").onclick = function (e) { if (e.target === this) closeViewer(); };

  // ------------------------------------------------------------ celebración
  function celebrateIfNew(prev) {
    var last = data.retos[0];
    if (!me || !last || last.estado !== "terminado") return;
    var seen = load(SEEN_KEY) || [];
    if (seen.indexOf(last.id) >= 0) return;
    seen.push(last.id); save(SEEN_KEY, seen.slice(-50));
    if (!prev && Date.now() - new Date(last.cerrado_en) > 6 * 3600000) return;
    var w = last.ganador_id ? user(last.ganador_id) : null;
    var mine = data.puntajes.filter(function (p) { return p.reto_id === last.id && p.usuario_id === me.id; })[0];
    var iWon = w && last.ganador_id === me.id;
    el("partyEmoji").textContent = iWon ? "🏆🎉" : w ? "🏁" + w.avatar : "⏰";
    el("partyTitle").textContent = iWon ? "¡Ganaste el reto!" : w ? "¡" + w.nombre + " ganó el reto!" : "Se acabó el tiempo";
    el("partyText").textContent = last.emoji + " " + last.meta + " · " + last.que_buscar + (mine ? " · Tú: " + mine.fotos + " fotos, +" + mine.puntos + " pts" : "");
    el("toast").hidden = true;
    el("party").hidden = false;
    say(iWon ? "¡Ganaste el reto!" : w ? w.nombre + " ganó el reto" : "Se acabó el tiempo");
    if (w) confetti();
  }
  el("partyClose").onclick = function () { el("party").hidden = true; };
  function confetti() {
    var bits = ["🎉", "⭐", "🐾", "🎈", "✨", "🏆"];
    for (var i = 0; i < 26; i++) {
      var s = document.createElement("span");
      s.className = "confetti"; s.textContent = bits[i % bits.length];
      s.style.left = Math.random() * 100 + "vw"; s.style.animationDelay = Math.random() * 0.8 + "s";
      document.body.appendChild(s);
      setTimeout(function (n) { n.remove(); }.bind(null, s), 3500);
    }
  }

  // ============================================================ MÓDULO ADMINISTRADOR
  function renderAdminLogin() {
    stopLive();
    $app.innerHTML =
      '<section class="card admin"><div class="tag admin-tag">🛡️ Administrador</div>' +
      '<h2>Entrar al módulo de administrador</h2>' +
      '<p class="sub">Desde aquí se eliminan usuarios y retos, se cancelan retos y se restablecen claves.</p>' +
      '<form id="admForm" class="stack-form">' +
      '<input id="admPass" type="password" autocomplete="off" placeholder="Clave de administrador" required>' +
      '<button class="btn primary wide">Entrar</button></form>' +
      '<button class="btn ghost wide" id="admBack">← Volver</button></section>';
    el("admPass").focus();
    el("admBack").onclick = exitAdmin;
    el("admForm").onsubmit = function (e) {
      e.preventDefault();
      var clave = el("admPass").value;
      guard(async function () {
        must(await db.rpc("admin_entrar", { p_clave: clave }));
        adminClave = clave; view = "admin"; data = null; render();
        await reload(); startLive();
        if (clave === "1234") toast("Recuerda cambiar la clave 1234 por una propia (abajo del todo).", 5000);
      });
    };
  }

  function renderAdmin() {
    var pts = {};
    data.puntajes.forEach(function (p) { pts[p.usuario_id] = (pts[p.usuario_id] || 0) + p.puntos; });
    $app.innerHTML =
      '<section class="card admin"><div class="tag admin-tag">🛡️ Módulo de administrador</div>' +
      '<h2>Retos</h2>' +
      '<p class="hint">Cancelar termina el reto para todos sin repartir puntos. Eliminar lo borra con sus fotos y puntos.</p>' +
      (data.retos.length ? '<ul class="admin-list">' + data.retos.map(function (r) {
        return '<li><div class="admin-info"><b>' + esc(r.emoji) + " " + r.meta + " · " + esc(r.que_buscar) + '</b>' +
          '<small>' + ESTADOS[r.estado] + " · " + fmtDate(r.inicia_en) + " · " + esc(user(r.creado_por).nombre) + '</small></div>' +
          '<div class="admin-actions">' +
          (r.estado === "activo" ? '<button class="btn small" data-act="cancel" data-id="' + r.id + '">Cancelar</button>' : "") +
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
      '<section class="card admin"><h2>Clave de administrador</h2>' +
      '<form id="admNewForm" class="row"><input id="admNew" type="password" autocomplete="new-password" placeholder="Nueva clave" required>' +
      '<button class="btn">Cambiar</button></form></section>' +
      '<button class="btn primary wide" id="admExit">Salir del administrador</button>';

    $app.querySelectorAll("[data-act]").forEach(function (b) { b.onclick = function () { adminAction(b.dataset.act, b.dataset.id); }; });
    el("admExit").onclick = exitAdmin;
    el("admNewForm").onsubmit = function (e) {
      e.preventDefault();
      var nueva = el("admNew").value;
      guard(async function () {
        must(await db.rpc("admin_cambiar_clave", { p_clave: adminClave, p_nueva: nueva }));
        adminClave = nueva; toast("Clave de administrador cambiada"); el("admNewForm").reset();
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
    if (!confirm(act === "cancel"
      ? "¿Cancelar el reto «" + name + "» para todos? No se repartirán puntos."
      : "¿Eliminar el reto «" + name + "»? Se borrarán sus fotos y sus puntos. No se puede deshacer.")) return;
    guard(async function () {
      must(await db.rpc(act === "cancel" ? "admin_cancelar_reto" : "admin_eliminar_reto", Object.assign(base, { p_reto: id })));
      toast(act === "cancel" ? "Reto cancelado" : "Reto eliminado"); await reload();
    });
  }

  function exitAdmin() {
    adminClave = null;
    if (me) enterGame(); else { stopLive(); view = "login"; render(); }
  }

  start();
})();
