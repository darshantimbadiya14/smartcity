<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/admin.php';
require_once __DIR__ . '/../includes/admin-layout.php';

$pdo = getDbConnection();
$adminUser = require_admin($pdo);
$adminId = (int) $adminUser['id'];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';
    $targetId = filter_var($_POST['user_id'] ?? null, FILTER_VALIDATE_INT);

    if (!admin_verify_csrf()) {
        admin_flash('Your session expired. Please try that again.', 'error');
    } elseif ($targetId === false || $targetId === null) {
        admin_flash('Invalid user.', 'error');
    } elseif ($action === 'delete') {
        if ($targetId === $adminId) {
            admin_flash('You cannot delete the account you are signed in with.', 'error');
        } else {
            try {
                // Cities, tiles and placed buildings cascade from the users row.
                $stmt = $pdo->prepare('DELETE FROM users WHERE id = :id');
                $stmt->execute(['id' => $targetId]);
                admin_flash($stmt->rowCount() > 0 ? 'User deleted along with their city.' : 'That user no longer exists.',
                    $stmt->rowCount() > 0 ? 'success' : 'error');
            } catch (Throwable $e) {
                error_log('Admin delete user failed: ' . $e->getMessage());
                admin_flash('Could not delete that user.', 'error');
            }
        }
    } elseif ($action === 'promote' || $action === 'demote') {
        $makeAdmin = $action === 'promote' ? 1 : 0;

        if ($action === 'demote' && $targetId === $adminId) {
            admin_flash('You cannot remove admin access from your own account.', 'error');
        } else {
            try {
                $stmt = $pdo->prepare('UPDATE users SET is_admin = :is_admin WHERE id = :id');
                $stmt->execute(['is_admin' => $makeAdmin, 'id' => $targetId]);
                admin_flash($makeAdmin === 1 ? 'Admin access granted.' : 'Admin access removed.');
            } catch (Throwable $e) {
                error_log('Admin role change failed: ' . $e->getMessage());
                admin_flash('Could not update that user.', 'error');
            }
        }
    } else {
        admin_flash('Unknown action.', 'error');
    }

    $redirect = 'users.php';
    $keepSearch = is_string($_POST['q'] ?? null) ? trim($_POST['q']) : '';
    if ($keepSearch !== '') {
        $redirect .= '?q=' . urlencode($keepSearch);
    }
    header('Location: ' . $redirect);
    exit;
}

$search = is_string($_GET['q'] ?? null) ? trim($_GET['q']) : '';

$sql =
    'SELECT u.id, u.name, u.email, u.is_admin, u.created_at,
            c.id AS city_id, c.name AS city_name, c.score, c.population, c.budget,
            (SELECT COUNT(*) FROM placed_buildings pb WHERE pb.city_id = c.id) AS building_count
     FROM users u
     LEFT JOIN cities c ON c.user_id = u.id';

$params = [];
if ($search !== '') {
    $sql .= ' WHERE u.name LIKE :search_name OR u.email LIKE :search_email';
    $params['search_name'] = '%' . $search . '%';
    $params['search_email'] = '%' . $search . '%';
}
$sql .= ' ORDER BY u.id ASC';

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$users = $stmt->fetchAll();

admin_layout_start('Users', 'users', $adminUser);

?>

