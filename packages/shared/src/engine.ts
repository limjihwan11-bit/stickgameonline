import {
  itemIds, itemMissionGoals, normalizeRuleSet,
  type GameAction, type GameState, type Hands, type ItemId, type ItemMissionId, type PlayerItemState, type RuleId
} from "./types.js";

export class GameRuleError extends Error {}

export function boardSignature(state: Pick<GameState, "players">): string {
  return state.players.map((p) => `${p.id}:${p.hands[0]},${p.hands[1]}`).join("|");
}

export function createGame(id: string, rule: RuleId | readonly RuleId[], players: Array<{ id: string; nickname: string; isAI?: boolean }>, now = Date.now()): GameState {
  const rules = normalizeRuleSet(rule);
  const state: GameState = {
    id, rule: rules[0], rules, players: players.map((p) => ({ ...p, hands: [1, 1], connected: true })),
    turnIndex: 0, status: "playing", turnStartedAt: now, turnNumber: 0,
    firstTurnCompleted: Object.fromEntries(players.map((p) => [p.id, false])), boardHistory: [],
    itemState: rules.includes("items") ? Object.fromEntries(players.map((p) => [p.id, createPlayerItemState()])) : undefined
  };
  state.boardHistory.push(boardSignature(state));
  return state;
}

export const isEliminated = (hands: Hands) => hands[0] === 0 && hands[1] === 0;

type HandIndex = 0 | 1;
interface HandRef { playerIndex: number; hand: HandIndex }

const itemLabels: Record<ItemId, string> = {
  lightning: "번개",
  bomb: "폭탄",
  jelly: "회복 젤리",
  wind: "손바람",
  thief: "도둑장갑"
};

const handLabels = ["왼손", "오른손"] as const;

function createPlayerItemState(): PlayerItemState {
  return { inventory: [], missions: { attack: 0, split: 0 }, earnedItems: 0 };
}

function ensureItemState(state: GameState, playerId: string): PlayerItemState {
  state.itemState ??= {};
  state.itemState[playerId] ??= createPlayerItemState();
  return state.itemState[playerId];
}

function actionSeed(action: GameAction): string {
  if (action.type === "attack") return `attack:${action.sourceHand}:${action.targetPlayerId}:${action.targetHand}`;
  if (action.type === "split") return `split:${action.hands[0]},${action.hands[1]}`;
  if (action.type === "use-item") return `use-item:${action.itemId}`;
  return `pass:${action.reason}`;
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed: string): () => number {
  let value = hashSeed(seed) || 1;
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], random: () => number): T | undefined {
  return items[Math.floor(random() * items.length)];
}

function livingPlayerIndexes(state: Pick<GameState, "players">): number[] {
  return state.players.flatMap((player, index) => isEliminated(player.hands) ? [] : [index]);
}

function livingHands(state: Pick<GameState, "players">): HandRef[] {
  const refs: HandRef[] = [];
  state.players.forEach((player, playerIndex) => {
    if (isEliminated(player.hands)) return;
    player.hands.forEach((value, hand) => {
      if (value > 0) refs.push({ playerIndex, hand: hand as HandIndex });
    });
  });
  return refs;
}

function bumpedClassicValue(current: number, amount: number): number {
  const next = current + amount;
  return next >= 5 ? 0 : next;
}

function lowerHand(hands: Hands, random: () => number): HandIndex {
  if (hands[0] === hands[1]) return random() < .5 ? 0 : 1;
  return hands[0] < hands[1] ? 0 : 1;
}

function awardMissionProgress(next: GameState, playerId: string, mission: ItemMissionId, turnNumber: number) {
  const progress = ensureItemState(next, playerId);
  progress.missions[mission]++;
  if (progress.missions[mission] < itemMissionGoals[mission]) {
    next.lastItemEvent = undefined;
    return;
  }

  progress.missions[mission] = 0;
  progress.earnedItems++;
  const random = createRandom(`${next.id}:${turnNumber}:award:${playerId}:${mission}:${progress.earnedItems}`);
  const item = pick(itemIds, random) ?? "lightning";
  progress.inventory.push(item);
  next.lastItemEvent = {
    id: item,
    label: itemLabels[item],
    message: `${mission === "attack" ? "공격" : "분열"} 미션 완료! ${itemLabels[item]} 아이템을 얻었어요.`,
    actorId: playerId,
    affectedPlayerIds: [playerId],
    turnNumber,
    kind: "earned",
    mission
  };
}

