<script lang="ts">
  import { onMount } from "svelte";
  import * as THREE from "three";

  let container: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let unavailable = false;

  onMount(() => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101715);
    scene.fog = new THREE.Fog(0x101715, 5, 10);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 4.5);

    let renderer: THREE.WebGLRenderer;

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
    } catch {
      unavailable = true;
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const group = new THREE.Group();
    scene.add(group);

    const geometry = new THREE.IcosahedronGeometry(1.15, 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0x68b8a3,
      metalness: 0.25,
      roughness: 0.35,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);

    const wireMaterial = new THREE.MeshBasicMaterial({
      color: 0xe0ebe7,
      opacity: 0.18,
      transparent: true,
      wireframe: true,
    });
    const wireframe = new THREE.Mesh(geometry, wireMaterial);
    wireframe.scale.setScalar(1.015);
    group.add(wireframe);

    const starPositions = new Float32Array(240 * 3);
    for (let index = 0; index < starPositions.length; index += 3) {
      const radius = 3 + Math.random() * 3;
      const angle = Math.random() * Math.PI * 2;
      starPositions[index] = Math.cos(angle) * radius;
      starPositions[index + 1] = (Math.random() - 0.5) * 5;
      starPositions[index + 2] = Math.sin(angle) * radius - 2;
    }

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(starPositions, 3),
    );
    const starMaterial = new THREE.PointsMaterial({
      color: 0xa8d8cc,
      opacity: 0.55,
      size: 0.025,
      transparent: true,
    });
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    scene.add(new THREE.HemisphereLight(0xd8fff5, 0x18221f, 2.4));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.5);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    let reduceMotion = motionPreference.matches;
    const updateMotionPreference = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
    };
    motionPreference.addEventListener("change", updateMotionPreference);

    let animationFrame = 0;
    const animate = (time: number) => {
      if (!reduceMotion) {
        group.rotation.x = time * 0.00018;
        group.rotation.y = time * 0.00028;
        stars.rotation.y = time * -0.000015;
      }

      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    };
    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      motionPreference.removeEventListener("change", updateMotionPreference);
      geometry.dispose();
      material.dispose();
      wireMaterial.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      renderer.dispose();
    };
  });
</script>

<div
  class="scene"
  role="img"
  aria-label="A rotating green icosahedron floating in a field of stars"
  bind:this={container}
>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
  {#if unavailable}
    <p>WebGL is not available in this browser.</p>
  {/if}
</div>

<style>
  .scene {
    position: relative;
    width: 100%;
    min-height: 22rem;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: #101715;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  p {
    position: absolute;
    inset: 50% auto auto 50%;
    margin: 0;
    color: white;
    transform: translate(-50%, -50%);
  }

  @media (max-width: 36rem) {
    .scene {
      min-height: 17rem;
    }
  }
</style>