<div class="admin-panel">
    <div class="admin-panel-head">
        <div>
            <h2 class="admin-panel-title">All Players</h2>
            <p class="admin-panel-sub">
                <?= count($users) ?> user<?= count($users) === 1 ? '' : 's' ?><?= $search !== '' ? ' matching "' . admin_e($search) . '"' : '' ?>.
                Deleting a user also removes their city, land and buildings.
            </p>
        </div>
        <div class="admin-panel-actions">
            <form class="admin-search-form" method="get" action="users.php">
                <input type="search" name="q" placeholder="Search name or email…" value="<?= admin_e($search) ?>">
                <button type="submit" class="admin-btn admin-btn-primary admin-btn-sm">Search</button>
                <?php if ($search !== ''): ?>
                    <a class="admin-btn admin-btn-ghost admin-btn-sm" href="users.php">Clear</a>
                <?php endif; ?>
            </form>
        </div>
    </div>

    <?php if ($users === []): ?>
        <p class="admin-table-empty">No users found.</p>
    <?php else: ?>
        <div class="admin-table-wrap">
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>City</th>
                        <th class="is-num">Score</th>
                        <th class="is-num">Pop.</th>
                        <th class="is-num">Built</th>
                        <th>Registered</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($users as $user): ?>
                    <?php $isSelf = (int) $user['id'] === $adminId; ?>
                    <tr>
                        <td class="admin-cell-muted"><?= (int) $user['id'] ?></td>
                        <td class="admin-cell-strong">
                            <?= admin_e($user['name']) ?>
                            <?php if ($isSelf): ?>
                                <span class="admin-badge admin-badge-you">You</span>
                            <?php endif; ?>
                        </td>
                        <td class="admin-cell-muted is-truncate" title="<?= admin_e($user['email']) ?>"><?= admin_e($user['email']) ?></td>
                        <td>
                            <?php if ((int) $user['is_admin'] === 1): ?>
                                <span class="admin-badge admin-badge-admin">Admin</span>
                            <?php else: ?>
                                <span class="admin-badge">Player</span>
                            <?php endif; ?>
                        </td>
                        <td>
                            <?php if ($user['city_id'] === null): ?>
                                <span class="admin-cell-muted">—</span>
                            <?php else: ?>
                                <a href="city.php?id=<?= (int) $user['city_id'] ?>"><?= admin_e($user['city_name']) ?></a>
                            <?php endif; ?>
                        </td>
                        <td class="is-num"><?= $user['city_id'] === null ? '—' : number_format((int) $user['score']) ?></td>
                        <td class="is-num"><?= $user['city_id'] === null ? '—' : number_format((int) $user['population']) ?></td>
                        <td class="is-num"><?= $user['city_id'] === null ? '—' : number_format((int) $user['building_count']) ?></td>
                        <td class="admin-cell-muted" title="<?= admin_e((string) $user['created_at']) ?>">
                            <?= admin_e(substr((string) $user['created_at'], 0, 10)) ?>
                        </td>
                        <td>
                            <div class="admin-action-row">
                                <a class="admin-btn admin-btn-ghost admin-btn-sm" href="user.php?id=<?= (int) $user['id'] ?>">View</a>

                                <?php if (!$isSelf): ?>
                                    <form class="admin-inline-form" method="post" action="users.php">
                                        <?= admin_csrf_field() ?>
                                        <input type="hidden" name="user_id" value="<?= (int) $user['id'] ?>">
                                        <input type="hidden" name="q" value="<?= admin_e($search) ?>">
                                        <?php if ((int) $user['is_admin'] === 1): ?>
                                            <input type="hidden" name="action" value="demote">
                                            <button type="submit" class="admin-btn admin-btn-ghost admin-btn-sm">Revoke admin</button>
                                        <?php else: ?>
                                            <input type="hidden" name="action" value="promote">
                                            <button type="submit" class="admin-btn admin-btn-ghost admin-btn-sm">Make admin</button>
                                        <?php endif; ?>
                                    </form>

                                    <form class="admin-inline-form" method="post" action="users.php"
                                          onsubmit="return confirm('Delete <?= admin_e(addslashes($user['name'])) ?> and their entire city? This cannot be undone.');">
                                        <?= admin_csrf_field() ?>
                                        <input type="hidden" name="action" value="delete">
                                        <input type="hidden" name="user_id" value="<?= (int) $user['id'] ?>">
                                        <input type="hidden" name="q" value="<?= admin_e($search) ?>">
                                        <button type="submit" class="admin-btn admin-btn-danger admin-btn-sm">Delete</button>
                                    </form>
                                <?php endif; ?>
                            </div>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    <?php endif; ?>
</div>

<?php admin_layout_end(); ?>
