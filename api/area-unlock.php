<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/response.php';
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/city-helpers.php';

/**
 * Orders the requested tiles so each one touches territory that is either
 * already owned or unlocked earlier in the same batch, and drops any tile that
 * can never be reached. This is what lets a player drag a 5x6 block outward
 * from their city and buy the whole thing in one action.
 *
 * Returns the buyable tiles in a valid purchase order.
 */
function reachableTilesInOrder(array $requested, array $ownedSet): array
{
    $pending = [];
    foreach ($requested as $tile) {
        $key = $tile['x'] . ',' . $tile['y'];
        if (isset($ownedSet[$key])) {
            continue; // already owned, nothing to buy
        }
        $pending[$key] = $tile;
    }

    $reached = $ownedSet;
    $ordered = [];

    // Repeatedly take whichever pending tiles now touch reached territory.
    do {
        $grew = false;

        foreach ($pending as $key => $tile) {
            $touches = isset($reached[($tile['x'] - 1) . ',' . $tile['y']])
                || isset($reached[($tile['x'] + 1) . ',' . $tile['y']])
                || isset($reached[$tile['x'] . ',' . ($tile['y'] - 1)])
                || isset($reached[$tile['x'] . ',' . ($tile['y'] + 1)]);

            if ($touches) {
                $ordered[] = $tile;
                $reached[$key] = true;
                unset($pending[$key]);
                $grew = true;
            }
        }
    } while ($grew && $pending !== []);

    return $ordered;
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

    $tiles = parseTileList($input['tiles'] ?? null, $gridSize);

    if ($tiles === null) {
        json_error('Provide between 1 and 400 valid tiles inside the grid.', 422);
        exit;
    }

    $pdo->beginTransaction();
    try {
        $lockStmt = $pdo->prepare('SELECT budget FROM cities WHERE id = :city_id FOR UPDATE');
        $lockStmt->execute(['city_id' => $cityId]);
        $lockedBudget = (float) $lockStmt->fetchColumn();

        // Resolve reachability under the lock so a concurrent unlock cannot
        // change what is adjacent halfway through.
        $ownedSet = loadUnlockedTileSet($pdo, $cityId);
        $buyable = reachableTilesInOrder($tiles, $ownedSet);

        if ($buyable === []) {
            $pdo->rollBack();
            json_error('None of the selected tiles touch your city. Select land next to what you already own.', 422);
            exit;
        }

        // Buy as many as the budget allows, in reachability order, so a partial
        // purchase still leaves a connected territory.
        $affordable = $tileUnlockCost > 0
            ? (int) floor($lockedBudget / $tileUnlockCost)
            : count($buyable);

        if ($affordable <= 0) {
            $pdo->rollBack();
            json_error('Not enough budget to unlock any of these tiles.', 422);
            exit;
        }

        $toBuy = array_slice($buyable, 0, $affordable);
        $totalCost = $tileUnlockCost * count($toBuy);

        $deduct = $pdo->prepare(
            'UPDATE cities SET budget = budget - :cost_deduct WHERE id = :city_id AND budget >= :cost_check'
        );
        $deduct->execute(['cost_deduct' => $totalCost, 'cost_check' => $totalCost, 'city_id' => $cityId]);

        if ($deduct->rowCount() === 0) {
            $pdo->rollBack();
            json_error('Not enough budget to unlock these tiles.', 422);
            exit;
        }

        $insert = $pdo->prepare('INSERT INTO city_tiles (city_id, tile_x, tile_y) VALUES (:city_id, :tile_x, :tile_y)');
        foreach ($toBuy as $tile) {
            $insert->execute(['city_id' => $cityId, 'tile_x' => $tile['x'], 'tile_y' => $tile['y']]);
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    $budgetStmt = $pdo->prepare('SELECT budget FROM cities WHERE id = :city_id');
    $budgetStmt->execute(['city_id' => $cityId]);
    $newBudget = (float) $budgetStmt->fetchColumn();

    $skipped = count($tiles) - count($toBuy);

    json_success([
        'budget' => $newBudget,
        'unlocked' => $toBuy,
        'unlocked_count' => count($toBuy),
        'skipped_count' => $skipped,
        'total_cost' => $totalCost,
    ], $skipped > 0
        ? 'Unlocked ' . count($toBuy) . ' tiles. ' . $skipped . ' could not be bought.'
        : 'Unlocked ' . count($toBuy) . ' tiles.');
} catch (Throwable $e) {
    error_log('Area unlock failed: ' . $e->getMessage());
    json_error('Unable to unlock this area.', 500);
}
