<?php

declare(strict_types=1);

require_once __DIR__ . '/session.php';

/**
 * Returns the logged-in admin's row, or null when the current visitor is not
 * a signed-in admin. Never redirects — use require_admin() for guarding pages.
 */
function current_admin(PDO $pdo): ?array
{
    $userId = current_user_id();

    if ($userId === null) {
        return null;
    }

    $stmt = $pdo->prepare('SELECT id, name, email, is_admin FROM users WHERE id = :id LIMIT 1');
    $stmt->execute(['id' => $userId]);
    $user = $stmt->fetch();

    if ($user === false || (int) $user['is_admin'] !== 1) {
        return null;
    }

    return $user;
}

/**
 * Guards an admin page. Non-admins are sent to the admin login screen with a
 * reason, so they always land somewhere useful instead of a dead-end error page.
 */
function require_admin(PDO $pdo): array
{
    $admin = current_admin($pdo);

    if ($admin === null) {
        $reason = current_user_id() === null ? 'login' : 'forbidden';
        header('Location: login.php?reason=' . $reason);
        exit;
    }

    return $admin;
}

// ---- CSRF protection for admin state-changing actions ----

function admin_csrf_token(): string
{
    start_session();

    if (empty($_SESSION['admin_csrf_token'])) {
        $_SESSION['admin_csrf_token'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['admin_csrf_token'];
}

function admin_csrf_field(): string
{
    return '<input type="hidden" name="csrf_token" value="'
        . htmlspecialchars(admin_csrf_token(), ENT_QUOTES, 'UTF-8') . '">';
}

function admin_verify_csrf(): bool
{
    start_session();

    $submitted = $_POST['csrf_token'] ?? '';
    $expected = $_SESSION['admin_csrf_token'] ?? '';

    return is_string($submitted)
        && is_string($expected)
        && $expected !== ''
        && hash_equals($expected, $submitted);
}

// ---- Small view helpers shared by the admin pages ----

function admin_e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

function admin_money(float $amount): string
{
    return '₹' . number_format($amount, 2);
}

/**
 * Stores a one-shot notice shown on the next admin page render.
 */
function admin_flash(string $message, string $type = 'success'): void
{
    start_session();
    $_SESSION['admin_flash'] = ['message' => $message, 'type' => $type];
}

function admin_take_flash(): ?array
{
    start_session();

    if (!isset($_SESSION['admin_flash'])) {
        return null;
    }

    $flash = $_SESSION['admin_flash'];
    unset($_SESSION['admin_flash']);

    return is_array($flash) ? $flash : null;
}
