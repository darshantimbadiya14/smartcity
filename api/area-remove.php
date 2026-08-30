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

    $config = loadGameConfigValues($pdo, ['grid_size']);
    $gridSize = (int) ($config['grid_size'] ?? 20);

    $tiles = parseTileList($input['tiles'] ?? null, $gridSize);

    if ($tiles === null) {
        json_error('Provide between 1 and 400 valid tiles inside the grid.', 422);
        exit;
    }

    $pdo->beginTransaction();
    try {
        $lockStmt = $pdo->prepare('SELECT budget, population FROM cities WHERE id = :city_id FOR UPDATE');
        $lockStmt->execute(['city_id' => $cityId]);
        $lockStmt->fetch();

        // Resolve which buildings the selection touches under the lock. A
        // multi-tile structure is removed whole if any of its tiles is selected.
        $occupied = loadOccupiedTileMap($pdo, $cityId);

        $targets = [];
        foreach ($tiles as $tile) {
            $key = $tile['x'] . ',' . $tile['y'];
            if (!isset($occupied[$key])) {
                continue;
            }
            $row = $occupied[$key];
            $targets[(int) $row['id']] = $row;
        }

        if ($targets === []) {
            $pdo->rollBack();
            json_error('There are no buildings in the selected area.', 404);
            exit;
        }

        $refund = 0.0;
        $populationDrop = 0;
        $removed = [];
        $ids = [];

        foreach ($targets as $buildingId => $row) {
            // Level-aware: refund the placement cost plus every upgrade since.
            $level = clampBuildingLevel((int) $row['level']);
            $refund += refundValueFor((float) $row['cost'], $level);

            $ids[] = $buildingId;
            $removed[] = [
                'tile_x' => (int) $row['tile_x'],
                'tile_y' => (int) $row['tile_y'],
                'building_type_id' => (int) $row['building_type_id'],
                'code' => $row['code'],
                'name' => $row['name'],
                'model_key' => $row['model_key'],
            ];
        }

        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $deleteStmt = $pdo->prepare(
            "DELETE FROM placed_buildings WHERE city_id = ? AND id IN ($placeholders)"
        );
        $deleteStmt->execute(array_merge([$cityId], $ids));

        // Population is settled by the tick in api/city.php against the remaining
        // housing capacity, so it is not adjusted here.
        $updateStmt = $pdo->prepare('UPDATE cities SET budget = budget + :refund WHERE id = :city_id');
        $updateStmt->execute([
            'refund' => $refund,
            'city_id' => $cityId,
        ]);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    $resultStmt = $pdo->prepare('SELECT budget, population FROM cities WHERE id = :city_id');
    $resultStmt->execute(['city_id' => $cityId]);
    $result = $resultStmt->fetch();

    json_success([
        'budget' => (float) $result['budget'],
        'population' => (int) $result['population'],
        'removed' => $removed,
        'removed_count' => count($removed),
        'refund' => $refund,
    ], 'Removed ' . count($removed) . ' structure' . (count($removed) === 1 ? '' : 's') . '.');
} catch (Throwable $e) {
    error_log('Area remove failed: ' . $e->getMessage());
    json_error('Unable to clear this area.', 500);
}
