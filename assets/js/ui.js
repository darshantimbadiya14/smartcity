(function () {
    'use strict';

    var buildMenuList = document.getElementById('build-menu-list');
    var loaded = false;

    function formatCost(cost) {
        var amount = Math.round(Number(cost));
        return '₹' + amount.toLocaleString('en-IN');
    }

    function renderBuildingTypes(buildingTypes) {
        buildMenuList.innerHTML = '';

        if (!buildingTypes.length) {
            var empty = document.createElement('p');
            empty.className = 'build-menu-empty';
            empty.textContent = 'No building types available.';
            buildMenuList.appendChild(empty);
            return;
        }

        buildingTypes.forEach(function (type) {
            var card = document.createElement('div');
            card.className = 'building-card';

            var info = document.createElement('div');

            var name = document.createElement('div');
            name.className = 'building-card-name';
            name.textContent = type.name;
            info.appendChild(name);

            var category = document.createElement('div');
            category.className = 'building-card-category';
            category.textContent = type.category;
            info.appendChild(category);

            var cost = document.createElement('div');
            cost.className = 'building-card-cost';
            cost.textContent = formatCost(type.cost);

            card.appendChild(info);
            card.appendChild(cost);
            buildMenuList.appendChild(card);
        });
    }

    function loadBuildingTypes() {
        buildMenuList.innerHTML = '<p class="build-menu-empty">Loading building types…</p>';

        fetch('api/building-types.php', { credentials: 'same-origin' })
            .then(function (response) { return response.json(); })
            .then(function (body) {
                if (body.status === 'success') {
                    renderBuildingTypes(body.data.building_types);
                } else {
                    buildMenuList.innerHTML = '<p class="build-menu-empty">Could not load building types.</p>';
                }
            })
            .catch(function () {
                buildMenuList.innerHTML = '<p class="build-menu-empty">Could not load building types.</p>';
            });
    }

    var cityLoaded = false;

    var hudBudget = document.getElementById('hud-budget');
    var hudPopulation = document.getElementById('hud-population');
    var hudHappiness = document.getElementById('hud-happiness');
    var hudScore = document.getElementById('hud-score');

    function renderCity(city) {
        if (hudBudget) {
            hudBudget.textContent = formatCost(city.budget);
        }
        if (hudPopulation) {
            hudPopulation.textContent = String(city.population);
        }
        if (hudHappiness) {
            hudHappiness.textContent = String(city.happiness);
        }
        if (hudScore) {
            hudScore.textContent = String(city.score);
        }
    }

    function loadCity() {
        fetch('api/city.php', { credentials: 'same-origin' })
            .then(function (response) { return response.json(); })
            .then(function (body) {
                if (body.status !== 'success') {
                    return;
                }

                renderCity(body.data.city);

                window.__smartCity = {
                    city: body.data.city,
                    unlockedTiles: body.data.unlocked_tiles,
                    tileUnlockCost: body.data.tile_unlock_cost,
                    gridSize: body.data.grid_size,
                };

                document.dispatchEvent(new CustomEvent('city:loaded', { detail: window.__smartCity }));
            })
            .catch(function () {
                /* HUD keeps its placeholder values if this fails */
            });
    }

    document.addEventListener('game:shown', function () {
        if (!loaded) {
            loaded = true;
            loadBuildingTypes();
        }
        if (!cityLoaded) {
            cityLoaded = true;
            loadCity();
        }
    });
})();
