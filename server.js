"use strict";

const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const crypto = require("node:crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "development-secret-change-before-production";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const USERS_FILE = path.join(__dirname, "data", "users.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const WORLD = Object.freeze({ width: 960, height: 540 });
const TICK_RATE = 60;
const SNAPSHOT_RATE = 30;
const TARGET_SCORE = 7;

function ensureUsersFile() {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "{}\n", "utf8");
}

function readUsers() {
  ensureUsersFile();
  try {
    const value = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch (error) {
    console.error("Could not read users file:", error);
    return {};
  }
}

function writeUsers(users) {
  ensureUsersFile();
  const temporary = `${USERS_FILE}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(users, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, USERS_FILE);
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    wins: user.wins || 0,
    losses: user.losses || 0,
    games: user.games || 0,
    createdAt: user.createdAt
  };
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function findUserById(id) {
  const users = readUsers();
  return Object.values(users).find((user) => user.id === id) || null;
}

function updateMatchStats(winnerId, loserId) {
  const users = readUsers();
  const winner = Object.values(users).find((user) => user.id === winnerId);
  const loser = Object.values(users).find((user) => user.id === loserId);
  if (winner) {
    winner.wins = (winner.wins || 0) + 1;
    winner.games = (winner.games || 0) + 1;
  }
  if (loser) {
    loser.losses = (loser.losses || 0) + 1;
    loser.games = (loser.games || 0) + 1;
  }
  writeUsers(users);
}

function validateCredentials(username, password, displayName = "") {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return "اسم المستخدم يجب أن يكون من 3 إلى 20 حرفًا إنجليزيًا أو رقمًا أو شرطة سفلية.";
  }
  if (String(password || "").length < 6 || String(password || "").length > 72) {
    return "كلمة المرور يجب أن تكون من 6 إلى 72 حرفًا.";
  }
  if (displayName && (displayName.length < 2 || displayName.length > 24)) {
    return "الاسم الظاهر يجب أن يكون من حرفين إلى 24 حرفًا.";
  }
  return null;
}

const app = express();
app.disable("x-powered-by");

const allowedOrigins = ALLOWED_ORIGIN === "*"
  ? []
  : ALLOWED_ORIGIN.split(",").map((item) => item.trim()).filter(Boolean);

app.use((request, response, next) => {
  const requestOrigin = request.headers.origin;
  const originAllowed = ALLOWED_ORIGIN === "*" || !requestOrigin || allowedOrigins.includes(requestOrigin);
  if (requestOrigin && originAllowed) {
    response.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN === "*" ? "*" : requestOrigin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (request.method === "OPTIONS") {
    return originAllowed ? response.sendStatus(204) : response.status(403).end();
  }
  return next();
});

app.use(express.json({ limit: "20kb" }));
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.post("/api/register", async (request, response) => {
  try {
    const username = normalizeUsername(request.body?.username);
    const password = String(request.body?.password || "");
    const displayName = String(request.body?.displayName || username).trim();
    const validationError = validateCredentials(username, password, displayName);
    if (validationError) return response.status(400).json({ error: validationError });

    const users = readUsers();
    if (users[username]) return response.status(409).json({ error: "اسم المستخدم مستخدم بالفعل." });

    const user = {
      id: crypto.randomUUID(),
      username,
      displayName,
      passwordHash: await bcrypt.hash(password, 10),
      wins: 0,
      losses: 0,
      games: 0,
      createdAt: new Date().toISOString()
    };
    users[username] = user;
    writeUsers(users);
    return response.status(201).json({ token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "تعذر إنشاء الحساب الآن." });
  }
});

app.post("/api/login", async (request, response) => {
  try {
    const username = normalizeUsername(request.body?.username);
    const password = String(request.body?.password || "");
    const users = readUsers();
    const user = users[username];
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return response.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
    }
    return response.json({ token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "تعذر تسجيل الدخول الآن." });
  }
});

app.get("/api/me", (request, response) => {
  try {
    const authHeader = request.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const payload = verifyToken(token);
    const user = findUserById(payload.sub);
    if (!user) return response.status(401).json({ error: "انتهت الجلسة." });
    return response.json({ user: publicUser(user) });
  } catch (_) {
    return response.status(401).json({ error: "جلسة غير صالحة." });
  }
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "Pong Network Arena", time: new Date().toISOString() });
});

app.use(express.static(PUBLIC_DIR, { extensions: ["html"], maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
app.get("/*splat", (_request, response) => response.sendFile(path.join(PUBLIC_DIR, "index.html")));

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN.split(",").map((item) => item.trim()),
    methods: ["GET", "POST"]
  },
  pingInterval: 10000,
  pingTimeout: 15000,
  maxHttpBufferSize: 100000
});

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("AUTH_REQUIRED"));
    const payload = verifyToken(token);
    const user = findUserById(payload.sub);
    if (!user) return next(new Error("AUTH_INVALID"));
    socket.user = publicUser(user);
    next();
  } catch (_) {
    next(new Error("AUTH_INVALID"));
  }
});

const onlineSockets = new Map();
const waitingPrivateRooms = new Map();
const quickQueue = [];
const games = new Map();
const socketToGame = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = "";
    for (let index = 0; index < 6; index += 1) code += alphabet[crypto.randomInt(0, alphabet.length)];
    if (!waitingPrivateRooms.has(code)) return code;
  }
  return crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
}

function removeFromQueue(socketId) {
  let index = quickQueue.indexOf(socketId);
  while (index !== -1) {
    quickQueue.splice(index, 1);
    index = quickQueue.indexOf(socketId);
  }
}

function removePrivateWaitingForSocket(socketId) {
  for (const [code, value] of waitingPrivateRooms.entries()) {
    if (value.socketId === socketId) waitingPrivateRooms.delete(code);
  }
}

function broadcastPresence() {
  io.emit("presence", {
    online: onlineSockets.size,
    searching: quickQueue.length,
    activeMatches: games.size
  });
}

function getSocket(socketId) {
  return io.sockets.sockets.get(socketId) || null;
}

function sanitizeInput(value) {
  const number = Number(value);
  if (number < 0) return -1;
  if (number > 0) return 1;
  return 0;
}

class OnlineGame {
  constructor(id, leftSocket, rightSocket, source = "quick") {
    this.id = id;
    this.source = source;
    this.left = {
      socketId: leftSocket.id,
      user: leftSocket.user,
      input: 0,
      x: 24,
      y: (WORLD.height - 112) / 2,
      score: 0
    };
    this.right = {
      socketId: rightSocket.id,
      user: rightSocket.user,
      input: 0,
      x: WORLD.width - 40,
      y: (WORLD.height - 112) / 2,
      score: 0
    };
    this.paddle = { width: 16, height: 112, speed: 470 };
    this.ball = { x: WORLD.width / 2, y: WORLD.height / 2, r: 9, vx: 0, vy: 0, speed: 350 };
    this.level = 1;
    this.bricks = [];
    this.bricksRemaining = 0;
    this.destroyedBricks = 0;
    this.status = "countdown";
    this.countdownUntil = Date.now() + 2400;
    this.serveAt = this.countdownUntil;
    this.lastTick = process.hrtime.bigint();
    this.lastSnapshot = 0;
    this.finished = false;
    this.buildBricks();
    this.interval = setInterval(() => this.tick(), 1000 / TICK_RATE);
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
    const colors = ["#33ddff", "#a58bff", "#54e5a5", "#ffcc66", "#ff6f86", "#6bb6ff"];
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

  serve(direction = Math.random() < 0.5 ? -1 : 1) {
    this.ball.x = WORLD.width / 2;
    this.ball.y = WORLD.height / 2 + (Math.random() - 0.5) * 100;
    this.ball.speed = Math.min(650, 350 + (this.level - 1) * 28);
    const angle = (Math.random() * 0.66 - 0.33);
    this.ball.vx = direction * this.ball.speed * Math.cos(angle);
    this.ball.vy = this.ball.speed * Math.sin(angle);
    this.status = "playing";
  }

  resetAfterPoint(direction) {
    this.status = "countdown";
    this.serveAt = Date.now() + 1100;
    this.ball.x = WORLD.width / 2;
    this.ball.y = WORLD.height / 2;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.nextDirection = direction;
  }

  tick() {
    if (this.finished) return;
    const nowNs = process.hrtime.bigint();
    const dt = clamp(Number(nowNs - this.lastTick) / 1e9, 0, 0.034);
    this.lastTick = nowNs;
    const now = Date.now();

    if (this.status === "countdown" && now >= this.serveAt) this.serve(this.nextDirection);
    if (this.status === "playing") this.update(dt);

    if (now - this.lastSnapshot >= 1000 / SNAPSHOT_RATE) {
      this.lastSnapshot = now;
      io.to(this.id).volatile.emit("game:state", this.snapshot());
    }
  }

  update(dt) {
    this.left.y = clamp(this.left.y + this.left.input * this.paddle.speed * dt, 0, WORLD.height - this.paddle.height);
    this.right.y = clamp(this.right.y + this.right.input * this.paddle.speed * dt, 0, WORLD.height - this.paddle.height);

    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;

    if (this.ball.y - this.ball.r <= 0) {
      this.ball.y = this.ball.r;
      this.ball.vy = Math.abs(this.ball.vy);
    } else if (this.ball.y + this.ball.r >= WORLD.height) {
      this.ball.y = WORLD.height - this.ball.r;
      this.ball.vy = -Math.abs(this.ball.vy);
    }

    this.collidePaddle(this.left, true);
    this.collidePaddle(this.right, false);
    this.collideBricks();

    if (this.ball.x + this.ball.r < 0) {
      this.right.score += 1;
      if (this.right.score >= TARGET_SCORE) return this.finish(this.right, this.left, "score");
      this.resetAfterPoint(-1);
    } else if (this.ball.x - this.ball.r > WORLD.width) {
      this.left.score += 1;
      if (this.left.score >= TARGET_SCORE) return this.finish(this.left, this.right, "score");
      this.resetAfterPoint(1);
    }
  }

  collidePaddle(player, isLeft) {
    if ((isLeft && this.ball.vx >= 0) || (!isLeft && this.ball.vx <= 0)) return;
    const left = player.x;
    const right = player.x + this.paddle.width;
    const top = player.y;
    const bottom = player.y + this.paddle.height;
    if (
      this.ball.x + this.ball.r >= left &&
      this.ball.x - this.ball.r <= right &&
      this.ball.y + this.ball.r >= top &&
      this.ball.y - this.ball.r <= bottom
    ) {
      const normalized = clamp((this.ball.y - (player.y + this.paddle.height / 2)) / (this.paddle.height / 2), -1, 1);
      const angle = normalized * (Math.PI / 3);
      this.ball.speed = Math.min(700, this.ball.speed + 15);
      this.ball.vx = (isLeft ? 1 : -1) * this.ball.speed * Math.cos(angle);
      this.ball.vy = this.ball.speed * Math.sin(angle);
      this.ball.x = isLeft ? right + this.ball.r + 1 : left - this.ball.r - 1;
    }
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

      if (this.bricksRemaining <= 0) {
        this.level += 1;
        this.buildBricks();
        this.status = "countdown";
        this.serveAt = Date.now() + 1300;
        this.nextDirection = Math.random() < 0.5 ? -1 : 1;
        this.ball.x = WORLD.width / 2;
        this.ball.y = WORLD.height / 2;
        this.ball.vx = 0;
        this.ball.vy = 0;
        io.to(this.id).emit("game:level", { level: this.level });
      }
      break;
    }
  }

  setInput(socketId, direction) {
    if (socketId === this.left.socketId) this.left.input = sanitizeInput(direction);
    if (socketId === this.right.socketId) this.right.input = sanitizeInput(direction);
  }

  snapshot() {
    return {
      id: this.id,
      serverTime: Date.now(),
      status: this.status,
      serveAt: this.serveAt,
      level: this.level,
      targetScore: TARGET_SCORE,
      bricksRemaining: this.bricksRemaining,
      destroyedBricks: this.destroyedBricks,
      paddle: this.paddle,
      ball: this.ball,
      left: { x: this.left.x, y: this.left.y, score: this.left.score, user: this.left.user },
      right: { x: this.right.x, y: this.right.y, score: this.right.score, user: this.right.user },
      bricks: this.bricks.filter((brick) => brick.alive)
    };
  }

  finish(winner, loser, reason) {
    if (this.finished) return;
    this.finished = true;
    clearInterval(this.interval);
    updateMatchStats(winner.user.id, loser.user.id);
    io.to(this.id).emit("game:over", {
      reason,
      winnerId: winner.user.id,
      winnerName: winner.user.displayName,
      leftScore: this.left.score,
      rightScore: this.right.score,
      level: this.level,
      destroyedBricks: this.destroyedBricks
    });
    this.cleanup(2500);
  }

  forfeit(disconnectedSocketId) {
    if (this.finished) return;
    const loser = disconnectedSocketId === this.left.socketId ? this.left : this.right;
    const winner = disconnectedSocketId === this.left.socketId ? this.right : this.left;
    this.finish(winner, loser, "disconnect");
  }

  cleanup(delay = 0) {
    setTimeout(() => {
      socketToGame.delete(this.left.socketId);
      socketToGame.delete(this.right.socketId);
      games.delete(this.id);
      for (const socketId of [this.left.socketId, this.right.socketId]) {
        const socket = getSocket(socketId);
        if (socket) socket.leave(this.id);
      }
      broadcastPresence();
    }, delay);
  }
}

function startOnlineGame(leftSocket, rightSocket, source = "quick") {
  if (!leftSocket || !rightSocket || leftSocket.id === rightSocket.id) return null;
  removeFromQueue(leftSocket.id);
  removeFromQueue(rightSocket.id);
  removePrivateWaitingForSocket(leftSocket.id);
  removePrivateWaitingForSocket(rightSocket.id);

  const gameId = `game:${crypto.randomUUID()}`;
  leftSocket.join(gameId);
  rightSocket.join(gameId);
  socketToGame.set(leftSocket.id, gameId);
  socketToGame.set(rightSocket.id, gameId);
  const game = new OnlineGame(gameId, leftSocket, rightSocket, source);
  games.set(gameId, game);

  leftSocket.emit("match:found", { gameId, side: "left", opponent: rightSocket.user, source });
  rightSocket.emit("match:found", { gameId, side: "right", opponent: leftSocket.user, source });
  setTimeout(() => io.to(gameId).emit("game:state", game.snapshot()), 80);
  broadcastPresence();
  return game;
}

io.on("connection", (socket) => {
  onlineSockets.set(socket.id, socket.user);
  socket.emit("session", { user: socket.user });
  broadcastPresence();

  socket.on("queue:join", (ack = () => {}) => {
    if (socketToGame.has(socket.id)) return ack({ ok: false, error: "أنت داخل مباراة بالفعل." });
    removePrivateWaitingForSocket(socket.id);
    removeFromQueue(socket.id);

    let opponentSocket = null;
    while (quickQueue.length && !opponentSocket) {
      const candidateId = quickQueue.shift();
      const candidate = getSocket(candidateId);
      if (candidate && candidate.connected && !socketToGame.has(candidateId) && candidate.user.id !== socket.user.id) {
        opponentSocket = candidate;
      }
    }

    if (opponentSocket) {
      startOnlineGame(opponentSocket, socket, "quick");
      ack({ ok: true, matched: true });
    } else {
      quickQueue.push(socket.id);
      socket.emit("queue:waiting", { position: quickQueue.length });
      ack({ ok: true, matched: false });
      broadcastPresence();
    }
  });

  socket.on("queue:leave", (ack = () => {}) => {
    removeFromQueue(socket.id);
    ack({ ok: true });
    broadcastPresence();
  });

  socket.on("room:create", (ack = () => {}) => {
    if (socketToGame.has(socket.id)) return ack({ ok: false, error: "أنت داخل مباراة بالفعل." });
    removeFromQueue(socket.id);
    removePrivateWaitingForSocket(socket.id);
    const code = generateRoomCode();
    waitingPrivateRooms.set(code, { socketId: socket.id, createdAt: Date.now(), user: socket.user });
    socket.emit("room:waiting", { code });
    ack({ ok: true, code });
    broadcastPresence();
  });

  socket.on("room:join", (payload, ack = () => {}) => {
    const code = String(payload?.code || "").trim().toUpperCase();
    const waiting = waitingPrivateRooms.get(code);
    if (!waiting) return ack({ ok: false, error: "رمز الغرفة غير صحيح أو انتهت صلاحيته." });
    if (waiting.socketId === socket.id) return ack({ ok: false, error: "أرسل الرمز إلى صديقك ليدخل من جهاز آخر." });
    const hostSocket = getSocket(waiting.socketId);
    if (!hostSocket || !hostSocket.connected || socketToGame.has(hostSocket.id)) {
      waitingPrivateRooms.delete(code);
      return ack({ ok: false, error: "صاحب الغرفة لم يعد متصلًا." });
    }
    if (hostSocket.user.id === socket.user.id) return ack({ ok: false, error: "استخدم حسابًا مختلفًا على الجهاز الآخر." });
    waitingPrivateRooms.delete(code);
    startOnlineGame(hostSocket, socket, "private");
    ack({ ok: true });
  });

  socket.on("room:cancel", (ack = () => {}) => {
    removePrivateWaitingForSocket(socket.id);
    ack({ ok: true });
    broadcastPresence();
  });

  socket.on("game:input", (payload) => {
    const gameId = socketToGame.get(socket.id);
    const game = gameId ? games.get(gameId) : null;
    if (game) game.setInput(socket.id, payload?.direction);
  });

  socket.on("game:leave", (ack = () => {}) => {
    const gameId = socketToGame.get(socket.id);
    const game = gameId ? games.get(gameId) : null;
    if (game) game.forfeit(socket.id);
    ack({ ok: true });
  });

  socket.on("disconnect", () => {
    onlineSockets.delete(socket.id);
    removeFromQueue(socket.id);
    removePrivateWaitingForSocket(socket.id);
    const gameId = socketToGame.get(socket.id);
    const game = gameId ? games.get(gameId) : null;
    if (game) game.forfeit(socket.id);
    broadcastPresence();
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, waiting] of waitingPrivateRooms.entries()) {
    if (now - waiting.createdAt > 15 * 60 * 1000 || !getSocket(waiting.socketId)) {
      waitingPrivateRooms.delete(code);
    }
  }
}, 60 * 1000).unref();

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Pong Network Arena running on http://localhost:${PORT}`);
  if (JWT_SECRET.startsWith("development-secret")) {
    console.warn("WARNING: Set JWT_SECRET before production deployment.");
  }
});
