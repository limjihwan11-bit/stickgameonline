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
  });
  it("supports multiple rules in one game", () => {
    const game = createGame("combined-rules", ["items", "no-opening-split"], players);
    expect(game.rules).toEqual(["no-opening-split", "items"]);
    expect(() => applyAction(game, "a", { type: "split", hands: [0,2] })).toThrow("첫 턴");
  });
  it("triggers deterministic item events after item attacks", () => {
    const game = createGame("deterministic-items", "items", players);
    game.players[0].hands = [1,0]; game.players[1].hands = [1,1];
    const action = { type: "attack", sourceHand: 0, targetPlayerId: "b", targetHand: 0 } as const;
    const first = applyAction(game, "a", action, 1000);
    const second = applyAction(game, "a", action, 1000);
    expect(first.lastItemEvent).toEqual(second.lastItemEvent);
    expect(first.players.map((player) => player.hands)).toEqual(second.players.map((player) => player.hands));
    expect(first.lastItemEvent?.turnNumber).toBe(0);
  });
  it("triggers an item after item splits", () => {
    const game = createGame("split-items", "items", players);
    game.players[0].hands = [2,0];
    const next = applyAction(game, "a", { type: "split", hands: [1,1] });
    expect(next.lastItemEvent?.actorId).toBe("a");
  });
  it("can roll every item type and keeps hand values in range", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 500 && seen.size < 5; index++) {
      const game = createGame(`range-items-${index}`, "items", fourPlayers);
      game.players[0].hands = [4,1]; game.players[1].hands = [1,4]; game.players[2].hands = [0,2]; game.players[3].hands = [3,0];
      const next = applyAction(game, "a", { type: "attack", sourceHand: 0, targetPlayerId: "b", targetHand: 0 });
      expect(next.lastItemEvent).toBeDefined();
      seen.add(next.lastItemEvent!.id);
      for (const hand of next.players.flatMap((player) => player.hands)) {
        expect(Number.isInteger(hand)).toBe(true);
        expect(hand).toBeGreaterThanOrEqual(0);
        expect(hand).toBeLessThanOrEqual(4);
      }
    }
    expect([...seen].sort()).toEqual(["bomb", "jelly", "lightning", "thief", "wind"].sort());
  });
  it("can finish a game through an item effect", () => {
    let finishedByItem = false;
    for (let index = 0; index < 500 && !finishedByItem; index++) {
      const game = createGame(`finish-items-${index}`, "items", players);
      game.players[0].hands = [3,0]; game.players[1].hands = [1,0];
      const next = applyAction(game, "a", { type: "attack", sourceHand: 0, targetPlayerId: "b", targetHand: 0 });
      finishedByItem = next.status === "finished" && !!next.winnerId && !!next.lastItemEvent;
    }
    expect(finishedByItem).toBe(true);
  });
});
