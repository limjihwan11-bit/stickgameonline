import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { io as connectClient, type Socket as ClientSocket } from "socket.io-client";
import { createStickServer } from "./server.js";

let current: ReturnType<typeof createStickServer> | undefined;
afterEach(async () => { await current?.close(); current = undefined; });
describe("server", () => {
  it("reports health", async () => {
    current = createStickServer();
    const response = await request(current.app).get("/api/health");
    expect(response.status).toBe(200); expect(response.body.ok).toBe(true);
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
});
