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

    document.addEventListener('game:shown', function () {
        if (!loaded) {
            loaded = true;
            loadBuildingTypes();
        }
    });
})();
