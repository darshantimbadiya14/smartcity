(function () {
    'use strict';

    var authScreen = document.getElementById('auth-screen');
    var gameShell = document.getElementById('game-shell');
    var formError = document.getElementById('form-error');

    var authTabs = document.querySelectorAll('.auth-tab');
    var loginForm = document.getElementById('login-form');
    var registerForm = document.getElementById('register-form');
    var logoutBtn = document.getElementById('logout-btn');

    var threeSceneStarted = false;

    function showError(message) {
        formError.textContent = message;
        formError.classList.remove('success');
        formError.classList.add('visible');
    }

    function showSuccess(message) {
        formError.textContent = message;
        formError.classList.add('success');
        formError.classList.add('visible');
    }

    function clearMessage() {
        formError.textContent = '';
        formError.classList.remove('visible', 'success');
    }

    function switchTab(tab, preserveMessage) {
        if (!preserveMessage) {
            clearMessage();
        }

        authTabs.forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        if (tab === 'login') {
            loginForm.classList.remove('hidden');
            registerForm.classList.add('hidden');
        } else {
            registerForm.classList.remove('hidden');
            loginForm.classList.add('hidden');
        }
    }

    function requestedTab() {
        try {
            var requested = new URLSearchParams(window.location.search).get('auth');
            return requested === 'register' ? 'register' : 'login';
        } catch (e) {
            return 'login';
        }
    }

    function showAuthScreen() {
        gameShell.classList.add('hidden');
        authScreen.classList.remove('hidden');
        // Keep any pending flash message (e.g. "Session expired") that was shown before this ran.
        switchTab(requestedTab(), true);
    }

    var FLASH_MESSAGE_KEY = 'smartcity_flash_message';

    function showPendingFlashMessage() {
        try {
            var pending = sessionStorage.getItem(FLASH_MESSAGE_KEY);
            if (pending) {
                sessionStorage.removeItem(FLASH_MESSAGE_KEY);
                showError(pending);
            }
        } catch (e) {
            /* sessionStorage unavailable (e.g. private browsing) — nothing to show */
        }
    }

    function reloadToAuthScreen(flashMessage) {
        try {
            if (flashMessage) {
                sessionStorage.setItem(FLASH_MESSAGE_KEY, flashMessage);
            }
        } catch (e) {
            /* ignore storage errors, message just won't survive the reload */
        }
        window.location.reload();
    }

    function showGameShell() {
        authScreen.classList.add('hidden');
        gameShell.classList.remove('hidden');
        document.dispatchEvent(new CustomEvent('game:shown'));

        if (!threeSceneStarted) {
            threeSceneStarted = true;
            // Version query keeps the browser from reusing a stale cached module.
            var sceneUrl = './three-scene.js'
                + (window.__sceneVersion ? '?v=' + window.__sceneVersion : '');

            import(sceneUrl)
                .then(function (module) {
                    module.init();
                })
                .catch(function (err) {
                    console.error('Failed to load 3D scene:', err);
                });
        }
    }

    function postJson(url, payload) {
        return fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }).then(function (response) {
            return response.json().then(function (body) {
                return { ok: response.ok, body: body };
            });
        });
    }

    function checkSession() {
        fetch('api/me.php', { credentials: 'same-origin' })
            .then(function (response) { return response.json(); })
            .then(function (body) {
                if (body.status === 'success') {
                    // An admin restoring a session keeps access to the game, but
                    // gets a way back to the panel rather than being stranded.
                    if (body.data && body.data.is_admin) {
                        var adminLink = document.getElementById('hud-admin-link');
                        if (adminLink) {
                            adminLink.classList.remove('hidden');
                        }
                    }
                    showGameShell();
                } else {
                    showAuthScreen();
                }
            })
            .catch(function () {
                showAuthScreen();
            });
    }

    authTabs.forEach(function (btn) {
        btn.addEventListener('click', function () {
            switchTab(btn.dataset.tab);
        });
    });

    loginForm.addEventListener('submit', function (event) {
        event.preventDefault();
        clearMessage();

        var payload = {
            email: document.getElementById('login-email').value.trim(),
            password: document.getElementById('login-password').value,
        };

        postJson('api/login.php', payload)
            .then(function (result) {
                if (result.ok && result.body.status === 'success') {
                    loginForm.reset();

                    // Admins belong in the admin panel, not in a player city.
                    if (result.body.data && result.body.data.is_admin) {
                        window.location.href = 'admin/index.php';
                        return;
                    }

                    showGameShell();
                } else {
                    showError(result.body.message || 'Login failed.');
                }
            })
            .catch(function () {
                showError('Network error. Please try again.');
            });
    });

    registerForm.addEventListener('submit', function (event) {
        event.preventDefault();
        clearMessage();

        var payload = {
            name: document.getElementById('register-name').value.trim(),
            email: document.getElementById('register-email').value.trim(),
            password: document.getElementById('register-password').value,
        };

        postJson('api/register.php', payload)
            .then(function (result) {
                if (result.ok && result.body.status === 'success') {
                    var registeredEmail = payload.email;
                    registerForm.reset();
                    switchTab('login');
                    document.getElementById('login-email').value = registeredEmail;
                    showSuccess('Account created! Please log in.');
                } else {
                    showError(result.body.message || 'Registration failed.');
                }
            })
            .catch(function () {
                showError('Network error. Please try again.');
            });
    });

    logoutBtn.addEventListener('click', function () {
        apiFetch('api/logout.php', { method: 'POST', credentials: 'same-origin' })
            .catch(function () { /* ignore network errors, still reload to a clean slate */ })
            .then(function () {
                reloadToAuthScreen();
            });
    });

    document.addEventListener('session:expired', function (event) {
        reloadToAuthScreen((event.detail && event.detail.message) || 'Session expired — please log in again.');
    });

    showPendingFlashMessage();
    checkSession();
})();
