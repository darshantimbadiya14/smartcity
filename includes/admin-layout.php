<?php

declare(strict_types=1);

require_once __DIR__ . '/admin.php';
require_once __DIR__ . '/assets.php';

/**
 * Renders the opening chrome for an admin page.
 * $adminUser is the row returned by require_admin().
 */
function admin_layout_start(string $pageTitle, string $activeNav, array $adminUser): void
{
    $navItems = [
        'dashboard' => ['index.php', 'Dashboard', '📊'],
        'users' => ['users.php', 'Users', '👥'],
        'cities' => ['cities.php', 'Cities', '🏙️'],
        'buildings' => ['building-types.php', 'Building Types', '🏗️'],
        'config' => ['config.php', 'Game Config', '⚙️'],
    ];

    $flash = admin_take_flash();

    ?><!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= admin_e($pageTitle) ?> — Smart City Admin</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700&family=Quicksand:wght@500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="../<?= asset_url('assets/css/style.css') ?>">
    <link rel="stylesheet" href="../<?= asset_url('assets/css/admin.css') ?>">
</head>
<body class="admin-body">

    <aside class="admin-sidebar">
        <a class="admin-brand" href="index.php">
            <span class="admin-brand-mark">🏙️</span>
            <span>
                <strong>Smart City</strong>
                <em>Admin Panel</em>
            </span>
        </a>

        <nav class="admin-nav">
            <?php foreach ($navItems as $key => [$href, $label, $icon]): ?>
                <a class="admin-nav-link<?= $activeNav === $key ? ' is-active' : '' ?>" href="<?= admin_e($href) ?>">
                    <span class="admin-nav-icon"><?= $icon ?></span><?= admin_e($label) ?>
                </a>
            <?php endforeach; ?>
        </nav>

        <div class="admin-sidebar-footer">
            <a class="admin-nav-link" href="../index.php"><span class="admin-nav-icon">🌐</span>View Site</a>
            <a class="admin-nav-link" href="../game.php"><span class="admin-nav-icon">🎮</span>Play Game</a>
        </div>
    </aside>

    <div class="admin-main">
        <header class="admin-topbar">
            <h1 class="admin-page-title"><?= admin_e($pageTitle) ?></h1>
            <div class="admin-topbar-user">
                <span class="admin-user-meta">
                    <strong><?= admin_e($adminUser['name']) ?></strong>
                    <em><?= admin_e($adminUser['email']) ?></em>
                </span>
                <a class="admin-btn admin-btn-ghost" href="logout.php">Log out</a>
            </div>
        </header>

        <div class="admin-content">
            <?php if ($flash !== null): ?>
                <div class="admin-flash admin-flash-<?= admin_e($flash['type']) ?>">
                    <?= admin_e($flash['message']) ?>
                </div>
            <?php endif; ?>
<?php
}

function admin_layout_end(): void
{
    ?>
        </div>
    </div>

</body>
</html>
<?php
}
