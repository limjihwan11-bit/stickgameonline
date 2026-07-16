import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  applyAction, chooseAIAction, createGame, itemMissionGoals, legalSplits, normalizeRuleSet,
  type Difficulty, type GameAction, type GameState, type ItemId, type RuleId
} from "@stickgame/shared";
import { useSession } from "../session";
import { rules } from "../ui";
import { isUpwardStrike, useHandCamera, type TrackedHand } from "./useHandCamera";
import { CAMERA_HIT_MARGIN, CAMERA_READY_Y, isPointInExpandedRect, mapCameraPointToStage } from "./gestureMapping";
import { VirtualHand, virtualHandPosition } from "./VirtualHand";
import { getOpponentSeats } from "./boardSeats";
import { FingerIcon } from "./FingerIcon";

const names = ["느긋한 두부", "매콤한 만두", "단단한 묵"];
const makeId = () => crypto.randomUUID();
const targetKey = (playerId: string, hand: number) => `${playerId}-${hand}`;
const queryRules = (value: string | null, fallback: string | null): RuleId[] =>
  normalizeRuleSet((value?.split(",") ?? [fallback || "classic"]).filter((rule): rule is RuleId => rules.some((item) => item.id === rule)));

const itemMeta: Record<ItemId, { label: string; icon: string; desc: string }> = {
  lightning: { label: "번개", icon: "⚡", desc: "무작위 살아있는 손에 +2" },
  bomb: { label: "폭탄", icon: "💣", desc: "무작위 살아있는 손을 0으로" },
  jelly: { label: "회복 젤리", icon: "🍬", desc: "낮은 손 하나를 +1, 0이면 부활" },
  wind: { label: "손바람", icon: "🍃", desc: "생존자 모두의 양손 교체" },
  thief: { label: "도둑장갑", icon: "🧤", desc: "내 손과 상대 손 하나를 교환" }
};

interface ImpactFx {
  id: string;
  x: number;
  y: number;
  power: number;
  target: string;
  sourceHand?: 0 | 1;
}

interface ManualDrag {
  sourceHand: 0 | 1;
  x: number;
  y: number;
}

type TutorialStep = "intro" | "numbers" | "demo" | "drag" | "target" | "wait" | "split" | "camera" | "done";

const tutorialCopy: Record<Exclude<TutorialStep, "done">, { title: string; body: string; position: string; action?: string }> = {
  intro: { title: "젓가락 게임 한 판 배워보자", body: "목표는 상대의 양손을 모두 0으로 만드는 거야. 지금은 컴퓨터랑 천천히 연습해볼게.", position: "bubble-center", action: "시작" },
  numbers: { title: "손 위 숫자가 공격력이야", body: "내 손에 적힌 숫자만큼 상대 손에 더해져. 합이 5 이상이 되면 그 손은 0이 돼.", position: "bubble-south", action: "움직임 보기" },
  demo: { title: "이렇게 끌어서 공격해", body: "아래 내 손을 잡고 위쪽 상대 손까지 가져다 놓는 느낌이야. 가운데 움직이는 예시를 한 번 봐.", position: "bubble-center", action: "직접 해보기" },
  drag: { title: "1단계: 내 손 잡기", body: "밝게 표시된 내 왼손을 꾹 누른 채로 잡아. 마우스면 클릭한 채로, 터치면 손가락을 댄 채로 움직이면 돼.", position: "bubble-east" },
  target: { title: "2단계: 상대 손에 놓기", body: "그 상태로 위쪽의 밝은 상대 왼손까지 끌고 가서 놓아봐. 손 위에서 놓으면 공격이 들어가.", position: "bubble-east" },
  wait: { title: "3단계: 상대 차례 기다리기", body: "좋아, 공격 성공! 이제 컴퓨터가 한 번 둘 때까지 기다려. 내 차례가 돌아오면 다음 설명으로 넘어가.", position: "bubble-center" },
  split: { title: "분열은 숫자를 다시 나누는 기술", body: "양손 합은 그대로 두고 다른 조합으로 바꾸는 행동이야. 예를 들어 2·0은 1·1로 나눌 수 있어.", position: "bubble-east", action: "카메라 보기" },
  camera: { title: "카메라로도 칠 수 있어", body: "카메라를 켜면 실제 손가락 숫자를 인식해. 손을 아래에 한 번 내렸다가 상대 손 가까이 올리면 공격돼.", position: "bubble-east", action: "끝내기" }
};

