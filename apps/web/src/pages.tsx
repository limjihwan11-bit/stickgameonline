import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { normalizeRuleSet, type Difficulty, type LeaderboardEntry, type RoomSettings, type RoomState, type RuleId } from "@stickgame/shared";
import { useSession } from "./session";
import { rules, Segmented } from "./ui";

export function HomePage() {
  const { nickname, setNickname, connected, user } = useSession(); const [draft, setDraft] = useState(nickname); const navigate = useNavigate();
  const [showTutorial, setShowTutorial] = useState(() => localStorage.getItem("stick-tutorial-done") !== "true");
  useEffect(() => { if (nickname && !draft) setDraft(nickname); }, [draft, nickname]);
  const enter = (path: string) => { if (!draft.trim()) return; setNickname(draft); navigate(path); };
  const startTutorial = () => enter("/game/ai/local?players=2&rule=classic&rules=classic&difficulty=easy&tutorial=1");
  const hideTutorial = () => { localStorage.setItem("stick-tutorial-done", "true"); setShowTutorial(false); };
  return <div className="home-page home-page-simple">
    <section className="entry-panel">
      <label className="nickname-field"><span>게스트 닉네임</span><input value={draft} maxLength={12} placeholder="이름을 입력하세요" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enter("/queue?players=2&rule=classic")} /></label>
      <div className="connection"><i className={connected ? "online" : ""}/>{connected ? "매칭 서버 연결됨" : "서버 연결 중…"}</div>
      {showTutorial && <div className="tutorial-entry"><div><b>처음이면 여기부터</b><small>컴퓨터랑 한 판 하면서 손을 끌고 공격하는 법을 알려줄게요.</small></div><button className="primary" onClick={startTutorial}>튜토리얼 시작</button><button className="secondary" onClick={hideTutorial}>괜찮아요</button></div>}
      <div className="mode-grid">
        <button className="mode-card featured" onClick={() => enter("/queue?players=2&rule=classic")}><span className="mode-number">01</span><b>랜덤 시작</b><small>클래식 · 2인전</small><i>→</i></button>
        <button className="mode-card" onClick={() => enter("/setup/ai")}><span className="mode-number">02</span><b>컴퓨터 대전</b><small>난이도와 인원 선택</small><i>→</i></button>
        <button className="mode-card" onClick={() => enter("/friendly")}><span className="mode-number">03</span><b>친선전</b><small>방을 만들고 친구 초대</small><i>→</i></button>
        <button className="mode-card" onClick={() => enter("/setup/custom")}><span className="mode-number">04</span><b>모드 선택</b><small>원하는 조건으로 공개 매칭</small><i>→</i></button>
      </div>
      <div className="home-sub-actions">
        <button className="secondary" onClick={() => navigate("/leaderboard")}>랭킹 보기</button>
        <small>{user ? `${user.nickname} · ${user.elo}점으로 랭크 매칭 가능` : "로그인하면 랜덤 시작과 모드 선택이 랭킹에 기록돼요."}</small>
      </div>
    </section>
  </div>;
}

const makeSettings = (playerCount: 2|3|4, selectedRules: readonly RuleId[]): RoomSettings => {
  const normalized = normalizeRuleSet(selectedRules);
  return { playerCount, rule: normalized[0], rules: normalized };
};

const toggleRule = (selectedRules: readonly RuleId[], rule: RuleId): RuleId[] =>
  normalizeRuleSet(selectedRules.includes(rule) ? selectedRules.filter((item) => item !== rule) : [...selectedRules, rule]);

const ruleQuery = (selectedRules: readonly RuleId[]) => normalizeRuleSet(selectedRules).join(",");
const ruleLabel = (selectedRules: readonly RuleId[]) => normalizeRuleSet(selectedRules).map((id) => rules.find((rule) => rule.id === id)?.label ?? id).join(" + ");

function searchRules(params: URLSearchParams): RuleId[] {
  const raw = params.get("rules")?.split(",") ?? [params.get("rule") || "classic"];
  return normalizeRuleSet(raw.filter((value): value is RuleId => rules.some((rule) => rule.id === value)));
}

