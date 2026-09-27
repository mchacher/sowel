// ============================================================
// Spec 181 R5 — the page a visitor opens in front of the gate.
//
// A few kilobytes of its own, served from strings: not the SPA, no framework,
// nothing fetched from elsewhere. It talks to its API by a RELATIVE path
// (`api/...` under `/access/`), so an alias host that rewrites everything to
// `/access/` works without a second rule.
//
// What it shows of a command is the echo of this phone's own presses, never
// the gate's state (R4.16, R5.22). The control is a movement: the disc is
// pulled upward out of its socket (R5.20); the keyboard confirms with a second
// Enter instead (R5.21).
// ============================================================

export const GUEST_PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
  "img-src 'self' data:; manifest-src 'self'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors 'none'";

export const GUEST_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0a0705">
<meta name="referrer" content="no-referrer">
<title>Accès</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="style.css">
</head>
<body>
<main class="screen" id="screen">
  <section class="codescreen" id="codescreen" hidden>
    <h1 id="codeTitle">Accès</h1>
    <p id="codeHint">Entrez le code qu'on vous a communiqué.</p>
    <form id="codeForm" autocomplete="off">
      <input id="codeInput" inputmode="text" autocapitalize="characters" autocomplete="one-time-code"
             spellcheck="false" placeholder="XXXX-XXXX" aria-label="Code">
      <button type="submit" id="codeGo">Valider</button>
    </form>
    <p class="err" id="codeErr" role="alert"></p>
  </section>

  <section class="main" id="main" hidden>
    <header class="top">
      <div class="brand" id="brand"></div>
      <span class="pill idle" id="pill"><span class="dot"></span><span id="pillText"></span></span>
    </header>
    <div class="discs" id="discs"></div>
    <p class="msg" id="msg" role="status"></p>
    <div class="prog" id="prog">
      <div class="bar"><i id="barFill"></i></div>
      <div class="row"><span id="progLeft"></span><span id="progRight"></span></div>
    </div>
    <section class="journal" id="journal" hidden>
      <h2 id="jTitle">Vos commandes</h2>
      <div id="jRows"></div>
    </section>
  </section>
  <p class="loading" id="loading">…</p>
