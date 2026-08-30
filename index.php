<?php

declare(strict_types=1);

require_once __DIR__ . '/includes/session.php';
require_once __DIR__ . '/includes/db.php';
require_once __DIR__ . '/includes/assets.php';

$currentUser = null;

try {
    $userId = current_user_id();

    if ($userId !== null) {
        $pdo = getDbConnection();
        $stmt = $pdo->prepare('SELECT name, is_admin FROM users WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $userId]);
        $found = $stmt->fetch();

        if ($found !== false) {
            $currentUser = $found;
        }
    }
} catch (Throwable $e) {
    // The landing page must render even if the database is unreachable.
    error_log('Landing page session lookup failed: ' . $e->getMessage());
}

$stats = ['cities' => 0, 'buildings' => 0, 'population' => 0];

try {
    $pdo = $pdo ?? getDbConnection();
    $stats['cities'] = (int) $pdo->query('SELECT COUNT(*) FROM cities')->fetchColumn();
    $stats['buildings'] = (int) $pdo->query('SELECT COUNT(*) FROM placed_buildings')->fetchColumn();
    $stats['population'] = (int) $pdo->query('SELECT COALESCE(SUM(population), 0) FROM cities')->fetchColumn();
} catch (Throwable $e) {
    error_log('Landing page stats lookup failed: ' . $e->getMessage());
}

?><!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Smart City Simulator</title>
    <meta name="description" content="Build, grow, and manage your own city — plan roads, zone districts, and climb the leaderboard.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700&family=Quicksand:wght@500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="<?= asset_url('assets/css/style.css') ?>">
</head>
<body class="landing-body">

    <header class="landing-nav">
        <a class="landing-brand" href="index.php">🏙️ Smart City</a>
        <nav class="landing-nav-links">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
        </nav>
        <div class="landing-nav-actions">
            <?php if ($currentUser !== null): ?>
                <?php if ((int) $currentUser['is_admin'] === 1): ?>
                    <a class="landing-btn landing-btn-ghost" href="admin/index.php">Admin Panel</a>
                <?php endif; ?>
                <a class="landing-btn landing-btn-primary" href="game.php">Continue Playing</a>
            <?php else: ?>
                <a class="landing-btn landing-btn-ghost" href="game.php?auth=login">Log In</a>
                <a class="landing-btn landing-btn-primary" href="game.php?auth=register">Sign Up</a>
            <?php endif; ?>
        </div>
    </header>

    <main>
        <section class="landing-hero">
            <div class="landing-hero-copy">
                <span class="landing-eyebrow">City building, right in your browser</span>
                <h1 class="landing-title">Build the city<br>you have always wanted.</h1>
                <p class="landing-lede">
                    Claim land, lay out roads, zone neighbourhoods and watch your population grow.
                    Every building you place changes your budget, happiness and score in real time.
                </p>

                <div class="landing-cta-row">
                    <?php if ($currentUser !== null): ?>
                        <a class="landing-btn landing-btn-primary landing-btn-lg" href="game.php">
                            Continue as <?= htmlspecialchars($currentUser['name'], ENT_QUOTES, 'UTF-8') ?>
                        </a>
                        <a class="landing-btn landing-btn-outline landing-btn-lg" href="game.php?auth=login">Switch account</a>
                    <?php else: ?>
                        <a class="landing-btn landing-btn-primary landing-btn-lg" href="game.php?auth=register">Create New Account</a>
                        <a class="landing-btn landing-btn-outline landing-btn-lg" href="game.php?auth=login">Log In</a>
                    <?php endif; ?>
                </div>

                <dl class="landing-stats">
                    <div class="landing-stat">
                        <dt>Cities built</dt>
                        <dd><?= number_format($stats['cities']) ?></dd>
                    </div>
                    <div class="landing-stat">
                        <dt>Structures placed</dt>
                        <dd><?= number_format($stats['buildings']) ?></dd>
                    </div>
                    <div class="landing-stat">
                        <dt>Citizens housed</dt>
                        <dd><?= number_format($stats['population']) ?></dd>
                    </div>
                </dl>
            </div>

            <div class="landing-hero-art" aria-hidden="true">
                <div class="landing-scene">
                    <div class="landing-tile landing-tile-a"></div>
                    <div class="landing-tile landing-tile-b"></div>
                    <div class="landing-tile landing-tile-c"></div>
                    <div class="landing-building landing-building-1"></div>
                    <div class="landing-building landing-building-2"></div>
                    <div class="landing-building landing-building-3"></div>
                    <div class="landing-building landing-building-4"></div>
                    <div class="landing-tree landing-tree-1"></div>
                    <div class="landing-tree landing-tree-2"></div>
                </div>
            </div>
        </section>

        <section class="landing-section" id="features">
            <h2 class="landing-section-title">Everything you need to run a city</h2>
            <div class="landing-grid">
                <article class="landing-card">
                    <span class="landing-card-icon">🏗️</span>
                    <h3>14 building types</h3>
                    <p>Houses, apartments, shops, cafes, offices, factories, schools, hospitals, parks and a stadium — each with its own economy.</p>
                </article>
                <article class="landing-card">
                    <span class="landing-card-icon">🛣️</span>
                    <h3>2, 4 and 6 lane roads</h3>
                    <p>Rotate roads as you place them to design proper junctions, boulevards and neighbourhood streets.</p>
                </article>
                <article class="landing-card">
                    <span class="landing-card-icon">📐</span>
                    <h3>Multi-tile structures</h3>
                    <p>A stadium takes four tiles, a hospital takes two. Occupied tiles are highlighted before you commit.</p>
                </article>
                <article class="landing-card">
                    <span class="landing-card-icon">🌍</span>
                    <h3>A world of your own</h3>
                    <p>Every account gets a completely separate map with hills, rivers, forests and land to unlock.</p>
                </article>
                <article class="landing-card">
                    <span class="landing-card-icon">💰</span>
                    <h3>A living economy</h3>
                    <p>Income, upkeep and taxes tick over while you play. Balance growth against your budget.</p>
                </article>
                <article class="landing-card">
                    <span class="landing-card-icon">🏆</span>
                    <h3>Global leaderboard</h3>
                    <p>Your score blends infrastructure, population, economy, environment and happiness. Compete for the top spot.</p>
                </article>
            </div>
        </section>

        <section class="landing-section landing-section-alt" id="how-it-works">
            <h2 class="landing-section-title">Get started in three steps</h2>
            <ol class="landing-steps">
                <li class="landing-step">
                    <span class="landing-step-number">1</span>
                    <h3>Create your account</h3>
                    <p>Sign up with an email and password. A fresh city and starting budget are waiting for you.</p>
                </li>
                <li class="landing-step">
                    <span class="landing-step-number">2</span>
                    <h3>Unlock land and build</h3>
                    <p>Click a tile next to your territory to buy it, then pick a structure from the build menu and place it.</p>
                </li>
                <li class="landing-step">
                    <span class="landing-step-number">3</span>
                    <h3>Grow and compete</h3>
                    <p>Keep citizens happy and the books balanced as your score climbs the leaderboard.</p>
                </li>
            </ol>

            <div class="landing-final-cta">
                <?php if ($currentUser !== null): ?>
                    <a class="landing-btn landing-btn-primary landing-btn-lg" href="game.php">Back to my city</a>
                <?php else: ?>
                    <a class="landing-btn landing-btn-primary landing-btn-lg" href="game.php?auth=register">Start building — it's free</a>
                    <p class="landing-final-note">Already have an account? <a href="game.php?auth=login">Log in here</a>.</p>
                <?php endif; ?>
            </div>
        </section>
    </main>

    <footer class="landing-footer">
        <span>🏙️ Smart City Simulator</span>
        <span class="landing-footer-sep">·</span>
        <a href="game.php">Play</a>
        <span class="landing-footer-sep">·</span>
        <a href="admin/login.php">Admin</a>
    </footer>

</body>
</html>
