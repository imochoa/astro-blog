<script lang="ts">
  import { onMount } from "svelte";
  import type { Output } from "nix-eval";

  const examples = [
    {
      id: "functions",
      label: "Functions and lists",
      source: `let
  square = number: number * number;
in
  map square [ 1 2 3 4 ]`,
    },
    {
      id: "attributes",
      label: "Attribute sets",
      source: `let
  person = {
    name = "Ada";
    language = "Nix";
  };
in
  person // { greeting = "Hello, \${person.name}!"; }`,
    },
    {
      id: "builtins",
      label: "Built-in functions",
      source: `builtins.filter
  (number: number > 5)
  (builtins.genList (number: number + 1) 10)`,
    },
  ] as const;

  type WorkerMessage =
    | { type: "ready" }
    | { type: "result"; id: number; result: Output }
    | { type: "failure"; id?: number; message: string };

  let selectedExample = $state(examples[0].id as string);
  let source = $state(examples[0].source as string);
  let output = $state("");
  let errors = $state("");
  let warnings = $state("");
  let ast = $state("");
  let bytecode = $state("");
  let trace = $state("");
  let status = $state("The 3.3 MB evaluator loads after you press Run.");
  let busy = $state(false);

  let worker: Worker | undefined;
  let readyPromise: Promise<void> | undefined;
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((reason: Error) => void) | undefined;
  let resolveEvaluation: ((result: Output) => void) | undefined;
  let rejectEvaluation: ((reason: Error) => void) | undefined;
  let activeRequest = 0;
  let evaluationTimer: ReturnType<typeof setTimeout> | undefined;

  function clearEvaluation() {
    if (evaluationTimer) clearTimeout(evaluationTimer);
    evaluationTimer = undefined;
    resolveEvaluation = undefined;
    rejectEvaluation = undefined;
  }

  function stopWorker() {
    worker?.terminate();
    worker = undefined;
    readyPromise = undefined;
    resolveReady = undefined;
    rejectReady = undefined;
    clearEvaluation();
  }

  function failWorker(message: string) {
    const error = new Error(message);
    rejectReady?.(error);
    rejectEvaluation?.(error);
    stopWorker();
  }

  function startWorker() {
    if (worker && readyPromise) return readyPromise;

    status = "Loading Tvix and compiling WebAssembly...";
    worker = new Worker(new URL("./NixPlayground.worker.ts", import.meta.url), {
      type: "module",
    });

    readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;

      if (message.type === "ready") {
        resolveReady?.();
        resolveReady = undefined;
        rejectReady = undefined;
        return;
      }

      if (message.type === "result" && message.id === activeRequest) {
        const resolve = resolveEvaluation;
        clearEvaluation();
        resolve?.(message.result);
        return;
      }

      if (message.type === "failure") failWorker(message.message);
    });

    worker.addEventListener("error", (event) => {
      event.preventDefault();
      failWorker(event.message || "The evaluator worker stopped unexpectedly");
    });

    return readyPromise;
  }

  function loadExample() {
    const example = examples.find((item) => item.id === selectedExample);
    if (example) source = example.source;
  }

  async function evaluate() {
    if (busy) return;

    busy = true;
    output = "";
    errors = "";
    warnings = "";
    ast = "";
    bytecode = "";
    trace = "";

    try {
      await startWorker();
      status = "Evaluating...";
      activeRequest += 1;

      const resultPromise = new Promise<Output>((resolve, reject) => {
        resolveEvaluation = resolve;
        rejectEvaluation = reject;
        evaluationTimer = setTimeout(() => {
          const timeoutError = new Error(
            "Evaluation exceeded three seconds, so the worker was restarted.",
          );
          reject(timeoutError);
          stopWorker();
        }, 3_000);
      });

      worker?.postMessage({
        type: "evaluate",
        id: activeRequest,
        source,
      });

      const result = await resultPromise;
      output = result.output;
      errors = result.errors;
      warnings = result.warnings;
      ast = result.ast;
      bytecode = result.bytecode;
      trace = result.trace;
      status = result.errors ? "Nix returned an error." : "Done.";
    } catch (error: unknown) {
      errors = error instanceof Error ? error.message : "Evaluation failed";
      status = "Could not evaluate this expression.";
    } finally {
      busy = false;
    }
  }

  function handleEditorKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void evaluate();
    }
  }

  onMount(() => stopWorker);
