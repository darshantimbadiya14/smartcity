<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/admin.php';
require_once __DIR__ . '/../includes/admin-layout.php';

$pdo = getDbConnection();
$adminUser = require_admin($pdo);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $typeId = filter_var($_POST['building_type_id'] ?? null, FILTER_VALIDATE_INT);

    if (!admin_verify_csrf()) {
        admin_flash('Your session expired. Please try that again.', 'error');
    } elseif ($typeId === false || $typeId === null) {
        admin_flash('Invalid building type.', 'error');
    } else {
        $cost = filter_var($_POST['cost'] ?? null, FILTER_VALIDATE_FLOAT);
        $upkeep = filter_var($_POST['upkeep'] ?? null, FILTER_VALIDATE_FLOAT);
        $income = filter_var($_POST['income'] ?? null, FILTER_VALIDATE_FLOAT);
        $capacity = filter_var($_POST['capacity'] ?? null, FILTER_VALIDATE_INT);
        $happiness = filter_var($_POST['happiness_effect'] ?? null, FILTER_VALIDATE_INT);

        $invalid = $cost === false || $upkeep === false || $income === false
            || $capacity === false || $happiness === false
            || $cost < 0 || $upkeep < 0 || $income < 0 || $capacity < 0;

        if ($invalid) {
            admin_flash('Costs, upkeep, income and capacity must be non-negative numbers.', 'error');
        } else {
            try {
                $stmt = $pdo->prepare(
                    'UPDATE building_types
                     SET cost = :cost, upkeep = :upkeep, income = :income,
                         capacity = :capacity, happiness_effect = :happiness_effect
                     WHERE id = :id'
                );
                $stmt->execute([
                    'cost' => $cost,
                    'upkeep' => $upkeep,
                    'income' => $income,
                    'capacity' => $capacity,
                    'happiness_effect' => $happiness,
                    'id' => $typeId,
                ]);
                admin_flash('Building type updated. Changes apply the next time players load the build menu.');
            } catch (Throwable $e) {
                error_log('Admin building type update failed: ' . $e->getMessage());
                admin_flash('Could not update that building type.', 'error');
            }
        }
    }

    header('Location: building-types.php');
    exit;
}

$types = $pdo->query(
    'SELECT bt.*,
            (SELECT COUNT(*) FROM placed_buildings pb WHERE pb.building_type_id = bt.id) AS placed_count
     FROM building_types bt
     ORDER BY bt.category ASC, bt.cost ASC'
)->fetchAll();

admin_layout_start('Building Types', 'buildings', $adminUser);

?>

<?php
// Each row is edited by its own form. The <form> elements live outside the table
// (a form is not valid markup between <tr> and <td>) and the inputs are wired to
// them with the HTML5 form="" attribute.
foreach ($types as $type): ?>
    <form id="bt-form-<?= (int) $type['id'] ?>" method="post" action="building-types.php" hidden>
        <?= admin_csrf_field() ?>
        <input type="hidden" name="building_type_id" value="<?= (int) $type['id'] ?>">
    </form>
<?php endforeach; ?>

<div class="admin-panel">
    <div class="admin-panel-head">
        <div>
            <h2 class="admin-panel-title">Game Balance</h2>
            <p class="admin-panel-sub">
                Tune the economy of every structure. Category, footprint and 3D model are fixed in code and cannot be edited here.
            </p>
        </div>
    </div>

    <div class="admin-table-wrap">
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Building</th>
                    <th>Category</th>
                    <th>Size</th>
                    <th class="is-num">Cost</th>
                    <th class="is-num">Upkeep</th>
                    <th class="is-num">Income</th>
                    <th class="is-num">Capacity</th>
                    <th class="is-num">Happiness</th>
                    <th class="is-num">Placed</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($types as $type): ?>
                <?php $formId = 'bt-form-' . (int) $type['id']; ?>
                <tr>
                    <td class="admin-cell-strong">
                        <?= admin_e($type['name']) ?>
                        <div class="admin-field-hint"><?= admin_e($type['code']) ?></div>
                    </td>
                    <td>
                        <span class="admin-badge admin-badge-<?= admin_e($type['category']) ?>">
                            <?= admin_e(ucfirst($type['category'])) ?>
                        </span>
                    </td>
                    <td class="admin-cell-muted"><?= (int) $type['tile_width'] ?>×<?= (int) $type['tile_height'] ?></td>
                    <td class="is-num">
                        <input class="admin-edit-input" form="<?= $formId ?>" type="number" name="cost"
                               step="0.01" min="0" value="<?= admin_e((string) $type['cost']) ?>" required>
                    </td>
                    <td class="is-num">
                        <input class="admin-edit-input" form="<?= $formId ?>" type="number" name="upkeep"
                               step="0.01" min="0" value="<?= admin_e((string) $type['upkeep']) ?>" required>
                    </td>
                    <td class="is-num">
                        <input class="admin-edit-input" form="<?= $formId ?>" type="number" name="income"
                               step="0.01" min="0" value="<?= admin_e((string) $type['income']) ?>" required>
                    </td>
                    <td class="is-num">
                        <input class="admin-edit-input is-narrow" form="<?= $formId ?>" type="number" name="capacity"
                               step="1" min="0" value="<?= (int) $type['capacity'] ?>" required>
                    </td>
                    <td class="is-num">
                        <input class="admin-edit-input is-narrow" form="<?= $formId ?>" type="number" name="happiness_effect"
                               step="1" value="<?= (int) $type['happiness_effect'] ?>" required>
                    </td>
                    <td class="is-num admin-cell-muted"><?= number_format((int) $type['placed_count']) ?></td>
                    <td class="is-num">
                        <button type="submit" form="<?= $formId ?>" class="admin-btn admin-btn-primary admin-btn-sm">Save</button>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>

<?php admin_layout_end(); ?>