const tutorialOrder: Exclude<TutorialStep, "done">[] = ["intro", "numbers", "demo", "drag", "target", "wait", "split", "camera"];

function playImpactFeedback(power: number) {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(150 + power * 28, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(52, context.currentTime + .13);
    gain.gain.setValueAtTime(.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.18, context.currentTime + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .16);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .17);
    setTimeout(() => context.close(), 260);
  } catch { /* sound is an enhancement */ }
  navigator.vibrate?.(Math.min(70, 28 + power * 8));
}

export function GamePage() {
  const { mode, gameId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { nickname, playerId, socket } = useSession();
  const local = mode === "ai";
  const difficulty = (params.get("difficulty") || "medium") as Difficulty;
  const tutorialMode = local && params.get("tutorial") === "1";
  const selectedRules = queryRules(params.get("rules"), params.get("rule"));
  const [game, setGame] = useState<GameState | null>(() => local ? createGame(
    "local",
    selectedRules,
    Array.from({ length: Number(params.get("players") || 2) }, (_, i) => i === 0
      ? { id: playerId, nickname }
      : { id: `ai-${i}`, nickname: names[i - 1], isAI: true })
  ) : null);
  const [message, setMessage] = useState("내 손을 상대 손까지 끌어 놓으면 공격합니다.");
  const [seconds, setSeconds] = useState(30);
  const [aimedTarget, setAimedTarget] = useState("");
  const [impact, setImpact] = useState<ImpactFx | null>(null);
  const [manualDrag, setManualDrag] = useState<ManualDrag | null>(null);
  const [tutorialStep, setTutorialStep] = useState<TutorialStep>(() => tutorialMode ? "intro" : "done");
  const [remotePoses, setRemotePoses] = useState<Record<string, { x: number; y: number; fingers: number }>>({});
  const stageRef = useRef<HTMLDivElement>(null);
  const splitGesture = useRef<{ key: string; since: number }>({ key: "", since: 0 });
  const strikeArmed = useRef<Record<0 | 1, boolean>>({ 0: false, 1: false });
  const cooldown = useRef(0);
  const impactTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previousGame = useRef<GameState | null>(null);
  const manualDragRef = useRef<ManualDrag | null>(null);
  const camera = useHandCamera();
  const tutorialActive = tutorialMode && tutorialStep !== "done";
  const finishTutorial = useCallback(() => {
    localStorage.setItem("stick-tutorial-done", "true");
    setTutorialStep("done");
    setMessage("튜토리얼 끝! 이제 자유롭게 이어서 해봐요.");
  }, []);
  const advanceTutorial = useCallback(() => {
    if (tutorialStep === "intro") setTutorialStep("numbers");
    else if (tutorialStep === "numbers") setTutorialStep("demo");
    else if (tutorialStep === "demo") setTutorialStep("drag");
    else if (tutorialStep === "split") setTutorialStep("camera");
    else if (tutorialStep === "camera") finishTutorial();
  }, [finishTutorial, tutorialStep]);

  const showImpact = useCallback((player: string, hand: 0 | 1, power: number, sourceHand?: 0 | 1) => {
    const stage = stageRef.current;
    const element = stage?.querySelector<HTMLElement>(`[data-player-hand="${targetKey(player, hand)}"]`);
    if (!stage || !element) return;
    const stageRect = stage.getBoundingClientRect(); const rect = element.getBoundingClientRect();
    const fx: ImpactFx = {
      id: makeId(), power, sourceHand, target: targetKey(player, hand),
      x: ((rect.left + rect.width / 2 - stageRect.left) / stageRect.width) * 100,
      y: ((rect.top + rect.height / 2 - stageRect.top) / stageRect.height) * 100
    };
    clearTimeout(impactTimer.current); setImpact(fx); playImpactFeedback(power);
    impactTimer.current = setTimeout(() => setImpact(null), 620);
  }, []);

  useEffect(() => () => clearTimeout(impactTimer.current), []);

  useEffect(() => {
    if (local) return;
    const state = (next: GameState) => { if (!gameId || next.id === gameId) setGame(next); };
    const error = ({ message: nextMessage }: { message: string }) => setMessage(nextMessage);
    const pose = (next: { playerId: string; x: number; y: number; fingers: number }) => setRemotePoses((value) => ({ ...value, [next.playerId]: next }));
    socket.on("game:state", state); socket.on("game:error", error); socket.on("game:pose", pose);
    socket.emit("game:sync", (result) => { if (result.ok && result.state) state(result.state); });
    return () => { socket.off("game:state", state); socket.off("game:error", error); socket.off("game:pose", pose); };
  }, [gameId, local, socket]);

  useEffect(() => {
    if (!game || game.status !== "playing") return;
    const tick = () => setSeconds(Math.max(0, Math.ceil((game.turnStartedAt + 30000 - Date.now()) / 1000)));
    tick(); const timer = setInterval(tick, 250); return () => clearInterval(timer);
  }, [game]);

  const act = useCallback((action: GameAction) => {
    if (!game || game.status !== "playing" || game.players[game.turnIndex].id !== playerId) return;
    const sourcePower = action.type === "attack" ? game.players[game.turnIndex].hands[action.sourceHand] : 0;
    const success = () => {
      if (action.type === "attack") showImpact(action.targetPlayerId, action.targetHand, sourcePower, action.sourceHand);
      setMessage(action.type === "use-item" ? `${itemMeta[action.itemId].label} 아이템을 사용했어요.` : action.type === "split" ? "손가락을 새 조합으로 나눴어요." : `쾅! ${sourcePower}만큼 강타했습니다.`);
      cooldown.current = Date.now() + 620;
    };
    if (local) {
      try { setGame(applyAction(game, playerId, action)); success(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "행동 실패"); }
    } else if (action.type !== "pass") {
      socket.emit("game:action", { ...action, clientActionId: makeId() }, (result) => {
        if (result.ok) success(); else setMessage(result.error || "행동 실패");
      });
    }
  }, [game, local, playerId, showImpact, socket]);

  const findManualTarget = useCallback((x: number, y: number) => {
    const stage = stageRef.current; if (!stage) return null;
    for (const element of stage.querySelectorAll<HTMLElement>("[data-opponent-target]:not(.dead)")) {
      if (!isPointInExpandedRect({ x, y }, element.getBoundingClientRect(), 12)) continue;
      return {
        key: targetKey(element.dataset.targetPlayer!, Number(element.dataset.targetHand)),
        playerId: element.dataset.targetPlayer!,
        hand: Number(element.dataset.targetHand) as 0 | 1
      };
    }
    return null;
  }, []);

  const startManualDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, sourceHand: 0 | 1) => {
    if (!game || game.status !== "playing" || game.players[game.turnIndex].id !== playerId || game.players[game.turnIndex].hands[sourceHand] === 0) return;
    event.preventDefault();
    const next = { sourceHand, x: event.clientX, y: event.clientY };
    manualDragRef.current = next; setManualDrag(next); setMessage("상대의 왼손이나 오른손 위에 놓으세요.");
    if (tutorialMode && tutorialStep === "drag") setTutorialStep("target");
  }, [game, playerId, tutorialMode, tutorialStep]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = manualDragRef.current; if (!current) return;
      event.preventDefault();
      const next = { ...current, x: event.clientX, y: event.clientY };
      manualDragRef.current = next; setManualDrag(next);
      setAimedTarget(findManualTarget(event.clientX, event.clientY)?.key || "");
    };
    const finish = (event: PointerEvent) => {
      const current = manualDragRef.current; if (!current) return;
      const target = findManualTarget(event.clientX, event.clientY);
      if (target) {
        act({ type: "attack", sourceHand: current.sourceHand, targetPlayerId: target.playerId, targetHand: target.hand });
        if (tutorialMode && tutorialStep === "target") setTutorialStep("wait");
      }
      else setMessage("상대 손 위에 놓지 않아 공격을 취소했어요.");
      manualDragRef.current = null; setManualDrag(null); setAimedTarget("");
    };
    window.addEventListener("pointermove", move, { passive: false }); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); };
  }, [act, findManualTarget, tutorialMode, tutorialStep]);

  useEffect(() => {
    if (!local || !game || game.status !== "playing") return;
    const actor = game.players[game.turnIndex]; if (!actor.isAI) return;
    const timer = setTimeout(() => {
      const action = chooseAIAction(game, actor.id, difficulty);
      setGame(applyAction(game, actor.id, action)); setMessage(`${actor.nickname}의 차례가 끝났어요.`);
    }, 650);
    return () => clearTimeout(timer);
  }, [difficulty, game, local]);

  useEffect(() => {
    if (!tutorialMode || tutorialStep !== "wait" || !game) return;
    if (game.turnNumber >= 2 && game.players[game.turnIndex]?.id === playerId) setTutorialStep("split");
  }, [game, playerId, tutorialMode, tutorialStep]);

  useEffect(() => {
    const previous = previousGame.current;
    if (previous && game && previous.id === game.id && previous.turnNumber !== game.turnNumber) {
      const previousActor = previous.players[previous.turnIndex];
      if (previousActor?.id !== playerId) {
        for (const nextPlayer of game.players) {
          const before = previous.players.find((p) => p.id === nextPlayer.id);
          if (!before || before.id === previousActor.id) continue;
          const changed = nextPlayer.hands.findIndex((value, hand) => value !== before.hands[hand]);
          if (changed >= 0) { showImpact(nextPlayer.id, changed as 0 | 1, Math.max(...previousActor.hands)); break; }
        }
      }
    }
    previousGame.current = game;
  }, [game, playerId, showImpact]);

  const processGestures = useCallback((hands: TrackedHand[]) => {
    if (manualDragRef.current || !game || game.status !== "playing" || game.players[game.turnIndex].id !== playerId || Date.now() < cooldown.current) return;
    const me = game.players.find((player) => player.id === playerId); const stage = stageRef.current;
    if (!me || !stage) return;

    if (hands.length === 2 && hands.every((hand) => hand.y > .68)) {
      const observed: [number, number] = [hands.find((hand) => hand.hand === 0)?.fingers ?? 0, hands.find((hand) => hand.hand === 1)?.fingers ?? 0];
      const valid = legalSplits(me.hands).some((split) => split[0] === observed[0] && split[1] === observed[1]);
      if (valid) {
        const key = `split:${observed}`;
        if (splitGesture.current.key !== key) splitGesture.current = { key, since: Date.now() };
        else if (Date.now() - splitGesture.current.since >= 800) { act({ type: "split", hands: observed }); splitGesture.current = { key: "", since: 0 }; }
        return;
      }
    }

    const stageRect = stage.getBoundingClientRect(); let currentAim = "";
    for (const hand of hands) {
      const active = me.hands[hand.hand] > 0 && hand.fingers === me.hands[hand.hand];
      if (!active) { strikeArmed.current[hand.hand] = false; continue; }
      const palm = hand.landmarks[9] || hand.landmarks[0];
      const mapped = mapCameraPointToStage({ x: 1 - palm.x, y: palm.y });
      if (mapped.y > CAMERA_READY_Y) strikeArmed.current[hand.hand] = true;
      const x = stageRect.left + mapped.x * stageRect.width; const y = stageRect.top + mapped.y * stageRect.height;
      for (const element of stage.querySelectorAll<HTMLElement>("[data-opponent-target]")) {
        const rect = element.getBoundingClientRect();
        if (!isPointInExpandedRect({ x, y }, rect, CAMERA_HIT_MARGIN)) continue;
        const targetPlayerId = element.dataset.targetPlayer!; const targetHand = Number(element.dataset.targetHand) as 0 | 1;
        currentAim = targetKey(targetPlayerId, targetHand);
        if (isUpwardStrike(hand, strikeArmed.current[hand.hand])) {
          strikeArmed.current[hand.hand] = false;
          act({ type: "attack", sourceHand: hand.hand, targetPlayerId, targetHand });
        }
        break;
      }
    }
    setAimedTarget(currentAim);
  }, [act, game, playerId]);

  useEffect(() => {
    processGestures(camera.hands);
    if (!local && camera.status === "running") camera.hands.forEach((hand) => {
      const position = virtualHandPosition(hand);
      socket.emit("game:pose", { x: position.x, y: position.y, fingers: hand.fingers, hand: hand.hand });
    });
  }, [camera.hands, camera.status, local, processGestures, socket]);

  useEffect(() => {
    if (camera.status === "running") setMessage("손을 아래에 한 번 내렸다가 상대 손 가까이 올리면 공격됩니다.");
  }, [camera.status]);

  useEffect(() => {
    if (!tutorialActive || tutorialStep === "target" || manualDragRef.current) return;
    requestAnimationFrame(() => stageRef.current?.scrollIntoView({ block: "start", behavior: "auto" }));
  }, [tutorialActive, tutorialStep]);

  if (!nickname) return <Navigate to="/" replace />;
  if (!game) return <section className="waiting-page"><div className="loader" /><h1>게임에 연결 중…</h1><button className="secondary" onClick={() => navigate("/")}>홈으로</button></section>;
  const me = game.players.find((player) => player.id === playerId); if (!me) return <Navigate to="/" replace />;
  const actor = game.players[game.turnIndex]; const myTurn = actor.id === playerId;
  const opponents = game.players.filter((player) => player.id !== playerId); const splitOptions = legalSplits(me.hands);
  const opponentSeats = getOpponentSeats(game.players.length);
  const currentRules = normalizeRuleSet(game.rules ?? game.rule);
  const itemMode = currentRules.includes("items");
  const myItemState = game.itemState?.[playerId] ?? { inventory: [], missions: { attack: 0, split: 0 }, earnedItems: 0 };
  const ruleLabel = currentRules.map((id) => rules.find((rule) => rule.id === id)?.label ?? id).join(" + ");
  const itemEvent = game.lastItemEvent;
  const myRatingChange = game.ratingChanges?.[playerId];
  return <section className="game-page">
    <div className="game-toolbar"><button className="back-button" onClick={() => navigate("/")}>← 나가기</button><div><b>{local ? `AI ${difficulty === "easy" ? "하" : difficulty === "medium" ? "중" : "상"}` : game.ranked ? "랭크 온라인 대전" : "온라인 대전"}</b><span>{ruleLabel} · {game.players.length}인전</span></div><div className={myTurn ? "turn-clock mine" : "turn-clock"}><small>{game.status === "finished" ? "종료" : myTurn ? "내 차례" : `${actor.nickname} 차례`}</small><b>{seconds}</b></div></div>
    <div className={`game-stage board-${game.players.length} ${impact ? "impacting" : ""}`} ref={stageRef}>
      <div className="action-lines" />
      <div className="opponents-grid">{opponents.map((player, index) => <article className={`opponent-card seat-${opponentSeats[index]} ${game.status === "playing" && actor.id === player.id ? "active-player" : ""}`} key={player.id}><header><span className="avatar">{player.nickname[0]}</span><div><b>{player.nickname}</b><small>{player.connected ? isDead(player.hands) ? "탈락" : "플레이 중" : "재접속 대기"}</small></div><em>#{index + 2}</em></header><div className="game-hands">{player.hands.map((value, hand) => {
        const key = targetKey(player.id, hand); const tutorialTarget = tutorialActive && (tutorialStep === "target" || tutorialStep === "demo") && index === 0 && hand === 0; return <button key={hand} disabled={!myTurn || value === 0 || me.hands.every((number) => number === 0)} data-opponent-target data-player-hand={key} data-target-player={player.id} data-target-hand={hand} className={`game-hand ${value === 0 ? "dead" : ""} ${aimedTarget === key ? "aimed" : ""} ${impact?.target === key ? "hit" : ""} ${tutorialTarget ? "tutorial-focus" : ""}`}><FingerIcon value={value} /><b>{value}</b><small>{hand === 0 ? "왼손" : "오른손"}</small></button>;
      })}</div></article>)}</div>
      <div className={`battle-message ${tutorialActive && tutorialStep === "wait" ? "tutorial-focus" : ""}`}><span className={myTurn ? "pulse" : ""} /><b>{game.status === "finished" ? "게임 끝" : myTurn ? "내 차례" : `${actor.nickname} 차례`}</b><small>{message}</small>{itemEvent && <small className="item-message">🎲 {itemEvent.label}: {itemEvent.message}</small>}</div>
      <article className={`my-board ${myTurn ? "my-turn" : ""}`}><header><div><p className="eyebrow">YOU</p><h2>{me.nickname}</h2></div><button disabled={camera.status === "loading"} className={`${camera.status === "running" ? "camera-toggle live" : "camera-toggle"} ${tutorialActive && tutorialStep === "camera" ? "tutorial-focus" : ""}`} onClick={camera.start}>{camera.status === "loading" ? "준비 중…" : camera.status === "running" ? "● 타격 모드 ON" : "◉ 카메라 켜기"}</button></header><div className="my-content"><div className="my-hand-select"><label>내 손을 끌어서 상대 손에 놓으세요</label><div className="game-hands">{me.hands.map((value, hand) => {
        const key = targetKey(me.id, hand); const tutorialSource = tutorialActive && (tutorialStep === "numbers" || tutorialStep === "demo" || tutorialStep === "drag") && hand === 0; return <button key={hand} data-player-hand={key} onPointerDown={(event) => startManualDrag(event, hand as 0 | 1)} disabled={!myTurn || value === 0} className={`game-hand draggable ${manualDrag?.sourceHand === hand ? "drag-source" : ""} ${value === 0 ? "dead" : ""} ${impact?.target === key ? "hit" : ""} ${impact?.sourceHand === hand ? "striking" : ""} ${tutorialSource ? "tutorial-focus" : ""}`}><FingerIcon value={value} /><b>{value}</b><small>{hand === 0 ? "왼손" : "오른손"}</small></button>;
      })}</div></div><div className={`split-panel ${tutorialActive && tutorialStep === "split" ? "tutorial-focus" : ""}`}><label>손가락 분열</label><div>{splitOptions.length ? splitOptions.map((split) => <button key={split.join("-")} disabled={!myTurn} onClick={() => act({ type: "split", hands: split })}>{split[0]} · {split[1]}</button>) : <small>가능한 조합이 없어요</small>}</div><p>양손을 화면 아래에서 새 숫자로 0.8초 유지해도 됩니다.</p></div>{itemMode && <ItemPanel state={myItemState} myTurn={myTurn} onUse={(itemId) => act({ type: "use-item", itemId })} />}</div>
        {camera.status === "running" && <div className="strike-guide"><span><b>1</b>숫자 맞추기</span><i>→</i><span><b>2</b>아래에 한 번</span><i>→</i><span><b>3</b>상대 손 가까이</span></div>}
      </article>
      {camera.hands.map((hand, index) => <VirtualHand key={`${hand.hand}-${index}`} hand={hand} />)}
      {manualDrag && <div className="dragging-hand" style={{ left: manualDrag.x, top: manualDrag.y }} aria-hidden="true"><i /><FingerIcon value={me.hands[manualDrag.sourceHand]} /><b>{me.hands[manualDrag.sourceHand]}</b></div>}
      {Object.entries(remotePoses).map(([id, pose]) => <div key={id} className="remote-gesture" style={{ left: `${pose.x * 100}%`, top: `${pose.y * 100}%` }}><FingerIcon value={pose.fingers} /></div>)}
      {impact && <div className="impact-burst" style={{ left: `${impact.x}%`, top: `${impact.y}%` }}><div className="shockwave" /><b>+{impact.power} HIT!</b>{Array.from({ length: 10 }, (_, index) => <i key={index} style={{ "--angle": `${index * 36}deg`, "--distance": `${42 + (index % 3) * 13}px` } as CSSProperties} />)}</div>}
      {camera.status !== "idle" && <div className={`tracking-badge ${camera.status}`}><i />{camera.status === "running" ? "손 인식 중 · 영상 비공개" : camera.status === "loading" ? "손 인식 준비 중" : camera.status === "denied" ? "카메라 권한 필요" : "카메라 연결 실패"}</div>}
      {tutorialActive && tutorialStep === "demo" && <div className="tutorial-demo-motion" aria-hidden="true"><div className="demo-path" /><div className="demo-hand"><FingerIcon value={me.hands[0]} /><b>{me.hands[0]}</b></div><span>끌어서 놓기</span></div>}
      {tutorialActive && <TutorialCoach step={tutorialStep} onNext={advanceTutorial} onSkip={finishTutorial} />}
    </div>
    <div className="camera-source" aria-hidden="true"><video ref={camera.videoRef} autoPlay muted playsInline /><canvas ref={camera.canvasRef} /></div>
    {game.status === "finished" && <div className="result-banner"><span>{game.winnerId === playerId ? "🏆" : "👏"}</span><h2>{game.winnerId === playerId ? "승리했습니다!" : `${game.players.find((player) => player.id === game.winnerId)?.nickname} 승리`}</h2><p>{game.winnerId === playerId ? "멋진 손놀림이었어요." : "좋은 승부였어요. 다시 도전해 보세요."}</p>{myRatingChange && <p className={myRatingChange.delta >= 0 ? "rating-delta plus" : "rating-delta minus"}>{myRatingChange.delta >= 0 ? "+" : ""}{myRatingChange.delta}점 · {myRatingChange.after}점</p>}<button className="primary" onClick={() => navigate(local ? "/setup/ai" : "/")}>{local ? "다시 설정하기" : "홈으로"}</button></div>}
  </section>;
}

