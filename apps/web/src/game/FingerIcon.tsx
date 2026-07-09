interface FingerIconProps {
  value: number;
  className?: string;
}

const fingerEmoji = ["✊", "☝️", "✌️", "🤟", "🖖", "🖐️"];

const clampFingerValue = (value: number) => Math.min(5, Math.max(0, Math.round(value)));

export function FingerIcon({ value, className = "" }: FingerIconProps) {
  const iconValue = clampFingerValue(value);
  return <span className={["finger-icon", "finger-icon-emoji", `finger-icon-${iconValue}`, className].filter(Boolean).join(" ")} role="img" aria-label={`손가락 ${iconValue}개`}>
    {fingerEmoji[iconValue]}
  </span>;
}
