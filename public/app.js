"use strict";

const WORLD = Object.freeze({ width: 960, height: 540 });
const COLORS = Object.freeze({
  cyan: "#35dcff",
  cyanDark: "#009fc7",
  violet: "#a68dff",
  green: "#51e3a2",
  amber: "#ffca63",
  red: "#ff7189",
  white: "#eff9ff"
});
const AI_LEVELS = Object.freeze({
  easy: { label: "سهل", speed: 295, reaction: 3.7, error: 78 },
  medium: { label: "متوسط", speed: 370, reaction: 5.4, error: 42 },
  hard: { label: "صعب", speed: 440, reaction: 7.2, error: 19 },
  expert: { label: "خبير", speed: 510, reaction: 9.2, error: 6 }
});

const RUNTIME_CONFIG = Object.freeze(window.PONG_CONFIG || {});
const SERVER_URL = String(RUNTIME_CONFIG.serverUrl || "").trim().replace(/\/+$/, "");
const IS_GITHUB_PAGES = location.hostname.endsWith("github.io");
const ONLINE_BACKEND_READY = Boolean(SERVER_URL) || !IS_GITHUB_PAGES;
const endpoint = (path) => `${SERVER_URL}${path}`;

const $ = (selector) => document.querySelector(selector);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomRange = (min, max) => min + Math.random() * (max - min);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ui = {
  homeView: $("#homeView"), gameView: $("#gameView"), canvas: $("#gameCanvas"), canvasWrap: $("#canvasWrap"),
  connectionDot: $("#connectionDot"), connectionLabel: $("#connectionLabel"), accountBtn: $("#accountBtn"),
  accountAvatar: $("#accountAvatar"), accountLabel: $("#accountLabel"), installBtn: $("#installBtn"), soundBtn: $("#soundBtn"),
  fullscreenBtn: $("#fullscreenBtn"), gameFullscreenBtn: $("#gameFullscreenBtn"), onlineCount: $("#onlineCount"),
  searchingCount: $("#searchingCount"), matchesCount: $("#matchesCount"), aiDifficulty: $("#aiDifficulty"),
  playAiBtn: $("#playAiBtn"), quickMatchBtn: $("#quickMatchBtn"), createRoomBtn: $("#createRoomBtn"),
  roomCodeInput: $("#roomCodeInput"), joinRoomBtn: $("#joinRoomBtn"), profileLoginBtn: $("#profileLoginBtn"),
  guestProfile: $("#guestProfile"), userProfile: $("#userProfile"), profileWins: $("#profileWins"),
  profileLosses: $("#profileLosses"), profileGames: $("#profileGames"), leftPlayerName: $("#leftPlayerName"),
  rightPlayerName: $("#rightPlayerName"), leftPlayerStatus: $("#leftPlayerStatus"), rightPlayerStatus: $("#rightPlayerStatus"),
  leftScore: $("#leftScore"), rightScore: $("#rightScore"), matchModeLabel: $("#matchModeLabel"),
  levelMetric: $("#levelMetric"), bricksMetric: $("#bricksMetric"), typeMetric: $("#typeMetric"),
  latencyMetric: $("#latencyMetric"), countdown: $("#countdown"), liveStatus: $("#liveStatus"),
  upBtn: $("#upBtn"), downBtn: $("#downBtn"), leaveGameBtn: $("#leaveGameBtn"),
  authModal: $("#authModal"), loginTab: $("#loginTab"), registerTab: $("#registerTab"), authForm: $("#authForm"),
  displayNameField: $("#displayNameField"), displayNameInput: $("#displayNameInput"), usernameInput: $("#usernameInput"),
  passwordInput: $("#passwordInput"), authError: $("#authError"), authSubmitBtn: $("#authSubmitBtn"),
  waitingModal: $("#waitingModal"), waitingTitle: $("#waitingTitle"), waitingText: $("#waitingText"),
  roomCodeBox: $("#roomCodeBox"), roomCodeValue: $("#roomCodeValue"), copyCodeBtn: $("#copyCodeBtn"),
  cancelWaitingBtn: $("#cancelWaitingBtn"), resultModal: $("#resultModal"), resultIcon: $("#resultIcon"),
  resultTitle: $("#resultTitle"), resultText: $("#resultText"), resultLeftScore: $("#resultLeftScore"),
  resultRightScore: $("#resultRightScore"), resultLevel: $("#resultLevel"), resultBricks: $("#resultBricks"),
  resultHomeBtn: $("#resultHomeBtn"), confirmModal: $("#confirmModal"), confirmLeaveBtn: $("#confirmLeaveBtn"),
  toast: $("#toast")
};

class SoundEngine {
  constructor() {
    this.context = null;
    this.gain = null;
    this.enabled = true;
  }

