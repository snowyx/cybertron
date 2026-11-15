import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls, useGLTF, useAnimations, Stars } from '@react-three/drei';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { CITIZENS, CORE_POSITION } from '../../../shared/protocol';
import { useWorld } from '../state/world';

type Citizen = (typeof CITIZENS)[number];
const UP = new THREE.Vector3(0, 1, 0);
const meshopt = (loader: import('three-stdlib').GLTFLoader) => {
  loader.setMeshoptDecoder(MeshoptDecoder);
};

export default function WorldScene() {
  const quality = useWorld((s) => s.quality);
  const supportsWebGL = useMemo(() => {
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2');
      context?.getExtension('WEBGL_lose_context')?.loseContext();
      return !!context;
    } catch {
      return false;
    }
  }, []);
  if (!supportsWebGL) return <NoGraphics />;
  return (
    <div className="world-canvas" data-testid="world-canvas">
      <Canvas
        camera={{ position: [143, 111, 161], fov: 39, near: 0.5, far: 1600 }}
        dpr={quality === 'high' ? [1, 1.5] : 1}
        shadows={quality === 'high'}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          toneMapping: THREE.NoToneMapping,
        }}
        fallback={<div>三维视图需要支持 WebGL 的浏览器。</div>}
        onCreated={({ gl }) => {
          gl.domElement.setAttribute('aria-label', '赛博坦三维星城：拖动环绕、滚轮缩放');
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            useWorld.getState().set({ modelError: '图形上下文已中断，请重新载入三维世界。' });
          });
        }}
      >
        <Lights />
        <CameraRig />
        <Suspense fallback={null}>
          <City />
          <CitizenPopulation />
          <Gateway />
        </Suspense>
        <WorldFoundation />
        <Infrastructure />
        <Stars radius={350} depth={120} count={900} factor={2.2} saturation={0} fade speed={0} />
      </Canvas>
    </div>
  );
}

function NoGraphics() {
  useEffect(() => {
    useWorld.getState().set({ modelError: '设备未启用三维图形，公民资料和广播仍然可用。' });
  }, []);
  return (
    <div className="scene-fallback">
      <h2>设备未启用三维图形</h2>
      <p>请开启硬件加速。你仍可查看公民网络、日志并广播问题。</p>
    </div>
  );
}

function Lights() {
  const lighting = useWorld((s) => s.lighting);
  const day = lighting === 'day';
  return (
    <>
      <color attach="background" args={[day ? '#33464d' : '#172a34']} />
      <fog attach="fog" args={[day ? '#33464d' : '#172a34', 160, 480]} />
      <hemisphereLight
        args={[day ? '#d9edf0' : '#abc9de', day ? '#58656b' : '#364b55', day ? 2.1 : 1.65]}
      />
      <directionalLight
        position={[65, 110, 45]}
        color={day ? '#fff1dc' : '#c3d5df'}
        intensity={day ? 2.6 : 1.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
        shadow-camera-near={1}
        shadow-camera-far={300}
        shadow-normalBias={0.15}
        shadow-bias={-0.0002}
      />
      <directionalLight position={[-80, 30, -70]} color="#74bfc5" intensity={0.9} />
    </>
  );
}

function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size, gl } = useThree();
  const view = useWorld((s) => s.view);
  const selected = useWorld((s) => s.selected);
  const version = useWorld((s) => s.cameraVersion);
  const tour = useWorld((s) => s.tour);
  const reduced = useWorld((s) => s.reducedMotion);
  const destination = useRef({
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
    active: false,
  });
  useEffect(() => {
    const c = CITIZENS.find((c) => c.id === selected);
    const p = selected === 'core' ? CORE_POSITION : c?.position;
    const target = new THREE.Vector3(...(p ?? [0, 5, 0]));
    let offset: THREE.Vector3;
    if (view === 'street') {
      const entry = c?.entry ?? [4, 0.11, 8];
      target.set(entry[0], 3, entry[2]);
      offset = new THREE.Vector3(16, 7, 20);
    } else if (p) {
      target.y = selected === 'core' ? 15 : 7;
      offset = new THREE.Vector3(40, 29, 45);
    } else if (view === 'overview') offset = new THREE.Vector3(0, 210, 0.1);
    else offset = new THREE.Vector3(130, 94, 145);
    if (size.width < 760 && !p && view !== 'street') offset.multiplyScalar(1.72);
    destination.current = { position: target.clone().add(offset), target, active: true };
    if (reduced) {
      camera.position.copy(destination.current.position);
      controls.current?.target.copy(target);
      destination.current.active = false;
      controls.current?.update();
    }
  }, [view, selected, version, size.width, reduced, camera]);
  useEffect(() => {
    const zoom = (event: Event) => {
      const factor = (event as CustomEvent<number>).detail;
      const c = controls.current;
      if (!c) return;
      camera.position.sub(c.target).multiplyScalar(factor).add(c.target);
      c.update();
      destination.current.active = false;
    };
    window.addEventListener('world:zoom', zoom);
    return () => window.removeEventListener('world:zoom', zoom);
  }, [camera]);
  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    if (destination.current.active) {
      const d = destination.current;
      camera.position.lerp(d.position, 1 - Math.exp(-delta * 3.8));
      c.target.lerp(d.target, 1 - Math.exp(-delta * 3.8));
      if (camera.position.distanceTo(d.position) < 0.05) destination.current.active = false;
      c.update();
    }
    gl.domElement.dataset.camera = camera.position
      .toArray()
      .map((v) => v.toFixed(1))
      .join(',');
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      minDistance={9}
      maxDistance={340}
      minPolarAngle={0.02}
      maxPolarAngle={Math.PI / 2.08}
      enableDamping
      dampingFactor={0.07}
      autoRotate={tour && !reduced}
      autoRotateSpeed={0.3}
      onStart={() => {
        destination.current.active = false;
        useWorld.getState().set({ tour: false });
      }}
    />
  );
}

