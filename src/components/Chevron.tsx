export default function Chevron({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="card-chevron">
      <path d="M11 6l10 10-10 10" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
      <path d="M18 6l10 10-10 10" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
    </svg>
  )
}
