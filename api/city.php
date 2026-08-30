<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/response.php';
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/levels.php';
require_once __DIR__ . '/../includes/economy.php';

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

    $config = loadGameConfigValues($pdo, ['starting_budget', 'grid_size', 'starting_unlock_radius', 'tile_unlock_cost', 'tax_rate']);
    $gridSize = (int) ($config['grid_size'] ?? 20);
    $tileUnlockCost = (float) ($config['tile_unlock_cost'] ?? 0);
    $defaultTaxRate = clampTaxRate((float) ($config['tax_rate'] ?? TAX_RATE_DEFAULT));

    $stmt = $pdo->prepare('SELECT id FROM cities WHERE user_id = :user_id LIMIT 1');
    $stmt->execute(['user_id' => $userId]);
    $existing = $stmt->fetch();

    if ($existing === false) {
        $startingBudget = (float) ($config['starting_budget'] ?? 50000);
        $radius = (int) ($config['starting_unlock_radius'] ?? 2);
        $center = intdiv($gridSize, 2);

        $pdo->beginTransaction();
        try {
            $insertCity = $pdo->prepare(
                'INSERT INTO cities (user_id, name, budget, tax_rate) VALUES (:user_id, :name, :budget, :tax_rate)'
            );
            $insertCity->execute([
                'user_id' => $userId,
                'name' => 'My City',
                'budget' => $startingBudget,
                'tax_rate' => $defaultTaxRate,
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

    // ---- Economy tick ----
    $tickConfig = loadGameConfigValues($pdo, ['tick_interval_seconds', 'happiness_base']);
    $tickIntervalSeconds = (float) ($tickConfig['tick_interval_seconds'] ?? 60);
    $happinessBase = (int) ($tickConfig['happiness_base'] ?? 50);

    $pdo->beginTransaction();
    try {
        $tickCityStmt = $pdo->prepare(
            'SELECT population, tax_rate, TIMESTAMPDIFF(SECOND, last_ticked_at, NOW()) AS elapsed_seconds
             FROM cities WHERE id = :id FOR UPDATE'
        );
        $tickCityStmt->execute(['id' => $cityId]);
        $tickCity = $tickCityStmt->fetch();

        $currentPopulation = (int) $tickCity['population'];
        $taxRate = clampTaxRate((float) $tickCity['tax_rate']);
        $elapsedSeconds = max(0, (int) $tickCity['elapsed_seconds']);

        $econStmt = $pdo->prepare(
            'SELECT pb.level, bt.code, bt.category, bt.income, bt.upkeep, bt.capacity, bt.happiness_effect
             FROM placed_buildings pb
             INNER JOIN building_types bt ON bt.id = pb.building_type_id
             WHERE pb.city_id = :city_id'
        );
        $econStmt->execute(['city_id' => $cityId]);
        $econRows = $econStmt->fetchAll();

        $buildingIncomeSum = 0.0;
        $totalUpkeep = 0.0;
        $totalHappinessEffect = 0;
        $parkCount = 0;
        $buildingCount = count($econRows);
        $housingCapacity = 0;

        foreach ($econRows as $row) {
            // Every figure is scaled by the building's upgrade level.
            $stats = buildingLevelStats($row);

            $buildingIncomeSum += $stats['income'];
            $totalUpkeep += $stats['upkeep'];
            $totalHappinessEffect += $stats['happiness_effect'];

            if ($row['category'] === 'residential') {
                $housingCapacity += $stats['capacity'];
            }
            if ($row['code'] === 'park') {
                $parkCount++;
            }
        }

        $newHappiness = max(0, min(100, $happinessBase + $totalHappinessEffect));

        // How many ticks of economy to apply. Capped so a long absence cannot pay
        // out hundreds of ticks of profit in one go.
        $rawTicks = $tickIntervalSeconds > 0 ? ($elapsedSeconds / $tickIntervalSeconds) : 0.0;
        $ticksElapsed = min($rawTicks, MAX_OFFLINE_TICKS);

        // Residents move toward the level of occupancy the tax rate and happiness
        // justify, a fraction of the gap per tick — never instantly.
        $populationTarget = targetPopulation($housingCapacity, $taxRate, $newHappiness);
        $newPopulation = settlePopulation($currentPopulation, $populationTarget, $ticksElapsed);

        // Nobody can live in housing that no longer exists, so demolishing homes
        // takes effect at once rather than draining away over several ticks.
        $newPopulation = min($newPopulation, $housingCapacity);

        // Tax is charged on the residents actually living there. Averaged over the
        // step so a large migration does not over- or under-collect.
        $averagePopulation = (int) round(($currentPopulation + $newPopulation) / 2);
        $taxRevenue = taxRevenuePerTick($averagePopulation, $taxRate);

        $budgetDelta = ($buildingIncomeSum + $taxRevenue - $totalUpkeep) * $ticksElapsed;

        $infrastructureScore = min(100, $buildingCount * 4);
        $populationScore = min(100, $newPopulation / 3);
        $economyScore = min(100, $buildingIncomeSum / 8);
        $environmentScore = min(100, $parkCount * 20);
        $happinessScore = $newHappiness;

        $weightedScore = ($infrastructureScore * 0.30)
            + ($populationScore * 0.20)
            + ($economyScore * 0.25)
            + ($environmentScore * 0.10)
            + ($happinessScore * 0.15);

        $score = (int) round($weightedScore * 10);
        $score = max(0, min(1000, $score));

        $tickUpdateStmt = $pdo->prepare(
            'UPDATE cities
             SET budget = GREATEST(0, budget + :budget_delta),
                 population = :population,
                 happiness = :happiness,
                 score = :score,
                 last_ticked_at = NOW()
             WHERE id = :city_id'
        );
        $tickUpdateStmt->execute([
            'budget_delta' => $budgetDelta,
            'population' => $newPopulation,
            'happiness' => $newHappiness,
            'score' => $score,
            'city_id' => $cityId,
        ]);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    $cityStmt = $pdo->prepare('SELECT id, name, budget, tax_rate, population, happiness, score FROM cities WHERE id = :id');
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

    $buildingsStmt = $pdo->prepare(
        'SELECT pb.tile_x, pb.tile_y, pb.building_type_id, pb.level, pb.rotation,
                bt.code, bt.model_key, bt.name, bt.category, bt.cost, bt.tile_width, bt.tile_height
         FROM placed_buildings pb
         INNER JOIN building_types bt ON bt.id = pb.building_type_id
         WHERE pb.city_id = :city_id'
    );
    $buildingsStmt->execute(['city_id' => $cityId]);
    $placedBuildings = array_map(
        static function (array $row): array {
            $level = clampBuildingLevel((int) $row['level']);
            $upgradable = isUpgradableCategory((string) $row['category']);
            $nextCost = $upgradable ? upgradeCostFor((float) $row['cost'], $level) : null;

            return [
                'tile_x' => (int) $row['tile_x'],
                'tile_y' => (int) $row['tile_y'],
                'building_type_id' => (int) $row['building_type_id'],
                'level' => $level,
                'rotation' => (int) $row['rotation'],
                'code' => $row['code'],
                'model_key' => $row['model_key'],
                'name' => $row['name'],
                'category' => $row['category'],
                'tile_width' => (int) $row['tile_width'],
                'tile_height' => (int) $row['tile_height'],
                'upgradable' => $upgradable,
                'next_upgrade_cost' => $nextCost,
                'refund_value' => refundValueFor((float) $row['cost'], $level),
            ];
        },
        $buildingsStmt->fetchAll()
    );

    json_success([
        'city' => [
            'id' => (int) $city['id'],
            'name' => $city['name'],
            'budget' => (float) $city['budget'],
            'population' => (int) $city['population'],
            'happiness' => (int) $city['happiness'],
            'score' => (int) $city['score'],
            'tax_rate' => (float) $city['tax_rate'],
        ],
        // Everything the settings panel needs to explain the economy to the player.
        'economy' => [
            'tax_rate' => $taxRate,
            'tax_rate_min' => TAX_RATE_MIN,
            'tax_rate_max' => TAX_RATE_MAX,
            'tax_label' => taxRateLabel($taxRate),
            'housing_capacity' => $housingCapacity,
            'population_target' => $populationTarget,
            'occupancy' => round(targetOccupancy($taxRate, $newHappiness), 4),
            'building_income' => round($buildingIncomeSum, 2),
            'tax_revenue' => round(taxRevenuePerTick($newPopulation, $taxRate), 2),
            'upkeep' => round($totalUpkeep, 2),
            'net_per_tick' => round($buildingIncomeSum + taxRevenuePerTick($newPopulation, $taxRate) - $totalUpkeep, 2),
            'tick_interval_seconds' => $tickIntervalSeconds,
        ],
        'unlocked_tiles' => $unlockedTiles,
        'placed_buildings' => $placedBuildings,
        'tile_unlock_cost' => $tileUnlockCost,
        'grid_size' => $gridSize,
        'max_building_level' => MAX_BUILDING_LEVEL,
    ]);
} catch (Throwable $e) {
    error_log('Fetching city failed: ' . $e->getMessage());
    json_error('Unable to load city.', 500);
}
