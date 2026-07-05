import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server, type Socket } from "socket.io";
import {
  applyAction, boardSignature, createGame, gameActionSchema, isEliminated, roomSettingsSchema,
  type ClientToServerEvents, type GameState, type RoomSettings, type RoomState, type ServerToClientEvents
} from "@stickgame/shared";

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, { playerId?: string; nickname?: string }>;
interface Session { nickname: string; socketId?: string; roomCode?: string; gameId?: string; disconnectTimer?: NodeJS.Timeout }

export function createStickServer() {
  const app = express();
  app.use(cors()); app.use(express.json());
  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: { origin: true, credentials: true } });
  const sessions = new Map<string, Session>();
  const rooms = new Map<string, RoomState>();
  const games = new Map<string, GameState>();
  const queues = new Map<string, string[]>();
  const usedActions = new Map<string, Set<string>>();

  const queueKey = (settings: RoomSettings) => `${settings.playerCount}:${settings.rule}`;
  const getSocket = (playerId: string) => { const sid = sessions.get(playerId)?.socketId; return sid ? io.sockets.sockets.get(sid) as GameSocket | undefined : undefined; };
  const emitRoom = (room: RoomState) => room.players.forEach((p) => getSocket(p.id)?.emit("room:state", room));
  const emitGame = (game: GameState) => io.to(`game:${game.id}`).emit("game:state", game);

  function removeFromQueues(playerId: string) {
    for (const [key, list] of queues) {
      const filtered = list.filter((id) => id !== playerId);
      queues.set(key, filtered);
      if (filtered.length !== list.length) filtered.forEach((id) => getSocket(id)?.emit("queue:state", { waiting: true, count: filtered.length }));
    }
  }

  function startGame(playerIds: string[], settings: RoomSettings): GameState {
    const id = randomUUID();
    const game = createGame(id, settings.rule, playerIds.map((pid) => ({ id: pid, nickname: sessions.get(pid)?.nickname || "플레이어" })));
    games.set(id, game); usedActions.set(id, new Set());
    playerIds.forEach((pid) => {
      const session = sessions.get(pid)!; session.gameId = id; session.roomCode = undefined;
      const socket = getSocket(pid); socket?.join(`game:${id}`); socket?.emit("match:found", { gameId: id });
    });
    setTimeout(() => emitGame(game), 20);
    return game;
  }

  function settleDisconnected(gameId: string, playerId: string) {
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
    game.boardHistory.push(boardSignature(game)); emitGame(game);
  }

  io.on("connection", (socket: GameSocket) => {
    socket.on("session:hello", ({ playerId, nickname }, ack) => {
      const cleanName = nickname.trim().slice(0, 12);
      if (!playerId || !cleanName) return ack({ ok: false, error: "닉네임을 입력해 주세요." });
      socket.data.playerId = playerId; socket.data.nickname = cleanName;
      const session = sessions.get(playerId) || { nickname: cleanName };
      if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
      session.nickname = cleanName; session.socketId = socket.id; sessions.set(playerId, session);
      if (session.roomCode) { const room = rooms.get(session.roomCode); if (room) { const p = room.players.find((x) => x.id === playerId); if (p) p.connected = true; emitRoom(room); } }
      if (session.gameId) { const game = games.get(session.gameId); if (game) { const p = game.players.find((x) => x.id === playerId); if (p) p.connected = true; socket.join(`game:${game.id}`); socket.emit("game:state", game); io.to(`game:${game.id}`).emit("player:connection", { playerId, connected: true }); } }
      ack({ ok: true });
    });

    socket.on("queue:join", ({ settings }, ack) => {
      const playerId = socket.data.playerId;
      const parsed = roomSettingsSchema.safeParse(settings);
      if (!playerId || !parsed.success) return ack({ ok: false, error: "올바르지 않은 매칭 설정입니다." });
      removeFromQueues(playerId);
      const key = queueKey(parsed.data); const list = queues.get(key) || [];
      if (!list.includes(playerId)) list.push(playerId); queues.set(key, list);
      list.forEach((id) => getSocket(id)?.emit("queue:state", { waiting: true, count: list.length }));
      ack({ ok: true });
      if (list.length >= settings.playerCount) {
        const matched = list.splice(0, settings.playerCount); queues.set(key, list);
        startGame(matched, settings);
      }
    });
    socket.on("queue:leave", () => { const id = socket.data.playerId; if (id) { removeFromQueues(id); socket.emit("queue:state", { waiting: false, count: 0 }); } });

    socket.on("room:create", ({ settings }, ack) => {
      const hostId = socket.data.playerId; const parsed = roomSettingsSchema.safeParse(settings);
      if (!hostId || !parsed.success) return ack({ ok: false, error: "방을 만들 수 없습니다." });
      removeFromQueues(hostId);
      let code = ""; do code = Math.random().toString(36).slice(2, 8).toUpperCase(); while (rooms.has(code));
      const room: RoomState = { code, hostId, settings: parsed.data, status: "waiting", players: [{ id: hostId, nickname: socket.data.nickname!, ready: false, connected: true }] };
      rooms.set(code, room); sessions.get(hostId)!.roomCode = code; socket.join(`room:${code}`); emitRoom(room); ack({ ok: true, code });
    });
    socket.on("room:join", ({ code }, ack) => {
      const playerId = socket.data.playerId; const room = rooms.get(code.trim().toUpperCase());
      if (!playerId || !room || room.status !== "waiting") return ack({ ok: false, error: "대기 중인 방을 찾지 못했습니다." });
      if (!room.players.some((p) => p.id === playerId) && room.players.length >= room.settings.playerCount) return ack({ ok: false, error: "방이 가득 찼습니다." });
      if (!room.players.some((p) => p.id === playerId)) room.players.push({ id: playerId, nickname: socket.data.nickname!, ready: false, connected: true });
      sessions.get(playerId)!.roomCode = room.code; socket.join(`room:${room.code}`); emitRoom(room); ack({ ok: true, code: room.code });
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
      if (room.players.length === room.settings.playerCount && room.players.every((p) => p.ready)) { room.status = "playing"; const game = startGame(room.players.map((p) => p.id), room.settings); room.gameId = game.id; emitRoom(room); }
    });

    socket.on("game:action", (raw, ack) => {
      const playerId = socket.data.playerId; const session = playerId ? sessions.get(playerId) : undefined; const game = session?.gameId ? games.get(session.gameId) : undefined; const parsed = gameActionSchema.safeParse(raw);
      if (!playerId || !game || !parsed.success) return ack({ ok: false, error: "잘못된 게임 행동입니다." });
      const actionId = raw.clientActionId; const seen = usedActions.get(game.id)!;
      if (actionId && seen.has(actionId)) return ack({ ok: true });
      try {
        const next = applyAction(game, playerId, parsed.data); games.set(game.id, next); if (actionId) seen.add(actionId); emitGame(next); ack({ ok: true });
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
      if (session.gameId) { const game = games.get(session.gameId); const p = game?.players.find((x) => x.id === playerId); if (p && game) { p.connected = false; const graceUntil = Date.now() + 15000; io.to(`game:${game.id}`).emit("player:connection", { playerId, connected: false, graceUntil }); emitGame(game); session.disconnectTimer = setTimeout(() => settleDisconnected(game.id, playerId), 15000); } }
    });
  });

  const turnTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, game] of games) if (game.status === "playing" && now - game.turnStartedAt >= 30000) {
      const actor = game.players[game.turnIndex];
      try { const next = applyAction(game, actor.id, { type: "pass", reason: "timeout" }, now); games.set(id, next); emitGame(next); } catch { /* next tick */ }
    }
  }, 1000);

  app.get("/api/health", (_req, res) => res.json({ ok: true, games: games.size, rooms: rooms.size }));
  return { app, httpServer, io, state: { sessions, rooms, games, queues }, close: async () => { clearInterval(turnTimer); await new Promise<void>((resolve) => io.close(() => resolve())); if (httpServer.listening) await new Promise<void>((resolve) => httpServer.close(() => resolve())); } };
}
