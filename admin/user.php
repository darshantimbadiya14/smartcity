<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/admin.php';
require_once __DIR__ . '/../includes/admin-layout.php';

$pdo = getDbConnection();
$adminUser = require_admin($pdo);

$userId = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT);

if ($userId === false || $userId === null) {
    admin_flash('Invalid user id.', 'error');
    header('Location: users.php');
    exit;
}

$stmt = $pdo->prepare('SELECT id, name, email, is_admin, created_at FROM users WHERE id = :id LIMIT 1');
$stmt->execute(['id' => $userId]);
$user = $stmt->fetch();

if ($user === false) {
    admin_flash('That user does not exist.', 'error');
    header('Location: users.php');
    exit;
}

$cityStmt = $pdo->prepare(
    'SELECT id, name, budget, population, happiness, score, created_at, last_ticked_at
     FROM cities WHERE user_id = :user_id LIMIT 1'
);
$cityStmt->execute(['user_id' => $userId]);
$city = $cityStmt->fetch();

$buildings = [];
$tileCount = 0;

if ($city !== false) {
    $bStmt = $pdo->prepare(
        'SELECT bt.name, bt.category, bt.income, bt.upkeep, COUNT(*) AS total
         FROM placed_buildings pb
         INNER JOIN building_types bt ON bt.id = pb.building_type_id
         WHERE pb.city_id = :city_id
         GROUP BY bt.id, bt.name, bt.category, bt.income, bt.upkeep
         ORDER BY total DESC, bt.name ASC'
    );
    $bStmt->execute(['city_id' => (int) $city['id']]);
    $buildings = $bStmt->fetchAll();

    $tStmt = $pdo->prepare('SELECT COUNT(*) FROM city_tiles WHERE city_id = :city_id');
    $tStmt->execute(['city_id' => (int) $city['id']]);
    $tileCount = (int) $tStmt->fetchColumn();
}

admin_layout_start('Player — ' . $user['name'], 'users', $adminUser);

?>

<a class="admin-back" href="users.php">&larr; Back to users</a>

<div class="admin-panel">
    <div class="admin-panel-head">
        <div>
            <h2 class="admin-panel-title">
                <?= admin_e($user['name']) ?>
                <?php if ((int) $user['is_admin'] === 1): ?>
                    <span class="admin-badge admin-badge-admin">Admin</span>
                <?php endif; ?>
            </h2>
            <p class="admin-panel-sub"><?= admin_e($user['email']) ?></p>
        </div>
        <?php if ($city !== false): ?>
            <div class="admin-panel-actions">
                <a class="admin-btn admin-btn-primary admin-btn-sm" href="city.php?id=<?= (int) $city['id'] ?>">Inspect city</a>
            </div>
        <?php endif; ?>
    </div>
    <div class="admin-panel-body">
        <dl class="admin-dl">
            <div>
                <dt>User ID</dt>
                <dd><?= (int) $user['id'] ?></dd>
            </div>
            <div>
                <dt>Registered</dt>
                <dd style="font-size: 0.95rem;"><?= admin_e((string) $user['created_at']) ?></dd>
            </div>
            <div>
                <dt>Role</dt>
                <dd><?= (int) $user['is_admin'] === 1 ? 'Administrator' : 'Player' ?></dd>
            </div>
            <div>
                <dt>Land owned</dt>
                <dd><?= number_format($tileCount) ?> tiles</dd>
            </div>
        </dl>
    </div>
</div>

<?php if ($city === false): ?>
    <div class="admin-panel">
        <div class="admin-panel-body">
            <p class="admin-cell-muted">This player has not started a city yet. A city is created the first time they open the game.</p>
        </div>
    </div>
<?php else: ?>
    <div class="admin-panel">
        <div class="admin-panel-head">
            <div>
                <h2 class="admin-panel-title"><?= admin_e($city['name']) ?></h2>
                <p class="admin-panel-sub">Created <?= admin_e((string) $city['created_at']) ?> · last economy tick <?= admin_e((string) $city['last_ticked_at']) ?></p>
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
            </dl>
        </div>
    </div>

    <div class="admin-panel">
        <div class="admin-panel-head">
            <div>
                <h2 class="admin-panel-title">What They Have Built</h2>
                <p class="admin-panel-sub">Grouped by building type.</p>
            </div>
        </div>
        <?php if ($buildings === []): ?>
            <p class="admin-table-empty">Nothing built yet.</p>
        <?php else: ?>
            <div class="admin-table-wrap">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Building</th>
                            <th>Category</th>
                            <th class="is-num">Count</th>
                            <th class="is-num">Income each</th>
                            <th class="is-num">Upkeep each</th>
                            <th class="is-num">Net / tick</th>
                        </tr>
                    </thead>
                    <tbody>
                    <?php foreach ($buildings as $row): ?>
                        <?php $net = ((float) $row['income'] - (float) $row['upkeep']) * (int) $row['total']; ?>
                        <tr>
                            <td class="admin-cell-strong"><?= admin_e($row['name']) ?></td>
                            <td><span class="admin-badge admin-badge-<?= admin_e($row['category']) ?>"><?= admin_e(ucfirst($row['category'])) ?></span></td>
                            <td class="is-num"><?= number_format((int) $row['total']) ?></td>
                            <td class="is-num"><?= admin_money((float) $row['income']) ?></td>
                            <td class="is-num"><?= admin_money((float) $row['upkeep']) ?></td>
                            <td class="is-num" style="color: <?= $net >= 0 ? 'var(--money-green)' : 'var(--danger)' ?>;">
                                <?= ($net >= 0 ? '+' : '') . admin_money($net) ?>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        <?php endif; ?>
    </div>
<?php endif; ?>

<?php admin_layout_end(); ?>