export function SetupPage() {
  const { kind } = useParams(); const { nickname } = useSession(); const navigate = useNavigate();
  const [playerCount, setPlayerCount] = useState<2|3|4>(2); const [selectedRules, setSelectedRules] = useState<RuleId[]>(["classic"]); const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  if (!nickname) return <Navigate to="/" replace />;
  const ai = kind === "ai";
  const selectedRuleQuery = ruleQuery(selectedRules);
  const start = () => ai
    ? navigate(`/game/ai/local?players=${playerCount}&rule=${selectedRules[0]}&rules=${selectedRuleQuery}&difficulty=${difficulty}`)
    : navigate(`/queue?players=${playerCount}&rule=${selectedRules[0]}&rules=${selectedRuleQuery}`);
  return <section className="setup-page narrow-page"><div className="page-heading"><p className="eyebrow">{ai ? "PLAY WITH AI" : "CUSTOM MATCH"}</p><h1>{ai ? "컴퓨터 대전" : "모드 선택"}</h1><p>{ai ? "난이도와 인원을 고르면 바로 시작합니다." : "같은 조건을 고른 플레이어와 연결합니다."}</p></div>
    <div className="settings-card"><label>참가 인원</label><Segmented value={playerCount} onChange={setPlayerCount} values={[2,3,4].map((n) => ({ value: n as 2|3|4, label: `${n}인` }))}/>
      {ai && <><label>AI 난이도</label><Segmented value={difficulty} onChange={setDifficulty} values={[{value:"easy",label:"하"},{value:"medium",label:"중"},{value:"hard",label:"상"}]}/></>}
      <label>게임 룰 <small>여러 개 선택 가능</small></label><div className="rule-list">{rules.map((item) => {
        const selected = selectedRules.includes(item.id);
        return <button key={item.id} className={selected ? "selected" : ""} onClick={() => setSelectedRules((current) => toggleRule(current, item.id))}><span>{selected ? "☑" : "☐"}</span><div><b>{item.label}</b><small>{item.desc}</small></div></button>;
      })}</div>
      <button className="primary wide" onClick={start}>{ai ? "AI 대전 시작" : "이 조건으로 매칭"}</button>
    </div></section>;
}

export function QueuePage() {
  const { nickname, socket, registered, user } = useSession(); const [params] = useSearchParams(); const navigate = useNavigate();
  const playerCount = Math.min(4, Math.max(2, Number(params.get("players")))) as 2|3|4; const selectedRules = searchRules(params);
  const selectedRuleKey = selectedRules.join(",");
  const [count, setCount] = useState(1); const [elapsed, setElapsed] = useState(0); const [error, setError] = useState("");
  useEffect(() => {
    if (!registered) return;
    const found = ({ gameId }: { gameId: string }) => navigate(`/game/online/${gameId}`);
    const state = ({ count: waitingCount }: { waiting: boolean; count: number }) => setCount(waitingCount);
    socket.on("match:found", found); socket.on("queue:state", state);
    socket.emit("queue:join", { settings: makeSettings(playerCount, selectedRules) }, (result) => !result.ok && setError(result.error || "매칭을 시작하지 못했습니다."));
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => { clearInterval(timer); socket.emit("queue:leave"); socket.off("match:found", found); socket.off("queue:state", state); };
  }, [navigate, playerCount, registered, selectedRuleKey, socket]);
  if (!nickname) return <Navigate to="/" replace />;
  const ruleName = ruleLabel(selectedRules);
  return <section className="waiting-page"><div className="radar"><span/><span/><span/><b>✌</b></div><p className="eyebrow">FINDING PLAYERS</p><h1>상대를 찾고 있어요</h1><p className="waiting-copy">{ruleName} · {playerCount}인전 · 현재 {count}/{playerCount}명</p><p className={user ? "ranked-note ranked" : "ranked-note"}>{user ? `랭크 매칭 · 현재 ${user.elo}점` : "게스트는 비랭크로 플레이됩니다. 랭킹에 기록하려면 로그인하세요."}</p><div className="waiting-time">{String(Math.floor(elapsed/60)).padStart(2,"0")}:{String(elapsed%60).padStart(2,"0")}</div>{error && <p className="error">{error}</p>}<button className="secondary" onClick={() => navigate("/")}>매칭 취소</button></section>;
}