</script>

<section class="playground" aria-labelledby="nix-playground-title">
  <div class="heading">
    <div>
      <h2 id="nix-playground-title">Nix expression playground</h2>
      <p>
        Runs locally with Tvix. Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to evaluate.
      </p>
    </div>

    <label>
      Example
      <select bind:value={selectedExample} onchange={loadExample}>
        {#each examples as example (example.id)}
          <option value={example.id}>{example.label}</option>
        {/each}
      </select>
    </label>
  </div>

  <label class="editor-label" for="nix-source">Nix source</label>
  <textarea
    id="nix-source"
    bind:value={source}
    onkeydown={handleEditorKeydown}
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"></textarea>

  <div class="actions">
    <button type="button" onclick={evaluate} disabled={busy}>
      {busy ? "Running..." : "Run"}
    </button>
    <span class="status" role="status" aria-live="polite">{status}</span>
  </div>

  <div class="result" aria-live="polite">
    {#if errors}
      <div class="diagnostic error">
        <strong>Error</strong>
        <pre>{errors}</pre>
      </div>
    {/if}

    {#if warnings}
      <div class="diagnostic warning">
        <strong>Warnings</strong>
        <pre>{warnings}</pre>
      </div>
    {/if}

    {#if output}
      <div class="output">
        <strong>Result</strong>
        <pre>{output}</pre>
      </div>
    {/if}

    {#if ast || bytecode || trace}
      <details>
        <summary>Evaluator internals</summary>
        {#if ast}
          <h3>Parsed expression</h3>
          <pre>{ast}</pre>
        {/if}
        {#if bytecode}
          <h3>Bytecode</h3>
          <pre>{bytecode}</pre>
        {/if}
        {#if trace}
          <h3>Runtime trace</h3>
          <pre>{trace}</pre>
        {/if}
      </details>
    {/if}
  </div>
</section>

<style>
  .playground {
    display: grid;
    gap: var(--space-md);
    padding: var(--space-md);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .heading {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-md);
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    font-size: 1.25rem;
  }

  h3 {
    margin-top: var(--space-md);
    font-size: 1rem;
  }

  p,
  .status {
    color: var(--color-muted);
    font-size: 0.85rem;
  }

  kbd {
    padding: 0.08rem 0.3rem;
    border: 1px solid var(--color-border);
    border-bottom-width: 2px;
    border-radius: 0.2rem;
    background: var(--color-background);
    font-family: var(--font-mono);
  }

  label {
    display: grid;
    gap: 0.25rem;
    color: var(--color-muted);
    font-size: 0.85rem;
    font-weight: 700;
  }

  .editor-label {
    margin-bottom: calc(var(--space-md) * -1 + 0.25rem);
  }

  select,
  textarea,
  button {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }

  select,
  textarea {
    color: var(--color-text);
    background: var(--color-background);
  }

  select {
    min-height: 2.25rem;
    padding-inline: var(--space-sm);
  }

  textarea {
    width: 100%;
    min-height: 13rem;
    padding: var(--space-md);
    resize: vertical;
    tab-size: 2;
    font-family: var(--font-mono);
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
  }

  button {
    min-width: 6rem;
    min-height: 2.5rem;
    padding: 0.45rem var(--space-md);
    color: var(--color-on-accent);
    background: var(--color-accent);
    font-weight: 700;
    cursor: pointer;
  }

  button:disabled {
    cursor: wait;
    opacity: 0.65;
  }

  .result:empty {
    display: none;
  }

  .diagnostic,
  .output,
  details {
    margin-top: var(--space-sm);
    padding: var(--space-md);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-background);
  }

  .error {
    border-left: 0.3rem solid #c64242;
  }

  .warning {
    border-left: 0.3rem solid #b17a16;
  }

  pre {
    max-height: 24rem;
    overflow: auto;
    margin: var(--space-xs) 0 0;
    padding: var(--space-sm);
    border-radius: var(--radius);
    color: #f4f7f6;
    background: #17201d;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    line-height: 1.45;
    white-space: pre-wrap;
  }

  summary {
    cursor: pointer;
    font-weight: 700;
  }

  @media (max-width: 36rem) {
    .heading,
    .heading label,
    select {
      width: 100%;
    }
  }
</style>
