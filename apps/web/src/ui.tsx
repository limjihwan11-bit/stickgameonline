import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSession } from "./session";

export function AppShell({ children }: { children: ReactNode }) {
  const [help, setHelp] = useState(false);
  const location = useLocation();
  const { user, logout } = useSession();
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
        <button className="link-button" onClick={() => setHelp(true)}>게임 방법</button>
      </div>
    </header>
    <main>{children}</main>
    {help && <div className="modal-backdrop" onMouseDown={() => setHelp(false)}>
      <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={() => setHelp(false)}>×</button>
        <p className="eyebrow">HOW TO PLAY</p>
        <h2>상대 손을 모두 0으로 만들면 승리!</h2>
        <ol>
          <li>내 손 하나를 골라 상대 손을 공격합니다.</li>
          <li>내 손 숫자가 상대 손에 더해지고, 5 이상이면 그 손은 0이 됩니다.</li>
          <li>양손 합을 유지하는 다른 조합으로 분열할 수 있습니다.</li>
          <li>랭킹은 로그인 후 랜덤 시작/모드 선택 공개 매칭에서만 기록됩니다.</li>
        </ol>
        <p className="soft-note">카메라는 영상 대신 손 숫자와 위치만 게임 입력으로 사용합니다. 영상은 서버로 보내지 않아요.</p>
      </section>
    </div>}
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
