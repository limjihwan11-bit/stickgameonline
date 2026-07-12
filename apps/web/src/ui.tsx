import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

export function AppShell({ children }: { children: ReactNode }) {
  const [help, setHelp] = useState(false); const location = useLocation();
  return <div className="app-shell">
    <header className="topbar"><Link className="brand" to="/"><span>✌</span>젓가락 온라인</Link><div className="top-actions"><i className="live-dot" />{location.pathname !== "/" && <Link to="/">홈</Link>}<button className="link-button" onClick={() => setHelp(true)}>게임 방법</button></div></header>
    <main>{children}</main>
    {help && <div className="modal-backdrop" onMouseDown={() => setHelp(false)}><section className="modal" onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setHelp(false)}>×</button><p className="eyebrow">HOW TO PLAY</p><h2>5를 만들면 그 손은 아웃!</h2><ol><li>내 손 하나를 골라 상대의 살아 있는 손을 공격합니다.</li><li>상대 손에는 두 손의 숫자를 더한 결과가 적용됩니다.</li><li>두 손의 합을 유지하며 다른 조합으로 분열할 수 있습니다.</li><li>상대의 두 손을 모두 0으로 만들면 승리합니다.</li></ol><p className="soft-note">카메라에서는 게임 숫자만큼 손가락을 펴고 상대 손 카드로 움직여 보세요.</p></section></div>}
  </div>;
}

export const rules = [
  { id: "classic", label: "클래식", desc: "5 이상이면 해당 손 아웃" },
  { id: "no-repeat", label: "반복 금지", desc: "한 수 전 상태 재현 금지" },
  { id: "no-opening-split", label: "초반 분열 금지", desc: "첫 턴에는 분열 불가" },
  { id: "rollover", label: "5 초과 반복", desc: "5를 뺀 나머지로 계속" },
  { id: "items", label: "아이템전", desc: "매 턴 랜덤 아이템이 터지는 난장판 모드" }
] as const;

export function Segmented<T extends string | number>({ values, value, onChange }: { values: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
  return <div className="segmented">{values.map((item) => <button key={item.value} className={value === item.value ? "active" : ""} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>;
}
