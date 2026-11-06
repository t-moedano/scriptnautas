// ==UserScript==
// @name         Neopets: Rastreador de Comidas Gourmet & Marcador de Lojas
// @namespace    https://github.com/t-moedano/scriptnautas
// @version      1.0.2
// @description  Rastreia comidas gourmet (r90-r100) comidas pelo seu Neopet e destaca itens gourmet faltantes nas 27 lojas oficiais de comida e em lojas de usuários, integrado ao itemDB.
// @author       t-moedano
// @match        *://*.neopets.com/gourmet_club.phtml*
// @match        *://*.neopets.com/objects.phtml?*type=shop*
// @match        *://*.neopets.com/browseshop.phtml*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=neopets.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      itemdb.com.br
// @connect      neopets.com
// @connect      www.neopets.com
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-gourmet-tracker/neopets-gourmet-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-gourmet-tracker/neopets-gourmet-tracker.user.js
// @supportURL   https://github.com/t-moedano/scriptnautas/issues
// @homepageURL  https://github.com/t-moedano/scriptnautas
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'neopets_gourmet_storage_v1';
    const ITEMDB_API_URL = 'https://itemdb.com.br/api/v1/lists/official/gourmet-food/itemdata';
    const CATALOG_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias em milissegundos

    // 27 Lojas Oficiais de Comida do Neopets homologadas
    const OFFICIAL_FOOD_SHOPS = {
        1:   'Neopian Fresh Foods',
        14:  'Chocolate Factory',
        15:  'Bakery',
        16:  'Health Food Shop',
        18:  'Smoothie Store',
        20:  'Tropical Food Shop',
        22:  "Grundo's Cafe",
        30:  'Spooky Food',
        34:  'Tyrannian Cafe',
        35:  'Slushie Shop',
        37:  'Super Happy Icy Fun Snow Shop',
        39:  'Faerie Foods',
        42:  'Tyrannian Food',
        46:  "Hubert's Hot Dogs",
        47:  'Pizzaroo',
        49:  'Neopian Health Foods',
        56:  'Merifoods',
        62:  'Jelly Foods',
        63:  'Ice Cream Cart',
        66:  'Kiko Lake Treats',
        72:  'Exotic Foods',
        81:  'Qasalan Delights',
        90:  'Roo Island Coffee Shop',
        95:  'Exquisite Ambrosia',
        101: 'Moltaran Delicacies',
        105: 'The Crumpetmonger',
        112: 'The Coffee Cave'
    };

    // =========================================================================
    // UTILITÁRIOS DE TEXTO E HASH
    // =========================================================================

    function normalizeTitle(text) {
        if (!text) return '';
        return text
            .replace(/^[\d]+\.\s*/, '')
            .replace(/&amp;/gi, '&')
            .replace(/&#039;|&apos;/gi, "'")
            .replace(/&quot;/gi, '"')
            .replace(/[\u2018\u2019']/g, "'")
            .replace(/[\u201C\u201D"]/g, '"')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function extractItemHash(src) {
        if (!src) return null;
        const match = src.match(/\/items\/([^\/\.]+)\.(?:gif|png)/i);
        return match ? match[1].toLowerCase() : null;
    }

    function formatNumber(num) {
        if (num === null || num === undefined) return '0';
        return Number(num).toLocaleString('pt-BR');
    }

    // =========================================================================
    // DETECÇÃO DE PET ATIVO
    // =========================================================================

    function detectPageActivePet() {
        const petLink = document.querySelector('.nav-profile-dropdown-text a[href*="petlookup.phtml"], a[href*="quickref.phtml"]');
        if (petLink && petLink.textContent) {
            return petLink.textContent.trim();
        }
        const petImg = document.querySelector('.nav-pet-menu-icon__2020, #navProfilePet__2020');
        if (petImg && petImg.getAttribute('data-petname')) {
            return petImg.getAttribute('data-petname').trim();
        }
        return null;
    }

    // =========================================================================
    // GERENCIAMENTO DE STORAGE
    // =========================================================================

    function loadStorage() {
        try {
            let raw = null;
            if (typeof GM_getValue !== 'undefined') {
                raw = GM_getValue(STORAGE_KEY, null);
            }
            if (!raw) {
                raw = localStorage.getItem(STORAGE_KEY);
            }
            if (!raw) {
                return {
                    catalog: {
                        lastUpdated: 0,
                        itemCount: 0,
                        byName: {},
                        byImage: {}
                    },
                    pets: {},
                    selectedPet: null
                };
            }
            const parsed = JSON.parse(raw);
            if (!parsed.catalog) {
                parsed.catalog = { lastUpdated: 0, itemCount: 0, byName: {}, byImage: {} };
            }
            if (!parsed.pets) parsed.pets = {};
            return parsed;
        } catch (e) {
            console.error('[Scriptnautas Gourmet] Erro ao carregar dados:', e);
            return {
                catalog: { lastUpdated: 0, itemCount: 0, byName: {}, byImage: {} },
                pets: {},
                selectedPet: null
            };
        }
    }

    function saveStorage(storage) {
        try {
            const raw = JSON.stringify(storage);
            if (typeof GM_setValue !== 'undefined') {
                GM_setValue(STORAGE_KEY, raw);
            }
            try {
                localStorage.setItem(STORAGE_KEY, raw);
            } catch (ignore) {}
        } catch (e) {
            console.error('[Scriptnautas Gourmet] Erro ao salvar dados:', e);
        }
    }

    function resolveCurrentPet(storage) {
        const pagePet = detectPageActivePet();
        const candidateNames = [];
        if (pagePet) candidateNames.push(pagePet);
        if (storage.selectedPet) candidateNames.push(storage.selectedPet);

        const petKeys = Object.keys(storage.pets || {});

        for (const candidate of candidateNames) {
            if (storage.pets[candidate]) {
                return { name: candidate, data: storage.pets[candidate] };
            }
            const match = petKeys.find(k => k.toLowerCase() === candidate.toLowerCase());
            if (match) {
                return { name: match, data: storage.pets[match] };
            }
        }

        if (petKeys.length === 1) {
            const only = petKeys[0];
            return { name: only, data: storage.pets[only] };
        }

        return { name: candidateNames[0] || null, data: null };
    }

    // =========================================================================
    // INTEGRAÇÃO COM A API DO ITEMDB (CACHE INTELIGENTE)
    // =========================================================================

    function isCatalogValid(catalog) {
        if (!catalog || !catalog.itemCount || catalog.itemCount < 500) return false;
        const now = Date.now();
        if (now - (catalog.lastUpdated || 0) > CATALOG_CACHE_TTL_MS) return false;
        return true;
    }

    function fetchItemdbCatalog(force = false) {
        return new Promise((resolve, reject) => {
            const storage = loadStorage();
            if (!force && isCatalogValid(storage.catalog)) {
                return resolve(storage.catalog);
            }

            if (typeof GM_xmlhttpRequest === 'undefined') {
                console.warn('[Scriptnautas Gourmet] GM_xmlhttpRequest indisponível. Tentando fetch direto...');
                fetch(ITEMDB_API_URL)
                    .then(r => r.json())
                    .then(items => {
                        const newCatalog = processCatalogItems(items);
                        storage.catalog = newCatalog;
                        saveStorage(storage);
                        resolve(newCatalog);
                    })
                    .catch(err => reject(err));
                return;
            }

            GM_xmlhttpRequest({
                method: 'GET',
                url: ITEMDB_API_URL,
                headers: { 'Accept': 'application/json' },
                timeout: 30000,
                onload: function(response) {
                    try {
                        if (response.status >= 200 && response.status < 300) {
                            const items = JSON.parse(response.responseText);
                            const newCatalog = processCatalogItems(items);
                            storage.catalog = newCatalog;
                            saveStorage(storage);
                            resolve(newCatalog);
                        } else {
                            reject(new Error(`Status HTTP ${response.status} ao carregar itemDB`));
                        }
                    } catch (err) {
                        reject(err);
                    }
                },
                ontimeout: function() {
                    reject(new Error('Tempo limite esgotado ao contatar itemDB'));
                },
                onerror: function(err) {
                    reject(err);
                }
            });
        });
    }

    function processCatalogItems(items) {
        const byName = {};
        const byImage = {};

        if (Array.isArray(items)) {
            for (const item of items) {
                if (!item || !item.name) continue;

                const name = item.name.trim();
                const normName = normalizeTitle(name);
                const imageId = item.image_id ? String(item.image_id).toLowerCase().trim() : null;
                const rarity = item.rarity || 90;
                const priceValue = (item.price && typeof item.price.value === 'number') ? item.price.value : null;

                const entry = {
                    name: name,
                    image_id: imageId,
                    rarity: rarity,
                    price: priceValue
                };

                byName[normName] = entry;
                if (imageId) {
                    byImage[imageId] = entry;
                }
            }
        }

        return {
            lastUpdated: Date.now(),
            itemCount: Object.keys(byName).length,
            byName: byName,
            byImage: byImage
        };
    }

    // Consulta se um item é Gourmet e se o pet ativo já comeu
    function inspectFoodItem(itemName, itemSrc, catalog, petData) {
        if (!catalog || !catalog.byName) {
            return { isGourmet: false, hasEaten: false, gourmetInfo: null };
        }

        let gourmetInfo = null;
        const normName = itemName ? normalizeTitle(itemName) : null;
        const imageHash = itemSrc ? extractItemHash(itemSrc) : null;

        if (normName && catalog.byName[normName]) {
            gourmetInfo = catalog.byName[normName];
        } else if (imageHash && catalog.byImage && catalog.byImage[imageHash]) {
            gourmetInfo = catalog.byImage[imageHash];
        }

        if (!gourmetInfo) {
            return { isGourmet: false, hasEaten: false, gourmetInfo: null };
        }

        let hasEaten = false;
        if (petData) {
            if (imageHash && petData.eatenImages && petData.eatenImages.includes(imageHash)) {
                hasEaten = true;
            } else if (normName && petData.eatenNames && petData.eatenNames.includes(normName)) {
                hasEaten = true;
            } else if (gourmetInfo.image_id && petData.eatenImages && petData.eatenImages.includes(gourmetInfo.image_id)) {
                hasEaten = true;
            }
        }

        return {
            isGourmet: true,
            hasEaten: hasEaten,
            gourmetInfo: gourmetInfo
        };
    }

    // =========================================================================
    // ESTILOS VISUAIS
    // =========================================================================

    function injectStyles() {
        if (document.getElementById('scriptnautas-gourmet-styles')) return;
        const style = document.createElement('style');
        style.id = 'scriptnautas-gourmet-styles';
        style.textContent = `
            @keyframes snGlowGold {
                0% { box-shadow: 0 0 6px rgba(245, 158, 11, 0.5), inset 0 0 6px rgba(245, 158, 11, 0.2); }
                50% { box-shadow: 0 0 16px rgba(245, 158, 11, 0.85), inset 0 0 10px rgba(245, 158, 11, 0.4); }
                100% { box-shadow: 0 0 6px rgba(245, 158, 11, 0.5), inset 0 0 6px rgba(245, 158, 11, 0.2); }
            }

            .sn-gourmet-missing {
                outline: 3px solid #f59e0b !important;
                background: rgba(245, 158, 11, 0.12) !important;
                border-radius: 8px !important;
                animation: snGlowGold 2s infinite ease-in-out;
                position: relative !important;
                transition: transform 0.15s ease;
            }
            .sn-gourmet-missing:hover {
                transform: translateY(-2px);
                outline-color: #fbbf24 !important;
            }

            .sn-gourmet-eaten {
                opacity: 0.38 !important;
                filter: grayscale(80%) !important;
                position: relative !important;
                transition: opacity 0.2s ease, filter 0.2s ease;
            }
            .sn-gourmet-eaten:hover {
                opacity: 0.9 !important;
                filter: grayscale(0%) !important;
            }

            .sn-badge-gourmet-needed {
                position: absolute;
                top: 4px;
                right: 4px;
                background: linear-gradient(135deg, #d97706, #b45309);
                color: #ffffff;
                font-weight: 800;
                font-size: 10px;
                padding: 3px 7px;
                border-radius: 9999px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.4);
                z-index: 15;
                pointer-events: none;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                border: 1px solid #fbbf24;
                font-family: system-ui, sans-serif;
            }

            .sn-badge-gourmet-eaten {
                position: absolute;
                top: 4px;
                right: 4px;
                background: #4b5563;
                color: #e5e7eb;
                font-weight: 700;
                font-size: 10px;
                padding: 2px 6px;
                border-radius: 9999px;
                z-index: 15;
                pointer-events: none;
                font-family: system-ui, sans-serif;
            }


            .sn-floating-status {
                position: fixed;
                bottom: 16px;
                right: 16px;
                background: #111827;
                color: #f3f4f6;
                padding: 10px 14px;
                border-radius: 12px;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 12px;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
                border: 1px solid #374151;
                z-index: 999999;
                display: flex;
                align-items: center;
                gap: 10px;
                transition: bottom 0.25s ease;
            }
            .sn-floating-status a {
                color: #fbbf24;
                text-decoration: underline;
                font-weight: 600;
            }

            .sn-btn-action {
                background: #b45309;
                color: #ffffff;
                border: none;
                padding: 5px 10px;
                border-radius: 6px;
                font-weight: 600;
                font-size: 11px;
                cursor: pointer;
                transition: background 0.15s ease;
            }
            .sn-btn-action:hover {
                background: #d97706;
            }
        `;
        document.head.appendChild(style);
    }

    // =========================================================================
    // GERENCIADOR DE EMPILHAMENTO DOS WIDGETS FLUTUANTES (EVITA SOBREPOSIÇÃO)
    // =========================================================================
    function stackFloatingWidgets() {
        const selectors = [
            '#scriptnautas-status-badge', // Livros
            '#scriptnautas-stamp-badge',  // Selos
            '#sn-gourmet-floating-widget', // Gourmet
            '.sn-status-floating',
            '.sn-floating-status'
        ];

        const widgets = [];
        selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                if (!widgets.includes(el) && el.style.display !== 'none' && el.isConnected) {
                    widgets.push(el);
                }
            });
        });

        let currentBottom = 16;
        widgets.forEach(w => {
            w.style.bottom = `${currentBottom}px`;
            w.style.right = '16px';
            const h = w.offsetHeight || 44;
            currentBottom += h + 8; // 8px de respiro entre widgets
        });
    }

    const currentUrl = new URL(window.location.href);
    const pathname = currentUrl.pathname;
    const searchParams = currentUrl.searchParams;

    // =========================================================================
    // 1. PÁGINA DO GOURMET CLUB (gourmet_club.phtml)
    // =========================================================================
    if (pathname.includes('gourmet_club.phtml')) {
        injectStyles();

        let targetPet = searchParams.get('pet_name');
        if (!targetPet) {
            const petHeading = document.body.innerText.match(/([a-zA-Z0-9_-]+)\s+has\s+scored\s+(\d+)\s+Gourmet/i);
            if (petHeading) {
                targetPet = petHeading[1];
            } else {
                targetPet = detectPageActivePet();
            }
        }

        if (!targetPet) {
            console.warn('[Scriptnautas Gourmet] Nenhum Neopet especificado na página.');
            return;
        }

        let officialScore = null;
        const scoreMatch = document.body.innerText.match(/has\s+scored\s+(\d+)\s+Gourmet\s+Club\s+points/i);
        if (scoreMatch) {
            officialScore = parseInt(scoreMatch[1], 10);
        }

        const itemImgs = document.querySelectorAll('.content img[src*="/items/"], img[width="80"][src*="/items/"]');
        const eatenImageIds = [];
        const seenImages = new Set();

        itemImgs.forEach(img => {
            const src = img.getAttribute('src');
            const hash = extractItemHash(src);
            if (hash && !seenImages.has(hash)) {
                seenImages.add(hash);
                eatenImageIds.push(hash);
            }
        });

        const storage = loadStorage();
        if (!storage.pets) storage.pets = {};

        function renderSyncBanner(petName, eatenCount, catalogCount, isUpdatedNow = false) {
            const oldBanner = document.getElementById('sn-gourmet-sync-banner');
            if (oldBanner) oldBanner.remove();

            const banner = document.createElement('div');
            banner.id = 'sn-gourmet-sync-banner';
            banner.style.cssText = `
                background: linear-gradient(135deg, #78350f, #92400e);
                color: #fef3c7;
                border: 2px solid #f59e0b;
                border-radius: 12px;
                padding: 14px 18px;
                margin: 16px auto;
                max-width: 720px;
                box-shadow: 0 8px 16px rgba(0,0,0,0.4);
                font-family: system-ui, -apple-system, sans-serif;
                text-align: center;
                animation: snFadeIn 0.3s ease-out;
            `;

            banner.innerHTML = `
                <div style="font-size: 16px; font-weight: 800; margin-bottom: 6px; color: #fbbf24;">
                    🍽️ Scriptnautas: Comidas Gourmet Sincronizadas!
                </div>
                <div style="font-size: 13px; line-height: 1.5; color: #ffffff;">
                    Pet: <strong style="color: #fde047;">${petName}</strong> | 
                    Pontos Oficiais: <strong>${officialScore !== null ? officialScore : eatenCount}</strong> | 
                    Itens Identificados: <strong>${eatenCount}</strong>
                    <br>
                    <span style="font-size: 11px; color: #fef08a;">
                        Catálogo itemDB: <strong>${catalogCount}</strong> comidas gourmet conhecidas (r90-r100)
                    </span>
                </div>
                <div style="margin-top: 10px; display: flex; justify-content: center; gap: 8px;">
                    <button id="sn-btn-force-catalog" class="sn-btn-action" style="background: #d97706;">
                        🔄 Atualizar Catálogo do itemDB
                    </button>
                </div>
            `;

            const targetContainer = document.querySelector('.content') || document.body;
            targetContainer.insertBefore(banner, targetContainer.firstChild);

            document.getElementById('sn-btn-force-catalog').addEventListener('click', () => {
                banner.querySelector('div:nth-child(2)').innerHTML = '⏳ Baixando lista completa do itemDB...';
                fetchItemdbCatalog(true).then(newCat => {
                    persistPetData(newCat);
                    renderSyncBanner(petName, eatenCount, newCat.itemCount, true);
                }).catch(err => {
                    alert('Erro ao atualizar catálogo: ' + err.message);
                });
            });
        }

        function persistPetData(catalog) {
            const eatenNames = [];
            eatenImageIds.forEach(imgHash => {
                if (catalog && catalog.byImage && catalog.byImage[imgHash]) {
                    eatenNames.push(normalizeTitle(catalog.byImage[imgHash].name));
                }
            });

            storage.selectedPet = targetPet;
            storage.pets[targetPet] = {
                petName: targetPet,
                lastSync: Date.now(),
                officialPoints: officialScore !== null ? officialScore : eatenImageIds.length,
                eatenCount: eatenImageIds.length,
                eatenImages: eatenImageIds,
                eatenNames: eatenNames
            };
            saveStorage(storage);
        }

        if (isCatalogValid(storage.catalog)) {
            persistPetData(storage.catalog);
            renderSyncBanner(targetPet, eatenImageIds.length, storage.catalog.itemCount);
        } else {
            fetchItemdbCatalog(false).then(catalog => {
                persistPetData(catalog);
                renderSyncBanner(targetPet, eatenImageIds.length, catalog.itemCount);
            }).catch(err => {
                console.error('[Scriptnautas Gourmet] Falha ao carregar itemDB:', err);
                persistPetData(null);
                renderSyncBanner(targetPet, eatenImageIds.length, 0);
            });
        }

        renderFloatingWidget(storage);
    }

    // =========================================================================
    // 2. LOJAS OFICIAIS (objects.phtml?type=shop&obj_type=...)
    // =========================================================================
    else if (pathname.includes('objects.phtml')) {
        const objType = parseInt(searchParams.get('obj_type'), 10);
        const shopType = searchParams.get('type');

        if (shopType === 'shop' && OFFICIAL_FOOD_SHOPS[objType]) {
            injectStyles();
            const shopName = OFFICIAL_FOOD_SHOPS[objType];
            const storage = loadStorage();
            const currentPet = resolveCurrentPet(storage);

            function markOfficialShopItems() {
                const catalog = storage.catalog;
                const petData = currentPet.data;

                const itemCells = document.querySelectorAll('.content table td[align="center"], div.shop-item');

                itemCells.forEach(cell => {
                    if (cell.dataset.snGourmetChecked) return;

                    const img = cell.querySelector('img[src*="/items/"]');
                    if (!img) return;

                    const titleEl = cell.querySelector('b');
                    const rawName = titleEl ? titleEl.textContent.trim() : (img.getAttribute('alt') || img.getAttribute('title') || '');
                    const imgSrc = img.getAttribute('src');

                    const inspection = inspectFoodItem(rawName, imgSrc, catalog, petData);
                    cell.dataset.snGourmetChecked = 'true';

                    if (!inspection.isGourmet) return;

                    cell.style.position = 'relative';

                    if (inspection.hasEaten) {
                        cell.classList.add('sn-gourmet-eaten');
                        const badge = document.createElement('div');
                        badge.className = 'sn-badge-gourmet-eaten';
                        badge.textContent = '✓ Comido';
                        cell.appendChild(badge);
                    } else {
                        cell.classList.add('sn-gourmet-missing');

                        const badge = document.createElement('div');
                        badge.className = 'sn-badge-gourmet-needed';
                        const rarity = inspection.gourmetInfo ? inspection.gourmetInfo.rarity : 90;
                        badge.textContent = `⭐ GOURMET (r${rarity})`;
                        cell.appendChild(badge);
                    }
                });
            }

            if (isCatalogValid(storage.catalog)) {
                markOfficialShopItems();
            } else {
                fetchItemdbCatalog(false).then(() => {
                    markOfficialShopItems();
                }).catch(() => {
                    markOfficialShopItems();
                });
            }

            renderFloatingWidget(storage, shopName);
        }
    }

    // =========================================================================
    // 3. LOJAS DE USUÁRIOS (browseshop.phtml)
    // =========================================================================
    else if (pathname.includes('browseshop.phtml')) {
        injectStyles();
        const storage = loadStorage();
        const currentPet = resolveCurrentPet(storage);

        function markUserShopItems() {
            const catalog = storage.catalog;
            const petData = currentPet.data;

            // 1. Layout moderno de loja de usuário (.bsp-item)
            const modernItems = document.querySelectorAll('.bsp-item:not([data-sn-gourmet-checked])');
            modernItems.forEach(item => {
                item.setAttribute('data-sn-gourmet-checked', 'true');

                const btn = item.querySelector('.bsp-item__buy');
                const nameSpan = item.querySelector('.bsp-item__name');
                const img = item.querySelector('.bsp-item__image, img[src*="/items/"]');

                const rawName = btn?.getAttribute('data-name') || nameSpan?.textContent || '';
                const imgSrc = img?.getAttribute('src') || '';

                if (!rawName && !imgSrc) return;

                const inspection = inspectFoodItem(rawName, imgSrc, catalog, petData);
                if (!inspection.isGourmet) return; // Item comum: mantém neutro

                item.style.position = 'relative';

                if (inspection.hasEaten) {
                    item.classList.add('sn-gourmet-eaten');
                    const badge = document.createElement('span');
                    badge.className = 'sn-badge-gourmet-eaten';
                    badge.textContent = '✓ Comido';
                    item.appendChild(badge);
                } else {
                    item.classList.add('sn-gourmet-missing');

                    const badge = document.createElement('span');
                    badge.className = 'sn-badge-gourmet-needed';
                    const rarity = inspection.gourmetInfo ? inspection.gourmetInfo.rarity : 90;
                    badge.textContent = `⭐ GOURMET (r${rarity})`;
                    item.appendChild(badge);
                }
            });

            // 2. Layout clássico de loja de usuário (tabelas com links para buy_item.phtml)
            const buyLinks = document.querySelectorAll('a[href*="buy_item.phtml"]:not([data-sn-gourmet-checked])');
            buyLinks.forEach(link => {
                link.setAttribute('data-sn-gourmet-checked', 'true');
                const cell = link.closest('td') || link.parentElement;
                if (!cell) return;

                const boldEl = cell.querySelector('b');
                const img = cell.querySelector('img[src*="/items/"]');
                const rawName = boldEl ? boldEl.textContent.trim() : (img?.getAttribute('alt') || '');
                const imgSrc = img ? img.getAttribute('src') : '';

                if (!rawName && !imgSrc) return;

                const inspection = inspectFoodItem(rawName, imgSrc, catalog, petData);
                if (!inspection.isGourmet) return;

                cell.style.position = 'relative';

                if (inspection.hasEaten) {
                    cell.classList.add('sn-gourmet-eaten');
                    const badge = document.createElement('span');
                    badge.className = 'sn-badge-gourmet-eaten';
                    badge.textContent = '✓ Comido';
                    cell.appendChild(badge);
                } else {
                    cell.classList.add('sn-gourmet-missing');

                    const badge = document.createElement('span');
                    badge.className = 'sn-badge-gourmet-needed';
                    const rarity = inspection.gourmetInfo ? inspection.gourmetInfo.rarity : 90;
                    badge.textContent = `⭐ GOURMET (r${rarity})`;
                    cell.appendChild(badge);
                }
            });
        }

        // Executa com garantia de catálogo pronto
        if (isCatalogValid(storage.catalog)) {
            markUserShopItems();
        } else {
            fetchItemdbCatalog(false).then(() => {
                markUserShopItems();
            }).catch(() => {
                markUserShopItems();
            });
        }

        // Observa recarregamentos AJAX, paginação e buscas no Shop Wizard
        const gridRegion = document.getElementById('bsp-grid-region') ||
                           document.querySelector('.bsp-grid') ||
                           document.querySelector('.content') ||
                           document.body;

        const observer = new MutationObserver(() => markUserShopItems());
        observer.observe(gridRegion, { childList: true, subtree: true });

        renderFloatingWidget(storage, 'Loja de Usuário');
    }

    // =========================================================================
    // WIDGET FLUTUANTE INFORMATIVO COM AUTO-EMPILHAMENTO
    // =========================================================================

    function renderFloatingWidget(storage, contextTitle = null) {
        const oldWidget = document.getElementById('sn-gourmet-floating-widget');
        if (oldWidget) oldWidget.remove();

        const currentPet = resolveCurrentPet(storage);
        const petName = currentPet.name || 'Nenhum';
        const eatenCount = currentPet.data ? currentPet.data.eatenCount : 0;

        const widget = document.createElement('div');
        widget.id = 'sn-gourmet-floating-widget';
        widget.className = 'sn-floating-status';

        let html = `
            <div style="font-size: 16px;">🍽️</div>
            <div>
                <div style="font-weight: 700; color: #fbbf24;">Gourmet Tracker</div>
                <div style="font-size: 11px; color: #d1d5db;">
                    Pet: <strong>${petName}</strong> (${eatenCount} comidos)
                </div>
            </div>
        `;

        if (!currentPet.data) {
            html += `
                <a href="/gourmet_club.phtml?pet_name=${encodeURIComponent(petName)}" style="font-size: 11px;">
                    Sincronizar
                </a>
            `;
        } else {
            html += `
                <a href="/gourmet_club.phtml?pet_name=${encodeURIComponent(petName)}" title="Abrir página do Gourmet Club" style="font-size: 11px;">
                    Ver Club
                </a>
            `;
        }

        html += `
            <span id="sn-gourmet-close-widget" style="margin-left: 6px; cursor: pointer; color: #9ca3af; font-size: 14px; line-height: 1;" title="Ocultar nesta página">
                &times;
            </span>
        `;

        widget.innerHTML = html;
        document.body.appendChild(widget);

        const closeBtn = widget.querySelector('#sn-gourmet-close-widget');
        if (closeBtn) {
            closeBtn.onclick = () => {
                widget.remove();
                stackFloatingWidgets();
            };
        }

        // Executa auto-empilhamento para evitar sobreposição de outros scripts
        stackFloatingWidgets();
        setTimeout(stackFloatingWidgets, 100);
        setTimeout(stackFloatingWidgets, 400);
        setTimeout(stackFloatingWidgets, 1200);

        window.addEventListener('resize', stackFloatingWidgets);
    }

})();
