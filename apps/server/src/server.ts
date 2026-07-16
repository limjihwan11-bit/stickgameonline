import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server, type Socket } from "socket.io";
import bcrypt from "bcryptjs";
import {
  applyAction, boardSignature, createGame, gameActionSchema, isEliminated, normalizeRuleSet, roomSettingsSchema,
  type ClientToServerEvents, type GameState, type RatingChange, type RoomSettings, type RoomState, type ServerToClientEvents
} from "@stickgame/shared";
import { createAuthStore, type AuthStore, type StoredUser } from "./authStore.js";

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, { playerId?: string; nickname?: string; userId?: string }>;
interface Session { nickname: string; socketId?: string; userId?: string; roomCode?: string; gameId?: string; disconnectTimer?: NodeJS.Timeout }
interface GameMeta { ranked: boolean; recorded: boolean; userIds: Record<string, string> }
interface ServerOptions { authStore?: AuthStore }

const AUTH_COOKIE = "stick_auth";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const parseCookies = (header = "") => Object.fromEntries(header.split(";").map((part) => {
  const [key, ...rest] = part.trim().split("=");
  return key ? [key, decodeURIComponent(rest.join("="))] : ["", ""];
}).filter(([key]) => key));

const cleanUsername = (value: unknown) => String(value || "").trim().slice(0, 20);
const cleanNickname = (value: unknown) => String(value || "").trim().slice(0, 12);
const validUsername = (value: string) => /^[a-zA-Z0-9_-]{3,20}$/.test(value);
const validPassword = (value: unknown) => typeof value === "string" && value.length >= 4 && value.length <= 80;

