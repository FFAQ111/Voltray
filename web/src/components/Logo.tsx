// Voltray brand mark: a top-down electric-ray silhouette with a lightning bolt
// knocked out of the body (fill-rule evenodd). Single-path, themeable via currentColor —
// the same inline-SVG approach as the GitHub mark, so it scales crisply at any size.
export function VoltrayMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden
      className={className}
    >
      {/* ray disc + swept wings + tail, with the bolt as an evenodd cutout */}
      <path d="M12 3.2c1.7 0 3 1.4 3.7 3.4.8 2.4 3 4 6 5.2.6.2.6 1 0 1.3-2.4 1-4.3 2-5.5 3.4l-1.4 4.7c-.3 1-1.3 1-1.6 0L11.8 16c-1.2-1.4-3.1-2.4-5.5-3.4-.6-.3-.6-1.1 0-1.3 3-1.2 5.2-2.8 6-5.2.7-2 2-3.4 3.7-3.4Zm.7 4.6-2.3 5.1h1.6l-.7 3.4 2.6-4.5h-1.7l1.2-4h-.7Z" />
    </svg>
  );
}