function City() {
  const { scene } = useGLTF('/assets/polyfork/city.glb', false, false, meshopt);
  const { gl } = useThree();
  const city = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        obj.material = Array.isArray(obj.material)
          ? obj.material.map((m) => m.clone())
          : obj.material.clone();
      }
    });
    return c;
  }, [scene]);
  useEffect(() => {
    useWorld.getState().set({ modelReady: true, modelError: null });
    gl.domElement.dataset.cityLoaded = 'true';
    return () => {
      gl.domElement.dataset.cityLoaded = 'false';
    };
  }, [gl]);
  const selected = useWorld((s) => s.selected);
  const labels = useWorld((s) => s.labels);
  const snapshot = useWorld((s) => s.snapshot);
  const lighting = useWorld((s) => s.lighting);
  useEffect(() => {
    city.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      let parent: THREE.Object3D | null = obj;
      let citizen: Citizen | undefined;
      while (parent && !citizen) {
        const name = parent.name.replaceAll('_', '-');
        citizen = CITIZENS.find((c) => name.startsWith(c.building));
        parent = parent.parent;
      }
      const status = snapshot?.agents.find((a) => a.id === citizen?.id)?.status;
      for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        if (material.userData.originalEmissive === undefined)
          material.userData.originalEmissive = material.emissiveIntensity;
        material.emissiveIntensity =
          status === 'asleep'
            ? 0.015
            : lighting === 'day'
              ? 0.08
              : material.userData.originalEmissive;
      }
    });
  }, [city, snapshot, lighting]);
  const click = (e: ThreeEvent<MouseEvent>) => {
    let obj: THREE.Object3D | null = e.object;
    while (obj) {
      const match = CITIZENS.find(
        (c) =>
          obj!.name.startsWith(c.building.replaceAll('-', '_')) || obj!.name.startsWith(c.building),
      );
      if (match) {
        e.stopPropagation();
        useWorld.getState().select(match.id);
        return;
      }
      obj = obj.parent;
    }
  };
  return (
    <group>
      <primitive object={city} onClick={click} dispose={null} />
      {CITIZENS.map((c) => {
        const a = snapshot?.agents.find((a) => a.id === c.id);
        return (
          <group key={c.id} position={[...c.position]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.25, 0]}>
              <ringGeometry args={[10, 10.12, 64]} />
              <meshBasicMaterial
                color={a?.status === 'isolated' ? '#d6af72' : c.color}
                transparent
                opacity={selected === c.id ? 0.85 : 0.15}
                depthWrite={false}
              />
            </mesh>
            {labels && (
              <Html
                center
                position={[0, c.id === 'dreamer' ? 23 : c.id === 'poet' ? 15 : 13, 0]}
                distanceFactor={undefined}
                zIndexRange={[4, 0]}
              >
                <button
                  className={`landmark ${selected === c.id ? 'selected' : ''} ${a?.status ?? ''}`}
                  aria-label={`观察 ${c.name} · ${c.district}`}
                  onClick={() => useWorld.getState().select(c.id)}
                >
                  <span />
                  {c.district}
                  <i>{c.name}</i>
                </button>
              </Html>
            )}
            <StatusBeacon citizen={c} />
          </group>
        );
      })}
    </group>
  );
}

function StatusBeacon({ citizen }: { citizen: Citizen }) {
  const agent = useWorld((s) => s.snapshot?.agents.find((a) => a.id === citizen.id));
  const active = agent?.status === 'active';
  return (
    <group position={[0, 0.5, 0]}>
      <pointLight
        position={[0, 5, 0]}
        color={agent?.status === 'isolated' ? '#d6af72' : citizen.color}
        intensity={active ? 22 : 1}
        distance={16}
      />
      <mesh position={[0, 2, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 4, 5]} />
        <meshBasicMaterial color={active ? citizen.color : '#3e555d'} />
      </mesh>
    </group>
  );
}

