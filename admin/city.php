<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/admin.php';
require_once __DIR__ . '/../includes/admin-layout.php';
require_once __DIR__ . '/../includes/levels.php';

/**
 * Tiles covered by a building anchored at (anchorX, anchorY). Mirrors the same
 * helper in api/place-building.php so the admin map matches what the game draws.
 */
function admin_footprint_tiles(int $anchorX, int $anchorY, int $tileWidth, int $tileHeight, int $rotation): array
{
    $swap = ($rotation === 90 || $rotation === 270);
    $effectiveWidth = $swap ? $tileHeight : $tileWidth;
    $effectiveHeight = $swap ? $tileWidth : $tileHeight;

    $tiles = [];
    for ($dx = 0; $dx < $effectiveWidth; $dx++) {
        for ($dy = 0; $dy < $effectiveHeight; $dy++) {
            $tiles[] = [$anchorX + $dx, $anchorY + $dy];
        }
    }

    return $tiles;
}

$pdo = getDbConnection();
$adminUser = require_admin($pdo);

$cityId = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT);

if ($cityId === false || $cityId === null) {
    admin_flash('Invalid city id.', 'error');
    header('Location: cities.php');
    exit;
}

$stmt = $pdo->prepare(
    'SELECT c.id, c.name, c.budget, c.population, c.happiness, c.score, c.created_at, c.last_ticked_at,
            u.id AS user_id, u.name AS owner_name, u.email AS owner_email
     FROM cities c
     INNER JOIN users u ON u.id = c.user_id
     WHERE c.id = :id LIMIT 1'
);
$stmt->execute(['id' => $cityId]);
$city = $stmt->fetch();

if ($city === false) {
    admin_flash('That city does not exist.', 'error');
    header('Location: cities.php');
    exit;
}

$gridSizeStmt = $pdo->prepare('SELECT config_value FROM game_config WHERE config_key = :k');
$gridSizeStmt->execute(['k' => 'grid_size']);
$gridSize = (int) ($gridSizeStmt->fetchColumn() ?: 20);

$tilesStmt = $pdo->prepare('SELECT tile_x, tile_y FROM city_tiles WHERE city_id = :city_id');
$tilesStmt->execute(['city_id' => $cityId]);
$unlocked = [];
foreach ($tilesStmt->fetchAll() as $tile) {
    $unlocked[$tile['tile_x'] . ',' . $tile['tile_y']] = true;
}

$buildingsStmt = $pdo->prepare(
    'SELECT pb.tile_x, pb.tile_y, pb.rotation, bt.name, bt.category, bt.tile_width, bt.tile_height
     FROM placed_buildings pb
     INNER JOIN building_types bt ON bt.id = pb.building_type_id
     WHERE pb.city_id = :city_id'
);
$buildingsStmt->execute(['city_id' => $cityId]);
$placed = $buildingsStmt->fetchAll();

$occupied = [];
foreach ($placed as $building) {
    $footprint = admin_footprint_tiles(
        (int) $building['tile_x'],
        (int) $building['tile_y'],
        (int) $building['tile_width'],
        (int) $building['tile_height'],
        (int) $building['rotation']
    );
    foreach ($footprint as [$fx, $fy]) {
        $occupied[$fx . ',' . $fy] = ['category' => $building['category'], 'name' => $building['name']];
    }
}

// Grouped by type *and* level, because level scales every economic figure.
$breakdownStmt = $pdo->prepare(
    'SELECT bt.name, bt.category, bt.income, bt.upkeep, bt.capacity, bt.happiness_effect,
            pb.level, COUNT(*) AS total
     FROM placed_buildings pb
     INNER JOIN building_types bt ON bt.id = pb.building_type_id
     WHERE pb.city_id = :city_id
     GROUP BY bt.id, bt.name, bt.category, bt.income, bt.upkeep, bt.capacity, bt.happiness_effect, pb.level
     ORDER BY bt.category ASC, bt.name ASC, pb.level ASC'
);
$breakdownStmt->execute(['city_id' => $cityId]);
$breakdown = $breakdownStmt->fetchAll();

$totalIncome = 0.0;
$totalUpkeep = 0.0;
foreach ($breakdown as $row) {
    $stats = buildingLevelStats($row);
    $totalIncome += $stats['income'] * (int) $row['total'];
    $totalUpkeep += $stats['upkeep'] * (int) $row['total'];
}

$taxRateStmt = $pdo->prepare('SELECT config_value FROM game_config WHERE config_key = :k');
$taxRateStmt->execute(['k' => 'tax_rate']);
$taxRate = (float) ($taxRateStmt->fetchColumn() ?: 0.05);
$taxRevenue = (int) $city['population'] * $taxRate;
$netPerTick = ($totalIncome + $taxRevenue) - $totalUpkeep;

$legend = [
    'road' => 'Roads',
    'residential' => 'Residential',
    'commercial' => 'Commercial',
    'industrial' => 'Industrial',
    'service' => 'Services',
    'other' => 'Other',
];

admin_layout_start('City — ' . $city['name'], 'cities', $adminUser);

?>

<a class="admin-back" href="cities.php">&larr; Back to cities</a>

