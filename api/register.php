<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/response.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Method not allowed.', 405);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

if (!is_array($input)) {
    json_error('Invalid JSON body.', 400);
    exit;
}

$name = is_string($input['name'] ?? null) ? trim($input['name']) : '';
$email = is_string($input['email'] ?? null) ? trim($input['email']) : '';
$password = is_string($input['password'] ?? null) ? $input['password'] : '';

if ($name === '') {
    json_error('Name is required.', 422);
    exit;
}

if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    json_error('A valid email is required.', 422);
    exit;
}

if (strlen($password) < 6) {
    json_error('Password must be at least 6 characters.', 422);
    exit;
}

try {
    $pdo = getDbConnection();

    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
    $stmt->execute(['email' => $email]);

    if ($stmt->fetch() !== false) {
        json_error('This email is already registered.', 409);
        exit;
    }

    $passwordHash = password_hash($password, PASSWORD_DEFAULT);

    $stmt = $pdo->prepare(
        'INSERT INTO users (name, email, password_hash, created_at) VALUES (:name, :email, :password_hash, NOW())'
    );
    $stmt->execute([
        'name' => $name,
        'email' => $email,
        'password_hash' => $passwordHash,
    ]);

    $userId = (int) $pdo->lastInsertId();

    json_success([
        'id' => $userId,
        'name' => $name,
    ], 'Registration successful.');
} catch (Throwable $e) {
    error_log('Registration failed: ' . $e->getMessage());
    json_error('Registration failed. Please try again later.', 500);
}