const isDead = (hands: [number, number]) => hands[0] === 0 && hands[1] === 0;

function ItemPanel({ state, myTurn, onUse }: { state: { inventory: ItemId[]; missions: { attack: number; split: number } }; myTurn: boolean; onUse: (itemId: ItemId) => void }) {
  const inventoryCounts = state.inventory.reduce<Record<string, number>>((counts, itemId) => ({ ...counts, [itemId]: (counts[itemId] || 0) + 1 }), {});
  const inventory = Object.entries(inventoryCounts) as Array<[ItemId, number]>;
  return <section className="item-panel">
    <header><span>🎁</span><div><b>아이템 미션</b><small>미션을 채우면 랜덤 아이템 획득 · 사용하면 턴 종료</small></div></header>
    <div className="mission-list">
      <MissionMeter label="공격 성공" value={state.missions.attack} goal={itemMissionGoals.attack} />
      <MissionMeter label="분열 성공" value={state.missions.split} goal={itemMissionGoals.split} />
    </div>
    <div className="inventory-list">
      {inventory.length ? inventory.map(([itemId, count]) => <button key={itemId} disabled={!myTurn} onClick={() => onUse(itemId)} title={itemMeta[itemId].desc}><span>{itemMeta[itemId].icon}</span><b>{itemMeta[itemId].label}{count > 1 ? ` ×${count}` : ""}</b><small>{myTurn ? "사용하기" : "내 턴에 사용"}</small></button>) : <p>아직 보유 아이템이 없어요. 공격/분열 미션을 채워보세요.</p>}
    </div>
  </section>;
}

function MissionMeter({ label, value, goal }: { label: string; value: number; goal: number }) {
  const width = `${Math.min(100, (value / goal) * 100)}%`;
  return <div className="mission-meter"><div><b>{label}</b><small>{value}/{goal}</small></div><i><span style={{ width }} /></i></div>;
}

function TutorialCoach({ step, onNext, onSkip }: { step: TutorialStep; onNext: () => void; onSkip: () => void }) {
  if (step === "done") return null;
  const copy = tutorialCopy[step];
  const current = tutorialOrder.indexOf(step) + 1;
  const needsAction = !copy.action;
  return <>
    <div className="tutorial-dim" />
    <aside className={`tutorial-bubble ${copy.position}`}>
      <small>튜토리얼 {current}/{tutorialOrder.length}</small>
      <b>{copy.title}</b>
      <p>{copy.body}</p>
      <div>
        <button className="secondary" onClick={onSkip}>그만 보기</button>
        {copy.action && <button className="primary" onClick={onNext}>{copy.action}</button>}
      </div>
      {needsAction && <em>직접 해보면 다음 단계로 넘어가요.</em>}
    </aside>
  </>;
}
