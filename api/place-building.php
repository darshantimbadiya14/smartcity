<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/response.php';
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/levels.php';

function loadGameConfigValues(PDO $pdo, array $keys): array
{
    $placeholders = implode(',', array_fill(0, count($keys), '?'));
    $stmt = $pdo->prepare("SELECT config_key, config_value FROM game_config WHERE config_key IN ($placeholders)");
    $stmt->execute($keys);

    $values = [];
    foreach ($stmt->fetchAll() as $row) {
        $values[$row['config_key']] = $row['config_value'];
    }

    return $values;
}

/**
 * Tiles covered by a building anchored at (anchorX, anchorY), given its
 * unrotated footprint size and placement rotation. Rotation swaps the
 * effective width/height at 90 and 270 degrees.
 */
function footprintTiles(int $anchorX, int $anchorY, int $tileWidth, int $tileHeight, int $rotation): array
{
    $swap = ($rotation === 90 || $rotation === 270);
    $effectiveWidth = $swap ? $tileHeight : $tileWidth;
    $effectiveHeight = $swap ? $tileWidth : $tileHeight;

    $tiles = [];
    for ($dx = 0; $dx < $effectiveWidth; $dx++) {
        for ($dy = 0; $dy < $effectiveHeight; $dy++) {
            $tiles[] = ['x' => $anchorX + $dx, 'y' => $anchorY + $dy];
        }
    }

    return $tiles;
}

function tilesOverlap(array $tilesA, array $tilesB): bool
{
    $keysA = [];
    foreach ($tilesA as $tile) {
        $keysA[$tile['x'] . ',' . $tile['y']] = true;
    }
    foreach ($tilesB as $tile) {
        if (isset($keysA[$tile['x'] . ',' . $tile['y']])) {
            return true;
        }
    }

    return false;
}

/**
 * Returns null if every tile in $footprint is unlocked and free, otherwise
 * a human-readable reason string for the first problem found.
 */
function tilesAreUnlockedAndFree(PDO $pdo, int $cityId, array $footprint): ?string
{
    foreach ($footprint as $tile) {
        $unlockedStmt = $pdo->prepare(
            'SELECT 1 FROM city_tiles WHERE city_id = :city_id AND tile_x = :tile_x AND tile_y = :tile_y'
        );
        $unlockedStmt->execute(['city_id' => $cityId, 'tile_x' => $tile['x'], 'tile_y' => $tile['y']]);
        if ($unlockedStmt->fetch() === false) {
            return 'Unlock this land first.';
        }
    }

    $existingStmt = $pdo->prepare(
        'SELECT pb.tile_x, pb.tile_y, pb.rotation, bt.tile_width, bt.tile_height
         FROM placed_buildings pb
         INNER JOIN building_types bt ON bt.id = pb.building_type_id
         WHERE pb.city_id = :city_id'
    );
    $existingStmt->execute(['city_id' => $cityId]);

    foreach ($existingStmt->fetchAll() as $existing) {
        $existingFootprint = footprintTiles(
            (int) $existing['tile_x'],
            (int) $existing['tile_y'],
            (int) $existing['tile_width'],
            (int) $existing['tile_height'],
            (int) $existing['rotation']
        );
        if (tilesOverlap($footprint, $existingFootprint)) {
            return 'This tile already has a building.';
        }
    }

    return null;
}

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
$buildingTypeId = filter_var($input['building_type_id'] ?? null, FILTER_VALIDATE_INT);

