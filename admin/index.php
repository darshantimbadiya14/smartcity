<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/admin.php';
require_once __DIR__ . '/../includes/admin-layout.php';

$pdo = getDbConnection();
$adminUser = require_admin($pdo);

$totalUsers = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
$totalAdmins = (int) $pdo->query('SELECT COUNT(*) FROM users WHERE is_admin = 1')->fetchColumn();
$totalCities = (int) $pdo->query('SELECT COUNT(*) FROM cities')->fetchColumn();
$totalBuildings = (int) $pdo->query('SELECT COUNT(*) FROM placed_buildings')->fetchColumn();
$totalTiles = (int) $pdo->query('SELECT COUNT(*) FROM city_tiles')->fetchColumn();
$totalPopulation = (int) $pdo->query('SELECT COALESCE(SUM(population), 0) FROM cities')->fetchColumn();
$totalBudget = (float) $pdo->query('SELECT COALESCE(SUM(budget), 0) FROM cities')->fetchColumn();
$avgScore = (float) $pdo->query('SELECT COALESCE(AVG(score), 0) FROM cities')->fetchColumn();

$topCities = $pdo->query(
    'SELECT c.id, c.name, c.score, c.population, c.happiness, c.budget, u.id AS user_id, u.name AS owner_name
     FROM cities c
     INNER JOIN users u ON u.id = c.user_id
     ORDER BY c.score DESC, c.id ASC
     LIMIT 10'
)->fetchAll();

$recentUsers = $pdo->query(
    'SELECT id, name, email, is_admin, created_at
     FROM users
     ORDER BY created_at DESC, id DESC
     LIMIT 8'
)->fetchAll();

$categoryRows = $pdo->query(
    'SELECT bt.category, COUNT(*) AS total
     FROM placed_buildings pb
     INNER JOIN building_types bt ON bt.id = pb.building_type_id
     GROUP BY bt.category
     ORDER BY total DESC'
)->fetchAll();

$categoryMax = 0;
foreach ($categoryRows as $row) {
    $categoryMax = max($categoryMax, (int) $row['total']);
}

$popularBuildings = $pdo->query(
    'SELECT bt.name, bt.category, COUNT(*) AS total
     FROM placed_buildings pb
     INNER JOIN building_types bt ON bt.id = pb.building_type_id
     GROUP BY bt.id, bt.name, bt.category
     ORDER BY total DESC
     LIMIT 8'
)->fetchAll();

$popularMax = 0;
foreach ($popularBuildings as $row) {
    $popularMax = max($popularMax, (int) $row['total']);
}

admin_layout_start('Dashboard', 'dashboard', $adminUser);

?>

<div class="admin-stat-grid">
    <div class="admin-stat-card">
        <span class="admin-stat-label">👥 Players</span>
        <div class="admin-stat-value"><?= number_format($totalUsers) ?></div>
        <p class="admin-stat-sub"><?= number_format($totalAdmins) ?> admin<?= $totalAdmins === 1 ? '' : 's' ?></p>
    </div>
    <div class="admin-stat-card">
        <span class="admin-stat-label">🏙️ Cities</span>
        <div class="admin-stat-value"><?= number_format($totalCities) ?></div>
        <p class="admin-stat-sub"><?= number_format($totalTiles) ?> tiles owned</p>
    </div>
    <div class="admin-stat-card">
        <span class="admin-stat-label">🏗️ Structures</span>
        <div class="admin-stat-value"><?= number_format($totalBuildings) ?></div>
        <p class="admin-stat-sub">across all cities</p>
    </div>
    <div class="admin-stat-card">
        <span class="admin-stat-label">🧍 Population</span>
        <div class="admin-stat-value"><?= number_format($totalPopulation) ?></div>
        <p class="admin-stat-sub">citizens housed</p>
    </div>
    <div class="admin-stat-card">
        <span class="admin-stat-label">💰 Total Budget</span>
        <div class="admin-stat-value is-money"><?= admin_money($totalBudget) ?></div>
        <p class="admin-stat-sub">held by all players</p>
    </div>
    <div class="admin-stat-card">
        <span class="admin-stat-label">⭐ Average Score</span>
        <div class="admin-stat-value"><?= number_format($avgScore, 1) ?></div>
        <p class="admin-stat-sub">out of 1000</p>
    </div>
</div>

