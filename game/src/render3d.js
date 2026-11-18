// 3D renderer for Solmaris Heat: the same simulation state the 2D canvas
// renderer draws, presented with three.js (vendored under game/vendor/).
// The simulation never changes — this file only translates it: world x/y
// become ground-plane x/z, building footprints become boxes with windowed
// facades, cars and people become low-poly groups, and the camera becomes
// a chase cam behind the car (or a high oblique view on foot) with the
// field of view widening slightly with speed, the way a chase cam feels
// in an open-world crime game. The ground is the 2D renderer's own
// prerendered city canvas used as a texture, so roads, labels, beach and
// water match the 2D game exactly. Light follows the game clock: bright
// day, golden hour, then night, with warm fog for depth.
import * as THREE from 'three';
import { PALETTE, VEHICLES, WORLD } from './config.js';
import { buildGround } from './render.js';
import { missionMarker } from './missions.js';
import { playerCar } from './player.js';

/** How much taller a building reads in 3D than its 2D extrusion height. */
const HEIGHT_SCALE = 4;
/** World units per window tile on a facade. */
const WINDOW_TILE = 36;
const CENTER_X = WORLD.width / 2;
const CENTER_Y = WORLD.height / 2;

const LIGHTING = {
  day: { sky: 0x9fc8e8, sun: 0xfff2d0, sunI: 2.2, hemiSky: 0xbfdcff, hemiGround: 0x8a7a5a, hemiI: 0.9, fogNear: 1000, fogFar: 2600, exposure: 1.05 },
  golden: { sky: 0xf4a261, sun: 0xff8c42, sunI: 1.8, hemiSky: 0xe8a0bf, hemiGround: 0x7a5a3a, hemiI: 0.8, fogNear: 900, fogFar: 2200, exposure: 1.0 },
  night: { sky: 0x232a4a, sun: 0x8fa8d0, sunI: 0.5, hemiSky: 0x4a5a8a, hemiGround: 0x2a2a3a, hemiI: 0.5, fogNear: 700, fogFar: 1800, exposure: 0.95 },
};

function shadeHex(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amount));
  return new THREE.Color(`rgb(${r},${g},${b})`);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Shortest-arc interpolation between two headings, in radians. */
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Blend between the day, golden-hour and night lighting presets. */
function lightingBlend(minutes, dusk) {
  if (dusk) return { from: LIGHTING.golden, to: LIGHTING.golden, t: 0 };
  if (minutes < 17 * 60) return { from: LIGHTING.day, to: LIGHTING.day, t: 0 };
  if (minutes < 18 * 60 + 30) return { from: LIGHTING.day, to: LIGHTING.golden, t: (minutes - 17 * 60) / 90 };
  if (minutes < 19 * 60 + 30) return { from: LIGHTING.golden, to: LIGHTING.golden, t: 0 };
  if (minutes < 20 * 60 + 30) return { from: LIGHTING.golden, to: LIGHTING.night, t: (minutes - 19 * 60 - 30) / 60 };
  return { from: LIGHTING.night, to: LIGHTING.night, t: 0 };
}

function makeWindowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#3d4a5c';
  for (let i = 0; i < 2; i += 1) {
    for (let j = 0; j < 3; j += 1) g.fillRect(8 + i * 30, 6 + j * 20, 18, 12);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Box geometry whose side faces repeat the window texture once per
 * WINDOW_TILE units, so windows stay the same size on every building.
 * BoxGeometry faces come in +x, -x, +y, -y, +z, -z order, 4 vertices each.
 */
function windowedBoxGeometry(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const su = [d / WINDOW_TILE, d / WINDOW_TILE, w / WINDOW_TILE, w / WINDOW_TILE, w / WINDOW_TILE, w / WINDOW_TILE];
  const sv = [h / WINDOW_TILE, h / WINDOW_TILE, d / WINDOW_TILE, d / WINDOW_TILE, h / WINDOW_TILE, h / WINDOW_TILE];
  for (let f = 0; f < 6; f += 1) {
    for (let v = 0; v < 4; v += 1) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * su[f], uv.getY(i) * sv[f]);
    }
  }
  return geo;
}