  async unlock() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      this.context = new AudioContextClass();
      this.gain = this.context.createGain();
      this.gain.gain.value = .36;
      this.gain.connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      try { await this.context.resume(); } catch (_) { /* Browser audio policy. */ }
    }
  }

  tone(frequency, duration = .07, type = "sine", volume = .08, endFrequency = null) {
    if (!this.enabled || !this.context || !this.gain) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.gain);
    oscillator.start(now);
    oscillator.stop(now + duration + .02);
  }

  hit() { this.tone(560, .07, "sine", .07, 740); }
  brick() { this.tone(820, .08, "triangle", .065, 1080); }
  wall() { this.tone(910, .04, "square", .03, 720); }
  score(won) { this.tone(won ? 520 : 180, .14, "sawtooth", .07, won ? 800 : 120); }
  toggle() {
    this.enabled = !this.enabled;
    if (this.gain) this.gain.gain.value = this.enabled ? .36 : 0;
    return this.enabled;
  }
}

class LocalGame {
  constructor({ difficulty, playerName, onFinish, sounds }) {
    this.difficulty = AI_LEVELS[difficulty] || AI_LEVELS.medium;
    this.playerName = playerName || "اللاعب";
    this.onFinish = onFinish;
    this.sounds = sounds;
    this.paddle = { width: 16, height: 112, speed: 470 };
    this.left = { x: 24, y: (WORLD.height - 112) / 2, score: 0 };
    this.right = { x: WORLD.width - 40, y: (WORLD.height - 112) / 2, score: 0 };
    this.ball = { x: WORLD.width / 2, y: WORLD.height / 2, r: 9, vx: 0, vy: 0, speed: 350 };
    this.input = 0;
    this.level = 1;
    this.bricks = [];
    this.bricksRemaining = 0;
    this.destroyedBricks = 0;
    this.targetScore = 7;
    this.status = "countdown";
    this.serveAt = performance.now() + 2200;
    this.nextDirection = Math.random() < .5 ? -1 : 1;
    this.finished = false;
    this.aiNoise = 0;
    this.aiNoiseAt = 0;
    this.buildBricks();
  }

