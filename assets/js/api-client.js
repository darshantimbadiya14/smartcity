(function () {
    'use strict';

    function handleSessionExpired() {
        window.__smartCity = null;
        window.__selectedBuildingType = null;

        document.dispatchEvent(new CustomEvent('session:expired', {
            detail: { message: 'Session expired — please log in again.' },
        }));
    }

    window.apiFetch = function (url, options) {
        return fetch(url, options).then(function (response) {
            if (response.status === 401) {
                handleSessionExpired();

                return new Promise(function () {
                    /* Intentionally never settles: the 401 has already been
                       fully handled (state cleared, user returned to login),
                       so the caller's .then()/.catch() chain should stop here. */
                });
            }

            return response;
        });
    };
})();
