import { applyAction, getLegalActions, isEliminated, legalSplits } from "./engine.js";
import { normalizeRuleSet, type AttackAction, type Difficulty, type GameAction, type GameState, type Hands, type SplitAction } from "./types.js";

type ActionRank = { action: GameAction; after: GameState; value: number };
type HandIndex = 0 | 1;
type ExactOutcome = "win" | "draw" | "loss";
type ExactNode = { state: GameState; actions: Array<{ action: GameAction; to: string }> };
type ExactResult = { outcome: ExactOutcome; distance: number };
type ExactChoice = { action: GameAction; outcome: ExactOutcome; distance: number; heuristic: number };

const isAttack = (action: GameAction): action is AttackAction => action.type === "attack";
const isSplit = (action: GameAction): action is SplitAction => action.type === "split";
const handSum = (hands: Hands) => hands[0] + hands[1];
const maxHand = (hands: Hands) => Math.max(hands[0], hands[1]);
const minHand = (hands: Hands) => Math.min(hands[0], hands[1]);
const exactSearchCache = new Map<string, GameAction>();
const outcomeRank: Record<ExactOutcome, number> = { loss: 0, draw: 1, win: 2 };

function score(state: GameState, playerId: string): number {
  if (state.status === "finished") return state.winnerId === playerId ? 10000 : -10000;
  const me = state.players.find((p) => p.id === playerId)!;
  const mine = me.hands.reduce((a, b) => a + b, 0) + me.hands.filter(Boolean).length * 4;
  const others = state.players
    .filter((p) => p.id !== playerId)
    .reduce((sum, p) => sum + p.hands.reduce((a, b) => a + b, 0) + p.hands.filter(Boolean).length * 4, 0);
  return mine * 3 - others;
}

function rankActions(state: GameState, playerId: string, actions: GameAction[]): ActionRank[] {
  return actions
    .map((action) => {
      const after = applyAction(state, playerId, action);
      return { action, after, value: score(after, playerId) };
    })
    .sort((a, b) => b.value - a.value);
}

function chooseGreedy(state: GameState, playerId: string, actions: GameAction[]): GameAction {
  return rankActions(state, playerId, actions)[0]?.action ?? actions[0];
}

function sameHands(a: Hands, b: Hands): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function sameHandsUnordered(a: Hands, b: Hands): boolean {
  return sameHands(a, b) || (a[0] === b[1] && a[1] === b[0]);
}

function findSplit(actions: GameAction[], target: Hands): SplitAction | undefined {
  return actions.find((action): action is SplitAction => isSplit(action) && sameHands(action.hands, target));
}

function findAnySplit(actions: GameAction[], targets: Hands[]): SplitAction | undefined {
  for (const target of targets) {
    const exact = findSplit(actions, target);
    if (exact) return exact;
  }
  return undefined;
}

function chooseOpeningCombine(state: GameState, playerId: string, actions: GameAction[]): SplitAction | undefined {
  const me = state.players.find((player) => player.id === playerId);
  if (!me || !sameHands(me.hands, [1, 1])) return undefined;
  return findAnySplit(actions, [[2, 0], [0, 2]]);
}

function immediateReplyRisk(after: GameState, playerId: string, protectedHand?: HandIndex): { lostHand: number; lostGame: boolean } {
  if (after.status === "finished") return { lostHand: 0, lostGame: after.winnerId !== playerId };
  const nextActor = after.players[after.turnIndex];
  if (!nextActor || nextActor.id === playerId || isEliminated(nextActor.hands)) return { lostHand: 0, lostGame: false };
  let lostHand = 0;
  let lostGame = false;
  for (const reply of getLegalActions(after, nextActor.id)) {
    if (!isAttack(reply) || reply.targetPlayerId !== playerId) continue;
    if (protectedHand !== undefined && reply.targetHand !== protectedHand) continue;
    const replyAfter = applyAction(after, nextActor.id, reply);
    const meAfter = replyAfter.players.find((player) => player.id === playerId);
    if (meAfter?.hands[reply.targetHand] === 0) lostHand++;
    if (replyAfter.status === "finished" && replyAfter.winnerId !== playerId) lostGame = true;
  }
  return { lostHand, lostGame };
}

