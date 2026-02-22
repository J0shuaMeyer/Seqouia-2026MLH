/**
 * Minimalist Sequoia brand mark — three ascending vertical bars.
 * Reads as both sequoia trees and an activity bar chart.
 */
export default function SequoiaLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 13 20"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Sequoia logo"
    >
      <rect x="0.5" y="13" width="1.2" height="7" rx="0.5" />
      <rect x="5.4" y="7" width="1.2" height="13" rx="0.5" />
      <rect x="10.3" y="2" width="1.2" height="18" rx="0.5" />
    </svg>
  );
}
