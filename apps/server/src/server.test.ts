import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { io as connectClient, type Socket as ClientSocket } from "socket.io-client";
import type { GameAction, RoomSettings } from "@stickgame/shared";
import { createStickServer } from "./server.js";

let current: ReturnType<typeof createStickServer> | undefined;
afterEach(async () => { await current?.close(); current = undefined; });
describe("server", () => {
  it("reports health", async () => {
    current = createStickServer();
    const response = await request(current.app).get("/api/health");
    expect(response.status).toBe(200); expect(response.body.ok).toBe(true);
  });
  it("registers, logs in, rejects duplicates, and clears auth sessions", async () => {
    current = createStickServer();
    const agent = request.agent(current.app);
    const created = await agent.post("/api/auth/register").send({ username: "alpha", nickname: "알파", password: "secret1" });
    expect(created.status).toBe(201);
    expect(created.body.user.nickname).toBe("알파");
    const stored = await current.state.authStore.findUserByUsername("alpha");
    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toBe("secret1");

    const duplicate = await request(current.app).post("/api/auth/register").send({ username: "alpha", nickname: "다른알파", password: "secret1" });
    expect(duplicate.status).toBe(409);

    const failedLogin = await request(current.app).post("/api/auth/login").send({ username: "alpha", password: "wrong" });
    expect(failedLogin.status).toBe(401);
    const loggedIn = await request.agent(current.app).post("/api/auth/login").send({ username: "alpha", password: "secret1" });
    expect(loggedIn.status).toBe(200);

    const me = await agent.get("/api/auth/me");
    expect(me.body.user.username).toBe("alpha");
    await agent.post("/api/auth/logout");
    const loggedOut = await agent.get("/api/auth/me");
    expect(loggedOut.body.user).toBeNull();
  });
  it("matches two guests with identical public queue settings", async () => {
    current = createStickServer();
    await new Promise<void>((resolve) => current!.httpServer.listen(0, "127.0.0.1", resolve));
    const address = current.httpServer.address();
    if (!address || typeof address === "string") throw new Error("missing test address");
    const url = `http://127.0.0.1:${address.port}`;
    const a = connectClient(url, { forceNew: true, transports: ["websocket"] });
    const b = connectClient(url, { forceNew: true, transports: ["websocket"] });
    const connected = (socket: ClientSocket) => new Promise<void>((resolve) => socket.on("connect", () => resolve()));
    await Promise.all([connected(a), connected(b)]);
    const hello = (socket: ClientSocket, playerId: string) => new Promise<void>((resolve, reject) => socket.emit("session:hello", { playerId, nickname: playerId }, (result: { ok: boolean; error?: string }) => result.ok ? resolve() : reject(new Error(result.error))));
    await Promise.all([hello(a, "alpha"), hello(b, "beta")]);
    const foundA = new Promise<string>((resolve) => a.once("match:found", ({ gameId }) => resolve(gameId)));
    const foundB = new Promise<string>((resolve) => b.once("match:found", ({ gameId }) => resolve(gameId)));
    const join = (socket: ClientSocket) => new Promise<void>((resolve, reject) => socket.emit("queue:join", { settings: { playerCount: 2, rule: "classic" } }, (result: { ok: boolean; error?: string }) => result.ok ? resolve() : reject(new Error(result.error))));
    await Promise.all([join(a), join(b)]);
    const [gameA, gameB] = await Promise.all([foundA, foundB]);
    expect(gameA).toBe(gameB); expect(current.state.games.get(gameA)?.players).toHaveLength(2);
    a.close(); b.close();
  });
  it("matches item queues only with other item queues", async () => {
    current = createStickServer();
    await new Promise<void>((resolve) => current!.httpServer.listen(0, "127.0.0.1", resolve));
    const address = current.httpServer.address();
    if (!address || typeof address === "string") throw new Error("missing test address");
    const url = `http://127.0.0.1:${address.port}`;
    const a = connectClient(url, { forceNew: true, transports: ["websocket"] });
    const b = connectClient(url, { forceNew: true, transports: ["websocket"] });
    const c = connectClient(url, { forceNew: true, transports: ["websocket"] });
    const connected = (socket: ClientSocket) => new Promise<void>((resolve) => socket.on("connect", () => resolve()));
    await Promise.all([connected(a), connected(b), connected(c)]);
    const hello = (socket: ClientSocket, playerId: string) => new Promise<void>((resolve, reject) => socket.emit("session:hello", { playerId, nickname: playerId }, (result: { ok: boolean; error?: string }) => result.ok ? resolve() : reject(new Error(result.error))));
    await Promise.all([hello(a, "alpha"), hello(b, "beta"), hello(c, "charlie")]);
    const join = (socket: ClientSocket, rule: "classic" | "items") => new Promise<void>((resolve, reject) => socket.emit("queue:join", { settings: { playerCount: 2, rule } }, (result: { ok: boolean; error?: string }) => result.ok ? resolve() : reject(new Error(result.error))));
    await join(a, "items");
    await join(b, "classic");
    expect(current.state.games.size).toBe(0);
    expect(current.state.queues.get("guest:2:items")).toEqual(["alpha"]);
    expect(current.state.queues.get("guest:2:classic")).toEqual(["beta"]);
    await join(c, "items");
    const game = [...current.state.games.values()][0];
    expect(game).toBeDefined();
    expect(game!.rule).toBe("items");
    expect(game!.players.map((player) => player.id).sort()).toEqual(["alpha", "charlie"]);
    expect(current.state.queues.get("guest:2:classic")).toEqual(["beta"]);
    a.close(); b.close(); c.close();
  });
  it("records ranked public match results only for logged-in players", async () => {
    current = createStickServer();
    await new Promise<void>((resolve) => current!.httpServer.listen(0, "127.0.0.1", resolve));
    const address = current.httpServer.address();
    if (!address || typeof address === "string") throw new Error("missing test address");
    const url = `http://127.0.0.1:${address.port}`;
    const cookieA = await registerCookie("rank_a", "랭크A");
    const cookieB = await registerCookie("rank_b", "랭크B");
    const a = connectClient(url, { forceNew: true, transports: ["websocket"], extraHeaders: { Cookie: cookieA } });
    const b = connectClient(url, { forceNew: true, transports: ["websocket"], extraHeaders: { Cookie: cookieB } });
    await Promise.all([socketConnected(a), socketConnected(b)]);
    await Promise.all([socketHello(a, "alpha"), socketHello(b, "beta")]);
    const foundA = new Promise<string>((resolve) => a.once("match:found", ({ gameId }) => resolve(gameId)));
    const foundB = new Promise<string>((resolve) => b.once("match:found", ({ gameId }) => resolve(gameId)));
    await Promise.all([socketJoin(a, { playerCount: 2, rule: "classic" }), socketJoin(b, { playerCount: 2, rule: "classic" })]);
    const [gameA, gameB] = await Promise.all([foundA, foundB]);
    expect(gameA).toBe(gameB);
    const game = current.state.games.get(gameA)!;
    expect(game.ranked).toBe(true);
    game.turnIndex = 0;
    game.players[0].hands = [4, 0];
    game.players[1].hands = [1, 0];

    await socketAction(a, { type: "attack", sourceHand: 0, targetPlayerId: game.players[1].id, targetHand: 0 });

    const finished = current.state.games.get(gameA)!;
    expect(finished.status).toBe("finished");
    expect(finished.ratingChanges?.[game.players[0].id]?.delta).toBeGreaterThan(0);
    expect(finished.ratingChanges?.[game.players[1].id]?.delta).toBeLessThan(0);
    const leaderboard = await request(current.app).get("/api/leaderboard");
    expect(leaderboard.body.entries[0].wins).toBe(1);
    expect(leaderboard.body.entries.some((entry: { losses: number }) => entry.losses === 1)).toBe(true);
    const userA = await current.state.authStore.findUserByUsername("rank_a");
    const userB = await current.state.authStore.findUserByUsername("rank_b");
    const duplicate = await current.state.authStore.recordRankedMatch({ gameId: gameA, winnerUserId: userA!.id, playerUserIds: [userA!.id, userB!.id], rules: ["classic"] });
    expect(duplicate).toBeUndefined();
    a.close(); b.close();
  });
  it("matches combined rule queues by the same normalized rule set", async () => {
    current = createStickServer();
    await new Promise<void>((resolve) => current!.httpServer.listen(0, "127.0.0.1", resolve));
    const address = current.httpServer.address();
    if (!address || typeof address === "string") throw new Error("missing test address");
    const url = `http://127.0.0.1:${address.port}`;
    const a = connectClient(url, { forceNew: true, transports: ["websocket"] });
    const b = connectClient(url, { forceNew: true, transports: ["websocket"] });
    const connected = (socket: ClientSocket) => new Promise<void>((resolve) => socket.on("connect", () => resolve()));
    await Promise.all([connected(a), connected(b)]);
    const hello = (socket: ClientSocket, playerId: string) => new Promise<void>((resolve, reject) => socket.emit("session:hello", { playerId, nickname: playerId }, (result: { ok: boolean; error?: string }) => result.ok ? resolve() : reject(new Error(result.error))));
    await Promise.all([hello(a, "alpha"), hello(b, "beta")]);
    const foundA = new Promise<string>((resolve) => a.once("match:found", ({ gameId }) => resolve(gameId)));
    const foundB = new Promise<string>((resolve) => b.once("match:found", ({ gameId }) => resolve(gameId)));
    await Promise.all([
      socketJoin(a, { playerCount: 2, rule: "items", rules: ["items", "no-repeat"] }),
      socketJoin(b, { playerCount: 2, rule: "no-repeat", rules: ["no-repeat", "items"] })
    ]);
    const [gameA, gameB] = await Promise.all([foundA, foundB]);
    expect(gameA).toBe(gameB);
    expect(current.state.games.get(gameA)?.rules).toEqual(["no-repeat", "items"]);
    a.close(); b.close();
  });
  it("lets a friendly room host leave and returns the session to no room", async () => {
    current = createStickServer();
    await new Promise<void>((resolve) => current!.httpServer.listen(0, "127.0.0.1", resolve));
    const address = current.httpServer.address();
    if (!address || typeof address === "string") throw new Error("missing test address");
    const url = `http://127.0.0.1:${address.port}`;
    const socket = connectClient(url, { forceNew: true, transports: ["websocket"] });
    await new Promise<void>((resolve) => socket.on("connect", () => resolve()));
    await socketHello(socket, "alpha");
    const code = await socketCreateRoom(socket, { playerCount: 2, rule: "classic" });
    expect(current.state.rooms.has(code)).toBe(true);
    expect(current.state.sessions.get("alpha")?.roomCode).toBe(code);

    await socketLeaveRoom(socket);

    expect(current.state.rooms.has(code)).toBe(false);
    expect(current.state.sessions.get("alpha")?.roomCode).toBeUndefined();
    socket.close();
  });
});