function WorldFoundation() {
  return (
    <group>
      <mesh position={[0, -3, 0]} receiveShadow>
        <cylinderGeometry args={[95, 88, 6, 12]} />
        <meshStandardMaterial color="#273d45" metalness={0.35} roughness={0.75} />
      </mesh>
      <mesh position={[0, -6.3, 0]}>
        <cylinderGeometry args={[88, 77, 1.1, 12]} />
        <meshStandardMaterial color="#162a34" metalness={0.5} roughness={0.6} />
      </mesh>
      {[92, 94].map((r) => (
        <mesh key={r} position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r, r + 0.1, 128]} />
          <meshBasicMaterial color="#76adb2" transparent opacity={0.35} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -7, 0]} receiveShadow>
        <planeGeometry args={[1600, 1600]} />
        <meshStandardMaterial color="#15272f" roughness={0.95} />
      </mesh>
      <DistantCity />
    </group>
  );
}

function DistantCity() {
  const towers = useMemo(() => {
    const list = [];
    for (let i = 0; i < 80; i++) {
      const a = Math.PI * 0.85 + (i / 80) * Math.PI * 0.95;
      const radius = 155 + (i % 4) * 24;
      const height = 8 + ((i * 17) % 43);
      list.push({
        position: [Math.cos(a) * radius, height / 2 - 7, Math.sin(a) * radius] as [
          number,
          number,
          number,
        ],
        height,
        width: 6 + ((i * 7) % 11),
      });
    }
    return list;
  }, []);
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = new THREE.Object3D();
    towers.forEach((t, i) => {
      m.position.set(...t.position);
      m.scale.set(t.width, t.height, t.width);
      m.updateMatrix();
      ref.current?.setMatrixAt(i, m.matrix);
    });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  }, [towers]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, towers.length]}>
      <boxGeometry />
      <meshStandardMaterial color="#263d48" roughness={0.9} />
    </instancedMesh>
  );
}

function Gateway() {
  const rotor = useRef<THREE.Group>(null);
  const reduced = useWorld((s) => s.reducedMotion);
  const project = useWorld((s) => s.snapshot?.project);
  const labels = useWorld((s) => s.labels);
  useFrame((_, delta) => {
    if (rotor.current && !reduced) rotor.current.rotation.z += delta * 0.075;
  });
  return (
    <group position={[...CORE_POSITION]}>
      <mesh position={[0, 0.4, 0]} receiveShadow>
        <cylinderGeometry args={[13, 14, 0.8, 64]} />
        <meshStandardMaterial color="#29444e" metalness={0.55} roughness={0.7} />
      </mesh>
      {[8.3, 11.8, 13.5].map((r) => (
        <mesh key={r} position={[0, 0.86, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r, r + 0.1, 80]} />
          <meshBasicMaterial color="#b6d9d2" transparent opacity={0.55} />
        </mesh>
      ))}
      <group position={[0, 14, 0]} rotation={[0, 0.65, 0]}>
        <mesh
          castShadow
          onClick={(e) => {
            e.stopPropagation();
            const s = useWorld.getState();
            s.set({ selected: 'core', panel: 'projects', cameraVersion: s.cameraVersion + 1 });
          }}
        >
          <torusGeometry args={[12, 1.05, 8, 72]} />
          <meshStandardMaterial color="#506b72" metalness={0.75} roughness={0.32} />
        </mesh>
        <mesh>
          <torusGeometry args={[10.95, 0.1, 8, 96]} />
          <meshBasicMaterial color="#a4e7df" />
        </mesh>
        <mesh position={[0, 0, 0.48]}>
          <torusGeometry args={[12, 0.08, 8, 96]} />
          <meshBasicMaterial color="#ccbe99" />
        </mesh>
        <group ref={rotor}>
          {Array.from({ length: 32 }, (_, i) => {
            const angle = (i / 32) * Math.PI * 2;
            return (
              <mesh
                key={i}
                position={[Math.cos(angle) * 12, Math.sin(angle) * 12, 0]}
                rotation={[0, 0, angle]}
                castShadow
              >
                <boxGeometry args={[1.6, 0.25, 2.4]} />
                <meshStandardMaterial
                  color={i / 32 < (project?.progress ?? 0) / 100 ? '#a1d2cc' : '#2d4751'}
                  emissive={i / 32 < (project?.progress ?? 0) / 100 ? '#70a9a1' : '#000000'}
                  emissiveIntensity={0.5}
                  metalness={0.6}
                  roughness={0.5}
                />
              </mesh>
            );
          })}
        </group>
        <mesh>
          <circleGeometry args={[10.8, 80]} />
          <meshBasicMaterial
            color="#94d9d3"
            side={THREE.DoubleSide}
            transparent
            opacity={0.025}
            depthWrite={false}
          />
        </mesh>
      </group>
      {[-8, 8].map((x) => (
        <mesh key={x} position={[x, 3, 0]} rotation={[0, 0, x > 0 ? -0.22 : 0.22]} castShadow>
          <boxGeometry args={[1.8, 6, 3.2]} />
          <meshStandardMaterial color="#38535d" metalness={0.6} roughness={0.5} />
        </mesh>
      ))}
      {labels && (
        <Html center position={[0, 31, 0]} zIndexRange={[4, 0]}>
          <button
            className="landmark core-label"
            aria-label="观察星际之门"
            onClick={() => {
              const s = useWorld.getState();
              s.set({
                selected: 'core',
                panel: 'projects',
                cameraVersion: s.cameraVersion + 1,
                tour: false,
              });
            }}
          >
            <span />
            星际之门 <i>协作进度 {project?.progress ?? 0}%</i>
          </button>
        </Html>
      )}
    </group>
  );
}

