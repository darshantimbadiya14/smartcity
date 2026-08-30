<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/admin.php';
require_once __DIR__ . '/../includes/admin-layout.php';

$pdo = getDbConnection();
$adminUser = require_admin($pdo);

$sortOptions = [
    'score' => 'c.score DESC, c.id ASC',
    'population' => 'c.population DESC, c.id ASC',
    'budget' => 'c.budget DESC, c.id ASC',
    'buildings' => 'building_count DESC, c.id ASC',
    'newest' => 'c.created_at DESC, c.id DESC',
];

$sort = is_string($_GET['sort'] ?? null) && isset($sortOptions[$_GET['sort']]) ? $_GET['sort'] : 'score';

$cities = $pdo->query(
    'SELECT c.id, c.name, c.budget, c.population, c.happiness, c.score, c.created_at,
            u.id AS user_id, u.name AS owner_name, u.email AS owner_email,
            (SELECT COUNT(*) FROM placed_buildings pb WHERE pb.city_id = c.id) AS building_count,
            (SELECT COUNT(*) FROM city_tiles ct WHERE ct.city_id = c.id) AS tile_count
     FROM cities c
     INNER JOIN users u ON u.id = c.user_id
     ORDER BY ' . $sortOptions[$sort]
)->fetchAll();

admin_layout_start('Cities', 'cities', $adminUser);

?>

<div class="admin-panel">
    <div class="admin-panel-head">
        <div>
            <h2 class="admin-panel-title">All Cities</h2>
            <p class="admin-panel-sub"><?= count($cities) ?> cit<?= count($cities) === 1 ? 'y' : 'ies' ?> in the world.</p>
        </div>
        <div class="admin-panel-actions">
            <form class="admin-search-form" method="get" action="cities.php">
                <label for="sort-select" class="admin-field-hint">Sort by</label>
                <select id="sort-select" name="sort" onchange="this.form.submit()"
                        style="font-family: inherit; font-size: 0.88rem; padding: 8px 12px; border-radius: var(--radius-sm); border: 2px solid var(--bg); background: var(--bg); color: var(--text);">
                    <option value="score" <?= $sort === 'score' ? 'selected' : '' ?>>Score</option>
                    <option value="population" <?= $sort === 'population' ? 'selected' : '' ?>>Population</option>
                    <option value="budget" <?= $sort === 'budget' ? 'selected' : '' ?>>Budget</option>
                    <option value="buildings" <?= $sort === 'buildings' ? 'selected' : '' ?>>Structures</option>
                    <option value="newest" <?= $sort === 'newest' ? 'selected' : '' ?>>Newest</option>
                </select>
                <noscript><button type="submit" class="admin-btn admin-btn-primary admin-btn-sm">Apply</button></noscript>
            </form>
        </div>
    </div>

    <?php if ($cities === []): ?>
        <p class="admin-table-empty">No cities have been created yet.</p>
    <?php else: ?>
        <div class="admin-table-wrap">
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>City</th>
                        <th>Owner</th>
                        <th class="is-num">Score</th>
                        <th class="is-num">Population</th>
                        <th class="is-num">Happiness</th>
                        <th class="is-num">Budget</th>
                        <th class="is-num">Structures</th>
                        <th class="is-num">Tiles</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($cities as $city): ?>
                    <tr>
                        <td class="admin-cell-muted"><?= (int) $city['id'] ?></td>
                        <td class="admin-cell-strong"><?= admin_e($city['name']) ?></td>
                        <td>
                            <a href="user.php?id=<?= (int) $city['user_id'] ?>"><?= admin_e($city['owner_name']) ?></a>
                        </td>
                        <td class="is-num admin-cell-strong"><?= number_format((int) $city['score']) ?></td>
                        <td class="is-num"><?= number_format((int) $city['population']) ?></td>
                        <td class="is-num"><?= (int) $city['happiness'] ?></td>
                        <td class="is-num"><?= admin_money((float) $city['budget']) ?></td>
                        <td class="is-num"><?= number_format((int) $city['building_count']) ?></td>
                        <td class="is-num"><?= number_format((int) $city['tile_count']) ?></td>
                        <td class="is-num">
                            <a class="admin-btn admin-btn-ghost admin-btn-sm" href="city.php?id=<?= (int) $city['id'] ?>">Inspect</a>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    <?php endif; ?>
</div>

<?php admin_layout_end(); ?>