  buildBricks() {
    this.bricks = [];
    const rows = Math.min(6, 3 + Math.floor((this.level - 1) / 2));
    const cols = Math.min(10, 8 + Math.floor((this.level - 1) / 3));
    const gap = 8;
    const totalWidth = 570;
    const width = (totalWidth - gap * (cols - 1)) / cols;
    const height = 22;
    const startX = (WORLD.width - totalWidth) / 2;
    const edgeOffset = 64;
    const colors = [COLORS.cyan, COLORS.violet, COLORS.green, COLORS.amber, COLORS.red, "#6bb6ff"];
    const formations = [
      { key: "top", yForRow: (row) => edgeOffset + row * (height + gap) },
      { key: "bottom", yForRow: (row) => WORLD.height - edgeOffset - height - row * (height + gap) }
    ];

    for (const [formationIndex, formation] of formations.entries()) {
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          this.bricks.push({
            id: `${this.level}-${formation.key}-${row}-${col}`,
            side: formation.key,
            x: startX + col * (width + gap),
            y: formation.yForRow(row),
            w: width,
            h: height,
            color: colors[(row + col + formationIndex * 2) % colors.length],
            alive: true
          });
        }
      }
    }
    this.bricksRemaining = this.bricks.length;
  }

  setInput(direction) { this.input = clamp(Number(direction) || 0, -1, 1); }

  serve(direction = this.nextDirection) {
    this.ball.x = WORLD.width / 2;
    this.ball.y = WORLD.height / 2 + randomRange(-55, 55);
    this.ball.speed = Math.min(650, 350 + (this.level - 1) * 28);
    const angle = randomRange(-.32, .32);
    this.ball.vx = direction * this.ball.speed * Math.cos(angle);
    this.ball.vy = this.ball.speed * Math.sin(angle);
    this.status = "playing";
  }

  update(dt, now) {
    if (this.finished) return;
    if (this.status === "countdown") {
      if (now >= this.serveAt) this.serve();
      return;
    }

    this.left.y = clamp(this.left.y + this.input * this.paddle.speed * dt, 0, WORLD.height - this.paddle.height);
    this.updateAI(dt, now);
    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;

    if (this.ball.y - this.ball.r <= 0) {
      this.ball.y = this.ball.r;
      this.ball.vy = Math.abs(this.ball.vy);
      this.sounds.wall();
    } else if (this.ball.y + this.ball.r >= WORLD.height) {
      this.ball.y = WORLD.height - this.ball.r;
      this.ball.vy = -Math.abs(this.ball.vy);
      this.sounds.wall();
    }

    this.collidePaddle(this.left, true);
    this.collidePaddle(this.right, false);
    this.collideBricks();

    if (this.ball.x + this.ball.r < 0) {
      this.right.score += 1;
      this.sounds.score(false);
      if (this.right.score >= this.targetScore) this.finish(false);
      else this.resetPoint(-1);
    } else if (this.ball.x - this.ball.r > WORLD.width) {
      this.left.score += 1;
      this.sounds.score(true);
      if (this.left.score >= this.targetScore) this.finish(true);
      else this.resetPoint(1);
    }
  }

  updateAI(dt, now) {
    if (now >= this.aiNoiseAt) {
      this.aiNoise = randomRange(-this.difficulty.error, this.difficulty.error);
      this.aiNoiseAt = now + randomRange(260, 620);
    }
    let predicted = this.ball.y;
    if (this.ball.vx > 0) {
      const travelTime = Math.max(0, (this.right.x - this.ball.x) / Math.max(this.ball.vx, 1));
      predicted += this.ball.vy * Math.min(travelTime, .8) * .6;
    }
    predicted += this.aiNoise;
    const target = predicted - this.paddle.height / 2;
    const difference = target - this.right.y;
    const desired = clamp(difference * this.difficulty.reaction, -this.difficulty.speed, this.difficulty.speed);
    this.right.y = clamp(this.right.y + desired * dt, 0, WORLD.height - this.paddle.height);
  }

  collidePaddle(player, isLeft) {
    if ((isLeft && this.ball.vx >= 0) || (!isLeft && this.ball.vx <= 0)) return;
    const left = player.x;
    const right = player.x + this.paddle.width;
    const top = player.y;
    const bottom = player.y + this.paddle.height;
    if (this.ball.x + this.ball.r < left || this.ball.x - this.ball.r > right || this.ball.y + this.ball.r < top || this.ball.y - this.ball.r > bottom) return;

    const normalized = clamp((this.ball.y - (player.y + this.paddle.height / 2)) / (this.paddle.height / 2), -1, 1);
    const angle = normalized * Math.PI / 3;
    this.ball.speed = Math.min(700, this.ball.speed + 15);
    this.ball.vx = (isLeft ? 1 : -1) * this.ball.speed * Math.cos(angle);
    this.ball.vy = this.ball.speed * Math.sin(angle);
    this.ball.x = isLeft ? right + this.ball.r + 1 : left - this.ball.r - 1;
    this.sounds.hit();
  }

  collideBricks() {
    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      const nearestX = clamp(this.ball.x, brick.x, brick.x + brick.w);
      const nearestY = clamp(this.ball.y, brick.y, brick.y + brick.h);
      const dx = this.ball.x - nearestX;
      const dy = this.ball.y - nearestY;
      if (dx * dx + dy * dy > this.ball.r * this.ball.r) continue;
      brick.alive = false;
      this.bricksRemaining -= 1;
      this.destroyedBricks += 1;
      const horizontalOverlap = Math.min(Math.abs(this.ball.x - brick.x), Math.abs(this.ball.x - (brick.x + brick.w)));
      const verticalOverlap = Math.min(Math.abs(this.ball.y - brick.y), Math.abs(this.ball.y - (brick.y + brick.h)));
      if (horizontalOverlap < verticalOverlap) this.ball.vx *= -1;
      else this.ball.vy *= -1;
      this.sounds.brick();
      if (this.bricksRemaining <= 0) {
        this.level += 1;
        this.buildBricks();
        this.status = "countdown";
        this.serveAt = performance.now() + 1250;
        this.nextDirection = Math.random() < .5 ? -1 : 1;
        this.ball.x = WORLD.width / 2;
        this.ball.y = WORLD.height / 2;
        this.ball.vx = 0;
        this.ball.vy = 0;
      }
      break;
    }
  }

  resetPoint(direction) {
    this.status = "countdown";
    this.serveAt = performance.now() + 1050;
    this.nextDirection = direction;
    this.ball.x = WORLD.width / 2;
    this.ball.y = WORLD.height / 2;
    this.ball.vx = 0;
    this.ball.vy = 0;
  }

  finish(playerWon) {
    this.finished = true;
    this.status = "finished";
    this.onFinish({
      won: playerWon,
      leftScore: this.left.score,
      rightScore: this.right.score,
      level: this.level,
      destroyedBricks: this.destroyedBricks,
      winnerName: playerWon ? this.playerName : "الذكاء الاصطناعي"
    });
  }

  snapshot() {
    return {
      status: this.status,
      serveAt: this.serveAt,
      localClock: true,
      level: this.level,
      targetScore: this.targetScore,
      bricksRemaining: this.bricksRemaining,
      destroyedBricks: this.destroyedBricks,
      paddle: this.paddle,
      ball: this.ball,
      left: { ...this.left, user: { displayName: this.playerName } },
      right: { ...this.right, user: { displayName: "الذكاء الاصطناعي" } },
      bricks: this.bricks.filter((brick) => brick.alive)
    };
  }
}

