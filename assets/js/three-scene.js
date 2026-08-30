import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const GRID_SIZE = 20;
const GRID_LINE_COLOR = 0x4f8f5c;
const GRID_IDLE_OPACITY = 0.07;
const GRID_ACTIVE_OPACITY = 0.4;
const HIGHLIGHT_COLOR = 0xff9f43;
const HIGHLIGHT_OPACITY = 0.85;
const HIGHLIGHT_HOLD_MS = 400;
const HIGHLIGHT_FADE_MS = 600;
const CLICK_DRAG_THRESHOLD = 5;
const CAMERA_POLAR_DEG = 50;
const CAMERA_AZIMUTH_DEG = 45;
const CAMERA_DISTANCE = 22;
const TREE_CHANCE = 0.22;
const TREE_TRUNK_COLOR = 0x8a5a3c;
const TREE_FOLIAGE_COLOR = 0x3f8f4f;
const DEFAULT_MESSAGE = 'Click a tile to inspect it.';
const MESSAGE_AUTO_HIDE_MS = 2500;

const GROUND_Y = 0;
const UNLOCKED_TILE_Y = 0.015;
const GRID_LINES_Y = 0.02;
const BUILDING_BASE_Y = 0.022;
const HIGHLIGHT_Y = 0.03;

let started = false;

function tileKey(tileX, tileY) {
    return tileX + ',' + tileY;
}

function tileCenterWorld(tileX, tileY) {
    return {
        x: tileX - GRID_SIZE / 2 + 0.5,
        z: tileY - GRID_SIZE / 2 + 0.5,
    };
}

/**
 * Tiles covered by a building anchored at (anchorX, anchorY), given its
 * unrotated footprint size and placement rotation. Rotation swaps the
 * effective width/height at 90 and 270 degrees. Mirrors the PHP helper
 * of the same name in api/place-building.php and api/remove-building.php.
 */
function footprintTiles(anchorX, anchorY, tileWidth, tileHeight, rotation) {
    const swap = (rotation === 90 || rotation === 270);
    const effectiveWidth = swap ? tileHeight : tileWidth;
    const effectiveHeight = swap ? tileWidth : tileHeight;

    const tiles = [];
    for (let dx = 0; dx < effectiveWidth; dx++) {
        for (let dy = 0; dy < effectiveHeight; dy++) {
            tiles.push({ x: anchorX + dx, y: anchorY + dy });
        }
    }
    return tiles;
}

// Mirrors MAX_BUILDING_LEVEL / clampBuildingLevel() in includes/levels.php.
const MAX_BUILDING_LEVEL = 3;

function clampLevel(level) {
    const value = Number(level) || 1;
    return Math.min(Math.max(Math.round(value), 1), MAX_BUILDING_LEVEL);
}

// Lane count per road model. Doubles as the "is this a road?" test.
const ROAD_LANE_COUNTS = { road: 2, road_4lane: 4, road_6lane: 6 };

function isRoadModelKey(modelKey) {
    return Object.prototype.hasOwnProperty.call(ROAD_LANE_COUNTS, modelKey);
}

function footprintCenterWorld(anchorX, anchorY, tileWidth, tileHeight, rotation) {
    const swap = (rotation === 90 || rotation === 270);
    const effectiveWidth = swap ? tileHeight : tileWidth;
    const effectiveHeight = swap ? tileWidth : tileHeight;
    return tileCenterWorld(anchorX + (effectiveWidth - 1) / 2, anchorY + (effectiveHeight - 1) / 2);
}

function seededRandom(x, y, salt) {
    let seed = (x * 374761393 + y * 668265263 + (salt || 0) * 2147483647) | 0;
    seed = (seed ^ (seed >>> 13)) * 1274126177;
    seed = seed ^ (seed >>> 16);
    return ((seed >>> 0) % 100000) / 100000;
}

function formatCurrency(amount) {
    return '₹' + Math.round(Number(amount)).toLocaleString('en-IN');
}

const TERRAIN_INNER_RADIUS = 15;
const TERRAIN_OUTER_RADIUS = 40;

// ---- River course ----
// Defined at module scope because terrainHeight() carves a valley along it: the
// river has to sit *in* the land, not painted on top of whatever hill it crosses.

// Arcs past the city close enough to be a real landmark (roughly 22-30 units out,
// with the play area only reaching ~14) without ever touching buildable land.
const RIVER_CONTROL_POINTS = [
    [-58, -40], [-44, -30], [-33, -18], [-26, -4],
    [-24, 11], [-27, 24], [-20, 36], [-6, 44], [12, 49], [30, 52],
];

const RIVER_HALF_WIDTH = 2.6;   // water surface
const RIVER_BANK_WIDTH = 5.2;   // where the valley walls ease back to normal land
const RIVER_DEPTH = 2.1;

function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// Dense polyline along the course, used for both the distance field and the mesh.
const RIVER_SAMPLES = (function buildRiverSamples() {
    const pts = RIVER_CONTROL_POINTS;
    const samples = [];
    const stepsPerSegment = 14;

    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(i - 1, 0)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(i + 2, pts.length - 1)];

        for (let s = 0; s < stepsPerSegment; s++) {
            const t = s / stepsPerSegment;
            samples.push({
                x: catmullRom(p0[0], p1[0], p2[0], p3[0], t),
                z: catmullRom(p0[1], p1[1], p2[1], p3[1], t),
                // 0 at the source, 1 at the mouth — the river widens as it flows.
                flow: (i + t) / (pts.length - 1),
            });
        }
    }
    samples.push({ x: pts[pts.length - 1][0], z: pts[pts.length - 1][1], flow: 1 });

    return samples;
})();

// Bounding box of the whole course, so the per-vertex distance test can bail out
// immediately for the vast majority of the terrain that is nowhere near water.
const RIVER_BOUNDS = (function () {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    RIVER_SAMPLES.forEach(function (s) {
        if (s.x < minX) { minX = s.x; }
        if (s.x > maxX) { maxX = s.x; }
        if (s.z < minZ) { minZ = s.z; }
        if (s.z > maxZ) { maxZ = s.z; }
    });
    return { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ };
})();

function distanceToRiver(x, z) {
    const margin = 12;
    if (x < RIVER_BOUNDS.minX - margin || x > RIVER_BOUNDS.maxX + margin
        || z < RIVER_BOUNDS.minZ - margin || z > RIVER_BOUNDS.maxZ + margin) {
        return Infinity;
    }

    let best = Infinity;
    for (let i = 0; i < RIVER_SAMPLES.length; i++) {
        const dx = x - RIVER_SAMPLES[i].x;
        const dz = z - RIVER_SAMPLES[i].z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) {
            best = d2;
        }
    }
    return Math.sqrt(best);
}

function smoothstep(edge0, edge1, value) {
    const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
    return t * t * (3 - 2 * t);
}

// ---- Mountains ----
// Built into the terrain heightfield rather than dropped on top as separate cone
// meshes. Cones read as flat triangles no matter how they are shaded; a smooth
// radial profile with angular ridges and surface noise gives rounded, organic
// massifs that blend seamlessly into the surrounding hills.

const MOUNTAIN_PEAKS = (function buildPeaks() {
    const peaks = [];
    const count = 16;

    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + (seededRandom(i, 810, 1) - 0.5) * 0.5;
        const distance = 54 + seededRandom(i, 810, 2) * 30;

        peaks.push({
            x: Math.cos(angle) * distance,
            z: Math.sin(angle) * distance,
            height: 11 + seededRandom(i, 810, 3) * 14,
            radius: 15 + seededRandom(i, 810, 4) * 12,
            seed: seededRandom(i, 810, 5) * Math.PI * 2,
        });

        // A lower shoulder leaning against most peaks, so ridgelines form instead
        // of a ring of isolated bumps.
        if (seededRandom(i, 810, 6) > 0.35) {
            const shoulderAngle = angle + (seededRandom(i, 810, 7) - 0.5) * 0.55;
            const shoulderDist = distance * (0.82 + seededRandom(i, 810, 8) * 0.3);
            peaks.push({
                x: Math.cos(shoulderAngle) * shoulderDist,
                z: Math.sin(shoulderAngle) * shoulderDist,
                height: 6 + seededRandom(i, 810, 9) * 7,
                radius: 11 + seededRandom(i, 810, 10) * 8,
                seed: seededRandom(i, 810, 11) * Math.PI * 2,
            });
        }
    }

    return peaks;
})();

function mountainHeightAt(x, z) {
    let total = 0;

    for (let i = 0; i < MOUNTAIN_PEAKS.length; i++) {
        const peak = MOUNTAIN_PEAKS[i];
        const dx = x - peak.x;
        const dz = z - peak.z;
        const distanceSquared = dx * dx + dz * dz;

        if (distanceSquared >= peak.radius * peak.radius) {
            continue;
        }

        const distance = Math.sqrt(distanceSquared);
        const angle = Math.atan2(dz, dx);

        // Ridges push the outline in and out with angle so it is never a circle.
        const ridge = 1
            + Math.sin(angle * 3 + peak.seed) * 0.22
            + Math.sin(angle * 5 - peak.seed * 1.7) * 0.12;

        const effectiveRadius = peak.radius * Math.max(ridge, 0.4);
        const t = Math.min(distance / effectiveRadius, 1);

        // Rounded at the summit AND where it meets the ground — the key difference
        // from a cone, which is sharp at both.
        const profile = 1 - smoothstep(0, 1, t);

        // Coarse and fine surface relief so the slopes are not glassy.
        const relief = 1
            + Math.sin(x * 0.16 + peak.seed) * Math.cos(z * 0.14 - peak.seed) * 0.13
            + Math.sin(x * 0.42 - peak.seed * 2) * Math.cos(z * 0.38 + peak.seed) * 0.06;

        total += peak.height * profile * relief;
    }

    return Math.max(total, 0);
}

function terrainHeight(x, z) {
    const dist = Math.sqrt(x * x + z * z);
    const t = smoothstep(TERRAIN_INNER_RADIUS, TERRAIN_OUTER_RADIUS, dist);
    const falloff = t;

    // Layered sines give the broad shape; the last two add finer, less regular
    // detail so the hills do not read as an obvious repeating wave.
    const hills =
        Math.sin(x * 0.08) * Math.cos(z * 0.07) * 2.6 +
        Math.sin(x * 0.035 + 1.3) * Math.cos(z * 0.04 - 0.7) * 4.2 +
        Math.sin(x * 0.15 - 0.4) * Math.cos(z * 0.13 + 0.9) * 1.1 +
        Math.sin(x * 0.27 + 2.1) * Math.cos(z * 0.31 - 1.4) * 0.45 +
        Math.sin((x + z) * 0.19 + 0.6) * 0.35;

    // Baseline sits just under GROUND_Y so the playable plane and the surrounding
    // terrain meet almost flush instead of stepping.
    const raised = Math.max(hills, -0.4);
    let height = -0.02 + raised * falloff;

    // Mountains ride on top of the rolling hills, faded in by the same radial
    // falloff so nothing can ever rise inside the buildable area.
    height += mountainHeightAt(x, z) * falloff;

    // Carve the valley. Full depth under the water, easing back out to the banks.
    // Deliberately NOT scaled by the radial falloff: the river must have a real
    // bed at every point along its course, otherwise the water surface floats
    // above the ground where the terrain has not risen yet. The course never
    // comes within ~24 units of the origin, so this cannot trench the play area.
    const riverDist = distanceToRiver(x, z);
    if (riverDist < RIVER_BANK_WIDTH) {
        const carve = 1 - smoothstep(RIVER_HALF_WIDTH, RIVER_BANK_WIDTH, riverDist);
        height -= RIVER_DEPTH * carve;
    }

    return height;
}

// Water surface: sits inside the carved bed, below the top of the banks.
function riverSurfaceHeight(x, z) {
    return terrainHeight(x, z) + RIVER_DEPTH * 0.62;
}

