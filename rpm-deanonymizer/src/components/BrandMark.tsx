export default function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="clarityGrad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#6d28d9" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#clarityGrad)" />
      <line x1="16" y1="6" x2="16" y2="26" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="6" y1="16" x2="26" y2="16" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="21" cy="11" r="3.4" fill="#fff" />
      <circle cx="11" cy="21" r="2" fill="#fff" fillOpacity="0.55" />
    </svg>
  );
}
