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

  // Base + expanded (30% larger) panel dimensions.
  var BASE_W = 400;
  var BASE_H = 600;
  var EXPAND = 1.3;
  var HEADER_H = 52;

  var isOpen = false;
  var expanded = false;
  var panel = null;
  var expandBtn = null;

  var expandIcon =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
  var shrinkIcon =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
  var closeIcon =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  // Chat bubble launcher
  var bubble = document.createElement("div");
  bubble.setAttribute("aria-label", "Open United Way chat");
  bubble.setAttribute("role", "button");
  bubble.setAttribute("tabindex", "0");
  Object.assign(bubble.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    backgroundColor: accentColor,
    cursor: "pointer",
    zIndex: "2147483646",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    transition: "transform 0.2s ease",
  });
  bubble.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  bubble.onmouseenter = function () {
    bubble.style.transform = "scale(1.1)";
  };
  bubble.onmouseleave = function () {
    bubble.style.transform = "scale(1)";
  };

  function headerButton(label) {
    var btn = document.createElement("button");
    btn.setAttribute("aria-label", label);
    Object.assign(btn.style, {
      background: "none",
      border: "none",
      cursor: "pointer",
      padding: "6px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#fff",
      borderRadius: "6px",
      lineHeight: "0",
    });
    btn.onmouseenter = function () {
      btn.style.backgroundColor = "rgba(255,255,255,0.18)";
    };
    btn.onmouseleave = function () {
      btn.style.backgroundColor = "transparent";
    };
    return btn;
  }

  function createPanel() {
    panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "fixed",
      bottom: "88px",
      right: "20px",
      width: BASE_W + "px",
      height: BASE_H + "px",
      borderRadius: "14px",
      overflow: "hidden",
      boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
      zIndex: "2147483646",
      display: "none",
      flexDirection: "column",
      backgroundColor: "#fff",
      transition: "width 0.2s ease, height 0.2s ease",
    });

    // Branded header: [expand] [logo + title/subtitle] [close]
    var header = document.createElement("div");
    Object.assign(header.style, {
      height: HEADER_H + "px",
      flex: "0 0 auto",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 8px",
      backgroundColor: accentColor,
      color: "#fff",
    });

    expandBtn = headerButton("Expand chat");
    expandBtn.innerHTML = expandIcon;
    expandBtn.onclick = function (e) {
      e.stopPropagation();
      toggleExpand();
    };

    var brand = document.createElement("div");
    Object.assign(brand.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      flex: "1 1 auto",
      justifyContent: "center",
      minWidth: "0",
      padding: "0 4px",
    });
    var brandText =
      '<div style="display:flex;flex-direction:column;line-height:1.15;min-width:0;">' +
      '<span style="font-weight:700;font-size:14px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
      title +
      "</span>" +
      '<span style="font-size:11px;opacity:0.85;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
      subtitle +
      "</span></div>";
    brand.innerHTML = brandText;

    var closeBtn = headerButton("Close chat");
    closeBtn.innerHTML = closeIcon;
    closeBtn.onclick = function (e) {
      e.stopPropagation();
      toggle(false);
    };

    header.appendChild(expandBtn);
    header.appendChild(brand);
    header.appendChild(closeBtn);

    var iframe = document.createElement("iframe");
    iframe.src = iframeUrl;
    iframe.setAttribute("title", title + " chat");
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
    panel.style.display = isOpen ? "flex" : "none";
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
        height: window.innerHeight - 88 + "px",
        right: "12px",
        bottom: "76px",
      });
      return;
    }

    if (expandBtn) expandBtn.style.display = "flex";

    var factor = expanded ? EXPAND : 1;
    var maxW = window.innerWidth - 40;
    var maxH = window.innerHeight - 108;
    var w = Math.min(Math.round(BASE_W * factor), maxW);
    var h = Math.min(Math.round(BASE_H * factor), maxH);

    Object.assign(panel.style, {
      width: w + "px",
      height: h + "px",
      right: "20px",
      bottom: "88px",
    });
  }

  bubble.onclick = function () {
    toggle();
  };
  bubble.onkeydown = function (e) {
    if (e.key === "Enter" || e.key === " ") toggle();
  };

  window.addEventListener("resize", applySize);

  document.body.appendChild(bubble);
})();
