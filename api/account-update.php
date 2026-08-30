<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/response.php';
require_once __DIR__ . '/../includes/session.php';

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

$name = is_string($input['name'] ?? null) ? trim($input['name']) : '';
$email = is_string($input['email'] ?? null) ? trim($input['email']) : '';

if ($name === '') {
    json_error('Name is required.', 422);
    exit;
}

if (mb_strlen($name) > 100) {
    json_error('Name must be 100 characters or fewer.', 422);
    exit;
}

if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    json_error('A valid email is required.', 422);
    exit;
}

if (mb_strlen($email) > 150) {
    json_error('Email must be 150 characters or fewer.', 422);
    exit;
}

try {
    $pdo = getDbConnection();

    // Email is unique — make sure it is not already taken by somebody else.
    $clash = $pdo->prepare('SELECT id FROM users WHERE email = :email AND id <> :id LIMIT 1');
    $clash->execute(['email' => $email, 'id' => $userId]);

    if ($clash->fetch() !== false) {
        json_error('That email is already registered to another account.', 409);
        exit;
    }

    $update = $pdo->prepare('UPDATE users SET name = :name, email = :email WHERE id = :id');
    $update->execute(['name' => $name, 'email' => $email, 'id' => $userId]);

    json_success([
        'id' => $userId,
        'name' => $name,
        'email' => $email,
    ], 'Profile updated.');
} catch (Throwable $e) {
    error_log('Account update failed: ' . $e->getMessage());
    json_error('Unable to update your profile.', 500);
}