if ($tileX === false || $tileY === false || $buildingTypeId === false) {
    json_error('tile_x, tile_y, and building_type_id must be integers.', 422);
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

    $typeStmt = $pdo->prepare(
        'SELECT id, code, name, category, cost, capacity, model_key, tile_width, tile_height FROM building_types WHERE id = :id'
    );
    $typeStmt->execute(['id' => $buildingTypeId]);
    $buildingType = $typeStmt->fetch();

    if ($buildingType === false) {
        json_error('Building type not found.', 404);
        exit;
    }

    $cost = (float) $buildingType['cost'];
    $capacity = (int) $buildingType['capacity'];
    $tileWidth = (int) $buildingType['tile_width'];
    $tileHeight = (int) $buildingType['tile_height'];

    $footprint = footprintTiles($tileX, $tileY, $tileWidth, $tileHeight, $rotation);

    foreach ($footprint as $tile) {
        if ($tile['x'] < 0 || $tile['x'] >= $gridSize || $tile['y'] < 0 || $tile['y'] >= $gridSize) {
            json_error('This building does not fit within the grid here.', 422);
            exit;
        }
    }

    $preCheckError = tilesAreUnlockedAndFree($pdo, $cityId, $footprint);
    if ($preCheckError !== null) {
        json_error($preCheckError, $preCheckError === 'Unlock this land first.' ? 422 : 409);
        exit;
    }

    $pdo->beginTransaction();
    try {
        $lockStmt = $pdo->prepare('SELECT budget FROM cities WHERE id = :city_id FOR UPDATE');
        $lockStmt->execute(['city_id' => $cityId]);
        $lockedCity = $lockStmt->fetch();
        $lockedBudget = (float) $lockedCity['budget'];

        $recheckError = tilesAreUnlockedAndFree($pdo, $cityId, $footprint);
        if ($recheckError !== null) {
            $pdo->rollBack();
            json_error($recheckError, $recheckError === 'Unlock this land first.' ? 422 : 409);
            exit;
        }

        if ($lockedBudget < $cost) {
            $pdo->rollBack();
            json_error('Not enough budget to place this building.', 422);
            exit;
        }

        $deduct = $pdo->prepare(
            'UPDATE cities SET budget = budget - :cost_deduct WHERE id = :city_id AND budget >= :cost_check'
        );
        $deduct->execute(['cost_deduct' => $cost, 'cost_check' => $cost, 'city_id' => $cityId]);

        if ($deduct->rowCount() === 0) {
            $pdo->rollBack();
            json_error('Not enough budget to place this building.', 422);
            exit;
        }

        try {
            $insert = $pdo->prepare(
                'INSERT INTO placed_buildings (city_id, tile_x, tile_y, building_type_id, rotation) VALUES (:city_id, :tile_x, :tile_y, :building_type_id, :rotation)'
            );
            $insert->execute([
                'city_id' => $cityId,
                'tile_x' => $tileX,
                'tile_y' => $tileY,
                'building_type_id' => $buildingType['id'],
                'rotation' => $rotation,
            ]);
        } catch (PDOException $e) {
            $isDuplicateTile = $e->getCode() === '23000' && (int) ($e->errorInfo[1] ?? 0) === 1062;
            if ($isDuplicateTile) {
                $pdo->rollBack();
                json_error('This tile already has a building.', 409);
                exit;
            }
            throw $e;
        }

        // Population is deliberately NOT bumped here. Building housing adds
        // capacity; residents then move in gradually over the following ticks,
        // at a rate set by the tax rate and happiness. api/city.php owns that.

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
        'building' => [
            'tile_x' => $tileX,
            'tile_y' => $tileY,
            'building_type_id' => (int) $buildingType['id'],
            'level' => 1,
            'rotation' => $rotation,
            'code' => $buildingType['code'],
            'name' => $buildingType['name'],
            'model_key' => $buildingType['model_key'],
            'category' => $buildingType['category'],
            'tile_width' => $tileWidth,
            'tile_height' => $tileHeight,
            // Upgrade metadata so the tile panel can offer the next level straight
            // away, without waiting for the next full city load.
            'upgradable' => isUpgradableCategory((string) $buildingType['category']),
            'next_upgrade_cost' => isUpgradableCategory((string) $buildingType['category'])
                ? upgradeCostFor($cost, 1)
                : null,
            'refund_value' => refundValueFor($cost, 1),
        ],
    ]);
} catch (Throwable $e) {
    error_log('Place building failed: ' . $e->getMessage());
    json_error('Unable to place building.', 500);
}