const socketJoin = (socket: ClientSocket, settings: RoomSettings) => new Promise<void>((resolve, reject) =>
  socket.emit("queue:join", { settings }, (result: { ok: boolean; error?: string }) => result.ok ? resolve() : reject(new Error(result.error)))
);
const socketConnected = (socket: ClientSocket) => new Promise<void>((resolve) => socket.on("connect", () => resolve()));
const socketHello = (socket: ClientSocket, playerId: string) => new Promise<void>((resolve, reject) =>
  socket.emit("session:hello", { playerId, nickname: playerId }, (result: { ok: boolean; error?: string }) => result.ok ? resolve() : reject(new Error(result.error)))
);
const socketAction = (socket: ClientSocket, action: GameAction) => new Promise<void>((resolve, reject) =>
  socket.emit("game:action", { ...action, clientActionId: `test-${Date.now()}-${Math.random()}` }, (result: { ok: boolean; error?: string }) => result.ok ? resolve() : reject(new Error(result.error)))
);
const socketCreateRoom = (socket: ClientSocket, settings: RoomSettings) => new Promise<string>((resolve, reject) =>
  socket.emit("room:create", { settings }, (result: { ok: boolean; code?: string; error?: string }) => result.ok && result.code ? resolve(result.code) : reject(new Error(result.error)))
);
const socketLeaveRoom = (socket: ClientSocket) => new Promise<void>((resolve, reject) =>
  socket.emit("room:leave", (result: { ok: boolean; error?: string }) => result.ok ? resolve() : reject(new Error(result.error)))
);
const registerCookie = async (username: string, nickname: string) => {
  const response = await request(current!.app).post("/api/auth/register").send({ username, nickname, password: "secret1" });
  expect(response.status).toBe(201);
  const cookie = response.headers["set-cookie"];
  const list = Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
  return list.map((item) => item.split(";")[0]).join("; ");
};
