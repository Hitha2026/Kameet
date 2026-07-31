"use strict";

(() => {
  const configuredServer = String(window.PONG_CONFIG?.serverUrl || "").trim().replace(/\/+$/, "");
  const githubPages = location.hostname.endsWith("github.io");
  let source = "./socket.io/socket.io.js";

  if (configuredServer) {
    try {
      source = new URL("/socket.io/socket.io.js", `${configuredServer}/`).href;
    } catch (_) {
      source = "https://cdn.socket.io/4.8.1/socket.io.min.js";
    }
  } else if (githubPages) {
    source = "https://cdn.socket.io/4.8.1/socket.io.min.js";
  }

  const safeSource = source.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  document.write(`<script src="${safeSource}" crossorigin="anonymous"></${"script"}>`);
})();
