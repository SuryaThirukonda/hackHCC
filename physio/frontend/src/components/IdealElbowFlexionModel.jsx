import { useEffect, useRef } from "react";
import * as THREE from "three";

const LOOP_SECONDS = 6;

function phaseForTime(t) {
  if (t < 1) return { angle: 0, label: "Extend" };
  if (t < 3) return { angle: ((t - 1) / 2) * 108, label: "Bend" };
  if (t < 4) return { angle: 108, label: "Hold" };
  return { angle: (1 - ((t - 4) / 2)) * 108, label: "Straighten" };
}

function makeLimb(length, radius, color) {
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 24);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.04 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.z = Math.PI / 2;
  mesh.position.x = length / 2;
  return mesh;
}

function makeJoint(radius, color) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 16),
    new THREE.MeshStandardMaterial({ color, roughness: 0.66 })
  );
}

export default function IdealElbowFlexionModel({ compact = false }) {
  const containerRef = useRef(null);
  const labelRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, compact ? 8.2 : 7.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xf5f2ea, 1.8);
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 5, 4);
    scene.add(ambient, key);

    const root = new THREE.Group();
    root.position.set(-2.2, -0.25, 0);
    scene.add(root);

    const upperLength = compact ? 2.0 : 2.35;
    const forearmLength = compact ? 1.85 : 2.25;
    const upperArm = makeLimb(upperLength, 0.11, 0x1a1917);
    const shoulder = makeJoint(0.23, 0x1a1917);
    const elbowGroup = new THREE.Group();
    elbowGroup.position.x = upperLength;
    const elbow = makeJoint(0.21, 0x5a5752);
    const forearm = makeLimb(forearmLength, 0.1, 0x1a1917);
    const wrist = makeJoint(0.18, 0xc0392b);
    wrist.position.x = forearmLength;

    root.add(shoulder, upperArm, elbowGroup);
    elbowGroup.add(elbow, forearm, wrist);

    const arcMaterial = new THREE.MeshBasicMaterial({
      color: 0xc0392b,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide
    });
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.08, 48, 1, THREE.MathUtils.degToRad(35), THREE.MathUtils.degToRad(72)),
      arcMaterial
    );
    arc.position.set(upperLength, 0, -0.06);
    root.add(arc);

    let raf = 0;
    const clock = new THREE.Clock();

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(280, rect.width);
      const height = Math.max(compact ? 260 : 360, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const render = () => {
      const elapsed = clock.getElapsedTime() % LOOP_SECONDS;
      const phase = phaseForTime(elapsed);
      elbowGroup.rotation.z = THREE.MathUtils.degToRad(-phase.angle);
      root.rotation.y = Math.sin(clock.getElapsedTime() * 0.5) * 0.08;
      if (labelRef.current) labelRef.current.textContent = phase.label;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };

    resize();
    render();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.dispose();
      scene.traverse((item) => {
        if (item.geometry) item.geometry.dispose();
        if (item.material) item.material.dispose();
      });
      container.removeChild(renderer.domElement);
    };
  }, [compact]);

  return (
    <div className={compact ? "ideal-model ideal-model-compact" : "ideal-model"}>
      <div ref={containerRef} className="ideal-model-canvas" />
      <div className="ideal-model-label">
        <span ref={labelRef}>Extend</span>
      </div>
      <div className="ideal-model-steps" aria-hidden="true">
        <span>Extend</span>
        <span>Bend</span>
        <span>Hold</span>
        <span>Straighten</span>
      </div>
    </div>
  );
}