export function init() {
    if (started) {
        return;
    }
    started = true;

    const container = document.getElementById('game-canvas');
    const tileMessageEl = document.getElementById('tile-info-message');
    const tileConfirmBtn = document.getElementById('tile-info-confirm');
    const tileUpgradeBtn = document.getElementById('tile-info-upgrade');

    if (!container) {
        console.error('three-scene: #game-canvas container not found.');
        return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeaf6ff);
    // Starts far enough out that the river and mountain ridges stay legible;
    // still dense at the far edge so the world reads as endless.
    scene.fog = new THREE.Fog(0xeaf6ff, 48, 165);

    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    const polarAngle = THREE.MathUtils.degToRad(CAMERA_POLAR_DEG);
    const azimuthAngle = THREE.MathUtils.degToRad(CAMERA_AZIMUTH_DEG);
    const sinPolar = Math.sin(polarAngle);
    camera.position.set(
        CAMERA_DISTANCE * sinPolar * Math.sin(azimuthAngle),
        CAMERA_DISTANCE * Math.cos(polarAngle),
        CAMERA_DISTANCE * sinPolar * Math.cos(azimuthAngle)
    );
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    // Soft shadows instead of the hard-edged BasicShadowMap — the single biggest
    // readability win for the low-poly models.
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableRotate = true;
    controls.rotateSpeed = 0.6;
    controls.minPolarAngle = THREE.MathUtils.degToRad(18);
    controls.maxPolarAngle = THREE.MathUtils.degToRad(85);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = true;
    controls.minDistance = 8;
    controls.maxDistance = 60;
    controls.enablePan = true;
    controls.screenSpacePanning = false;
    controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
    };
    controls.update();

    // Warm sun from above, cool sky bounce from below — gives the flat-shaded
    // models a readable light/shade split instead of uniform flat ambient.
    const hemiLight = new THREE.HemisphereLight(0xdcefff, 0x6f8f5c, 0.62);
    scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.28);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xfff3e0, 1.15);
    directionalLight.position.set(14, 22, 9);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(2048, 2048);
    directionalLight.shadow.camera.left = -16;
    directionalLight.shadow.camera.right = 16;
    directionalLight.shadow.camera.top = 16;
    directionalLight.shadow.camera.bottom = -16;
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 70;
    directionalLight.shadow.bias = -0.0008;
    directionalLight.shadow.normalBias = 0.02;
    scene.add(directionalLight);

    // Gentle fill from the opposite side so shadowed faces keep some detail.
    const fillLight = new THREE.DirectionalLight(0xcfe4ff, 0.3);
    fillLight.position.set(-12, 9, -14);
    scene.add(fillLight);

    // ---- Procedural textures (cheap canvas-based speckle textures for material realism) ----

    function makeSpeckleTexture(baseColor, speckleColors, size, speckleCount) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = baseColor;
        ctx.fillRect(0, 0, size, size);

        for (let i = 0; i < speckleCount; i++) {
            ctx.fillStyle = speckleColors[Math.floor(Math.random() * speckleColors.length)];
            ctx.globalAlpha = 0.12 + Math.random() * 0.22;
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 0.6 + Math.random() * 1.6;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    // Base tone matches terrainGrassColor (0x6fae63) so the playable plane blends
    // into the surrounding terrain instead of reading as a lighter square.
    const grassTexture = makeSpeckleTexture('#6fae63', ['#67a55c', '#7cb96c', '#5d9b54'], 128, 900);
    // Deliberately not a whole number of repeats per tile — an exact 1:1 mapping
    // made every tile share an identical speckle pattern and read as a hard grid.
    grassTexture.repeat.set(GRID_SIZE * 1.7, GRID_SIZE * 1.7);

    // Owned land is only a slightly warmer, more "manicured" green than the wild
    // grass around it. It used to be sandy beige, which made the tile edges shout.
    const dirtTexture = makeSpeckleTexture('#7cb96b', ['#74b063', '#89c578', '#6aa75c'], 64, 260);

    const asphaltTexture = makeSpeckleTexture('#6b6b6b', ['#5e5e5e', '#797979', '#555555'], 64, 260);

    // ---- Ground ----

    // Slightly larger than the 20x20 grid so its edge falls outside the play area
    // and does not draw a hard square around the city. Still entirely inside the
    // flat radius (TERRAIN_INNER_RADIUS), so it never pokes through a hill.
    const groundGeometry = new THREE.PlaneGeometry(GRID_SIZE + 4, GRID_SIZE + 4);
    const groundMaterial = new THREE.MeshStandardMaterial({ map: grassTexture, roughness: 0.95 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    ground.receiveShadow = true;
    scene.add(ground);

    // The grid sits almost invisible while you are just looking at your city, and
    // fades up only while you are actually placing or selecting, so the world reads
    // as landscape rather than graph paper without losing any build precision.
    const grid = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, GRID_LINE_COLOR, GRID_LINE_COLOR);
    grid.position.y = GRID_LINES_Y;
    grid.material.transparent = true;
    grid.material.opacity = GRID_IDLE_OPACITY;
    scene.add(grid);

    let gridOpacityTarget = GRID_IDLE_OPACITY;

    function setGridEmphasis(active) {
        gridOpacityTarget = active ? GRID_ACTIVE_OPACITY : GRID_IDLE_OPACITY;
    }

    // ---- Unlocked tile overlays ----

    const unlockedTileGeometry = new THREE.PlaneGeometry(1, 1);
    const unlockedTileMaterial = new THREE.MeshStandardMaterial({ map: dirtTexture, roughness: 0.92 });
    const unlockedGroup = new THREE.Group();
    scene.add(unlockedGroup);

    const unlockedTileKeys = new Set();

    function isTileUnlocked(tileX, tileY) {
        return unlockedTileKeys.has(tileKey(tileX, tileY));
    }

    function isAdjacentToUnlocked(tileX, tileY) {
        return unlockedTileKeys.has(tileKey(tileX - 1, tileY))
            || unlockedTileKeys.has(tileKey(tileX + 1, tileY))
            || unlockedTileKeys.has(tileKey(tileX, tileY - 1))
            || unlockedTileKeys.has(tileKey(tileX, tileY + 1));
    }

    // ---- Decorative trees on locked tiles (deterministic placement) ----

    const treeTileKeys = [];
    for (let x = 0; x < GRID_SIZE; x++) {
        for (let y = 0; y < GRID_SIZE; y++) {
            if (seededRandom(x, y, 0) < TREE_CHANCE) {
                treeTileKeys.push({ x: x, y: y });
            }
        }
    }

    const trunkHeight = 0.35;
    const trunkGeometry = new THREE.CylinderGeometry(0.045, 0.075, trunkHeight, 8);
    trunkGeometry.translate(0, trunkHeight / 2, 0);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: TREE_TRUNK_COLOR, roughness: 0.95, flatShading: true });
    const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeTileKeys.length);

    const foliageRadius = 0.3;
    const foliageGeometry = new THREE.IcosahedronGeometry(foliageRadius, 1);
    foliageGeometry.translate(0, trunkHeight + foliageRadius * 0.8, 0);
    const foliageMaterial = new THREE.MeshStandardMaterial({ color: TREE_FOLIAGE_COLOR, roughness: 0.9, flatShading: true });
    const foliageMesh = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, treeTileKeys.length);

    const treeIndexByTileKey = new Map();
    const treeBaseTransforms = new Map();
    const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    const dummy = new THREE.Object3D();
    const foliageColorA = new THREE.Color(0x3f8f4f);
    const foliageColorB = new THREE.Color(0x5aab63);
    const foliageColorScratch = new THREE.Color();

    treeTileKeys.forEach(function (tile, index) {
        const key = tileKey(tile.x, tile.y);
        treeIndexByTileKey.set(key, index);

        const center = tileCenterWorld(tile.x, tile.y);
        const jitterX = (seededRandom(tile.x, tile.y, 1) - 0.5) * 0.5;
        const jitterZ = (seededRandom(tile.x, tile.y, 2) - 0.5) * 0.5;
        const scale = 0.8 + seededRandom(tile.x, tile.y, 3) * 0.4;
        const rotationY = seededRandom(tile.x, tile.y, 4) * Math.PI * 2;
        const colorT = seededRandom(tile.x, tile.y, 5);

        dummy.position.set(center.x + jitterX, 0, center.z + jitterZ);
        dummy.rotation.set(0, rotationY, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();

        trunkMesh.setMatrixAt(index, dummy.matrix);
        foliageMesh.setMatrixAt(index, dummy.matrix);
        foliageMesh.setColorAt(index, foliageColorScratch.lerpColors(foliageColorA, foliageColorB, colorT));

        treeBaseTransforms.set(index, {
            x: center.x + jitterX,
            z: center.z + jitterZ,
            rotationY: rotationY,
            scale: scale,
        });
    });

    trunkMesh.instanceMatrix.needsUpdate = true;
    foliageMesh.instanceMatrix.needsUpdate = true;
    if (foliageMesh.instanceColor) {
        foliageMesh.instanceColor.needsUpdate = true;
    }
    scene.add(trunkMesh);
    scene.add(foliageMesh);

    function fadeOutTreeInstance(treeIndex, durationMs) {
        const base = treeBaseTransforms.get(treeIndex);
        if (!base) {
            trunkMesh.setMatrixAt(treeIndex, hiddenMatrix);
            foliageMesh.setMatrixAt(treeIndex, hiddenMatrix);
            trunkMesh.instanceMatrix.needsUpdate = true;
            foliageMesh.instanceMatrix.needsUpdate = true;
            return;
        }

        const duration = durationMs || 300;
        const startTime = performance.now();
        const fadeDummy = new THREE.Object3D();
        fadeDummy.position.set(base.x, 0, base.z);
        fadeDummy.rotation.set(0, base.rotationY, 0);

        function step(time) {
            const elapsed = time - startTime;
            const t = Math.min(elapsed / duration, 1);
            const currentScale = base.scale * (1 - t);

            fadeDummy.scale.setScalar(Math.max(currentScale, 0.001));
            fadeDummy.updateMatrix();
            trunkMesh.setMatrixAt(treeIndex, fadeDummy.matrix);
            foliageMesh.setMatrixAt(treeIndex, fadeDummy.matrix);
            trunkMesh.instanceMatrix.needsUpdate = true;
            foliageMesh.instanceMatrix.needsUpdate = true;

            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                trunkMesh.setMatrixAt(treeIndex, hiddenMatrix);
                foliageMesh.setMatrixAt(treeIndex, hiddenMatrix);
                trunkMesh.instanceMatrix.needsUpdate = true;
                foliageMesh.instanceMatrix.needsUpdate = true;
            }
        }

        requestAnimationFrame(step);
    }

    function markTileUnlocked(tileX, tileY, options) {
        const key = tileKey(tileX, tileY);
        if (unlockedTileKeys.has(key)) {
            return;
        }
        unlockedTileKeys.add(key);

        const treeIndex = treeIndexByTileKey.get(key);
        if (treeIndex !== undefined) {
            if (options && options.animate) {
                fadeOutTreeInstance(treeIndex, 300);
            } else {
                trunkMesh.setMatrixAt(treeIndex, hiddenMatrix);
                foliageMesh.setMatrixAt(treeIndex, hiddenMatrix);
                trunkMesh.instanceMatrix.needsUpdate = true;
                foliageMesh.instanceMatrix.needsUpdate = true;
            }
        }

        const center = tileCenterWorld(tileX, tileY);
        const overlay = new THREE.Mesh(unlockedTileGeometry, unlockedTileMaterial);
        overlay.rotation.x = -Math.PI / 2;
        overlay.position.set(center.x, UNLOCKED_TILE_Y, center.z);
        unlockedGroup.add(overlay);
    }

    // ---- Surrounding terrain (hills, mountains, river, wilderness — makes the world feel endless) ----

    // Denser mesh than before so the carved river valley and the hill detail
    // actually have vertices to be expressed in.
    const TERRAIN_SIZE = 320;
    // High enough to resolve the mountain relief and the carved river valley.
    const TERRAIN_SEGMENTS = 240;
    const terrainGeometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    terrainGeometry.rotateX(-Math.PI / 2);

    const terrainPositions = terrainGeometry.attributes.position;
    const terrainColorArray = new Float32Array(terrainPositions.count * 3);
    const terrainGrassColor = new THREE.Color(0x6fae63);
    const terrainMeadowColor = new THREE.Color(0x7cb96c);
    const terrainForestColor = new THREE.Color(0x568f4f);
    const terrainMidColor = new THREE.Color(0x7d9159);
    const terrainHighColor = new THREE.Color(0x8f897c);
    const terrainPeakColor = new THREE.Color(0xf3f6f8);
    const terrainSandColor = new THREE.Color(0xd8cfa4);
    const terrainWetSandColor = new THREE.Color(0xa89c78);
    const terrainColorScratch = new THREE.Color();

    for (let i = 0; i < terrainPositions.count; i++) {
        const vx = terrainPositions.getX(i);
        const vz = terrainPositions.getZ(i);
        const h = terrainHeight(vx, vz);
        terrainPositions.setY(i, h);

        // Slight per-vertex tint variation keeps large flat areas from banding.
        const tint = seededRandom(Math.round(vx * 5), Math.round(vz * 5), 21);

        // Hills stay green well up the slope — only genuinely high ground turns
        // to rock and snow, so the landscape reads as countryside, not mud.
        if (h < 1.2) {
            terrainColorScratch.copy(terrainGrassColor).lerp(terrainMeadowColor, tint);
        } else if (h < 4.5) {
            terrainColorScratch.copy(terrainMeadowColor).lerp(terrainForestColor, (h - 1.2) / 3.3);
        } else if (h < 7.5) {
            terrainColorScratch.copy(terrainForestColor).lerp(terrainMidColor, (h - 4.5) / 3);
        } else if (h < 11) {
            terrainColorScratch.copy(terrainMidColor).lerp(terrainHighColor, (h - 7.5) / 3.5);
        } else {
            terrainColorScratch.copy(terrainHighColor).lerp(terrainPeakColor, Math.min((h - 11) / 4, 1));
        }

        // Sandy shoreline wherever the valley has been carved.
        // Shoreline: wet sand right at the water, drying to pale sand, then fading
        // out into grass well beyond the top of the bank. The wide, gradual falloff
        // is what makes the river sit in the landscape instead of on top of it.
        const riverDist = distanceToRiver(vx, vz);
        const shoreReach = RIVER_BANK_WIDTH * 1.6;
        if (riverDist < shoreReach) {
            const shore = 1 - smoothstep(RIVER_HALF_WIDTH * 0.5, shoreReach, riverDist);
            terrainColorScratch.lerp(terrainSandColor, shore * 0.78);

            // Darker damp sand in the channel itself.
            if (riverDist < RIVER_HALF_WIDTH * 1.15) {
                const wet = 1 - smoothstep(0, RIVER_HALF_WIDTH * 1.15, riverDist);
                terrainColorScratch.lerp(terrainWetSandColor, wet * 0.7);
            }
        }

        terrainColorArray[i * 3] = terrainColorScratch.r;
        terrainColorArray[i * 3 + 1] = terrainColorScratch.g;
        terrainColorArray[i * 3 + 2] = terrainColorScratch.b;
    }

    terrainGeometry.setAttribute('color', new THREE.BufferAttribute(terrainColorArray, 3));
    terrainPositions.needsUpdate = true;
    terrainGeometry.computeVertexNormals();

    // Smooth shading, not flat: the mountains are part of this mesh now, and flat
    // shading is exactly what made them read as a pile of triangles.
    const terrainMaterial = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
        flatShading: false,
    });
    const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // Mountains are part of the terrain heightfield now (see mountainHeightAt()),
    // so there are no separate mountain meshes to add here.

    // ---- River ----
    // Ribbon geometry built from the same sampled course the terrain was carved
    // along, so the water always sits inside its own valley. Width grows
    // downstream, with a shallow lighter band and sandy banks along the edges.

    const riverGroup = new THREE.Group();

    // DoubleSide throughout: the ribbon winding flips at sharp bends in the
    // course, and a back-facing triangle would punch a hole in the water.
    const riverWaterMaterial = new THREE.MeshStandardMaterial({
        color: 0x3f86bd,
        roughness: 0.14,
        metalness: 0.28,
        transparent: true,
        opacity: 0.93,
        side: THREE.DoubleSide,
    });
    const riverShallowMaterial = new THREE.MeshStandardMaterial({
        color: 0x74bfdd,
        roughness: 0.18,
        metalness: 0.2,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
    });
    function buildRiverRibbon(widthAt, yOffset, material) {
        const positions = [];
        const indices = [];

        for (let i = 0; i < RIVER_SAMPLES.length; i++) {
            const current = RIVER_SAMPLES[i];
            const next = RIVER_SAMPLES[Math.min(i + 1, RIVER_SAMPLES.length - 1)];
            const prev = RIVER_SAMPLES[Math.max(i - 1, 0)];

            // Perpendicular to the local flow direction.
            const dirX = next.x - prev.x;
            const dirZ = next.z - prev.z;
            const len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
            const normalX = -dirZ / len;
            const normalZ = dirX / len;

            const halfWidth = widthAt(current.flow);
            const lx = current.x + normalX * halfWidth;
            const lz = current.z + normalZ * halfWidth;
            const rx = current.x - normalX * halfWidth;
            const rz = current.z - normalZ * halfWidth;

            positions.push(lx, riverSurfaceHeight(current.x, current.z) + yOffset, lz);
            positions.push(rx, riverSurfaceHeight(current.x, current.z) + yOffset, rz);

            if (i < RIVER_SAMPLES.length - 1) {
                const a = i * 2;
                indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const mesh = new THREE.Mesh(geometry, material);
        mesh.receiveShadow = true;
        return mesh;
    }

    // No separate sand ribbon any more — a flat tan band laid over the ground was
    // exactly what made the river look pasted on. The shoreline now comes from the
    // terrain's own vertex colouring, which fades gradually into the grass, and the
    // water sits a little narrower than the carved channel so that sandy bed shows
    // along both edges naturally.
    riverGroup.add(buildRiverRibbon(function (flow) {
        return RIVER_HALF_WIDTH * (0.6 + flow * 0.85);
    }, 0, riverWaterMaterial));

    // Lighter shallows hugging the inside of the channel.
    riverGroup.add(buildRiverRibbon(function (flow) {
        return RIVER_HALF_WIDTH * (0.34 + flow * 0.46);
    }, 0.014, riverShallowMaterial));

    // A few boulders sitting in the shallows.
    const riverRockMaterial = new THREE.MeshStandardMaterial({ color: 0x9a9384, roughness: 0.95, flatShading: true });
    for (let i = 0; i < 16; i++) {
        const sample = RIVER_SAMPLES[Math.floor(seededRandom(i, 610, 1) * RIVER_SAMPLES.length)];
        const offset = (seededRandom(i, 610, 2) - 0.5) * RIVER_HALF_WIDTH * 2.4;
        const rockSize = 0.22 + seededRandom(i, 610, 3) * 0.36;

        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rockSize, 0), riverRockMaterial);
        rock.position.set(
            sample.x + offset,
            riverSurfaceHeight(sample.x, sample.z) - rockSize * 0.25,
            sample.z + (seededRandom(i, 610, 4) - 0.5) * 1.6
        );
        rock.rotation.set(seededRandom(i, 610, 5) * 3, seededRandom(i, 610, 6) * 3, seededRandom(i, 610, 7) * 3);
        rock.castShadow = true;
        riverGroup.add(rock);
    }

    scene.add(riverGroup);

    // Wilderness trees scattered across the outer terrain (decorative, not tied to tile state).
    const WILDERNESS_TREE_COUNT = 130;
    const wildernessTrunkGeometry = new THREE.CylinderGeometry(0.06, 0.1, 0.5, 7);
    wildernessTrunkGeometry.translate(0, 0.25, 0);
    const wildernessFoliageRadius = 0.42;
    const wildernessFoliageGeometry = new THREE.IcosahedronGeometry(wildernessFoliageRadius, 1);
    wildernessFoliageGeometry.translate(0, 0.5 + wildernessFoliageRadius * 0.8, 0);
    const wildernessTrunkMesh = new THREE.InstancedMesh(wildernessTrunkGeometry, trunkMaterial, WILDERNESS_TREE_COUNT);
    const wildernessFoliageMesh = new THREE.InstancedMesh(wildernessFoliageGeometry, foliageMaterial, WILDERNESS_TREE_COUNT);
    const wildernessDummy = new THREE.Object3D();

    const wildernessHiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

    for (let i = 0; i < WILDERNESS_TREE_COUNT; i++) {
        const angle = seededRandom(i, 700, 1) * Math.PI * 2;
        const radius = 20 + seededRandom(i, 700, 2) * 40;
        const wx = Math.cos(angle) * radius;
        const wz = Math.sin(angle) * radius;

        // Trees do not grow in the river or on its sandy banks.
        if (distanceToRiver(wx, wz) < RIVER_BANK_WIDTH * 1.1) {
            wildernessTrunkMesh.setMatrixAt(i, wildernessHiddenMatrix);
            wildernessFoliageMesh.setMatrixAt(i, wildernessHiddenMatrix);
            continue;
        }

        const wy = terrainHeight(wx, wz);
        const scale = 0.7 + seededRandom(i, 700, 3) * 0.6;
        const rotY = seededRandom(i, 700, 4) * Math.PI * 2;

        wildernessDummy.position.set(wx, wy, wz);
        wildernessDummy.rotation.set(0, rotY, 0);
        wildernessDummy.scale.setScalar(scale);
        wildernessDummy.updateMatrix();

        wildernessTrunkMesh.setMatrixAt(i, wildernessDummy.matrix);
        wildernessFoliageMesh.setMatrixAt(i, wildernessDummy.matrix);
        wildernessFoliageMesh.setColorAt(i, foliageColorScratch.lerpColors(foliageColorA, foliageColorB, seededRandom(i, 700, 5)));
    }

    wildernessTrunkMesh.instanceMatrix.needsUpdate = true;
    wildernessFoliageMesh.instanceMatrix.needsUpdate = true;
    if (wildernessFoliageMesh.instanceColor) {
        wildernessFoliageMesh.instanceColor.needsUpdate = true;
    }
    scene.add(wildernessTrunkMesh);
    scene.add(wildernessFoliageMesh);

    // ---- Placed buildings ----

    const roadSurfaceMaterial2Lane = new THREE.MeshStandardMaterial({ map: asphaltTexture, roughness: 0.95 });
    const roadSurfaceMaterial4Lane = new THREE.MeshStandardMaterial({ map: asphaltTexture, roughness: 0.95, color: 0xdedede });
    const roadSurfaceMaterial6Lane = new THREE.MeshStandardMaterial({ map: asphaltTexture, roughness: 0.95, color: 0xc2c2c2 });
    const roadStripeMaterial = new THREE.MeshStandardMaterial({ color: 0xf3e6c4, roughness: 0.85 });
    const roadDividerMaterial = new THREE.MeshStandardMaterial({ color: 0xffe08a, roughness: 0.7 });
    const roadBaseGeometry = new THREE.BoxGeometry(1, 0.04, 1);
    const roadDashGeometry = new THREE.BoxGeometry(0.06, 0.045, 0.24);
    const roadDividerGeometry = new THREE.BoxGeometry(0.035, 0.046, 0.98);

    const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3d28, roughness: 0.8 });
    const windowMaterial = new THREE.MeshStandardMaterial({ color: 0xbfe3f0, roughness: 0.25, metalness: 0.1 });

    // ---- Plot landscaping ----
    // Every non-road structure gets a small amount of ground dressing: a lawn,
    // a path to the door, hedges or fencing, shrubs and flowers. Geometries and
    // materials are shared singletons so a 90-building city stays cheap.

    const lawnGeometry = new THREE.BoxGeometry(0.94, 0.012, 0.94);
    const lawnMaterial = new THREE.MeshStandardMaterial({ color: 0x74b768, roughness: 0.95 });
    const yardMaterial = new THREE.MeshStandardMaterial({ color: 0xa9b48c, roughness: 0.96 });
    const pavingMaterial = new THREE.MeshStandardMaterial({ color: 0xcfc9b8, roughness: 0.9 });
    const industrialYardMaterial = new THREE.MeshStandardMaterial({ color: 0xa8a49a, roughness: 0.97 });

    const pathGeometry = new THREE.BoxGeometry(0.16, 0.014, 0.3);
    const pathMaterial = new THREE.MeshStandardMaterial({ color: 0xd9d2bf, roughness: 0.9 });

    const hedgeMaterial = new THREE.MeshStandardMaterial({ color: 0x3f8a45, roughness: 0.95, flatShading: true });
    const hedgeLongGeometry = new THREE.BoxGeometry(0.9, 0.11, 0.07);
    const hedgeSideGeometry = new THREE.BoxGeometry(0.07, 0.11, 0.9);

    const fencePostGeometry = new THREE.BoxGeometry(0.035, 0.16, 0.035);
    const fenceRailGeometry = new THREE.BoxGeometry(0.9, 0.03, 0.025);
    const fenceMaterial = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.85 });
    const chainFenceMaterial = new THREE.MeshStandardMaterial({
        color: 0x9aa0a6,
        roughness: 0.7,
        metalness: 0.35,
        transparent: true,
        opacity: 0.55,
    });

    const shrubGeometry = new THREE.IcosahedronGeometry(0.075, 0);
    const shrubMaterials = [
        new THREE.MeshStandardMaterial({ color: 0x4f9a4f, roughness: 0.95, flatShading: true }),
        new THREE.MeshStandardMaterial({ color: 0x5fae5a, roughness: 0.95, flatShading: true }),
    ];

    const flowerGeometry = new THREE.SphereGeometry(0.03, 5, 4);
    const flowerMaterials = [
        new THREE.MeshStandardMaterial({ color: 0xe86a6a, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0xf3c455, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0xd982d2, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.8 }),
    ];

    const plotTreeTrunkGeometry = new THREE.CylinderGeometry(0.022, 0.032, 0.16, 6);
    plotTreeTrunkGeometry.translate(0, 0.08, 0);
    const plotTreeFoliageGeometry = new THREE.IcosahedronGeometry(0.13, 0);
    plotTreeFoliageGeometry.translate(0, 0.24, 0);

    const barrelGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 7);
    const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x9a7f4a, roughness: 0.9 });

    // Which dressing each model gets. Roads are absent on purpose.
    const PLOT_STYLES = {
        house: 'garden',
        apartment: 'courtyard',
        shop: 'paved',
        cafe: 'paved',
        office: 'paved',
        factory: 'industrial',
        school: 'civic',
        hospital: 'civic',
        police: 'civic',
        park: 'none',
        stadium: 'none',
    };

    function addShrub(group, x, z, seed, scale) {
        const shrub = new THREE.Mesh(shrubGeometry, shrubMaterials[Math.floor(seededRandom(seed, 3, 1) * shrubMaterials.length)]);
        const s = (scale || 1) * (0.8 + seededRandom(seed, 3, 2) * 0.5);
        shrub.position.set(x, 0.05 * s, z);
        shrub.scale.setScalar(s);
        shrub.rotation.y = seededRandom(seed, 3, 3) * Math.PI;
        shrub.castShadow = true;
        group.add(shrub);
    }

    function addFlowerPatch(group, x, z, seed) {
        for (let i = 0; i < 3; i++) {
            const flower = new THREE.Mesh(
                flowerGeometry,
                flowerMaterials[Math.floor(seededRandom(seed + i, 4, 1) * flowerMaterials.length)]
            );
            flower.position.set(
                x + (seededRandom(seed + i, 4, 2) - 0.5) * 0.12,
                0.035,
                z + (seededRandom(seed + i, 4, 3) - 0.5) * 0.12
            );
            group.add(flower);
        }
    }

    function addPlotTree(group, x, z, seed) {
        const trunk = new THREE.Mesh(plotTreeTrunkGeometry, trunkMaterial);
        trunk.position.set(x, 0.01, z);
        group.add(trunk);

        const foliage = new THREE.Mesh(plotTreeFoliageGeometry, foliageMaterial);
        foliage.position.set(x, 0.01, z);
        foliage.rotation.y = seededRandom(seed, 5, 1) * Math.PI;
        foliage.castShadow = true;
        group.add(foliage);
    }

    function addPicketFence(group) {
        // Front fence only — a full box would hide the building behind pickets.
        for (let i = -4; i <= 4; i++) {
            const post = new THREE.Mesh(fencePostGeometry, fenceMaterial);
            post.position.set(i * 0.1, 0.08, 0.44);
            group.add(post);
        }
        const rail = new THREE.Mesh(fenceRailGeometry, fenceMaterial);
        rail.position.set(0, 0.11, 0.44);
        group.add(rail);
    }

    function addHedgeBorder(group, sides) {
        if (sides.back) {
            const back = new THREE.Mesh(hedgeLongGeometry, hedgeMaterial);
            back.position.set(0, 0.055, -0.44);
            group.add(back);
        }
        if (sides.left) {
            const left = new THREE.Mesh(hedgeSideGeometry, hedgeMaterial);
            left.position.set(-0.44, 0.055, 0);
            group.add(left);
        }
        if (sides.right) {
            const right = new THREE.Mesh(hedgeSideGeometry, hedgeMaterial);
            right.position.set(0.44, 0.055, 0);
            group.add(right);
        }
    }

    function addEntryPath(group) {
        const path = new THREE.Mesh(pathGeometry, pathMaterial);
        path.position.set(0, 0.014, 0.33);
        group.add(path);
    }

    /**
     * Adds ground dressing under and around a building. Called with the same
     * group the building mesh lives in, so it inherits the plot's rotation and
     * multi-tile scaling.
     */
    function decoratePlot(group, modelKey, level) {
        const style = PLOT_STYLES[modelKey];

        if (!style || style === 'none') {
            return;
        }

        const plotLevel = clampLevel(level);

        // Seed off the model name so the same building type always dresses the
        // same way — placements stay visually stable between reloads.
        let seed = 0;
        for (let i = 0; i < modelKey.length; i++) {
            seed += modelKey.charCodeAt(i) * (i + 1);
        }

        const groundMaterialFor = {
            garden: lawnMaterial,
            courtyard: lawnMaterial,
            paved: pavingMaterial,
            civic: yardMaterial,
            industrial: industrialYardMaterial,
        }[style];

        const lawn = new THREE.Mesh(lawnGeometry, groundMaterialFor);
        lawn.position.y = 0.006;
        lawn.receiveShadow = true;
        group.add(lawn);

        if (style === 'garden') {
            addPicketFence(group);
            addEntryPath(group);
            addHedgeBorder(group, { back: true, left: true, right: false });
            addShrub(group, 0.3, 0.32, seed + 1);
            addShrub(group, -0.32, 0.3, seed + 2);
            addFlowerPatch(group, -0.3, 0.12, seed + 3);
            addPlotTree(group, 0.33, -0.12, seed + 4);
        } else if (style === 'courtyard') {
            addHedgeBorder(group, { back: true, left: true, right: true });
            addEntryPath(group);
            addShrub(group, 0.33, 0.34, seed + 5, 1.15);
            addShrub(group, -0.33, 0.34, seed + 6, 1.15);
            addFlowerPatch(group, 0, 0.38, seed + 7);
        } else if (style === 'paved') {
            addShrub(group, 0.38, 0.38, seed + 8);
            addShrub(group, -0.38, 0.38, seed + 9);
            addFlowerPatch(group, 0.38, 0.1, seed + 10);
            addFlowerPatch(group, -0.38, 0.1, seed + 11);
        } else if (style === 'civic') {
            addHedgeBorder(group, { back: true, left: true, right: true });
            addEntryPath(group);
            addPlotTree(group, -0.34, 0.3, seed + 12);
            addPlotTree(group, 0.34, 0.3, seed + 13);
            addFlowerPatch(group, 0, 0.40, seed + 14);
        } else if (style === 'industrial') {
            // Chain-link perimeter plus a few drums in the yard.
            [[-0.44, 0], [0.44, 0]].forEach(function (pos) {
                const side = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.9), chainFenceMaterial);
                side.position.set(pos[0], 0.1, pos[1]);
                group.add(side);
            });
            const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.02), chainFenceMaterial);
            back.position.set(0, 0.1, -0.44);
            group.add(back);

            for (let i = 0; i < 3; i++) {
                const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
                barrel.position.set(-0.34 + i * 0.1, 0.06, 0.36);
                group.add(barrel);
            }
            addShrub(group, 0.36, 0.38, seed + 15, 0.9);
        }

        // Higher-level plots get a little more landscaping, so the whole parcel
        // looks more developed and not just the building on it.
        // Positions here are kept clear of the tile edge by at least the prop's own
        // radius, so decoration never overhangs onto the neighbouring tile.
        if (plotLevel >= 2 && style !== 'industrial') {
            addShrub(group, -0.37, -0.28, seed + 21, 1.0);
            addFlowerPatch(group, 0.37, -0.3, seed + 22);
        }

        if (plotLevel === 3) {
            if (style === 'paved' || style === 'courtyard') {
                // Planters along the frontage.
                [-0.28, 0.28].forEach(function (x, i) {
                    const planter = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.1), pavingMaterial);
                    planter.position.set(x, 0.03, 0.4);
                    group.add(planter);
                    addShrub(group, x, 0.4, seed + 30 + i, 0.65);
                });
            } else if (style === 'garden' || style === 'civic') {
                addPlotTree(group, -0.33, -0.02, seed + 32);
                addFlowerPatch(group, 0.37, 0.3, seed + 33);
            } else if (style === 'industrial') {
                // Extra drums and a floodlight in the yard.
                for (let i = 0; i < 2; i++) {
                    const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
                    barrel.position.set(-0.34 + i * 0.1, 0.06, 0.22);
                    group.add(barrel);
                }
                const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.34, 6), chainFenceMaterial);
                mast.position.set(0.4, 0.17, -0.34);
                group.add(mast);
            }
        }
    }

    function createRoadMesh(laneCount, surfaceMaterial) {
        const group = new THREE.Group();

        const base = new THREE.Mesh(roadBaseGeometry, surfaceMaterial);
        base.position.y = 0.02;
        group.add(base);

        let lineXOffsets;
        if (laneCount === 4) {
            lineXOffsets = [-0.22, 0.22];
        } else if (laneCount === 6) {
            lineXOffsets = [-0.3, 0.3];
            const divider = new THREE.Mesh(roadDividerGeometry, roadDividerMaterial);
            divider.position.set(0, 0.021, 0);
            group.add(divider);
        } else {
            lineXOffsets = [0];
        }

        lineXOffsets.forEach(function (x) {
            const dash1 = new THREE.Mesh(roadDashGeometry, roadStripeMaterial);
            dash1.position.set(x, 0.021, -0.24);
            group.add(dash1);

            const dash2 = new THREE.Mesh(roadDashGeometry, roadStripeMaterial);
            dash2.position.set(x, 0.021, 0.24);
            group.add(dash2);
        });

        return group;
    }

    // ---- Level-aware building models ----
    // Every factory below takes the placed building's level (1-3). Higher levels
    // are physically bigger and gain structural detail, so the upgrade is obvious
    // in the scene and not just in the numbers.

    const wallMaterialWarm = new THREE.MeshStandardMaterial({ color: 0xf2d9a6, roughness: 0.85 });
    const wallMaterialCream = new THREE.MeshStandardMaterial({ color: 0xf6e6c4, roughness: 0.85 });
    const roofMaterialRed = new THREE.MeshStandardMaterial({ color: 0xb5533c, roughness: 0.8, flatShading: true });
    const roofMaterialDeep = new THREE.MeshStandardMaterial({ color: 0x8f3f2e, roughness: 0.8, flatShading: true });
    const brickMaterial = new THREE.MeshStandardMaterial({ color: 0xc27a5a, roughness: 0.9 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.8 });
    const metalMaterial = new THREE.MeshStandardMaterial({ color: 0xb7bfc9, roughness: 0.6, metalness: 0.35 });
    const darkMetalMaterial = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.7, metalness: 0.3 });
    const glassMaterial = new THREE.MeshStandardMaterial({
        color: 0x9fd4e8, roughness: 0.15, metalness: 0.42,
    });
    const solarMaterial = new THREE.MeshStandardMaterial({ color: 0x2f4a6b, roughness: 0.3, metalness: 0.4 });

    function addWindowGrid(group, cols, rows, startY, stepY, spanX, z, width, height) {
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = cols === 1 ? 0 : -spanX / 2 + (spanX / (cols - 1)) * c;
                const win = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.02), windowMaterial);
                win.position.set(x, startY + r * stepY, z);
                group.add(win);
            }
        }
    }

    function createHouseMesh(level) {
        const group = new THREE.Group();

        // L1 cottage -> L2 two storeys with a porch -> L3 two storeys plus a wing.
        // L3 narrows the main block slightly so the added wing still fits the tile.
        const width = [0.55, 0.62, 0.6][level - 1];
        const depth = [0.55, 0.6, 0.62][level - 1];
        const wallHeight = [0.4, 0.66, 0.78][level - 1];

        const walls = new THREE.Mesh(
            new THREE.BoxGeometry(width, wallHeight, depth),
            level === 1 ? wallMaterialWarm : wallMaterialCream
        );
        walls.position.y = wallHeight / 2;
        group.add(walls);

        const roofHeight = [0.3, 0.32, 0.34][level - 1];
        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(width * 0.82, roofHeight, 4),
            level === 3 ? roofMaterialDeep : roofMaterialRed
        );
        roof.rotation.y = Math.PI / 4;
        roof.position.y = wallHeight + roofHeight / 2;
        group.add(roof);

        const door = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.22, 0.02), doorMaterial);
        door.position.set(0, 0.11, depth / 2 + 0.001);
        group.add(door);

        // Ground-floor windows either side of the door.
        addWindowGrid(group, 2, 1, 0.26, 0, width * 0.62, depth / 2 + 0.001, 0.1, 0.1);

        if (level >= 2) {
            // Upper storey windows + a chimney.
            addWindowGrid(group, 2, 1, 0.52, 0, width * 0.62, depth / 2 + 0.001, 0.1, 0.11);

            const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.08), brickMaterial);
            chimney.position.set(width * 0.28, wallHeight + 0.14, -depth * 0.24);
            group.add(chimney);

            // Porch canopy over the door.
            const porch = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.12), trimMaterial);
            porch.position.set(0, 0.26, depth / 2 + 0.06);
            group.add(porch);

            [-0.1, 0.1].forEach(function (x) {
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.25, 0.02), trimMaterial);
                post.position.set(x, 0.125, depth / 2 + 0.1);
                group.add(post);
            });
        }

        if (level === 3) {
            // Side wing with its own pitched roof, tucked against the main block so
            // its outer face stays inside the tile.
            const wingW = 0.2;
            const wingH = 0.44;
            const wing = new THREE.Mesh(new THREE.BoxGeometry(wingW, wingH, depth * 0.72), wallMaterialCream);
            wing.position.set(-(width / 2 + wingW / 2 - 0.03), wingH / 2, 0);
            group.add(wing);

            const wingRoof = new THREE.Mesh(new THREE.ConeGeometry(wingW * 0.8, 0.18, 4), roofMaterialDeep);
            wingRoof.rotation.y = Math.PI / 4;
            wingRoof.position.set(wing.position.x, wingH + 0.09, 0);
            group.add(wingRoof);

            // Balcony across the upper front.
            const balcony = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, 0.02, 0.1), trimMaterial);
            balcony.position.set(0, 0.46, depth / 2 + 0.05);
            group.add(balcony);

            const rail = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, 0.07, 0.015), trimMaterial);
            rail.position.set(0, 0.5, depth / 2 + 0.095);
            group.add(rail);

            // Dormer in the roof.
            const dormer = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.12), wallMaterialCream);
            dormer.position.set(0, wallHeight + 0.08, depth * 0.18);
            group.add(dormer);
        }

        return group;
    }

    function createAwningBuildingMesh(bodyColor, awningColor, level) {
        const group = new THREE.Group();

        // L1 kiosk -> L2 taller shopfront with signage -> L3 two-storey premises.
        const width = [0.6, 0.68, 0.74][level - 1];
        const depth = [0.6, 0.62, 0.66][level - 1];
        const height = [0.55, 0.78, 1.0][level - 1];

        const body = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, depth),
            new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.85 })
        );
        body.position.y = height / 2;
        group.add(body);

        const awningMaterial = new THREE.MeshStandardMaterial({ color: awningColor, roughness: 0.8 });
        const awning = new THREE.Mesh(
            new THREE.BoxGeometry(width + 0.06, 0.08, depth + 0.06),
            awningMaterial
        );
        awning.position.y = level === 1 ? 0.38 : 0.4;
        group.add(awning);

        const door = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.02), doorMaterial);
        door.position.set(-width * 0.16, 0.12, depth / 2 + 0.001);
        group.add(door);

        const shopWindow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.02), windowMaterial);
        shopWindow.position.set(width * 0.26, 0.16, depth / 2 + 0.001);
        group.add(shopWindow);

        if (level >= 2) {
            // Sign board above the awning + first floor windows.
            const sign = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, 0.11, 0.03), trimMaterial);
            sign.position.set(0, 0.55, depth / 2 + 0.01);
            group.add(sign);

            const signStripe = new THREE.Mesh(new THREE.BoxGeometry(width * 0.55, 0.04, 0.01), awningMaterial);
            signStripe.position.set(0, 0.55, depth / 2 + 0.03);
            group.add(signStripe);

            addWindowGrid(group, 2, 1, 0.68, 0, width * 0.55, depth / 2 + 0.001, 0.13, 0.12);
        }

        if (level === 3) {
            // Glazed upper floor, rooftop plant and a corner column.
            const glassBand = new THREE.Mesh(new THREE.BoxGeometry(width * 0.86, 0.16, 0.02), glassMaterial);
            glassBand.position.set(0, 0.87, depth / 2 + 0.001);
            group.add(glassBand);

            const parapet = new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, 0.05, depth + 0.04), trimMaterial);
            parapet.position.y = height + 0.02;
            group.add(parapet);

            const rooftopUnit = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.16), metalMaterial);
            rooftopUnit.position.set(width * 0.2, height + 0.09, -depth * 0.18);
            group.add(rooftopUnit);

            const canopy = new THREE.Mesh(new THREE.BoxGeometry(width + 0.12, 0.03, 0.14), awningMaterial);
            canopy.position.set(0, 0.3, depth / 2 + 0.08);
            group.add(canopy);
        }

        return group;
    }

    function createSchoolMesh(level) {
        const group = new THREE.Group();

        const width = [0.8, 0.84, 0.86][level - 1];
        const depth = [0.8, 0.8, 0.82][level - 1];
        const height = [0.6, 0.8, 0.98][level - 1];

        const body = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, depth),
            new THREE.MeshStandardMaterial({ color: 0xe8c468, roughness: 0.85 })
        );
        body.position.y = height / 2;
        group.add(body);

        const roof = new THREE.Mesh(
            new THREE.BoxGeometry(width + 0.06, 0.08, depth + 0.06),
            new THREE.MeshStandardMaterial({ color: 0x4a5a8f, roughness: 0.8 })
        );
        roof.position.y = height + 0.04;
        group.add(roof);

        // One window row per storey.
        const rows = level;
        addWindowGrid(group, level >= 2 ? 3 : 2, rows, 0.3, 0.26, width * 0.6, depth / 2 + 0.001, 0.12, 0.14);

        const flagpole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.012, 0.012, 0.35, 8),
            new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6, flatShading: true })
        );
        flagpole.position.set(width * 0.4, height + 0.255, -depth * 0.4);
        group.add(flagpole);

        const flag = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.08, 0.01),
            new THREE.MeshStandardMaterial({ color: 0xe0554f, roughness: 0.8 })
        );
        flag.position.set(width * 0.4 + 0.06, height + 0.37, -depth * 0.4);
        group.add(flag);

        if (level >= 2) {
            // Entrance portico, kept shallow so it does not overhang the tile.
            const portico = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.1), trimMaterial);
            portico.position.set(0, 0.3, depth / 2 + 0.03);
            group.add(portico);

            [-0.12, 0.12].forEach(function (x) {
                const column = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 8), trimMaterial);
                column.position.set(x, 0.15, depth / 2 + 0.055);
                group.add(column);
            });
        }

        if (level === 3) {
            // Clock tower over the entrance.
            const tower = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.22), trimMaterial);
            tower.position.set(0, height + 0.19, depth * 0.1);
            group.add(tower);

            const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.16, 4), roofMaterialDeep);
            towerRoof.rotation.y = Math.PI / 4;
            towerRoof.position.set(0, height + 0.42, depth * 0.1);
            group.add(towerRoof);

            const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 12), windowMaterial);
            clock.rotation.x = Math.PI / 2;
            clock.position.set(0, height + 0.21, depth * 0.1 + 0.115);
            group.add(clock);
        }

        return group;
    }

    function createParkMesh(level) {
        const group = new THREE.Group();

        const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x5fae5a, roughness: 0.92 });
        const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.85 });
        const parkTrunkMaterial = new THREE.MeshStandardMaterial({ color: TREE_TRUNK_COLOR, roughness: 0.95, flatShading: true });
        const parkFoliageMaterial = new THREE.MeshStandardMaterial({ color: TREE_FOLIAGE_COLOR, roughness: 0.9, flatShading: true });

        const radius = [0.42, 0.45, 0.47][level - 1];
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.05, 22), grassMaterial);
        disc.position.y = 0.025;
        group.add(disc);

        function addParkTree(x, z, scale) {
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.048, 0.25 * scale, 8), parkTrunkMaterial);
            trunk.position.set(x, 0.05 + 0.125 * scale, z);
            group.add(trunk);

            const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 * scale, 1), parkFoliageMaterial);
            foliage.position.set(x, 0.05 + 0.25 * scale + 0.18 * scale, z);
            group.add(foliage);
        }

        // L1 one tree -> L2 pond and a second tree -> L3 fountain, lamps, four trees.
        if (level === 1) {
            addParkTree(0, 0, 1);
        } else if (level === 2) {
            addParkTree(-0.16, -0.06, 1);
            addParkTree(0.18, 0.12, 0.8);
        } else {
            addParkTree(-0.24, -0.14, 0.95);
            addParkTree(0.24, -0.14, 0.85);
            addParkTree(-0.22, 0.2, 0.75);
            addParkTree(0.24, 0.22, 0.8);
        }

        const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.1), woodMaterial);
        benchSeat.position.set(0.15, 0.09, 0.24);
        group.add(benchSeat);

        const benchBack = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.02), woodMaterial);
        benchBack.position.set(0.15, 0.14, 0.19);
        group.add(benchBack);

        if (level >= 2) {
            // Pond with a stone rim.
            const pondRim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 16), pavingMaterial);
            pondRim.position.set(-0.16, 0.055, 0.18);
            group.add(pondRim);

            const pond = new THREE.Mesh(
                new THREE.CylinderGeometry(0.12, 0.12, 0.02, 16),
                new THREE.MeshStandardMaterial({ color: 0x4d93c7, roughness: 0.16, metalness: 0.25 })
            );
            pond.position.set(-0.16, 0.07, 0.18);
            group.add(pond);

            // Winding path across the lawn.
            const path = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.5, 0.012, 0.1), pathMaterial);
            path.position.set(0, 0.056, -0.02);
            path.rotation.y = 0.35;
            group.add(path);
        }

        if (level === 3) {
            // Central fountain replaces the pond as the focal point.
            const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.06, 18), pavingMaterial);
            basin.position.set(0, 0.08, 0.02);
            group.add(basin);

            const water = new THREE.Mesh(
                new THREE.CylinderGeometry(0.14, 0.14, 0.02, 18),
                new THREE.MeshStandardMaterial({ color: 0x6fbfe0, roughness: 0.12, metalness: 0.3 })
            );
            water.position.set(0, 0.11, 0.02);
            group.add(water);

            const column = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.18, 10), trimMaterial);
            column.position.set(0, 0.2, 0.02);
            group.add(column);

            const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.03, 0.04, 12), trimMaterial);
            bowl.position.set(0, 0.3, 0.02);
            group.add(bowl);

            // Lamp posts around the edge.
            [[-0.3, 0.3], [0.32, -0.28]].forEach(function (pos) {
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.32, 8), darkMetalMaterial);
                post.position.set(pos[0], 0.21, pos[1]);
                group.add(post);

                const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), trimMaterial);
                lamp.position.set(pos[0], 0.39, pos[1]);
                group.add(lamp);
            });
        }

        return group;
    }

    function createApartmentMesh(level) {
        const group = new THREE.Group();

        // Floors grow with level: 3 -> 5 -> 7 window rows.
        const width = [0.62, 0.68, 0.72][level - 1];
        const depth = [0.62, 0.66, 0.7][level - 1];
        const height = [0.95, 1.35, 1.75][level - 1];
        const floors = [3, 5, 7][level - 1];

        const body = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, depth),
            new THREE.MeshStandardMaterial({ color: 0xd9cdb6, roughness: 0.85 })
        );
        body.position.y = height / 2;
        group.add(body);

        const roofCap = new THREE.Mesh(
            new THREE.BoxGeometry(width + 0.06, 0.06, depth + 0.06),
            new THREE.MeshStandardMaterial({ color: 0x6b6259, roughness: 0.8 })
        );
        roofCap.position.y = height + 0.03;
        group.add(roofCap);

        const firstFloorY = 0.28;
        const floorStep = (height - firstFloorY - 0.14) / Math.max(floors - 1, 1);
        addWindowGrid(group, 2, floors, firstFloorY, floorStep, width * 0.48, depth / 2 + 0.001, 0.1, 0.1);

        if (level >= 2) {
            // Balconies down the front face.
            for (let f = 1; f < floors; f += 2) {
                const y = firstFloorY + f * floorStep;
                const slab = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 0.02, 0.09), trimMaterial);
                slab.position.set(0, y - 0.06, depth / 2 + 0.045);
                group.add(slab);

                const rail = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 0.05, 0.012), metalMaterial);
                rail.position.set(0, y - 0.035, depth / 2 + 0.085);
                group.add(rail);
            }

            // Ground floor entrance canopy.
            const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.12), trimMaterial);
            canopy.position.set(0, 0.2, depth / 2 + 0.06);
            group.add(canopy);
        }

        if (level === 3) {
            // Rooftop plant, solar array and a stair core.
            const core = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.2), trimMaterial);
            core.position.set(-width * 0.2, height + 0.1, -depth * 0.18);
            group.add(core);

            const solar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.015, 0.2), solarMaterial);
            solar.position.set(width * 0.16, height + 0.08, depth * 0.14);
            solar.rotation.x = -0.22;
            group.add(solar);

            const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10), metalMaterial);
            tank.position.set(width * 0.24, height + 0.11, -depth * 0.24);
            group.add(tank);
        }

        return group;
    }

    function createFactoryMesh(level) {
        const group = new THREE.Group();

        const width = [0.7, 0.78, 0.82][level - 1];
        const depth = [0.55, 0.62, 0.68][level - 1];
        const height = [0.42, 0.54, 0.64][level - 1];
        const stackCount = [1, 2, 3][level - 1];

        const body = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, depth),
            new THREE.MeshStandardMaterial({ color: 0x8a7d6e, roughness: 0.9 })
        );
        body.position.y = height / 2;
        group.add(body);

        const roof = new THREE.Mesh(
            new THREE.BoxGeometry(width + 0.04, 0.05, depth + 0.04),
            new THREE.MeshStandardMaterial({ color: 0x554d44, roughness: 0.85 })
        );
        roof.position.y = height + 0.025;
        group.add(roof);

        const stackMaterial = new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 0.9, flatShading: true });
        const stackCapMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 });
        const stackHeight = [0.55, 0.66, 0.78][level - 1];

        for (let s = 0; s < stackCount; s++) {
            const x = stackCount === 1 ? width * 0.3 : -width * 0.26 + (width * 0.52 / (stackCount - 1)) * s;

            const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, stackHeight, 9), stackMaterial);
            stack.position.set(x, height + stackHeight / 2, -depth * 0.18);
            group.add(stack);

            const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 9), stackCapMaterial);
            cap.position.set(x, height + stackHeight + 0.02, -depth * 0.18);
            group.add(cap);
        }

        const door = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.02), doorMaterial);
        door.position.set(-width * 0.22, 0.1, depth / 2 + 0.001);
        group.add(door);

        if (level >= 2) {
            // Storage silo alongside the shed.
            const silo = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.42, 12), metalMaterial);
            silo.position.set(-width * 0.36, 0.21, depth * 0.3);
            group.add(silo);

            const siloTop = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.1, 12), darkMetalMaterial);
            siloTop.position.set(-width * 0.36, 0.47, depth * 0.3);
            group.add(siloTop);

            // Loading bay roller door.
            const bay = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.02), darkMetalMaterial);
            bay.position.set(width * 0.2, 0.12, depth / 2 + 0.001);
            group.add(bay);
        }

        if (level === 3) {
            // Second silo, a horizontal tank and pipework across the roof.
            const silo2 = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.36, 12), metalMaterial);
            silo2.position.set(-width * 0.36, 0.18, -depth * 0.05);
            group.add(silo2);

            const silo2Top = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.09, 12), darkMetalMaterial);
            silo2Top.position.set(-width * 0.36, 0.4, -depth * 0.05);
            group.add(silo2Top);

            const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.26, 12), metalMaterial);
            tank.rotation.z = Math.PI / 2;
            tank.position.set(width * 0.22, height + 0.1, depth * 0.26);
            group.add(tank);

            const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, width * 0.6, 8), darkMetalMaterial);
            pipe.rotation.z = Math.PI / 2;
            pipe.position.set(0, height + 0.1, -depth * 0.34);
            group.add(pipe);
        }

        return group;
    }

    function createHospitalMesh(level) {
        const group = new THREE.Group();

        // Note: the hospital occupies 2x1 tiles, so the caller scales this group
        // on X. Keep proportions in local space.
        const width = [0.75, 0.8, 0.84][level - 1];
        const depth = [0.6, 0.64, 0.68][level - 1];
        const height = [0.55, 0.78, 0.95][level - 1];

        const body = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, depth),
            new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.85 })
        );
        body.position.y = height / 2;
        group.add(body);

        const roofCap = new THREE.Mesh(
            new THREE.BoxGeometry(width + 0.05, 0.05, depth + 0.05),
            new THREE.MeshStandardMaterial({ color: 0xd8524c, roughness: 0.8 })
        );
        roofCap.position.y = height + 0.025;
        group.add(roofCap);

        const crossMaterial = new THREE.MeshStandardMaterial({ color: 0xd8524c, roughness: 0.7 });
        const crossY = height * 0.66;
        const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.02), crossMaterial);
        crossV.position.set(0, crossY, depth / 2 + 0.001);
        group.add(crossV);

        const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.02), crossMaterial);
        crossH.position.set(0, crossY, depth / 2 + 0.001);
        group.add(crossH);

        const door = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.02), doorMaterial);
        door.position.set(0, 0.1, depth / 2 + 0.001);
        group.add(door);

        addWindowGrid(group, 4, level, 0.3, 0.24, width * 0.66, depth / 2 + 0.001, 0.08, 0.1);

        if (level >= 2) {
            // Rooftop helipad and an ambulance canopy over the entrance.
            const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 18), darkMetalMaterial);
            pad.position.set(width * 0.22, height + 0.06, -depth * 0.14);
            group.add(pad);

            const padMark = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 18), trimMaterial);
            padMark.position.set(width * 0.22, height + 0.075, -depth * 0.14);
            group.add(padMark);

            const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.16), trimMaterial);
            canopy.position.set(0, 0.26, depth / 2 + 0.08);
            group.add(canopy);

            [-0.15, 0.15].forEach(function (x) {
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.26, 8), metalMaterial);
                post.position.set(x, 0.13, depth / 2 + 0.14);
                group.add(post);
            });
        }

        if (level === 3) {
            // Taller treatment wing set back from the main block.
            const wingH = 0.42;
            const wing = new THREE.Mesh(
                new THREE.BoxGeometry(width * 0.42, wingH, depth * 0.6),
                new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.85 })
            );
            wing.position.set(-width * 0.26, height + wingH / 2, -depth * 0.1);
            group.add(wing);

            const wingGlass = new THREE.Mesh(new THREE.BoxGeometry(width * 0.32, 0.24, 0.02), glassMaterial);
            wingGlass.position.set(-width * 0.26, height + wingH * 0.55, -depth * 0.1 + depth * 0.3 + 0.001);
            group.add(wingGlass);

            const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.22, 6), metalMaterial);
            mast.position.set(-width * 0.4, height + wingH + 0.11, -depth * 0.1);
            group.add(mast);
        }

        return group;
    }

    function createPoliceMesh(level) {
        const group = new THREE.Group();

        // L3 narrows the main block to make room for the vehicle bay beside it,
        // so the pair together still fit inside one tile.
        const width = [0.7, 0.76, 0.54][level - 1];
        const depth = [0.58, 0.62, 0.66][level - 1];
        const height = [0.5, 0.72, 0.9][level - 1];

        const body = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, depth),
            new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.85 })
        );
        body.position.y = height / 2;
        group.add(body);

        const roofCap = new THREE.Mesh(
            new THREE.BoxGeometry(width + 0.05, 0.05, depth + 0.05),
            new THREE.MeshStandardMaterial({ color: 0x2d4a70, roughness: 0.8 })
        );
        roofCap.position.y = height + 0.025;
        group.add(roofCap);

        const badge = new THREE.Mesh(
            new THREE.CylinderGeometry(0.09, 0.09, 0.02, 6),
            new THREE.MeshStandardMaterial({ color: 0x2d4a70, roughness: 0.6 })
        );
        badge.rotation.x = Math.PI / 2;
        badge.position.set(0, height * 0.7, depth / 2 + 0.001);
        group.add(badge);

        const door = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.22, 0.02), doorMaterial);
        door.position.set(0, 0.11, depth / 2 + 0.001);
        group.add(door);

        if (level >= 2) {
            addWindowGrid(group, 3, level - 1, 0.44, 0.24, width * 0.62, depth / 2 + 0.001, 0.1, 0.11);

            // Comms mast on the roof.
            const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.3, 6), metalMaterial);
            mast.position.set(width * 0.35, height + 0.2, -depth * 0.3);
            group.add(mast);

            const dish = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), trimMaterial);
            dish.rotation.x = Math.PI * 0.85;
            dish.position.set(width * 0.35, height + 0.35, -depth * 0.3);
            group.add(dish);

            // Blue light bar over the entrance.
            const lightBar = new THREE.Mesh(
                new THREE.BoxGeometry(0.14, 0.03, 0.05),
                new THREE.MeshStandardMaterial({ color: 0x3d7edb, roughness: 0.4, metalness: 0.2 })
            );
            lightBar.position.set(0, 0.27, depth / 2 + 0.03);
            group.add(lightBar);
        }

        if (level === 3) {
            // Vehicle bay alongside the narrowed main block. bayX accounts for the
            // roof overhang so the widest part still lands inside the tile.
            const bayW = 0.22;
            const bayH = 0.3;
            const bayX = -(width / 2 + bayW / 2 - 0.04);

            const bay = new THREE.Mesh(
                new THREE.BoxGeometry(bayW, bayH, depth * 0.7),
                new THREE.MeshStandardMaterial({ color: 0xd6d2c8, roughness: 0.9 })
            );
            bay.position.set(bayX, bayH / 2, depth * 0.1);
            group.add(bay);

            const bayRoof = new THREE.Mesh(
                new THREE.BoxGeometry(bayW + 0.03, 0.04, depth * 0.74),
                new THREE.MeshStandardMaterial({ color: 0x2d4a70, roughness: 0.8 })
            );
            bayRoof.position.set(bayX, bayH + 0.02, depth * 0.1);
            group.add(bayRoof);

            const shutter = new THREE.Mesh(new THREE.BoxGeometry(bayW * 0.72, 0.22, 0.02), darkMetalMaterial);
            shutter.position.set(bayX, 0.11, depth * 0.1 + depth * 0.35 + 0.001);
            group.add(shutter);
        }

        return group;
    }

    function createOfficeMesh(level) {
        const group = new THREE.Group();

        const width = [0.58, 0.62, 0.66][level - 1];
        const depth = [0.58, 0.62, 0.62][level - 1];
        const height = [0.85, 1.3, 1.75][level - 1];
        const bands = [3, 5, 7][level - 1];

        const body = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, depth),
            new THREE.MeshStandardMaterial({ color: 0x7d92a8, roughness: 0.55, metalness: 0.15 })
        );
        body.position.y = height / 2;
        group.add(body);

        const roofCap = new THREE.Mesh(
            new THREE.BoxGeometry(width + 0.04, 0.04, depth + 0.04),
            new THREE.MeshStandardMaterial({ color: 0x4a5a6b, roughness: 0.7 })
        );
        roofCap.position.y = height + 0.02;
        group.add(roofCap);

        // Glass bands wrap the front face, one per floor group.
        const bandStep = (height - 0.3) / Math.max(bands - 1, 1);
        for (let b = 0; b < bands; b++) {
            const y = 0.2 + b * bandStep;
            const stripe = new THREE.Mesh(
                new THREE.BoxGeometry(width * 0.86, 0.05, 0.02),
                level === 1 ? windowMaterial : glassMaterial
            );
            stripe.position.set(0, y, depth / 2 + 0.001);
            group.add(stripe);

            if (level >= 2) {
                // Wrap the glazing round the sides too.
                const sideStripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, depth * 0.86), glassMaterial);
                sideStripe.position.set(width / 2 + 0.001, y, 0);
                group.add(sideStripe);
            }
        }

        if (level >= 2) {
            // Entrance canopy at street level.
            const canopy = new THREE.Mesh(new THREE.BoxGeometry(width * 0.6, 0.03, 0.12), metalMaterial);
            canopy.position.set(0, 0.22, depth / 2 + 0.06);
            group.add(canopy);
        }

        if (level === 3) {
            // Setback crown plus a mast — makes the L3 tower unmistakable.
            const crownH = 0.26;
            const crown = new THREE.Mesh(
                new THREE.BoxGeometry(width * 0.7, crownH, depth * 0.7),
                new THREE.MeshStandardMaterial({ color: 0x6d8296, roughness: 0.5, metalness: 0.2 })
            );
            crown.position.y = height + crownH / 2 + 0.02;
            group.add(crown);

            const crownGlass = new THREE.Mesh(new THREE.BoxGeometry(width * 0.6, 0.12, 0.02), glassMaterial);
            crownGlass.position.set(0, height + crownH * 0.6, depth * 0.35 + 0.001);
            group.add(crownGlass);

            const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.3, 6), metalMaterial);
            mast.position.y = height + crownH + 0.17;
            group.add(mast);

            const beacon = new THREE.Mesh(
                new THREE.SphereGeometry(0.022, 8, 6),
                new THREE.MeshStandardMaterial({ color: 0xe0554f, roughness: 0.4 })
            );
            beacon.position.y = height + crownH + 0.33;
            group.add(beacon);
        }

        return group;
    }

    function createStadiumMesh(level) {
        const group = new THREE.Group();

        // The stand is a torus, so its true reach is radius + tube thickness. These
        // pairs keep that sum inside the tile at every level while still growing.
        const radius = [0.36, 0.38, 0.39][level - 1];
        const standThickness = [0.1, 0.1, 0.1][level - 1];
        const standY = [0.1, 0.14, 0.18][level - 1];

        const field = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius, 0.04, 22),
            new THREE.MeshStandardMaterial({ color: 0x5fae5a, roughness: 0.9 })
        );
        field.position.y = 0.02;
        group.add(field);

        // Pitch markings.
        const centreCircle = new THREE.Mesh(
            new THREE.TorusGeometry(radius * 0.26, 0.008, 6, 20),
            new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.9 })
        );
        centreCircle.rotation.x = Math.PI / 2;
        centreCircle.position.y = 0.042;
        group.add(centreCircle);

        const stand = new THREE.Mesh(
            new THREE.TorusGeometry(radius, standThickness, 8, 22),
            new THREE.MeshStandardMaterial({ color: 0xb7bfc9, roughness: 0.85, flatShading: true })
        );
        stand.rotation.x = Math.PI / 2;
        stand.position.y = standY;
        group.add(stand);

        const lightMaterial = new THREE.MeshStandardMaterial({ color: 0xf3f6f8, roughness: 0.6 });
        const poleCount = [4, 6, 8][level - 1];
        const poleHeight = [0.3, 0.42, 0.54][level - 1];

        for (let p = 0; p < poleCount; p++) {
            const angle = (p / poleCount) * Math.PI * 2 + Math.PI / poleCount;
            const px = Math.cos(angle) * (radius + 0.04);
            const pz = Math.sin(angle) * (radius + 0.04);

            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, poleHeight, 6), lightMaterial);
            pole.position.set(px, poleHeight / 2, pz);
            group.add(pole);

            if (level >= 2) {
                const lampHead = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.03), trimMaterial);
                lampHead.position.set(px, poleHeight + 0.02, pz);
                lampHead.lookAt(0, poleHeight, 0);
                group.add(lampHead);
            }
        }

        if (level >= 2) {
            // Upper tier ring.
            const upperTier = new THREE.Mesh(
                new THREE.TorusGeometry(radius + 0.02, standThickness * 0.55, 8, 22),
                new THREE.MeshStandardMaterial({ color: 0xa2abb5, roughness: 0.85, flatShading: true })
            );
            upperTier.rotation.x = Math.PI / 2;
            upperTier.position.y = standY + 0.13;
            group.add(upperTier);
        }

        if (level === 3) {
            // Cantilevered roof ring and a big screen.
            const roofRing = new THREE.Mesh(
                new THREE.TorusGeometry(radius + 0.02, 0.035, 8, 24),
                new THREE.MeshStandardMaterial({ color: 0xdfe4e9, roughness: 0.6, metalness: 0.25 })
            );
            roofRing.rotation.x = Math.PI / 2;
            roofRing.position.y = standY + 0.32;
            group.add(roofRing);

            const screen = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.03), solarMaterial);
            screen.position.set(0, standY + 0.34, -radius * 0.5);
            group.add(screen);

            const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.16, 0.02), darkMetalMaterial);
            screenFrame.position.set(0, standY + 0.34, -radius * 0.5 - 0.02);
            group.add(screenFrame);
        }

        return group;
    }

    function createStructureMesh(modelKey, level) {
        switch (modelKey) {
            // Roads are not upgradeable — their progression is the lane variants.
            case 'road':
                return createRoadMesh(2, roadSurfaceMaterial2Lane);
            case 'road_4lane':
                return createRoadMesh(4, roadSurfaceMaterial4Lane);
            case 'road_6lane':
                return createRoadMesh(6, roadSurfaceMaterial6Lane);
            case 'house':
                return createHouseMesh(level);
            case 'shop':
                return createAwningBuildingMesh(0x5b8fd1, 0xff9f43, level);
            case 'cafe':
                return createAwningBuildingMesh(0x9c6b4a, 0xf2d9a6, level);
            case 'school':
                return createSchoolMesh(level);
            case 'park':
                return createParkMesh(level);
            case 'apartment':
                return createApartmentMesh(level);
            case 'factory':
                return createFactoryMesh(level);
            case 'hospital':
                return createHospitalMesh(level);
            case 'police':
                return createPoliceMesh(level);
            case 'office':
                return createOfficeMesh(level);
            case 'stadium':
                return createStadiumMesh(level);
            default:
                return createHouseMesh(level);
        }
    }

    // A model's local space is one tile: everything it draws must stay inside
    // +/-0.5 on X and Z. Multi-tile structures get there by the caller scaling the
    // whole mesh by (tileWidth, 1, tileHeight), so the budget is the same for all.
    const TILE_HALF_EXTENT = 0.5;
    const TILE_FIT_TOLERANCE = 0.001;
    const fitScratchVector = new THREE.Vector3();

    /**
     * Furthest any actual vertex reaches from the tile centre on X or Z.
     *
     * Deliberately walks real vertices rather than using Box3.setFromObject:
     * that transforms each geometry's axis-aligned box, which over-reports badly
     * for rotated parts (a 45-degree pyramid roof measures sqrt(2) too wide) and
     * would shrink perfectly well-fitting models.
     */
    function measureTileExtent(root) {
        root.updateMatrixWorld(true);

        let maxExtent = 0;

        root.traverse(function (child) {
            if (!child.isMesh || !child.geometry || !child.geometry.attributes) {
                return;
            }
            const positions = child.geometry.attributes.position;
            if (!positions) {
                return;
            }

            for (let i = 0; i < positions.count; i++) {
                fitScratchVector.fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld);
                const extent = Math.max(Math.abs(fitScratchVector.x), Math.abs(fitScratchVector.z));
                if (extent > maxExtent) {
                    maxExtent = extent;
                }
            }
        });

        return maxExtent;
    }

    /**
     * Backstop that guarantees no model can ever spill onto a neighbouring tile.
     * Measures what was actually built and, if any part reaches past the tile
     * edge, scales the whole thing down to fit. Scaling is uniform so the model
     * keeps its proportions rather than being squashed.
     *
     * The per-level models are authored to fit already, so in practice this
     * should not need to do anything — it exists so that a future model, or a
     * new decoration, cannot silently reintroduce the overhang.
     */
    function fitWithinTile(group) {
        const maxExtent = measureTileExtent(group);

        if (maxExtent > TILE_HALF_EXTENT + TILE_FIT_TOLERANCE) {
            group.scale.multiplyScalar(TILE_HALF_EXTENT / maxExtent);
        }
    }

    function createBuildingMesh(modelKey, level) {
        const safeLevel = clampLevel(level);
        const inner = createStructureMesh(modelKey, safeLevel);
        decoratePlot(inner, modelKey, safeLevel);

        // Roads are exempt: their arms are meant to reach the tile edge exactly so
        // adjacent tiles meet with no seam, and shrinking them would open gaps.
        if (!isRoadModelKey(modelKey)) {
            fitWithinTile(inner);
        }

        // Wrapper so the fit scale survives the caller's mesh.scale.set() for
        // multi-tile footprints.
        const outer = new THREE.Group();
        outer.add(inner);
        return outer;
    }

    function animateScaleIn(object3d, durationMs) {
        const duration = durationMs || 250;
        const startTime = performance.now();

        // Animate *relative* to whatever scale the object already carries — a 2x2
        // stadium is scaled (2,1,2) before this runs, and setting a flat scalar
        // here used to collapse it back to a single tile once the animation ended.
        const baseScale = object3d.scale.clone();

        function applyProgress(progress) {
            const factor = Math.max(progress, 0.001);
            object3d.scale.set(baseScale.x * factor, baseScale.y * factor, baseScale.z * factor);
        }

        applyProgress(0.001);

        function step(time) {
            const elapsed = time - startTime;
            const t = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            applyProgress(eased);

            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                object3d.scale.copy(baseScale);
            }
        }

        requestAnimationFrame(step);
    }

    const buildingsGroup = new THREE.Group();
    scene.add(buildingsGroup);

    const placedBuildingsByAnchorKey = new Map();
    const occupiedTileToAnchorKey = new Map();

    function renderPlacedBuilding(building, options) {
        const anchorKey = tileKey(building.tile_x, building.tile_y);
        if (placedBuildingsByAnchorKey.has(anchorKey)) {
            return;
        }

        const tileWidth = Number(building.tile_width) || 1;
        const tileHeight = Number(building.tile_height) || 1;
        const rotation = Number(building.rotation) || 0;
        const level = clampLevel(building.level);

        const mesh = createBuildingMesh(building.model_key, level);
        mesh.traverse(function (child) {
            if (child.isMesh) {
                child.castShadow = true;
            }
        });
        mesh.scale.set(tileWidth, 1, tileHeight);

        const center = footprintCenterWorld(building.tile_x, building.tile_y, tileWidth, tileHeight, rotation);
        mesh.position.set(center.x, BUILDING_BASE_Y, center.z);
        mesh.rotation.y = THREE.MathUtils.degToRad(rotation);

        if (options && options.animate) {
            animateScaleIn(mesh, 250);
        }

        buildingsGroup.add(mesh);

        const footprint = footprintTiles(building.tile_x, building.tile_y, tileWidth, tileHeight, rotation);
        footprint.forEach(function (tile) {
            occupiedTileToAnchorKey.set(tileKey(tile.x, tile.y), anchorKey);
        });

        placedBuildingsByAnchorKey.set(anchorKey, {
            tile_x: building.tile_x,
            tile_y: building.tile_y,
            building_type_id: building.building_type_id,
            code: building.code,
            model_key: building.model_key,
            name: building.name,
            category: building.category,
            level: level,
            upgradable: building.upgradable !== false && building.category !== 'road',
            next_upgrade_cost: building.next_upgrade_cost !== undefined ? building.next_upgrade_cost : null,
            rotation: rotation,
            tile_width: tileWidth,
            tile_height: tileHeight,
            footprint: footprint,
            mesh: mesh,
        });
    }

    /**
     * Swaps a placed building's mesh for the model of its new level, keeping its
     * position, rotation and footprint. Used after a successful upgrade.
     */
    function reRenderPlacedBuildingAtLevel(anchorTileX, anchorTileY, newLevel, nextUpgradeCost) {
        const anchorKey = tileKey(anchorTileX, anchorTileY);
        const record = placedBuildingsByAnchorKey.get(anchorKey);
        if (!record) {
            return;
        }

        buildingsGroup.remove(record.mesh);

        const level = clampLevel(newLevel);
        const mesh = createBuildingMesh(record.model_key, level);
        mesh.traverse(function (child) {
            if (child.isMesh) {
                child.castShadow = true;
            }
        });
        mesh.scale.set(record.tile_width, 1, record.tile_height);

        const center = footprintCenterWorld(
            record.tile_x, record.tile_y, record.tile_width, record.tile_height, record.rotation
        );
        mesh.position.set(center.x, BUILDING_BASE_Y, center.z);
        mesh.rotation.y = THREE.MathUtils.degToRad(record.rotation);
        buildingsGroup.add(mesh);

        animateScaleIn(mesh, 320);

        record.mesh = mesh;
        record.level = level;
        record.next_upgrade_cost = nextUpgradeCost !== undefined ? nextUpgradeCost : null;
    }

    function getPlacedBuilding(tileX, tileY) {
        const anchorKey = occupiedTileToAnchorKey.get(tileKey(tileX, tileY));
        if (!anchorKey) {
            return null;
        }
        return placedBuildingsByAnchorKey.get(anchorKey) || null;
    }

    function removePlacedBuildingMesh(anchorTileX, anchorTileY) {
        const anchorKey = tileKey(anchorTileX, anchorTileY);
        const record = placedBuildingsByAnchorKey.get(anchorKey);
        if (!record) {
            return;
        }

        buildingsGroup.remove(record.mesh);
        record.footprint.forEach(function (tile) {
            occupiedTileToAnchorKey.delete(tileKey(tile.x, tile.y));
        });
        placedBuildingsByAnchorKey.delete(anchorKey);
    }

    // ---- Selection highlight ----

    const highlightGeometry = new THREE.PlaneGeometry(1, 1);
    const highlightMaterial = new THREE.MeshBasicMaterial({
        color: HIGHLIGHT_COLOR,
        transparent: true,
        opacity: HIGHLIGHT_OPACITY,
        side: THREE.DoubleSide,
    });
    const highlight = new THREE.Mesh(highlightGeometry, highlightMaterial);
    highlight.rotation.x = -Math.PI / 2;
    highlight.position.y = HIGHLIGHT_Y;
    highlight.visible = false;
    scene.add(highlight);

    let highlightFadeStart = null;

    function flashHighlight(tileX, tileY) {
        const center = tileCenterWorld(tileX, tileY);
        highlight.position.set(center.x, HIGHLIGHT_Y, center.z);
        highlight.visible = true;
        highlightMaterial.opacity = HIGHLIGHT_OPACITY;
        highlightFadeStart = performance.now();
    }

    // ---- Hover outline ----

    const HOVER_Y = 0.028;
    const hoverOutlineGeometry = new THREE.BufferGeometry();
    hoverOutlineGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
            [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5],
            3
        )
    );
    const hoverOutlineMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
    });
    const hoverOutline = new THREE.LineLoop(hoverOutlineGeometry, hoverOutlineMaterial);
    hoverOutline.position.y = HOVER_Y;
    hoverOutline.visible = false;
    scene.add(hoverOutline);

    function updateHoverOutline(tileX, tileY) {
        const center = tileCenterWorld(tileX, tileY);
        hoverOutline.position.set(center.x, HOVER_Y, center.z);
        hoverOutline.visible = true;
    }

    function hideHoverOutline() {
        hoverOutline.visible = false;
    }

    // ---- Area selection overlay (shift + drag) ----

    const AREA_Y = 0.033;

    const areaFillMaterial = new THREE.MeshBasicMaterial({
        color: 0x3d8bd6,
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    const areaFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), areaFillMaterial);
    areaFill.rotation.x = -Math.PI / 2;
    areaFill.position.y = AREA_Y;
    areaFill.visible = false;
    scene.add(areaFill);

    const areaOutlineGeometry = new THREE.BufferGeometry();
    areaOutlineGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3)
    );
    const areaOutline = new THREE.LineLoop(
        areaOutlineGeometry,
        new THREE.LineBasicMaterial({ color: 0x2f7ec4, transparent: true, opacity: 0.95 })
    );
    areaOutline.position.y = AREA_Y + 0.002;
    areaOutline.visible = false;
    scene.add(areaOutline);

    function areaRectFromTiles(a, b) {
        return {
            minX: Math.min(a.x, b.x),
            maxX: Math.max(a.x, b.x),
            minY: Math.min(a.y, b.y),
            maxY: Math.max(a.y, b.y),
        };
    }

    function tilesInRect(rect) {
        const tiles = [];
        for (let x = rect.minX; x <= rect.maxX; x++) {
            for (let y = rect.minY; y <= rect.maxY; y++) {
                tiles.push({ x: x, y: y });
            }
        }
        return tiles;
    }

    function showAreaOverlay(rect) {
        const width = rect.maxX - rect.minX + 1;
        const height = rect.maxY - rect.minY + 1;
        const center = tileCenterWorld(
            rect.minX + (width - 1) / 2,
            rect.minY + (height - 1) / 2
        );

        areaFill.scale.set(width, height, 1);
        areaFill.position.set(center.x, AREA_Y, center.z);
        areaFill.visible = true;

        areaOutline.scale.set(width, height, 1);
        areaOutline.position.set(center.x, AREA_Y + 0.002, center.z);
        areaOutline.visible = true;
    }

    function hideAreaOverlay() {
        areaFill.visible = false;
        areaOutline.visible = false;
    }

    // ---- Footprint highlight (multi-tile valid/invalid overlay while placing) ----

    const footprintHighlightGeometry = new THREE.PlaneGeometry(1, 1);
    const footprintHighlightMaterialValid = new THREE.MeshBasicMaterial({
        color: 0x4caf50,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
    });
    const footprintHighlightMaterialInvalid = new THREE.MeshBasicMaterial({
        color: 0xe6453c,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
    });
    const footprintHighlight = new THREE.Mesh(footprintHighlightGeometry, footprintHighlightMaterialValid);
    footprintHighlight.rotation.x = -Math.PI / 2;
    footprintHighlight.position.y = HOVER_Y + 0.001;
    footprintHighlight.visible = false;
    scene.add(footprintHighlight);

    function isFootprintValid(footprint) {
        for (let i = 0; i < footprint.length; i++) {
            const tile = footprint[i];
            if (tile.x < 0 || tile.x >= GRID_SIZE || tile.y < 0 || tile.y >= GRID_SIZE) {
                return false;
            }
            if (!isTileUnlocked(tile.x, tile.y)) {
                return false;
            }
            if (getPlacedBuilding(tile.x, tile.y)) {
                return false;
            }
        }
        return true;
    }

    function showFootprintHighlight(anchorX, anchorY, tileWidth, tileHeight, rotation) {
        const swap = (rotation === 90 || rotation === 270);
        const effectiveWidth = swap ? tileHeight : tileWidth;
        const effectiveHeight = swap ? tileWidth : tileHeight;
        const footprint = footprintTiles(anchorX, anchorY, tileWidth, tileHeight, rotation);
        const valid = isFootprintValid(footprint);
        const center = footprintCenterWorld(anchorX, anchorY, tileWidth, tileHeight, rotation);

        footprintHighlight.scale.set(effectiveWidth, effectiveHeight, 1);
        footprintHighlight.position.set(center.x, HOVER_Y + 0.001, center.z);
        footprintHighlight.material = valid ? footprintHighlightMaterialValid : footprintHighlightMaterialInvalid;
        footprintHighlight.visible = true;

        return valid;
    }

    function hideFootprintHighlight() {
        footprintHighlight.visible = false;
    }

    // ---- Building placement preview (rotatable ghost) ----

    let previewGroup = null;
    let pendingRotation = 0;
    let previewTileWidth = 1;
    let previewTileHeight = 1;

    function makePreviewMesh(modelKey) {
        // New buildings are always placed at level 1, so that is what the ghost shows.
        const mesh = createBuildingMesh(modelKey, 1);
        mesh.traverse(function (child) {
            if (child.isMesh) {
                child.material = child.material.clone();
                child.material.transparent = true;
                child.material.opacity = 0.55;
                child.castShadow = false;
            }
        });
        return mesh;
    }

    function setPreviewModel(buildingType) {
        if (previewGroup) {
            scene.remove(previewGroup);
            previewGroup = null;
        }
        if (!buildingType) {
            previewTileWidth = 1;
            previewTileHeight = 1;
            return;
        }
        previewTileWidth = Number(buildingType.tile_width) || 1;
        previewTileHeight = Number(buildingType.tile_height) || 1;
        previewGroup = makePreviewMesh(buildingType.model_key);
        previewGroup.visible = false;
        previewGroup.scale.set(previewTileWidth, 1, previewTileHeight);
        previewGroup.rotation.y = THREE.MathUtils.degToRad(pendingRotation);
        scene.add(previewGroup);
    }

    function updatePreviewRotation() {
        if (previewGroup) {
            previewGroup.rotation.y = THREE.MathUtils.degToRad(pendingRotation);
        }
    }

    function showPreviewAt(tileX, tileY) {
        if (!previewGroup) {
            return;
        }
        const center = footprintCenterWorld(tileX, tileY, previewTileWidth, previewTileHeight, pendingRotation);
        previewGroup.position.set(center.x, BUILDING_BASE_Y, center.z);
        previewGroup.visible = true;
    }

    function hidePreview() {
        if (previewGroup) {
            previewGroup.visible = false;
        }
    }

    document.addEventListener('keydown', function (event) {
        if (event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA')) {
            return;
        }
        if (!selectedBuildingType) {
            return;
        }

        const key = event.key.toLowerCase();
        if (key === 'q') {
            pendingRotation = (pendingRotation + 270) % 360;
            updatePreviewRotation();
            if (lastHoverTile) {
                updateHoverVisuals(lastHoverTile.x, lastHoverTile.y);
            }
        } else if (key === 'e') {
            pendingRotation = (pendingRotation + 90) % 360;
            updatePreviewRotation();
            if (lastHoverTile) {
                updateHoverVisuals(lastHoverTile.x, lastHoverTile.y);
            }
        }
    });

    // ---- Tile info panel + land-unlock flow ----

    let cityDataLoaded = false;
    let tileUnlockCost = null;
    let pendingAction = null;
    let pendingUpgrade = null;
    let messageResetTimer = null;

    function clearMessageResetTimer() {
        if (messageResetTimer !== null) {
            clearTimeout(messageResetTimer);
            messageResetTimer = null;
        }
    }

    function showMessage(text, options) {
        clearMessageResetTimer();

        if (tileMessageEl) {
            tileMessageEl.textContent = text;
        }

        const withConfirm = !!(options && options.withConfirm);
        if (tileConfirmBtn) {
            tileConfirmBtn.classList.toggle('hidden', !withConfirm);
            if (withConfirm) {
                const confirmLabel = (options && options.confirmLabel) || 'Confirm';
                tileConfirmBtn.textContent = confirmLabel;
                tileConfirmBtn.classList.toggle('tile-info-confirm-danger', confirmLabel === 'Remove');
            }
        }

        // The upgrade button is opt-in per message, so it disappears again as soon
        // as the panel shows anything else.
        if (tileUpgradeBtn) {
            const upgradeLabel = options && options.upgradeLabel;
            tileUpgradeBtn.classList.toggle('hidden', !upgradeLabel);
            if (upgradeLabel) {
                tileUpgradeBtn.textContent = upgradeLabel;
            }
        }

        if (options && options.autoHide) {
            messageResetTimer = setTimeout(function () {
                if (tileMessageEl) {
                    tileMessageEl.textContent = DEFAULT_MESSAGE;
                }
                messageResetTimer = null;
            }, MESSAGE_AUTO_HIDE_MS);
        }
    }

    function updateHudBudget(budget) {
        if (typeof window.animateHudBudget === 'function') {
            window.animateHudBudget(budget);
            return;
        }
        const hudBudgetEl = document.getElementById('hud-budget');
        if (hudBudgetEl) {
            hudBudgetEl.textContent = formatCurrency(budget);
        }
    }

    function updateHudPopulation(population) {
        if (typeof window.animateHudPopulation === 'function') {
            window.animateHudPopulation(population);
            return;
        }
        const hudPopulationEl = document.getElementById('hud-population');
        if (hudPopulationEl) {
            hudPopulationEl.textContent = String(population);
        }
    }

    let selectedBuildingType = window.__selectedBuildingType || null;
    setPreviewModel(selectedBuildingType);

    document.addEventListener('building-type:selected', function (event) {
        selectedBuildingType = event.detail || null;
        pendingRotation = 0;
        setPreviewModel(selectedBuildingType);
        setGridEmphasis(selectedBuildingType !== null);
        if (lastHoverTile) {
            updateHoverVisuals(lastHoverTile.x, lastHoverTile.y);
        }
        // Costs and available actions depend on what is selected in the build menu.
        if (areaSelection !== null) {
            renderAreaPanel();
        }
    });

    // ---- Area selection: action panel ----

    const areaPanelEl = document.getElementById('area-panel');
    const areaPanelTitleEl = document.getElementById('area-panel-title');
    const areaPanelActionsEl = document.getElementById('area-panel-actions');
    const areaPanelCloseEl = document.getElementById('area-panel-close');

    let areaSelection = null;   // { tiles: [...], rect: {...} }
    let areaBusy = false;

    function clearAreaSelection() {
        areaSelection = null;
        hideAreaOverlay();
        if (areaPanelEl) {
            areaPanelEl.classList.add('hidden');
        }
        setGridEmphasis(selectedBuildingType !== null);
    }

    if (areaPanelCloseEl) {
        areaPanelCloseEl.addEventListener('click', clearAreaSelection);
    }

    /**
     * Works out which bulk actions make sense for the current selection, using
     * the same rules the server enforces so the numbers shown always match.
     */
    function describeAreaActions(tiles) {
        // Locked tiles that can chain outward from owned land.
        const owned = {};
        unlockedTileKeys.forEach(function (key) {
            owned[key] = true;
        });

        const pending = {};
        tiles.forEach(function (tile) {
            const key = tileKey(tile.x, tile.y);
            if (!owned[key]) {
                pending[key] = tile;
            }
        });

        let reachable = 0;
        let grew = true;
        while (grew) {
            grew = false;
            Object.keys(pending).forEach(function (key) {
                const tile = pending[key];
                const touches = owned[tileKey(tile.x - 1, tile.y)]
                    || owned[tileKey(tile.x + 1, tile.y)]
                    || owned[tileKey(tile.x, tile.y - 1)]
                    || owned[tileKey(tile.x, tile.y + 1)];
                if (touches) {
                    owned[key] = true;
                    delete pending[key];
                    reachable++;
                    grew = true;
                }
            });
        }

        // Distinct buildings the selection touches. Costs come from the catalogue
        // the build menu already loaded.
        const catalogue = window.__buildingTypesById || {};
        const buildingAnchors = {};
        let refund = 0;
        tiles.forEach(function (tile) {
            const record = getPlacedBuilding(tile.x, tile.y);
            if (record) {
                const anchor = tileKey(record.tile_x, record.tile_y);
                if (!buildingAnchors[anchor]) {
                    buildingAnchors[anchor] = record;
                    const type = catalogue[String(record.building_type_id)];
                    refund += type ? (Number(type.cost) || 0) : 0;
                }
            }
        });

        // Free, already-owned tiles a road could go on.
        let roadable = 0;
        tiles.forEach(function (tile) {
            if (isTileUnlocked(tile.x, tile.y) && !getPlacedBuilding(tile.x, tile.y)) {
                roadable++;
            }
        });

        return {
            unlockCount: reachable,
            unlockCost: reachable * (Number(tileUnlockCost) || 0),
            removeCount: Object.keys(buildingAnchors).length,
            removeRefund: refund,
            roadCount: roadable,
        };
    }

    function makeAreaActionButton(icon, label, costText, costClass, danger, onClick, disabled) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'area-action' + (danger ? ' area-action-danger' : '');
        button.disabled = !!disabled || areaBusy;

        const iconEl = document.createElement('span');
        iconEl.className = 'area-action-icon';
        iconEl.textContent = icon;
        button.appendChild(iconEl);

        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        button.appendChild(labelEl);

        if (costText) {
            const costEl = document.createElement('span');
            costEl.className = 'area-action-cost' + (costClass ? ' ' + costClass : '');
            costEl.textContent = costText;
            button.appendChild(costEl);
        }

        button.addEventListener('click', onClick);
        return button;
    }

    function renderAreaPanel() {
        if (!areaPanelEl || !areaPanelActionsEl || areaSelection === null) {
            return;
        }

        const tiles = areaSelection.tiles;
        const info = describeAreaActions(tiles);

        areaPanelTitleEl.textContent = tiles.length + ' tile' + (tiles.length === 1 ? '' : 's') + ' selected';
        areaPanelActionsEl.innerHTML = '';

        let added = 0;

        if (info.unlockCount > 0) {
            areaPanelActionsEl.appendChild(makeAreaActionButton(
                '🗺️',
                'Buy ' + info.unlockCount + ' tile' + (info.unlockCount === 1 ? '' : 's'),
                formatCurrency(info.unlockCost),
                'is-spend',
                false,
                function () { runAreaUnlock(tiles); }
            ));
            added++;
        }

        const roadSelected = selectedBuildingType && selectedBuildingType.category === 'road';
        if (roadSelected && info.roadCount > 0) {
            const roadCost = info.roadCount * (Number(selectedBuildingType.cost) || 0);
            areaPanelActionsEl.appendChild(makeAreaActionButton(
                '🛣️',
                'Build ' + info.roadCount + ' × ' + selectedBuildingType.name,
                formatCurrency(roadCost),
                'is-spend',
                false,
                function () { runAreaRoad(tiles); }
            ));
            added++;
        }

        if (info.removeCount > 0) {
            areaPanelActionsEl.appendChild(makeAreaActionButton(
                '🗑️',
                'Remove ' + info.removeCount + ' structure' + (info.removeCount === 1 ? '' : 's'),
                '+' + formatCurrency(info.removeRefund),
                '',
                true,
                function () { runAreaRemove(tiles); }
            ));
            added++;
        }

        if (added === 0) {
            const empty = document.createElement('p');
            empty.className = 'area-panel-empty';
            empty.textContent = roadSelected
                ? 'Nothing to do here — these tiles are already built on.'
                : 'Nothing to do here. Select a road to pave this area, or pick tiles next to your city to buy them.';
            areaPanelActionsEl.appendChild(empty);
        }

        areaPanelEl.classList.remove('hidden');
    }

    function setAreaBusy(busy) {
        areaBusy = busy;
        if (!areaPanelActionsEl) {
            return;
        }
        areaPanelActionsEl.querySelectorAll('.area-action').forEach(function (button) {
            button.disabled = busy;
        });
    }

    function runAreaUnlock(tiles) {
        setAreaBusy(true);
        showMessage('Buying land…', { withConfirm: false, autoHide: false });

        window.apiFetch('api/area-unlock.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tiles: tiles }),
        })
            .then(function (response) { return response.json(); })
            .then(function (body) {
                if (body.status === 'success') {
                    (body.data.unlocked || []).forEach(function (tile) {
                        markTileUnlocked(tile.x, tile.y, { animate: true });
                    });
                    updateHudBudget(body.data.budget);
                    showMessage(body.message, { withConfirm: false, autoHide: true });
                    clearAreaSelection();
                } else {
                    showMessage(body.message || 'Could not buy this land.', { withConfirm: false, autoHide: true });
                }
            })
            .catch(function () {
                showMessage('Network error. Please try again.', { withConfirm: false, autoHide: true });
            })
            .finally(function () {
                setAreaBusy(false);
                if (areaSelection !== null) {
                    renderAreaPanel();
                }
            });
    }

    function runAreaRoad(tiles) {
        if (!selectedBuildingType) {
            return;
        }

        setAreaBusy(true);
        showMessage('Building road…', { withConfirm: false, autoHide: false });

        window.apiFetch('api/area-road.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tiles: tiles,
                building_type_id: selectedBuildingType.id,
                rotation: pendingRotation,
            }),
        })
            .then(function (response) { return response.json(); })
            .then(function (body) {
                if (body.status === 'success') {
                    (body.data.placed || []).forEach(function (building) {
                        renderPlacedBuilding(building, { animate: true });
                    });
                    updateHudBudget(body.data.budget);
                    updateHudPopulation(body.data.population);
                    showMessage(body.message, { withConfirm: false, autoHide: true });
                    clearAreaSelection();
                } else {
                    showMessage(body.message || 'Could not build the road.', { withConfirm: false, autoHide: true });
                }
            })
            .catch(function () {
                showMessage('Network error. Please try again.', { withConfirm: false, autoHide: true });
            })
            .finally(function () {
                setAreaBusy(false);
                if (areaSelection !== null) {
                    renderAreaPanel();
                }
            });
    }

    function runAreaRemove(tiles) {
        setAreaBusy(true);
        showMessage('Clearing area…', { withConfirm: false, autoHide: false });

        window.apiFetch('api/area-remove.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tiles: tiles }),
        })
            .then(function (response) { return response.json(); })
            .then(function (body) {
                if (body.status === 'success') {
                    (body.data.removed || []).forEach(function (removed) {
                        removePlacedBuildingMesh(removed.tile_x, removed.tile_y);
                    });
                    updateHudBudget(body.data.budget);
                    updateHudPopulation(body.data.population);
                    showMessage(body.message, { withConfirm: false, autoHide: true });
                    clearAreaSelection();
                } else {
                    showMessage(body.message || 'Could not clear this area.', { withConfirm: false, autoHide: true });
                }
            })
            .catch(function () {
                showMessage('Network error. Please try again.', { withConfirm: false, autoHide: true });
            })
            .finally(function () {
                setAreaBusy(false);
                if (areaSelection !== null) {
                    renderAreaPanel();
                }
            });
    }

    function placeBuildingAt(tileX, tileY, buildingType) {
        showMessage('Placing ' + buildingType.name + '…', { withConfirm: false, autoHide: false });

        window.apiFetch('api/place-building.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tile_x: tileX, tile_y: tileY, building_type_id: buildingType.id, rotation: pendingRotation }),
        })
            .then(function (response) { return response.json(); })
            .then(function (body) {
                if (body.status === 'success') {
                    renderPlacedBuilding(body.data.building, { animate: true });
                    updateHudBudget(body.data.budget);
                    updateHudPopulation(body.data.population);
                    hidePreview();
                    hideFootprintHighlight();
                    showMessage(body.data.building.name + ' placed at (' + tileX + ', ' + tileY + ')', { withConfirm: false, autoHide: true });
                } else {
                    showMessage(body.message || 'Could not place building.', { withConfirm: false, autoHide: true });
                }
            })
            .catch(function () {
                showMessage('Network error. Please try again.', { withConfirm: false, autoHide: true });
            });
    }

    function handleTileSelection(tileX, tileY) {
        flashHighlight(tileX, tileY);

        if (!cityDataLoaded) {
            pendingAction = null;
            showMessage('Loading city data…', { withConfirm: false, autoHide: true });
            return;
        }

        if (isTileUnlocked(tileX, tileY)) {
            const existingBuilding = getPlacedBuilding(tileX, tileY);
            if (existingBuilding) {
                pendingAction = {
                    type: 'remove',
                    x: tileX,
                    y: tileY,
                    buildingTypeId: existingBuilding.building_type_id,
                    name: existingBuilding.name,
                };

                // Upgrade is offered only while there is a level left to buy.
                const canUpgrade = existingBuilding.upgradable
                    && existingBuilding.level < MAX_BUILDING_LEVEL
                    && existingBuilding.next_upgrade_cost !== null
                    && existingBuilding.next_upgrade_cost !== undefined;

                pendingUpgrade = canUpgrade ? { x: tileX, y: tileY, name: existingBuilding.name } : null;

                let label = existingBuilding.name
                    + ' · Lvl ' + existingBuilding.level + '/' + MAX_BUILDING_LEVEL
                    + ' — tile (' + tileX + ', ' + tileY + ')';

                if (!canUpgrade && existingBuilding.upgradable) {
                    label += ' · max level';
                }

                showMessage(label, {
                    withConfirm: true,
                    autoHide: false,
                    confirmLabel: 'Remove',
                    upgradeLabel: canUpgrade
                        ? 'Upgrade to Lvl ' + (existingBuilding.level + 1) + ' — ' + formatCurrency(existingBuilding.next_upgrade_cost)
                        : null,
                });
                return;
            }

            pendingAction = null;

            if (!selectedBuildingType) {
                showMessage('Select a building from the menu first', { withConfirm: false, autoHide: true });
                return;
            }

            placeBuildingAt(tileX, tileY, selectedBuildingType);
            return;
        }

        if (isAdjacentToUnlocked(tileX, tileY)) {
            pendingAction = { type: 'unlock', x: tileX, y: tileY };
            showMessage('Unlock this land — ' + formatCurrency(tileUnlockCost), { withConfirm: true, autoHide: false, confirmLabel: 'Unlock' });
            return;
        }

        pendingAction = null;
        showMessage('Unlock nearby land first', { withConfirm: false, autoHide: true });
    }

    function handleUnlockConfirm(action) {
        const originalLabel = tileConfirmBtn.textContent;
        tileConfirmBtn.disabled = true;
        tileConfirmBtn.textContent = 'Unlocking…';

        window.apiFetch('api/land-unlock.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tile_x: action.x, tile_y: action.y }),
        })
            .then(function (response) { return response.json(); })
            .then(function (body) {
                if (body.status === 'success') {
                    markTileUnlocked(action.x, action.y, { animate: true });
                    updateHudBudget(body.data.budget);
                    showMessage('Tile (' + action.x + ', ' + action.y + ') — ready to build', { withConfirm: false, autoHide: true });
                } else {
                    showMessage(body.message || 'Unlock failed.', { withConfirm: false, autoHide: true });
                }
            })
            .catch(function () {
                showMessage('Network error. Please try again.', { withConfirm: false, autoHide: true });
            })
            .finally(function () {
                if (pendingAction === action) {
                    pendingAction = null;
                }
                tileConfirmBtn.disabled = false;
                tileConfirmBtn.textContent = originalLabel;
                tileConfirmBtn.classList.remove('tile-info-confirm-danger');
            });
    }

    function handleRemoveConfirm(action) {
        const originalLabel = tileConfirmBtn.textContent;
        tileConfirmBtn.disabled = true;
        tileConfirmBtn.textContent = 'Removing…';

        window.apiFetch('api/remove-building.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tile_x: action.x, tile_y: action.y }),
        })
            .then(function (response) { return response.json(); })
            .then(function (body) {
                if (body.status === 'success') {
                    const removed = body.data.removed;
                    removePlacedBuildingMesh(removed.tile_x, removed.tile_y);
                    updateHudBudget(body.data.budget);
                    updateHudPopulation(body.data.population);
                    showMessage(removed.name + ' removed — refunded to budget', { withConfirm: false, autoHide: true });
                    if (typeof window.__smartCitySelectBuildingType === 'function') {
                        window.__smartCitySelectBuildingType(removed.building_type_id);
                    }
                } else {
                    showMessage(body.message || 'Could not remove building.', { withConfirm: false, autoHide: true });
                }
            })
            .catch(function () {
                showMessage('Network error. Please try again.', { withConfirm: false, autoHide: true });
            })
            .finally(function () {
                if (pendingAction === action) {
                    pendingAction = null;
                }
                tileConfirmBtn.disabled = false;
                tileConfirmBtn.textContent = originalLabel;
                tileConfirmBtn.classList.remove('tile-info-confirm-danger');
            });
    }

    function handleUpgradeConfirm(action) {
        const originalLabel = tileUpgradeBtn.textContent;
        tileUpgradeBtn.disabled = true;
        tileUpgradeBtn.textContent = 'Upgrading…';

        window.apiFetch('api/upgrade-building.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tile_x: action.x, tile_y: action.y }),
        })
            .then(function (response) { return response.json(); })
            .then(function (body) {
                if (body.status === 'success') {
                    const upgraded = body.data.building;
                    reRenderPlacedBuildingAtLevel(
                        upgraded.tile_x,
                        upgraded.tile_y,
                        upgraded.level,
                        body.data.next_upgrade_cost
                    );
                    updateHudBudget(body.data.budget);
                    updateHudPopulation(body.data.population);
                    showMessage(body.message, { withConfirm: false, autoHide: true });
                } else {
                    showMessage(body.message || 'Could not upgrade this building.', { withConfirm: false, autoHide: true });
                }
            })
            .catch(function () {
                showMessage('Network error. Please try again.', { withConfirm: false, autoHide: true });
            })
            .finally(function () {
                if (pendingUpgrade === action) {
                    pendingUpgrade = null;
                }
                tileUpgradeBtn.disabled = false;
                tileUpgradeBtn.textContent = originalLabel;
            });
    }

    if (tileConfirmBtn) {
        tileConfirmBtn.addEventListener('click', function () {
            if (!pendingAction) {
                return;
            }

            if (pendingAction.type === 'unlock') {
                handleUnlockConfirm(pendingAction);
            } else if (pendingAction.type === 'remove') {
                handleRemoveConfirm(pendingAction);
            }
        });
    }

    if (tileUpgradeBtn) {
        tileUpgradeBtn.addEventListener('click', function () {
            if (pendingUpgrade) {
                handleUpgradeConfirm(pendingUpgrade);
            }
        });
    }

    function applyCityState(state) {
        if (!state) {
            return;
        }
        cityDataLoaded = true;
        tileUnlockCost = Number(state.tileUnlockCost) || 0;
        (state.unlockedTiles || []).forEach(function (tile) {
            markTileUnlocked(tile.x, tile.y);
        });
        (state.placedBuildings || []).forEach(function (building) {
            renderPlacedBuilding(building);
        });
    }

    if (window.__smartCity) {
        applyCityState(window.__smartCity);
    }
    document.addEventListener('city:loaded', function (event) {
        applyCityState(event.detail);
    });

    // ---- Raycasting / click handling ----

    const raycaster = new THREE.Raycaster();
    const pointerNDC = new THREE.Vector2();
    let pointerDownPos = null;
    let lastHoverTile = null;

    function updateHoverVisuals(tileX, tileY) {
        lastHoverTile = { x: tileX, y: tileY };

        if (selectedBuildingType && cityDataLoaded) {
            hideHoverOutline();
            const tileWidth = Number(selectedBuildingType.tile_width) || 1;
            const tileHeight = Number(selectedBuildingType.tile_height) || 1;
            const valid = showFootprintHighlight(tileX, tileY, tileWidth, tileHeight, pendingRotation);
            if (valid) {
                showPreviewAt(tileX, tileY);
            } else {
                hidePreview();
            }
        } else {
            hideFootprintHighlight();
            hidePreview();
            updateHoverOutline(tileX, tileY);
        }
    }

    function clearHoverVisuals() {
        lastHoverTile = null;
        hideHoverOutline();
        hidePreview();
        hideFootprintHighlight();
    }

    function handleTileClick(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(pointerNDC, camera);
        const hits = raycaster.intersectObject(ground);

        if (hits.length === 0) {
            return;
        }

        const point = hits[0].point;
        const tileX = Math.floor(point.x + GRID_SIZE / 2);
        const tileY = Math.floor(point.z + GRID_SIZE / 2);

        if (tileX < 0 || tileX >= GRID_SIZE || tileY < 0 || tileY >= GRID_SIZE) {
            return;
        }

        handleTileSelection(tileX, tileY);
    }

    // Shift + drag paints a rectangular selection instead of orbiting the camera.
    let areaDragStart = null;
    let areaDragCurrent = null;

    /**
     * Tile under the pointer, or null when the pointer is off the grid.
     * Falls back to the nearest in-bounds tile while an area drag is running so
     * dragging past the edge clamps instead of freezing the selection.
     */
    function tileUnderPointer(event, clampToGrid) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(pointerNDC, camera);
        const hits = raycaster.intersectObject(ground);

        if (hits.length === 0) {
            return null;
        }

        const point = hits[0].point;
        let tileX = Math.floor(point.x + GRID_SIZE / 2);
        let tileY = Math.floor(point.z + GRID_SIZE / 2);

        if (clampToGrid) {
            tileX = Math.min(Math.max(tileX, 0), GRID_SIZE - 1);
            tileY = Math.min(Math.max(tileY, 0), GRID_SIZE - 1);
        } else if (tileX < 0 || tileX >= GRID_SIZE || tileY < 0 || tileY >= GRID_SIZE) {
            return null;
        }

        return { x: tileX, y: tileY };
    }

    renderer.domElement.addEventListener('pointerdown', function (event) {
        if (event.shiftKey && event.button === 0) {
            const tile = tileUnderPointer(event, true);
            if (tile !== null) {
                areaDragStart = tile;
                areaDragCurrent = tile;
                // Stop OrbitControls stealing the drag.
                controls.enabled = false;
                clearHoverVisuals();
                setGridEmphasis(true);
                showAreaOverlay(areaRectFromTiles(areaDragStart, areaDragCurrent));
                return;
            }
        }

        pointerDownPos = { x: event.clientX, y: event.clientY };
    });

    renderer.domElement.addEventListener('pointerup', function (event) {
        if (areaDragStart !== null) {
            const rect = areaRectFromTiles(areaDragStart, areaDragCurrent || areaDragStart);
            areaDragStart = null;
            areaDragCurrent = null;
            controls.enabled = true;

            areaSelection = { tiles: tilesInRect(rect), rect: rect };
            showAreaOverlay(rect);
            renderAreaPanel();
            return;
        }

        if (!pointerDownPos) {
            return;
        }

        const dx = event.clientX - pointerDownPos.x;
        const dy = event.clientY - pointerDownPos.y;
        const dragDistance = Math.sqrt(dx * dx + dy * dy);
        pointerDownPos = null;

        if (dragDistance < CLICK_DRAG_THRESHOLD) {
            // A plain click anywhere dismisses a standing selection.
            if (areaSelection !== null) {
                clearAreaSelection();
                return;
            }
            handleTileClick(event);
        }
    });

    renderer.domElement.addEventListener('pointermove', function (event) {
        if (areaDragStart !== null) {
            const tile = tileUnderPointer(event, true);
            if (tile !== null) {
                areaDragCurrent = tile;
                showAreaOverlay(areaRectFromTiles(areaDragStart, areaDragCurrent));
            }
            return;
        }

        const tile = tileUnderPointer(event, false);

        if (tile === null) {
            clearHoverVisuals();
            return;
        }

        updateHoverVisuals(tile.x, tile.y);
    });

    renderer.domElement.addEventListener('pointerleave', function () {
        clearHoverVisuals();
    });

    // Releasing shift mid-drag, or losing the pointer, must not strand the camera.
    window.addEventListener('pointercancel', function () {
        if (areaDragStart !== null) {
            areaDragStart = null;
            areaDragCurrent = null;
            controls.enabled = true;
            hideAreaOverlay();
            setGridEmphasis(selectedBuildingType !== null);
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && areaSelection !== null) {
            clearAreaSelection();
        }
    });

    // ---- Resize handling ----

    const resizeObserver = new ResizeObserver(function () {
        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight;

        if (newWidth === 0 || newHeight === 0) {
            return;
        }

        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(newWidth, newHeight);
    });
    resizeObserver.observe(container);

    // ---- Render loop ----

    function animate(time) {
        requestAnimationFrame(animate);
        controls.update();

        if (highlightFadeStart !== null) {
            const elapsed = time - highlightFadeStart;

            if (elapsed > HIGHLIGHT_HOLD_MS) {
                const fadeElapsed = elapsed - HIGHLIGHT_HOLD_MS;
                const t = Math.min(fadeElapsed / HIGHLIGHT_FADE_MS, 1);
                highlightMaterial.opacity = HIGHLIGHT_OPACITY * (1 - t);

                if (t >= 1) {
                    highlight.visible = false;
                    highlightFadeStart = null;
                }
            }
        }

        // Ease the grid toward its target so it never pops between states.
        const gridDelta = gridOpacityTarget - grid.material.opacity;
        if (Math.abs(gridDelta) > 0.002) {
            grid.material.opacity += gridDelta * 0.15;
        } else {
            grid.material.opacity = gridOpacityTarget;
        }

        renderer.render(scene, camera);
    }

    requestAnimationFrame(animate);
}
