<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/response.php';
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/city-helpers.php';
require_once __DIR__ . '/../includes/levels.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Method not allowed.', 405);
    exit;
}

$userId = current_user_id();

if ($userId === null) {
    json_error('Not authenticated.', 401);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

if (!is_array($input)) {
    json_error('Invalid JSON body.', 400);
    exit;
}

$tileX = filter_var($input['tile_x'] ?? null, FILTER_VALIDATE_INT);
$tileY = filter_var($input['tile_y'] ?? null, FILTER_VALIDATE_INT);

if ($tileX === false || $tileX === null || $tileY === false || $tileY === null) {
    json_error('tile_x and tile_y must be integers.', 422);
    exit;
}

try {
    $pdo = getDbConnection();

    $cityStmt = $pdo->prepare('SELECT id FROM cities WHERE user_id = :user_id LIMIT 1');
    $cityStmt->execute(['user_id' => $userId]);
    $city = $cityStmt->fetch();

    if ($city === false) {
        json_error('City not found. Load your city first.', 404);
        exit;
    }

    $cityId = (int) $city['id'];

    $pdo->beginTransaction();
    try {
        $lockStmt = $pdo->prepare('SELECT budget FROM cities WHERE id = :city_id FOR UPDATE');
        $lockStmt->execute(['city_id' => $cityId]);
        $lockedBudget = (float) $lockStmt->fetchColumn();

        // Resolve the building under the lock — the level we price against must be
        // the level we actually write.
        $occupied = loadOccupiedTileMap($pdo, $cityId);
        $key = $tileX . ',' . $tileY;

        if (!isset($occupied[$key])) {
            $pdo->rollBack();
            json_error('There is no building on this tile.', 404);
            exit;
        }

        $target = $occupied[$key];

        if (!isUpgradableCategory((string) $target['category'])) {
            $pdo->rollBack();
            json_error('Roads cannot be upgraded. Place a wider road instead.', 422);
            exit;
        }

        $levelStmt = $pdo->prepare('SELECT level FROM placed_buildings WHERE id = :id AND city_id = :city_id');
        $levelStmt->execute(['id' => $target['id'], 'city_id' => $cityId]);
        $currentLevelRaw = $levelStmt->fetchColumn();

        if ($currentLevelRaw === false) {
            $pdo->rollBack();
            json_error('There is no building on this tile.', 404);
            exit;
        }

        $currentLevel = clampBuildingLevel((int) $currentLevelRaw);
        $cost = upgradeCostFor((float) $target['cost'], $currentLevel);

        if ($cost === null) {
            $pdo->rollBack();
            json_error($target['name'] . ' is already at its maximum level.', 409);
            exit;
        }

        if ($lockedBudget < $cost) {
            $pdo->rollBack();
            json_error('Not enough budget to upgrade this building.', 422);
            exit;
        }

        $deduct = $pdo->prepare(
            'UPDATE cities SET budget = budget - :cost_deduct WHERE id = :city_id AND budget >= :cost_check'
        );
        $deduct->execute(['cost_deduct' => $cost, 'cost_check' => $cost, 'city_id' => $cityId]);

        if ($deduct->rowCount() === 0) {
            $pdo->rollBack();
            json_error('Not enough budget to upgrade this building.', 422);
            exit;
        }

        $newLevel = $currentLevel + 1;

        // Guarded on the current level so two concurrent upgrades cannot both land.
        $bump = $pdo->prepare(
            'UPDATE placed_buildings SET level = :new_level WHERE id = :id AND city_id = :city_id AND level = :current_level'
        );
        $bump->execute([
            'new_level' => $newLevel,
            'id' => $target['id'],
            'city_id' => $cityId,
            'current_level' => $currentLevel,
        ]);

        if ($bump->rowCount() === 0) {
            $pdo->rollBack();
            json_error('This building was changed by another request. Try again.', 409);
            exit;
        }

        // Upgrading housing raises capacity, not population: the extra residents
        // move in gradually over the following ticks. api/city.php settles it.

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    $resultStmt = $pdo->prepare('SELECT budget, population FROM cities WHERE id = :city_id');
    $resultStmt->execute(['city_id' => $cityId]);
    $result = $resultStmt->fetch();

    $nextCost = upgradeCostFor((float) $target['cost'], $newLevel);

    json_success([
        'budget' => (float) $result['budget'],
        'population' => (int) $result['population'],
        'building' => [
            'tile_x' => (int) $target['tile_x'],
            'tile_y' => (int) $target['tile_y'],
            'building_type_id' => (int) $target['building_type_id'],
            'level' => $newLevel,
            'rotation' => (int) $target['rotation'],
            'code' => $target['code'],
            'name' => $target['name'],
            'model_key' => $target['model_key'],
            'tile_width' => (int) $target['tile_width'],
            'tile_height' => (int) $target['tile_height'],
        ],
        'cost' => $cost,
        'next_upgrade_cost' => $nextCost,
        'max_level' => MAX_BUILDING_LEVEL,
    ], $target['name'] . ' upgraded to level ' . $newLevel . '.');
} catch (Throwable $e) {
    error_log('Upgrade building failed: ' . $e->getMessage());
    json_error('Unable to upgrade this building.', 500);
}
