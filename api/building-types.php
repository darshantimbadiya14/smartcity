<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/response.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_error('Method not allowed.', 405);
    exit;
}

try {
    $pdo = getDbConnection();

    $stmt = $pdo->query('SELECT * FROM building_types ORDER BY id ASC');
    $buildingTypes = $stmt->fetchAll();

    json_success([
        'building_types' => $buildingTypes,
    ]);
} catch (Throwable $e) {
    error_log('Fetching building types failed: ' . $e->getMessage());
    json_error('Unable to fetch building types.', 500);
}