function mediumAttackValue(state: GameState, playerId: string, action: AttackAction): number {
  const after = applyAction(state, playerId, action);
  const base = score(after, playerId);
  const target = after.players.find((player) => player.id === action.targetPlayerId);
  const sourceRisk = immediateReplyRisk(after, playerId, action.sourceHand);
  const anyRisk = immediateReplyRisk(after, playerId);
  const targetKilled = target?.hands[action.targetHand] === 0 ? 1 : 0;
  if (after.status === "finished" && after.winnerId === playerId) return 100000;
  return base
    + targetKilled * 260
    - sourceRisk.lostHand * 520
    - anyRisk.lostHand * 180
    - (sourceRisk.lostGame || anyRisk.lostGame ? 20000 : 0)
    + (action.sourceHand === 1 ? 2 : 0);
}

function chooseSafeSplit(state: GameState, playerId: string, actions: GameAction[], keepThree = false): SplitAction | undefined {
  const splits = actions.filter(isSplit);
  if (!splits.length) return undefined;
  return splits
    .map((action) => {
      const after = applyAction(state, playerId, action);
      const risk = immediateReplyRisk(after, playerId);
      const hands = after.players.find((player) => player.id === playerId)?.hands ?? action.hands;
      const nonDead = hands.filter(Boolean).length;
      const shapeBonus = keepThree && maxHand(hands) >= 3 ? 180 : Math.abs(hands[0] - hands[1]) <= 1 ? 80 : 0;
      return {
        action,
        value: score(after, playerId) + shapeBonus + nonDead * 24 - risk.lostHand * 320 - (risk.lostGame ? 20000 : 0)
      };
    })
    .sort((a, b) => b.value - a.value)[0]?.action;
}

function chooseMediumAction(state: GameState, playerId: string, actions: GameAction[]): GameAction {
  const opening = chooseOpeningCombine(state, playerId, actions);
  if (opening) return opening;

  const item = rankActions(state, playerId, actions.filter((action) => action.type === "use-item"))[0];
  if (item && item.value > score(state, playerId) + 8) return item.action;

  const attacks = actions.filter(isAttack)
    .map((action) => ({ action, value: mediumAttackValue(state, playerId, action) }))
    .sort((a, b) => b.value - a.value);
  const safestAttack = attacks[0];
  const safeSplit = chooseSafeSplit(state, playerId, actions);

  if (!safestAttack) return safeSplit ?? chooseGreedy(state, playerId, actions);
  const afterAttack = applyAction(state, playerId, safestAttack.action);
  const risk = immediateReplyRisk(afterAttack, playerId, safestAttack.action.sourceHand);
  if ((risk.lostHand || risk.lostGame) && safeSplit) return safeSplit;
  return safestAttack.action;
}

function chooseHighHandAttack(state: GameState, playerId: string, actions: GameAction[]): AttackAction | undefined {
  const me = state.players.find((player) => player.id === playerId);
  if (!me) return undefined;
  const strongest = me.hands[0] >= me.hands[1] ? 0 : 1;
  const alternate = strongest === 0 ? 1 : 0;
  const preferredSources: HandIndex[] = me.hands[strongest] > 0 ? [strongest, alternate] : [alternate, strongest];
  const attacks = actions.filter(isAttack);
  for (const sourceHand of preferredSources) {
    const candidates = attacks
      .filter((action) => action.sourceHand === sourceHand)
      .map((action) => {
        const after = applyAction(state, playerId, action);
        const target = after.players.find((player) => player.id === action.targetPlayerId);
        const targetKilled = target?.hands[action.targetHand] === 0 ? 1 : 0;
        return { action, value: score(after, playerId) + targetKilled * 360 };
      })
      .sort((a, b) => b.value - a.value);
    if (candidates[0]) return candidates[0].action;
  }
  return undefined;
}

function hardPatternSplit(state: GameState, playerId: string, actions: GameAction[]): SplitAction | undefined {
  const me = state.players.find((player) => player.id === playerId);
  if (!me) return undefined;
  if (sameHandsUnordered(me.hands, [2, 1])) return findAnySplit(actions, [[3, 0], [0, 3]]);
  if (sameHandsUnordered(me.hands, [3, 0])) return findAnySplit(actions, [[2, 1], [1, 2]]);
  return undefined;
}