<div class="admin-panel">
    <div class="admin-panel-head">
        <div>
            <h2 class="admin-panel-title">Top Cities</h2>
            <p class="admin-panel-sub">Ranked by score — the same order players see on the leaderboard.</p>
        </div>
        <div class="admin-panel-actions">
            <a class="admin-btn admin-btn-ghost admin-btn-sm" href="cities.php">View all cities</a>
        </div>
    </div>
    <?php if ($topCities === []): ?>
        <p class="admin-table-empty">No cities have been created yet.</p>
    <?php else: ?>
        <div class="admin-table-wrap">
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>City</th>
                        <th>Owner</th>
                        <th class="is-num">Score</th>
                        <th class="is-num">Population</th>
                        <th class="is-num">Happiness</th>
                        <th class="is-num">Budget</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($topCities as $index => $city): ?>
                    <tr>
                        <td class="admin-cell-muted"><?= $index + 1 ?></td>
                        <td class="admin-cell-strong"><?= admin_e($city['name']) ?></td>
                        <td><?= admin_e($city['owner_name']) ?></td>
                        <td class="is-num admin-cell-strong"><?= number_format((int) $city['score']) ?></td>
                        <td class="is-num"><?= number_format((int) $city['population']) ?></td>
                        <td class="is-num"><?= (int) $city['happiness'] ?></td>
                        <td class="is-num"><?= admin_money((float) $city['budget']) ?></td>
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

<div class="admin-columns">
    <div class="admin-panel">
        <div class="admin-panel-head">
            <div>
                <h2 class="admin-panel-title">Structures by Category</h2>
                <p class="admin-panel-sub">What players are actually building.</p>
            </div>
        </div>
        <div class="admin-panel-body">
            <?php if ($categoryRows === []): ?>
                <p class="admin-cell-muted">Nothing has been built yet.</p>
            <?php else: ?>
                <div class="admin-bars">
                    <?php foreach ($categoryRows as $row): ?>
                        <?php $pct = $categoryMax > 0 ? ((int) $row['total'] / $categoryMax) * 100 : 0; ?>
                        <div class="admin-bar-row">
                            <span class="admin-badge admin-badge-<?= admin_e($row['category']) ?>"><?= admin_e(ucfirst($row['category'])) ?></span>
                            <span class="admin-bar-track">
                                <span class="admin-bar-fill" style="width: <?= number_format($pct, 2) ?>%"></span>
                            </span>
                            <span class="admin-bar-count"><?= number_format((int) $row['total']) ?></span>
                        </div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>
    </div>

    <div class="admin-panel">
        <div class="admin-panel-head">
            <div>
                <h2 class="admin-panel-title">Most Placed Structures</h2>
                <p class="admin-panel-sub">Top building types across every city.</p>
            </div>
        </div>
        <div class="admin-panel-body">
            <?php if ($popularBuildings === []): ?>
                <p class="admin-cell-muted">Nothing has been built yet.</p>
            <?php else: ?>
                <div class="admin-bars">
                    <?php foreach ($popularBuildings as $row): ?>
                        <?php $pct = $popularMax > 0 ? ((int) $row['total'] / $popularMax) * 100 : 0; ?>
                        <div class="admin-bar-row">
                            <span><?= admin_e($row['name']) ?></span>
                            <span class="admin-bar-track">
                                <span class="admin-bar-fill" style="width: <?= number_format($pct, 2) ?>%"></span>
                            </span>
                            <span class="admin-bar-count"><?= number_format((int) $row['total']) ?></span>
                        </div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>
    </div>
</div>

<div class="admin-panel">
    <div class="admin-panel-head">
        <div>
            <h2 class="admin-panel-title">Newest Players</h2>
            <p class="admin-panel-sub">Most recent sign-ups.</p>
        </div>
        <div class="admin-panel-actions">
            <a class="admin-btn admin-btn-ghost admin-btn-sm" href="users.php">Manage users</a>
        </div>
    </div>
    <?php if ($recentUsers === []): ?>
        <p class="admin-table-empty">No users registered yet.</p>
    <?php else: ?>
        <div class="admin-table-wrap">
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Registered</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($recentUsers as $user): ?>
                    <tr>
                        <td class="admin-cell-muted"><?= (int) $user['id'] ?></td>
                        <td class="admin-cell-strong"><?= admin_e($user['name']) ?></td>
                        <td class="admin-cell-muted"><?= admin_e($user['email']) ?></td>
                        <td>
                            <?php if ((int) $user['is_admin'] === 1): ?>
                                <span class="admin-badge admin-badge-admin">Admin</span>
                            <?php else: ?>
                                <span class="admin-badge">Player</span>
                            <?php endif; ?>
                        </td>
                        <td class="admin-cell-muted"><?= admin_e((string) $user['created_at']) ?></td>
                        <td class="is-num">
                            <a class="admin-btn admin-btn-ghost admin-btn-sm" href="user.php?id=<?= (int) $user['id'] ?>">View</a>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    <?php endif; ?>
</div>

<?php admin_layout_end(); ?>
