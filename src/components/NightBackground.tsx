/**
 * The Night Ledger backdrop: a drifting rupee-blue glow over a faint grid.
 *
 * Drop it as the first child of an element with the `night` class. The layers
 * are fixed and sit behind everything (z-index −1 inside the isolated `night`
 * root), so the page scrolls over one steady background.
 */
export function NightBackground({ grid = true }: { grid?: boolean }) {
  return (
    <>
      <div className="night-glow" aria-hidden />
      {grid ? <div className="night-grid" aria-hidden /> : null}
    </>
  );
}