function applyItemEffect(next: GameState, playerId: string, item: ItemId, turnNumber: number) {
  const random = createRandom(`${next.id}:${turnNumber}:use:${playerId}:${item}:${boardSignature(next)}`);
  const actorIndex = next.players.findIndex((player) => player.id === playerId);
  const affected = new Set<number>();
  const mark = (index: number | undefined) => { if (index !== undefined && index >= 0) affected.add(index); };
  let message = "";

  if (item === "lightning") {
    const ref = pick(livingHands(next), random);
    if (ref) {
      const player = next.players[ref.playerIndex];
      player.hands[ref.hand] = bumpedClassicValue(player.hands[ref.hand], 2);
      mark(ref.playerIndex);
      message = `${player.nickname}의 ${handLabels[ref.hand]}에 번개가 떨어졌어요.`;
    } else message = "번개가 번쩍였지만 맞은 손은 없었어요.";
  } else if (item === "bomb") {
    const ref = pick(livingHands(next), random);
    if (ref) {
      const player = next.players[ref.playerIndex];
      player.hands[ref.hand] = 0;
      mark(ref.playerIndex);
      message = `${player.nickname}의 ${handLabels[ref.hand]}에 폭탄이 터졌어요.`;
    } else message = "폭탄이 굴러갔지만 터질 손이 없었어요.";
  } else if (item === "jelly") {
    const targetIndex = Math.floor(random() * next.players.length);
    const player = next.players[targetIndex];
    const hand = lowerHand(player.hands, random);
    player.hands[hand] = player.hands[hand] === 0 ? 1 : Math.min(4, player.hands[hand] + 1);
    mark(targetIndex);
    message = `${player.nickname}의 ${handLabels[hand]}이 회복 젤리를 먹었어요.`;
  } else if (item === "wind") {
    const survivors = livingPlayerIndexes(next);
    survivors.forEach((index) => {
      const player = next.players[index];
      player.hands = [player.hands[1], player.hands[0]];
      mark(index);
    });
    message = "손바람이 불어서 살아 있는 모두의 양손이 바뀌었어요.";
  } else {
    const actor = next.players[actorIndex];
    const opponents = livingPlayerIndexes(next).filter((index) => index !== actorIndex);
    const opponentIndex = pick(opponents, random);
    if (actor && opponentIndex !== undefined) {
      const opponent = next.players[opponentIndex];
      const actorHand = pick<HandIndex>([0, 1], random) ?? 0;
      const opponentHand = pick<HandIndex>([0, 1], random) ?? 0;
      const actorValue = actor.hands[actorHand];
      actor.hands[actorHand] = opponent.hands[opponentHand];
      opponent.hands[opponentHand] = actorValue;
      mark(actorIndex); mark(opponentIndex);
      message = `${actor.nickname}의 ${handLabels[actorHand]}과 ${opponent.nickname}의 ${handLabels[opponentHand]}이 바뀌었어요.`;
    } else message = "도둑장갑이 훔칠 상대를 찾지 못했어요.";
  }

  next.lastItemEvent = {
    id: item,
    label: itemLabels[item],
    message,
    actorId: playerId,
    affectedPlayerIds: [...affected].map((index) => next.players[index].id),
    turnNumber,
    kind: "used"
  };
}

function nextAliveIndex(state: GameState, from: number): number {
  for (let step = 1; step <= state.players.length; step++) {
    const index = (from + step) % state.players.length;
    if (!isEliminated(state.players[index].hands)) return index;
  }
  return from;
}

function hasRule(state: Pick<GameState, "rule" | "rules">, rule: RuleId): boolean {
  return normalizeRuleSet(state.rules ?? state.rule).includes(rule);
}

function attackValue(state: GameState, current: number, source: number): number {
  const sum = current + source;
  return hasRule(state, "rollover") ? sum % 5 : sum >= 5 ? 0 : sum;
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
  let completedMission: ItemMissionId | undefined;
  if (action.type === "attack") {
    const target = next.players.find((p) => p.id === action.targetPlayerId);
    if (!target || target.id === playerId || isEliminated(target.hands)) throw new GameRuleError("공격할 수 없는 상대입니다.");
    const sourceValue = nextActor.hands[action.sourceHand];
    if (sourceValue === 0) throw new GameRuleError("아웃된 손은 사용할 수 없습니다.");
    if (target.hands[action.targetHand] === 0) throw new GameRuleError("아웃된 손은 공격할 수 없습니다.");
    target.hands[action.targetHand] = attackValue(next, target.hands[action.targetHand], sourceValue);
    completedMission = "attack";
  } else if (action.type === "split") {
    if (hasRule(next, "no-opening-split") && !next.firstTurnCompleted[playerId]) throw new GameRuleError("첫 턴에는 분열할 수 없습니다.");
    validateSplit(nextActor.hands, action.hands);
    nextActor.hands = [...action.hands] as Hands;
    completedMission = "split";
  } else if (action.type === "use-item") {
    if (!hasRule(next, "items")) throw new GameRuleError("아이템전에서만 아이템을 사용할 수 있습니다.");
    const itemState = ensureItemState(next, playerId);
    const itemIndex = itemState.inventory.indexOf(action.itemId);
    if (itemIndex < 0) throw new GameRuleError("보유하지 않은 아이템입니다.");
    itemState.inventory.splice(itemIndex, 1);
    applyItemEffect(next, playerId, action.itemId, state.turnNumber);
  }

  if (action.type !== "pass" && hasRule(next, "no-repeat") && next.boardHistory.length >= 2) {
    const candidate = boardSignature(next);
    if (candidate === next.boardHistory[next.boardHistory.length - 2]) throw new GameRuleError("한 수 전의 상태를 반복할 수 없습니다.");
  }

  if (completedMission && hasRule(next, "items")) awardMissionProgress(next, playerId, completedMission, state.turnNumber);
  else if (action.type !== "use-item") next.lastItemEvent = undefined;

  next.firstTurnCompleted[playerId] = true;
  next.turnNumber++;
  next.boardHistory = [...next.boardHistory.slice(-15), boardSignature(next)];
  const alive = next.players.filter((p) => !isEliminated(p.hands));
  if (alive.length <= 1) {
    next.status = "finished"; next.winnerId = alive[0]?.id ?? playerId;
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
  if (!(hasRule(state, "no-opening-split") && !state.firstTurnCompleted[playerId])) legalSplits(actor.hands).forEach((hands) => candidates.push({ type: "split", hands }));
  if (hasRule(state, "items")) {
    for (const itemId of new Set(state.itemState?.[playerId]?.inventory ?? [])) candidates.push({ type: "use-item", itemId });
  }
  return candidates.filter((action) => { try { applyAction(state, playerId, action); return true; } catch { return false; } });
}
