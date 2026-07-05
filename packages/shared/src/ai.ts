import { applyAction, getLegalActions, isEliminated } from "./engine.js";
import type { Difficulty, GameAction, GameState } from "./types.js";

function score(state: GameState, playerId: string): number {
  if (state.status === "finished") return state.winnerId === playerId ? 10000 : -10000;
  const me = state.players.find((p) => p.id === playerId)!;
  const mine = me.hands.reduce((a, b) => a + b, 0) + me.hands.filter(Boolean).length * 4;
  const others = state.players.filter((p) => p.id !== playerId).reduce((sum, p) => sum + p.hands.reduce((a,b) => a+b, 0) + p.hands.filter(Boolean).length * 4, 0);
  return mine * 3 - others;
}

export function chooseAIAction(state: GameState, playerId: string, difficulty: Difficulty): GameAction {
  const actions = getLegalActions(state, playerId);
  if (!actions.length) return { type: "pass", reason: "timeout" };
  if (difficulty === "easy") return actions[Math.floor(Math.random() * actions.length)];
  const ranked = actions.map((action) => ({ action, value: score(applyAction(state, playerId, action), playerId) }));
  ranked.sort((a,b) => b.value - a.value);
  if (difficulty === "medium" || state.players.length > 2) return ranked[0].action;

  let best = ranked[0];
  for (const item of ranked) {
    const after = applyAction(state, playerId, item.action);
    if (after.status === "finished") return item.action;
    const opponent = after.players[after.turnIndex];
    const replies = getLegalActions(after, opponent.id);
    const worstReply = replies.length ? Math.min(...replies.map((reply) => score(applyAction(after, opponent.id, reply), playerId))) : item.value;
    if (worstReply > best.value) best = { action: item.action, value: worstReply };
  }
  return best.action;
}
