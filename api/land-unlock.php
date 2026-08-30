<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/response.php';
require_once __DIR__ . '/../includes/session.php';

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

    $config = loadGameConfigValues($pdo, ['grid_size', 'tile_unlock_cost']);
    $gridSize = (int) ($config['grid_size'] ?? 20);
    $tileUnlockCost = (float) ($config['tile_unlock_cost'] ?? 0);

    if ($tileX < 0 || $tileX >= $gridSize || $tileY < 0 || $tileY >= $gridSize) {
        json_error('Tile coordinates are out of range.', 422);
        exit;
    }

    $existsStmt = $pdo->prepare(
        'SELECT 1 FROM city_tiles WHERE city_id = :city_id AND tile_x = :tile_x AND tile_y = :tile_y'
    );
    $existsStmt->execute(['city_id' => $cityId, 'tile_x' => $tileX, 'tile_y' => $tileY]);

    if ($existsStmt->fetch() !== false) {
        json_error('This tile is already unlocked.', 409);
        exit;
    }

    $adjacentStmt = $pdo->prepare(
        'SELECT 1 FROM city_tiles WHERE city_id = :city_id AND (
            (tile_x = :left_x AND tile_y = :left_y)
            OR (tile_x = :right_x AND tile_y = :right_y)
            OR (tile_x = :up_x AND tile_y = :up_y)
            OR (tile_x = :down_x AND tile_y = :down_y)
        ) LIMIT 1'
    );
    $adjacentStmt->execute([
        'left_x' => $tileX - 1, 'left_y' => $tileY,
        'right_x' => $tileX + 1, 'right_y' => $tileY,
        'up_x' => $tileX, 'up_y' => $tileY - 1,
        'down_x' => $tileX, 'down_y' => $tileY + 1,
        'city_id' => $cityId,
    ]);

    if ($adjacentStmt->fetch() === false) {
        json_error('Unlock land next to your existing city first.', 422);
        exit;
    }

    $pdo->beginTransaction();
    try {
        $lockStmt = $pdo->prepare('SELECT budget FROM cities WHERE id = :city_id FOR UPDATE');
        $lockStmt->execute(['city_id' => $cityId]);
        $lockedCity = $lockStmt->fetch();
        $lockedBudget = (float) $lockedCity['budget'];

        $recheckExistsStmt = $pdo->prepare(
            'SELECT 1 FROM city_tiles WHERE city_id = :city_id AND tile_x = :tile_x AND tile_y = :tile_y'
        );
        $recheckExistsStmt->execute(['city_id' => $cityId, 'tile_x' => $tileX, 'tile_y' => $tileY]);

        if ($recheckExistsStmt->fetch() !== false) {
            $pdo->rollBack();
            json_error('This tile is already unlocked.', 409);
            exit;
        }

        if ($lockedBudget < $tileUnlockCost) {
            $pdo->rollBack();
            json_error('Not enough budget to unlock this tile.', 422);
            exit;
        }

        $deduct = $pdo->prepare('UPDATE cities SET budget = budget - :cost_deduct WHERE id = :city_id AND budget >= :cost_check');
        $deduct->execute(['cost_deduct' => $tileUnlockCost, 'cost_check' => $tileUnlockCost, 'city_id' => $cityId]);

        if ($deduct->rowCount() === 0) {
            $pdo->rollBack();
            json_error('Not enough budget to unlock this tile.', 422);
            exit;
        }

        $insert = $pdo->prepare('INSERT INTO city_tiles (city_id, tile_x, tile_y) VALUES (:city_id, :tile_x, :tile_y)');
        $insert->execute(['city_id' => $cityId, 'tile_x' => $tileX, 'tile_y' => $tileY]);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    $budgetStmt = $pdo->prepare('SELECT budget FROM cities WHERE id = :city_id');
    $budgetStmt->execute(['city_id' => $cityId]);
    $newBudget = (float) $budgetStmt->fetchColumn();

    json_success([
        'budget' => $newBudget,
        'tile' => ['x' => $tileX, 'y' => $tileY],
    ]);
} catch (Throwable $e) {
    error_log('Land unlock failed: ' . $e->getMessage());
    json_error('Unable to unlock land.', 500);
}
