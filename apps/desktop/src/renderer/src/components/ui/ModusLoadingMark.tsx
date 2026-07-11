export function ModusLoadingMark() {
  return <div aria-label="Loading Modus" className="modus-loading-mark" role="img" />;
}

export function ModusLoadingFallback() {
  return (
    <div className="modus-loading-fallback flex h-full min-h-0 min-w-0 flex-1 items-center justify-center">
      <ModusLoadingMark />
    </div>
  );
}
