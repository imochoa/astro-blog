<script lang="ts">
  import { onMount } from "svelte";
  import RAPIER, {
    type RigidBody,
    type World,
  } from "@dimforge/rapier3d-compat";
  import * as THREE from "three";

  type PhysicsObject = {
    body: RigidBody;
    material: THREE.MeshStandardMaterial;
    mesh: THREE.Mesh;
  };

  const fixedTimeStep = 1 / 60;
  const maximumObjects = 18;
  const colors = [0xff6b6b, 0xffd166, 0x70d6ff, 0x9bdeac, 0xc8a2ff];

  let container: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let ready = $state(false);
  let running = $state(false);
  let status = $state("Loading Rapier…");
  let addObject = () => {};
  let resetObjects = () => {};

  function toggleSimulation() {
    if (!ready) return;
    running = !running;
    status = running ? "Simulation running." : "Simulation paused.";
  }

  onMount(() => {
    let destroyed = false;
    let animationFrame = 0;
    let renderer: THREE.WebGLRenderer | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let motionPreference: MediaQueryList | undefined;
    let handleMotionPreference:
      ((event: MediaQueryListEvent) => void) | undefined;
    let world: World | undefined;
    let cleanScene: (() => void) | undefined;

    async function initialize() {
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          canvas,
          powerPreference: "default",
        });
      } catch {
        status = "WebGL is unavailable, so the demo cannot be displayed.";
        return;
      }

      try {
        await RAPIER.init();
      } catch {
        renderer.dispose();
        status = "Rapier could not initialize in this browser.";
        return;
      }

      if (destroyed) {
        renderer.dispose();
        return;
      }

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x101715);
      scene.fog = new THREE.Fog(0x101715, 11, 20);

      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
      camera.position.set(7.2, 5.5, 10);
      camera.lookAt(0, 2.2, 0);

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;

      scene.add(new THREE.HemisphereLight(0xc9fff3, 0x16201d, 2.1));
      const keyLight = new THREE.DirectionalLight(0xffffff, 4.2);
      keyLight.position.set(4, 9, 6);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.left = -6;
      keyLight.shadow.camera.right = 6;
      keyLight.shadow.camera.top = 9;
      keyLight.shadow.camera.bottom = -2;
      scene.add(keyLight);

      const floorGeometry = new THREE.BoxGeometry(8, 0.5, 6);
      const floorMaterial = new THREE.MeshStandardMaterial({
        color: 0x253a34,
        metalness: 0.05,
        roughness: 0.85,
      });
      const floor = new THREE.Mesh(floorGeometry, floorMaterial);
      floor.position.y = -0.25;
      floor.receiveShadow = true;
      scene.add(floor);

      const grid = new THREE.GridHelper(8, 16, 0x78a99d, 0x36554d);
      grid.position.y = 0.006;
      const gridMaterials = Array.isArray(grid.material)
        ? grid.material
        : [grid.material];
      for (const material of gridMaterials) {
        material.opacity = 0.32;
        material.transparent = true;
      }
      scene.add(grid);

      const sphereGeometry = new THREE.SphereGeometry(0.34, 24, 16);
      const boxGeometry = new THREE.BoxGeometry(0.62, 0.62, 0.62);
      const objects: PhysicsObject[] = [];
      let objectNumber = 0;

      world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      world.timestep = fixedTimeStep;

      world.createCollider(
        RAPIER.ColliderDesc.cuboid(4, 0.25, 3)
          .setTranslation(0, -0.25, 0)
          .setFriction(0.8),
      );

      const wallDescriptions = [
        RAPIER.ColliderDesc.cuboid(0.1, 2.5, 3).setTranslation(-4.1, 2.5, 0),
        RAPIER.ColliderDesc.cuboid(0.1, 2.5, 3).setTranslation(4.1, 2.5, 0),
        RAPIER.ColliderDesc.cuboid(4, 2.5, 0.1).setTranslation(0, 2.5, -3.1),
        RAPIER.ColliderDesc.cuboid(4, 2.5, 0.1).setTranslation(0, 2.5, 3.1),
      ];
      for (const description of wallDescriptions) {
        world.createCollider(description.setRestitution(0.45));
      }

      function removeOldestObject() {
        const oldest = objects.shift();
        if (!oldest || !world) return;
        world.removeRigidBody(oldest.body);
        scene.remove(oldest.mesh);
        oldest.material.dispose();
      }

      function spawnObject(height = 6) {
        if (!world) return;
        if (objects.length >= maximumObjects) removeOldestObject();

        const isSphere = objectNumber % 2 === 0;
        const x = (Math.random() - 0.5) * 4.2;
        const z = (Math.random() - 0.5) * 3.2;
        const material = new THREE.MeshStandardMaterial({
          color: colors[objectNumber % colors.length],
          metalness: 0.12,
          roughness: 0.38,
        });
        const mesh = new THREE.Mesh(
          isSphere ? sphereGeometry : boxGeometry,
          material,
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);

        const body = world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, height, z)
            .setLinearDamping(0.08)
            .setAngularDamping(0.1),
        );
        const collider = isSphere
          ? RAPIER.ColliderDesc.ball(0.34)
          : RAPIER.ColliderDesc.cuboid(0.31, 0.31, 0.31);
        world.createCollider(
          collider.setDensity(1).setFriction(0.65).setRestitution(0.55),
          body,
        );
        body.applyTorqueImpulse(
          {
            x: Math.random() - 0.5,
            y: Math.random() - 0.5,
            z: Math.random() - 0.5,
          },
          true,
        );

        objects.push({ body, material, mesh });
        objectNumber += 1;
        status = `${objects.length} shapes in the simulation.`;
      }

      addObject = () => spawnObject(7.5);
      resetObjects = () => {
        while (objects.length > 0) removeOldestObject();
        for (let index = 0; index < 9; index += 1) {
          spawnObject(3.5 + index * 0.72);
        }
        status = "Simulation reset with 9 shapes.";
      };
      resetObjects();

      const resize = () => {
        if (!renderer) return;
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (width === 0 || height === 0) return;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        renderer.render(scene, camera);
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      resize();

      motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
      handleMotionPreference = (event: MediaQueryListEvent) => {
        if (!event.matches) return;
        running = false;
        status = "Simulation paused because reduced motion is enabled.";
      };
      motionPreference.addEventListener("change", handleMotionPreference);
      running = !motionPreference.matches;
      ready = true;
      status = running
        ? "Simulation running with 9 shapes."
        : "Simulation paused because reduced motion is enabled.";

      let previousTime = performance.now();
      let accumulator = 0;
      const animate = (time: number) => {
        const elapsed = Math.min((time - previousTime) / 1000, 0.1);
        previousTime = time;

        if (running && !document.hidden && world) {
          accumulator += elapsed;
          while (accumulator >= fixedTimeStep) {
            world.step();
            accumulator -= fixedTimeStep;
          }
        } else {
          accumulator = 0;
        }

        for (const object of objects) {
          const position = object.body.translation();
          const rotation = object.body.rotation();
          object.mesh.position.set(position.x, position.y, position.z);
          object.mesh.quaternion.set(
            rotation.x,
            rotation.y,
            rotation.z,
            rotation.w,
          );
        }

        renderer?.render(scene, camera);
        animationFrame = window.requestAnimationFrame(animate);
      };
      animationFrame = window.requestAnimationFrame(animate);

      cleanScene = () => {
        window.cancelAnimationFrame(animationFrame);
        resizeObserver?.disconnect();
        if (handleMotionPreference) {
          motionPreference?.removeEventListener(
            "change",
            handleMotionPreference,
          );
        }
        while (objects.length > 0) removeOldestObject();
        world?.free();
        world = undefined;
        floorGeometry.dispose();
        floorMaterial.dispose();
        sphereGeometry.dispose();
        boxGeometry.dispose();
        for (const material of gridMaterials) material.dispose();
        renderer?.dispose();
      };
    }

    void initialize();

    return () => {
      destroyed = true;
      cleanScene?.();
      resizeObserver?.disconnect();
      window.cancelAnimationFrame(animationFrame);
      renderer?.dispose();
      world?.free();
    };
  });
