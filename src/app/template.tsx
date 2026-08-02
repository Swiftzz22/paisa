/**
 * A template re-mounts on every navigation (unlike layout, which persists), so
 * wrapping children in `.page-enter` replays the fade-and-rise transition each
 * time the route changes — the little bit of motion that makes navigation feel
 * native rather than like a full page reload.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
