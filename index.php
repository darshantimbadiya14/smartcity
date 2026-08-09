<?php

declare(strict_types=1);

?><!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Smart City Simulator</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700&family=Quicksand:wght@500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>

    <section id="auth-screen">
        <div class="auth-card">
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
                <span class="hud-stat-label">Budget</span>
                <span class="hud-stat-value money" id="hud-budget">₹0</span>
            </div>
            <div class="hud-stat">
                <span class="hud-stat-label">Population</span>
                <span class="hud-stat-value" id="hud-population">0</span>
            </div>
            <div class="hud-stat">
                <span class="hud-stat-label">Happiness</span>
                <span class="hud-stat-value" id="hud-happiness">0</span>
            </div>
            <div class="hud-stat">
                <span class="hud-stat-label">Score</span>
                <span class="hud-stat-value" id="hud-score">0</span>
            </div>

            <button type="button" id="logout-btn" class="btn-logout">Logout</button>
        </header>

        <div class="game-body">
            <aside class="build-menu">
                <h2 class="build-menu-title">Build Menu</h2>
                <div id="build-menu-list">
                    <p class="build-menu-empty">Loading building types…</p>
                </div>
            </aside>

            <div class="game-canvas-wrap">
                <div id="game-canvas">3D scene coming soon</div>
            </div>
        </div>
    </section>

    <script src="assets/js/auth.js"></script>
    <script src="assets/js/ui.js"></script>
</body>
</html>
