(function () {
  var script = document.currentScript;
  if (!script) return;

  var widgetId = script.getAttribute("data-widget-id");
  if (!widgetId) return;

  var origin = new URL(script.src).origin;
  var iframeUrl = origin + "/widget/" + widgetId;
  var accentColor = script.getAttribute("data-accent-color") || "#1a73e8";

  var isOpen = false;
  var panel = null;

  // Chat bubble button
  var bubble = document.createElement("div");
  bubble.setAttribute("aria-label", "Open chat");
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

  function createPanel() {
    panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "fixed",
      bottom: "88px",
      right: "20px",
      width: "400px",
      height: "600px",
      borderRadius: "12px",
      overflow: "hidden",
      boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
      zIndex: "2147483646",
      display: "none",
      flexDirection: "column",
      backgroundColor: "#fff",
    });

    // Header with close button
    var header = document.createElement("div");
    Object.assign(header.style, {
      height: "40px",
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      padding: "0 8px",
      backgroundColor: "#f5f5f5",
      borderBottom: "1px solid #e5e5e5",
    });

    var closeBtn = document.createElement("button");
    closeBtn.setAttribute("aria-label", "Close chat");
    Object.assign(closeBtn.style, {
      background: "none",
      border: "none",
      cursor: "pointer",
      padding: "4px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#737373",
    });
    closeBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.onclick = function (e) {
      e.stopPropagation();
      toggle(false);
    };
    header.appendChild(closeBtn);

    // Iframe
    var iframe = document.createElement("iframe");
    iframe.src = iframeUrl;
    Object.assign(iframe.style, {
      width: "100%",
      height: "calc(100% - 40px)",
      border: "none",
    });

    panel.appendChild(header);
    panel.appendChild(iframe);
    document.body.appendChild(panel);

    applyResponsive();
  }

  function toggle(open) {
    isOpen = typeof open === "boolean" ? open : !isOpen;
    if (!panel) createPanel();
    panel.style.display = isOpen ? "flex" : "none";
  }

  function applyResponsive() {
    if (!panel) return;
    if (window.innerWidth < 500) {
      Object.assign(panel.style, {
        width: "calc(100% - 24px)",
        height: "calc(100% - 88px)",
        right: "12px",
        bottom: "76px",
        borderRadius: "12px",
      });
    } else {
      Object.assign(panel.style, {
        width: "400px",
        height: "600px",
        right: "20px",
        bottom: "88px",
        borderRadius: "12px",
      });
    }
  }

  bubble.onclick = function () {
    toggle();
  };
  bubble.onkeydown = function (e) {
    if (e.key === "Enter" || e.key === " ") toggle();
  };

  window.addEventListener("resize", applyResponsive);

  document.body.appendChild(bubble);
})();