function Infrastructure() {
  // Schematic energy network: always a presentation layer, never an artificial population.
  const points = useMemo(
    () =>
      CITIZENS.map((c) => [
        new THREE.Vector3(...c.entry),
        new THREE.Vector3(c.entry[0], 0.22, 8),
        new THREE.Vector3(-13, 0.22, 8),
        new THREE.Vector3(...CORE_POSITION),
      ]),
    [],
  );
  return (
    <group>
      {points.map((p, i) => (
        <EnergyLink key={i} points={p} index={i} />
      ))}
    </group>
  );
}
function EnergyLink({ points, index }: { points: THREE.Vector3[]; index: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const reduced = useWorld((s) => s.reducedMotion);
  const active = useWorld((s) => s.snapshot?.agents[index]?.status === 'active');
  const path = useMemo(() => new THREE.CatmullRomCurve3(points), [points]);
  const geometry = useMemo(() => new THREE.TubeGeometry(path, 48, 0.035, 4, false), [path]);
  useFrame(({ clock }) => {
    if (mesh.current && !reduced && active)
      mesh.current.position
        .copy(path.getPoint((clock.elapsedTime * 0.045 + index * 0.17) % 1))
        .addScaledVector(UP, 0.3);
  });
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <>
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#89c1bf" transparent opacity={active ? 0.35 : 0.08} />
      </mesh>
      <mesh ref={mesh} visible={active && !reduced}>
        <sphereGeometry args={[0.22, 8, 6]} />
        <meshBasicMaterial color="#bdf5e9" />
      </mesh>
    </>
  );
}

function CitizenPopulation() {
  return (
    <>
      {CITIZENS.map((c) => (
        <CitizenBody key={c.id} citizen={c} />
      ))}
    </>
  );
}
function CitizenBody({ citizen }: { citizen: Citizen }) {
  const gltf = useGLTF(
    citizen.id === 'engineer' ? '/assets/polyfork/engineer.glb' : '/assets/polyfork/citizen.glb',
    false,
    false,
    meshopt,
  );
  const model = useMemo(() => clone(gltf.scene), [gltf.scene]);
  const ref = useRef<THREE.Group>(null);
  const { actions } = useAnimations(gltf.animations, ref);
  const status = useWorld((s) => s.snapshot?.agents.find((a) => a.id === citizen.id)?.status);
  const reduced = useWorld((s) => s.reducedMotion);
  const destination = useWorld((s) => s.destination[citizen.id]);
  useEffect(() => {
    const action = actions[status === 'active' && !reduced ? 'Walk' : 'Idle'];
    action?.reset().fadeIn(0.3).play();
    return () => {
      action?.fadeOut(0.3);
    };
  }, [actions, status, reduced]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const base = new THREE.Vector3(...citizen.entry);
    if (status === 'active' && !reduced) {
      const target = CITIZENS.find((c) => c.id === destination?.target);
      if (target && Date.now() - (destination?.at ?? 0) < 18000) {
        const t = Math.min(1, (Date.now() - destination.at) / 10000);
        base.lerp(new THREE.Vector3(...target.entry), t);
      } else {
        base.x += Math.sin(clock.elapsedTime * 0.15) * 2.2;
        base.z += Math.cos(clock.elapsedTime * 0.15) * 0.8;
      }
      ref.current.rotation.y = -clock.elapsedTime * 0.15;
    }
    ref.current.position.copy(base);
  });
  return (
    <group ref={ref} position={[...citizen.entry]}>
      <primitive object={model} />
      <mesh position={[0, 2.3, 0]}>
        <sphereGeometry args={[0.12, 8, 6]} />
        <meshBasicMaterial color={status === 'active' ? citizen.color : '#576b73'} />
      </mesh>
    </group>
  );
}