function chooseKeepThreeSplit(state: GameState, playerId: string, actions: GameAction[]): SplitAction | undefined {
  const me = state.players.find((player) => player.id === playerId);
  if (!me) return undefined;
  const total = handSum(me.hands);
  if (total < 3 || total >= 6) return undefined;
  const targets = legalSplits(me.hands)
    .filter((hands) => maxHand(hands) >= 3)
    .sort((a, b) => {
      const aScore = maxHand(a) * 10 - minHand(a);
      const bScore = maxHand(b) * 10 - minHand(b);
      return bScore - aScore;
    });
  return findAnySplit(actions, targets) ?? chooseSafeSplit(state, playerId, actions, true);
}

function chooseMinimax(state: GameState, playerId: string, actions: GameAction[]): GameAction {
  const ranked = actions.map((action) => {
    const after = applyAction(state, playerId, action);
    if (after.status === "finished") return { action, value: score(after, playerId) };
    const opponent = after.players[after.turnIndex];
    const replies = opponent ? getLegalActions(after, opponent.id) : [];
    const worstReply = replies.length
      ? Math.min(...replies.map((reply) => score(applyAction(after, opponent.id, reply), playerId)))
      : score(after, playerId);
    const actionBias = isSplit(action) ? 12 : isAttack(action) ? 6 : 0;
    return { action, value: worstReply + actionBias };
  });
  ranked.sort((a, b) => b.value - a.value);
  return ranked[0]?.action ?? actions[0];
}

function actionKey(action: GameAction): string {
  if (action.type === "attack") return `attack:${action.sourceHand}:${action.targetPlayerId}:${action.targetHand}`;
  if (action.type === "split") return `split:${action.hands[0]},${action.hands[1]}`;
  if (action.type === "use-item") return `use-item:${action.itemId}`;
  return `pass:${action.reason}`;
}

function solverKey(state: GameState, playerId: string): string {
  const rules = normalizeRuleSet(state.rules ?? state.rule).join("+");
  const players = state.players
    .map((player, index) => `${index}:${player.id}:${player.hands[0]},${player.hands[1]}:${state.firstTurnCompleted[player.id] ? 1 : 0}`)
    .join("|");
  const previousBoard = normalizeRuleSet(state.rules ?? state.rule).includes("no-repeat")
    ? state.boardHistory[state.boardHistory.length - 2] ?? ""
    : "";
  return `${playerId};${rules};t=${state.turnIndex};p=${players};prev=${previousBoard}`;
}

function canUseExactSearch(state: GameState): boolean {
  const rules = normalizeRuleSet(state.rules ?? state.rule);
  return state.players.length === 2 && !rules.includes("items");
}

function buildExactGraph(state: GameState, playerId: string, maxNodes = 20000): Map<string, ExactNode> | undefined {
  const graph = new Map<string, ExactNode>();
  const queued = new Set<string>();
  const stack = [state];
  queued.add(solverKey(state, playerId));

  while (stack.length) {
    const current = stack.pop()!;
    const key = solverKey(current, playerId);
    if (graph.has(key)) continue;
    const actor = current.players[current.turnIndex];
    const node: ExactNode = { state: current, actions: [] };
    graph.set(key, node);
    if (graph.size > maxNodes) return undefined;

    if (current.status === "finished" || !actor) continue;
    for (const action of getLegalActions(current, actor.id)) {
      const after = applyAction(current, actor.id, action);
      const to = solverKey(after, playerId);
      node.actions.push({ action, to });
      if (!graph.has(to) && !queued.has(to)) {
        queued.add(to);
        stack.push(after);
      }
    }
  }
  return graph;
}

function classifyExactGraph(graph: Map<string, ExactNode>, playerId: string): Map<string, ExactResult> {
  const result = new Map<string, ExactResult>();
  for (const [key, node] of graph) {
    if (node.state.status === "finished") {
      result.set(key, { outcome: node.state.winnerId === playerId ? "win" : "loss", distance: 0 });
    } else if (!node.actions.length) {
      result.set(key, { outcome: "draw", distance: 1000 });
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, node] of graph) {
      if (result.has(key)) continue;
      const actor = node.state.players[node.state.turnIndex];
      const known = node.actions.map((edge) => result.get(edge.to));
      const allKnown = known.every(Boolean);
      if (!actor || !known.length) {
        result.set(key, { outcome: "draw", distance: 1000 });
        changed = true;
        continue;
      }

      if (actor.id === playerId) {
        const winning = known.filter((item): item is ExactResult => item?.outcome === "win");
        if (winning.length) {
          result.set(key, { outcome: "win", distance: Math.min(...winning.map((item) => item.distance)) + 1 });
          changed = true;
        } else if (allKnown && known.every((item) => item?.outcome === "loss")) {
          const losing = known as ExactResult[];
          result.set(key, { outcome: "loss", distance: Math.max(...losing.map((item) => item.distance)) + 1 });
          changed = true;
        }
      } else {
        const losing = known.filter((item): item is ExactResult => item?.outcome === "loss");
        if (losing.length) {
          result.set(key, { outcome: "loss", distance: Math.min(...losing.map((item) => item.distance)) + 1 });
          changed = true;
        } else if (allKnown && known.every((item) => item?.outcome === "win")) {
          const winning = known as ExactResult[];
          result.set(key, { outcome: "win", distance: Math.max(...winning.map((item) => item.distance)) + 1 });
          changed = true;
        }
      }
    }
  }

  for (const key of graph.keys()) {
    if (!result.has(key)) result.set(key, { outcome: "draw", distance: 1000 });
  }
  return result;
}

