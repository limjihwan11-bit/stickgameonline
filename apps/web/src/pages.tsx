import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Difficulty, RoomSettings, RoomState, RuleId } from "@stickgame/shared";
import { useSession } from "./session";
import { rules, Segmented } from "./ui";

export function HomePage() {
  const { nickname, setNickname, connected } = useSession(); const [draft, setDraft] = useState(nickname); const navigate = useNavigate();
  const enter = (path: string) => { if (!draft.trim()) return; setNickname(draft); navigate(path); };
  return <div className="home-page">
    <section className="hero"><p className="eyebrow">CHOPSTICKS ONLINE</p><h1>손가락 준비됐지?<br/><em>한 판 가자!</em></h1><p>카메라로 하거나, 손을 끌어서 바로 시작하세요.</p></section>
    <section className="entry-panel">
      <label className="nickname-field"><span>게스트 닉네임</span><input value={draft} maxLength={12} placeholder="이름을 입력하세요" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enter("/queue?players=2&rule=classic")} /></label>
      <div className="connection"><i className={connected ? "online" : ""}/>{connected ? "매칭 서버 연결됨" : "서버 연결 중…"}</div>
      <div className="mode-grid">
        <button className="mode-card featured" onClick={() => enter("/queue?players=2&rule=classic")}><span className="mode-number">01</span><b>랜덤 시작</b><small>클래식 · 2인전</small><i>→</i></button>
        <button className="mode-card" onClick={() => enter("/setup/ai")}><span className="mode-number">02</span><b>컴퓨터 대전</b><small>난이도와 인원 선택</small><i>→</i></button>
        <button className="mode-card" onClick={() => enter("/friendly")}><span className="mode-number">03</span><b>친선전</b><small>방을 만들고 친구 초대</small><i>→</i></button>
        <button className="mode-card" onClick={() => enter("/setup/custom")}><span className="mode-number">04</span><b>모드 선택</b><small>원하는 조건으로 공개 매칭</small><i>→</i></button>
      </div>
    </section>
  </div>;
}

export function SetupPage() {
  const { kind } = useParams(); const { nickname } = useSession(); const navigate = useNavigate();
  const [playerCount, setPlayerCount] = useState<2|3|4>(2); const [rule, setRule] = useState<RuleId>("classic"); const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  if (!nickname) return <Navigate to="/" replace />;
  const ai = kind === "ai";
  const start = () => ai
    ? navigate(`/game/ai/local?players=${playerCount}&rule=${rule}&difficulty=${difficulty}`)
    : navigate(`/queue?players=${playerCount}&rule=${rule}`);
  return <section className="setup-page narrow-page"><div className="page-heading"><p className="eyebrow">{ai ? "PLAY WITH AI" : "CUSTOM MATCH"}</p><h1>{ai ? "컴퓨터 대전" : "모드 선택"}</h1><p>{ai ? "난이도와 인원을 고르면 바로 시작합니다." : "같은 조건을 고른 플레이어와 연결합니다."}</p></div>
    <div className="settings-card"><label>참가 인원</label><Segmented value={playerCount} onChange={setPlayerCount} values={[2,3,4].map((n) => ({ value: n as 2|3|4, label: `${n}인` }))}/>
      {ai && <><label>AI 난이도</label><Segmented value={difficulty} onChange={setDifficulty} values={[{value:"easy",label:"하"},{value:"medium",label:"중"},{value:"hard",label:"상"}]}/></>}
      <label>게임 룰</label><div className="rule-list">{rules.map((item) => <button key={item.id} className={rule === item.id ? "selected" : ""} onClick={() => setRule(item.id)}><span>{rule === item.id ? "●" : "○"}</span><div><b>{item.label}</b><small>{item.desc}</small></div></button>)}</div>
      <button className="primary wide" onClick={start}>{ai ? "AI 대전 시작" : "이 조건으로 매칭"}</button>
    </div></section>;
}

export function QueuePage() {
  const { nickname, socket, registered } = useSession(); const [params] = useSearchParams(); const navigate = useNavigate();
  const playerCount = Math.min(4, Math.max(2, Number(params.get("players")))) as 2|3|4; const rule = (rules.some((r) => r.id === params.get("rule")) ? params.get("rule") : "classic") as RuleId;
  const [count, setCount] = useState(1); const [elapsed, setElapsed] = useState(0); const [error, setError] = useState("");
  useEffect(() => {
    if (!registered) return;
    const found = ({ gameId }: { gameId: string }) => navigate(`/game/online/${gameId}`);
    const state = ({ count: waitingCount }: { waiting: boolean; count: number }) => setCount(waitingCount);
    socket.on("match:found", found); socket.on("queue:state", state);
    socket.emit("queue:join", { settings: { playerCount, rule } }, (result) => !result.ok && setError(result.error || "매칭을 시작하지 못했습니다."));
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => { clearInterval(timer); socket.emit("queue:leave"); socket.off("match:found", found); socket.off("queue:state", state); };
  }, [navigate, playerCount, registered, rule, socket]);
  if (!nickname) return <Navigate to="/" replace />;
  const ruleName = rules.find((r) => r.id === rule)?.label;
  return <section className="waiting-page"><div className="radar"><span/><span/><span/><b>✌</b></div><p className="eyebrow">FINDING PLAYERS</p><h1>상대를 찾고 있어요</h1><p className="waiting-copy">{ruleName} · {playerCount}인전 · 현재 {count}/{playerCount}명</p><div className="waiting-time">{String(Math.floor(elapsed/60)).padStart(2,"0")}:{String(elapsed%60).padStart(2,"0")}</div>{error && <p className="error">{error}</p>}<button className="secondary" onClick={() => navigate("/")}>매칭 취소</button></section>;
}

