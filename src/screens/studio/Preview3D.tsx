import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MapGraph } from '../../lib/graph/types';

const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

/**
 * Stacked-floor 3D preview: room footprints as low walls, graph nodes and edges, vertical
 * connectors between floors. Map (x, y) → three (x, -z); elevation → three y.
 */
export function Preview3D({ graph, floorId }: { graph: MapGraph; floorId: string | null }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.1, 500);
    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(10, 30, 10);
    scene.add(sun);

    const elev = new Map(graph.floors.map((f) => [f.id, f.elevation]));
    const nodePos = new Map(
      graph.nodes.map((n) => [
        n.id,
        new THREE.Vector3(n.position.x, (elev.get(n.floorId) ?? 0) + 0.05, -n.position.y),
      ]),
    );
    const accent = new THREE.Color(css('--accent'));
    const fg = new THREE.Color(css('--fg'));
    const muted = new THREE.Color(css('--muted'));
    const warn = new THREE.Color(css('--warn'));

    for (const room of graph.rooms) {
      if (!room.footprint || room.footprint.length < 3) continue;
      const shape = new THREE.Shape(room.footprint.map((p) => new THREE.Vector2(p.x, p.y)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: room.floorId === floorId ? accent : muted,
        transparent: true,
        opacity: room.floorId === floorId ? 0.35 : 0.15,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = elev.get(room.floorId) ?? 0;
      scene.add(mesh);
      scene.add(
        Object.assign(
          new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: fg })),
          { position: mesh.position.clone() },
        ),
      );
    }

    const sphere = new THREE.SphereGeometry(0.25, 12, 8);
    for (const n of graph.nodes) {
      const m = new THREE.Mesh(
        sphere,
        new THREE.MeshStandardMaterial({
          color:
            n.kind === 'room'
              ? accent
              : n.kind === 'door'
                ? new THREE.Color(css('--ok'))
                : n.kind === 'landing' || n.kind === 'elevator'
                  ? warn
                  : muted,
        }),
      );
      m.position.copy(nodePos.get(n.id)!);
      scene.add(m);
    }
    const pts: THREE.Vector3[] = [];
    const vpts: THREE.Vector3[] = [];
    for (const e of graph.edges) {
      const a = nodePos.get(e.from);
      const b = nodePos.get(e.to);
      if (!a || !b) continue;
      (e.kind === 'stairs' || e.kind === 'elevator' ? vpts : pts).push(a, b);
    }
    scene.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: fg }),
      ),
    );
    scene.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(vpts),
        new THREE.LineBasicMaterial({ color: warn }),
      ),
    );

    for (const f of graph.floors) {
      const grid = new THREE.GridHelper(60, 60, muted, muted);
      (grid.material as THREE.Material).opacity = f.id === floorId ? 0.25 : 0.08;
      (grid.material as THREE.Material).transparent = true;
      grid.position.y = f.elevation;
      scene.add(grid);
    }

    const box = new THREE.Box3();
    nodePos.forEach((p) => box.expandByPoint(p));
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? 10 : Math.max(8, box.getSize(new THREE.Vector3()).length());
    camera.position.set(center.x + size * 0.6, center.y + size * 0.7, center.z + size * 0.8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = !reduceMotion;
    controls.update();

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    const ro = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      el.removeChild(renderer.domElement);
    };
  }, [graph, floorId]);

  const summary = `3D view of ${graph.floors.length} ${graph.floors.length === 1 ? 'floor' : 'floors'}, ${graph.rooms.length} scanned rooms, ${graph.nodes.length} places and ${graph.edges.length} connections. Drag to rotate.`;
  return (
    <div
      ref={host}
      role="img"
      aria-label={summary}
      className="w-full h-96 border-[3px] border-line overflow-hidden bg-surface"
    />
  );
}
