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

$currentPassword = is_string($input['current_password'] ?? null) ? $input['current_password'] : '';
$newPassword = is_string($input['new_password'] ?? null) ? $input['new_password'] : '';

if ($currentPassword === '') {
    json_error('Enter your current password.', 422);
    exit;
}

if (strlen($newPassword) < 6) {
    json_error('New password must be at least 6 characters.', 422);
    exit;
}

if ($newPassword === $currentPassword) {
    json_error('The new password must be different from your current one.', 422);
    exit;
}

try {
    $pdo = getDbConnection();

    $stmt = $pdo->prepare('SELECT password_hash FROM users WHERE id = :id LIMIT 1');
    $stmt->execute(['id' => $userId]);
    $user = $stmt->fetch();

    // Deliberately 422, not 401: the session is perfectly valid, it is the typed
    // password that is wrong. A 401 here would be read as a dead session by
    // assets/js/api-client.js and would sign the player out mid-form.
    if ($user === false || !password_verify($currentPassword, $user['password_hash'])) {
        json_error('Your current password is not correct.', 422);
        exit;
    }

    $update = $pdo->prepare('UPDATE users SET password_hash = :hash WHERE id = :id');
    $update->execute(['hash' => password_hash($newPassword, PASSWORD_DEFAULT), 'id' => $userId]);

    // Changing a password should invalidate anything riding on the old session id.
    start_session();
    session_regenerate_id(true);

    json_success([], 'Password changed.');
} catch (Throwable $e) {
    error_log('Password change failed: ' . $e->getMessage());
    json_error('Unable to change your password.', 500);
}
