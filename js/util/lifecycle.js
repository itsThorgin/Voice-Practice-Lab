export function createCleanupStack() {
  const cleanups = [];
  let disposed = false;

  return Object.freeze({
    add(cleanup) {
      if (disposed) {
        throw new Error("Cannot add cleanup work after disposal.");
      }
      if (typeof cleanup !== "function") {
        throw new TypeError("Cleanup work must be a function.");
      }

      cleanups.push(cleanup);
      return cleanup;
    },

    async dispose() {
      if (disposed) {
        return [];
      }

      disposed = true;
      const pending = [];
      const errors = [];

      for (const cleanup of cleanups.reverse()) {
        try {
          pending.push(Promise.resolve(cleanup()));
        } catch (error) {
          errors.push(error);
        }
      }

      const results = await Promise.allSettled(pending);
      for (const result of results) {
        if (result.status === "rejected") {
          errors.push(result.reason);
        }
      }

      return errors;
    },
  });
}
