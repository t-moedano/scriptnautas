// ==UserScript==
// @name         Neopets: Rastreador de Livros & Marcador de Lojas
// @namespace    https://github.com/t-moedano/scriptnautas
// @version      1.0.0
// @description  Rastreia livros lidos (normais e Booktastic) e destaca livros não lidos em lojas oficiais ou marca livros já lidos em lojas de usuários no Neopets.
// @author       t-moedano
// @match        https://www.neopets.com/books_read.phtml*
// @match        https://www.neopets.com/objects.phtml?*type=shop*
// @match        https://www.neopets.com/browseshop.phtml*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=neopets.com
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-book-tracker/neopets-book-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-book-tracker/neopets-book-tracker.user.js
// @supportURL   https://github.com/t-moedano/scriptnautas/issues
// @homepageURL  https://github.com/t-moedano/scriptnautas
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'neopets_books_storage_v3';

    // IDs de lojas oficiais que vendem exclusivamente livros / pergaminhos
    const OFFICIAL_BOOK_SHOPS = {
        7:   'Magical Bookshop',
        38:  'Faerieland Bookshop',
        51:  "Sutek's Scrolls",
        70:  'Booktastic Books',
        77:  'Brightvale Books',
        92:  'Words of Antiquity',
        106: 'Neovian Printing Press',
        114: 'Moltaran Books'
    };

    // Normalização para comparação sem problemas de case e pontuação especial
    function normalizeTitle(text) {
        if (!text) return '';
        return text
            .replace(/^[\d]+\.\s*/, '') // Remove numeração "1. ", "2. "
            .replace(/[\u2018\u2019']/g, "'") // Padroniza apóstrofos
            .replace(/[\u201C\u201D"]/g, '"') // Padroniza aspas
            .trim()
            .toLowerCase();
    }

    // Carrega dados salvos
    function loadStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return { pets: {}, activePet: null };
            return JSON.parse(raw);
        } catch (e) {
            console.error('[Scriptnautas] Erro ao carregar localStorage:', e);
            return { pets: {}, activePet: null };
        }
    }

    // Salva dados no localStorage
    function saveStorage(data) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.error('[Scriptnautas] Erro ao salvar no localStorage:', e);
        }
    }

    // Retorna a URL atual e parâmetros
    const currentUrl = new URL(window.location.href);
    const pathname = currentUrl.pathname;
    const searchParams = currentUrl.searchParams;

    // Injeta estilos CSS para os marcadores
    function injectStyles() {
        if (document.getElementById('scriptnautas-book-styles')) return;
        const style = document.createElement('style');
        style.id = 'scriptnautas-book-styles';
        style.textContent = `
            .sn-badge-unread {
                position: absolute;
                top: 4px;
                right: 4px;
                background: #16a34a;
                color: #ffffff;
                font-weight: 800;
                font-size: 10px;
                padding: 3px 6px;
                border-radius: 9999px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                z-index: 10;
                pointer-events: none;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .sn-badge-read {
                position: absolute;
                top: 4px;
                right: 4px;
                background: #4b5563;
                color: #e5e7eb;
                font-weight: 700;
                font-size: 10px;
                padding: 2px 6px;
                border-radius: 9999px;
                z-index: 10;
                pointer-events: none;
            }
            .sn-item-unread {
                outline: 3px solid #22c55e !important;
                background: rgba(34, 197, 94, 0.12) !important;
                border-radius: 8px !important;
                box-shadow: 0 0 12px rgba(34, 197, 94, 0.45) !important;
                position: relative !important;
                transition: transform 0.15s ease, box-shadow 0.15s ease;
            }
            .sn-item-unread:hover {
                transform: translateY(-2px);
                box-shadow: 0 0 16px rgba(34, 197, 94, 0.7) !important;
            }
            .sn-item-read {
                opacity: 0.38 !important;
                filter: grayscale(85%) !important;
                position: relative !important;
                transition: opacity 0.2s ease, filter 0.2s ease;
            }
            .sn-item-read:hover {
                opacity: 0.85 !important;
                filter: grayscale(0%) !important;
            }
            .sn-status-floating {
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
                gap: 8px;
            }
            .sn-status-floating a {
                color: #38bdf8;
                text-decoration: underline;
                font-weight: 600;
            }
        `;
        document.head.appendChild(style);
    }

    // =========================================================================
    // 1. PÁGINA DE LIVROS LIDOS (books_read.phtml)
    // =========================================================================
    if (pathname.includes('books_read.phtml')) {
        injectStyles();

        setTimeout(() => {
            let petName = searchParams.get('pet_name') || '';
            const isBooktastic = searchParams.get('tab') === 'booktastic';
            const tabKey = isBooktastic ? 'booktastic' : 'regular';
            const bookTitles = new Set();

            // 1.1 Tentar extrair do objeto global de configuração da página (Vue.js Neopets moderno)
            const pageConfig = window.__booksReadConfig;
            if (pageConfig) {
                if (pageConfig.currentPet && !petName) {
                    petName = pageConfig.currentPet;
                }
                if (Array.isArray(pageConfig.books)) {
                    pageConfig.books.forEach(b => {
                        if (b && b.name) bookTitles.add(b.name.trim());
                    });
                }
            }

            // 1.2 Fallback: Tentar extrair via script tags se window.__booksReadConfig não estiver no escopo direto
            if (bookTitles.size === 0) {
                const scripts = document.querySelectorAll('script');
                for (const s of scripts) {
                    const text = s.textContent || '';
                    if (text.includes('__booksReadConfig')) {
                        const match = text.match(/__booksReadConfig\s*=\s*(\{.+?\});/s);
                        if (match && match[1]) {
                            try {
                                const parsed = JSON.parse(match[1]);
                                if (parsed.currentPet && !petName) petName = parsed.currentPet;
                                if (Array.isArray(parsed.books)) {
                                    parsed.books.forEach(b => {
                                        if (b && b.name) bookTitles.add(b.name.trim());
                                    });
                                }
                            } catch (e) {
                                console.warn('[Scriptnautas] Falha no parse do script config:', e);
                            }
                        }
                    }
                }
            }

            // 1.3 Fallback: Leitura direta do DOM (Tabelas clássicas ou divs)
            if (bookTitles.size === 0) {
                const legacyElements = document.querySelectorAll('table td b, .content td b, .grid-item b');
                legacyElements.forEach(el => {
                    const txt = el.textContent ? el.textContent.trim() : '';
                    if (txt && !txt.match(/^[0-9]+$/) && txt.length > 2) {
                        bookTitles.add(txt);
                    }
                });
            }

            if (!petName) {
                const petTitle = document.querySelector('.content h2, .header-text, title');
                if (petTitle && petTitle.textContent) {
                    const m = petTitle.textContent.match(/pet_name=([a-zA-Z0-9_]+)/) || petTitle.textContent.match(/([a-zA-Z0-9_]+)\s+(has read|já leu)/i);
                    if (m && m[1]) petName = m[1];
                }
            }

            if (!petName) petName = 'Neopet';

            // Salva no banco local
            const storage = loadStorage();
            if (!storage.pets[petName]) {
                storage.pets[petName] = { regular: [], booktastic: [], lastUpdated: 0 };
            }

            const currentList = Array.from(bookTitles);
            storage.pets[petName][tabKey] = currentList;
            storage.pets[petName].lastUpdated = Date.now();
            storage.activePet = petName;
            saveStorage(storage);

            // Notificação visual no topo da página
            const banner = document.createElement('div');
            banner.style.cssText = `
                background: #065f46;
                color: #ecfdf5;
                padding: 12px 18px;
                border-radius: 8px;
                margin: 15px auto;
                max-width: 780px;
                text-align: center;
                font-family: system-ui, sans-serif;
                font-size: 14px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.15);
                border: 1px solid #10b981;
            `;
            const tabName = isBooktastic ? 'Booktastic' : 'Livros Padrão';
            banner.innerHTML = `
                <strong>📚 Scriptnautas:</strong> Sincronizado com sucesso! Foram salvos <strong>${currentList.length}</strong> livros da aba <em>${tabName}</em> para <strong>${petName}</strong>.
            `;
            const mainContainer = document.querySelector('.content, #container, .page-content') || document.body;
            mainContainer.insertBefore(banner, mainContainer.firstChild);

            console.log(`[Scriptnautas] ${currentList.length} livros salvos para ${petName} (${tabKey}).`);
        }, 350);
    }

    // =========================================================================
    // 2. LOJAS OFICIAIS DE LIVROS (objects.phtml?type=shop&obj_type=...)
    // =========================================================================
    else if (pathname.includes('objects.phtml') && searchParams.get('type') === 'shop') {
        const objType = parseInt(searchParams.get('obj_type'), 10);

        // Somente executa se for uma das lojas oficiais de livros homologadas
        if (OFFICIAL_BOOK_SHOPS[objType]) {
            injectStyles();

            const storage = loadStorage();
            const activePet = storage.activePet;
            const petData = activePet && storage.pets[activePet] ? storage.pets[activePet] : null;

            // Une os livros normais e booktastic em um conjunto normalizado
            const readBooksSet = new Set();
            if (petData) {
                (petData.regular || []).forEach(b => readBooksSet.add(normalizeTitle(b)));
                (petData.booktastic || []).forEach(b => readBooksSet.add(normalizeTitle(b)));
            }

            function processOfficialShopItems() {
                // Layout moderno do Neopets (.shop-item)
                const modernItems = document.querySelectorAll('.shop-item:not([data-sn-checked])');
                modernItems.forEach(item => {
                    item.setAttribute('data-sn-checked', 'true');
                    const img = item.querySelector('.item-img');
                    const nameEl = item.querySelector('.item-name b, .item-name');
                    const itemName = img?.getAttribute('data-name') || nameEl?.textContent || '';
                    if (!itemName) return;

                    const isRead = readBooksSet.has(normalizeTitle(itemName));

                    if (isRead) {
                        item.classList.add('sn-item-read');
                        const badge = document.createElement('span');
                        badge.className = 'sn-badge-read';
                        badge.textContent = '✓ Lido';
                        item.appendChild(badge);
                    } else {
                        item.classList.add('sn-item-unread');
                        const badge = document.createElement('span');
                        badge.className = 'sn-badge-unread';
                        badge.textContent = '⭐ NÃO LIDO';
                        item.appendChild(badge);
                    }
                });

                // Layout clássico (tabela de itens)
                const legacyLinks = document.querySelectorAll('a[href*="haggle.phtml"]:not([data-sn-checked])');
                legacyLinks.forEach(link => {
                    link.setAttribute('data-sn-checked', 'true');
                    const cell = link.closest('td');
                    if (!cell) return;

                    const nameEl = cell.querySelector('b');
                    const itemName = nameEl ? nameEl.textContent : '';
                    if (!itemName) return;

                    const isRead = readBooksSet.has(normalizeTitle(itemName));
                    if (isRead) {
                        cell.classList.add('sn-item-read');
                    } else {
                        cell.classList.add('sn-item-unread');
                    }
                });
            }

            processOfficialShopItems();

            // Badge flutuante de status
            renderFloatingBadge(activePet, petData, OFFICIAL_BOOK_SHOPS[objType]);
        }
    }

    // =========================================================================
    // 3. LOJAS DE USUÁRIOS (browseshop.phtml)
    // =========================================================================
    else if (pathname.includes('browseshop.phtml')) {
        injectStyles();

        const storage = loadStorage();
        const activePet = storage.activePet;
        const petData = activePet && storage.pets[activePet] ? storage.pets[activePet] : null;

        const readBooksSet = new Set();
        if (petData) {
            (petData.regular || []).forEach(b => readBooksSet.add(normalizeTitle(b)));
            (petData.booktastic || []).forEach(b => readBooksSet.add(normalizeTitle(b)));
        }

        function processUserShopItems() {
            // Layout moderno de loja de usuário (.bsp-item)
            const modernItems = document.querySelectorAll('.bsp-item:not([data-sn-checked])');
            modernItems.forEach(item => {
                item.setAttribute('data-sn-checked', 'true');
                const btn = item.querySelector('.bsp-item__buy');
                const nameSpan = item.querySelector('.bsp-item__name');
                const itemName = btn?.getAttribute('data-name') || nameSpan?.textContent || '';
                if (!itemName) return;

                // REGRA ESTREITA: Apenas se o item for CONFIRMADO como já lido nós apagamos.
                // Itens não lidos permanecem inalterados pois podem ser brinquedos, comida, etc.
                if (readBooksSet.has(normalizeTitle(itemName))) {
                    item.classList.add('sn-item-read');
                    const badge = document.createElement('span');
                    badge.className = 'sn-badge-read';
                    badge.textContent = '✓ Já Lido';
                    item.appendChild(badge);
                }
            });

            // Layout clássico de loja de usuário (tabelas com links para buy_item.phtml)
            const legacyLinks = document.querySelectorAll('a[href*="buy_item.phtml"]:not([data-sn-checked])');
            legacyLinks.forEach(link => {
                link.setAttribute('data-sn-checked', 'true');
                const cell = link.closest('td');
                if (!cell) return;

                const nameEl = cell.querySelector('b');
                const itemName = nameEl ? nameEl.textContent : '';
                if (!itemName) return;

                if (readBooksSet.has(normalizeTitle(itemName))) {
                    cell.classList.add('sn-item-read');
                }
            });
        }

        processUserShopItems();

        // Observa atualizações dinâmicas (ex: paginação AJAX ou busca sem recarregar tela)
        const gridRegion = document.getElementById('bsp-grid-region') || document.body;
        const observer = new MutationObserver(() => {
            processUserShopItems();
        });
        observer.observe(gridRegion, { childList: true, subtree: true });

        // Badge flutuante de status
        renderFloatingBadge(activePet, petData, 'Loja de Usuário');
    }

    // =========================================================================
    // COMPONENTE: Badge Flutuante de Informação
    // =========================================================================
    function renderFloatingBadge(petName, petData, shopName) {
        if (document.getElementById('scriptnautas-status-badge')) return;

        const badge = document.createElement('div');
        badge.id = 'scriptnautas-status-badge';
        badge.className = 'sn-status-floating';

        if (!petName || !petData) {
            badge.innerHTML = `
                <span>⚠️ <strong>Scriptnautas:</strong> Nenhum pet sincronizado.</span>
                <a href="/books_read.phtml" target="_blank">Abrir Lista de Livros</a>
            `;
        } else {
            const regCount = (petData.regular || []).length;
            const bookCount = (petData.booktastic || []).length;
            const total = regCount + bookCount;
            badge.innerHTML = `
                <span>📖 <strong>${petName}</strong>: ${total} livros lidos (${regCount} normais, ${bookCount} booktastic)</span>
                <span style="color: #9ca3af;">•</span>
                <a href="/books_read.phtml?pet_name=${encodeURIComponent(petName)}" title="Atualizar lista de livros">Sincronizar</a>
            `;
        }

        document.body.appendChild(badge);
    }
})();