export function AuthPage() {
  const { mode } = useParams();
  const authMode = mode === "register" ? "register" : "login";
  const { login, register } = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const title = authMode === "register" ? "회원가입" : "로그인";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(""); setBusy(true);
    try {
      if (authMode === "register") await register(username, nickname || username, password);
      else await login(username, password);
      navigate("/");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `${title}에 실패했습니다.`);
    } finally {
      setBusy(false);
    }
  };
  return <section className="auth-page narrow-page">
    <div className="page-heading"><p className="eyebrow">ACCOUNT</p><h1>{title}</h1><p>랭킹과 승률을 기록하려면 계정으로 플레이하세요.</p></div>
    <form className="auth-card" onSubmit={submit}>
      <label>아이디<input value={username} autoComplete="username" placeholder="영문/숫자 3자 이상" onChange={(event) => setUsername(event.target.value)} /></label>
      {authMode === "register" && <label>닉네임<input value={nickname} maxLength={12} autoComplete="nickname" placeholder="게임에서 보일 이름" onChange={(event) => setNickname(event.target.value)} /></label>}
      <label>비밀번호<input value={password} type="password" autoComplete={authMode === "register" ? "new-password" : "current-password"} placeholder="4자 이상" onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <button className="primary wide" disabled={busy}>{busy ? "처리 중…" : title}</button>
      <p className="auth-switch">{authMode === "register" ? "이미 계정이 있나요?" : "처음이라면?"} <Link to={authMode === "register" ? "/auth/login" : "/auth/register"}>{authMode === "register" ? "로그인" : "회원가입"}</Link></p>
    </form>
  </section>;
}

export function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/leaderboard").then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "랭킹을 불러오지 못했습니다.");
      setEntries(data.entries || []);
    }).catch((nextError) => setError(nextError instanceof Error ? nextError.message : "랭킹을 불러오지 못했습니다.")).finally(() => setLoading(false));
  }, []);
  return <section className="leaderboard-page narrow-page">
    <div className="page-heading"><p className="eyebrow">LEADERBOARD</p><h1>랭킹</h1><p>랜덤 시작과 모드 선택 공개 매칭만 기록됩니다.</p></div>
    <div className="leaderboard-card">
      {loading && <p className="soft-note">랭킹 불러오는 중…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && entries.length === 0 && <p className="soft-note">아직 랭크 기록이 없어요. 로그인하고 공개 매칭을 시작해보세요.</p>}
      {entries.length > 0 && <table className="leaderboard-table"><thead><tr><th>순위</th><th>닉네임</th><th>ELO</th><th>승/패</th><th>승률</th><th>연승</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>#{entry.rank}</td><td>{entry.nickname}</td><td><b>{entry.elo}</b></td><td>{entry.wins}승 {entry.losses}패</td><td>{entry.winRate}%</td><td>{entry.streak}연승</td></tr>)}</tbody></table>}
    </div>
  </section>;
}

