<script lang="ts">
  import { onMount } from "svelte";
  import type {
    Options as AsciinemaOptions,
    Player as PlayerInstance,
  } from "asciinema-player";
  import "asciinema-player/dist/bundle/asciinema-player.css";

  interface Props {
    src: string;
    title?: string;
    caption?: string;
    downloadName?: string;
    cols?: number;
    rows?: number;
    autoplay?: boolean;
    loop?: boolean | number;
    speed?: number;
    idleTimeLimit?: number;
    theme?: string;
    poster?: string;
    fit?: AsciinemaOptions["fit"];
  }

  let {
    src,
    title = "Terminal session recording",
    caption = "Interactive terminal session recording",
    downloadName = "recording.cast",
    cols,
    rows,
    autoplay = false,
    loop = false,
    speed = 1,
    idleTimeLimit = 2,
    theme = "auto/asciinema",
    poster,
    fit = "width",
  }: Props = $props();

  let container: HTMLDivElement;
  let loading = $state(true);
  let errorMessage = $state("");

  onMount(() => {
    let disposed = false;
    let player: PlayerInstance | undefined;

    void import("asciinema-player")
      .then(({ create }) => {
        if (disposed) return;

        player = create(src, container, {
          autoplay,
          cols,
          controls: true,
          fit,
          idleTimeLimit,
          loop,
          poster,
          preload: false,
          rows,
          speed,
          theme,
        });
        loading = false;
      })
      .catch(() => {
        if (disposed) return;
        loading = false;
        errorMessage = "The terminal player could not be loaded.";
      });

    return () => {
      disposed = true;
      player?.dispose();
    };
  });
</script>

<figure class="asciinema-recording" data-pagefind-ignore>
  <div
    class="player-frame"
    role="region"
    aria-label={title}
    bind:this={container}
  >
    {#if loading}
      <p class="player-message" role="status">Preparing terminal player...</p>
    {:else if errorMessage}
      <p class="player-message error" role="alert">{errorMessage}</p>
    {/if}
  </div>
  <figcaption>
    <span>{caption}</span>
    <a href={src} download={downloadName}>Download the .cast file</a>
  </figcaption>
</figure>

<style>
  .asciinema-recording {
    margin-inline: 0;
  }

  .player-frame {
    min-height: 12rem;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: #121314;
  }

  .player-frame:has(:global(.ap-wrapper)) {
    min-height: 0;
  }

  .player-message {
    min-height: 12rem;
    margin: 0;
    padding: var(--space-md);
    display: grid;
    place-items: center;
    box-sizing: border-box;
    color: #d7d7d7;
    text-align: center;
  }

  .player-message.error {
    color: #ffb4b4;
  }

  figcaption {
    margin-top: var(--space-xs);
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-xs) var(--space-md);
    color: var(--color-muted);
    font-size: 0.85rem;
  }
</style>
