<?php

declare(strict_types=1);

/**
 * Building upgrade levels.
 *
 * Every structure is placed at level 1 and can be upgraded twice, to level 2 and
 * then level 3. Each level scales the building's economic contribution, and the
 * 3D scene draws a visibly larger and more developed model to match.
 *
 * This file is the single source of truth for that scaling — api/city.php (the
 * economy tick), api/upgrade-building.php and the removal endpoints all read the
 * same numbers, so a level can never be priced one way and paid out another.
 *
 * Roads are deliberately not upgradeable: they carry no income, capacity or
 * happiness, and their progression is the 2/4/6-lane variants in the build menu.
 */

const MAX_BUILDING_LEVEL = 3;

/**
 * Income and upkeep both rise with level, but income rises faster — upgrading
 * has to actually pay for itself or nobody would ever do it.
 */
const LEVEL_INCOME_MULTIPLIER = [1 => 1.0, 2 => 1.8, 3 => 3.0];
const LEVEL_UPKEEP_MULTIPLIER = [1 => 1.0, 2 => 1.5, 3 => 2.2];
const LEVEL_CAPACITY_MULTIPLIER = [1 => 1.0, 2 => 2.0, 3 => 3.2];
const LEVEL_HAPPINESS_MULTIPLIER = [1 => 1.0, 2 => 1.4, 3 => 1.8];

/** Cost of an upgrade, as a multiple of the building's base cost. */
const LEVEL_UPGRADE_COST_MULTIPLIER = [2 => 1.6, 3 => 2.8];

function clampBuildingLevel(int $level): int
{
    if ($level < 1) {
        return 1;
    }
    if ($level > MAX_BUILDING_LEVEL) {
        return MAX_BUILDING_LEVEL;
    }
    return $level;
}

function isUpgradableCategory(string $category): bool
{
    return $category !== 'road';
}

function levelIncome(float $baseIncome, int $level): float
{
    return $baseIncome * LEVEL_INCOME_MULTIPLIER[clampBuildingLevel($level)];
}

function levelUpkeep(float $baseUpkeep, int $level): float
{
    return $baseUpkeep * LEVEL_UPKEEP_MULTIPLIER[clampBuildingLevel($level)];
}

function levelCapacity(int $baseCapacity, int $level): int
{
    return (int) round($baseCapacity * LEVEL_CAPACITY_MULTIPLIER[clampBuildingLevel($level)]);
}

function levelHappiness(int $baseHappiness, int $level): int
{
    // Rounded away from zero so a negative effect (factories) also grows with level.
    $scaled = $baseHappiness * LEVEL_HAPPINESS_MULTIPLIER[clampBuildingLevel($level)];
    return (int) ($scaled < 0 ? floor($scaled) : ceil($scaled));
}

/**
 * What it costs to take a building from its current level to the next one.
 * Returns null when the building cannot be upgraded any further.
 */
function upgradeCostFor(float $baseCost, int $currentLevel): ?float
{
    $targetLevel = clampBuildingLevel($currentLevel) + 1;

    if ($targetLevel > MAX_BUILDING_LEVEL) {
        return null;
    }

    return round($baseCost * LEVEL_UPGRADE_COST_MULTIPLIER[$targetLevel], 2);
}

/**
 * Total refunded when a building is demolished: what was paid to place it plus
 * every upgrade since. Keeps place -> upgrade -> remove a break-even round trip.
 */
function refundValueFor(float $baseCost, int $currentLevel): float
{
    $refund = $baseCost;

    for ($level = 2; $level <= clampBuildingLevel($currentLevel); $level++) {
        $refund += $baseCost * LEVEL_UPGRADE_COST_MULTIPLIER[$level];
    }

    return round($refund, 2);
}

/**
 * Level-aware economic summary for one placed building. $row must carry the
 * building_types columns (income, upkeep, capacity, happiness_effect, category)
 * plus the placed level.
 */
function buildingLevelStats(array $row): array
{
    $level = clampBuildingLevel((int) ($row['level'] ?? 1));

    return [
        'level' => $level,
        'income' => levelIncome((float) $row['income'], $level),
        'upkeep' => levelUpkeep((float) $row['upkeep'], $level),
        'capacity' => levelCapacity((int) $row['capacity'], $level),
        'happiness_effect' => levelHappiness((int) $row['happiness_effect'], $level),
    ];
}
