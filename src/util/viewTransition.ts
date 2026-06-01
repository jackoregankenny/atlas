import { flushSync } from "react-dom";

type StartFn = (cb: () => void) => { finished: Promise<void> };

export function withViewTransition(cb: () => void) {
  const doc = document as Document & { startViewTransition?: StartFn };
  if (doc.startViewTransition) {
    doc.startViewTransition(() => {
      flushSync(cb);
    });
  } else {
    cb();
  }
}