export function createRenderer3d(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const view = { w: 1280, h: 720, dpr: 1 };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LIGHTING.day.sky);
  scene.fog = new THREE.Fog(LIGHTING.day.sky, LIGHTING.day.fogNear, LIGHTING.day.fogFar);
  const camera = new THREE.PerspectiveCamera(55, view.w / view.h, 10, 6000);
  const hemi = new THREE.HemisphereLight(LIGHTING.day.hemiSky, LIGHTING.day.hemiGround, LIGHTING.day.hemiI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(LIGHTING.day.sun, LIGHTING.day.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -480;
  sun.shadow.camera.right = 480;
  sun.shadow.camera.top = 480;
  sun.shadow.camera.bottom = -480;
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 1800;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  // Shared geometry and materials: one set for the whole page lifetime.
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const windowTex = makeWindowTexture();
  const lambertCache = new Map();
  function lambert(color) {
    if (!lambertCache.has(color)) lambertCache.set(color, new THREE.MeshLambertMaterial({ color }));
    return lambertCache.get(color);
  }
  const facadeCache = new Map();
  function facade(color) {
    if (!facadeCache.has(color)) {
      facadeCache.set(color, new THREE.MeshLambertMaterial({ color, map: windowTex }));
    }
    return facadeCache.get(color);
  }
  const roofCache = new Map();
  function roof(color) {
    if (!roofCache.has(color)) {
      roofCache.set(color, new THREE.MeshLambertMaterial({ color: shadeHex(color, -42) }));
    }
    return roofCache.get(color);
  }
  const basicCache = new Map();
  function basic(color) {
    if (!basicCache.has(color)) basicCache.set(color, new THREE.MeshBasicMaterial({ color }));
    return basicCache.get(color);
  }
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x222831 });
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8d5524 });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2a7d4f });
  const leafLightMat = new THREE.MeshLambertMaterial({ color: 0x40916c });
  const palmMat = new THREE.MeshLambertMaterial({ color: 0x2a9d8f });
  const trunkGeo = new THREE.CylinderGeometry(3, 4, 16, 6);
  const palmTrunkGeo = new THREE.CylinderGeometry(2.5, 3.5, 28, 6);
  const crownGeo = new THREE.ConeGeometry(20, 7, 6);
  const headGeo = new THREE.SphereGeometry(5.5, 10, 8);
  const bodyGeo = new THREE.CylinderGeometry(7, 8, 18, 8);
  const capGeo = new THREE.CylinderGeometry(6, 6, 3, 10);
  const bulletGeo = new THREE.SphereGeometry(3.5, 6, 5);
  const particleGeo = new THREE.SphereGeometry(1, 6, 5);
  const ringGeo = new THREE.TorusGeometry(22, 1.6, 8, 40);
  const markerGeo = new THREE.OctahedronGeometry(14, 0);

  const cityGroup = new THREE.Group();
  const dynamicGroup = new THREE.Group();
  scene.add(cityGroup);
  scene.add(dynamicGroup);

  let cityBuilt = null;
  let groundTexture = null;
  let buildingGeometries = [];
  const signMeshes = [];
  const cashMeshes = new Map();

  function box(w, h, d, mat, x, y, z, parent) {
    const mesh = new THREE.Mesh(unitBox, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function buildCity(city) {
    for (const child of [...cityGroup.children]) cityGroup.remove(child);
    for (const geo of buildingGeometries) geo.dispose();
    buildingGeometries = [];
    signMeshes.length = 0;
    cashMeshes.clear();
    if (groundTexture) groundTexture.dispose();

    const groundCanvas = buildGround(city);
    groundTexture = new THREE.CanvasTexture(groundCanvas);
    groundTexture.colorSpace = THREE.SRGBColorSpace;
    groundTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.width, WORLD.height),
      new THREE.MeshLambertMaterial({ map: groundTexture }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    cityGroup.add(ground);
    buildingGeometries.push(ground.geometry);

    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(9000, 9000),
      new THREE.MeshLambertMaterial({ color: 0x6a9a58 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -3;
    cityGroup.add(apron);
    buildingGeometries.push(apron.geometry);

    for (const b of city.buildings) {
      const h3 = b.height * HEIGHT_SCALE;
      const geo = windowedBoxGeometry(b.w, h3, b.h);
      buildingGeometries.push(geo);
      const mesh = new THREE.Mesh(geo, [facade(b.color), facade(b.color), roof(b.color), roof(b.color), facade(b.color), facade(b.color)]);
      mesh.position.set(b.x + b.w / 2 - CENTER_X, h3 / 2, b.y + b.h / 2 - CENTER_Y);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      cityGroup.add(mesh);
      if (b.sign) {
        const sign = box(b.w * 0.6, 4, 2, basic(b.sign), b.x + b.w / 2 - CENTER_X, h3 * 0.55, b.y + b.h + 2 - CENTER_Y, cityGroup);
        sign.castShadow = false;
        signMeshes.push(sign);
      }
    }

    for (const tree of city.trees) {
      const x = tree.x - CENTER_X;
      const z = tree.y - CENTER_Y;
      if (tree.palm) {
        const trunk = new THREE.Mesh(palmTrunkGeo, trunkMat);
        trunk.position.set(x, 14, z);
        trunk.rotation.z = 0.1;
        trunk.castShadow = true;
        cityGroup.add(trunk);
        const crown = new THREE.Mesh(crownGeo, palmMat);
        crown.position.set(x + 2, 30, z);
        crown.castShadow = true;
        cityGroup.add(crown);
      } else {
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(x, 8, z);
        trunk.castShadow = true;
        cityGroup.add(trunk);
        const crown = new THREE.Mesh(new THREE.SphereGeometry(tree.r, 10, 8), leafMat);
        crown.position.set(x, 16 + tree.r * 0.6, z);
        crown.castShadow = true;
        cityGroup.add(crown);
        buildingGeometries.push(crown.geometry);
        const light = new THREE.Mesh(new THREE.SphereGeometry(tree.r * 0.6, 8, 6), leafLightMat);
        light.position.set(x - 4, 18 + tree.r * 0.7, z);
        cityGroup.add(light);
        buildingGeometries.push(light.geometry);
      }
    }

    for (const umbrella of city.umbrellas) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 16, 5), trunkMat);
      pole.position.set(umbrella.x - CENTER_X, 8, umbrella.y - CENTER_Y);
      cityGroup.add(pole);
      buildingGeometries.push(pole.geometry);
      const top = new THREE.Mesh(new THREE.ConeGeometry(15, 7, 8), lambert(umbrella.color));
      top.position.set(umbrella.x - CENTER_X, 18, umbrella.y - CENTER_Y);
      top.castShadow = true;
      cityGroup.add(top);
      buildingGeometries.push(top.geometry);
    }

    for (const boat of city.boats) {
      const hull = box(52, 8, 18, lambert('#ffffff'), boat.x - CENTER_X, 4, boat.y - CENTER_Y, cityGroup);
      hull.rotation.y = -boat.angle;
      const cabin = box(16, 10, 12, lambert('#e63946'), boat.x - CENTER_X, 12, boat.y - CENTER_Y, cityGroup);
      cabin.rotation.y = -boat.angle;
    }

    for (const drop of city.cashDrops) {
      const mesh = box(16, 6, 16, basic('#b7efc5'), drop.x - CENTER_X, 6, drop.y - CENTER_Y, cityGroup);
      mesh.castShadow = false;
      cashMeshes.set(drop, mesh);
    }
    cityBuilt = city;
  }

  // Pooled dynamic meshes, keyed by the simulated object itself.
  const carMeshes = new Map();
  const pedMeshes = new Map();
  let playerMesh = null;
  let playerRing = null;
  let aimLine = null;
  let carRing = null;
  const bulletPool = [];
  const particlePool = [];
  const skidPool = [];
  const markerGroup = new THREE.Group();
  const markerDiamond = new THREE.Mesh(markerGeo, basic('#ffb703'));
  markerDiamond.position.y = 60;
  const markerBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 9, 170, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
  );
  markerBeam.position.y = 85;
  const sideDot = new THREE.Mesh(new THREE.SphereGeometry(10, 10, 8), basic('#219ebc'));
  sideDot.position.y = 40;
  markerGroup.add(markerDiamond, markerBeam, sideDot);
  dynamicGroup.add(markerGroup);

  function buildCarMesh(car) {
    const spec = VEHICLES[car.kind];
    const group = new THREE.Group();
    const body = box(spec.length, 10, spec.width, lambert(car.color), 0, 7, 0, group);
    void body;
    box(spec.length * 0.45, 9, spec.width * 0.78, glassMat, -spec.length * 0.05, 15, 0, group);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(9, 9, 4, tyreMat, sx * spec.length * 0.32, 4.5, sz * (spec.width / 2), group);
      }
    }
    box(2, 3, 4, basic('#fff8d6'), spec.length / 2, 7, -spec.width / 2 + 5, group);
    box(2, 3, 4, basic('#fff8d6'), spec.length / 2, 7, spec.width / 2 - 5, group);
    box(2, 3, 4, basic('#e63946'), -spec.length / 2, 7, -spec.width / 2 + 5, group);
    box(2, 3, 4, basic('#e63946'), -spec.length / 2, 7, spec.width / 2 - 5, group);
    let lamps = null;
    if (car.kind === 'police') {
      box(14, 3, 10, tyreMat, 0, 21, 0, group);
      const lampA = new THREE.MeshBasicMaterial({ color: 0xe63946 });
      const lampB = new THREE.MeshBasicMaterial({ color: 0x4361ee });
      const a = box(6, 3, 8, lampA, 0, 24, -4, group);
      const b = box(6, 3, 8, lampB, 0, 24, 4, group);
      a.castShadow = false;
      b.castShadow = false;
      lamps = { lampA, lampB };
    }
    if (car.kind === 'taxi') {
      box(12, 4, 8, basic('#ffb703'), 0, 21, 0, group);
    }
    group.userData.lamps = lamps;
    return group;
  }

  function buildPersonMesh(shirt, skin, kind) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, lambert(shirt));
    body.position.y = 9;
    body.castShadow = true;
    const head = new THREE.Mesh(headGeo, lambert(skin));
    head.position.y = 24;
    head.castShadow = true;
    group.add(body, head);
    if (kind === 'cop' || kind === 'player') {
      const cap = new THREE.Mesh(capGeo, lambert(kind === 'cop' ? '#14213d' : '#ffb703'));
      cap.position.y = 28;
      group.add(cap);
    }
    return group;
  }

  function resize() {
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    renderer.setPixelRatio(view.dpr);
    renderer.setSize(view.w, view.h, false);
    camera.aspect = view.w / view.h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  // Chase camera state. The camera snaps when the target jumps (scene
  // staging, respawn) and eases the rest of the time.
  const camPos = new THREE.Vector3(0, 400, 600);
  const lookAt = new THREE.Vector3(0, 0, 0);
  let cameraPlaced = false;
  // On-foot chase heading: follows the direction Lena actually walks, so
  // the camera stays behind her and buildings stop hiding her. While
  // driving it tracks the car's heading, so stepping out keeps the view.
  let walkHeading = null;
  let lastPX = null;
  let lastPY = null;
  const desiredPos = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const rayHit = new THREE.Vector3();
  const skyColor = new THREE.Color();
  const sunColor = new THREE.Color();
  const hemiSkyColor = new THREE.Color();
  const hemiGroundColor = new THREE.Color();

  function placeCamera(state, snap) {
    const cam = state.camera;
    const tx = cam.x - CENTER_X;
    const tz = cam.y - CENTER_Y;
    const car = playerCar(state);
    if (car) {
      walkHeading = walkHeading === null ? car.angle : lerpAngle(walkHeading, car.angle, 0.1);
      const fx = Math.cos(car.angle);
      const fz = Math.sin(car.angle);
      desiredPos.set(tx - fx * 420, 360, tz - fz * 420);
      desiredLook.set(tx + fx * 60, 0, tz + fz * 60);
    } else {
      const px = state.player.x;
      const py = state.player.y;
      if (lastPX === null) {
        lastPX = px;
        lastPY = py;
        walkHeading = state.player.angle || 0;
      } else {
        const dx = px - lastPX;
        const dy = py - lastPY;
        if (Math.hypot(dx, dy) > 1.5) {
          const heading = Math.atan2(dy, dx);
          walkHeading = walkHeading === null ? heading : lerpAngle(walkHeading, heading, 0.12);
        } else if (walkHeading === null) {
          walkHeading = state.player.angle || 0;
        }
        lastPX = px;
        lastPY = py;
      }
      const fx = Math.cos(walkHeading);
      const fz = Math.sin(walkHeading);
      desiredPos.set(tx - fx * 240, 430, tz - fz * 240);
      desiredLook.set(tx + fx * 40, 0, tz + fz * 40);
    }
    if (snap || !cameraPlaced || desiredPos.distanceTo(camPos) > 500) {
      camPos.copy(desiredPos);
      lookAt.copy(desiredLook);
      cameraPlaced = true;
    } else {
      camPos.lerp(desiredPos, 0.14);
      lookAt.lerp(desiredLook, 0.2);
    }
    const shakeX = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 0.6 : 0;
    const shakeZ = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 0.6 : 0;
    camera.position.set(camPos.x + shakeX, camPos.y, camPos.z + shakeZ);
    camera.lookAt(lookAt);
    const targetFov = car ? 55 + Math.min(10, Math.abs(car.speed || 0) / 55) : 55;
    if (Math.abs(camera.fov - targetFov) > 0.5) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
    sun.position.set(tx + 420, 620, tz + 320);
    sun.target.position.set(tx, 0, tz);
  }

  function applyLighting(state) {
    const blend = lightingBlend(state.clockMinutes || 0, state.dusk);
    const { from, to, t } = blend;
    skyColor.set(from.sky).lerp(sunColor.set(to.sky), t);
    scene.background.copy(skyColor);
    scene.fog.color.copy(skyColor);
    scene.fog.near = lerp(from.fogNear, to.fogNear, t);
    scene.fog.far = lerp(from.fogFar, to.fogFar, t);
    sun.color.copy(sunColor.set(from.sun).lerp(new THREE.Color(to.sun), t));
    sun.intensity = lerp(from.sunI, to.sunI, t);
    hemi.color.copy(hemiSkyColor.set(from.hemiSky).lerp(new THREE.Color(to.hemiSky), t));
    hemi.groundColor.copy(hemiGroundColor.set(from.hemiGround).lerp(new THREE.Color(to.hemiGround), t));
    hemi.intensity = lerp(from.hemiI, to.hemiI, t);
    renderer.toneMappingExposure = lerp(from.exposure, to.exposure, t);
  }

  function toWorld(sx, sy, state) {
    if (!cameraPlaced) placeCamera(state, true);
    raycaster.setFromCamera(new THREE.Vector2((sx / view.w) * 2 - 1, -(sy / view.h) * 2 + 1), camera);
    const hit = raycaster.ray.intersectPlane(groundPlane, rayHit);
    if (!hit) return { x: state.camera.x, y: state.camera.y };
    return { x: hit.x + CENTER_X, y: hit.z + CENTER_Y };
  }

  function draw(state) {
    if (cityBuilt !== state.city) buildCity(state.city);
    applyLighting(state);
    placeCamera(state, false);

    for (const [drop, mesh] of cashMeshes) {
      mesh.visible = !drop.taken;
      if (mesh.visible) {
        mesh.position.y = 6 + Math.sin(state.time * 3 + drop.x) * 2;
        mesh.rotation.y = state.time + drop.x;
      }
    }

    const heroCar = playerCar(state);
    const seenCars = new Set();
    for (const car of state.cars) {
      let group = carMeshes.get(car);
      if (!group) {
        group = buildCarMesh(car);
        carMeshes.set(car, group);
        dynamicGroup.add(group);
      }
      seenCars.add(car);
      group.position.set(car.x - CENTER_X, 0, car.y - CENTER_Y);
      group.rotation.y = -car.angle;
      const lamps = group.userData.lamps;
      if (lamps) {
        const flash = Math.floor(state.time * 6) % 2 === 0;
        lamps.lampA.color.set(flash ? 0xe63946 : 0x4361ee);
        lamps.lampB.color.set(flash ? 0x4361ee : 0xe63946);
      }
    }
    for (const [car, group] of carMeshes) {
      if (!seenCars.has(car)) {
        dynamicGroup.remove(group);
        carMeshes.delete(car);
      }
    }

    const seenPeds = new Set();
    for (const ped of state.peds) {
      let group = pedMeshes.get(ped);
      if (!group) {
        group = buildPersonMesh(ped.shirt, ped.skin, ped.kind);
        pedMeshes.set(ped, group);
        dynamicGroup.add(group);
      }
      seenPeds.add(ped);
      const bob = Math.sin(ped.phase || 0) * 1.5;
      if (ped.down > 0) {
        group.position.set(ped.x - CENTER_X, 5, ped.y - CENTER_Y);
        group.rotation.set(1.4, -ped.angle, 0);
      } else {
        group.position.set(ped.x - CENTER_X, bob * 0.3, ped.y - CENTER_Y);
        group.rotation.set(0, -ped.angle, 0);
      }
    }
    for (const [ped, group] of pedMeshes) {
      if (!seenPeds.has(ped)) {
        dynamicGroup.remove(group);
        pedMeshes.delete(ped);
      }
    }

    if (!playerMesh) {
      playerMesh = buildPersonMesh('#fb8500', '#c68642', 'player');
      dynamicGroup.add(playerMesh);
      playerRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
      playerRing.rotation.x = -Math.PI / 2;
      dynamicGroup.add(playerRing);
      aimLine = box(24, 1, 2, basic('#1d130c'), 0, 2, 0, dynamicGroup);
      aimLine.castShadow = false;
      carRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
      carRing.rotation.x = -Math.PI / 2;
      carRing.scale.set(1.4, 1.4, 1);
      dynamicGroup.add(carRing);
    }
    const player = state.player;
    if (player.onFoot) {
      playerMesh.visible = true;
      playerRing.visible = true;
      aimLine.visible = true;
      carRing.visible = false;
      const bob = Math.sin(player.walkPhase || 0) * 1.5;
      playerMesh.position.set(player.x - CENTER_X, bob * 0.3, player.y - CENTER_Y);
      playerMesh.rotation.y = -player.angle;
      playerRing.position.set(player.x - CENTER_X, 1, player.y - CENTER_Y);
      aimLine.position.set(player.x + Math.cos(player.angle) * 14 - CENTER_X, 2, player.y + Math.sin(player.angle) * 14 - CENTER_Y);
      aimLine.rotation.y = -player.angle;
    } else {
      playerMesh.visible = false;
      playerRing.visible = false;
      aimLine.visible = false;
      carRing.visible = !!heroCar;
      if (heroCar) carRing.position.set(heroCar.x - CENTER_X, 1, heroCar.y - CENTER_Y);
    }

    const marker = missionMarker(state);
    markerGroup.visible = !!marker;
    if (marker) {
      markerGroup.position.set(marker.x - CENTER_X, 0, marker.y - CENTER_Y);
      markerDiamond.rotation.y = state.time * 2;
      markerDiamond.position.y = 60 + Math.sin(state.time * 4) * 6;
      sideDot.visible = !!(state.sideJob && state.sideJob.active && state.sideJob.target);
      if (sideDot.visible) {
        sideDot.position.set(state.sideJob.target.x - marker.x, 40, state.sideJob.target.y - marker.y);
      }
    }

    for (let i = 0; i < state.bullets.length; i += 1) {
      let mesh = bulletPool[i];
      if (!mesh) {
        mesh = new THREE.Mesh(bulletGeo, basic('#fff3b0'));
        bulletPool[i] = mesh;
        dynamicGroup.add(mesh);
      }
      mesh.visible = true;
      mesh.position.set(state.bullets[i].x - CENTER_X, 12, state.bullets[i].y - CENTER_Y);
    }
    for (let i = state.bullets.length; i < bulletPool.length; i += 1) bulletPool[i].visible = false;

    for (let i = 0; i < state.particles.length; i += 1) {
      const p = state.particles[i];
      let mesh = particlePool[i];
      if (!mesh) {
        mesh = new THREE.Mesh(particleGeo, new THREE.MeshBasicMaterial({ color: p.color, transparent: true }));
        particlePool[i] = mesh;
        dynamicGroup.add(mesh);
      }
      mesh.visible = true;
      mesh.material.color.set(p.color);
      mesh.material.opacity = Math.max(0, p.life / p.maxLife);
      mesh.scale.setScalar(Math.max(0.5, p.size));
      mesh.position.set(p.x - CENTER_X, 8, p.y - CENTER_Y);
    }
    for (let i = state.particles.length; i < particlePool.length; i += 1) particlePool[i].visible = false;

    for (let i = 0; i < state.skids.length; i += 1) {
      const skid = state.skids[i];
      let mesh = skidPool[i];
      if (!mesh) {
        mesh = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ color: 0x1e1e1e, transparent: true }));
        mesh.scale.set(28, 0.5, 5);
        skidPool[i] = mesh;
        dynamicGroup.add(mesh);
      }
      mesh.visible = true;
      mesh.material.opacity = 0.35 * (skid.life / 5);
      mesh.position.set(skid.x - CENTER_X, 0.3, skid.y - CENTER_Y);
      mesh.rotation.y = -skid.angle;
    }
    for (let i = state.skids.length; i < skidPool.length; i += 1) skidPool[i].visible = false;

    renderer.render(scene, camera);
  }

  return { draw, resize, toWorld, view };
}
