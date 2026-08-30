<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/admin.php';
require_once __DIR__ . '/../includes/admin-layout.php';

$pdo = getDbConnection();
$adminUser = require_admin($pdo);

/**
 * Every key the admin panel is allowed to write, with a label, a help line and
 * the validation rule applied before saving. Anything not listed here is shown
 * read-only, so a stray row in game_config can never be edited by accident.
 */
$editableKeys = [
    'starting_budget' => ['Starting Budget', 'Money a brand new city begins with.', 'number', 0, 10000000],
    'starting_unlock_radius' => ['Starting Land Radius', 'Half-width of the free starting patch (2 gives a 5×5 area).', 'int', 0, 10],
    'tile_unlock_cost' => ['Tile Unlock Cost', 'Price of buying one adjacent tile of land.', 'number', 0, 1000000],
    'tick_interval_seconds' => ['Tick Interval (seconds)', 'How many seconds of real time make up one economy tick.', 'number', 1, 86400],
    'tax_rate' => ['Default Tax Rate', 'Starting tax rate for brand new cities, 0–0.30. Players set their own rate in the game.', 'number', 0, 0.30],
    'happiness_base' => ['Base Happiness', 'Happiness a city starts from before building effects.', 'int', 0, 100],
];

/**
 * Keys shown read-only, with the reason. grid_size in particular must not be
 * edited: the 3D client builds its ground plane, grid and terrain around a fixed
 * 20x20 world, so raising it here creates cities centred outside what the client
 * can draw or click, and lowering it strands buildings beyond the new edge.
 */
$lockedKeyNotes = [
    'grid_size' => 'Fixed at 20 — the 3D world is built around this size. Changing it would place new cities outside the visible map.',
    'pop_per_house' => 'Not used by the game. Residential capacity comes from each building type instead.',
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!admin_verify_csrf()) {
        admin_flash('Your session expired. Please try that again.', 'error');
    } else {
        $updated = 0;
        $errors = [];

        try {
            $update = $pdo->prepare('UPDATE game_config SET config_value = :value WHERE config_key = :key');

            foreach ($editableKeys as $key => [$label, $help, $type, $min, $max]) {
                if (!array_key_exists($key, $_POST)) {
                    continue;
                }

                $raw = is_string($_POST[$key]) ? trim($_POST[$key]) : '';

                $value = $type === 'int'
                    ? filter_var($raw, FILTER_VALIDATE_INT)
                    : filter_var($raw, FILTER_VALIDATE_FLOAT);

                if ($value === false || $value < $min || $value > $max) {
                    $errors[] = $label;
                    continue;
                }

                $update->execute(['value' => (string) $value, 'key' => $key]);
                $updated++;
            }

            if ($errors !== []) {
                admin_flash('Skipped invalid values for: ' . implode(', ', $errors) . '.', 'error');
            } else {
                admin_flash($updated . ' setting' . ($updated === 1 ? '' : 's') . ' saved.');
            }
        } catch (Throwable $e) {
            error_log('Admin config update failed: ' . $e->getMessage());
            admin_flash('Could not save the game configuration.', 'error');
        }
    }

    header('Location: config.php');
    exit;
}

$config = [];
foreach ($pdo->query('SELECT config_key, config_value FROM game_config ORDER BY config_key ASC')->fetchAll() as $row) {
    $config[$row['config_key']] = $row['config_value'];
}

$unknownKeys = array_diff(array_keys($config), array_keys($editableKeys));

admin_layout_start('Game Config', 'config', $adminUser);

?>

<form method="post" action="config.php">
    <?= admin_csrf_field() ?>

    <div class="admin-panel">
        <div class="admin-panel-head">
            <div>
                <h2 class="admin-panel-title">World Settings</h2>
                <p class="admin-panel-sub">
                    These values drive land pricing, the economy tick and the score formula for every player.
                </p>
            </div>
        </div>
        <div class="admin-panel-body">
            <div class="admin-form-grid">
                <?php foreach ($editableKeys as $key => [$label, $help, $type, $min, $max]): ?>
                    <?php if (!array_key_exists($key, $config)) { continue; } ?>
                    <div class="admin-field">
                        <label for="cfg-<?= admin_e($key) ?>"><?= admin_e($label) ?></label>
                        <input id="cfg-<?= admin_e($key) ?>"
                               type="number"
                               name="<?= admin_e($key) ?>"
                               step="<?= $type === 'int' ? '1' : 'any' ?>"
                               min="<?= admin_e((string) $min) ?>"
                               max="<?= admin_e((string) $max) ?>"
                               value="<?= admin_e($config[$key]) ?>"
                               required>
                        <span class="admin-field-hint"><?= admin_e($help) ?></span>
                    </div>
                <?php endforeach; ?>
            </div>

            <div class="admin-form-actions">
                <button type="submit" class="admin-btn admin-btn-primary">Save settings</button>
                <a class="admin-btn admin-btn-ghost" href="config.php">Reset</a>
            </div>
        </div>
    </div>
</form>

<?php if ($unknownKeys !== []): ?>
    <div class="admin-panel">
        <div class="admin-panel-head">
            <div>
                <h2 class="admin-panel-title">Locked Settings</h2>
                <p class="admin-panel-sub">Present in the database but deliberately not editable from this screen.</p>
            </div>
        </div>
        <div class="admin-table-wrap">
            <table class="admin-table">
                <thead>
                    <tr><th>Key</th><th>Value</th><th class="is-wrap">Why it is locked</th></tr>
                </thead>
                <tbody>
                <?php foreach ($unknownKeys as $key): ?>
                    <tr>
                        <td class="admin-cell-strong"><?= admin_e($key) ?></td>
                        <td class="admin-cell-muted"><?= admin_e($config[$key]) ?></td>
                        <td class="admin-cell-muted is-wrap">
                            <?= admin_e($lockedKeyNotes[$key] ?? 'Not editable from this screen.') ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>
<?php endif; ?>

<?php admin_layout_end(); ?>
