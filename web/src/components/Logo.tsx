// Voltray brand mark. The logo lives at web/public/logo.svg and is referenced by path, so the
// same file backs both this component and the favicon (see index.html). Keeps the VoltrayMark
// name + className API so existing call sites (App header, Landing) are unchanged.
export function VoltrayMark({ className }: { className?: string }) {
  return <img src="/logo.svg" alt="Voltray" className={className} />;
}
