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

    function switchTab(tab) {
        clearMessage();

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

    function showAuthScreen() {
        gameShell.classList.add('hidden');
        authScreen.classList.remove('hidden');
    }

    function showGameShell() {
        authScreen.classList.add('hidden');
        gameShell.classList.remove('hidden');
        document.dispatchEvent(new CustomEvent('game:shown'));

        if (!threeSceneStarted) {
            threeSceneStarted = true;
            import('./three-scene.js')
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
        fetch('api/logout.php', { method: 'POST', credentials: 'same-origin' })
            .catch(function () { /* ignore network errors, still return to auth screen */ })
            .then(function () {
                loginForm.reset();
                registerForm.reset();
                switchTab('login');
                showAuthScreen();
            });
    });

    checkSession();
})();
