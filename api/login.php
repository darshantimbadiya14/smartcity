<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/response.php';
require_once __DIR__ . '/../includes/session.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Method not allowed.', 405);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

if (!is_array($input)) {
    json_error('Invalid JSON body.', 400);
    exit;
}

$email = is_string($input['email'] ?? null) ? trim($input['email']) : '';
$password = is_string($input['password'] ?? null) ? $input['password'] : '';

if ($email === '' || $password === '') {
    json_error('Invalid email or password.', 401);
    exit;
}

try {
    $pdo = getDbConnection();

    $stmt = $pdo->prepare('SELECT id, name, password_hash, is_admin FROM users WHERE email = :email LIMIT 1');
    $stmt->execute(['email' => $email]);
    $user = $stmt->fetch();

    if ($user === false || !password_verify($password, $user['password_hash'])) {
        json_error('Invalid email or password.', 401);
        exit;
    }

    start_session();
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int) $user['id'];

    json_success([
        'id' => (int) $user['id'],
        'name' => $user['name'],
        // Lets the front end send admins straight to the admin panel instead of
        // dropping them into the game and auto-creating an empty city for them.
        'is_admin' => (int) $user['is_admin'] === 1,
    ], 'Login successful.');
} catch (Throwable $e) {
    error_log('Login failed: ' . $e->getMessage());
    json_error('Login failed. Please try again later.', 500);
}
