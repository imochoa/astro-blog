import { createEvaluator } from "nix-eval";

interface EvaluateRequest {
  type: "evaluate";
  id: number;
  source: string;
}

const evaluatorPromise = createEvaluator({ strict: true });

evaluatorPromise
  .then(() => self.postMessage({ type: "ready" }))
  .catch((error: unknown) => {
    self.postMessage({
      type: "failure",
      message: error instanceof Error ? error.message : "Could not load Tvix",
    });
  });

self.addEventListener(
  "message",
  async (event: MessageEvent<EvaluateRequest>) => {
    if (event.data.type !== "evaluate") return;

    try {
      const evaluator = await evaluatorPromise;
      const result = await evaluator.eval(event.data.source, "playground.nix");
      self.postMessage({ type: "result", id: event.data.id, result });
    } catch (error: unknown) {
      self.postMessage({
        type: "failure",
        id: event.data.id,
        message: error instanceof Error ? error.message : "Evaluation failed",
      });
    }
  },
);