export function createStickServer(options: ServerOptions = {}) {
  const app = express();
  app.use(cors()); app.use(express.json());
  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: { origin: true, credentials: true } });
  const authStore = options.authStore ?? createAuthStore();
  const sessions = new Map<string, Session>();
  const rooms = new Map<string, RoomState>();
  const games = new Map<string, GameState>();
  const gameMeta = new Map<string, GameMeta>();
  const queues = new Map<string, string[]>();
  const usedActions = new Map<string, Set<string>>();

  const queueKey = (settings: RoomSettings, ranked: boolean) => `${ranked ? "ranked" : "guest"}:${settings.playerCount}:${normalizeRuleSet(settings.rules ?? settings.rule).join("+")}`;
  const getSocket = (playerId: string) => { const sid = sessions.get(playerId)?.socketId; return sid ? io.sockets.sockets.get(sid) as GameSocket | undefined : undefined; };
  const emitRoom = (room: RoomState) => room.players.forEach((p) => getSocket(p.id)?.emit("room:state", room));
  const emitGame = (game: GameState) => io.to(`game:${game.id}`).emit("game:state", game);
  const cookieOptions = () => ({ httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: SESSION_MS, path: "/" });
  const setAuthCookie = (res: express.Response, token: string) => res.cookie(AUTH_COOKIE, token, cookieOptions());
  const clearAuthCookie = (res: express.Response) => res.clearCookie(AUTH_COOKIE, { path: "/" });
  const userFromCookie = async (header?: string): Promise<StoredUser | undefined> => {
    const token = parseCookies(header)[AUTH_COOKIE];
    return token ? authStore.findSessionUser(token) : undefined;
  };
  const publicUser = async (userId: string) => authStore.getPublicUser(userId);

  app.post("/api/auth/register", async (req, res) => {
    const username = cleanUsername(req.body?.username);
    const nickname = cleanNickname(req.body?.nickname || username);
    if (!validUsername(username)) return res.status(400).json({ error: "아이디는 영문, 숫자, _, - 조합 3~20자로 입력해 주세요." });
    if (!nickname) return res.status(400).json({ error: "닉네임을 입력해 주세요." });
    if (!validPassword(req.body?.password)) return res.status(400).json({ error: "비밀번호는 4자 이상이어야 합니다." });
    try {
      const passwordHash = await bcrypt.hash(String(req.body.password), 10);
      const user = await authStore.createUser(username, nickname, passwordHash);
      const token = randomUUID() + randomUUID();
      await authStore.createSession(user.id, token, new Date(Date.now() + SESSION_MS));
      setAuthCookie(res, token);
      res.status(201).json({ user: await publicUser(user.id) });
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "회원가입에 실패했습니다." });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const username = cleanUsername(req.body?.username);
    const user = await authStore.findUserByUsername(username);
    if (!user || !await bcrypt.compare(String(req.body?.password || ""), user.passwordHash)) return res.status(401).json({ error: "아이디 또는 비밀번호가 맞지 않습니다." });
    const token = randomUUID() + randomUUID();
    await authStore.createSession(user.id, token, new Date(Date.now() + SESSION_MS));
    setAuthCookie(res, token);
    res.json({ user: await publicUser(user.id) });
  });

  app.post("/api/auth/logout", async (req, res) => {
    const token = parseCookies(req.headers.cookie)[AUTH_COOKIE];
    if (token) await authStore.deleteSession(token);
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", async (req, res) => {
    const user = await userFromCookie(req.headers.cookie);
    res.json({ user: user ? await publicUser(user.id) : null });
  });

  app.get("/api/me/stats", async (req, res) => {
    const user = await userFromCookie(req.headers.cookie);
    if (!user) return res.status(401).json({ error: "로그인이 필요합니다." });
    res.json({ user: await publicUser(user.id) });
  });

  app.get("/api/leaderboard", async (_req, res) => {
    res.json({ entries: await authStore.getLeaderboard(50) });
  });

  function removeFromQueues(playerId: string) {
    for (const [key, list] of queues) {
      const filtered = list.filter((id) => id !== playerId);
      queues.set(key, filtered);
      if (filtered.length !== list.length) filtered.forEach((id) => getSocket(id)?.emit("queue:state", { waiting: true, count: filtered.length }));
    }
  }

  function leaveRoom(playerId: string): boolean {
    const session = sessions.get(playerId);
    const code = session?.roomCode;
    if (!session || !code) return false;
    session.roomCode = undefined;
    getSocket(playerId)?.leave(`room:${code}`);

    const room = rooms.get(code);
    if (!room) return false;
    const index = room.players.findIndex((player) => player.id === playerId);
    if (index < 0) return false;
    room.players.splice(index, 1);
    if (!room.players.length) {
      rooms.delete(code);
      return true;
    }

    if (room.hostId === playerId) room.hostId = room.players[0].id;
    room.players.forEach((player) => { player.ready = false; });
    emitRoom(room);
    return true;
  }

  async function attachRankedResult(game: GameState) {
    if (game.status !== "finished" || !game.winnerId) return game;
    const meta = gameMeta.get(game.id);
    if (!meta?.ranked || meta.recorded) return game;
    const winnerUserId = meta.userIds[game.winnerId];
    const playerUserIds = game.players.map((player) => meta.userIds[player.id]).filter(Boolean);
    if (!winnerUserId || playerUserIds.length !== game.players.length) return game;
    const changes = await authStore.recordRankedMatch({ gameId: game.id, winnerUserId, playerUserIds, rules: normalizeRuleSet(game.rules ?? game.rule) });
    meta.recorded = true;
    if (!changes) return game;
    const ratingChanges: Record<string, RatingChange> = {};
    for (const [playerId, userId] of Object.entries(meta.userIds)) if (changes[userId]) ratingChanges[playerId] = changes[userId];
    game.ratingChanges = ratingChanges;
    return game;
  }

  function startGame(playerIds: string[], settings: RoomSettings, ranked = false): GameState {
    const id = randomUUID();
    const game = createGame(id, settings.rules ?? settings.rule, playerIds.map((pid) => ({ id: pid, nickname: sessions.get(pid)?.nickname || "플레이어" })));
    game.ranked = ranked;
    games.set(id, game); usedActions.set(id, new Set());
    gameMeta.set(id, { ranked, recorded: false, userIds: Object.fromEntries(playerIds.map((pid) => [pid, sessions.get(pid)?.userId]).filter((entry): entry is [string, string] => Boolean(entry[1]))) });
    playerIds.forEach((pid) => {
      const session = sessions.get(pid)!; session.gameId = id; session.roomCode = undefined;
      const socket = getSocket(pid); socket?.join(`game:${id}`); socket?.emit("match:found", { gameId: id });
    });
    setTimeout(() => emitGame(game), 20);
    return game;
  }

  async function settleDisconnected(gameId: string, playerId: string) {
    const game = games.get(gameId);
    if (!game || game.status !== "playing") return;
    const player = game.players.find((p) => p.id === playerId);
    if (!player || player.connected) return;
    player.hands = [0, 0];
    const alive = game.players.filter((p) => !isEliminated(p.hands));
    if (alive.length === 1) { game.status = "finished"; game.winnerId = alive[0].id; }
    else if (game.players[game.turnIndex].id === playerId) {
      for (let i = 1; i <= game.players.length; i++) {
        const index = (game.turnIndex + i) % game.players.length;
        if (!isEliminated(game.players[index].hands)) { game.turnIndex = index; break; }
      }
      game.turnStartedAt = Date.now();
    }
    game.boardHistory.push(boardSignature(game)); await attachRankedResult(game); emitGame(game);
  }

  io.on("connection", (socket: GameSocket) => {
    socket.on("session:hello", async ({ playerId, nickname }, ack) => {
      const cleanName = nickname.trim().slice(0, 12);
      if (!playerId || !cleanName) return ack({ ok: false, error: "닉네임을 입력해 주세요." });
      const authUser = await userFromCookie(socket.handshake.headers.cookie);
      socket.data.playerId = playerId; socket.data.userId = authUser?.id; socket.data.nickname = authUser?.nickname ?? cleanName;
      const session = sessions.get(playerId) || { nickname: cleanName };
      if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
      session.nickname = socket.data.nickname; session.userId = authUser?.id; session.socketId = socket.id; sessions.set(playerId, session);
      if (session.roomCode) { const room = rooms.get(session.roomCode); if (room) { const p = room.players.find((x) => x.id === playerId); if (p) p.connected = true; emitRoom(room); } }
      if (session.gameId) { const game = games.get(session.gameId); if (game) { const p = game.players.find((x) => x.id === playerId); if (p) p.connected = true; socket.join(`game:${game.id}`); socket.emit("game:state", game); io.to(`game:${game.id}`).emit("player:connection", { playerId, connected: true }); } }
      ack({ ok: true });
    });

    socket.on("queue:join", ({ settings }, ack) => {
      const playerId = socket.data.playerId;
      const parsed = roomSettingsSchema.safeParse(settings);
      if (!playerId || !parsed.success) return ack({ ok: false, error: "올바르지 않은 매칭 설정입니다." });
      leaveRoom(playerId);
      removeFromQueues(playerId);
      const ranked = Boolean(sessions.get(playerId)?.userId);
      const key = queueKey(parsed.data, ranked); const list = queues.get(key) || [];
      if (!list.includes(playerId)) list.push(playerId); queues.set(key, list);
      list.forEach((id) => getSocket(id)?.emit("queue:state", { waiting: true, count: list.length }));
      ack({ ok: true });
      if (list.length >= parsed.data.playerCount) {
        const matched = list.splice(0, parsed.data.playerCount); queues.set(key, list);
        startGame(matched, parsed.data, ranked);
      }
    });
    socket.on("queue:leave", () => { const id = socket.data.playerId; if (id) { removeFromQueues(id); socket.emit("queue:state", { waiting: false, count: 0 }); } });

    socket.on("room:create", ({ settings }, ack) => {
      const hostId = socket.data.playerId; const parsed = roomSettingsSchema.safeParse(settings);
      if (!hostId || !parsed.success) return ack({ ok: false, error: "방을 만들 수 없습니다." });
      leaveRoom(hostId);
      removeFromQueues(hostId);
      let code = ""; do code = Math.random().toString(36).slice(2, 8).toUpperCase(); while (rooms.has(code));
      const room: RoomState = { code, hostId, settings: parsed.data, status: "waiting", players: [{ id: hostId, nickname: socket.data.nickname!, ready: false, connected: true }] };
      rooms.set(code, room); sessions.get(hostId)!.roomCode = code; socket.join(`room:${code}`); emitRoom(room); ack({ ok: true, code });
    });
    socket.on("room:join", ({ code }, ack) => {
      const playerId = socket.data.playerId; const room = rooms.get(code.trim().toUpperCase());
      if (!playerId || !room || room.status !== "waiting") return ack({ ok: false, error: "대기 중인 방을 찾지 못했습니다." });
      if (!room.players.some((p) => p.id === playerId) && room.players.length >= room.settings.playerCount) return ack({ ok: false, error: "방이 가득 찼습니다." });
      const session = sessions.get(playerId);
      if (session?.roomCode && session.roomCode !== room.code) leaveRoom(playerId);
      if (!room.players.some((p) => p.id === playerId)) room.players.push({ id: playerId, nickname: socket.data.nickname!, ready: false, connected: true });
      sessions.get(playerId)!.roomCode = room.code; socket.join(`room:${room.code}`); emitRoom(room); ack({ ok: true, code: room.code });
    });
    socket.on("room:leave", (ack) => {
      const playerId = socket.data.playerId;
      if (!playerId) return ack({ ok: false, error: "세션을 찾지 못했습니다." });
      leaveRoom(playerId);
      ack({ ok: true });
    });
    socket.on("room:update", (settings) => {
      const id = socket.data.playerId; const session = id ? sessions.get(id) : undefined; const room = session?.roomCode ? rooms.get(session.roomCode) : undefined; const parsed = roomSettingsSchema.safeParse(settings);
      if (!id || !room || room.hostId !== id || !parsed.success || parsed.data.playerCount < room.players.length) return;
      room.settings = parsed.data; room.players.forEach((p) => p.ready = false); emitRoom(room);
    });
    socket.on("room:ready", (ready) => {
      const id = socket.data.playerId; const session = id ? sessions.get(id) : undefined; const room = session?.roomCode ? rooms.get(session.roomCode) : undefined;
      if (!id || !room) return; const player = room.players.find((p) => p.id === id); if (!player) return;
      player.ready = ready; emitRoom(room);
      if (room.players.length === room.settings.playerCount && room.players.every((p) => p.ready)) { room.status = "playing"; const game = startGame(room.players.map((p) => p.id), room.settings, false); room.gameId = game.id; emitRoom(room); }
    });

    socket.on("game:action", async (raw, ack) => {
      const playerId = socket.data.playerId; const session = playerId ? sessions.get(playerId) : undefined; const game = session?.gameId ? games.get(session.gameId) : undefined; const parsed = gameActionSchema.safeParse(raw);
      if (!playerId || !game || !parsed.success) return ack({ ok: false, error: "잘못된 게임 행동입니다." });
      const actionId = raw.clientActionId; const seen = usedActions.get(game.id)!;
      if (actionId && seen.has(actionId)) return ack({ ok: true });
      try {
        const next = await attachRankedResult(applyAction(game, playerId, parsed.data)); games.set(game.id, next); if (actionId) seen.add(actionId); emitGame(next); ack({ ok: true });
      } catch (error) { const message = error instanceof Error ? error.message : "행동을 처리하지 못했습니다."; socket.emit("game:error", { message }); ack({ ok: false, error: message }); }
    });
    socket.on("game:sync", (ack) => {
      const playerId = socket.data.playerId; const gameId = playerId ? sessions.get(playerId)?.gameId : undefined; const game = gameId ? games.get(gameId) : undefined;
      ack(game ? { ok: true, state: game } : { ok: false, error: "진행 중인 게임을 찾지 못했습니다." });
    });
    socket.on("game:pose", (pose) => {
      const playerId = socket.data.playerId; const gameId = playerId && sessions.get(playerId)?.gameId;
      if (!playerId || !gameId || !Number.isFinite(pose.x) || !Number.isFinite(pose.y)) return;
      socket.to(`game:${gameId}`).emit("game:pose", { playerId, x: Math.max(0, Math.min(1, pose.x)), y: Math.max(0, Math.min(1, pose.y)), fingers: Math.max(0, Math.min(5, Math.round(pose.fingers))), hand: pose.hand });
    });

    socket.on("disconnect", () => {
      const playerId = socket.data.playerId; if (!playerId) return;
      removeFromQueues(playerId); const session = sessions.get(playerId); if (!session || session.socketId !== socket.id) return;
      session.socketId = undefined;
      if (session.roomCode) { const room = rooms.get(session.roomCode); const p = room?.players.find((x) => x.id === playerId); if (p) { p.connected = false; emitRoom(room!); } }
      if (session.gameId) { const game = games.get(session.gameId); const p = game?.players.find((x) => x.id === playerId); if (p && game) { p.connected = false; const graceUntil = Date.now() + 15000; io.to(`game:${game.id}`).emit("player:connection", { playerId, connected: false, graceUntil }); emitGame(game); session.disconnectTimer = setTimeout(() => { void settleDisconnected(game.id, playerId); }, 15000); } }
    });
  });

  const turnTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, game] of games) if (game.status === "playing" && now - game.turnStartedAt >= 30000) {
      const actor = game.players[game.turnIndex];
      try { const next = applyAction(game, actor.id, { type: "pass", reason: "timeout" }, now); void attachRankedResult(next).then((rankedNext) => { games.set(id, rankedNext); emitGame(rankedNext); }); } catch { /* next tick */ }
    }
  }, 1000);

  app.get("/api/health", (_req, res) => res.json({ ok: true, games: games.size, rooms: rooms.size }));
  return { app, httpServer, io, state: { sessions, rooms, games, queues, authStore }, close: async () => { clearInterval(turnTimer); await new Promise<void>((resolve) => io.close(() => resolve())); if (httpServer.listening) await new Promise<void>((resolve) => httpServer.close(() => resolve())); await authStore.close?.(); } };
}
