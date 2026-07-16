import { describe, expect, it } from "vitest";
import { applyAction, createGame, legalSplits } from "./engine.js";

const players = [{ id: "a", nickname: "A" }, { id: "b", nickname: "B" }];
const fourPlayers = [...players, { id: "c", nickname: "C" }, { id: "d", nickname: "D" }];

describe("game engine", () => {
  it("classic eliminates a hand at five or more", () => {
    const game = createGame("g", "classic", players); game.players[0].hands = [4,1]; game.players[1].hands = [1,1];
    const next = applyAction(game, "a", { type: "attack", sourceHand: 0, targetPlayerId: "b", targetHand: 0 });
    expect(next.players[1].hands[0]).toBe(0);
  });
  it("rollover keeps the remainder", () => {
    const game = createGame("g", "rollover", players); game.players[0].hands = [4,1]; game.players[1].hands = [2,1];
    expect(applyAction(game, "a", { type: "attack", sourceHand: 0, targetPlayerId: "b", targetHand: 0 }).players[1].hands[0]).toBe(1);
  });
  it("blocks opening splits in that mode", () => {
    const game = createGame("g", "no-opening-split", players);
    expect(() => applyAction(game, "a", { type: "split", hands: [0,2] })).toThrow("첫 턴");
  });
  it("generates only sum-preserving splits", () => expect(legalSplits([1,3]).every(([a,b]) => a+b===4)).toBe(true));
  it("supports a three player elimination flow", () => {
    const game = createGame("g", "classic", [...players, { id: "c", nickname: "C" }]); game.players[1].hands = [4,0];
    const next = applyAction(game, "a", { type: "attack", sourceHand: 0, targetPlayerId: "b", targetHand: 0 });
    expect(next.turnIndex).toBe(2);
  });
  it("creates item games", () => {
    const game = createGame("items-game", "items", players);
    expect(game.rule).toBe("items");
    expect(game.itemState?.a.missions.attack).toBe(0);
  });
  it("supports multiple rules in one game", () => {
    const game = createGame("combined-rules", ["items", "no-opening-split"], players);
    expect(game.rules).toEqual(["no-opening-split", "items"]);
    expect(() => applyAction(game, "a", { type: "split", hands: [0,2] })).toThrow("첫 턴");
  });
  it("awards a deterministic item after five successful attacks", () => {
    let game = createGame("attack-mission-items", "items", players);
    for (let index = 0; index < 5; index++) {
      game.turnIndex = 0; game.players[0].hands = [1,1]; game.players[1].hands = [1,1];
      game = applyAction(game, "a", { type: "attack", sourceHand: 0, targetPlayerId: "b", targetHand: 0 });
    }
    expect(game.itemState?.a.missions.attack).toBe(0);
    expect(game.itemState?.a.inventory).toHaveLength(1);
    expect(game.lastItemEvent?.kind).toBe("earned");
    expect(game.lastItemEvent?.mission).toBe("attack");
  });
  it("awards an item after five successful splits", () => {
    let game = createGame("split-mission-items", "items", players);
    for (let index = 0; index < 5; index++) {
      game.turnIndex = 0; game.players[0].hands = [2,0]; game.players[1].hands = [1,1];
      game = applyAction(game, "a", { type: "split", hands: [1,1] });
    }
    expect(game.itemState?.a.missions.split).toBe(0);
    expect(game.itemState?.a.inventory).toHaveLength(1);
    expect(game.lastItemEvent?.kind).toBe("earned");
    expect(game.lastItemEvent?.mission).toBe("split");
  });
  it("uses a held item only when the player chooses it", () => {
    const game = createGame("use-held-item", "items", fourPlayers);
    game.itemState!.a.inventory.push("lightning");
    const next = applyAction(game, "a", { type: "use-item", itemId: "lightning" });
    expect(next.itemState?.a.inventory).toEqual([]);
    expect(next.lastItemEvent?.kind).toBe("used");
    expect(next.lastItemEvent?.id).toBe("lightning");
    for (const hand of next.players.flatMap((player) => player.hands)) {
      expect(hand).toBeGreaterThanOrEqual(0);
      expect(hand).toBeLessThanOrEqual(4);
    }
  });
  it("blocks item use without inventory", () => {
    const game = createGame("missing-item", "items", players);
    expect(() => applyAction(game, "a", { type: "use-item", itemId: "bomb" })).toThrow("보유");
  });
  it("can finish a game by using an item", () => {
    const game = createGame("finish-by-item", "items", players);
    game.players[0].hands = [1,0]; game.players[1].hands = [1,0]; game.itemState!.a.inventory.push("bomb");
    const next = applyAction(game, "a", { type: "use-item", itemId: "bomb" });
    expect(next.status).toBe("finished");
    expect(next.winnerId).toBeTruthy();
    expect(next.lastItemEvent?.kind).toBe("used");
  });
});
