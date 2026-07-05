import type { GameAction, GameState, Hands, RuleId } from "./types.js";

export class GameRuleError extends Error {}

export function boardSignature(state: Pick<GameState, "players">): string {
  return state.players.map((p) => `${p.id}:${p.hands[0]},${p.hands[1]}`).join("|");
}

export function createGame(id: string, rule: RuleId, players: Array<{ id: string; nickname: string; isAI?: boolean }>, now = Date.now()): GameState {
  const state: GameState = {
    id, rule, players: players.map((p) => ({ ...p, hands: [1, 1], connected: true })),
    turnIndex: 0, status: "playing", turnStartedAt: now, turnNumber: 0,
    firstTurnCompleted: Object.fromEntries(players.map((p) => [p.id, false])), boardHistory: []
  };
  state.boardHistory.push(boardSignature(state));
  return state;
}

export const isEliminated = (hands: Hands) => hands[0] === 0 && hands[1] === 0;

function nextAliveIndex(state: GameState, from: number): number {
  for (let step = 1; step <= state.players.length; step++) {
    const index = (from + step) % state.players.length;
    if (!isEliminated(state.players[index].hands)) return index;
  }
  return from;
}

function attackValue(rule: RuleId, current: number, source: number): number {
  const sum = current + source;
  return rule === "rollover" ? sum % 5 : sum >= 5 ? 0 : sum;
}

function validateSplit(current: Hands, next: Hands) {
  if (next.some((n) => !Number.isInteger(n) || n < 0 || n > 4)) throw new GameRuleError("각 손은 0부터 4까지여야 합니다.");
  if (current[0] + current[1] !== next[0] + next[1]) throw new GameRuleError("분열 전후의 합이 같아야 합니다.");
  if ((current[0] === next[0] && current[1] === next[1]) || (current[0] === next[1] && current[1] === next[0])) throw new GameRuleError("현재와 다른 조합으로 나눠 주세요.");
}

export function applyAction(state: GameState, playerId: string, action: GameAction, now = Date.now()): GameState {
  if (state.status !== "playing") throw new GameRuleError("이미 끝난 게임입니다.");
  const actor = state.players[state.turnIndex];
  if (actor.id !== playerId) throw new GameRuleError("내 차례가 아닙니다.");
  if (isEliminated(actor.hands)) throw new GameRuleError("탈락한 플레이어입니다.");

  const next: GameState = structuredClone(state);
  const nextActor = next.players[next.turnIndex];
  if (action.type === "attack") {
    const target = next.players.find((p) => p.id === action.targetPlayerId);
    if (!target || target.id === playerId || isEliminated(target.hands)) throw new GameRuleError("공격할 수 없는 상대입니다.");
    const sourceValue = nextActor.hands[action.sourceHand];
    if (sourceValue === 0) throw new GameRuleError("아웃된 손은 사용할 수 없습니다.");
    if (target.hands[action.targetHand] === 0) throw new GameRuleError("아웃된 손은 공격할 수 없습니다.");
    target.hands[action.targetHand] = attackValue(next.rule, target.hands[action.targetHand], sourceValue);
  } else if (action.type === "split") {
    if (next.rule === "no-opening-split" && !next.firstTurnCompleted[playerId]) throw new GameRuleError("첫 턴에는 분열할 수 없습니다.");
    validateSplit(nextActor.hands, action.hands);
    nextActor.hands = [...action.hands] as Hands;
  }

  if (action.type !== "pass" && next.rule === "no-repeat" && next.boardHistory.length >= 2) {
    const candidate = boardSignature(next);
    if (candidate === next.boardHistory[next.boardHistory.length - 2]) throw new GameRuleError("한 수 전의 상태를 반복할 수 없습니다.");
  }

  next.firstTurnCompleted[playerId] = true;
  next.turnNumber++;
  next.boardHistory = [...next.boardHistory.slice(-15), boardSignature(next)];
  const alive = next.players.filter((p) => !isEliminated(p.hands));
  if (alive.length === 1) {
    next.status = "finished"; next.winnerId = alive[0].id;
  } else {
    next.turnIndex = nextAliveIndex(next, next.turnIndex); next.turnStartedAt = now;
  }
  return next;
}

export function legalSplits(hands: Hands): Hands[] {
  const total = hands[0] + hands[1];
  const result: Hands[] = [];
  for (let left = 0; left <= 4; left++) {
    const right = total - left;
    if (right < 0 || right > 4) continue;
    if ((left === hands[0] && right === hands[1]) || (left === hands[1] && right === hands[0])) continue;
    result.push([left, right]);
  }
  return result;
}

export function getLegalActions(state: GameState, playerId: string): GameAction[] {
  if (state.status !== "playing" || state.players[state.turnIndex]?.id !== playerId) return [];
  const actor = state.players[state.turnIndex];
  const candidates: GameAction[] = [];
  actor.hands.forEach((value, sourceHand) => {
    if (!value) return;
    state.players.forEach((target) => {
      if (target.id === playerId || isEliminated(target.hands)) return;
      target.hands.forEach((targetValue, targetHand) => targetValue && candidates.push({ type: "attack", sourceHand: sourceHand as 0|1, targetPlayerId: target.id, targetHand: targetHand as 0|1 }));
    });
  });
  if (!(state.rule === "no-opening-split" && !state.firstTurnCompleted[playerId])) legalSplits(actor.hands).forEach((hands) => candidates.push({ type: "split", hands }));
  return candidates.filter((action) => { try { applyAction(state, playerId, action); return true; } catch { return false; } });
}