class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.dpr = 1;
    this.trail = [];
    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("orientationchange", () => setTimeout(() => this.resize(), 150));
  }

  resize() {
    this.dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    this.canvas.width = Math.round(WORLD.width * this.dpr);
    this.canvas.height = Math.round(WORLD.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  roundRect(x, y, width, height, radius) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  render(state) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const background = ctx.createLinearGradient(0, 0, WORLD.width, WORLD.height);
    background.addColorStop(0, "#020a13");
    background.addColorStop(.55, "#051522");
    background.addColorStop(1, "#060d19");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    ctx.strokeStyle = "rgba(255,255,255,.026)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD.width; x += 48) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.height); ctx.stroke();
    }
    for (let y = 0; y <= WORLD.height; y += 48) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD.width, y); ctx.stroke();
    }

    ctx.fillStyle = "rgba(255,255,255,.07)";
    for (let y = 15; y < WORLD.height; y += 28) ctx.fillRect(WORLD.width / 2 - 1, y, 2, 15);

    for (const brick of state?.bricks || []) {
      const glow = ctx.createLinearGradient(brick.x, brick.y, brick.x, brick.y + brick.h);
      glow.addColorStop(0, brick.color);
      glow.addColorStop(1, this.mixWithBlack(brick.color, .3));
      ctx.shadowColor = brick.color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = glow;
      this.roundRect(brick.x, brick.y, brick.w, brick.h, 5);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,.18)";
      this.roundRect(brick.x + 5, brick.y + 4, Math.max(4, brick.w - 10), 2, 1);
      ctx.fill();
    }

    if (!state) return;
    this.drawPaddle(state.left.x, state.left.y, state.paddle.width, state.paddle.height, COLORS.cyan);
    this.drawPaddle(state.right.x, state.right.y, state.paddle.width, state.paddle.height, COLORS.violet);

    if (state.ball) {
      this.trail.push({ x: state.ball.x, y: state.ball.y, at: performance.now() });
      if (this.trail.length > 12) this.trail.shift();
      this.trail.forEach((point, index) => {
        const opacity = (index / this.trail.length) * .17;
        ctx.beginPath();
        ctx.fillStyle = `rgba(53,220,255,${opacity})`;
        ctx.arc(point.x, point.y, state.ball.r * (index / this.trail.length), 0, Math.PI * 2);
        ctx.fill();
      });
      const ballGradient = ctx.createRadialGradient(state.ball.x - 3, state.ball.y - 3, 1, state.ball.x, state.ball.y, state.ball.r * 1.25);
      ballGradient.addColorStop(0, "#ffffff");
      ballGradient.addColorStop(.28, "#c9faff");
      ballGradient.addColorStop(1, COLORS.cyanDark);
      ctx.shadowColor = COLORS.cyan;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.fillStyle = ballGradient;
      ctx.arc(state.ball.x, state.ball.y, state.ball.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  drawPaddle(x, y, width, height, color) {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(.18, color);
    gradient.addColorStop(1, this.mixWithBlack(color, .42));
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = gradient;
    this.roundRect(x, y, width, height, 8);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  mixWithBlack(hex, amount) {
    const normalized = hex.replace("#", "");
    const number = Number.parseInt(normalized, 16);
    if (!Number.isFinite(number)) return hex;
    const red = Math.round(((number >> 16) & 255) * (1 - amount));
    const green = Math.round(((number >> 8) & 255) * (1 - amount));
    const blue = Math.round((number & 255) * (1 - amount));
    return `rgb(${red},${green},${blue})`;
  }
}

const app = {
  token: localStorage.getItem("pong.token") || "",
  user: null,
  socket: null,
  mode: "home",
  localGame: null,
  onlineState: null,
  onlineSide: null,
  opponent: null,
  waitingKind: null,
  authMode: "login",
  pendingOnlineAction: null,
  input: { up: false, down: false, pointer: false, pointerTarget: null, lastSent: null },
  lastFrame: performance.now(),
  lastSnapshotAt: 0,
  toastTimer: null,
  deferredInstallPrompt: null,
  sounds: new SoundEngine(),
  renderer: null
};

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 2800);
}

function openModal(element) { element.classList.add("open"); }
function closeModal(element) { element.classList.remove("open"); }

function setConnection(status, label) {
  ui.connectionDot.classList.toggle("online", status === "online");
  ui.connectionDot.classList.toggle("offline", status !== "online");
  ui.connectionLabel.textContent = label;
}

function updateAccountUI() {
  if (app.user) {
    ui.accountLabel.textContent = app.user.displayName;
    ui.accountAvatar.textContent = app.user.displayName.slice(0, 1).toUpperCase();
    ui.guestProfile.classList.add("hidden");
    ui.userProfile.classList.remove("hidden");
    ui.profileWins.textContent = app.user.wins || 0;
    ui.profileLosses.textContent = app.user.losses || 0;
    ui.profileGames.textContent = app.user.games || 0;
  } else {
    ui.accountLabel.textContent = "تسجيل الدخول";
    ui.accountAvatar.textContent = "ز";
    ui.guestProfile.classList.remove("hidden");
    ui.userProfile.classList.add("hidden");
  }
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (app.token) headers.Authorization = `Bearer ${app.token}`;
  if (!ONLINE_BACKEND_READY) {
    throw new Error("خادم اللعب الأونلاين غير مضبوط. حدّث serverUrl داخل public/config.js.");
  }
  const response = await fetch(endpoint(path), { ...options, headers });
  let data = {};
  try { data = await response.json(); } catch (_) { /* Empty body. */ }
  if (!response.ok) throw new Error(data.error || "تعذر تنفيذ الطلب.");
  return data;
}

async function restoreSession() {
  if (!app.token) {
    updateAccountUI();
    setConnection("offline", "وضع محلي");
    return;
  }
  try {
    const data = await api("/api/me");
    app.user = data.user;
    updateAccountUI();
    connectSocket();
  } catch (_) {
    logout(false);
  }
}