export function FriendlyPage() {
  const { code: urlCode } = useParams(); const { nickname, playerId, socket, registered } = useSession(); const navigate = useNavigate();
  const [room, setRoom] = useState<RoomState|null>(null); const [joinCode, setJoinCode] = useState(urlCode || ""); const [error, setError] = useState(""); const [copied, setCopied] = useState(false);
  const [settings, setSettings] = useState<RoomSettings>({ playerCount: 2, rule: "classic" });
  useEffect(() => {
    const update = (next: RoomState) => { setRoom(next); setSettings(next.settings); if (next.gameId) navigate(`/game/online/${next.gameId}`); };
    const found = ({ gameId }: { gameId: string }) => navigate(`/game/online/${gameId}`);
    socket.on("room:state", update); socket.on("match:found", found);
    if (urlCode && nickname && registered) socket.emit("room:join", { code: urlCode }, (r) => !r.ok && setError(r.error || "방 참가 실패"));
    return () => { socket.off("room:state", update); socket.off("match:found", found); };
  }, [navigate, nickname, registered, socket, urlCode]);
  if (!nickname) return <Navigate to="/" replace />;
  const create = () => socket.emit("room:create", { settings }, (r) => r.ok && r.code ? navigate(`/friendly/${r.code}`, { replace: true }) : setError(r.error || "방 생성 실패"));
  const join = () => socket.emit("room:join", { code: joinCode }, (r) => r.ok && r.code ? navigate(`/friendly/${r.code}`, { replace: true }) : setError(r.error || "방 참가 실패"));
  if (!room) return <section className="narrow-page friendly-entry"><div className="page-heading"><p className="eyebrow">FRIENDLY MATCH</p><h1>친구와 함께</h1><p>새 방을 만들거나 받은 코드를 입력하세요.</p></div><div className="friend-actions"><button className="friend-card" onClick={create}><span>＋</span><b>새 방 만들기</b><small>내가 방장이 되어 설정하기</small></button><div className="join-box"><label>친구 방 코드</label><div><input value={joinCode} maxLength={6} placeholder="ABC123" onChange={(e) => setJoinCode(e.target.value.toUpperCase())}/><button onClick={join}>입장</button></div></div>{error && <p className="error">{error}</p>}</div></section>;

  const host = room.hostId === playerId; const me = room.players.find((p) => p.id === playerId);
  const updateSettings = (next: RoomSettings) => { setSettings(next); socket.emit("room:update", next); };
  const share = async () => { await navigator.clipboard.writeText(`${location.origin}/friendly/${room.code}`); setCopied(true); setTimeout(() => setCopied(false), 1600); };
  return <section className="room-page"><div className="room-top"><div><p className="eyebrow">WAITING ROOM</p><h1>친선전 대기방</h1></div><button className="code-chip" onClick={share}><small>방 코드</small><b>{room.code}</b><span>{copied ? "복사됨!" : "링크 복사"}</span></button></div>
    <div className="room-layout"><div className="settings-card room-settings"><h2>방 설정</h2><label>인원</label><Segmented value={settings.playerCount} onChange={(n) => host && updateSettings({...settings,playerCount:n})} values={[2,3,4].map(n=>({value:n as 2|3|4,label:`${n}인`}))}/><label>룰</label><div className="rule-list compact">{rules.map(r=><button key={r.id} disabled={!host} className={settings.rule===r.id?"selected":""} onClick={()=>updateSettings({...settings,rule:r.id})}><span>{settings.rule===r.id?"●":"○"}</span><div><b>{r.label}</b><small>{r.desc}</small></div></button>)}</div>{!host&&<p className="soft-note">방장만 설정을 바꿀 수 있어요.</p>}</div>
      <div className="players-card"><h2>참가자 <span>{room.players.length}/{room.settings.playerCount}</span></h2><div className="player-list">{Array.from({length:room.settings.playerCount},(_,i)=>{const p=room.players[i]; return p?<div className="lobby-player" key={p.id}><span className={p.connected?"avatar online":"avatar"}>{p.nickname[0]}</span><div><b>{p.nickname}{p.id===room.hostId&&<em>방장</em>}</b><small>{p.ready?"준비 완료":"대기 중"}</small></div><i className={p.ready?"ready":""}>{p.ready?"✓":"…"}</i></div>:<div className="lobby-player empty" key={i}><span>＋</span><small>친구를 기다리는 중</small></div>})}</div><button className={me?.ready?"secondary wide":"primary wide"} onClick={()=>socket.emit("room:ready",!me?.ready)}>{me?.ready?"준비 취소":"준비 완료"}</button><p className="room-hint">모든 자리가 차고 전원이 준비하면 시작합니다.</p></div>
    </div></section>;
}