function betterExactChoice(candidate: ExactChoice, current: ExactChoice): boolean {
  const rankDiff = outcomeRank[candidate.outcome] - outcomeRank[current.outcome];
  if (rankDiff !== 0) return rankDiff > 0;
  if (candidate.outcome === "win" && candidate.distance !== current.distance) return candidate.distance < current.distance;
  if (candidate.outcome === "loss" && candidate.distance !== current.distance) return candidate.distance > current.distance;
  if (candidate.heuristic !== current.heuristic) return candidate.heuristic > current.heuristic;
  return actionKey(candidate.action) < actionKey(current.action);
}

function chooseExactAction(state: GameState, playerId: string, actions: GameAction[]): GameAction | undefined {
  if (!canUseExactSearch(state)) return undefined;

  const cacheKey = `root:${solverKey(state, playerId)}`;
  const cached = exactSearchCache.get(cacheKey);
  if (cached && actions.some((action) => actionKey(action) === actionKey(cached))) return cached;

  const graph = buildExactGraph(state, playerId);
  if (!graph) return undefined;
  const solved = classifyExactGraph(graph, playerId);
  let best: ExactChoice | undefined;
  for (const action of actions) {
    const after = applyAction(state, playerId, action);
    const outcome = solved.get(solverKey(after, playerId)) ?? { outcome: "draw", distance: 1000 };
    const candidate: ExactChoice = { action, outcome: outcome.outcome, distance: outcome.distance + 1, heuristic: score(after, playerId) };
    if (!best || betterExactChoice(candidate, best)) best = candidate;
  }

  if (!best) return undefined;
  exactSearchCache.set(cacheKey, best.action);
  if (exactSearchCache.size > 2000) {
    const oldest = exactSearchCache.keys().next().value;
    if (oldest) exactSearchCache.delete(oldest);
  }
  return best.action;
}

function chooseHardAction(state: GameState, playerId: string, actions: GameAction[]): GameAction {
  const exact = chooseExactAction(state, playerId, actions);
  if (exact) return exact;

  const me = state.players.find((player) => player.id === playerId);
  if (!me) return chooseMinimax(state, playerId, actions);

  const opening = chooseOpeningCombine(state, playerId, actions);
  if (opening) return opening;

  const total = handSum(me.hands);
  const readyToAttack = sameHandsUnordered(me.hands, [3, 3]) || sameHandsUnordered(me.hands, [4, 2]) || total >= 7;
  if (readyToAttack) {
    const attack = chooseHighHandAttack(state, playerId, actions);
    if (attack) return attack;
  }

  if (total <= 2) {
    const stall = chooseSafeSplit(state, playerId, actions);
    if (stall) return stall;
    return chooseMinimax(state, playerId, actions);
  }

  const pattern = hardPatternSplit(state, playerId, actions);
  if (pattern) return pattern;

  const keepThree = chooseKeepThreeSplit(state, playerId, actions);
  if (keepThree) return keepThree;

  const highAttack = maxHand(me.hands) >= 3 ? chooseHighHandAttack(state, playerId, actions) : undefined;
  return highAttack ?? chooseMinimax(state, playerId, actions);
}

export function chooseAIAction(state: GameState, playerId: string, difficulty: Difficulty): GameAction {
  const actions = getLegalActions(state, playerId);
  if (!actions.length) return { type: "pass", reason: "timeout" };
  if (difficulty === "easy") return chooseGreedy(state, playerId, actions);
  if (difficulty === "medium") return chooseMediumAction(state, playerId, actions);
  return chooseHardAction(state, playerId, actions);
}
