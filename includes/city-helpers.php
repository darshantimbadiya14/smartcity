<?php

declare(strict_types=1);

/**
 * Shared city geometry + config helpers used by the area (multi-tile) endpoints.
 *
 * The single-tile endpoints (place-building.php, remove-building.php,
 * land-unlock.php) each carry their own copies from before this file existed.
 * Everything here is guarded with function_exists() so including this alongside
 * one of those files can never fatal on a redeclaration.
 */

if (!function_exists('loadGameConfigValues')) {
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
}

if (!function_exists('footprintTiles')) {
    /**
     * Tiles covered by a building anchored at (anchorX, anchorY). Rotation swaps
     * the effective width/height at 90 and 270 degrees.
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
}

if (!function_exists('tileKeySet')) {
    /**
     * Turns a list of ['x'=>int,'y'=>int] into an "x,y" => true lookup set.
     */
    function tileKeySet(array $tiles): array
    {
        $set = [];
        foreach ($tiles as $tile) {
            $set[$tile['x'] . ',' . $tile['y']] = true;
        }

        return $set;
    }
}

if (!function_exists('parseTileList')) {
    /**
     * Validates the `tiles` payload shared by every area endpoint. Returns a
     * de-duplicated list of in-bounds tiles, or null when the input is unusable.
     *
     * $maxTiles caps how much work one request can ask for.
     */
    function parseTileList(mixed $raw, int $gridSize, int $maxTiles = 400): ?array
    {
        if (!is_array($raw) || $raw === []) {
            return null;
        }

        if (count($raw) > $maxTiles) {
            return null;
        }

        $seen = [];
        $tiles = [];

        foreach ($raw as $entry) {
            if (!is_array($entry)) {
                return null;
            }

            $x = filter_var($entry['x'] ?? null, FILTER_VALIDATE_INT);
            $y = filter_var($entry['y'] ?? null, FILTER_VALIDATE_INT);

            if ($x === false || $x === null || $y === false || $y === null) {
                return null;
            }

            if ($x < 0 || $x >= $gridSize || $y < 0 || $y >= $gridSize) {
                return null;
            }

            $key = $x . ',' . $y;
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $tiles[] = ['x' => $x, 'y' => $y];
        }

        return $tiles === [] ? null : $tiles;
    }
}

if (!function_exists('loadUnlockedTileSet')) {
    function loadUnlockedTileSet(PDO $pdo, int $cityId): array
    {
        $stmt = $pdo->prepare('SELECT tile_x, tile_y FROM city_tiles WHERE city_id = :city_id');
        $stmt->execute(['city_id' => $cityId]);

        $set = [];
        foreach ($stmt->fetchAll() as $row) {
            $set[$row['tile_x'] . ',' . $row['tile_y']] = true;
        }

        return $set;
    }
}

if (!function_exists('loadOccupiedTileMap')) {
    /**
     * Maps every tile covered by a building to that building's row, so callers
     * can resolve a clicked tile to the structure standing on it.
     *
     * Returns ["x,y" => row] where row includes the placed_buildings id, its
     * anchor coordinates and the joined building_types columns.
     */
    function loadOccupiedTileMap(PDO $pdo, int $cityId): array
    {
        $stmt = $pdo->prepare(
            'SELECT pb.id, pb.tile_x, pb.tile_y, pb.rotation, pb.building_type_id, pb.level,
                    bt.code, bt.name, bt.model_key, bt.cost, bt.capacity, bt.category,
                    bt.tile_width, bt.tile_height
             FROM placed_buildings pb
             INNER JOIN building_types bt ON bt.id = pb.building_type_id
             WHERE pb.city_id = :city_id'
        );
        $stmt->execute(['city_id' => $cityId]);

        $map = [];
        foreach ($stmt->fetchAll() as $row) {
            $footprint = footprintTiles(
                (int) $row['tile_x'],
                (int) $row['tile_y'],
                (int) $row['tile_width'],
                (int) $row['tile_height'],
                (int) $row['rotation']
            );
            foreach ($footprint as $tile) {
                $map[$tile['x'] . ',' . $tile['y']] = $row;
            }
        }

        return $map;
    }
}
