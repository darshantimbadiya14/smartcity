import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const GRID_SIZE = 20;
const GRASS_COLOR = 0x7fbf72;
const UNLOCKED_COLOR = 0xdfe9a6;
const GRID_LINE_COLOR = 0x4f8f5c;
const HIGHLIGHT_COLOR = 0xff9f43;
const HIGHLIGHT_OPACITY = 0.85;
const HIGHLIGHT_HOLD_MS = 400;
const HIGHLIGHT_FADE_MS = 600;
const CLICK_DRAG_THRESHOLD = 5;
const CAMERA_POLAR_DEG = 50;
const CAMERA_AZIMUTH_DEG = 45;
const CAMERA_DISTANCE = 22;
const TREE_CHANCE = 0.35;
const TREE_TRUNK_COLOR = 0x8a5a3c;
const TREE_FOLIAGE_COLOR = 0x3f8f4f;
const DEFAULT_MESSAGE = 'Click a tile to inspect it.';
const MESSAGE_AUTO_HIDE_MS = 2500;

const GROUND_Y = 0;
const UNLOCKED_TILE_Y = 0.015;
const GRID_LINES_Y = 0.02;
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

function seededRandom(x, y, salt) {
    let seed = (x * 374761393 + y * 668265263 + (salt || 0) * 2147483647) | 0;
    seed = (seed ^ (seed >>> 13)) * 1274126177;
    seed = seed ^ (seed >>> 16);
    return ((seed >>> 0) % 100000) / 100000;
}

function formatCurrency(amount) {
    return '₹' + Math.round(Number(amount)).toLocaleString('en-IN');
}