</main>
<script src="app.js"></script>
</body>
</html>
`;

export const GUEST_CSS = `:root{--night:#0a0705;--ink:#f3ece4;--muted:#8d8177;--glow:#e8963c;--glow2:#f5b164;--bad:#f0a79d}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--night);color:var(--ink);min-height:100vh;
  font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
[hidden]{display:none!important}
.screen{position:relative;min-height:100vh;max-width:480px;margin:0 auto;display:flex;flex-direction:column;overflow:hidden;
  padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}
.screen::before{content:"";position:absolute;inset:-30% -20% auto -20%;height:70%;
  background:radial-gradient(60% 60% at 50% 40%,rgba(232,150,60,.20),transparent 70%);pointer-events:none}
.loading{margin:auto;color:var(--muted)}
.main{flex:1;display:flex;flex-direction:column;position:relative}
.top{padding:26px 24px 0;text-align:center}
.brand{font-size:24px;font-weight:600;margin:0 0 12px;letter-spacing:-.01em}
.pill{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(232,150,60,.35);
  background:rgba(232,150,60,.10);color:var(--glow2);border-radius:999px;padding:5px 12px;font-size:13px;min-height:27px}
.pill .dot{width:7px;height:7px;border-radius:50%;background:var(--glow2);animation:blink 1.4s ease-in-out infinite}
.pill.idle{border-color:rgba(255,255,255,.10);background:rgba(255,255,255,.04);color:var(--muted)}
.pill.idle .dot{background:var(--muted);animation:none}
.pill.bad{border-color:rgba(226,104,91,.45);background:rgba(226,104,91,.12);color:var(--bad)}
.pill.bad .dot{background:var(--bad);animation:none}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
.discs{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px 0}
.arena{position:relative;width:100%;height:330px;display:flex;align-items:center;justify-content:center}
.discs.many .arena{height:270px}
.gname{position:absolute;bottom:4px;left:0;right:0;text-align:center;font-size:14px;color:var(--muted)}
.halo{position:absolute;border-radius:50%;border:1px solid rgba(255,255,255,.05);pointer-events:none;width:300px;height:300px}
.halo.h2{width:240px;height:240px;border-color:rgba(232,150,60,.10)}
.discs.many .halo{width:230px;height:230px}.discs.many .halo.h2{width:190px;height:190px}
.orb{position:relative;width:170px;height:170px;border-radius:50%;border:0;cursor:grab;
  background:radial-gradient(120% 120% at 35% 28%,#f7c07e,#e8963c 46%,#c9701f 100%);color:#2a1704;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
  box-shadow:0 0 0 1px rgba(255,255,255,.18) inset,0 14px 40px rgba(232,150,60,.35),0 0 90px rgba(232,150,60,.22);
  touch-action:none;-webkit-user-select:none;user-select:none;font-family:inherit;
  transition:transform .16s ease,box-shadow .16s ease,filter .16s ease}
.discs.many .orb{width:140px;height:140px}
.orb:focus-visible{outline:3px solid #fff;outline-offset:6px}
.orb .verb{font-size:18px;font-weight:700;letter-spacing:.06em}
.orb .hint{font-size:11.5px;opacity:.72;max-width:120px;text-align:center;line-height:1.25}
.orb svg{width:36px;height:36px;margin-bottom:2px}
.orb.busy,.orb:disabled{filter:saturate(.7) brightness(.7);cursor:default}
.socket{position:absolute;width:170px;height:170px;border-radius:50%;pointer-events:none;
  border:1px dashed rgba(232,150,60,.30);opacity:0;transition:opacity .18s}
.discs.many .socket{width:140px;height:140px}
.socket.on{opacity:1}
.guide{position:absolute;bottom:calc(50% + 96px);left:50%;transform:translateX(-50%);display:flex;flex-direction:column;
  align-items:center;pointer-events:none;opacity:0;transition:opacity .22s}
.discs.many .guide{bottom:calc(50% + 80px)}
.guide.on{opacity:1}
.guide svg{width:20px;height:20px;color:var(--glow2);margin-bottom:-7px}
.guide svg:nth-child(1){opacity:.28;animation:rise 1.9s ease-in-out infinite}
.guide svg:nth-child(2){opacity:.55;animation:rise 1.9s ease-in-out .18s infinite}
@keyframes rise{0%,100%{transform:translateY(2px)}50%{transform:translateY(-3px)}}
.prog{padding:0 24px;opacity:0;transition:opacity .25s}
.prog.on{opacity:1}
.bar{height:3px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden}
.bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--glow),var(--glow2))}
.prog .row{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:7px}
.msg{margin:4px 24px 0;min-height:21px;font-size:14px;color:var(--bad);text-align:center}
.journal{margin:16px 12px 12px;background:rgba(255,255,255,.035);border-radius:18px;padding:6px 4px}
.journal h2{margin:10px 14px 6px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:600}
.jrow{display:flex;align-items:center;gap:10px;padding:9px 14px;font-size:14px}
.jrow .d{width:6px;height:6px;border-radius:50%;background:var(--glow);flex:0 0 auto;opacity:.8}
.jrow.bad .d{background:var(--bad)}
.jrow .t{margin-left:auto;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.codescreen{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 34px;text-align:center;position:relative}
.codescreen h1{font-size:22px;margin:0 0 8px;font-weight:600}
.codescreen p{color:var(--muted);font-size:14px;margin:0 0 26px}
.codescreen form{width:100%}
.codescreen input{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:14px;
  color:var(--ink);font-size:22px;letter-spacing:.18em;text-align:center;padding:15px 12px;font-family:inherit;text-transform:uppercase}
.codescreen input:focus{outline:2px solid var(--glow);border-color:transparent}
.codescreen button{margin-top:14px;width:100%;border:0;border-radius:14px;padding:15px;background:var(--glow);color:#2a1704;
  font-size:16px;font-weight:700;font-family:inherit;cursor:pointer}
.codescreen button:disabled{opacity:.6}
.codescreen .err{color:var(--bad);font-size:14px;margin:14px 0 0;min-height:21px}
`;

export const GUEST_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0a0705"/><circle cx="32" cy="32" r="18" fill="#e8963c"/></svg>`;

export const GUEST_MANIFEST = JSON.stringify({
  name: "Accès",
  short_name: "Accès",
  start_url: "./",
  scope: "./",
  display: "standalone",
  background_color: "#0a0705",
  theme_color: "#0a0705",
  icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml" }],
});

export const GUEST_JS = `(function () {
  "use strict";
  var TOKEN_KEY = "sowel-shared-access";
  var $ = function (id) { return document.getElementById(id); };
  var langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "fr"]);
  var EN = !/^fr/i.test(langs[0] || "fr") && langs.some(function (l) { return /^en/i.test(l); });
  if (EN) document.documentElement.lang = "en";

  var T = EN ? {
    access: "Access", enterCode: "Enter the code you were given.", validate: "Confirm",
    unknown: "This code opens nothing.", tooMany: "Too many attempts. Try again in a moment.",
    ended: "This access has ended.", network: "The house cannot be reached. Try again.",
    open: "OPEN", pull: "pull upward", release: "release", sent: "SENT", enterAgain: "Enter again to open",
    ready: "Ready", commandSent: "Command sent", refused: "Command refused", journal: "Your commands",
    asked: "Opening requested", notYet: "Opens on ", nextAt: "Next opening at ", suspended: "Access on hold",
    revoked: "This access was revoked.", endedLong: "This access has ended.", noGate: "No gate on this access.",
    reasons: {
      revoked: "This access was revoked.", suspended: "This access is on hold.",
      not_yet: "Not yet.", expired: "This access has ended.", outside_hours: "Outside the allowed hours.",
      no_gate: "No gate on this access.", not_this_gate: "This access does not open this gate.",
      refused_by_house: "The house refused the command.", too_many_opens: "Too many openings in the last hour.",
      gate_error: "The gate did not take the command. Try again."
    }
  } : {
    access: "Accès", enterCode: "Entrez le code qu'on vous a communiqué.", validate: "Valider",
    unknown: "Ce code n'ouvre rien.", tooMany: "Trop d'essais. Réessayez dans un instant.",
    ended: "Cet accès est terminé.", network: "La maison ne répond pas. Réessayez.",
    open: "OUVRIR", pull: "tirer vers le haut", release: "relâcher", sent: "ENVOYÉ", enterAgain: "Entrée pour ouvrir",
    ready: "Prêt", commandSent: "Commande envoyée", refused: "Commande refusée", journal: "Vos commandes",
    asked: "Ouverture demandée", notYet: "Ouvre le ", nextAt: "Prochaine ouverture à ", suspended: "Accès suspendu",
    revoked: "Cet accès a été révoqué.", endedLong: "Cet accès est terminé.", noGate: "Aucun portail sur cet accès.",
    reasons: {
      revoked: "Cet accès a été révoqué.", suspended: "Cet accès est suspendu.",
      not_yet: "Pas encore.", expired: "Cet accès est terminé.", outside_hours: "En dehors des heures autorisées.",
      no_gate: "Aucun portail sur cet accès.", not_this_gate: "Cet accès n'ouvre pas ce portail.",
      refused_by_house: "La maison a refusé la commande.", too_many_opens: "Trop d'ouvertures dans l'heure.",
      gate_error: "Le portail n'a pas pris la commande. Réessayez."
    }
  };

  var token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { token = null; }
  var session = null;
  var busy = false;
  var pillTimer = null;

  function saveToken(t) {
    token = t;
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* private mode */ }
  }

  function api(path, method, body) {
    var headers = { "Accept": "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    if (token) headers["Authorization"] = "Bearer " + token;
    return fetch("api/" + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store", credentials: "omit" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); });
  }

  function hhmm(iso) {
    var d = new Date(iso);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function dayTime(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(EN ? "en-GB" : "fr-FR", { day: "numeric", month: "long" }) + " " + hhmm(iso);
  }

  // ── Code screen ──────────────────────────────────────────
  function showCode(err) {
    $("loading").hidden = true; $("main").hidden = true; $("codescreen").hidden = false;
    $("codeTitle").textContent = T.access; $("codeHint").textContent = T.enterCode; $("codeGo").textContent = T.validate;
    $("codeErr").textContent = err || "";
    setTimeout(function () { $("codeInput").focus(); }, 50);
  }

  function enrolWith(body) {
    return api("enrol", "POST", body).then(function (r) {
      if (r.status === 200 && r.body.token) { saveToken(r.body.token); session = r.body.session; showMain(); return; }
      var e = r.body && r.body.error;
      showCode(e === "too_many" ? T.tooMany : e === "ended" ? T.ended : e === "unknown_code" ? T.unknown : T.network);
    }, function () { showCode(T.network); });
  }

  $("codeForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var v = $("codeInput").value.trim();
    if (!v) return;
    $("codeGo").disabled = true;
    enrolWith({ code: v }).then(function () { $("codeGo").disabled = false; });
  });

  // ── Main screen ──────────────────────────────────────────
  function setPill(kind, text) {
    $("pill").className = "pill" + (kind === "run" ? "" : kind === "bad" ? " bad" : " idle");
    $("pillText").textContent = text;
  }

  function restingPill() {
    if (!session) return;
    var s = session.status;
    if (s === "live") setPill("idle", T.ready);
    else if (s === "not_yet" && session.activeAt) setPill("bad", T.notYet + dayTime(session.activeAt));
    else if (s === "outside_hours") setPill("bad", session.nextOpeningAt ? T.nextAt + hhmm(session.nextOpeningAt) : T.reasons.outside_hours);
    else if (s === "suspended") setPill("bad", T.suspended);
    else if (s === "revoked") setPill("bad", T.revoked);
    else if (s === "ended") setPill("bad", T.endedLong);
    else if (s === "no_gate") setPill("bad", T.noGate);
    else setPill("idle", T.ready);
  }

  function renderJournal() {
    var rows = $("jRows");
    rows.textContent = "";
    var list = (session && session.presses) || [];
    $("journal").hidden = list.length === 0;
    $("jTitle").textContent = T.journal;
    var many = session && session.gates.length > 1;
    list.slice(0, 4).forEach(function (p) {
      var row = document.createElement("div");
      row.className = "jrow" + (p.result === "sent" ? "" : " bad");
      var d = document.createElement("span"); d.className = "d";
      var l = document.createElement("span");
      var label = p.result === "sent" ? T.asked : (T.reasons[p.result] || T.refused);
      l.textContent = label + (many && p.gateName ? " · " + p.gateName : "");
      var t = document.createElement("span"); t.className = "t"; t.textContent = hhmm(p.at);
      row.appendChild(d); row.appendChild(l); row.appendChild(t);
      rows.appendChild(row);
    });
  }

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h8V5l-8 3z"></path><path d="M11 21h2V9l-2-1"></path><path d="M15 12h6"></path><path d="M18 9l3 3-3 3"></path></svg>';
  var CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"></path></svg>';

  function showMain() {
    $("loading").hidden = true; $("codescreen").hidden = true; $("main").hidden = false;
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    $("brand").textContent = session.gates.length === 1 ? session.gates[0].name : session.label;
    document.title = $("brand").textContent || T.access;
    var discs = $("discs");
    discs.textContent = "";
    discs.className = "discs" + (session.gates.length > 1 ? " many" : "");
    session.gates.forEach(function (g) { discs.appendChild(buildDisc(g, session.gates.length > 1)); });
    restingPill();
    renderJournal();
  }

  function buildDisc(gate, titled) {
    var arena = document.createElement("div"); arena.className = "arena";
    arena.innerHTML = '<div class="halo"></div><div class="halo h2"></div><div class="socket"></div>' +
      '<div class="guide on" aria-hidden="true">' + CHEVRON + CHEVRON + '</div>' +
      '<button class="orb" type="button">' + ICON + '<span class="verb"></span><span class="hint"></span></button>' +
      (titled ? '<div class="gname"></div>' : "");
    var orb = arena.querySelector(".orb"), socket = arena.querySelector(".socket"), guide = arena.querySelector(".guide");
    var verb = arena.querySelector(".verb"), hint = arena.querySelector(".hint");
    if (titled) arena.querySelector(".gname").textContent = gate.name;
    orb.setAttribute("aria-label", (EN ? "Open " : "Ouvrir ") + gate.name);
    function rest() { verb.textContent = T.open; hint.textContent = T.pull; orb.classList.remove("busy"); guide.classList.add("on"); }
    rest();

    var PULL_MAX = 118, startY = 0, pullY = 0, active = false;
    orb.addEventListener("pointerdown", function (e) {
      if (busy) return;
      active = true; startY = e.clientY; pullY = 0;
      try { orb.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      $("msg").textContent = "";
      socket.classList.add("on"); guide.classList.remove("on");
      orb.style.transition = "none";
    });
    orb.addEventListener("pointermove", function (e) {
      if (!active) return;
      pullY = Math.min(PULL_MAX + 18, Math.max(0, startY - e.clientY));
      var k = Math.min(1, pullY / PULL_MAX);
      socket.style.borderColor = "rgba(232,150,60," + (0.22 + 0.5 * k) + ")";
      socket.style.borderStyle = k >= 1 ? "solid" : "dashed";
      orb.style.transform = "translateY(" + (-pullY) + "px) scale(" + (1 - 0.05 * k) + ")";
      hint.textContent = k >= 1 ? T.release : T.pull;
    });
    function end() {
      if (!active) return;
      active = false;
      orb.style.transition = ""; orb.style.transform = "";
      socket.classList.remove("on"); socket.style.borderColor = ""; socket.style.borderStyle = "";
      var done = pullY >= PULL_MAX;
      pullY = 0;
      if (done) fire(gate, orb, verb, hint, guide, rest); else { hint.textContent = T.pull; guide.classList.add("on"); }
    }
    orb.addEventListener("pointerup", end);
    orb.addEventListener("pointercancel", end);
    orb.addEventListener("lostpointercapture", end);
    // R5.21 — the keyboard's way round: Enter, then Enter again within 3 s.
    var armedAt = 0;
    orb.addEventListener("click", function (e) { if (e.detail === 0) keyConfirm(); });
    function keyConfirm() {
      if (busy) return;
      var now = Date.now();
      if (now - armedAt < 3000) { armedAt = 0; fire(gate, orb, verb, hint, guide, rest); return; }
      armedAt = now; hint.textContent = T.enterAgain;
      setTimeout(function () { if (armedAt === now) { armedAt = 0; hint.textContent = T.pull; } }, 3000);
    }
    return arena;
  }

  function fire(gate, orb, verb, hint, guide, rest) {
    if (busy) return;
    busy = true;
    orb.classList.add("busy"); verb.textContent = T.sent; hint.textContent = ""; guide.classList.remove("on");
    setPill("run", T.commandSent);
    api("open", "POST", { gate: gate.id }).then(function (r) {
      if (r.status === 401) { saveToken(null); busy = false; showCode(); return; }
      if (r.status === 200 && r.body.ok) { refresh(); runBar(rest); return; }
      var reason = (r.body && r.body.reason) || "gate_error";
      var text = T.reasons[reason] || T.refused;
      if (reason === "not_yet" && r.body.activeAt) text = T.notYet + dayTime(r.body.activeAt);
      if (reason === "outside_hours" && r.body.nextOpeningAt) text += " " + T.nextAt + hhmm(r.body.nextOpeningAt) + ".";
      refused(text, rest);
      refresh();
    }, function () { refused(T.network, rest); });
  }

  function refused(text, rest) {
    busy = false;
    setPill("bad", T.refused);
    $("msg").textContent = text;
    rest();
    clearTimeout(pillTimer);
    pillTimer = setTimeout(function () { restingPill(); }, 4200);
  }

  function runBar(rest) {
    var travel = (session && session.travelS) || 30;
    var prog = $("prog"), fill = $("barFill");
    prog.classList.add("on");
    $("progLeft").textContent = T.commandSent.toLowerCase();
    var t0 = performance.now();
    (function step(now) {
      var p = Math.min(1, (now - t0) / (travel * 1000));
      fill.style.width = (p * 100) + "%";
      $("progRight").textContent = ((1 - p) * travel).toFixed(0) + " s";
      if (p < 1) { requestAnimationFrame(step); return; }
      fill.style.width = "0%"; prog.classList.remove("on");
      busy = false; rest(); restingPill();
    })(t0);
  }

  function refresh() {
    return api("session", "GET").then(function (r) {
      if (r.status === 401) { saveToken(null); showCode(); return; }
      if (r.status === 200) { session = r.body; if (!busy) restingPill(); renderJournal(); }
    }, function () { /* keep what is shown */ });
  }

  // ── Boot ─────────────────────────────────────────────────
  var m = /[#&]i=([A-Za-z0-9_-]+)/.exec(location.hash || "");
  if (m) {
    history.replaceState(null, "", location.pathname + location.search);
    enrolWith({ link: m[1] });
  } else if (token) {
    api("session", "GET").then(function (r) {
      if (r.status === 200) { session = r.body; showMain(); }
      else if (r.status === 401) { saveToken(null); showCode(); }
      else showCode(T.network);
    }, function () { showCode(T.network); });
  } else {
    showCode();
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && session) refresh(); });
})();
`;
