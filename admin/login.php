<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/admin.php';
require_once __DIR__ . '/../includes/assets.php';

$errorMessage = '';
$emailValue = '';

try {
    $pdo = getDbConnection();
} catch (Throwable $e) {
    error_log('Admin login DB connection failed: ' . $e->getMessage());
    $pdo = null;
    $errorMessage = 'The database is unavailable right now. Please try again later.';
}

// Already signed in as an admin? Skip straight to the dashboard.
if ($pdo !== null && current_admin($pdo) !== null) {
    header('Location: index.php');
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $pdo !== null) {
    $emailValue = is_string($_POST['email'] ?? null) ? trim($_POST['email']) : '';
    $password = is_string($_POST['password'] ?? null) ? $_POST['password'] : '';

    if (!admin_verify_csrf()) {
        $errorMessage = 'Your session expired. Please try again.';
    } elseif ($emailValue === '' || $password === '') {
        $errorMessage = 'Enter both your email and password.';
    } else {
        try {
            $stmt = $pdo->prepare('SELECT id, password_hash, is_admin FROM users WHERE email = :email LIMIT 1');
            $stmt->execute(['email' => $emailValue]);
            $user = $stmt->fetch();

            if ($user === false || !password_verify($password, $user['password_hash'])) {
                // Same message either way so this cannot be used to enumerate accounts.
                $errorMessage = 'Invalid email or password.';
            } elseif ((int) $user['is_admin'] !== 1) {
                $errorMessage = 'Invalid email or password.';
            } else {
                start_session();
                session_regenerate_id(true);
                $_SESSION['user_id'] = (int) $user['id'];

                header('Location: index.php');
                exit;
            }
        } catch (Throwable $e) {
            error_log('Admin login failed: ' . $e->getMessage());
            $errorMessage = 'Login failed. Please try again later.';
        }
    }
}

if ($errorMessage === '') {
    $reason = $_GET['reason'] ?? '';
    if ($reason === 'forbidden') {
        $errorMessage = 'That account does not have admin access.';
    } elseif ($reason === 'login') {
        $errorMessage = 'Please sign in with an admin account to continue.';
    } elseif ($reason === 'loggedout') {
        $errorMessage = '';
    }
}

$loggedOut = ($_GET['reason'] ?? '') === 'loggedout';

?><!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Login — Smart City Simulator</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700&family=Quicksand:wght@500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="../<?= asset_url('assets/css/style.css') ?>">
    <link rel="stylesheet" href="../<?= asset_url('assets/css/admin.css') ?>">
</head>
<body class="admin-login-body">

    <div class="auth-card">
        <a class="auth-back" href="../index.php">&larr; Back to home</a>

        <span class="admin-login-badge">Admin Access</span>
        <h1 class="auth-title">Smart City Simulator</h1>
        <p class="auth-subtitle">Sign in to manage players, cities and game settings.</p>

        <?php if ($loggedOut): ?>
            <div class="form-error success visible">You have been signed out.</div>
        <?php elseif ($errorMessage !== ''): ?>
            <div class="form-error visible"><?= admin_e($errorMessage) ?></div>
        <?php endif; ?>

        <form class="auth-form" method="post" action="login.php">
            <?= admin_csrf_field() ?>
            <div class="field-group">
                <label for="admin-email">Email</label>
                <input type="email" id="admin-email" name="email" autocomplete="email"
                       value="<?= admin_e($emailValue) ?>" required autofocus>
            </div>
            <div class="field-group">
                <label for="admin-password">Password</label>
                <input type="password" id="admin-password" name="password" autocomplete="current-password" required>
            </div>
            <button type="submit" class="btn-primary">Log In</button>
        </form>
    </div>

</body>
</html>