function connectSocket() {
  if (!app.token || !window.io) return;
  if (app.socket) app.socket.disconnect();
  if (!ONLINE_BACKEND_READY) {
    setConnection("offline", "وضع GitHub Pages المحلي");
    showToast("اللعب ضد الذكاء الاصطناعي متاح. اضبط رابط الخادم لتفعيل الأونلاين.");
    return;
  }
  app.socket = window.io(SERVER_URL || undefined, {
    auth: { token: app.token },
    reconnectionAttempts: 6,
    timeout: 9000,
    transports: ["websocket", "polling"]
  });

  app.socket.on("connect", () => setConnection("online", "متصل بالخادم"));
  app.socket.on("disconnect", () => {
    setConnection("offline", "انقطع الاتصال");
    if (app.mode === "online") showToast("انقطع الاتصال بالخادم. يحاول النظام إعادة الاتصال.");
  });
  app.socket.on("connect_error", (error) => {
    if (["AUTH_REQUIRED", "AUTH_INVALID"].includes(error.message)) logout(false);
    setConnection("offline", "الخادم غير متاح");
  });
  app.socket.on("session", ({ user }) => {
    app.user = user;
    updateAccountUI();
  });
  app.socket.on("presence", ({ online, searching, activeMatches }) => {
    ui.onlineCount.textContent = online ?? 0;
    ui.searchingCount.textContent = searching ?? 0;
    ui.matchesCount.textContent = activeMatches ?? 0;
  });
  app.socket.on("queue:waiting", ({ position }) => {
    ui.waitingText.textContent = `أنت في قائمة الانتظار. ترتيبك التقريبي: ${position}`;
  });
  app.socket.on("room:waiting", ({ code }) => showPrivateWaiting(code));
  app.socket.on("match:found", (payload) => startOnlineMatch(payload));
  app.socket.on("game:state", (state) => {
    app.onlineState = state;
    app.lastSnapshotAt = performance.now();
  });
  app.socket.on("game:level", ({ level }) => showToast(`انتقال إلى المستوى ${level}`));
  app.socket.on("game:over", (result) => finishOnlineGame(result));
}

function logout(showMessage = true) {
  app.socket?.disconnect();
  app.socket = null;
  app.token = "";
  app.user = null;
  localStorage.removeItem("pong.token");
  updateAccountUI();
  setConnection("offline", "وضع محلي");
  if (showMessage) showToast("تم تسجيل الخروج.");
}

function showAuth(mode = "login", pendingAction = null) {
  app.pendingOnlineAction = pendingAction;
  setAuthMode(mode);
  ui.authError.classList.add("hidden");
  ui.authForm.reset();
  openModal(ui.authModal);
  setTimeout(() => ui.usernameInput.focus(), 80);
}

function setAuthMode(mode) {
  app.authMode = mode;
  const register = mode === "register";
  ui.loginTab.classList.toggle("active", !register);
  ui.registerTab.classList.toggle("active", register);
  ui.displayNameField.classList.toggle("hidden", !register);
  ui.displayNameInput.required = register;
  ui.authSubmitBtn.textContent = register ? "إنشاء الحساب" : "تسجيل الدخول";
  ui.passwordInput.autocomplete = register ? "new-password" : "current-password";
}

async function submitAuth(event) {
  event.preventDefault();
  ui.authError.classList.add("hidden");
  ui.authSubmitBtn.disabled = true;
  ui.authSubmitBtn.textContent = "جارٍ التحقق...";
  try {
    const body = {
      username: ui.usernameInput.value.trim(),
      password: ui.passwordInput.value
    };
    if (app.authMode === "register") body.displayName = ui.displayNameInput.value.trim();
    const data = await api(app.authMode === "register" ? "/api/register" : "/api/login", {
      method: "POST",
      body: JSON.stringify(body)
    });
    app.token = data.token;
    app.user = data.user;
    localStorage.setItem("pong.token", app.token);
    updateAccountUI();
    connectSocket();
    closeModal(ui.authModal);
    showToast(app.authMode === "register" ? "تم إنشاء الحساب بنجاح." : "تم تسجيل الدخول بنجاح.");
    const action = app.pendingOnlineAction;
    app.pendingOnlineAction = null;
    if (action) {
      await waitForSocket();
      action();
    }
  } catch (error) {
    ui.authError.textContent = error.message;
    ui.authError.classList.remove("hidden");
  } finally {
    ui.authSubmitBtn.disabled = false;
    ui.authSubmitBtn.textContent = app.authMode === "register" ? "إنشاء الحساب" : "تسجيل الدخول";
  }
}

async function waitForSocket() {
  for (let attempt = 0; attempt < 35; attempt += 1) {
    if (app.socket?.connected) return true;
    await sleep(100);
  }
  throw new Error("تعذر الاتصال بالخادم.");
}

function requireOnline(action) {
  if (!ONLINE_BACKEND_READY) {
    showToast("لتفعيل الأونلاين على GitHub Pages، ضع رابط الخادم داخل public/config.js.");
    return;
  }
  if (!app.user || !app.token) return showAuth("login", action);
  if (!app.socket?.connected) {
    connectSocket();
    showToast("جارٍ الاتصال بالخادم، حاول بعد لحظة.");
    return;
  }
  action();
}