export function FriendlyPage() {
  const { code: urlCode } = useParams(); const { nickname, playerId, socket, registered } = useSession(); const navigate = useNavigate();
  const [room, setRoom] = useState<RoomState|null>(null); const [joinCode, setJoinCode] = useState(urlCode || ""); const [error, setError] = useState(""); const [copied, setCopied] = useState(false);
  const [settings, setSettings] = useState<RoomSettings>(makeSettings(2, ["classic"]));
  useEffect(() => {
    const update = (next: RoomState) => { setRoom(next); setSettings(makeSettings(next.settings.playerCount, normalizeRuleSet(next.settings.rules ?? next.settings.rule))); if (next.gameId) navigate(`/game/online/${next.gameId}`); };
    const found = ({ gameId }: { gameId: string }) => navigate(`/game/online/${gameId}`);
    socket.on("room:state", update); socket.on("match:found", found);
    if (urlCode && nickname && registered) socket.emit("room:join", { code: urlCode }, (r) => !r.ok && setError(r.error || "방 참가 실패"));
    return () => { socket.off("room:state", update); socket.off("match:found", found); };
  }, [navigate, nickname, registered, socket, urlCode]);
  if (!nickname) return <Navigate to="/" replace />;
  const resetRoomView = () => { setRoom(null); setSettings(makeSettings(2, ["classic"])); setJoinCode(""); setCopied(false); };
  const create = () => { setError(""); socket.emit("room:create", { settings }, (r) => r.ok && r.code ? navigate(`/friendly/${r.code}`) : setError(r.error || "방 생성 실패")); };
  const join = () => { setError(""); socket.emit("room:join", { code: joinCode }, (r) => r.ok && r.code ? navigate(`/friendly/${r.code}`) : setError(r.error || "방 참가 실패")); };
  if (!room) return <section className="narrow-page friendly-entry"><div className="page-heading"><p className="eyebrow">FRIENDLY MATCH</p><h1>친구와 함께</h1><p>새 방을 만들거나 받은 코드를 입력하세요.</p></div><div className="friend-actions"><button className="friend-card" onClick={create}><span>＋</span><b>새 방 만들기</b><small>내가 방장이 되어 설정하기</small></button><div className="join-box"><label>친구 방 코드</label><div><input value={joinCode} maxLength={6} placeholder="ABC123" onChange={(e) => setJoinCode(e.target.value.toUpperCase())}/><button onClick={join}>입장</button></div></div>{error && <p className="error">{error}</p>}</div></section>;

  const host = room.hostId === playerId; const me = room.players.find((p) => p.id === playerId);
  const updateSettings = (next: RoomSettings) => { setSettings(next); socket.emit("room:update", next); };
  const roomRules = normalizeRuleSet(settings.rules ?? settings.rule);
  const updateRules = (rule: RuleId) => { if (!host) return; updateSettings(makeSettings(settings.playerCount, toggleRule(roomRules, rule))); };
  const share = async () => { await navigator.clipboard.writeText(`${location.origin}/friendly/${room.code}`); setCopied(true); setTimeout(() => setCopied(false), 1600); };
  const leave = () => socket.emit("room:leave", (result) => { if (!result.ok) setError(result.error || "방을 나가지 못했습니다."); resetRoomView(); navigate("/friendly", { replace: true }); });
  return <section className="room-page"><div className="room-top"><div><p className="eyebrow">WAITING ROOM</p><h1>친선전 대기방</h1></div><div className="room-actions"><button className="secondary" onClick={leave}>← 방 나가기</button><button className="code-chip" onClick={share}><small>방 코드</small><b>{room.code}</b><span>{copied ? "복사됨!" : "링크 복사"}</span></button></div></div>
    <div className="room-layout"><div className="settings-card room-settings"><h2>방 설정</h2><label>인원</label><Segmented value={settings.playerCount} onChange={(n) => host && updateSettings(makeSettings(n, roomRules))} values={[2,3,4].map(n=>({value:n as 2|3|4,label:`${n}인`}))}/><label>룰 <small>여러 개 선택 가능</small></label><div className="rule-list compact">{rules.map(r=>{const selected=roomRules.includes(r.id); return <button key={r.id} disabled={!host} className={selected?"selected":""} onClick={()=>updateRules(r.id)}><span>{selected?"☑":"☐"}</span><div><b>{r.label}</b><small>{r.desc}</small></div></button>;})}</div>{!host&&<p className="soft-note">방장만 설정을 바꿀 수 있어요.</p>}</div>
      <div className="players-card"><h2>참가자 <span>{room.players.length}/{room.settings.playerCount}</span></h2><div className="player-list">{Array.from({length:room.settings.playerCount},(_,i)=>{const p=room.players[i]; return p?<div className="lobby-player" key={p.id}><span className={p.connected?"avatar online":"avatar"}>{p.nickname[0]}</span><div><b>{p.nickname}{p.id===room.hostId&&<em>방장</em>}</b><small>{p.ready?"준비 완료":"대기 중"}</small></div><i className={p.ready?"ready":""}>{p.ready?"✓":"…"}</i></div>:<div className="lobby-player empty" key={i}><span>＋</span><small>친구를 기다리는 중</small></div>})}</div><button className={me?.ready?"secondary wide":"primary wide"} onClick={()=>socket.emit("room:ready",!me?.ready)}>{me?.ready?"준비 취소":"준비 완료"}</button><p className="room-hint">모든 자리가 차고 전원이 준비하면 시작합니다.</p></div>
    </div></section>;
}
