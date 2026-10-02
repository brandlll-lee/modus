type PendingEntry<Result, Context> = {
  readonly id: string;
  readonly sessionId: string | undefined;
  readonly context: Context;
  resolve(result: Result): void;
  timeout: NodeJS.Timeout | undefined;
};

export class PendingRequestRegistry<Result, Context = undefined> {
  private readonly pending = new Map<string, PendingEntry<Result, Context>>();

  /**
   * Register a blocking request. The returned Promise stays unresolved until
   * `settle`/`cancelAll`/`cancelForSession` is called, or `timeoutMs` elapses
   * (→ `onTimeout(context)`). The timer is unref'd so a parked request never
   * keeps the process alive on its own.
   */
  open(input: {
    id: string;
    sessionId?: string | undefined;
    context: Context;
    timeoutMs?: number | undefined;
    onTimeout: (context: Context) => Result;
  }): Promise<Result> {
    return new Promise<Result>((resolve) => {
      const timeout =
        input.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              const entry = this.pending.get(input.id);
              this.pending.delete(input.id);
              resolve(input.onTimeout(entry?.context ?? input.context));
            }, input.timeoutMs);
      timeout?.unref?.();
      this.pending.set(input.id, {
        id: input.id,
        sessionId: input.sessionId,
        context: input.context,
        resolve,
        timeout,
      });
    });
  }

  /** Resolve one pending request by id with `makeResult(context)`. No-op (undefined) if absent. */
  settle(id: string, makeResult: (context: Context) => Result): Result | undefined {
    const entry = this.pending.get(id);
    if (!entry) {
      return undefined;
    }
    clearTimeout(entry.timeout);
    this.pending.delete(id);
    const result = makeResult(entry.context);
    entry.resolve(result);
    return result;
  }

  /** Resolve every pending request (e.g. window close). */
  cancelAll(makeResult: (context: Context) => Result): void {
    this.cancelWhere(() => true, makeResult);
  }

  /** Resolve every pending request belonging to one session (e.g. session archived/aborted). */
  cancelForSession(sessionId: string, makeResult: (context: Context) => Result): void {
    this.cancelWhere((entry) => entry.sessionId === sessionId, makeResult);
  }

  private cancelWhere(
    predicate: (entry: PendingEntry<Result, Context>) => boolean,
    makeResult: (context: Context) => Result,
  ): void {
    for (const entry of [...this.pending.values()]) {
      if (!predicate(entry)) {
        continue;
      }
      clearTimeout(entry.timeout);
      this.pending.delete(entry.id);
      entry.resolve(makeResult(entry.context));
    }
  }
}
