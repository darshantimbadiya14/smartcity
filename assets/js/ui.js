(function () {
    'use strict';

    var buildMenuList = document.getElementById('build-menu-list');
    var loaded = false;

    function formatCost(cost) {
        var amount = Math.round(Number(cost));
        return '₹' + amount.toLocaleString('en-IN');
    }

    var BUILDING_ICONS = {
        road: '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><rect x="3" y="3" width="34" height="34" rx="7" fill="#6b6b6b"/><rect x="18" y="7" width="4" height="7" rx="1.5" fill="#f3e6c4"/><rect x="18" y="17" width="4" height="7" rx="1.5" fill="#f3e6c4"/><rect x="18" y="27" width="4" height="7" rx="1.5" fill="#f3e6c4"/></svg>',
        road_4lane: '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><rect x="3" y="3" width="34" height="34" rx="7" fill="#5f5f5f"/><rect x="11" y="7" width="3" height="7" rx="1.2" fill="#f3e6c4"/><rect x="11" y="17" width="3" height="7" rx="1.2" fill="#f3e6c4"/><rect x="11" y="27" width="3" height="7" rx="1.2" fill="#f3e6c4"/><rect x="26" y="7" width="3" height="7" rx="1.2" fill="#f3e6c4"/><rect x="26" y="17" width="3" height="7" rx="1.2" fill="#f3e6c4"/><rect x="26" y="27" width="3" height="7" rx="1.2" fill="#f3e6c4"/></svg>',
        road_6lane: '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><rect x="3" y="3" width="34" height="34" rx="7" fill="#545454"/><rect x="7" y="7" width="2.5" height="7" rx="1" fill="#f3e6c4"/><rect x="7" y="17" width="2.5" height="7" rx="1" fill="#f3e6c4"/><rect x="7" y="27" width="2.5" height="7" rx="1" fill="#f3e6c4"/><rect x="18.7" y="4" width="2.5" height="32" fill="#ffe08a"/><rect x="30" y="7" width="2.5" height="7" rx="1" fill="#f3e6c4"/><rect x="30" y="17" width="2.5" height="7" rx="1" fill="#f3e6c4"/><rect x="30" y="27" width="2.5" height="7" rx="1" fill="#f3e6c4"/></svg>',
        house: '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><rect x="8" y="19" width="24" height="15" rx="1.5" fill="#f2d9a6"/><polygon points="4,19 20,6 36,19" fill="#b5533c"/><rect x="17" y="25" width="6" height="9" fill="#5c3d28"/><rect x="10.5" y="22" width="4.5" height="4.5" fill="#bfe3f0"/><rect x="25" y="22" width="4.5" height="4.5" fill="#bfe3f0"/></svg>',
        shop: '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><rect x="7" y="15" width="26" height="19" rx="1.5" fill="#5b8fd1"/><rect x="4" y="9" width="32" height="8" rx="2" fill="#ff9f43"/><rect x="12" y="23" width="7" height="11" fill="#5c3d28"/><rect x="22" y="22" width="7" height="7" fill="#bfe3f0"/></svg>',
        cafe: '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><rect x="7" y="15" width="26" height="19" rx="1.5" fill="#9c6b4a"/><rect x="4" y="9" width="32" height="8" rx="2" fill="#f2d9a6"/><rect x="12" y="23" width="7" height="11" fill="#5c3d28"/><rect x="22" y="22" width="7" height="7" fill="#bfe3f0"/></svg>',
        school: '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><rect x="5" y="17" width="30" height="17" rx="1.5" fill="#e8c468"/><rect x="3" y="10" width="34" height="7" rx="2" fill="#4a5a8f"/><rect x="10" y="23" width="6" height="6" fill="#bfe3f0"/><rect x="24" y="23" width="6" height="6" fill="#bfe3f0"/><line x1="30" y1="3" x2="30" y2="12" stroke="#cccccc" stroke-width="2"/><rect x="30" y="4" width="7" height="4.5" fill="#e0554f"/></svg>',
        park: '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><ellipse cx="20" cy="33" rx="17" ry="5" fill="#5fae5a"/><rect x="18" y="20" width="4" height="9" fill="#8a5a3c"/><ellipse cx="20" cy="14" rx="11" ry="9" fill="#4a9c56"/><ellipse cx="12" cy="18" rx="6" ry="5" fill="#3f8f4f"/><ellipse cx="28" cy="18" rx="6" ry="5" fill="#3f8f4f"/></svg>',
        apartment: '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><rect x="10" y="4" width="20" height="30" rx="1.5" fill="#d9cdb6"/><rect x="8" y="2" width="24" height="4" fill="#6b6259"/><rect x="13" y="10" width="4" height="4" fill="#bfe3f0"/><rect x="23" y="10" width="4" height="4" fill="#bfe3f0"/><rect x="13" y="18" width="4" height="4" fill="#bfe3f0"/><rect x="23" y="18" width="4" height="4" fill="#bfe3f0"/><rect x="13" y="26" width="4" height="4" fill="#bfe3f0"/><rect x="23" y="26" width="4" height="4" fill="#bfe3f0"/></svg>',
        factory: '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><rect x="6" y="18" width="26" height="16" fill="#8a7d6e"/><rect x="5" y="16" width="28" height="3" fill="#554d44"/><rect x="22" y="6" width="6" height="14" fill="#6b6b6b"/><rect x="21.5" y="4" width="7" height="3" fill="#3a3a3a"/><rect x="10" y="24" width="6" height="10" fill="#5c3d28"/></svg>',
        hospital: '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><rect x="6" y="14" width="28" height="20" rx="1.5" fill="#f3f1ea"/><rect x="4" y="10" width="32" height="5" fill="#d8524c"/><rect x="17" y="15" width="6" height="14" fill="#d8524c"/><rect x="11" y="19" width="18" height="6" fill="#d8524c"/><rect x="15" y="27" width="10" height="7" fill="#5c3d28"/></svg>',
        police: '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><rect x="6" y="15" width="28" height="19" rx="1.5" fill="#e9e6df"/><rect x="4" y="11" width="32" height="5" fill="#2d4a70"/><circle cx="20" cy="21" r="6" fill="#2d4a70"/><rect x="15" y="27" width="10" height="7" fill="#5c3d28"/></svg>',
        office: '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><rect x="9" y="4" width="22" height="30" rx="1" fill="#7d92a8"/><rect x="8" y="2" width="24" height="3" fill="#4a5a6b"/><rect x="11" y="10" width="18" height="3" fill="#bfe3f0"/><rect x="11" y="17" width="18" height="3" fill="#bfe3f0"/><rect x="11" y="24" width="18" height="3" fill="#bfe3f0"/></svg>',
        stadium: '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><ellipse cx="20" cy="22" rx="17" ry="12" fill="#b7bfc9"/><ellipse cx="20" cy="22" rx="12" ry="8" fill="#5fae5a"/><rect x="4" y="8" width="2" height="8" fill="#c9c9c9"/><rect x="34" y="8" width="2" height="8" fill="#c9c9c9"/></svg>'
    };

    function getBuildingIcon(modelKey) {
        return BUILDING_ICONS[modelKey] || BUILDING_ICONS.house;
    }

    var CATEGORY_LABELS = {
        residential: 'Residential',
        commercial: 'Commercial',
        industrial: 'Industrial',
        road: 'Roads',
        service: 'Services',
        other: 'Other Structures'
    };
    var CATEGORY_ORDER = ['residential', 'commercial', 'industrial', 'road', 'service', 'other'];

    function formatDetailLine(type) {
        var parts = [];
        var capacity = Number(type.capacity) || 0;
        var income = Number(type.income) || 0;
        var upkeep = Number(type.upkeep) || 0;
        var happiness = Number(type.happiness_effect) || 0;

        if (capacity > 0) {
            parts.push('+' + capacity + ' pop');
        }
        if (income > 0) {
            parts.push('+' + formatCost(income) + '/tick');
        }
        if (upkeep > 0) {
            parts.push('-' + formatCost(upkeep) + '/tick');
        }
        if (happiness > 0) {
            parts.push('+' + happiness + ' happy');
        } else if (happiness < 0) {
            parts.push(happiness + ' happy');
        }

        return parts.length ? parts.join(' · ') : (CATEGORY_LABELS[type.category] || type.category);
    }

    var selectedBuildingCard = null;
    var buildingCardsByTypeId = {};

    function selectBuildingType(card, type) {
        if (selectedBuildingCard === card) {
            card.classList.remove('selected');
            selectedBuildingCard = null;
            window.__selectedBuildingType = null;
        } else {
            if (selectedBuildingCard) {
                selectedBuildingCard.classList.remove('selected');
            }
            card.classList.add('selected');
            selectedBuildingCard = card;
            window.__selectedBuildingType = type;
        }

        document.dispatchEvent(new CustomEvent('building-type:selected', { detail: window.__selectedBuildingType }));
    }

    window.__smartCitySelectBuildingType = function (buildingTypeId) {
        var entry = buildingCardsByTypeId[buildingTypeId];
        if (!entry) {
            return;
        }
        if (selectedBuildingCard) {
            selectedBuildingCard.classList.remove('selected');
        }
        entry.card.classList.add('selected');
        selectedBuildingCard = entry.card;
        window.__selectedBuildingType = entry.type;
        document.dispatchEvent(new CustomEvent('building-type:selected', { detail: window.__selectedBuildingType }));
        entry.card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };

    function createBuildingCard(type) {
        var card = document.createElement('div');
        card.className = 'building-card';

        var main = document.createElement('div');
        main.className = 'building-card-main';

        var icon = document.createElement('div');
        icon.className = 'building-card-icon';
        icon.innerHTML = getBuildingIcon(type.model_key);
        main.appendChild(icon);

        var info = document.createElement('div');
        info.className = 'building-card-info';

        var nameRow = document.createElement('div');
        nameRow.className = 'building-card-name-row';

        var name = document.createElement('span');
        name.className = 'building-card-name';
        name.textContent = type.name;
        nameRow.appendChild(name);

        var tileWidth = Number(type.tile_width) || 1;
        var tileHeight = Number(type.tile_height) || 1;
        if (tileWidth > 1 || tileHeight > 1) {
            var sizeBadge = document.createElement('span');
            sizeBadge.className = 'building-card-size';
            sizeBadge.textContent = tileWidth + '×' + tileHeight;
            nameRow.appendChild(sizeBadge);
        }
        info.appendChild(nameRow);

        var detail = document.createElement('div');
        detail.className = 'building-card-category';
        detail.textContent = formatDetailLine(type);
        info.appendChild(detail);

        main.appendChild(info);
        card.appendChild(main);

        var cost = document.createElement('div');
        cost.className = 'building-card-cost';
        cost.textContent = formatCost(type.cost);
        card.appendChild(cost);

        card.addEventListener('click', function () {
            selectBuildingType(card, type);
        });

        buildingCardsByTypeId[type.id] = { card: card, type: type };

        return card;
    }

    function renderBuildingTypes(buildingTypes) {
        buildMenuList.innerHTML = '';
        buildingCardsByTypeId = {};
        selectedBuildingCard = null;

        // Lookup by id so the 3D scene can price bulk actions (area remove refunds,
        // road runs) without refetching the catalogue.
        window.__buildingTypesById = {};
        buildingTypes.forEach(function (type) {
            window.__buildingTypesById[String(type.id)] = type;
        });

        if (!buildingTypes.length) {
            var empty = document.createElement('p');
            empty.className = 'build-menu-empty';
            empty.textContent = 'No building types available.';
            buildMenuList.appendChild(empty);
            return;
        }

        var byCategory = {};
        buildingTypes.forEach(function (type) {
            var cat = type.category;
            if (!byCategory[cat]) {
                byCategory[cat] = [];
            }
            byCategory[cat].push(type);
        });

        CATEGORY_ORDER.forEach(function (cat) {
            var types = byCategory[cat];
            if (!types || !types.length) {
                return;
            }

            var section = document.createElement('div');
            section.className = 'build-menu-section';

            var heading = document.createElement('h3');
            heading.className = 'build-menu-category-title';
            heading.textContent = CATEGORY_LABELS[cat] || cat;
            section.appendChild(heading);

            types.forEach(function (type) {
                section.appendChild(createBuildingCard(type));
            });

            buildMenuList.appendChild(section);
        });
    }

    function loadBuildingTypes() {
        buildMenuList.innerHTML = '<p class="build-menu-empty">Loading building types…</p>';

        apiFetch('api/building-types.php', { credentials: 'same-origin' })
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
    var hudTax = document.getElementById('hud-tax');

    function renderCity(city) {
        if (hudBudget) {
            hudBudget.textContent = formatCost(city.budget);
            hudBudget.dataset.rawValue = String(city.budget);
        }
        if (hudPopulation) {
            hudPopulation.textContent = String(city.population);
            hudPopulation.dataset.rawValue = String(city.population);
        }
        if (hudHappiness) {
            hudHappiness.textContent = String(city.happiness);
            hudHappiness.dataset.rawValue = String(city.happiness);
        }
        if (hudScore) {
            hudScore.textContent = String(city.score);
            hudScore.dataset.rawValue = String(city.score);
        }
        if (hudTax && city.tax_rate !== undefined && city.tax_rate !== null) {
            hudTax.textContent = Math.round(Number(city.tax_rate) * 100) + '%';
        }
    }

    var HUD_ANIMATION_MS = 450;
    var hudAnimationFrames = {};

    function animateHudValue(el, newValue, formatter) {
        if (!el) {
            return;
        }

        var startValue = parseFloat(el.dataset.rawValue || '0');
        if (isNaN(startValue)) {
            startValue = 0;
        }
        var endValue = Number(newValue);

        if (hudAnimationFrames[el.id]) {
            cancelAnimationFrame(hudAnimationFrames[el.id]);
        }

        var startTime = performance.now();

        function step(time) {
            var elapsed = time - startTime;
            var t = Math.min(elapsed / HUD_ANIMATION_MS, 1);
            var eased = 1 - Math.pow(1 - t, 3);
            var current = startValue + (endValue - startValue) * eased;

            el.textContent = formatter(current);
            el.dataset.rawValue = String(current);

            if (t < 1) {
                hudAnimationFrames[el.id] = requestAnimationFrame(step);
            } else {
                el.textContent = formatter(endValue);
                el.dataset.rawValue = String(endValue);
                hudAnimationFrames[el.id] = null;
            }
        }

        hudAnimationFrames[el.id] = requestAnimationFrame(step);
    }

    function roundedIntFormatter(value) {
        return String(Math.round(value));
    }

    function animateCity(city) {
        animateHudValue(hudBudget, city.budget, formatCost);
        animateHudValue(hudPopulation, city.population, roundedIntFormatter);
        animateHudValue(hudHappiness, city.happiness, roundedIntFormatter);
        animateHudValue(hudScore, city.score, roundedIntFormatter);
    }

    window.animateHudBudget = function (budget) {
        animateHudValue(hudBudget, budget, formatCost);
    };

    window.animateHudPopulation = function (population) {
        animateHudValue(hudPopulation, population, roundedIntFormatter);
    };

    function loadCity() {
        apiFetch('api/city.php', { credentials: 'same-origin' })
            .then(function (response) { return response.json(); })
            .then(function (body) {
                if (body.status !== 'success') {
                    return;
                }

                renderCity(body.data.city);

                window.__smartCity = {
                    city: body.data.city,
                    economy: body.data.economy || null,
                    unlockedTiles: body.data.unlocked_tiles,
                    placedBuildings: body.data.placed_buildings,
                    tileUnlockCost: body.data.tile_unlock_cost,
                    gridSize: body.data.grid_size,
                };

                document.dispatchEvent(new CustomEvent('city:loaded', { detail: window.__smartCity }));
            })
            .catch(function () {
                /* HUD keeps its placeholder values if this fails */
            });
    }

    var STATS_POLL_INTERVAL_MS = 25000;
    var statsPollTimer = null;

    function pollCityStats() {
        var gameShell = document.getElementById('game-shell');
        if (!gameShell || gameShell.classList.contains('hidden')) {
            return;
        }

        apiFetch('api/city.php', { credentials: 'same-origin' })
            .then(function (response) { return response.json(); })
            .then(function (body) {
                if (body.status === 'success') {
                    animateCity(body.data.city);
                }
            })
            .catch(function () {
                /* silently skip this poll on failure, next one will retry */
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
        if (statsPollTimer === null) {
            statsPollTimer = setInterval(pollCityStats, STATS_POLL_INTERVAL_MS);
        }
    });

    var leaderboardBtn = document.getElementById('leaderboard-btn');
    var leaderboardOverlay = document.getElementById('leaderboard-overlay');
    var leaderboardList = document.getElementById('leaderboard-list');
    var leaderboardCloseBtn = document.getElementById('leaderboard-close');

    function renderLeaderboard(entries) {
        leaderboardList.innerHTML = '';

        if (!entries.length) {
            var empty = document.createElement('p');
            empty.className = 'build-menu-empty';
            empty.textContent = 'No cities on the leaderboard yet.';
            leaderboardList.appendChild(empty);
            return;
        }

        entries.forEach(function (entry) {
            var row = document.createElement('div');
            row.className = 'leaderboard-row' + (entry.is_you ? ' is-you' : '');

            var rank = document.createElement('span');
            rank.className = 'leaderboard-col-rank';
            rank.textContent = String(entry.rank);
            row.appendChild(rank);

            var city = document.createElement('span');
            city.className = 'leaderboard-col-city';
            city.textContent = entry.city_name + (entry.is_you ? ' (You)' : '');
            row.appendChild(city);

            var owner = document.createElement('span');
            owner.className = 'leaderboard-col-owner';
            owner.textContent = entry.owner_name;
            row.appendChild(owner);

            var score = document.createElement('span');
            score.className = 'leaderboard-col-score';
            score.textContent = String(entry.score);
            row.appendChild(score);

            var pop = document.createElement('span');
            pop.className = 'leaderboard-col-pop';
            pop.textContent = String(entry.population);
            row.appendChild(pop);

            leaderboardList.appendChild(row);
        });
    }

    function loadLeaderboard() {
        leaderboardList.innerHTML = '<p class="build-menu-empty">Loading leaderboard…</p>';

        apiFetch('api/leaderboard.php', { credentials: 'same-origin' })
            .then(function (response) { return response.json(); })
            .then(function (body) {
                if (body.status === 'success') {
                    renderLeaderboard(body.data.leaderboard);
                } else {
                    leaderboardList.innerHTML = '<p class="build-menu-empty">Could not load leaderboard.</p>';
                }
            })
            .catch(function () {
                leaderboardList.innerHTML = '<p class="build-menu-empty">Could not load leaderboard.</p>';
            });
    }

    function closeLeaderboard() {
        leaderboardOverlay.classList.add('hidden');
    }

    if (leaderboardBtn) {
        leaderboardBtn.addEventListener('click', function () {
            leaderboardOverlay.classList.remove('hidden');
            loadLeaderboard();
        });
    }

    if (leaderboardCloseBtn) {
        leaderboardCloseBtn.addEventListener('click', closeLeaderboard);
    }

    if (leaderboardOverlay) {
        leaderboardOverlay.addEventListener('click', function (event) {
            if (event.target === leaderboardOverlay) {
                closeLeaderboard();
            }
        });
    }

    // ---- Settings ----

    var settingsBtn = document.getElementById('settings-btn');
    var settingsOverlay = document.getElementById('settings-overlay');
    var settingsCloseBtn = document.getElementById('settings-close');
    var settingsTabs = document.querySelectorAll('.settings-tab');
    var settingsSections = document.querySelectorAll('.settings-section');

    var taxSlider = document.getElementById('settings-tax-rate');
    var taxValueEl = document.getElementById('settings-tax-value');
    var taxLabelEl = document.getElementById('settings-tax-label');
    var cityNameInput = document.getElementById('settings-city-name');

    function showSettingsMessage(id, text, isSuccess) {
        var el = document.getElementById(id);
        if (!el) {
            return;
        }
        el.textContent = text;
        el.classList.toggle('success', !!isSuccess);
        el.classList.add('visible');
    }

    function clearSettingsMessage(id) {
        var el = document.getElementById(id);
        if (el) {
            el.textContent = '';
            el.classList.remove('visible', 'success');
        }
    }

    function switchSettingsPanel(panel) {
        settingsTabs.forEach(function (tab) {
            tab.classList.toggle('active', tab.dataset.panel === panel);
        });
        settingsSections.forEach(function (section) {
            section.classList.toggle('hidden', section.dataset.panel !== panel);
        });
    }

    settingsTabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
            switchSettingsPanel(tab.dataset.panel);
        });
    });

    /**
     * Local mirror of taxRateLabel() in includes/economy.php, so dragging the
     * slider explains the trade-off immediately instead of only after saving.
     */
    function describeTaxRate(rate) {
        if (rate <= 0.04) { return 'Very low — the city fills up fast but collects almost nothing.'; }
        if (rate <= 0.10) { return 'Low — steady growth with modest revenue.'; }
        if (rate <= 0.16) { return 'Balanced — good revenue, mild pressure on new arrivals.'; }
        if (rate <= 0.23) { return 'High — strong revenue, but residents start leaving.'; }
        return 'Punishing — the city empties out quickly.';
    }

    function setMoneyStat(id, amount) {
        var el = document.getElementById(id);
        if (!el) {
            return;
        }
        var value = Number(amount) || 0;
        // Sign goes before the currency symbol, so -56 reads "-₹56" not "₹-56".
        var sign = value > 0 ? '+' : (value < 0 ? '-' : '');
        el.textContent = sign + formatCost(Math.abs(value));
        el.classList.toggle('is-positive', value > 0);
        el.classList.toggle('is-negative', value < 0);
    }

    function setPlainStat(id, text) {
        var el = document.getElementById(id);
        if (el) {
            el.textContent = text;
        }
    }

    function populateSettings() {
        var state = window.__smartCity;

        if (state && state.city) {
            if (cityNameInput) {
                cityNameInput.value = state.city.name || '';
            }
            var rate = Number(state.city.tax_rate);
            if (!isNaN(rate) && taxSlider) {
                taxSlider.value = String(Math.round(rate * 100));
                updateTaxDisplay();
            }
            setPlainStat('settings-population', String(state.city.population));
        }

        if (state && state.economy) {
            var e = state.economy;
            setPlainStat('settings-capacity', String(e.housing_capacity));
            setPlainStat('settings-pop-target', String(e.population_target));
            setMoneyStat('settings-income', e.building_income);
            setMoneyStat('settings-tax-revenue', e.tax_revenue);
            setMoneyStat('settings-upkeep', -Math.abs(Number(e.upkeep) || 0));
            setMoneyStat('settings-net', e.net_per_tick);
        }

        // Profile fields come from the session endpoint.
        apiFetch('api/me.php', { credentials: 'same-origin' })
            .then(function (response) { return response.json(); })
            .then(function (body) {
                if (body.status !== 'success') {
                    return;
                }
                var nameEl = document.getElementById('settings-name');
                var emailEl = document.getElementById('settings-email');
                if (nameEl) { nameEl.value = body.data.name || ''; }
                if (emailEl) { emailEl.value = body.data.email || ''; }
            })
            .catch(function () { /* leave the fields blank if this fails */ });
    }

    function updateTaxDisplay() {
        if (!taxSlider) {
            return;
        }
        var percent = Number(taxSlider.value);
        if (taxValueEl) {
            taxValueEl.textContent = percent + '%';
        }
        if (taxLabelEl) {
            taxLabelEl.textContent = describeTaxRate(percent / 100);
        }
    }

    if (taxSlider) {
        taxSlider.addEventListener('input', updateTaxDisplay);
    }

    function openSettings() {
        clearSettingsMessage('settings-economy-message');
        clearSettingsMessage('settings-profile-message');
        clearSettingsMessage('settings-password-message');
        populateSettings();
        switchSettingsPanel('economy');
        settingsOverlay.classList.remove('hidden');
    }

    function closeSettings() {
        settingsOverlay.classList.add('hidden');
    }

    if (settingsBtn) {
        settingsBtn.addEventListener('click', openSettings);
    }

    if (settingsCloseBtn) {
        settingsCloseBtn.addEventListener('click', closeSettings);
    }

    if (settingsOverlay) {
        settingsOverlay.addEventListener('click', function (event) {
            if (event.target === settingsOverlay) {
                closeSettings();
            }
        });
    }

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && settingsOverlay && !settingsOverlay.classList.contains('hidden')) {
            closeSettings();
        }
    });

    // City & economy form
    var citySettingsForm = document.getElementById('city-settings-form');
    if (citySettingsForm) {
        citySettingsForm.addEventListener('submit', function (event) {
            event.preventDefault();
            clearSettingsMessage('settings-economy-message');

            var payload = {
                name: cityNameInput ? cityNameInput.value.trim() : '',
                tax_rate: taxSlider ? Number(taxSlider.value) / 100 : 0.1,
            };

            apiFetch('api/city-settings.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
                .then(function (response) { return response.json(); })
                .then(function (body) {
                    if (body.status === 'success') {
                        showSettingsMessage('settings-economy-message', body.message, true);
                        if (hudTax) {
                            hudTax.textContent = Math.round(body.data.tax_rate * 100) + '%';
                        }
                        if (taxLabelEl) {
                            taxLabelEl.textContent = body.data.tax_label;
                        }
                        // Pull fresh figures so the readout reflects the new rate.
                        loadCity();
                        setTimeout(populateSettings, 600);
                    } else {
                        showSettingsMessage('settings-economy-message', body.message || 'Could not save.', false);
                    }
                })
                .catch(function () {
                    showSettingsMessage('settings-economy-message', 'Network error. Please try again.', false);
                });
        });
    }

    // Profile form
    var profileForm = document.getElementById('profile-settings-form');
    if (profileForm) {
        profileForm.addEventListener('submit', function (event) {
            event.preventDefault();
            clearSettingsMessage('settings-profile-message');

            var payload = {
                name: document.getElementById('settings-name').value.trim(),
                email: document.getElementById('settings-email').value.trim(),
            };

            apiFetch('api/account-update.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
                .then(function (response) { return response.json(); })
                .then(function (body) {
                    showSettingsMessage(
                        'settings-profile-message',
                        body.status === 'success' ? body.message : (body.message || 'Could not save.'),
                        body.status === 'success'
                    );
                })
                .catch(function () {
                    showSettingsMessage('settings-profile-message', 'Network error. Please try again.', false);
                });
        });
    }

    // Password form
    var passwordForm = document.getElementById('password-settings-form');
    if (passwordForm) {
        passwordForm.addEventListener('submit', function (event) {
            event.preventDefault();
            clearSettingsMessage('settings-password-message');

            var current = document.getElementById('settings-current-password').value;
            var next = document.getElementById('settings-new-password').value;
            var confirm = document.getElementById('settings-confirm-password').value;

            if (next !== confirm) {
                showSettingsMessage('settings-password-message', 'The two new passwords do not match.', false);
                return;
            }

            apiFetch('api/password-change.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ current_password: current, new_password: next }),
            })
                .then(function (response) { return response.json(); })
                .then(function (body) {
                    if (body.status === 'success') {
                        passwordForm.reset();
                        showSettingsMessage('settings-password-message', body.message, true);
                    } else {
                        showSettingsMessage('settings-password-message', body.message || 'Could not change password.', false);
                    }
                })
                .catch(function () {
                    showSettingsMessage('settings-password-message', 'Network error. Please try again.', false);
                });
        });
    }
})();