function showQuickWaiting() {
  app.waitingKind = "quick";
  ui.waitingTitle.textContent = "جارٍ البحث عن لاعب...";
  ui.waitingText.textContent = "سينضم أول لاعب متاح إلى المباراة تلقائيًا.";
  ui.roomCodeBox.classList.add("hidden");
  openModal(ui.waitingModal);
  app.socket.emit("queue:join", (response) => {
    if (!response?.ok) {
      closeModal(ui.waitingModal);
      showToast(response?.error || "تعذر الانضمام إلى قائمة الانتظار.");
    }
  });
}

function createPrivateRoom() {
  app.waitingKind = "private";
  ui.waitingTitle.textContent = "جارٍ إنشاء الغرفة...";
  ui.waitingText.textContent = "سيظهر رمز الدعوة خلال لحظة.";
  ui.roomCodeBox.classList.add("hidden");
  openModal(ui.waitingModal);
  app.socket.emit("room:create", (response) => {
    if (!response?.ok) {
      closeModal(ui.waitingModal);
      showToast(response?.error || "تعذر إنشاء الغرفة.");
    }
  });
}

function showPrivateWaiting(code) {
  app.waitingKind = "private";
  ui.waitingTitle.textContent = "الغرفة جاهزة";
  ui.waitingText.textContent = "أرسل الرمز إلى صديقك ليكتبه من جهازه.";
  ui.roomCodeValue.textContent = code;
  ui.roomCodeBox.classList.remove("hidden");
  openModal(ui.waitingModal);
}

function joinPrivateRoom() {
  const code = ui.roomCodeInput.value.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) return showToast("أدخل رمز غرفة صحيحًا من ستة أحرف.");
  app.waitingKind = "joining";
  ui.waitingTitle.textContent = "جارٍ دخول الغرفة...";
  ui.waitingText.textContent = `التحقق من الرمز ${code}`;
  ui.roomCodeBox.classList.add("hidden");
  openModal(ui.waitingModal);
  app.socket.emit("room:join", { code }, (response) => {
    if (!response?.ok) {
      closeModal(ui.waitingModal);
      showToast(response?.error || "تعذر دخول الغرفة.");
    }
  });
}

function cancelWaiting() {
  if (!app.socket) return closeModal(ui.waitingModal);
  if (app.waitingKind === "quick") app.socket.emit("queue:leave");
  else app.socket.emit("room:cancel");
  app.waitingKind = null;
  closeModal(ui.waitingModal);
}

function startAiGame() {
  app.sounds.unlock();
  app.mode = "ai";
  app.onlineState = null;
  app.onlineSide = "left";
  app.localGame = new LocalGame({
    difficulty: ui.aiDifficulty.value,
    playerName: app.user?.displayName || "اللاعب",
    sounds: app.sounds,
    onFinish: (result) => showResult({ ...result, online: false })
  });
  enterGameView();
  ui.matchModeLabel.textContent = `ضد الذكاء الاصطناعي · ${AI_LEVELS[ui.aiDifficulty.value].label}`;
  ui.typeMetric.textContent = "محلية";
  ui.latencyMetric.textContent = "لا يلزم إنترنت";
}

function startOnlineMatch({ side, opponent, source }) {
  closeModal(ui.waitingModal);
  app.sounds.unlock();
  app.mode = "online";
  app.localGame = null;
  app.onlineState = null;
  app.onlineSide = side;
  app.opponent = opponent;
  app.waitingKind = null;
  enterGameView();
  ui.matchModeLabel.textContent = source === "private" ? "غرفة خاصة" : "مباراة سريعة";
  ui.typeMetric.textContent = "أونلاين";
  ui.latencyMetric.textContent = "متصل";
  showToast(`تم العثور على الخصم: ${opponent.displayName}`);
}