<div class="admin-panel">
    <div class="admin-panel-head">
        <div>
            <h2 class="admin-panel-title"><?= admin_e($city['name']) ?></h2>
            <p class="admin-panel-sub">
                Owned by <a href="user.php?id=<?= (int) $city['user_id'] ?>"><?= admin_e($city['owner_name']) ?></a>
                (<?= admin_e($city['owner_email']) ?>)
            </p>
        </div>
    </div>
    <div class="admin-panel-body">
        <dl class="admin-dl">
            <div>
                <dt>Budget</dt>
                <dd style="color: var(--money-green);"><?= admin_money((float) $city['budget']) ?></dd>
            </div>
            <div>
                <dt>Population</dt>
                <dd><?= number_format((int) $city['population']) ?></dd>
            </div>
            <div>
                <dt>Happiness</dt>
                <dd><?= (int) $city['happiness'] ?> / 100</dd>
            </div>
            <div>
                <dt>Score</dt>
                <dd><?= number_format((int) $city['score']) ?> / 1000</dd>
            </div>
            <div>
                <dt>Structures</dt>
                <dd><?= number_format(count($placed)) ?></dd>
            </div>
            <div>
                <dt>Land owned</dt>
                <dd><?= number_format(count($unlocked)) ?> tiles</dd>
            </div>
            <div>
                <dt>Net / tick</dt>
                <dd style="color: <?= $netPerTick >= 0 ? 'var(--money-green)' : 'var(--danger)' ?>;">
                    <?= ($netPerTick >= 0 ? '+' : '') . admin_money($netPerTick) ?>
                </dd>
            </div>
            <div>
                <dt>Last tick</dt>
                <dd style="font-size: 0.95rem;"><?= admin_e((string) $city['last_ticked_at']) ?></dd>
            </div>
        </dl>
    </div>
</div>

<div class="admin-panel">
    <div class="admin-panel-head">
        <div>
            <h2 class="admin-panel-title">City Map</h2>
            <p class="admin-panel-sub">
                Top-down view of the <?= $gridSize ?>×<?= $gridSize ?> world. Multi-tile structures fill their whole footprint.
            </p>
        </div>
    </div>
    <div class="admin-panel-body">
        <div class="admin-map" style="grid-template-columns: repeat(<?= $gridSize ?>, 20px);">
            <?php for ($y = 0; $y < $gridSize; $y++): ?>
                <?php for ($x = 0; $x < $gridSize; $x++): ?>
                    <?php
                    $key = $x . ',' . $y;
                    if (isset($occupied[$key])) {
                        $class = 'is-' . $occupied[$key]['category'];
                        $title = $occupied[$key]['name'] . ' — (' . $x . ', ' . $y . ')';
                    } elseif (isset($unlocked[$key])) {
                        $class = 'is-unlocked';
                        $title = 'Empty land — (' . $x . ', ' . $y . ')';
                    } else {
                        $class = 'is-locked';
                        $title = 'Locked — (' . $x . ', ' . $y . ')';
                    }
                    ?>
                    <span class="admin-map-cell <?= $class ?>" title="<?= admin_e($title) ?>"></span>
                <?php endfor; ?>
            <?php endfor; ?>
        </div>

        <div class="admin-map-legend">
            <?php foreach ($legend as $categoryKey => $label): ?>
                <span>
                    <span class="admin-map-swatch admin-map-cell is-<?= admin_e($categoryKey) ?>" style="display:inline-block;width:12px;height:12px;"></span>
                    <?= admin_e($label) ?>
                </span>
            <?php endforeach; ?>
            <span>
                <span class="admin-map-swatch admin-map-cell is-unlocked" style="display:inline-block;width:12px;height:12px;"></span>
                Empty land
            </span>
            <span>
                <span class="admin-map-swatch admin-map-cell is-locked" style="display:inline-block;width:12px;height:12px;"></span>
                Locked
            </span>
        </div>
    </div>
</div>

<div class="admin-panel">
    <div class="admin-panel-head">
        <div>
            <h2 class="admin-panel-title">Structure Breakdown</h2>
            <p class="admin-panel-sub">
                Gross income <?= admin_money($totalIncome) ?> · upkeep <?= admin_money($totalUpkeep) ?> ·
                tax <?= admin_money($taxRevenue) ?> per tick.
            </p>
        </div>
    </div>
    <?php if ($breakdown === []): ?>
        <p class="admin-table-empty">This city has no structures yet.</p>
    <?php else: ?>
        <div class="admin-table-wrap">
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>Building</th>
                        <th>Category</th>
                        <th class="is-num">Level</th>
                        <th class="is-num">Count</th>
                        <th class="is-num">Income</th>
                        <th class="is-num">Upkeep</th>
                        <th class="is-num">Capacity</th>
                        <th class="is-num">Happiness</th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($breakdown as $row): ?>
                    <?php
                    $count = (int) $row['total'];
                    $stats = buildingLevelStats($row);
                    $happinessTotal = $stats['happiness_effect'] * $count;
                    ?>
                    <tr>
                        <td class="admin-cell-strong"><?= admin_e($row['name']) ?></td>
                        <td><span class="admin-badge admin-badge-<?= admin_e($row['category']) ?>"><?= admin_e(ucfirst($row['category'])) ?></span></td>
                        <td class="is-num">
                            <?php if (isUpgradableCategory((string) $row['category'])): ?>
                                <span class="admin-badge<?= $stats['level'] >= MAX_BUILDING_LEVEL ? ' admin-badge-admin' : '' ?>">
                                    L<?= $stats['level'] ?>
                                </span>
                            <?php else: ?>
                                <span class="admin-cell-muted">—</span>
                            <?php endif; ?>
                        </td>
                        <td class="is-num"><?= number_format($count) ?></td>
                        <td class="is-num"><?= admin_money($stats['income'] * $count) ?></td>
                        <td class="is-num"><?= admin_money($stats['upkeep'] * $count) ?></td>
                        <td class="is-num"><?= number_format($stats['capacity'] * $count) ?></td>
                        <td class="is-num"><?= $happinessTotal > 0 ? '+' : '' ?><?= $happinessTotal ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    <?php endif; ?>
</div>

<?php admin_layout_end(); ?>
