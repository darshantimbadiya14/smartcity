<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/response.php';
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/levels.php';

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

function footprintContainsTile(array $footprint, int $tileX, int $tileY): bool
{
    foreach ($footprint as $tile) {
        if ($tile['x'] === $tileX && $tile['y'] === $tileY) {
            return true;
        }
    }

    return false;
}

/**
 * Finds the placed building (if any) whose footprint covers (tileX, tileY).
 * Returns the placed_buildings + building_types row, or false if none.
 */
function findBuildingCoveringTile(PDO $pdo, int $cityId, int $tileX, int $tileY)
{
    $stmt = $pdo->prepare(
        'SELECT pb.id, pb.tile_x, pb.tile_y, pb.rotation, pb.building_type_id, pb.level,
                bt.code, bt.name, bt.model_key, bt.cost, bt.capacity, bt.category, bt.tile_width, bt.tile_height
         FROM placed_buildings pb
         INNER JOIN building_types bt ON bt.id = pb.building_type_id
         WHERE pb.city_id = :city_id'
    );
    $stmt->execute(['city_id' => $cityId]);

    foreach ($stmt->fetchAll() as $row) {
        $footprint = footprintTiles(
            (int) $row['tile_x'],
            (int) $row['tile_y'],
            (int) $row['tile_width'],
            (int) $row['tile_height'],
            (int) $row['rotation']
        );
        if (footprintContainsTile($footprint, $tileX, $tileY)) {
            return $row;
        }
    }

    return false;
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

if ($tileX === false || $tileY === false) {
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

    $target = findBuildingCoveringTile($pdo, $cityId, $tileX, $tileY);

    if ($target === false) {
        json_error('There is no building on this tile.', 404);
        exit;
    }

    $pdo->beginTransaction();
    try {
        $lockStmt = $pdo->prepare('SELECT budget, population FROM cities WHERE id = :city_id FOR UPDATE');
        $lockStmt->execute(['city_id' => $cityId]);
        $lockedCity = $lockStmt->fetch();

        // Re-verify under the lock in case another request already removed it.
        $recheckStmt = $pdo->prepare('SELECT id FROM placed_buildings WHERE id = :id AND city_id = :city_id');
        $recheckStmt->execute(['id' => $target['id'], 'city_id' => $cityId]);

        if ($recheckStmt->fetch() === false) {
            $pdo->rollBack();
            json_error('There is no building on this tile.', 404);
            exit;
        }

        // Refund what was paid to place it plus every upgrade since.
        $level = clampBuildingLevel((int) $target['level']);
        $refund = refundValueFor((float) $target['cost'], $level);

        $deleteStmt = $pdo->prepare('DELETE FROM placed_buildings WHERE id = :id');
        $deleteStmt->execute(['id' => $target['id']]);

        // Population is not adjusted here: the tick in api/city.php recalculates
        // housing capacity and settles residents against it, so demolishing homes
        // empties them out over the next few ticks (and immediately if capacity
        // drops below the current headcount).
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
        'removed' => [
            'tile_x' => (int) $target['tile_x'],
            'tile_y' => (int) $target['tile_y'],
            'building_type_id' => (int) $target['building_type_id'],
            'code' => $target['code'],
            'name' => $target['name'],
            'model_key' => $target['model_key'],
        ],
    ]);
} catch (Throwable $e) {
    error_log('Remove building failed: ' . $e->getMessage());
    json_error('Unable to remove building.', 500);
}
