import { type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "./session";

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { nickname, setNickname, user, logout } = useSession();
  const startTutorial = () => {
    const tutorialName = nickname || user?.nickname || "연습생";
    localStorage.removeItem("stick-tutorial-done");
    if (!nickname) setNickname(tutorialName);
    navigate("/game/ai/local?players=2&rule=classic&rules=classic&difficulty=easy&tutorial=1");
  };
  return <div className="app-shell">
    <header className="topbar">
      <Link className="brand" to="/"><span>🥢</span>젓가락 온라인</Link>
      <div className="top-actions">
        <i className="live-dot" />
        {location.pathname !== "/" && <Link to="/">홈</Link>}
        <Link to="/leaderboard">랭킹</Link>
        {user ? <div className="auth-chip"><span>{user.nickname}</span><b>{user.elo}</b><button className="link-button" onClick={logout}>로그아웃</button></div> : <>
          <Link to="/auth/login">로그인</Link>
          <Link to="/auth/register">회원가입</Link>
        </>}
        <button className="link-button" onClick={startTutorial}>게임 방법</button>
      </div>
    </header>
    <main>{children}</main>
  </div>;
}

export const rules = [
  { id: "classic", label: "클래식", desc: "5 이상이면 해당 손이 0" },
  { id: "no-repeat", label: "반복 금지", desc: "직전 전체 손 상태 재현 금지" },
  { id: "no-opening-split", label: "초반 분열 금지", desc: "각 플레이어의 첫 턴에는 분열 불가" },
  { id: "rollover", label: "5 초과 반복", desc: "5를 넘기면 나머지로 계속" },
  { id: "items", label: "아이템전", desc: "미션을 깨서 랜덤 아이템을 얻고 원하는 때 사용" }
] as const;

export function Segmented<T extends string | number>({ values, value, onChange }: { values: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
  return <div className="segmented">{values.map((item) => <button key={item.value} className={value === item.value ? "active" : ""} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>;
}