</script>

<section class="demo" aria-labelledby="rapier-demo-title">
  <div class="heading">
    <div>
      <h2 id="rapier-demo-title">Rigid-body drop</h2>
      <p>Three.js draws each frame; Rapier decides where the shapes go.</p>
    </div>
    <div class="actions">
      <button type="button" onclick={() => addObject()} disabled={!ready}>
        Drop a shape
      </button>
      <button type="button" onclick={() => resetObjects()} disabled={!ready}>
        Reset
      </button>
      <button type="button" onclick={toggleSimulation} disabled={!ready}>
        {running ? "Pause" : "Play"}
      </button>
    </div>
  </div>

  <div
    class="scene"
    role="img"
    aria-label="Colorful balls and cubes falling and colliding on a platform"
    bind:this={container}
  >
    <canvas bind:this={canvas} aria-hidden="true"></canvas>
  </div>
  <p class="status" role="status" aria-live="polite">{status}</p>
</section>

<style>
  .demo {
    margin-block: 2rem;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 1.1rem;
  }

  .heading p,
  .status {
    color: var(--color-muted);
    font-size: 0.9rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  button {
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--color-border);
    border-radius: calc(var(--radius) * 0.65);
    color: var(--color-text);
    background: var(--color-background);
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }

  button:hover:not(:disabled) {
    border-color: var(--color-accent);
  }

  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  button:disabled {
    cursor: wait;
    opacity: 0.55;
  }

  .scene {
    position: relative;
    width: 100%;
    min-height: 28rem;
    overflow: hidden;
    background: #101715;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .status {
    min-height: 1.4em;
    padding: 0.65rem 1rem;
  }

  @media (max-width: 42rem) {
    .heading {
      align-items: flex-start;
      flex-direction: column;
    }

    .scene {
      min-height: 21rem;
    }
  }
</style>