function enterGameView() {
  ui.homeView.classList.add("hidden");
  ui.gameView.classList.remove("hidden");
  closeModal(ui.resultModal);
  closeModal(ui.confirmModal);
  app.input.up = false;
  app.input.down = false;
  app.input.pointerTarget = null;
  app.input.lastSent = null;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function returnHome() {
  app.mode = "home";
  app.localGame = null;
  app.onlineState = null;
  app.onlineSide = null;
  app.opponent = null;
  app.input.lastSent = null;
  ui.gameView.classList.add("hidden");
  ui.homeView.classList.remove("hidden");
  closeModal(ui.resultModal);
  closeModal(ui.confirmModal);
  refreshProfile();
}

function finishOnlineGame(result) {
  if (app.mode !== "online") return;
  const won = result.winnerId === app.user?.id;
  showResult({
    online: true,
    won,
    winnerName: result.winnerName,
    leftScore: result.leftScore,
    rightScore: result.rightScore,
    level: result.level,
    destroyedBricks: result.destroyedBricks,
    reason: result.reason
  });
  refreshProfile();
}

function showResult(result) {
  app.input.up = false;
  app.input.down = false;
  updateInputDirection(true);
  ui.resultIcon.textContent = result.won ? "🏆" : "🎯";
  ui.resultTitle.textContent = result.won ? "فوز مستحق!" : "انتهت المباراة";
  if (result.reason === "disconnect") {
    ui.resultText.textContent = result.won ? "انسحب الخصم أو انقطع اتصاله." : "انقطع الاتصال واحتُسبت المباراة.";
  } else {
    ui.resultText.textContent = result.won ? `أحسنت، فزت على ${app.opponent?.displayName || "الخصم"}.` : `الفائز: ${result.winnerName}`;
  }
  ui.resultLeftScore.textContent = result.leftScore;
  ui.resultRightScore.textContent = result.rightScore;
  ui.resultLevel.textContent = result.level;
  ui.resultBricks.textContent = result.destroyedBricks;
  openModal(ui.resultModal);
}

async function refreshProfile() {
  if (!app.token) return;
  try {
    const data = await api("/api/me");
    app.user = data.user;
    updateAccountUI();
  } catch (_) { /* Session may have expired. */ }
}

function currentState() {
  if (app.mode === "ai") return app.localGame?.snapshot() || null;
  if (app.mode === "online") return app.onlineState;
  return null;
}

function updateGameUI(state) {
  if (!state) return;
  const leftName = state.left?.user?.displayName || "اللاعب 1";
  const rightName = state.right?.user?.displayName || "اللاعب 2";
  ui.leftPlayerName.textContent = leftName;
  ui.rightPlayerName.textContent = rightName;
  ui.leftScore.textContent = state.left?.score ?? 0;
  ui.rightScore.textContent = state.right?.score ?? 0;
  ui.levelMetric.textContent = state.level ?? 1;
  ui.bricksMetric.textContent = state.bricksRemaining ?? 0;
  ui.leftPlayerStatus.textContent = app.mode === "online" && app.onlineSide === "left" ? "أنت" : "جاهز";
  ui.rightPlayerStatus.textContent = app.mode === "online" && app.onlineSide === "right" ? "أنت" : (app.mode === "ai" ? "ذكاء اصطناعي" : "جاهز");

  if (state.status === "countdown") {
    const now = state.localClock ? performance.now() : Date.now();
    const remaining = Math.max(0, (state.serveAt - now) / 1000);
    ui.countdown.textContent = remaining > 0 ? Math.ceil(remaining) : "ابدأ";
    ui.countdown.classList.remove("hidden");
    ui.liveStatus.innerHTML = '<i class="dot online"></i> استعداد للجولة';
  } else {
    ui.countdown.classList.add("hidden");
    ui.liveStatus.innerHTML = '<i class="dot online"></i> المباراة نشطة';
  }

  if (app.mode === "online") {
    const snapshotAge = performance.now() - app.lastSnapshotAt;
    ui.latencyMetric.textContent = snapshotAge < 160 ? "مستقر" : snapshotAge < 500 ? "متذبذب" : "ضعيف";
  }
}

function getInputDirection() {
  if (app.input.up && !app.input.down) return -1;
  if (app.input.down && !app.input.up) return 1;
  if (app.input.pointerTarget !== null) {
    const state = currentState();
    if (!state) return 0;
    const own = app.mode === "online" && app.onlineSide === "right" ? state.right : state.left;
    const center = own.y + state.paddle.height / 2;
    if (Math.abs(app.input.pointerTarget - center) < 14) return 0;
    return app.input.pointerTarget < center ? -1 : 1;
  }
  return 0;
}

function updateInputDirection(force = false) {
  const direction = getInputDirection();
  if (!force && direction === app.input.lastSent) return;
  app.input.lastSent = direction;
  if (app.mode === "ai") app.localGame?.setInput(direction);
  if (app.mode === "online" && app.socket?.connected) app.socket.emit("game:input", { direction });
}

function bindHoldButton(button, key) {
  const start = (event) => {
    event.preventDefault();
    app.input[key] = true;
    app.input.pointerTarget = null;
    app.sounds.unlock();
    updateInputDirection(true);
  };
  const end = (event) => {
    event.preventDefault();
    app.input[key] = false;
    updateInputDirection(true);
  };
  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", end);
  button.addEventListener("pointercancel", end);
  button.addEventListener("pointerleave", (event) => { if (event.buttons === 0) end(event); });
}

function setPointerTarget(event) {
  if (!["ai", "online"].includes(app.mode)) return;
  const rect = ui.canvas.getBoundingClientRect();
  app.input.pointerTarget = clamp((event.clientY - rect.top) * WORLD.height / rect.height, 0, WORLD.height);
  updateInputDirection(true);
}

function leaveCurrentGame() {
  closeModal(ui.confirmModal);
  if (app.mode === "online") app.socket?.emit("game:leave");
  returnHome();
}

function toggleFullscreen() {
  const target = app.mode === "home" ? document.documentElement : ui.canvasWrap;
  if (!document.fullscreenElement) target.requestFullscreen?.().catch(() => showToast("ملء الشاشة غير مدعوم في هذا المتصفح."));
  else document.exitFullscreen?.();
}

function animationLoop(now) {
  const dt = clamp((now - app.lastFrame) / 1000, 0, .034);
  app.lastFrame = now;
  if (app.mode === "ai" && app.localGame) app.localGame.update(dt, now);
  if (["ai", "online"].includes(app.mode)) {
    updateInputDirection();
    const state = currentState();
    app.renderer.render(state);
    updateGameUI(state);
  }
  requestAnimationFrame(animationLoop);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register(new URL("./sw.js", document.baseURI)).catch(() => {}));
  }
}

