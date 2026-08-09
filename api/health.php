<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';

header('Content-Type: application/json');

try {
    $pdo = getDbConnection();
    $pdo->query('SELECT 1');

    http_response_code(200);
    echo json_encode(['status' => 'ok', 'db' => 'connected']);
} catch (Throwable $e) {
    error_log('Health check failed: ' . $e->getMessage());

    http_response_code(503);
    echo json_encode(['status' => 'error', 'db' => 'disconnected']);
}
