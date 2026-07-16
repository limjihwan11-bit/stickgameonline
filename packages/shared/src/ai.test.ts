import { describe, expect, it } from "vitest";
import { chooseAIAction } from "./ai.js";
import { createGame } from "./engine.js";

const players = [{ id: "human", nickname: "Human" }, { id: "ai", nickname: "AI", isAI: true }];

describe("AI strategy", () => {
  it("easy no longer plays randomly and takes the greedy winning attack", () => {
    const game = createGame("ai-easy", "classic", players);
    game.turnIndex = 1;
    game.players[0].hands = [4, 1];
    game.players[1].hands = [1, 1];

    const action = chooseAIAction(game, "ai", "easy");

    expect(action).toMatchObject({ type: "attack", targetPlayerId: "human", targetHand: 0 });
  });

  it("medium starts by combining 1·1 into one active hand", () => {
    const game = createGame("ai-medium-open", "classic", players);
    game.turnIndex = 1;

    const action = chooseAIAction(game, "ai", "medium");

    expect(action).toMatchObject({ type: "split", hands: [2, 0] });
  });

  it("medium prefers a safe split when every attack can be punished", () => {
    const game = createGame("ai-medium-safe-split", "classic", players);
    game.turnIndex = 1;
    game.firstTurnCompleted.ai = true;
    game.players[0].hands = [4, 4];
    game.players[1].hands = [3, 1];

    const action = chooseAIAction(game, "ai", "medium");

    expect(action.type).toBe("split");
  });

  it("hard uses full search and can ignore the old fixed opening script", () => {
    const game = createGame("ai-hard-wait", "classic", players);
    game.turnIndex = 1;

    const first = chooseAIAction(game, "ai", "hard");
    expect(first.type).toBe("attack");

    game.players[1].hands = [2, 0];
    game.firstTurnCompleted.ai = true;
    const second = chooseAIAction(game, "ai", "hard");
    expect(second.type).toBe("split");
  });

  it("hard uses the graph solver instead of the old shallow attack heuristic at 2·1", () => {
    const game = createGame("ai-hard-pattern-a", "classic", players);
    game.turnIndex = 1;
    game.firstTurnCompleted.ai = true;
    game.players[1].hands = [2, 1];

    const action = chooseAIAction(game, "ai", "hard");

    expect(action.type).toBe("split");
  });

  it("hard treats mirrored split results as the same strategic shape", () => {
    const game = createGame("ai-hard-pattern-b", "classic", players);
    game.turnIndex = 1;
    game.firstTurnCompleted.ai = true;
    game.players[1].hands = [3, 0];

    const action = chooseAIAction(game, "ai", "hard");

    expect(action.type).toBe("split");
    expect("hands" in action && [...action.hands].sort()).toEqual([1, 2]);
  });

  it("hard attacks with the higher hand at 4·2", () => {
    const game = createGame("ai-hard-attack", "classic", players);
    game.turnIndex = 1;
    game.firstTurnCompleted.ai = true;
    game.players[0].hands = [1, 1];
    game.players[1].hands = [4, 2];

    const action = chooseAIAction(game, "ai", "hard");

    expect(action).toMatchObject({ type: "attack", sourceHand: 0, targetPlayerId: "human" });
  });

  it("hard search is deterministic for the same two-player board", () => {
    const game = createGame("ai-hard-deterministic", "classic", players);
    game.turnIndex = 1;
    game.firstTurnCompleted.ai = true;
    game.players[0].hands = [2, 4];
    game.players[1].hands = [3, 1];

    const first = chooseAIAction(game, "ai", "hard");
    const repeated = Array.from({ length: 8 }, () => chooseAIAction(game, "ai", "hard"));

    expect(repeated.every((action) => JSON.stringify(action) === JSON.stringify(first))).toBe(true);
  });
});