function bindEvents() {
  ui.playAiBtn.addEventListener("click", startAiGame);
  ui.quickMatchBtn.addEventListener("click", () => requireOnline(showQuickWaiting));
  ui.createRoomBtn.addEventListener("click", () => requireOnline(createPrivateRoom));
  ui.joinRoomBtn.addEventListener("click", () => requireOnline(joinPrivateRoom));
  ui.roomCodeInput.addEventListener("input", () => { ui.roomCodeInput.value = ui.roomCodeInput.value.toUpperCase().replace(/[^A-Z2-9]/g, ""); });
  ui.roomCodeInput.addEventListener("keydown", (event) => { if (event.key === "Enter") ui.joinRoomBtn.click(); });
  ui.profileLoginBtn.addEventListener("click", () => {
    if (!ONLINE_BACKEND_READY) return showToast("اضبط serverUrl داخل public/config.js لتفعيل الحسابات.");
    showAuth("login");
  });
  ui.accountBtn.addEventListener("click", () => {
    if (!ONLINE_BACKEND_READY && !app.user) return showToast("الحسابات تحتاج خادم Node.js منشورًا.");
    if (!app.user) showAuth("login");
    else if (window.confirm(`تسجيل الخروج من حساب ${app.user.displayName}؟`)) logout();
  });

  ui.loginTab.addEventListener("click", () => setAuthMode("login"));
  ui.registerTab.addEventListener("click", () => setAuthMode("register"));
  ui.authForm.addEventListener("submit", submitAuth);
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeModal(document.getElementById(button.dataset.close))));

  ui.cancelWaitingBtn.addEventListener("click", cancelWaiting);
  ui.copyCodeBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ui.roomCodeValue.textContent);
      showToast("تم نسخ رمز الغرفة.");
    } catch (_) {
      showToast(`رمز الغرفة: ${ui.roomCodeValue.textContent}`);
    }
  });

  ui.leaveGameBtn.addEventListener("click", () => openModal(ui.confirmModal));
  ui.confirmLeaveBtn.addEventListener("click", leaveCurrentGame);
  ui.resultHomeBtn.addEventListener("click", returnHome);
  ui.fullscreenBtn.addEventListener("click", toggleFullscreen);
  ui.gameFullscreenBtn.addEventListener("click", toggleFullscreen);
  ui.soundBtn.addEventListener("click", () => {
    app.sounds.unlock();
    const enabled = app.sounds.toggle();
    ui.soundBtn.textContent = enabled ? "🔊" : "🔇";
    showToast(enabled ? "تم تشغيل المؤثرات الصوتية." : "تم إيقاف المؤثرات الصوتية.");
  });

  window.addEventListener("keydown", (event) => {
    if (["ArrowUp", "ArrowDown", "w", "W", "s", "S"].includes(event.key)) event.preventDefault();
    if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") app.input.up = true;
    if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") app.input.down = true;
    if (event.key === "Escape" && ["ai", "online"].includes(app.mode)) openModal(ui.confirmModal);
    app.input.pointerTarget = null;
    updateInputDirection(true);
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") app.input.up = false;
    if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") app.input.down = false;
    updateInputDirection(true);
  });
  window.addEventListener("blur", () => {
    app.input.up = false;
    app.input.down = false;
    app.input.pointerTarget = null;
    updateInputDirection(true);
  });

  bindHoldButton(ui.upBtn, "up");
  bindHoldButton(ui.downBtn, "down");
  ui.canvas.addEventListener("pointerdown", (event) => {
    ui.canvas.setPointerCapture?.(event.pointerId);
    app.input.pointer = true;
    setPointerTarget(event);
    app.sounds.unlock();
  });
  ui.canvas.addEventListener("pointermove", (event) => {
    if (app.input.pointer || event.pointerType === "mouse") setPointerTarget(event);
  });
  ui.canvas.addEventListener("pointerup", (event) => {
    app.input.pointer = false;
    if (event.pointerType !== "mouse") app.input.pointerTarget = null;
    ui.canvas.releasePointerCapture?.(event.pointerId);
    updateInputDirection(true);
  });
  ui.canvas.addEventListener("pointercancel", () => {
    app.input.pointer = false;
    app.input.pointerTarget = null;
    updateInputDirection(true);
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    app.deferredInstallPrompt = event;
    ui.installBtn.classList.remove("hidden");
  });
  ui.installBtn.addEventListener("click", async () => {
    if (!app.deferredInstallPrompt) return;
    app.deferredInstallPrompt.prompt();
    await app.deferredInstallPrompt.userChoice;
    app.deferredInstallPrompt = null;
    ui.installBtn.classList.add("hidden");
  });
}

async function init() {
  app.renderer = new CanvasRenderer(ui.canvas);
  bindEvents();
  updateAccountUI();
  registerServiceWorker();
  if (!ONLINE_BACKEND_READY) setConnection("offline", "GitHub Pages · لعب محلي");
  await restoreSession();
  requestAnimationFrame(animationLoop);
}

init();
