<?php

declare(strict_types=1);

require_once __DIR__ . '/includes/assets.php';

?><!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Play — Smart City Simulator</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700&family=Quicksand:wght@500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="<?= asset_url('assets/css/style.css') ?>">
    <script type="importmap">
    {
        "imports": {
            "three": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js",
            "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/"
        }
    }
    </script>
</head>
<body>

    <section id="auth-screen">
        <div class="auth-card">
            <a class="auth-back" href="index.php">&larr; Back to home</a>
            <h1 class="auth-title">Smart City Simulator</h1>
            <p class="auth-subtitle">Build, grow, and manage your own city.</p>

            <div class="auth-tabs">
                <button type="button" class="auth-tab active" data-tab="login">Login</button>
                <button type="button" class="auth-tab" data-tab="register">Register</button>
            </div>

            <div id="form-error" class="form-error"></div>

            <form id="login-form" class="auth-form">
                <div class="field-group">
                    <label for="login-email">Email</label>
                    <input type="email" id="login-email" name="email" autocomplete="email" required>
                </div>
                <div class="field-group">
                    <label for="login-password">Password</label>
                    <input type="password" id="login-password" name="password" autocomplete="current-password" required>
                </div>
                <button type="submit" class="btn-primary">Log In</button>
            </form>

            <form id="register-form" class="auth-form hidden">
                <div class="field-group">
                    <label for="register-name">Name</label>
                    <input type="text" id="register-name" name="name" autocomplete="name" required>
                </div>
                <div class="field-group">
                    <label for="register-email">Email</label>
                    <input type="email" id="register-email" name="email" autocomplete="email" required>
                </div>
                <div class="field-group">
                    <label for="register-password">Password</label>
                    <input type="password" id="register-password" name="password" autocomplete="new-password" required>
                </div>
                <button type="submit" class="btn-primary">Create Account</button>
            </form>
        </div>
    </section>

    <section id="game-shell" class="hidden">
        <header class="hud-bar">
            <span class="hud-brand">🏙️ Smart City</span>

            <div class="hud-stat">
                <span class="hud-stat-label"><span class="hud-stat-icon" aria-hidden="true">💰</span>Budget</span>
                <span class="hud-stat-value money" id="hud-budget">₹0</span>
            </div>
            <div class="hud-stat">
                <span class="hud-stat-label"><span class="hud-stat-icon" aria-hidden="true">👥</span>Population</span>
                <span class="hud-stat-value" id="hud-population">0</span>
            </div>
            <div class="hud-stat">
                <span class="hud-stat-label"><span class="hud-stat-icon" aria-hidden="true">😊</span>Happiness</span>
                <span class="hud-stat-value" id="hud-happiness">0</span>
            </div>
            <div class="hud-stat">
                <span class="hud-stat-label"><span class="hud-stat-icon" aria-hidden="true">⭐</span>Score</span>
                <span class="hud-stat-value" id="hud-score">0</span>
            </div>
            <div class="hud-stat">
                <span class="hud-stat-label"><span class="hud-stat-icon" aria-hidden="true">🏦</span>Tax</span>
                <span class="hud-stat-value" id="hud-tax">10%</span>
            </div>

            <a href="admin/index.php" id="hud-admin-link" class="btn-leaderboard hidden">Admin Panel</a>
            <button type="button" id="settings-btn" class="btn-leaderboard">⚙️ Settings</button>
            <button type="button" id="leaderboard-btn" class="btn-leaderboard">Leaderboard</button>
            <button type="button" id="logout-btn" class="btn-logout">Logout</button>
        </header>

        <div class="game-body">
            <aside class="build-menu">
                <h2 class="build-menu-title">Build Menu</h2>
                <p class="build-menu-hint">Select a building, then press <strong>Q</strong> / <strong>E</strong> to rotate it before placing.</p>
                <div id="build-menu-list">
                    <p class="build-menu-empty">Loading building types…</p>
                </div>
            </aside>

            <div class="game-canvas-wrap">
                <div id="game-canvas">
                    <div id="tile-info" class="tile-info">
                        <p id="tile-info-message" class="tile-info-message">Click a tile to inspect it.</p>
                        <button type="button" id="tile-info-upgrade" class="tile-info-confirm tile-info-upgrade hidden">Upgrade</button>
                        <button type="button" id="tile-info-confirm" class="tile-info-confirm hidden">Unlock</button>
                    </div>

                    <div id="area-panel" class="area-panel hidden">
                        <div class="area-panel-head">
                            <span id="area-panel-title" class="area-panel-title">0 tiles selected</span>
                            <button type="button" id="area-panel-close" class="area-panel-close" aria-label="Clear selection">&times;</button>
                        </div>
                        <div id="area-panel-actions" class="area-panel-actions"></div>
                    </div>

                    <p class="canvas-hint">
                        Hold <strong>Shift</strong> and drag to select an area &middot;
                        <strong>Q</strong>/<strong>E</strong> rotate
                    </p>
                </div>
            </div>
        </div>

        <div id="leaderboard-overlay" class="leaderboard-overlay hidden">
            <div class="leaderboard-panel">
                <div class="leaderboard-header">
                    <h2 class="leaderboard-title">Leaderboard</h2>
                    <button type="button" id="leaderboard-close" class="leaderboard-close" aria-label="Close leaderboard">&times;</button>
                </div>
                <div class="leaderboard-row leaderboard-row-head">
                    <span class="leaderboard-col-rank">#</span>
                    <span class="leaderboard-col-city">City</span>
                    <span class="leaderboard-col-owner">Owner</span>
                    <span class="leaderboard-col-score">Score</span>
                    <span class="leaderboard-col-pop">Pop.</span>
                </div>
                <div id="leaderboard-list" class="leaderboard-list">
                    <p class="build-menu-empty">Loading leaderboard…</p>
                </div>
            </div>
        </div>

        <div id="settings-overlay" class="leaderboard-overlay hidden">
            <div class="settings-panel">
                <div class="leaderboard-header">
                    <h2 class="leaderboard-title">⚙️ Settings</h2>
                    <button type="button" id="settings-close" class="leaderboard-close" aria-label="Close settings">&times;</button>
                </div>

                <div class="settings-tabs">
                    <button type="button" class="settings-tab active" data-panel="economy">🏦 City &amp; Economy</button>
                    <button type="button" class="settings-tab" data-panel="profile">👤 Profile</button>
                    <button type="button" class="settings-tab" data-panel="security">🔒 Password</button>
                </div>

                <div class="settings-body">
                    <!-- City & economy -->
                    <section class="settings-section" data-panel="economy">
                        <div id="settings-economy-message" class="settings-message"></div>

                        <form id="city-settings-form" class="settings-form">
                            <div class="field-group">
                                <label for="settings-city-name">City name</label>
                                <input type="text" id="settings-city-name" name="city_name" maxlength="100" required>
                            </div>

                            <div class="field-group">
                                <label for="settings-tax-rate">
                                    Tax rate — <strong id="settings-tax-value">10%</strong>
                                </label>
                                <input type="range" id="settings-tax-rate" name="tax_rate"
                                       min="0" max="30" step="1" value="10" class="settings-range">
                                <p id="settings-tax-label" class="settings-hint">Low — steady growth with modest revenue.</p>
                            </div>

                            <div class="settings-economy-grid">
                                <div class="settings-stat">
                                    <span class="settings-stat-label">Housing capacity</span>
                                    <span class="settings-stat-value" id="settings-capacity">0</span>
                                </div>
                                <div class="settings-stat">
                                    <span class="settings-stat-label">Residents now</span>
                                    <span class="settings-stat-value" id="settings-population">0</span>
                                </div>
                                <div class="settings-stat">
                                    <span class="settings-stat-label">Settling toward</span>
                                    <span class="settings-stat-value" id="settings-pop-target">0</span>
                                </div>
                                <div class="settings-stat">
                                    <span class="settings-stat-label">Business income</span>
                                    <span class="settings-stat-value" id="settings-income">₹0</span>
                                </div>
                                <div class="settings-stat">
                                    <span class="settings-stat-label">Tax revenue</span>
                                    <span class="settings-stat-value" id="settings-tax-revenue">₹0</span>
                                </div>
                                <div class="settings-stat">
                                    <span class="settings-stat-label">Upkeep</span>
                                    <span class="settings-stat-value" id="settings-upkeep">₹0</span>
                                </div>
                                <div class="settings-stat settings-stat-wide">
                                    <span class="settings-stat-label">Net per tick</span>
                                    <span class="settings-stat-value" id="settings-net">₹0</span>
                                </div>
                            </div>

                            <button type="submit" class="btn-primary">Save city settings</button>
                        </form>
                    </section>

                    <!-- Profile -->
                    <section class="settings-section hidden" data-panel="profile">
                        <div id="settings-profile-message" class="settings-message"></div>

                        <form id="profile-settings-form" class="settings-form">
                            <div class="field-group">
                                <label for="settings-name">Display name</label>
                                <input type="text" id="settings-name" name="name" maxlength="100" autocomplete="name" required>
                            </div>
                            <div class="field-group">
                                <label for="settings-email">Email address</label>
                                <input type="email" id="settings-email" name="email" maxlength="150" autocomplete="email" required>
                            </div>
                            <p class="settings-hint">Your email is how you sign in — changing it changes your login.</p>
                            <button type="submit" class="btn-primary">Save profile</button>
                        </form>
                    </section>

                    <!-- Password -->
                    <section class="settings-section hidden" data-panel="security">
                        <div id="settings-password-message" class="settings-message"></div>

                        <form id="password-settings-form" class="settings-form">
                            <div class="field-group">
                                <label for="settings-current-password">Current password</label>
                                <input type="password" id="settings-current-password" name="current_password"
                                       autocomplete="current-password" required>
                            </div>
                            <div class="field-group">
                                <label for="settings-new-password">New password</label>
                                <input type="password" id="settings-new-password" name="new_password"
                                       autocomplete="new-password" minlength="6" required>
                            </div>
                            <div class="field-group">
                                <label for="settings-confirm-password">Confirm new password</label>
                                <input type="password" id="settings-confirm-password" name="confirm_password"
                                       autocomplete="new-password" minlength="6" required>
                            </div>
                            <p class="settings-hint">At least 6 characters.</p>
                            <button type="submit" class="btn-primary">Change password</button>
                        </form>
                    </section>
                </div>
            </div>
        </div>
    </section>

    <script>
        // three-scene.js is pulled in by a dynamic import() inside auth.js, so its
        // URL cannot be versioned by PHP directly. Hand the version through here.
        window.__sceneVersion = '<?= asset_version('assets/js/three-scene.js') ?>';
    </script>
    <script src="<?= asset_url('assets/js/api-client.js') ?>"></script>
    <script src="<?= asset_url('assets/js/auth.js') ?>"></script>
    <script src="<?= asset_url('assets/js/ui.js') ?>"></script>
</body>
</html>
