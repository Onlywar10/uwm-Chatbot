(function () {
  var script = document.currentScript;
  if (!script) return;

  var widgetId = script.getAttribute("data-widget-id");
  if (!widgetId) return;

  var origin = new URL(script.src).origin;
  var iframeUrl = origin + "/widget/" + widgetId;
  // United Way of Merced brand blue (override per-embed with data-accent-color).
  var accentColor = script.getAttribute("data-accent-color") || "#003DA5";
  var title = script.getAttribute("data-title") || "United Way of Merced";
  var subtitle = script.getAttribute("data-subtitle") || "211 Community Resources";
  // The one-line invitation that pops up beside the launcher on page load.
  var teaserText =
    script.getAttribute("data-teaser") ||
    "Hey! Feel free to ask me about what resources we have or what we do!";

  // Base + expanded (30% larger) panel dimensions.
  var BASE_W = 400;
  var BASE_H = 620;
  var EXPAND = 1.3;
  var HEADER_H = 64;
  var BUBBLE = 60;

  var TEASER_DELAY_MS = 1200;
  var TEASER_AUTO_HIDE_MS = 15000;
  var TEASER_KEY = "uwm-chat-teaser-dismissed";

  var FONT = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

  var isOpen = false;
  var expanded = false;
  var panel = null;
  var expandBtn = null;
  var teaser = null;
  var teaserTimer = null;
  var teaserHideTimer = null;

  // ---- Styles (keyframes can't be set inline) ----
  var style = document.createElement("style");
  style.textContent =
    "@keyframes uwmw-ring{0%{transform:scale(1);opacity:.55}100%{transform:scale(1.9);opacity:0}}" +
    "@keyframes uwmw-teaser-in{from{opacity:0;transform:translateY(10px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}" +
    "@keyframes uwmw-panel-in{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}" +
    "@keyframes uwmw-wave{0%,60%,100%{transform:rotate(0)}10%,30%{transform:rotate(14deg)}20%,40%{transform:rotate(-8deg)}}" +
    ".uwmw-ring{position:absolute;inset:0;border-radius:50%;background:" +
    accentColor +
    ";animation:uwmw-ring 2.4s cubic-bezier(.2,.7,.3,1) infinite;pointer-events:none}" +
    ".uwmw-teaser{animation:uwmw-teaser-in .45s cubic-bezier(.16,1,.3,1) both}" +
    ".uwmw-panel{animation:uwmw-panel-in .32s cubic-bezier(.16,1,.3,1) both}" +
    ".uwmw-wave{display:inline-block;transform-origin:70% 70%;animation:uwmw-wave 2.2s ease-in-out 1 .5s}" +
    "@media (prefers-reduced-motion:reduce){.uwmw-ring,.uwmw-teaser,.uwmw-panel,.uwmw-wave{animation:none!important}}";
  document.head.appendChild(style);

  // ---- Icons ----
  function icon(paths, size) {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      size +
      '" height="' +
      size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      paths +
      "</svg>"
    );
  }
  var expandIcon = icon(
    '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
    18,
  );
  var shrinkIcon = icon(
    '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
    18,
  );
  var closeIcon = icon('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 18);
  var chatIcon = icon(
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="13" y2="13"/>',
    26,
  );
  var chevronDown = icon('<polyline points="6 9 12 15 18 9"/>', 26);
  var smallClose = icon('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 14);
  var heartHandIcon = icon(
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    22,
  );

  // ---- Launcher ----
  var launcher = document.createElement("div");
  Object.assign(launcher.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    width: BUBBLE + "px",
    height: BUBBLE + "px",
    zIndex: "2147483646",
  });

  var ring = document.createElement("div");
  ring.className = "uwmw-ring";
  launcher.appendChild(ring);

  var bubble = document.createElement("button");
  bubble.type = "button";
  bubble.setAttribute("aria-label", "Open " + title + " chat");
  bubble.setAttribute("aria-expanded", "false");
  Object.assign(bubble.style, {
    position: "relative",
    width: BUBBLE + "px",
    height: BUBBLE + "px",
    padding: "0",
    border: "none",
    borderRadius: "50%",
    background:
      "linear-gradient(135deg, color-mix(in srgb, " +
      accentColor +
      " 78%, white) 0%, " +
      accentColor +
      " 60%)",
    backgroundColor: accentColor,
    color: "#fff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 10px 24px -6px " + accentColor + "99, 0 2px 6px rgba(0,0,0,.12)",
    transition: "transform .25s cubic-bezier(.16,1,.3,1), box-shadow .25s ease",
    outline: "none",
  });
  bubble.innerHTML = chatIcon;
  bubble.onmouseenter = function () {
    bubble.style.transform = "scale(1.08)";
  };
  bubble.onmouseleave = function () {
    bubble.style.transform = "scale(1)";
  };
  bubble.onfocus = function () {
    bubble.style.boxShadow =
      "0 0 0 3px #fff, 0 0 0 6px " + accentColor + ", 0 10px 24px -6px " + accentColor + "99";
  };
  bubble.onblur = function () {
    bubble.style.boxShadow = "0 10px 24px -6px " + accentColor + "99, 0 2px 6px rgba(0,0,0,.12)";
  };
  launcher.appendChild(bubble);

  // ---- Teaser (the on-load invitation) ----
  function teaserDismissed() {
    try {
      return sessionStorage.getItem(TEASER_KEY) === "1";
    } catch (e) {
      return false;
    }
  }
  function rememberTeaserDismissed() {
    try {
      sessionStorage.setItem(TEASER_KEY, "1");
    } catch (e) {
      /* private mode: just don't remember */
    }
  }

  function showTeaser() {
    if (isOpen || teaser || teaserDismissed()) return;

    teaser = document.createElement("div");
    teaser.className = "uwmw-teaser";
    teaser.setAttribute("role", "status");
    Object.assign(teaser.style, {
      position: "fixed",
      bottom: BUBBLE + 34 + "px",
      right: "20px",
      maxWidth: "min(300px, calc(100vw - 40px))",
      zIndex: "2147483645",
      fontFamily: FONT,
    });

    var card = document.createElement("div");
    Object.assign(card.style, {
      position: "relative",
      background: "#fff",
      color: "#1a1a1a",
      borderRadius: "16px",
      padding: "14px 40px 14px 16px",
      boxShadow: "0 12px 32px -8px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.08)",
      border: "1px solid rgba(0,0,0,.06)",
      cursor: "pointer",
      fontSize: "14px",
      lineHeight: "1.4",
    });
    card.innerHTML =
      '<div style="display:flex;gap:10px;align-items:flex-start;">' +
      '<span class="uwmw-wave" style="font-size:20px;line-height:1;flex:0 0 auto;" aria-hidden="true">👋</span>' +
      '<span style="min-width:0;">' +
      teaserText +
      "</span></div>";

    // Speech-bubble tail pointing down at the launcher.
    var tail = document.createElement("div");
    Object.assign(tail.style, {
      position: "absolute",
      right: "22px",
      bottom: "-7px",
      width: "14px",
      height: "14px",
      background: "#fff",
      borderRight: "1px solid rgba(0,0,0,.06)",
      borderBottom: "1px solid rgba(0,0,0,.06)",
      transform: "rotate(45deg)",
    });
    card.appendChild(tail);

    var dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Dismiss");
    Object.assign(dismiss.style, {
      position: "absolute",
      top: "8px",
      right: "8px",
      width: "26px",
      height: "26px",
      border: "none",
      borderRadius: "50%",
      background: "transparent",
      color: "#6b7280",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0",
      lineHeight: "0",
    });
    dismiss.innerHTML = smallClose;
    dismiss.onmouseenter = function () {
      dismiss.style.background = "rgba(0,0,0,.06)";
      dismiss.style.color = "#111";
    };
    dismiss.onmouseleave = function () {
      dismiss.style.background = "transparent";
      dismiss.style.color = "#6b7280";
    };
    dismiss.onclick = function (e) {
      e.stopPropagation();
      hideTeaser(true);
    };
    card.appendChild(dismiss);

    card.onclick = function () {
      hideTeaser(true);
      toggle(true);
    };

    teaser.appendChild(card);
    document.body.appendChild(teaser);

    teaserHideTimer = setTimeout(function () {
      hideTeaser(false);
    }, TEASER_AUTO_HIDE_MS);
  }

  function hideTeaser(remember) {
    if (teaserTimer) {
      clearTimeout(teaserTimer);
      teaserTimer = null;
    }
    if (teaserHideTimer) {
      clearTimeout(teaserHideTimer);
      teaserHideTimer = null;
    }
    if (remember) rememberTeaserDismissed();
    if (!teaser) return;
    var el = teaser;
    teaser = null;
    el.style.transition = "opacity .2s ease, transform .2s ease";
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 220);
  }

  // ---- Panel ----
  function headerButton(label) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", label);
    Object.assign(btn.style, {
      background: "rgba(255,255,255,.14)",
      border: "none",
      cursor: "pointer",
      width: "34px",
      height: "34px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#fff",
      borderRadius: "10px",
      lineHeight: "0",
      padding: "0",
      flex: "0 0 auto",
      transition: "background .15s ease",
    });
    btn.onmouseenter = function () {
      btn.style.background = "rgba(255,255,255,.28)";
    };
    btn.onmouseleave = function () {
      btn.style.background = "rgba(255,255,255,.14)";
    };
    return btn;
  }

  function createPanel() {
    panel = document.createElement("div");
    panel.className = "uwmw-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", title + " chat");
    Object.assign(panel.style, {
      position: "fixed",
      bottom: BUBBLE + 32 + "px",
      right: "20px",
      width: BASE_W + "px",
      height: BASE_H + "px",
      borderRadius: "20px",
      overflow: "hidden",
      boxShadow: "0 24px 64px -16px rgba(0,0,0,.35), 0 4px 16px rgba(0,0,0,.10)",
      zIndex: "2147483646",
      display: "none",
      flexDirection: "column",
      backgroundColor: "#fff",
      transition: "width 0.25s cubic-bezier(.16,1,.3,1), height 0.25s cubic-bezier(.16,1,.3,1)",
      fontFamily: FONT,
    });

    // Branded header: [avatar + title/subtitle] … [expand] [close]
    var header = document.createElement("div");
    Object.assign(header.style, {
      height: HEADER_H + "px",
      flex: "0 0 auto",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "0 12px 0 14px",
      background:
        "linear-gradient(120deg, " +
        accentColor +
        " 0%, color-mix(in srgb, " +
        accentColor +
        " 72%, black) 100%)",
      backgroundColor: accentColor,
      color: "#fff",
    });

    var avatar = document.createElement("div");
    Object.assign(avatar.style, {
      width: "40px",
      height: "40px",
      borderRadius: "50%",
      background: "rgba(255,255,255,.16)",
      border: "1.5px solid rgba(255,255,255,.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "0 0 auto",
      position: "relative",
    });
    avatar.innerHTML =
      heartHandIcon +
      '<span style="position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:50%;background:#34d399;border:2px solid ' +
      accentColor +
      ';"></span>';

    var brand = document.createElement("div");
    Object.assign(brand.style, {
      display: "flex",
      flexDirection: "column",
      lineHeight: "1.2",
      minWidth: "0",
      flex: "1 1 auto",
    });
    brand.innerHTML =
      '<span style="font-weight:700;font-size:15px;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
      title +
      "</span>" +
      '<span style="font-size:12px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
      subtitle +
      "</span>";

    expandBtn = headerButton("Expand chat");
    expandBtn.innerHTML = expandIcon;
    expandBtn.onclick = function (e) {
      e.stopPropagation();
      toggleExpand();
    };

    var closeBtn = headerButton("Close chat");
    closeBtn.innerHTML = closeIcon;
    closeBtn.onclick = function (e) {
      e.stopPropagation();
      toggle(false);
    };

    header.appendChild(avatar);
    header.appendChild(brand);
    header.appendChild(expandBtn);
    header.appendChild(closeBtn);

    var iframe = document.createElement("iframe");
    iframe.src = iframeUrl;
    iframe.setAttribute("title", title + " chat");
    // Permissions Policy: geolocation is denied inside a cross-origin iframe unless
    // the embedding page delegates it here. Without this the "Use my location"
    // button fails silently — the browser never even shows its permission prompt.
    // Delegation is not consent: the visitor still has to grant the prompt.
    iframe.setAttribute("allow", "geolocation");
    Object.assign(iframe.style, {
      width: "100%",
      // flex-basis 0 + min-height 0: the iframe takes its height purely from
      // the (pixel-sized) panel, not from its own content. iOS WebKit otherwise
      // sizes iframes to content height, which collapses/overflows the panel.
      flex: "1 1 0%",
      minHeight: "0",
      border: "none",
    });

    panel.appendChild(header);
    panel.appendChild(iframe);
    document.body.appendChild(panel);

    applySize();
  }

  function toggle(open) {
    isOpen = typeof open === "boolean" ? open : !isOpen;
    if (!panel) createPanel();
    if (isOpen) {
      hideTeaser(true);
      // Re-trigger the entrance animation on every open.
      panel.classList.remove("uwmw-panel");
      void panel.offsetWidth;
      panel.classList.add("uwmw-panel");
    }
    panel.style.display = isOpen ? "flex" : "none";
    bubble.innerHTML = isOpen ? chevronDown : chatIcon;
    bubble.setAttribute("aria-expanded", isOpen ? "true" : "false");
    bubble.setAttribute("aria-label", (isOpen ? "Close " : "Open ") + title + " chat");
    // The attention ring has done its job once the visitor has opened the chat.
    ring.style.display = isOpen ? "none" : ring.style.display;
  }

  function toggleExpand() {
    expanded = !expanded;
    if (expandBtn) {
      expandBtn.innerHTML = expanded ? shrinkIcon : expandIcon;
      expandBtn.setAttribute("aria-label", expanded ? "Shrink chat" : "Expand chat");
    }
    applySize();
  }

  function applySize() {
    if (!panel) return;

    // Mobile: fill the viewport (minus margins) regardless of expanded state.
    // Size in explicit pixels off window.inner* rather than calc(100% - 88px):
    // a percentage height on a position:fixed element resolves unreliably on
    // mobile browsers and can collapse the panel (header shows, iframe goes
    // white). The resize listener re-runs this as the mobile chrome shows/hides.
    if (window.innerWidth < 500) {
      // On a phone the panel already fills the screen, so expanding is
      // meaningless — hide the expand button.
      if (expandBtn) expandBtn.style.display = "none";
      Object.assign(panel.style, {
        width: window.innerWidth - 24 + "px",
        height: window.innerHeight - (BUBBLE + 36) + "px",
        right: "12px",
        bottom: BUBBLE + 24 + "px",
        borderRadius: "18px",
      });
      return;
    }

    if (expandBtn) expandBtn.style.display = "flex";

    var factor = expanded ? EXPAND : 1;
    var maxW = window.innerWidth - 40;
    var maxH = window.innerHeight - (BUBBLE + 52);
    var w = Math.min(Math.round(BASE_W * factor), maxW);
    var h = Math.min(Math.round(BASE_H * factor), maxH);

    Object.assign(panel.style, {
      width: w + "px",
      height: h + "px",
      right: "20px",
      bottom: BUBBLE + 32 + "px",
      borderRadius: "20px",
    });
  }

  bubble.onclick = function () {
    toggle();
  };

  window.addEventListener("resize", applySize);

  document.body.appendChild(launcher);

  teaserTimer = setTimeout(showTeaser, TEASER_DELAY_MS);
})();
