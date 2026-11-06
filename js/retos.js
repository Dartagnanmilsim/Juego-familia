// Retos en familia: alguien lanza un reto ("el primero que encuentre 10 perros
// negros"), todos los de la familia lo ven al instante, cada uno sube fotos
// y el primero que llega a la meta cierra el reto y se lleva los puntos.
(function () {
  "use strict";

  var BUCKET = "retos-fotos";
  var SESSION_KEY = "retos_sesion";
  var SEEN_KEY = "retos_vistos";
  var AVATARS = ["👩", "👨", "👧", "👦", "🧒", "👵", "👴", "🧑", "👶", "🦸", "🧙", "🐱", "🐶", "🦊", "🐼", "🦁"];
  var PRESETS = [
    { emoji: "🐕", que: "perros negros" },
    { emoji: "🚗", que: "coches rojos" },
    { emoji: "🐈", que: "gatos" },
    { emoji: "🌸", que: "flores amarillas" },
    { emoji: "🚲", que: "bicicletas" },
    { emoji: "🐦", que: "pájaros" }
  ];
  var DURATIONS = [
    { min: 15, label: "15 min" }, { min: 30, label: "30 min" }, { min: 60, label: "1 hora" },
    { min: 180, label: "3 horas" }, { min: 1440, label: "1 día" }, { min: 10080, label: "1 semana" }
  ];
  var ERRORS = {
    ya_hay_reto_activo: "Ya hay un reto en marcha. Terminadlo primero.",
    reto_cerrado: "El reto ya se cerró. ¡Alguien llegó antes o se acabó el tiempo!",
    solo_quien_creo_el_reto: "Solo quien creó el reto puede cancelarlo.",
    jugador_no_existe: "No encontramos tu jugador. Vuelve a unirte a la familia.",
    duracion_invalida: "Elige una duración válida.",
    pin_incorrecto: "PIN incorrecto.",
    pin_invalido: "El PIN debe tener de 4 a 8 números.",
    pin_sin_definir: "Primero crea tu PIN de administrador.",
    no_eres_admin: "Este jugador no es administrador.",
    ultimo_admin: "Tiene que quedar al menos un administrador en la familia.",
    reto_no_existe: "Ese reto ya no existe."
  };
  // Modo administrador: el PIN solo se guarda en memoria mientras la página está abierta.
  var admin = { open: false, pin: null, hasPin: null };

  var $app = document.getElementById("app");
  var cfg = window.RETOS_CONFIG || {};
  var db = null;
  var session = load(SESSION_KEY) || {};
  var data = null;             // { familia, jugadores, retos, puntajes, fotos }
  var channel = null;
  var reloadTimer = null;
  var tick = null;
  var busy = false;
  var draft = { emoji: "🎯", que: "", meta: 10, min: 60 };
  var addingPlayer = null;   // borrador del formulario "Agregar jugador"

  // ------------------------------------------------------------ utilidades
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  function toast(msg, ms) {
    var t = el("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.hidden = true; }, ms || 3200);
  }
  function errMsg(e) {
    var m = (e && (e.message || e.error_description || e.error)) || String(e);
    for (var k in ERRORS) if (m.indexOf(k) >= 0) return ERRORS[k];
    if (/fetch|network|Failed/i.test(m)) return "Sin conexión. Inténtalo de nuevo.";
    return "Algo salió mal: " + m;
  }
  function must(res) { if (res.error) throw res.error; return res.data; }
  function photoUrl(ruta) { return db.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl; }
  function player(id) {
    return (data && data.jugadores.filter(function (j) { return j.id === id; })[0]) ||
      { nombre: "Alguien", avatar: "🙂" };
  }
  function activeReto() {
    return data && data.retos.filter(function (r) { return r.estado === "activo"; })[0];
  }
  function fmtLeft(ms) {
    if (ms <= 0) return "¡Tiempo!";
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600),
        m = Math.floor(s % 3600 / 60), ss = s % 60;
    function p(n) { return n < 10 ? "0" + n : n; }
    if (d) return d + "d " + h + "h " + p(m) + "m";
    if (h) return h + ":" + p(m) + ":" + p(ss);
    return p(m) + ":" + p(ss);
  }
  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }
  function say(text) {
    if (!("speechSynthesis" in window)) return;
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "es-ES"; u.rate = 1; u.pitch = 1.1;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  // ------------------------------------------------------------ arranque
  function start() {
    if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase) return renderSetupNeeded();
    db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // Enlace de invitación: retos.html?familia=K7M2QD
    var inv = new URLSearchParams(location.search).get("familia");
    if (inv && (!session.codigo || session.codigo !== inv.toUpperCase())) {
      session = { codigo: inv.toUpperCase() };
      save(SESSION_KEY, session);
      history.replaceState(null, "", location.pathname);
    }

    if (session.jugadorId && session.familiaId) return enterFamily();
    if (session.codigo) return joinByCode(session.codigo, true);
    renderWelcome();
  }

  function renderSetupNeeded() {
    $app.innerHTML =
      '<section class="card">' +
      '<div class="big-emoji">🛠️</div>' +
      '<h2>Falta conectar la base de datos</h2>' +
      '<p>Este juego guarda los retos y las fotos en línea con <b>Supabase</b> (gratis).</p>' +
      '<ol class="steps">' +
      '<li>Crea un proyecto en supabase.com</li>' +
      '<li>En <b>SQL Editor</b> ejecuta el archivo <code>supabase/retos.sql</code></li>' +
      '<li>Copia la <b>Project URL</b> y la <b>publishable key</b> en <code>js/retos-config.js</code></li>' +
      '</ol></section>';
  }

  // ------------------------------------------------------------ bienvenida
  function renderWelcome() {
    stopLive();
    el("familyName").textContent = "Retos en familia";
    el("familyCode").hidden = true; el("meBtn").hidden = true;
    $app.innerHTML =
      '<section class="hero"><div class="big-emoji bob">🐕‍🦺📸</div>' +
      '<h1>Retos en familia</h1>' +
      '<p class="sub">Alguien lanza un reto, todos salen a buscar y hacen fotos. ¡El primero que llega a la meta gana!</p></section>' +
      '<section class="card">' +
      '<h2>Unirme a mi familia</h2>' +
      '<form id="joinForm" class="row">' +
      '<input id="joinCode" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="Código (ej. K7M2QD)" required>' +
      '<button class="btn primary">Entrar</button></form>' +
      '</section>' +
      '<section class="card">' +
      '<h2>Crear una familia nueva</h2>' +
      '<form id="newForm" class="row">' +
      '<input id="newName" maxlength="40" placeholder="Nombre (ej. Los Martínez)" required>' +
      '<button class="btn">Crear</button></form>' +
      '</section>';

    el("joinForm").onsubmit = function (e) { e.preventDefault(); joinByCode(el("joinCode").value); };
    el("newForm").onsubmit = function (e) {
      e.preventDefault();
      guard(async function () {
        var f = must(await db.rpc("crear_familia", { p_nombre: el("newName").value }));
        session = { codigo: f.codigo, familiaId: f.id };
        save(SESSION_KEY, session);
        renderProfile(f, null);
      });
    };
  }

  function joinByCode(code, silent) {
    guard(async function () {
      var f = must(await db.rpc("buscar_familia", { p_codigo: code }));
      if (Array.isArray(f)) f = f[0];
      if (!f || !f.id) {
        session = {}; save(SESSION_KEY, session);
        if (silent) renderWelcome();
        toast("No existe ninguna familia con el código " + String(code).toUpperCase());
        return;
      }
      session = { codigo: f.codigo, familiaId: f.id };
      save(SESSION_KEY, session);
      renderProfile(f, null);
    });
  }

  // ------------------------------------------------------------ perfil
  function renderProfile(familia, me) {
    stopLive();
    var avatar = (me && me.avatar) || AVATARS[0];
    var others = [];
    $app.innerHTML =
      '<section class="card">' +
      '<p class="sub">Familia <b>' + esc(familia.nombre) + '</b> · código <b>' + esc(familia.codigo) + '</b></p>' +
      '<h2>' + (me ? "Mi perfil" : "¿Quién eres?") + '</h2>' +
      '<div id="existing"></div>' +
      '<form id="profForm">' +
      '<input id="profName" maxlength="30" placeholder="Tu nombre" required value="' + esc(me ? me.nombre : "") + '">' +
      '<p class="label">Elige tu avatar</p>' +
      '<div class="avatars" id="avatars">' + AVATARS.map(function (a) {
        return '<button type="button" class="av' + (a === avatar ? " on" : "") + '" data-a="' + a + '">' + a + '</button>';
      }).join("") + '</div>' +
      '<button class="btn primary wide">' + (me ? "Guardar" : "¡A jugar!") + '</button>' +
      '</form>' +
      (me ? '<button id="leave" class="btn ghost wide">Salir de esta familia en este móvil</button>' : '') +
      '</section>';

    el("avatars").onclick = function (e) {
      var b = e.target.closest(".av"); if (!b) return;
      avatar = b.dataset.a;
      [].forEach.call(this.children, function (c) { c.classList.toggle("on", c === b); });
    };
    el("profForm").onsubmit = function (e) {
      e.preventDefault();
      guard(async function () {
        var name = el("profName").value;
        var j = me
          ? must(await db.rpc("editar_jugador", { p_jugador: me.id, p_nombre: name, p_avatar: avatar }))
          : must(await db.rpc("unirse_familia", { p_familia: familia.id, p_nombre: name, p_avatar: avatar }));
        session.jugadorId = j.id; session.familiaId = familia.id; session.codigo = familia.codigo;
        save(SESSION_KEY, session);
        enterFamily();
      });
    };
    if (me) {
      el("leave").onclick = function () {
        if (!confirm("¿Salir de la familia en este móvil? Podrás volver a entrar con el código.")) return;
        session = {}; save(SESSION_KEY, session); renderWelcome();
      };
    } else {
      // Si ya jugaste antes en otro móvil, puedes elegirte en la lista
      db.from("jugadores").select("*").eq("familia_id", familia.id).order("creado_en").then(function (res) {
        others = res.data || [];
        if (!others.length || !el("existing")) return;
        el("existing").innerHTML = '<p class="label">¿Ya estás en la familia? Tócate:</p><div class="chips">' +
          others.map(function (j) {
            return '<button type="button" class="chip" data-id="' + j.id + '">' + esc(j.avatar) + " " + esc(j.nombre) + '</button>';
          }).join("") + '</div><p class="label">o crea un jugador nuevo:</p>';
        el("existing").onclick = function (e) {
          var b = e.target.closest(".chip"); if (!b) return;
          session.jugadorId = b.dataset.id; session.familiaId = familia.id; session.codigo = familia.codigo;
          save(SESSION_KEY, session);
          enterFamily();
        };
      });
    }
  }

  // ------------------------------------------------------------ familia
  async function enterFamily() {
    $app.innerHTML = '<p class="loading">Cargando…</p>';
    await reload();
    if (!data) return;
    startLive();
  }

  async function reload() {
    try {
      var fid = session.familiaId;
      await db.rpc("revisar_retos", { p_familia: fid });   // cierra retos vencidos
      var r = await Promise.all([
        db.from("familias").select("*").eq("id", fid).maybeSingle(),
        db.from("jugadores").select("*").eq("familia_id", fid).order("creado_en"),
        db.from("retos").select("*").eq("familia_id", fid).order("inicia_en", { ascending: false }).limit(30),
        db.from("puntajes").select("*").eq("familia_id", fid)
      ]);
      var familia = must(r[0]);
      if (!familia) { session = {}; save(SESSION_KEY, session); toast("Esa familia ya no existe"); return renderWelcome(); }
      var next = { familia: familia, jugadores: must(r[1]), retos: must(r[2]), puntajes: must(r[3]), fotos: [] };
      var focus = next.retos[0];
      if (focus) {
        next.fotos = must(await db.from("fotos").select("*").eq("reto_id", focus.id).order("creado_en", { ascending: false }));
      }
      if (!next.jugadores.some(function (j) { return j.id === session.jugadorId; })) {
        session.jugadorId = null; save(SESSION_KEY, session);
        return renderProfile(familia, null);
      }
      el("offline").hidden = true;
      var prev = data;
      data = next;
      celebrateIfNew(prev);
      renderFamily();
    } catch (e) {
      el("offline").hidden = false;
      if (!data) $app.innerHTML = '<section class="card"><p>' + esc(errMsg(e)) + '</p><button class="btn" id="retry">Reintentar</button></section>';
      if (el("retry")) el("retry").onclick = enterFamily;
    }
  }

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(reload, 350);
  }

  // Tiempo real: cualquier cambio de la familia vuelve a cargar los datos
  function startLive() {
    stopLive();
    var fid = session.familiaId;
    var filter = "familia_id=eq." + fid;
    channel = db.channel("familia-" + fid);
    ["jugadores", "retos", "fotos", "puntajes"].forEach(function (t) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: t, filter: filter }, scheduleReload);
    });
    channel.subscribe();
    // Respaldo por si el móvil corta la conexión en segundo plano
    startLive.poll = setInterval(reload, 30000);
    tick = setInterval(updateClock, 1000);
  }
  function stopLive() {
    if (channel) { try { db.removeChannel(channel); } catch (e) {} channel = null; }
    clearInterval(startLive.poll); clearInterval(tick);
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && data && session.jugadorId) reload();
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
    data.fotos.forEach(function (f) { if (f.reto_id === retoId) c[f.jugador_id] = (c[f.jugador_id] || 0) + 1; });
    return c;
  }

  function renderFamily() {
    var me = player(session.jugadorId);
    el("familyName").textContent = data.familia.nombre;
    el("familyCode").hidden = false;
    el("familyCode").textContent = "Código " + data.familia.codigo;
    el("meBtn").hidden = false;
    el("meBtn").textContent = me.avatar;

    if (admin.open && me.es_admin) { renderAdmin(); return; }
    admin.open = false;

    var r = activeReto();
    var html = r ? renderActive(r) : renderLastResult() + renderNewForm();
    html += renderPlayers() + renderRanking() + renderHistory();
    $app.innerHTML = html;
    bindFamily(r);
    updateClock();
  }

  function renderActive(r) {
    var c = counts(r.id);
    var mine = c[session.jugadorId] || 0;
    var rows = data.jugadores.slice().sort(function (a, b) { return (c[b.id] || 0) - (c[a.id] || 0); });
    var thumbs = data.fotos.filter(function (f) { return f.reto_id === r.id; });
    return '<section class="card active">' +
      '<div class="tag">🔥 Reto en marcha</div>' +
      '<div class="big-emoji">' + esc(r.emoji) + '</div>' +
      '<h2>Gana el primero en conseguir <span class="goal">' + r.meta + ' fotos</span> de: <span class="goal">' + esc(r.que_buscar) + '</span></h2>' +
      '<p class="sub">Lo lanzó ' + esc(player(r.creado_por).avatar + " " + player(r.creado_por).nombre) + '</p>' +
      '<div class="clock-wrap">⏱️ <span id="clock"></span></div>' +
      '<div class="mine"><b>' + mine + '</b> / ' + r.meta + '<small>tus fotos</small></div>' +
      '<button class="btn camera' + (busy ? " busy" : "") + '" id="shot">' + (busy ? "Subiendo…" : "📸 Tomar foto") + '</button>' +
      '<p class="hint">Solo valen fotos hechas en el momento con la cámara del juego.</p>' +
      '<ul class="race">' + rows.map(function (j) {
        var n = c[j.id] || 0, pct = Math.min(100, Math.round(n / r.meta * 100));
        return '<li' + (j.id === session.jugadorId ? ' class="is-me"' : "") + '>' +
          '<span class="who">' + esc(j.avatar) + " " + esc(j.nombre) + '</span>' +
          '<span class="track"><i style="width:' + pct + '%"></i></span>' +
          '<span class="n">' + n + "/" + r.meta + '</span></li>';
      }).join("") + '</ul>' +
      (thumbs.length ? '<h3>Fotos del reto</h3><div class="gallery">' + thumbs.map(thumb).join("") + '</div>' : "") +
      (r.creado_por === session.jugadorId ? '<button class="btn ghost" id="cancel">Cancelar reto</button>' : "") +
      '</section>';
  }

  function thumb(f) {
    var p = player(f.jugador_id);
    return '<button class="ph" data-id="' + f.id + '"><img loading="lazy" alt="" src="' + esc(photoUrl(f.ruta)) + '">' +
      '<span>' + esc(p.avatar) + '</span></button>';
  }

  function renderLastResult() {
    var last = data.retos[0];
    if (!last || last.estado !== "terminado") return "";
    var w = last.ganador_id ? player(last.ganador_id) : null;
    var thumbs = data.fotos.filter(function (f) { return f.reto_id === last.id; });
    return '<section class="card result">' +
      '<div class="tag">Último reto · ' + esc(last.emoji) + " " + last.meta + " " + esc(last.que_buscar) + '</div>' +
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
      '<button class="btn primary wide" id="launch">🚀 ¡Lanzar reto a la familia!</button>' +
      '</section>';
  }

  function renderPlayers() {
    var a = addingPlayer;
    return '<section class="card">' +
      '<h2>👨‍👩‍👧‍👦 Jugadores</h2>' +
      '<p class="hint">Juegas como <b>' + esc(player(session.jugadorId).avatar + " " + player(session.jugadorId).nombre) + '</b>. Si varios comparten este móvil, toca a otro para jugar como él.</p>' +
      '<div class="chips" id="players">' + data.jugadores.map(function (j) {
        return '<button type="button" class="chip' + (j.id === session.jugadorId ? " on" : "") + '" data-id="' + j.id + '">' + esc(j.avatar) + " " + esc(j.nombre) + (j.es_admin ? " 👑" : "") + '</button>';
      }).join("") + '</div>' +
      '<p class="hint">👑 = administrador: puede cancelar o eliminar retos.</p>' +
      (player(session.jugadorId).es_admin ? '<button class="btn wide admin-btn" id="adminOpen">🛡️ Modo administrador</button>' : "") +
      (a ? '<form id="addForm" class="add-player">' +
        '<input id="addName" maxlength="30" placeholder="Nombre del jugador" required value="' + esc(a.nombre) + '">' +
        '<div class="avatars" id="addAvatars">' + AVATARS.map(function (x) {
          return '<button type="button" class="av' + (x === a.avatar ? " on" : "") + '" data-a="' + x + '">' + x + '</button>';
        }).join("") + '</div>' +
        '<div class="row"><button type="button" class="btn ghost" id="addCancel">Cancelar</button><button class="btn primary">Crear jugador</button></div>' +
        '</form>'
        : '<button class="btn ghost wide" id="addPlayer">➕ Agregar jugador</button>') +
      '</section>';
  }

  function renderRanking() {
    var pts = {}, wins = {};
    data.puntajes.forEach(function (p) {
      pts[p.jugador_id] = (pts[p.jugador_id] || 0) + p.puntos;
      if (p.puesto === 1) wins[p.jugador_id] = (wins[p.jugador_id] || 0) + 1;
    });
    var rows = data.jugadores.slice().sort(function (a, b) { return (pts[b.id] || 0) - (pts[a.id] || 0); });
    var medals = ["🥇", "🥈", "🥉"];
    return '<section class="card">' +
      '<h2>🏅 Clasificación</h2>' +
      '<ol class="ranking">' + rows.map(function (j, i) {
        return '<li' + (j.id === session.jugadorId ? ' class="is-me"' : "") + '><span class="pos">' + (medals[i] || i + 1) + '</span>' +
          '<span class="who">' + esc(j.avatar) + " " + esc(j.nombre) + '</span>' +
          '<span class="wins">' + (wins[j.id] ? "🏆×" + wins[j.id] : "") + '</span>' +
          '<span class="pts">' + (pts[j.id] || 0) + ' pts</span></li>';
      }).join("") + '</ol>' +
      '<p class="hint">Cada reto: 1º 3 pts · 2º 2 pts · 3º 1 pt</p>' +
      '<button class="btn ghost wide" id="invite">➕ Invitar a la familia</button>' +
      '</section>';
  }

  function renderHistory() {
    var done = data.retos.filter(function (r) { return r.estado !== "activo"; });
    if (!done.length) return "";
    return '<section class="card"><h2>📜 Retos anteriores</h2><ul class="history">' +
      done.map(function (r) {
        var w = r.ganador_id ? player(r.ganador_id) : null;
        return '<li><span>' + esc(r.emoji) + " " + r.meta + " " + esc(r.que_buscar) + '<small>' + fmtDate(r.inicia_en) + '</small></span>' +
          '<span>' + (r.estado === "cancelado" ? "Cancelado" : w ? "🏆 " + esc(w.avatar + " " + w.nombre) : "Sin ganador") + '</span></li>';
      }).join("") + '</ul></section>';
  }

  // ------------------------------------------------------------ eventos
  function bindFamily(r) {
    el("meBtn").onclick = function () { renderProfile(data.familia, player(session.jugadorId)); };
    el("familyCode").onclick = el("invite").onclick = invite;

    $app.querySelectorAll(".ph").forEach(function (b) { b.onclick = function () { openViewer(b.dataset.id); }; });
    bindPlayers();

    if (r) {
      el("shot").onclick = function () { openCamera(r); };
      if (el("cancel")) el("cancel").onclick = function () {
        if (!confirm("¿Cancelar el reto para todos? No se repartirán puntos.")) return;
        guard(async function () { must(await db.rpc("cancelar_reto", { p_reto: r.id, p_jugador: session.jugadorId })); await reload(); });
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
      b.onclick = function () {
        draft.meta = Math.max(1, Math.min(100, draft.meta + Number(b.dataset.d)));
        el("rMeta").textContent = draft.meta;
      };
    });
    el("durs").onclick = function (e) {
      var b = e.target.closest(".chip"); if (!b) return;
      draft.min = Number(b.dataset.m);
      [].forEach.call(this.children, function (c) { c.classList.toggle("on", c === b); });
    };
    el("launch").onclick = function () {
      if (!draft.que.trim()) { el("rQue").focus(); return toast("Escribe cuál es el reto"); }
      guard(async function () {
        must(await db.rpc("crear_reto", {
          p_jugador: session.jugadorId, p_que: draft.que, p_emoji: draft.emoji, p_meta: draft.meta, p_minutos: draft.min
        }));
        say("¡Reto lanzado! El primero que encuentre " + draft.meta + " " + draft.que + " gana");
        await reload();
      });
    };
  }

  function bindPlayers() {
    el("players").onclick = function (e) {
      var b = e.target.closest(".chip"); if (!b || b.dataset.id === session.jugadorId) return;
      session.jugadorId = b.dataset.id; save(SESSION_KEY, session);
      admin = { open: false, pin: null, hasPin: null };
      toast("Ahora juegas como " + player(b.dataset.id).avatar + " " + player(b.dataset.id).nombre);
      renderFamily();
    };
    if (el("adminOpen")) el("adminOpen").onclick = function () {
      guard(async function () {
        admin.hasPin = must(await db.rpc("admin_tiene_pin", { p_admin: session.jugadorId }));
        admin.open = true;
        renderFamily();
        window.scrollTo(0, 0);
      });
    };
    if (el("addPlayer")) el("addPlayer").onclick = function () {
      addingPlayer = { nombre: "", avatar: AVATARS[0] }; renderFamily(); el("addName").focus();
    };
    if (!el("addForm")) return;
    el("addName").oninput = function () { addingPlayer.nombre = this.value; };
    el("addAvatars").onclick = function (e) {
      var b = e.target.closest(".av"); if (!b) return;
      addingPlayer.avatar = b.dataset.a;
      [].forEach.call(this.children, function (c) { c.classList.toggle("on", c === b); });
    };
    el("addCancel").onclick = function () { addingPlayer = null; renderFamily(); };
    el("addForm").onsubmit = function (e) {
      e.preventDefault();
      guard(async function () {
        var j = must(await db.rpc("unirse_familia", {
          p_familia: data.familia.id, p_nombre: addingPlayer.nombre, p_avatar: addingPlayer.avatar
        }));
        addingPlayer = null;
        toast("Jugador creado: " + j.avatar + " " + j.nombre);
        await reload();
      });
    };
  }

  // ------------------------------------------------------------ administrador
  var ESTADOS = { activo: "🔥 En marcha", terminado: "🏁 Terminado", cancelado: "⛔ Cancelado" };

  function renderAdmin() {
    var me = player(session.jugadorId);
    var html = '<section class="card admin">' +
      '<div class="tag admin-tag">🛡️ Modo administrador</div>' +
      '<h2>' + esc(me.avatar + " " + me.nombre) + ' 👑</h2>';

    if (!admin.pin) {
      html += admin.hasPin
        ? '<p class="sub">Escribe tu PIN para administrar los retos.</p>' +
          '<form id="pinForm" class="stack-form"><input id="pin1" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="PIN" required>' +
          '<button class="btn primary wide">Entrar</button></form>'
        : '<p class="sub">Crea un PIN de 4 a 8 números. Te lo pedirá cada vez que entres a administrar, así nadie más puede hacerlo desde tu perfil.</p>' +
          '<form id="pinForm" class="stack-form"><input id="pin1" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="Nuevo PIN" required>' +
          '<input id="pin2" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="Repite el PIN" required>' +
          '<button class="btn primary wide">Crear PIN y entrar</button></form>';
      html += '<button class="btn ghost wide" id="adminExit">Volver al juego</button></section>';
      $app.innerHTML = html;
      el("adminExit").onclick = exitAdmin;
      el("pinForm").onsubmit = function (e) {
        e.preventDefault();
        var pin = el("pin1").value.trim();
        if (!admin.hasPin && pin !== el("pin2").value.trim()) return toast("Los dos PIN no coinciden");
        guard(async function () {
          if (admin.hasPin) must(await db.rpc("admin_entrar", { p_admin: session.jugadorId, p_pin: pin }));
          else must(await db.rpc("admin_definir_pin", { p_admin: session.jugadorId, p_pin_actual: null, p_pin_nuevo: pin }));
          admin.pin = pin; admin.hasPin = true;
          toast("Modo administrador activado");
          renderFamily();
        });
      };
      el("pin1").focus();
      return;
    }

    html += '<p class="sub">Cancelar un reto lo termina para todos sin repartir puntos. Eliminarlo lo borra por completo, con sus fotos y sus puntos.</p>';
    html += '<h3>Retos</h3>' + (data.retos.length ? '<ul class="admin-list">' + data.retos.map(function (r) {
      return '<li><div class="admin-info"><b>' + esc(r.emoji) + " " + r.meta + " · " + esc(r.que_buscar) + '</b>' +
        '<small>' + ESTADOS[r.estado] + " · " + fmtDate(r.inicia_en) + " · lo creó " + esc(player(r.creado_por).nombre) + '</small></div>' +
        '<div class="admin-actions">' +
        (r.estado === "activo" ? '<button class="btn small" data-act="cancel" data-id="' + r.id + '">Cancelar</button>' : "") +
        '<button class="btn small danger" data-act="delete" data-id="' + r.id + '">Eliminar</button></div></li>';
    }).join("") + '</ul>' : '<p class="hint">Todavía no hay retos.</p>');

    html += '<h3>Administradores</h3><ul class="admin-list">' + data.jugadores.map(function (j) {
      return '<li><div class="admin-info"><b>' + esc(j.avatar + " " + j.nombre) + (j.es_admin ? " 👑" : "") + '</b></div>' +
        '<div class="admin-actions">' + (j.id === session.jugadorId ? '<small>Tú</small>' :
          '<button class="btn small' + (j.es_admin ? " ghost" : "") + '" data-act="role" data-id="' + j.id + '" data-v="' + (!j.es_admin) + '">' +
          (j.es_admin ? "Quitar admin" : "Hacer admin") + '</button>') + '</div></li>';
    }).join("") + '</ul>';

    html += '<h3>Cambiar mi PIN</h3><form id="newPinForm" class="row">' +
      '<input id="newPin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="Nuevo PIN" required>' +
      '<button class="btn">Guardar</button></form>' +
      '<button class="btn primary wide" id="adminExit">Salir del modo administrador</button></section>';
    $app.innerHTML = html;

    el("adminExit").onclick = exitAdmin;
    $app.querySelectorAll("[data-act]").forEach(function (b) {
      b.onclick = function () { adminAction(b.dataset.act, b.dataset.id, b.dataset.v === "true"); };
    });
    el("newPinForm").onsubmit = function (e) {
      e.preventDefault();
      var pin = el("newPin").value.trim();
      guard(async function () {
        must(await db.rpc("admin_definir_pin", { p_admin: session.jugadorId, p_pin_actual: admin.pin, p_pin_nuevo: pin }));
        admin.pin = pin; toast("PIN cambiado"); renderFamily();
      });
    };
  }

  function adminAction(act, id, value) {
    var base = { p_admin: session.jugadorId, p_pin: admin.pin };
    if (act === "role") {
      var j = player(id);
      if (!confirm(value ? "¿Hacer administrador a " + j.nombre + "? Tendrá que crear su propio PIN." : "¿Quitar el papel de administrador a " + j.nombre + "?")) return;
      return guard(async function () {
        must(await db.rpc("admin_cambiar_rol", Object.assign(base, { p_jugador: id, p_es_admin: value })));
        await reload();
      });
    }
    var r = data.retos.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var name = r.meta + " " + r.que_buscar;
    var q = act === "cancel"
      ? "¿Cancelar el reto «" + name + "» para todos? No se repartirán puntos."
      : "¿Eliminar el reto «" + name + "»? Se borrarán sus fotos y sus puntos de la clasificación. No se puede deshacer.";
    if (!confirm(q)) return;
    guard(async function () {
      must(await db.rpc(act === "cancel" ? "admin_cancelar_reto" : "admin_eliminar_reto", Object.assign(base, { p_reto: id })));
      toast(act === "cancel" ? "Reto cancelado" : "Reto eliminado");
      await reload();
    });
  }

  function exitAdmin() {
    admin = { open: false, pin: null, hasPin: null };
    renderFamily();
  }

  function invite() {
    var url = location.origin + location.pathname + "?familia=" + data.familia.codigo;
    var text = "¡Únete a los retos de la familia " + data.familia.nombre + "! Código: " + data.familia.codigo;
    if (navigator.share) {
      navigator.share({ title: "Retos en familia", text: text, url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text + "\n" + url).then(function () { toast("Invitación copiada 📋"); });
    } else {
      prompt("Comparte este enlace:", url);
    }
  }

  // ------------------------------------------------------------ cámara en vivo
  // Las fotos solo se hacen aquí, en el momento: no hay forma de adjuntar archivos.
  var cam = { stream: null, reto: null, facing: "environment", shot: null };

  function camMsg(text) {
    el("camMsg").textContent = text || "";
    el("camMsg").hidden = !text;
  }

  async function startStream() {
    if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
    cam.stream = null;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      camMsg("Este navegador no deja usar la cámara aquí. Abre el juego en Safari o Chrome desde su enlace https.");
      return;
    }
    try {
      cam.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: cam.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      var v = el("camVideo");
      v.srcObject = cam.stream;
      v.classList.toggle("mirror", cam.facing === "user");
      await v.play().catch(function () {});
      camMsg("");
      el("camShutter").disabled = false;
    } catch (e) {
      el("camShutter").disabled = true;
      if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
        camMsg("No hay permiso para la cámara. Toca el icono «aA» o el candado junto a la dirección, permite la Cámara y vuelve a intentarlo.");
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
    el("camPreview").hidden = true; el("camLive").hidden = false;
    el("camera").hidden = false;
    el("camTitle").textContent = r.emoji + " " + r.que_buscar;
    startStream();
  }

  function closeCamera() {
    if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
    cam.stream = null; cam.shot = null;
    el("camVideo").srcObject = null;
    el("camera").hidden = true;
  }

  function takePhoto() {
    var v = el("camVideo");
    if (!v.videoWidth) return;
    var max = 1280, k = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
    var cv = document.createElement("canvas");
    cv.width = Math.round(v.videoWidth * k); cv.height = Math.round(v.videoHeight * k);
    var g = cv.getContext("2d");
    if (cam.facing === "user") { g.translate(cv.width, 0); g.scale(-1, 1); }
    g.drawImage(v, 0, 0, cv.width, cv.height);
    cv.toBlob(function (b) {
      if (!b) return;
      cam.shot = b;
      el("camImg").src = URL.createObjectURL(b);
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
    closeCamera();
    upload(r, b);
  };

  async function upload(r, blob) {
    if (busy) return;
    busy = true; renderFamily();
    try {
      var type = blob.type && /^image\/(jpeg|png|webp)$/.test(blob.type) ? blob.type : "image/jpeg";
      var ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
      var ruta = r.familia_id + "/" + r.id + "/" + session.jugadorId + "/" + Date.now() + "." + ext;
      must(await db.storage.from(BUCKET).upload(ruta, blob, { contentType: type, upsert: false }));
      var res = must(await db.rpc("registrar_foto", { p_reto: r.id, p_jugador: session.jugadorId, p_ruta: ruta }));
      if (!res.ganaste) {
        var left = r.meta - res.fotos;
        toast("¡Bien! " + res.fotos + " de " + r.meta + (left === 1 ? " · ¡te falta solo uno!" : ""));
        say(left === 1 ? "¡Te falta solo uno!" : "¡Llevas " + res.fotos + "!");
      }
    } catch (e) {
      toast(errMsg(e), 4500);
    }
    busy = false;
    await reload();
  }

  // ------------------------------------------------------------ visor
  function openViewer(id) {
    var f = data.fotos.filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    var p = player(f.jugador_id), r = activeReto();
    el("viewerImg").src = photoUrl(f.ruta);
    el("viewerCaption").textContent = p.avatar + " " + p.nombre + " · " + fmtDate(f.creado_en);
    var canDelete = !!(r && r.id === f.reto_id);
    el("viewerDelete").hidden = !canDelete;
    el("viewerDelete").onclick = function () {
      var mine = f.jugador_id === session.jugadorId;
      if (!confirm(mine ? "¿Borrar tu foto? Dejará de contar." : "¿Borrar la foto de " + p.nombre + " porque no aplica? Dejará de contar.")) return;
      guard(async function () {
        must(await db.rpc("borrar_foto", { p_foto: f.id, p_jugador: session.jugadorId }));
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
    if (!last || last.estado !== "terminado") return;
    var seen = load(SEEN_KEY) || [];
    if (seen.indexOf(last.id) >= 0) return;
    seen.push(last.id); save(SEEN_KEY, seen.slice(-50));
    // Solo celebra retos que se cerraron hace poco (no al entrar por primera vez días después)
    if (!prev && Date.now() - new Date(last.cerrado_en) > 6 * 3600000) return;

    var w = last.ganador_id ? player(last.ganador_id) : null;
    var mine = data.puntajes.filter(function (p) { return p.reto_id === last.id && p.jugador_id === session.jugadorId; })[0];
    var iWon = w && last.ganador_id === session.jugadorId;
    el("partyEmoji").textContent = iWon ? "🏆🎉" : w ? "🏁" + w.avatar : "⏰";
    el("partyTitle").textContent = iWon ? "¡Ganaste el reto!" : w ? "¡" + w.nombre + " ganó el reto!" : "Se acabó el tiempo";
    el("partyText").textContent = (last.emoji + " " + last.meta + " " + last.que_buscar) +
      (mine ? " · Tú: " + mine.fotos + " fotos, +" + mine.puntos + " pts" : "");
    el("toast").hidden = true;
    el("party").hidden = false;
    say(iWon ? "¡Ganaste el reto!" : w ? w.nombre + " ganó el reto" : "Se acabó el tiempo");
    if (iWon || w) confetti();
  }
  el("partyClose").onclick = function () { el("party").hidden = true; };

  function confetti() {
    var bits = ["🎉", "⭐", "🐾", "🎈", "✨", "🏆"];
    for (var i = 0; i < 26; i++) {
      var s = document.createElement("span");
      s.className = "confetti";
      s.textContent = bits[i % bits.length];
      s.style.left = Math.random() * 100 + "vw";
      s.style.animationDelay = Math.random() * 0.8 + "s";
      document.body.appendChild(s);
      setTimeout(function (n) { n.remove(); }.bind(null, s), 3500);
    }
  }

  // Ejecuta una acción mostrando errores amables
  async function guard(fn) {
    try { await fn(); } catch (e) { toast(errMsg(e), 4500); }
  }

  start();
})();
