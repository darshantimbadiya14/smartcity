<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/response.php';
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/city-helpers.php';

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

$buildingTypeId = filter_var($input['building_type_id'] ?? null, FILTER_VALIDATE_INT);

if ($buildingTypeId === false || $buildingTypeId === null) {
    json_error('building_type_id must be an integer.', 422);
    exit;
}

$rotation = filter_var($input['rotation'] ?? 0, FILTER_VALIDATE_INT);

if ($rotation === false || !in_array($rotation, [0, 90, 180, 270], true)) {
    json_error('rotation must be one of 0, 90, 180, 270.', 422);
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

    $typeStmt = $pdo->prepare(
        'SELECT id, code, name, category, cost, model_key, tile_width, tile_height
         FROM building_types WHERE id = :id'
    );
    $typeStmt->execute(['id' => $buildingTypeId]);
    $buildingType = $typeStmt->fetch();

    if ($buildingType === false) {
        json_error('Building type not found.', 404);
        exit;
    }

    // This endpoint draws a continuous run of one tile-sized piece. Roads are
    // the intended use; anything larger would need footprint packing.
    if ($buildingType['category'] !== 'road') {
        json_error('Only roads can be drawn across an area.', 422);
        exit;
    }

    if ((int) $buildingType['tile_width'] !== 1 || (int) $buildingType['tile_height'] !== 1) {
        json_error('Only single-tile roads can be drawn across an area.', 422);
        exit;
    }

    $unitCost = (float) $buildingType['cost'];

    $pdo->beginTransaction();
    try {
        $lockStmt = $pdo->prepare('SELECT budget FROM cities WHERE id = :city_id FOR UPDATE');
        $lockStmt->execute(['city_id' => $cityId]);
        $lockedBudget = (float) $lockStmt->fetchColumn();

        $ownedSet = loadUnlockedTileSet($pdo, $cityId);
        $occupied = loadOccupiedTileMap($pdo, $cityId);

        $buildable = [];
        $skippedLocked = 0;
        $skippedOccupied = 0;

        foreach ($tiles as $tile) {
            $key = $tile['x'] . ',' . $tile['y'];

            if (!isset($ownedSet[$key])) {
                $skippedLocked++;
                continue;
            }
            if (isset($occupied[$key])) {
                $skippedOccupied++;
                continue;
            }

            $buildable[] = $tile;
        }

        if ($buildable === []) {
            $pdo->rollBack();
            $reason = $skippedLocked > 0 && $skippedOccupied === 0
                ? 'Unlock this land before building roads on it.'
                : 'Every tile in this selection is already built on.';
            json_error($reason, 422);
            exit;
        }

        $affordable = $unitCost > 0 ? (int) floor($lockedBudget / $unitCost) : count($buildable);

        if ($affordable <= 0) {
            $pdo->rollBack();
            json_error('Not enough budget to build any road here.', 422);
            exit;
        }

        $toBuild = array_slice($buildable, 0, $affordable);
        $totalCost = $unitCost * count($toBuild);

        $deduct = $pdo->prepare(
            'UPDATE cities SET budget = budget - :cost_deduct WHERE id = :city_id AND budget >= :cost_check'
        );
        $deduct->execute(['cost_deduct' => $totalCost, 'cost_check' => $totalCost, 'city_id' => $cityId]);

        if ($deduct->rowCount() === 0) {
            $pdo->rollBack();
            json_error('Not enough budget to build this road.', 422);
            exit;
        }

        $insert = $pdo->prepare(
            'INSERT INTO placed_buildings (city_id, tile_x, tile_y, building_type_id, rotation)
             VALUES (:city_id, :tile_x, :tile_y, :building_type_id, :rotation)'
        );

        $placed = [];
        foreach ($toBuild as $tile) {
            $insert->execute([
                'city_id' => $cityId,
                'tile_x' => $tile['x'],
                'tile_y' => $tile['y'],
                'building_type_id' => (int) $buildingType['id'],
                'rotation' => $rotation,
            ]);

            $placed[] = [
                'tile_x' => $tile['x'],
                'tile_y' => $tile['y'],
                'building_type_id' => (int) $buildingType['id'],
                'level' => 1,
                'rotation' => $rotation,
                'code' => $buildingType['code'],
                'name' => $buildingType['name'],
                'model_key' => $buildingType['model_key'],
                'category' => $buildingType['category'],
                'tile_width' => 1,
                'tile_height' => 1,
                // Roads are never upgradeable.
                'upgradable' => false,
                'next_upgrade_cost' => null,
            ];
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    $resultStmt = $pdo->prepare('SELECT budget, population FROM cities WHERE id = :city_id');
    $resultStmt->execute(['city_id' => $cityId]);
    $result = $resultStmt->fetch();

    $skipped = count($tiles) - count($placed);

    json_success([
        'budget' => (float) $result['budget'],
        'population' => (int) $result['population'],
        'placed' => $placed,
        'placed_count' => count($placed),
        'skipped_count' => $skipped,
        'total_cost' => $totalCost,
    ], $skipped > 0
        ? 'Built ' . count($placed) . ' road tiles. ' . $skipped . ' tile' . ($skipped === 1 ? '' : 's') . ' skipped.'
        : 'Built ' . count($placed) . ' road tiles.');
} catch (Throwable $e) {
    error_log('Area road failed: ' . $e->getMessage());
    json_error('Unable to build the road.', 500);
}
