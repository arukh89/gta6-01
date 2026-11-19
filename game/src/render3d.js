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
import { RACE, missionMarker } from './missions.js';
import { CREW_JOBS, crewJobStartPoints } from './missions.js';
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
  night: { sky: 0x232a4a, sun: 0x8fa8d0, sunI: 0.6, hemiSky: 0x4a5a8a, hemiGround: 0x2a2a3a, hemiI: 0.65, fogNear: 700, fogFar: 1800, exposure: 0.95 },
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

/** Searchlight strength: none in bright day, ramping up through golden
 * hour, full at night; dusk shots get a strong beam too. */
function nightFactor(minutes, dusk) {
  if (dusk) return 0.85;
  if (minutes < 5 * 60) return 1;
  if (minutes < 17 * 60) return 0;
  if (minutes < 19 * 60) return (minutes - 17 * 60) / 120;
  return 1;
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
  // A person is a torso (shirt) over legs (trousers), so an outfit reads
  // as more than one colour; hats get their own geometry below (a cap
  // cylinder, a wide brim disc, a dome for the wide hat's crown).
  const torsoGeo = new THREE.CylinderGeometry(7, 7.5, 12, 8);
  const legsGeo = new THREE.CylinderGeometry(6.5, 7, 6, 8);
  const capGeo = new THREE.CylinderGeometry(6, 6, 3, 10);
  const brimGeo = new THREE.CylinderGeometry(9.5, 9.5, 1, 12);
  const domeGeo = new THREE.SphereGeometry(4.5, 10, 8);
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
  const tapeMeshes = new Map();

  function box(w, h, d, mat, x, y, z, parent) {
    const mesh = new THREE.Mesh(unitBox, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** A small rooftop feature on the highest face, sized to it, so the
   * silhouettes differ even from the chase cam. */
  function addRoofDetail(kind, x, topY, z, tw, th) {
    const s = Math.min(tw, th);
    if (kind === 'ac') {
      box(Math.min(12, tw * 0.4), 4, Math.min(9, th * 0.4), lambert('#9aa0a6'), x, topY + 2, z, cityGroup);
    } else if (kind === 'antenna') {
      box(2, 26, 2, lambert('#3a3a3a'), x, topY + 13, z, cityGroup);
      box(4, 2, 4, basic('#ff5d8f'), x, topY + 27, z, cityGroup);
    } else if (kind === 'helipad') {
      const r = Math.max(4, s * 0.32);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2, 12), lambert('#e8e8e8'));
      pad.position.set(x, topY + 1, z);
      pad.castShadow = true;
      cityGroup.add(pad);
      buildingGeometries.push(pad.geometry);
      box(r * 1.4, 1, 2, basic('#e63946'), x, topY + 2.5, z, cityGroup);
    } else if (kind === 'garden') {
      box(tw * 0.45, 3, th * 0.45, lambert('#2a7d4f'), x, topY + 1.5, z, cityGroup);
      box(6, 5, 6, lambert('#40916c'), x + tw * 0.15, topY + 4, z, cityGroup);
    } else if (kind === 'watertower') {
      box(2, 10, 2, lambert('#6c757d'), x, topY + 5, z, cityGroup);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(3, s * 0.18), Math.max(3, s * 0.18), 9, 8), lambert('#adb5bd'));
      tank.position.set(x, topY + 14, z);
      tank.castShadow = true;
      cityGroup.add(tank);
      buildingGeometries.push(tank.geometry);
    }
  }

  function buildCity(city) {
    for (const child of [...cityGroup.children]) cityGroup.remove(child);
    for (const geo of buildingGeometries) geo.dispose();
    buildingGeometries = [];
    signMeshes.length = 0;
    cashMeshes.clear();
    tapeMeshes.clear();
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
      const upH = b.upper ? b.upper.height : 0;
      const baseH3 = (b.height - upH) * HEIGHT_SCALE;
      const geo = windowedBoxGeometry(b.w, baseH3, b.h);
      buildingGeometries.push(geo);
      const mesh = new THREE.Mesh(geo, [facade(b.color), facade(b.color), roof(b.color), roof(b.color), facade(b.color), facade(b.color)]);
      mesh.position.set(b.x + b.w / 2 - CENTER_X, baseH3 / 2, b.y + b.h / 2 - CENTER_Y);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      cityGroup.add(mesh);
      // Stepped / podium upper storey: a narrower windowed box on the base
      // roof, strictly inside the base footprint.
      if (b.upper) {
        const u = b.upper;
        const uh3 = u.height * HEIGHT_SCALE;
        const ugeo = windowedBoxGeometry(u.w, uh3, u.h);
        buildingGeometries.push(ugeo);
        const umesh = new THREE.Mesh(ugeo, [facade(b.color), facade(b.color), roof(b.color), roof(b.color), facade(b.color), facade(b.color)]);
        umesh.position.set(u.x + u.w / 2 - CENTER_X, baseH3 + uh3 / 2, u.y + u.h / 2 - CENTER_Y);
        umesh.castShadow = true;
        umesh.receiveShadow = true;
        cityGroup.add(umesh);
      }
      // L wing: a second windowed box at ground level, same palette.
      if (b.arm) {
        const a = b.arm;
        const ah3 = a.height * HEIGHT_SCALE;
        const ageo = windowedBoxGeometry(a.w, ah3, a.h);
        buildingGeometries.push(ageo);
        const amesh = new THREE.Mesh(ageo, [facade(b.color), facade(b.color), roof(b.color), roof(b.color), facade(b.color), facade(b.color)]);
        amesh.position.set(a.x + a.w / 2 - CENTER_X, ah3 / 2, a.y + a.h / 2 - CENTER_Y);
        amesh.castShadow = true;
        amesh.receiveShadow = true;
        cityGroup.add(amesh);
      }
      // Rooftop feature on the highest face (the upper storey when there
      // is one, otherwise the base roof).
      if (b.roof) {
        const top = b.upper || b;
        addRoofDetail(b.roof.kind, top.x + b.roof.fx * top.w - CENTER_X, b.height * HEIGHT_SCALE, top.y + b.roof.fy * top.h - CENTER_Y, top.w, top.h);
      }
      if (b.sign) {
        // The sign hangs on the base face, so its height is the base's.
        const sign = box(b.w * 0.6, 4, 2, basic(b.sign), b.x + b.w / 2 - CENTER_X, baseH3 * 0.55, b.y + b.h + 2 - CENTER_Y, cityGroup);
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
      // Cabin by boat variant: a speedboat gets a pale canopy, a skiff
      // keeps the red cabin.
      const cabin = boat.variant === 'speedboat'
        ? box(20, 6, 12, lambert('#8ecae6'), boat.x - CENTER_X, 11, boat.y - CENTER_Y, cityGroup)
        : box(16, 10, 12, lambert('#e63946'), boat.x - CENTER_X, 12, boat.y - CENTER_Y, cityGroup);
      cabin.rotation.y = -boat.angle;
    }

    // Street props: the same kinds the 2D renderer draws, as low-poly
    // groups — billboards and neon signs on poles, vendor carts with
    // awnings, benches, hydrants, planters, lifeguard towers, crates,
    // dock posts, picnic tables and mailboxes.
    for (const item of city.props) {
      const x = item.x - CENTER_X;
      const z = item.y - CENTER_Y;
      if (item.kind === 'billboard' || item.kind === 'neon-sign') {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 30, 6), trunkMat);
        pole.position.set(x, 15, z);
        cityGroup.add(pole);
        buildingGeometries.push(pole.geometry);
        const board = box(30, 14, 2, basic(item.color), x, 36, z, cityGroup);
        board.rotation.y = item.angle;
        board.castShadow = false;
      } else if (item.kind === 'vendor') {
        box(18, 8, 12, lambert('#6d4c41'), x, 4, z, cityGroup);
        const awn = box(22, 2, 14, lambert(item.color), x, 10, z, cityGroup);
        awn.rotation.y = item.angle;
      } else if (item.kind === 'bench') {
        box(22, 2, 5, lambert(item.color), x, 3, z, cityGroup);
        box(22, 5, 2, lambert(item.color), x, 6, z + 3, cityGroup);
      } else if (item.kind === 'hydrant') {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.5, 8, 8), lambert(item.color));
        body.position.set(x, 4, z);
        body.castShadow = true;
        cityGroup.add(body);
        buildingGeometries.push(body.geometry);
      } else if (item.kind === 'planter') {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(7, 5, 6, 8), lambert('#8d5524'));
        pot.position.set(x, 3, z);
        cityGroup.add(pot);
        buildingGeometries.push(pot.geometry);
        const bush = new THREE.Mesh(new THREE.SphereGeometry(6, 8, 6), leafMat);
        bush.position.set(x, 9, z);
        bush.castShadow = true;
        cityGroup.add(bush);
        buildingGeometries.push(bush.geometry);
      } else if (item.kind === 'lifeguard') {
        for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
          box(2, 16, 2, lambert('#8d5524'), x + dx, 8, z + dz, cityGroup);
        }
        box(16, 6, 12, lambert('#f8f9fa'), x, 19, z, cityGroup);
        box(18, 2, 14, lambert(item.color), x, 23, z, cityGroup);
      } else if (item.kind === 'crate') {
        box(14, 10, 14, lambert(item.color), x, 5, z, cityGroup);
        box(10, 8, 10, lambert(item.color), x + 2, 14, z - 2, cityGroup);
      } else if (item.kind === 'dockpost') {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 8, 6), lambert('#3a3a3a'));
        post.position.set(x, 4, z);
        cityGroup.add(post);
        buildingGeometries.push(post.geometry);
      } else if (item.kind === 'picnic') {
        box(24, 2, 10, lambert(item.color), x, 4, z, cityGroup);
        box(24, 2, 4, lambert(item.color), x, 3, z - 8, cityGroup);
        box(24, 2, 4, lambert(item.color), x, 3, z + 8, cityGroup);
      } else if (item.kind === 'mailbox') {
        box(2, 12, 2, lambert('#3a3a3a'), x, 6, z, cityGroup);
        box(10, 8, 6, lambert(item.color), x, 16, z, cityGroup);
      }
    }

    for (const drop of city.cashDrops) {
      const mesh = box(16, 6, 16, basic('#b7efc5'), drop.x - CENTER_X, 6, drop.y - CENTER_Y, cityGroup);
      mesh.castShadow = false;
      cashMeshes.set(drop, mesh);
    }
    for (const tape of city.tapes) {
      const mesh = box(12, 4, 12, basic('#ffd60a'), tape.x - CENTER_X, 6, tape.y - CENTER_Y, cityGroup);
      mesh.castShadow = false;
      tapeMeshes.set(tape, mesh);
    }
    // Cielo Arms sign: a green-lit board on a pole at the gun shop.
    box(2, 40, 2, lambert('#3a3a3a'), city.gunShop.x - CENTER_X, 20, city.gunShop.y - CENTER_Y, cityGroup);
    box(26, 9, 2, basic('#2a9d8f'), city.gunShop.x - CENTER_X, 42, city.gunShop.y - CENTER_Y, cityGroup);
    cityBuilt = city;
  }

  // Pooled dynamic meshes, keyed by the simulated object itself.
  const carMeshes = new Map();
  const pedMeshes = new Map();
  let playerMesh = null;
  let playerMeshShirt = null;
  // The player mesh is rebuilt on a character switch, so it tracks which
  // character it was built for and that character's height and build.
  let playerMeshChar = null;
  let playerMeshScale = 1;
  let playerMeshBuild = 1;
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
  // Street-race start marker: a purple octahedron over the start line while
  // no race is running.
  const raceMarker = new THREE.Mesh(markerGeo, basic('#9b5de5'));
  raceMarker.position.y = 50;
  dynamicGroup.add(raceMarker);

  // Crew-job start markers: one gold octahedron per job that can be
  // started now (at most four); they float and spin over their start points.
  const crewMarkers = CREW_JOBS.map(() => {
    const m = new THREE.Mesh(markerGeo, basic('#ffb703'));
    m.position.y = 50;
    dynamicGroup.add(m);
    return m;
  });

  // Darts: a board on the Neon Club, always there. Range targets at
  // Cielo Arms: five posts with red discs, up only while a range game runs.
  const dartBoard = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 3, 24), basic('#f8f9fa'));
  dartBoard.rotation.x = Math.PI / 2;
  const dartBull = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 4, 16), basic('#e63946'));
  dartBull.rotation.x = Math.PI / 2;
  dynamicGroup.add(dartBoard, dartBull);
  const rangeTargets = [];
  for (let i = 0; i < 5; i += 1) {
    const group = new THREE.Group();
    box(4, 30, 4, lambert('#3a3a3a'), 0, 15, 0, group);
    const disc = new THREE.Mesh(new THREE.SphereGeometry(12, 12, 10), basic('#e63946'));
    disc.position.y = 36;
    group.add(disc);
    group.visible = false;
    dynamicGroup.add(group);
    rangeTargets.push({ group, disc });
  }

  // Police helicopter, built lazily the first time one spawns: body, tail,
  // skids and a spinning rotor, plus a searchlight cone, a light pool on
  // the ground, and a real spotlight for the night.
  let heliGroup = null;
  let heliRotor = null;
  let heliCone = null;
  let heliDisc = null;
  let heliSpot = null;
  let heliSpotTarget = null;
  const heliUp = new THREE.Vector3(0, 1, 0);
  const heliDir = new THREE.Vector3();
  const heliNeg = new THREE.Vector3();
  const heliMid = new THREE.Vector3();
  const heliPos = new THREE.Vector3();
  const groundPos = new THREE.Vector3();

  function buildHeli() {
    heliGroup = new THREE.Group();
    box(46, 12, 20, lambert('#1d3557'), 0, 0, 0, heliGroup);
    box(46, 3, 21, basic('#f8f9fa'), 0, 2, 0, heliGroup);
    box(38, 5, 5, lambert('#1d3557'), -40, 2, 0, heliGroup);
    box(2, 12, 8, lambert('#1d3557'), -58, 6, 0, heliGroup);
    box(30, 2, 3, tyreMat, 0, -9, -9, heliGroup);
    box(30, 2, 3, tyreMat, 0, -9, 9, heliGroup);
    heliRotor = new THREE.Group();
    box(76, 1.5, 5, tyreMat, 0, 0, 0, heliRotor);
    box(5, 1.5, 76, tyreMat, 0, 0, 0, heliRotor);
    heliRotor.position.y = 9;
    heliGroup.add(heliRotor);
    dynamicGroup.add(heliGroup);
    const coneGeo = new THREE.ConeGeometry(80, 1, 20, 1, true);
    heliCone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    dynamicGroup.add(heliCone);
    heliDisc = new THREE.Mesh(new THREE.CircleGeometry(70, 24), new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    heliDisc.rotation.x = -Math.PI / 2;
    dynamicGroup.add(heliDisc);
    heliSpot = new THREE.SpotLight(0xfff2c0, 0, 1100, 0.45, 0.6, 1);
    heliSpotTarget = new THREE.Object3D();
    scene.add(heliSpotTarget);
    heliSpot.target = heliSpotTarget;
    scene.add(heliSpot);
  }

  function buildCarMesh(car) {
    const spec = VEHICLES[car.kind];
    const group = new THREE.Group();
    // A van is a tall box; everything else keeps the low body.
    const bodyH = car.kind === 'van' ? 16 : 10;
    const bodyY = car.kind === 'van' ? 10 : 7;
    const body = box(spec.length, bodyH, spec.width, lambert(car.color), 0, bodyY, 0, group);
    void body;
    // A boat floats: no tyres and no glass roofline — a red cabin on a
    // skiff, a pale canopy on a speedboat.
    if (car.kind === 'boat') {
      if (car.variant === 'speedboat') {
        box(spec.length * 0.3, 6, spec.width * 0.6, lambert('#f8f9fa'), -spec.length * 0.05, 15, 0, group);
      } else {
        box(spec.length * 0.28, 8, spec.width * 0.6, lambert('#e63946'), -spec.length * 0.05, 16, 0, group);
      }
    } else {
      // Cabin by body shape: a truck's cab sits ahead of its open bed,
      // a van's glass rides on its tall roof, a hatch is short with
      // its cabin pushed forward.
      if (car.kind === 'truck') {
        box(spec.length * 0.38, 8, spec.width * 0.78, glassMat, spec.length * 0.24, 15, 0, group);
        box(spec.length * 0.36, 2, spec.width * 0.8, lambert('#2b2b2b'), -spec.length * 0.3, 11, 0, group);
        box(spec.length * 0.36, 5, 2, lambert(car.color), -spec.length * 0.3, 14.5, -spec.width / 2 + 1, group);
        box(spec.length * 0.36, 5, 2, lambert(car.color), -spec.length * 0.3, 14.5, spec.width / 2 - 1, group);
        box(2, 5, spec.width * 0.8, lambert(car.color), -spec.length / 2 + 1, 14.5, 0, group);
      } else if (car.kind === 'van') {
        box(spec.length * 0.5, 8, spec.width * 0.78, glassMat, -spec.length * 0.05, 22, 0, group);
      } else if (car.kind === 'hatch') {
        box(spec.length * 0.35, 9, spec.width * 0.78, glassMat, spec.length * 0.1, 15, 0, group);
      } else {
        box(spec.length * 0.45, 9, spec.width * 0.78, glassMat, -spec.length * 0.05, 15, 0, group);
      }
      // A spoiler on the fast ones: sports and coupes wear a rear wing.
      if (car.kind === 'sports' || car.kind === 'coupe') {
        box(3, 2, spec.width * 0.9, tyreMat, -spec.length / 2 + 2, 14, 0, group);
      }
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          box(9, 9, 4, tyreMat, sx * spec.length * 0.32, 4.5, sz * (spec.width / 2), group);
        }
      }
    }
    // Patrol paint, from the car id: 0 = white doors, 1 = white side
    // stripe, 2 = white roof panel. Every cruiser reads differently.
    if (car.kind === 'police') {
      if (car.livery === 0) {
        box(12, 10.5, spec.width + 0.5, lambert('#f8f9fa'), 0, 7, 0, group);
      } else if (car.livery === 1) {
        box(spec.length * 0.6, 3, 1, lambert('#f8f9fa'), 0, 9, -spec.width / 2 - 0.5, group);
        box(spec.length * 0.6, 3, 1, lambert('#f8f9fa'), 0, 9, spec.width / 2 + 0.5, group);
      } else {
        box(spec.length * 0.34, 2, spec.width * 0.72, lambert('#f8f9fa'), -spec.length * 0.05, 20, 0, group);
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

  // A floating name tag for a named local: one small canvas per name,
  // drawn once and shared by every sprite that shows it.
  const nameTexCache = new Map();
  function makeNameSprite(name) {
    let tex = nameTexCache.get(name);
    if (!tex) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 56;
      const g = c.getContext('2d');
      g.font = '700 30px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(0,0,0,0.8)';
      g.strokeText(name, 128, 28);
      g.fillStyle = '#fff';
      g.fillText(name, 128, 28);
      tex = new THREE.CanvasTexture(c);
      nameTexCache.set(name, tex);
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(56, 12, 1);
    sprite.position.y = 44;
    return sprite;
  }

  /** Add a hat to a person mesh. Cops keep the dark cap, the player keeps
   * the gold one (the marker); walkers wear their own style and colour. */
  function addHat(group, hatKind, hatColor) {
    if (hatKind === 'cap') {
      const cap = new THREE.Mesh(capGeo, lambert(hatColor));
      cap.position.y = 28;
      group.add(cap);
    } else if (hatKind === 'beanie') {
      const beanie = new THREE.Mesh(headGeo, lambert(hatColor));
      beanie.position.y = 27.5;
      beanie.scale.set(1.15, 0.6, 1.15);
      group.add(beanie);
    } else if (hatKind === 'wide') {
      const brim = new THREE.Mesh(brimGeo, lambert(hatColor));
      brim.position.y = 27;
      const dome = new THREE.Mesh(domeGeo, lambert(hatColor));
      dome.position.y = 28;
      dome.scale.set(1, 0.7, 1);
      group.add(brim, dome);
    }
  }

  function buildPersonMesh(shirt, skin, kind, look) {
    const group = new THREE.Group();
    const v = look || {};
    const torso = new THREE.Mesh(torsoGeo, lambert(shirt));
    torso.position.y = 12;
    torso.castShadow = true;
    const legs = new THREE.Mesh(legsGeo, lambert(v.pants || '#3d405b'));
    legs.position.y = 3;
    legs.castShadow = true;
    const head = new THREE.Mesh(headGeo, lambert(skin));
    head.position.y = 24;
    head.castShadow = true;
    group.add(torso, legs, head);
    // The style varies, the colour marks the role.
    const hatKind = v.hat || (kind === 'cop' || kind === 'player' ? 'cap' : 'none');
    const hatColor = kind === 'cop' ? '#14213d' : kind === 'player' ? '#ffb703' : (v.hatColor || '#333');
    addHat(group, hatKind, hatColor);
    // Height and build: the whole figure scales, so a tall broad local
    // and a short slim one read as different people at a glance.
    const s = v.scale ?? 1;
    const b = v.build ?? 1;
    group.scale.set(s * b, s, s * b);
    if (v.name) {
      const label = makeNameSprite(v.name);
      group.userData.nameSprite = label;
      group.add(label);
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
    // First-person camera: at Lena's eye, looking where she looks —
    // or over the hood when driving. The player mesh hides itself.
    if (state.firstPerson) {
      const px = state.player.x - CENTER_X;
      const pz = state.player.y - CENTER_Y;
      const a = state.player.angle;
      const fpCar = playerCar(state);
      const eye = fpCar ? 24 : 26 + (state.player.z || 0);
      camera.position.set(px + Math.cos(a) * 4, eye, pz + Math.sin(a) * 4);
      camera.lookAt(px + Math.cos(a) * 120, eye - 3, pz + Math.sin(a) * 120);
      if (Math.abs(camera.fov - 62) > 0.5) {
        camera.fov = 62;
        camera.updateProjectionMatrix();
      }
      sun.position.set(tx + 420, 620, tz + 320);
      sun.target.position.set(tx, 0, tz);
      cameraPlaced = true;
      return;
    }
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

    for (const [tape, mesh] of tapeMeshes) {
      mesh.visible = !tape.taken;
      if (mesh.visible) {
        mesh.position.y = 6 + Math.sin(state.time * 3.4 + tape.x) * 2;
        mesh.rotation.y = state.time * 1.3 + tape.x;
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
        group = buildPersonMesh(ped.shirt, ped.skin, ped.kind, ped);
        pedMeshes.set(ped, group);
        dynamicGroup.add(group);
      }
      seenPeds.add(ped);
      const bob = Math.sin(ped.phase || 0) * 1.5;
      if (ped.down > 0) {
        // A dead body sinks into the ground over its last two seconds.
        const sink = ped.dead ? Math.min(2, Math.max(0, 2 - ped.down)) * 2.5 : 0;
        group.position.set(ped.x - CENTER_X, 5 - sink, ped.y - CENTER_Y);
        group.rotation.set(1.4, -ped.angle, 0);
      } else {
        group.position.set(ped.x - CENTER_X, bob * 0.3, ped.y - CENTER_Y);
        group.rotation.set(0, -ped.angle, 0);
      }
      // A name tag only stands while its owner does.
      const tag = group.userData.nameSprite;
      if (tag) tag.visible = ped.down <= 0;
    }
    for (const [ped, group] of pedMeshes) {
      if (!seenPeds.has(ped)) {
        dynamicGroup.remove(group);
        pedMeshes.delete(ped);
      }
    }

    // The player mesh is rebuilt when the shirt changes or the character
    // switches: the ring, aim line and car ring are built once only.
    const shirt = state.player.shirt || '#fb8500';
    if (!playerMesh || playerMeshShirt !== shirt || playerMeshChar !== state.character) {
      if (playerMesh) dynamicGroup.remove(playerMesh);
      playerMesh = buildPersonMesh(shirt, state.player.skin || '#c68642', 'player', state.player);
      playerMeshShirt = shirt;
      playerMeshChar = state.character;
      playerMeshScale = state.player.scale ?? 1;
      playerMeshBuild = state.player.build ?? 1;
      dynamicGroup.add(playerMesh);
    }
    if (!playerRing) {
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
      // First-person hides Lena herself; cover crouches her; a jump lifts her.
      playerMesh.visible = !state.firstPerson;
      playerRing.visible = !state.firstPerson;
      aimLine.visible = !state.firstPerson;
      carRing.visible = false;
      const bob = Math.sin(player.walkPhase || 0) * 1.5;
      playerMesh.position.set(player.x - CENTER_X, (player.z || 0) + bob * 0.3, player.y - CENTER_Y);
      playerMesh.rotation.y = -player.angle;
      // Height and build scale the figure; cover crouches it (the Y
      // scale drops), a jump lifts it. X and Z scale by height × build.
      const sy = playerMeshScale * (player.cover ? 0.62 : 1);
      playerMesh.scale.set(playerMeshScale * playerMeshBuild, sy, playerMeshScale * playerMeshBuild);
      playerRing.position.set(player.x - CENTER_X, 1, player.y - CENTER_Y);
      aimLine.position.set(player.x + Math.cos(player.angle) * 14 - CENTER_X, 2, player.y + Math.sin(player.angle) * 14 - CENTER_Y);
      aimLine.rotation.y = -player.angle;
    } else {
      playerMesh.visible = false;
      playerRing.visible = false;
      aimLine.visible = false;
      carRing.visible = !!heroCar && !state.firstPerson;
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

    raceMarker.visible = !!(state.race && !state.race.active);
    if (raceMarker.visible) {
      raceMarker.position.set(RACE.start.x - CENTER_X, 50 + Math.sin(state.time * 3) * 4, RACE.start.y - CENTER_Y);
      raceMarker.rotation.y = state.time * 1.5;
    }

    // Crew-job markers: one per startable job, floating and spinning over
    // its start point; the extras hide when fewer jobs are open.
    const crewStarts = crewJobStartPoints(state);
    crewMarkers.forEach((m, i) => {
      m.visible = i < crewStarts.length;
      if (m.visible) {
        m.position.set(crewStarts[i].x - CENTER_X, 50 + Math.sin(state.time * 3 + i) * 4, crewStarts[i].y - CENTER_Y);
        m.rotation.y = state.time * 1.5 + i;
      }
    });

    // Darts board on the Neon Club, and the range targets while a game runs.
    dartBoard.position.set(state.city.property.x - CENTER_X, 24, state.city.property.y - CENTER_Y);
    dartBull.position.set(state.city.property.x - CENTER_X, 24, state.city.property.y + 2 - CENTER_Y);
    const mg = state.minigame;
    const rangeOn = !!(mg && mg.active && mg.kind === 'range');
    rangeTargets.forEach((t, i) => {
      const target = rangeOn ? mg.targets[i] : null;
      t.group.visible = !!target;
      if (!target) return;
      t.group.position.set(target.x - CENTER_X, 0, target.y - CENTER_Y);
      t.disc.position.y = target.down ? 8 : 36;
    });

    if (state.heli) {
      if (!heliGroup) buildHeli();
      heliGroup.visible = true;
      heliPos.set(state.heli.x - CENTER_X, state.heli.z, state.heli.y - CENTER_Y);
      heliGroup.position.copy(heliPos);
      heliGroup.rotation.y = -state.heli.angle;
      // A shot-down helicopter rolls as it falls.
      heliGroup.rotation.z = state.heli.mode === 'crashing' ? 0.5 : 0;
      heliRotor.rotation.y = state.heli.rotor;
      const f = nightFactor(state.clockMinutes || 0, state.dusk);
      groundPos.set(state.player.x - CENTER_X, 0, state.player.y - CENTER_Y);
      heliDir.copy(groundPos).sub(heliPos);
      const beamLen = heliDir.length();
      heliDir.normalize();
      heliCone.visible = f > 0.05;
      if (heliCone.visible) {
        heliMid.copy(heliPos).addScaledVector(heliDir, beamLen / 2);
        heliCone.position.copy(heliMid);
        heliNeg.copy(heliDir).negate();
        heliCone.quaternion.setFromUnitVectors(heliUp, heliNeg);
        heliCone.scale.set(1, beamLen, 1);
        heliCone.material.opacity = 0.22 * f;
      }
      heliDisc.visible = f > 0.05;
      if (heliDisc.visible) {
        heliDisc.position.set(groundPos.x, 1, groundPos.z);
        heliDisc.material.opacity = 0.28 * f;
      }
      heliSpot.intensity = 900 * f;
      heliSpot.position.copy(heliPos);
      heliSpotTarget.position.copy(groundPos);
    } else if (heliGroup) {
      heliGroup.visible = false;
      heliCone.visible = false;
      heliDisc.visible = false;
      heliSpot.intensity = 0;
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
