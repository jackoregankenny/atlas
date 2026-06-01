import { enrichBook } from "./api";

export interface EnrichJob {
  total: number;
  done: number;
  matched: number;
  errors: number;
  cancelled: boolean;
}

export interface EnrichHandle {
  cancel: () => void;
  promise: Promise<EnrichJob>;
}

const CONCURRENCY = 4;

export function startEnrichBatch(
  ids: number[],
  onProgress: (job: EnrichJob) => void
): EnrichHandle {
  const job: EnrichJob = {
    total: ids.length,
    done: 0,
    matched: 0,
    errors: 0,
    cancelled: false,
  };
  let cancelled = false;

  const queue = [...ids];

  async function worker() {
    while (!cancelled) {
      const id = queue.shift();
      if (id == null) return;
      try {
        const out = await enrichBook(id);
        if (out.matched) job.matched += 1;
      } catch {
        job.errors += 1;
      }
      job.done += 1;
      onProgress({ ...job });
    }
  }

  const promise = (async () => {
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, ids.length) },
      () => worker()
    );
    await Promise.all(workers);
    if (cancelled) job.cancelled = true;
    onProgress({ ...job });
    return job;
  })();

  return {
    cancel: () => {
      cancelled = true;
    },
    promise,
  };
}
