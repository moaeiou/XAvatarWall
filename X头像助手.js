// ==UserScript==
// @name         X头像助手
// @namespace    https://tampermonkey.net/
// @version      0.1.4
// @updateURL    https://raw.githubusercontent.com/moaeiou/XAvatarWall/refs/heads/main/X头像助手.js
// @downloadURL  https://raw.githubusercontent.com/moaeiou/XAvatarWall/refs/heads/main/X头像助手.js
// @description  X粉丝头像自动采集工具（时间顺序版）
// @author       MoAEIOU
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  if (window.XAvatar) return;
  window.XAvatar = true;

  const NO_NEW_STOP_THRESHOLD = 10;
  const NO_NEW_FORCE_STOP = 20;
  const SCROLL_DELAY_MIN = 1800;
  const SCROLL_DELAY_JITTER = 1200;
  const STORE_KEY = "xavatar-users-v1";
  const RESERVED = new Set([
    "home",
    "explore",
    "notifications",
    "messages",
    "i",
    "settings",
    "search",
    "compose",
    "login",
    "signup",
    "tos",
    "privacy",
    "hashtag",
    "intent",
    "share",
    "jobs",
    "about",
    "download",
  ]);

  let running = false;
  let users = new Map();
  let scrollCount = 0;
  let noNew = 0;

  function sleep(t) {
    return new Promise((r) => setTimeout(r, t));
  }

  function isListPage() {
    return /\/(followers|following|verified_followers)\/?$/.test(
      location.pathname,
    );
  }

  function isNearBottom() {
    const el = document.scrollingElement || document.documentElement;
    return el.scrollTop + window.innerHeight >= el.scrollHeight - 120;
  }

  function upgradeAvatar(url) {
    if (!url) return "";
    let out = url.replace(
      /_(mini|normal|bigger|reasonably_small|200x200|x96|96x96)\./,
      "_400x400.",
    );
    out = out.replace(
      /([?&]name=)(mini|normal|bigger|reasonably_small|200x200|x96|96x96)\b/i,
      "$1400x400",
    );
    return out;
  }

  function extractUsername(cell) {
    const links = cell.querySelectorAll('a[href^="/"]');
    for (const a of links) {
      const href = (a.getAttribute("href") || "").split("?")[0];
      const m = href.match(/^\/([A-Za-z0-9_]{1,15})(?:\/|$)/);
      if (!m) continue;
      const username = m[1];
      if (RESERVED.has(username.toLowerCase())) continue;
      return username;
    }
    return "";
  }

  function saveUsers() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify([...users.values()]));
    } catch (_) {}
  }

  function loadUsers() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      for (const u of arr) {
        if (!u || !u.username) continue;
        users.set(u.username, {
          username: u.username,
          avatar: upgradeAvatar(u.avatar || ""),
          time: u.time || Date.now(),
          order: u.order || users.size + 1,
        });
      }
    } catch (_) {}
  }

  function exportStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return (
      d.getFullYear() +
      p(d.getMonth() + 1) +
      p(d.getDate()) +
      p(d.getHours()) +
      p(d.getMinutes()) +
      p(d.getSeconds())
    );
  }

  function tomlString(s) {
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }

  const style = document.createElement("style");
  style.textContent = `
    .xa-toggle-btn {
      position: fixed;
      right: 16px;
      bottom: 160px;
      width: 56px;
      height: 56px;
      z-index: 999;
      font-size: 22px;
      border-radius: 50%;
      border: 0;
      background: linear-gradient(135deg, #1d9bf0, #7c3aed);
      box-shadow: 0 4px 14px rgba(29, 155, 240, 0.45);
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
    }

    .xa-toggle-btn:hover {
      transform: scale(1.08) rotate(-8deg);
      box-shadow: 0 6px 20px rgba(29, 155, 240, 0.6);
      filter: brightness(1.08);
    }

    .xa-toggle-btn:active {
      transform: scale(0.94);
    }

    .xa-panel {
      position: fixed;
      right: 15px;
      bottom: 190px;
      width: 300px;
      z-index: 998;
      display: none;
      padding: 15px;
      border-radius: 15px;
      background: #111e;
      color: #fff;
      font-family: sans-serif;
    }

    .xa-panel.xa-panel-open {
      display: block;
    }

    .xa-title {
      font-size: 18px;
      font-weight: bold;
      cursor: move;
      user-select: none;
    }

    .xa-row {
      margin-top: 8px;
    }

    .xa-btn {
      width: 100%;
      margin-top: 12px;
      padding: 10px;
      border: 0;
      border-radius: 20px;
      color: #fff;
      cursor: pointer;
      transition: filter 0.2s ease, transform 0.1s ease;
    }

    .xa-btn:hover {
      filter: brightness(1.12);
    }

    .xa-btn:active {
      transform: scale(0.98);
    }

    .xa-btn-start {
      background: #1d9bf0;
    }

    .xa-btn-stop {
      background: #e0245e;
    }

    .xa-btn-export {
      background: #17bf63;
    }

    .xa-btn-clear {
      background: #536471;
    }
  `;
  document.head.appendChild(style);

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "xa-toggle-btn";
  toggleBtn.textContent = "🖼";
  document.body.appendChild(toggleBtn);

  const panel = document.createElement("div");
  panel.className = "xa-panel";
  panel.innerHTML = `
    <div class="xa-title" id="xa-drag">X头像助手</div>

    <div class="xa-row">状态：<span id="xa-status">还未开始</span></div>
    <div class="xa-row">用户：<span id="xa-count">0</span></div>
    <div class="xa-row">头像：<span id="xa-avatar">0</span></div>
    <div class="xa-row">滚动：<span id="xa-scroll">0</span></div>

    <button class="xa-btn xa-btn-start" id="xa-start">开始采集</button>
    <button class="xa-btn xa-btn-stop" id="xa-stop">停止</button>
    <button class="xa-btn xa-btn-export" id="xa-export">导出为TOML文件</button>
    <button class="xa-btn xa-btn-clear" id="xa-clear">清空记录</button>
  `;
  document.body.appendChild(panel);

  toggleBtn.onclick = () => {
    panel.classList.toggle("xa-panel-open");
  };

  function refreshCounts() {
    document.querySelector("#xa-count").textContent = users.size;
    document.querySelector("#xa-avatar").textContent = [
      ...users.values(),
    ].filter((u) => u.avatar).length;
  }

  function scan() {
    const before = users.size;

    document.querySelectorAll('[data-testid="UserCell"]').forEach((cell) => {
      const username = extractUsername(cell);
      if (!username) return;

      const img = cell.querySelector("img");
      const avatar = upgradeAvatar(img ? img.src || "" : "");
      if (!avatar) return;

      const existing = users.get(username);
      if (existing) {
        existing.avatar = avatar;
        return;
      }

      users.set(username, {
        username: username,
        avatar: avatar,
        time: Date.now(),
        order: users.size + 1,
      });
    });

    const added = users.size - before;
    noNew = added === 0 ? noNew + 1 : 0;
    refreshCounts();
    if (added > 0) saveUsers();
  }

  async function run() {
    while (running) {
      document.querySelector("#xa-status").textContent = "扫描中";
      scan();
      document.querySelector("#xa-scroll").textContent = scrollCount;

      if (noNew >= NO_NEW_FORCE_STOP || (noNew >= NO_NEW_STOP_THRESHOLD && isNearBottom())) {
        document.querySelector("#xa-status").textContent = "没有新增，自动停止";
        running = false;
        saveUsers();
        break;
      }

      document.querySelector("#xa-status").textContent = "加载中";
      window.scrollBy(0, window.innerHeight * 0.8);
      scrollCount++;

      await sleep(SCROLL_DELAY_MIN + Math.random() * SCROLL_DELAY_JITTER);
    }
  }

  document.querySelector("#xa-start").onclick = () => {
    if (running) return;
    if (!isListPage()) {
      document.querySelector("#xa-status").textContent =
        "当前不像粉丝/关注列表页，仍继续采集";
    }
    running = true;
    scrollCount = 0;
    noNew = 0;
    run();
  };

  document.querySelector("#xa-stop").onclick = () => {
    running = false;
    saveUsers();
    document.querySelector("#xa-status").textContent = "已停止";
  };

  document.querySelector("#xa-clear").onclick = () => {
    if (running) return;
    users = new Map();
    scrollCount = 0;
    noNew = 0;
    try {
      localStorage.removeItem(STORE_KEY);
    } catch (_) {}
    refreshCounts();
    document.querySelector("#xa-status").textContent = "已清空";
  };

  document.querySelector("#xa-export").onclick = () => {
    const list = [...users.values()].filter((u) => u.avatar);

    const lines = [];
    for (const u of list) {
      lines.push("[[avatar]]");
      lines.push('username = "' + tomlString(u.username) + '"');
      lines.push('avatar = "' + tomlString(upgradeAvatar(u.avatar)) + '"');
      lines.push("time = " + u.time);
      lines.push("order = " + u.order);
      lines.push("");
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "avatar_" + exportStamp() + ".toml";
    a.click();

    URL.revokeObjectURL(url);
    saveUsers();
  };

  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  const dragHandle = document.querySelector("#xa-drag");

  dragHandle.onmousedown = (e) => {
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
  };

  document.onmousemove = (e) => {
    if (!dragging) return;
    panel.style.left = e.clientX - dragOffsetX + "px";
    panel.style.top = e.clientY - dragOffsetY + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  };

  document.onmouseup = () => {
    dragging = false;
  };

  loadUsers();
  refreshCounts();
  if (users.size > 0) {
    document.querySelector("#xa-status").textContent =
      "已恢复上次记录 " + users.size + " 人";
  }
  setTimeout(scan, 2000);
})();
