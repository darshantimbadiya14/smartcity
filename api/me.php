<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/response.php';
require_once __DIR__ . '/../includes/session.php';

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

    $stmt = $pdo->prepare('SELECT id, name, email, is_admin FROM users WHERE id = :id LIMIT 1');
    $stmt->execute(['id' => $userId]);
    $user = $stmt->fetch();

    if ($user === false) {
        json_error('Not authenticated.', 401);
        exit;
    }

    json_success([
        'id' => (int) $user['id'],
        'name' => $user['name'],
        'email' => $user['email'],
        'is_admin' => (int) $user['is_admin'] === 1,
    ]);
} catch (Throwable $e) {
    error_log('Fetching current user failed: ' . $e->getMessage());
    json_error('Unable to fetch user.', 500);
}