export function init() {
    if (started) {
        return;
    }
    started = true;

    const container = document.getElementById('game-canvas');
    const tileMessageEl = document.getElementById('tile-info-message');
    const tileConfirmBtn = document.getElementById('tile-info-confirm');

    if (!container) {
        console.error('three-scene: #game-canvas container not found.');
        return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeaf6ff);

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
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableRotate = false;
    controls.minPolarAngle = polarAngle;
    controls.maxPolarAngle = polarAngle;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = true;
    controls.minDistance = 8;
    controls.maxDistance = 40;
    controls.enablePan = true;
    controls.screenSpacePanning = false;
    controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = {
        ONE: THREE.TOUCH.PAN,
        TWO: THREE.TOUCH.DOLLY_PAN,
    };
    controls.update();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    scene.add(directionalLight);

    // ---- Ground ----

    const groundGeometry = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: GRASS_COLOR, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    scene.add(ground);

    const grid = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, GRID_LINE_COLOR, GRID_LINE_COLOR);
    grid.position.y = GRID_LINES_Y;
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    scene.add(grid);

    // ---- Unlocked tile overlays ----

    const unlockedTileGeometry = new THREE.PlaneGeometry(1, 1);
    const unlockedTileMaterial = new THREE.MeshStandardMaterial({ color: UNLOCKED_COLOR, roughness: 0.9 });
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
    const trunkGeometry = new THREE.CylinderGeometry(0.05, 0.08, trunkHeight, 6);
    trunkGeometry.translate(0, trunkHeight / 2, 0);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: TREE_TRUNK_COLOR, roughness: 0.9 });
    const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeTileKeys.length);

    const foliageHeight = 0.55;
    const foliageGeometry = new THREE.ConeGeometry(0.28, foliageHeight, 6);
    foliageGeometry.translate(0, trunkHeight + foliageHeight / 2, 0);
    const foliageMaterial = new THREE.MeshStandardMaterial({ color: TREE_FOLIAGE_COLOR, roughness: 0.85 });
    const foliageMesh = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, treeTileKeys.length);

    const treeIndexByTileKey = new Map();
    const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    const dummy = new THREE.Object3D();

    treeTileKeys.forEach(function (tile, index) {
        const key = tileKey(tile.x, tile.y);
        treeIndexByTileKey.set(key, index);

        const center = tileCenterWorld(tile.x, tile.y);
        const jitterX = (seededRandom(tile.x, tile.y, 1) - 0.5) * 0.5;
        const jitterZ = (seededRandom(tile.x, tile.y, 2) - 0.5) * 0.5;
        const scale = 0.8 + seededRandom(tile.x, tile.y, 3) * 0.4;
        const rotationY = seededRandom(tile.x, tile.y, 4) * Math.PI * 2;

        dummy.position.set(center.x + jitterX, 0, center.z + jitterZ);
        dummy.rotation.set(0, rotationY, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();

        trunkMesh.setMatrixAt(index, dummy.matrix);
        foliageMesh.setMatrixAt(index, dummy.matrix);
    });

    trunkMesh.instanceMatrix.needsUpdate = true;
    foliageMesh.instanceMatrix.needsUpdate = true;
    scene.add(trunkMesh);
    scene.add(foliageMesh);

    function markTileUnlocked(tileX, tileY) {
        const key = tileKey(tileX, tileY);
        if (unlockedTileKeys.has(key)) {
            return;
        }
        unlockedTileKeys.add(key);

        const treeIndex = treeIndexByTileKey.get(key);
        if (treeIndex !== undefined) {
            trunkMesh.setMatrixAt(treeIndex, hiddenMatrix);
            foliageMesh.setMatrixAt(treeIndex, hiddenMatrix);
            trunkMesh.instanceMatrix.needsUpdate = true;
            foliageMesh.instanceMatrix.needsUpdate = true;
        }

        const center = tileCenterWorld(tileX, tileY);
        const overlay = new THREE.Mesh(unlockedTileGeometry, unlockedTileMaterial);
        overlay.rotation.x = -Math.PI / 2;
        overlay.position.set(center.x, UNLOCKED_TILE_Y, center.z);
        unlockedGroup.add(overlay);
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

    // ---- Tile info panel + land-unlock flow ----

    let cityDataLoaded = false;
    let tileUnlockCost = null;
    let pendingTile = null;
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
        const hudBudgetEl = document.getElementById('hud-budget');
        if (hudBudgetEl) {
            hudBudgetEl.textContent = formatCurrency(budget);
        }
    }

    function handleTileSelection(tileX, tileY) {
        flashHighlight(tileX, tileY);

        if (!cityDataLoaded) {
            pendingTile = null;
            showMessage('Loading city data…', { withConfirm: false, autoHide: true });
            return;
        }

        if (isTileUnlocked(tileX, tileY)) {
            pendingTile = null;
            showMessage('Tile (' + tileX + ', ' + tileY + ') — ready to build', { withConfirm: false, autoHide: true });
            return;
        }

        if (isAdjacentToUnlocked(tileX, tileY)) {
            pendingTile = { x: tileX, y: tileY };
            showMessage('Unlock this land — ' + formatCurrency(tileUnlockCost), { withConfirm: true, autoHide: false });
            return;
        }

        pendingTile = null;
        showMessage('Unlock nearby land first', { withConfirm: false, autoHide: true });
    }

    if (tileConfirmBtn) {
        tileConfirmBtn.addEventListener('click', function () {
            if (!pendingTile) {
                return;
            }

            const tile = pendingTile;
            const originalLabel = tileConfirmBtn.textContent;
            tileConfirmBtn.disabled = true;
            tileConfirmBtn.textContent = 'Unlocking…';

            fetch('api/land-unlock.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tile_x: tile.x, tile_y: tile.y }),
            })
                .then(function (response) { return response.json(); })
                .then(function (body) {
                    if (body.status === 'success') {
                        markTileUnlocked(tile.x, tile.y);
                        updateHudBudget(body.data.budget);
                        showMessage('Tile (' + tile.x + ', ' + tile.y + ') — ready to build', { withConfirm: false, autoHide: true });
                    } else {
                        showMessage(body.message || 'Unlock failed.', { withConfirm: false, autoHide: true });
                    }
                })
                .catch(function () {
                    showMessage('Network error. Please try again.', { withConfirm: false, autoHide: true });
                })
                .finally(function () {
                    if (pendingTile === tile) {
                        pendingTile = null;
                    }
                    tileConfirmBtn.disabled = false;
                    tileConfirmBtn.textContent = originalLabel;
                });
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

    renderer.domElement.addEventListener('pointerdown', function (event) {
        pointerDownPos = { x: event.clientX, y: event.clientY };
    });

    renderer.domElement.addEventListener('pointerup', function (event) {
        if (!pointerDownPos) {
            return;
        }

        const dx = event.clientX - pointerDownPos.x;
        const dy = event.clientY - pointerDownPos.y;
        const dragDistance = Math.sqrt(dx * dx + dy * dy);
        pointerDownPos = null;

        if (dragDistance < CLICK_DRAG_THRESHOLD) {
            handleTileClick(event);
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

        renderer.render(scene, camera);
    }

    requestAnimationFrame(animate);
}
