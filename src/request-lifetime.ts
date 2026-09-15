// Cancellation stops waiting work. Once dispatched, retain the worker/locks until
// its real result arrives: cancelling a promise cannot undo a file or shell action.
export class RequestLifetime {
  private readonly controller = new AbortController();
  started = false;
  constructor(private readonly deadline = Number.POSITIVE_INFINITY) {}
  get signal() {
    return this.controller.signal;
  }
  cancel(): void {
    this.controller.abort(this.error());
  }
  error(): Error {
    const error = new Error(
      this.started
        ? 'DWB_OUTCOME_PENDING: the request was dispatched and may still be running. Inspect its result/files/processes before retrying; it was not cancelled or replayed.'
        : 'DWB_REQUEST_CANCELLED: the request expired or disconnected before dispatch; the tool was not executed.',
    );
    error.name = this.started ? 'DWB_OUTCOME_PENDING' : 'DWB_REQUEST_CANCELLED';
    return error;
  }
  check(): void {
    if (Date.now() >= this.deadline && !this.signal.aborted) this.cancel();
    this.signal.throwIfAborted();
  }
  begin(): void {
    this.check();
    this.started = true;
  }
  async wait<T>(promise: Promise<T>): Promise<T> {
    if (this.signal.aborted) {
      void promise.catch(() => {});
      throw this.signal.reason;
    }
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(this.signal.reason);
      this.signal.addEventListener('abort', abort, { once: true });
      promise.then(resolve, reject).finally(() => this.signal.removeEventListener('abort', abort));
    });
  }
}
