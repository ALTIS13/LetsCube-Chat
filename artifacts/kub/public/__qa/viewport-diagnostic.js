// Temporary D-111 viewport diagnostic. index.html loads it only when the URL
// carries kub-viewport-diagnostic=1, and points the manifest at a copy whose
// start_url carries the same flag, so a Home Screen app installed from that
// URL opens with it. It reads geometry and nothing else: no account, message,
// storage or network access. Remove it with the D-111 fix.
(function () {
  "use strict";
  if (window.__kubViewportDiagnostic) return;
  window.__kubViewportDiagnostic = true;

  var started = performance.now();
  var touches = [];
  var events = 0;
  var lastEvent = "start";
  var first = { inner: window.innerHeight, client: document.documentElement.clientHeight };

  function px(n) { return Math.round(n); }

  function probe(css) {
    var d = document.createElement("div");
    d.setAttribute("aria-hidden", "true");
    d.style.cssText = "position:fixed;left:0;width:0;visibility:hidden;pointer-events:none;" + css;
    document.body.appendChild(d);
    var b = d.getBoundingClientRect();
    d.remove();
    return px(b.top) + "-" + px(b.bottom);
  }

  function inset() {
    var d = document.createElement("div");
    d.setAttribute("aria-hidden", "true");
    d.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;"
      + "padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
    document.body.appendChild(d);
    var s = getComputedStyle(d);
    var v = "t" + px(parseFloat(s.paddingTop)) + " b" + px(parseFloat(s.paddingBottom));
    d.remove();
    return v;
  }

  function box(selector) {
    var e = document.querySelector(selector);
    if (!e) return "-";
    var b = e.getBoundingClientRect();
    return px(b.top) + "-" + px(b.bottom);
  }

  function token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "-";
  }

  function entry() {
    var scripts = document.scripts;
    for (var i = 0; i < scripts.length; i += 1) {
      if (!scripts[i].src) continue;
      var path = new URL(scripts[i].src).pathname;
      if (path.indexOf("/assets/index-") === 0 && path.slice(-3) === ".js") return path.slice(8);
    }
    return "-";
  }

  function flag(value) { return value ? "1" : "0"; }

  function lines() {
    var r = document.documentElement;
    var vv = window.visualViewport;
    var boot = window.__kubViewportBoot || {};
    return [
      "D111 t" + px(performance.now() - started) + " " + lastEvent + " #" + events,
      "scr " + screen.width + "x" + screen.height + " dpr " + devicePixelRatio,
      "inner " + innerWidth + "x" + innerHeight + " client " + r.clientWidth + "x" + r.clientHeight,
      "vv " + (vv ? px(vv.width) + "x" + px(vv.height) + " off " + px(vv.offsetTop) + " pg " + px(vv.pageTop) : "-")
        + " sY " + px(window.scrollY),
      "boot inner " + boot.inner + " client " + boot.client + " vv " + boot.vv,
      "first inner " + first.inner + " client " + first.client,
      "fixed0 " + probe("top:0;bottom:0") + " fixedB " + probe("bottom:0;height:0"),
      "vh " + probe("top:0;height:100vh") + " lvh " + probe("top:0;height:100lvh"),
      "svh " + probe("top:0;height:100svh") + " dvh " + probe("top:0;height:100dvh"),
      "app " + token("--kub-app-height") + " paint " + token("--kub-paintable-height"),
      "gap " + token("--kub-fixed-paintable-gap") + " top " + token("--kub-app-top"),
      "safe " + inset() + " sa " + flag(navigator.standalone === true)
        + " dm " + flag(matchMedia("(display-mode: standalone)").matches)
        + " attr " + flag(r.hasAttribute("data-ios-standalone"))
        + " kb " + flag(r.hasAttribute("data-ios-keyboard-open")),
      "html " + box("html") + " body " + box("body") + " root " + box("#root"),
      "auth " + box(".kub-auth-shell") + " shell " + box("[data-ios-app-shell]"),
      "entry " + entry() + " path " + location.pathname,
      "touch " + (touches.length ? touches.slice(-6).join(" ") : "-"),
    ];
  }

  var panel = document.createElement("div");
  panel.id = "kub-viewport-diagnostic";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "D111 diagnostic");
  panel.style.cssText = "position:fixed;left:6px;right:6px;top:calc(env(safe-area-inset-top) + 4px);"
    + "z-index:2147483647;background:rgba(255,255,255,0.95);color:#000;border:1px solid #000;"
    + "border-radius:6px;padding:4px 6px;font:11px/1.3 ui-monospace,Menlo,monospace;pointer-events:auto";
  var text = document.createElement("div");
  var controls = document.createElement("div");
  controls.style.cssText = "display:flex;gap:6px;margin-top:4px";
  panel.appendChild(text);
  panel.appendChild(controls);

  function button(label, onPress) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = "min-height:34px;padding:0 10px;border:1px solid #000;border-radius:6px;background:#fff;color:#000;font:inherit";
    b.addEventListener("click", function (event) { event.stopPropagation(); onPress(b); update("button"); });
    controls.appendChild(b);
    return b;
  }

  // Five columns, each a different claim about how tall the page may be drawn.
  // Whatever the tallest column leaves uncovered at the bottom is not painted
  // by this page at all.
  var stripes = document.createElement("div");
  stripes.setAttribute("aria-hidden", "true");
  stripes.style.cssText = "display:none";
  stripes.innerHTML =
    '<div style="position:fixed;z-index:2147483645;pointer-events:none;left:0;width:20vw;top:0;bottom:0;background:#ff0000"></div>'
    + '<div style="position:fixed;z-index:2147483645;pointer-events:none;left:20vw;width:20vw;top:0;height:var(--kub-app-height);background:#00c000"></div>'
    + '<div style="position:fixed;z-index:2147483645;pointer-events:none;left:40vw;width:20vw;top:0;height:100lvh;background:#0000ff"></div>'
    + '<div style="position:absolute;z-index:2147483645;pointer-events:none;left:60vw;width:20vw;top:0;height:1400px;background:#ff8000"></div>'
    + '<div style="position:fixed;z-index:2147483645;pointer-events:none;left:80vw;width:20vw;top:0;height:1400px;background:#ff00ff"></div>';

  // A tall layer that records where a touch lands, and swallows it.
  var recorder = document.createElement("div");
  recorder.setAttribute("aria-hidden", "true");
  recorder.style.cssText = "display:none;position:fixed;left:0;right:0;top:0;height:1400px;"
    + "z-index:2147483644;background:rgba(255,0,255,0.12);touch-action:none";
  recorder.addEventListener("pointerdown", function (event) {
    touches.push(px(event.clientY));
    event.preventDefault();
    update("tap");
  });

  var collapsed = false;
  button("Полосы", function (b) {
    var on = stripes.style.display === "none";
    stripes.style.display = on ? "block" : "none";
    b.textContent = on ? "Полосы: да" : "Полосы";
  });
  button("Касания", function (b) {
    var on = recorder.style.display === "none";
    recorder.style.display = on ? "block" : "none";
    b.textContent = on ? "Касания: да" : "Касания";
  });
  button("Свернуть", function (b) {
    collapsed = !collapsed;
    b.textContent = collapsed ? "Развернуть" : "Свернуть";
  });

  function update(reason) {
    events += 1;
    lastEvent = reason;
    var list = collapsed ? lines().slice(0, 1) : lines();
    while (text.firstChild) text.removeChild(text.firstChild);
    for (var i = 0; i < list.length; i += 1) {
      var line = document.createElement("div");
      line.textContent = list[i];
      text.appendChild(line);
    }
  }

  function mount() {
    document.body.appendChild(stripes);
    document.body.appendChild(recorder);
    document.body.appendChild(panel);
    update("mount");
    var on = function (target, name) {
      target.addEventListener(name, function () { update(name); });
    };
    on(window, "resize");
    on(window, "orientationchange");
    on(window, "pageshow");
    on(document, "visibilitychange");
    on(document, "focusin");
    on(document, "focusout");
    if (window.visualViewport) {
      on(window.visualViewport, "resize");
      on(window.visualViewport, "scroll");
    }
    var ticks = 0;
    var timer = setInterval(function () {
      ticks += 1;
      update("tick");
      if (ticks >= 20) {
        clearInterval(timer);
        setInterval(function () { update("slow"); }, 3000);
      }
    }, 1000);
  }

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
