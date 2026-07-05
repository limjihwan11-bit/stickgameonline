import { describe, expect, it } from "vitest";
import { applyAction, createGame, legalSplits } from "./engine.js";

const players = [{ id: "a", nickname: "A" }, { id: "b", nickname: "B" }];
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
});
