/**
 * Width-stable skip for PDF fit-to-width re-paints.
 * `lastFitWidth === 0` means no completed paint yet — never skip.
 * Default epsilon (24) absorbs typical scrollbar gutter deltas when
 * `scrollbar-gutter: stable` is unavailable.
 */
export function shouldSkipPdfRefit(lastFitWidth: number, fitWidth: number, epsilon = 24): boolean {
  return lastFitWidth > 0 && Math.abs(fitWidth - lastFitWidth) < epsilon;
}
