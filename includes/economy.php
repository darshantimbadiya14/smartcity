<?php

declare(strict_types=1);

/**
 * City economy: tax, migration and income.
 *
 * The model is a loop, not a set of independent numbers:
 *
 *   buildings -> housing capacity, income, upkeep, happiness
 *   tax rate + happiness -> how much of that capacity people actually want to fill
 *   population -> tax revenue
 *   income + tax - upkeep -> budget
 *   all of the above -> score
 *
 * Population is the slow part on purpose: residents move toward the target a
 * fraction at a time, so raising taxes empties the city gradually instead of
 * snapping, and cutting them refills it gradually too.
 *
 * Every figure here is per economy tick (tick_interval_seconds in game_config).
 */

const TAX_RATE_MIN = 0.0;
const TAX_RATE_MAX = 0.30;
const TAX_RATE_DEFAULT = 0.10;

/** At or below this rate the city carries no attractiveness penalty. */
const TAX_RATE_NEUTRAL = 0.10;

/** Taxable economic output produced by one resident per tick. */
const CITIZEN_OUTPUT = 2.2;

/** Share of the gap between current and target population closed each tick. */
const POPULATION_SETTLE_RATE = 0.12;

/**
 * Ceiling on how many ticks of profit can accrue while a player is away. Without
 * it a day offline pays out ~1400 ticks at once, which is what made budgets run
 * away into the millions.
 */
const MAX_OFFLINE_TICKS = 60.0;

function clampTaxRate(float $rate): float
{
    if ($rate < TAX_RATE_MIN) {
        return TAX_RATE_MIN;
    }
    if ($rate > TAX_RATE_MAX) {
        return TAX_RATE_MAX;
    }
    return round($rate, 4);
}

/**
 * How appealing the tax rate makes the city, as a multiplier on occupancy.
 * Cheap living is a mild draw; heavy taxation drives people out sharply.
 */
function taxAppeal(float $taxRate): float
{
    $rate = clampTaxRate($taxRate);

    $appeal = $rate <= TAX_RATE_NEUTRAL
        ? 1.0 + (TAX_RATE_NEUTRAL - $rate) * 1.5
        : 1.0 - ($rate - TAX_RATE_NEUTRAL) * 3.2;

    return max(0.1, min(1.2, $appeal));
}

/** Miserable cities lose residents even when tax is low. */
function happinessAppeal(int $happiness): float
{
    $normalised = max(0, min(100, $happiness)) / 100;
    return 0.4 + $normalised * 0.75;
}

/**
 * Fraction of housing capacity people actually want to occupy, 0-1.
 */
function targetOccupancy(float $taxRate, int $happiness): float
{
    $occupancy = taxAppeal($taxRate) * happinessAppeal($happiness);
    return max(0.05, min(1.0, $occupancy));
}

function targetPopulation(int $capacity, float $taxRate, int $happiness): int
{
    if ($capacity <= 0) {
        return 0;
    }
    return (int) round($capacity * targetOccupancy($taxRate, $happiness));
}

/**
 * Moves population toward its target over the given number of ticks. Uses an
 * exponential approach so several elapsed ticks compound correctly rather than
 * jumping straight to the target.
 */
function settlePopulation(int $current, int $target, float $ticks): int
{
    if ($ticks <= 0 || $current === $target) {
        return max(0, $current);
    }

    $closed = 1 - pow(1 - POPULATION_SETTLE_RATE, $ticks);
    $moved = $current + ($target - $current) * $closed;

    // Always creep at least one resident so a small gap cannot stall forever.
    if ($target > $current) {
        $moved = max($moved, min((float) $target, $current + 1));
    } elseif ($target < $current) {
        $moved = min($moved, max((float) $target, $current - 1));
    }

    return max(0, (int) round($moved));
}

function taxRevenuePerTick(int $population, float $taxRate): float
{
    return $population * CITIZEN_OUTPUT * clampTaxRate($taxRate);
}

/**
 * Plain-language description of what the current rate is doing, shown in the
 * player's city settings so the trade-off is legible.
 */
function taxRateLabel(float $taxRate): string
{
    $rate = clampTaxRate($taxRate);

    if ($rate <= 0.04) {
        return 'Very low — the city fills up fast but collects almost nothing.';
    }
    if ($rate <= 0.10) {
        return 'Low — steady growth with modest revenue.';
    }
    if ($rate <= 0.16) {
        return 'Balanced — good revenue, mild pressure on new arrivals.';
    }
    if ($rate <= 0.23) {
        return 'High — strong revenue, but residents start leaving.';
    }
    return 'Punishing — the city empties out quickly.';
}
