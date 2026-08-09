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

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_error('Method not allowed.', 405);
    exit;
}

$userId = current_user_id();

if ($userId === null) {
    json_error('Not authenticated.', 401);
    exit;
}

try {
    $pdo = getDbConnection();

    $config = loadGameConfigValues($pdo, ['starting_budget', 'grid_size', 'starting_unlock_radius', 'tile_unlock_cost']);
    $gridSize = (int) ($config['grid_size'] ?? 20);
    $tileUnlockCost = (float) ($config['tile_unlock_cost'] ?? 0);

    $stmt = $pdo->prepare('SELECT id FROM cities WHERE user_id = :user_id LIMIT 1');
    $stmt->execute(['user_id' => $userId]);
    $existing = $stmt->fetch();

    if ($existing === false) {
        $startingBudget = (float) ($config['starting_budget'] ?? 50000);
        $radius = (int) ($config['starting_unlock_radius'] ?? 2);
        $center = intdiv($gridSize, 2);

        $pdo->beginTransaction();
        try {
            $insertCity = $pdo->prepare('INSERT INTO cities (user_id, name, budget) VALUES (:user_id, :name, :budget)');
            $insertCity->execute([
                'user_id' => $userId,
                'name' => 'My City',
                'budget' => $startingBudget,
            ]);
            $cityId = (int) $pdo->lastInsertId();

            $insertTile = $pdo->prepare('INSERT INTO city_tiles (city_id, tile_x, tile_y) VALUES (:city_id, :tile_x, :tile_y)');
            for ($x = $center - $radius; $x <= $center + $radius; $x++) {
                for ($y = $center - $radius; $y <= $center + $radius; $y++) {
                    if ($x < 0 || $x >= $gridSize || $y < 0 || $y >= $gridSize) {
                        continue;
                    }
                    $insertTile->execute(['city_id' => $cityId, 'tile_x' => $x, 'tile_y' => $y]);
                }
            }

            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    } else {
        $cityId = (int) $existing['id'];
    }

    $cityStmt = $pdo->prepare('SELECT id, name, budget, population, happiness, score FROM cities WHERE id = :id');
    $cityStmt->execute(['id' => $cityId]);
    $city = $cityStmt->fetch();

    $tilesStmt = $pdo->prepare('SELECT tile_x, tile_y FROM city_tiles WHERE city_id = :city_id');
    $tilesStmt->execute(['city_id' => $cityId]);
    $unlockedTiles = array_map(
        static function (array $row): array {
            return ['x' => (int) $row['tile_x'], 'y' => (int) $row['tile_y']];
        },
        $tilesStmt->fetchAll()
    );

    json_success([
        'city' => [
            'id' => (int) $city['id'],
            'name' => $city['name'],
            'budget' => (float) $city['budget'],
            'population' => (int) $city['population'],
            'happiness' => (int) $city['happiness'],
            'score' => (int) $city['score'],
        ],
        'unlocked_tiles' => $unlockedTiles,
        'tile_unlock_cost' => $tileUnlockCost,
        'grid_size' => $gridSize,
    ]);
} catch (Throwable $e) {
    error_log('Fetching city failed: ' . $e->getMessage());
    json_error('Unable to load city.', 500);
}
