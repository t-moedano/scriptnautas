// ==UserScript==
// @name         Neopets: Bonde da Maromba (Auto Trainer)
// @namespace    https://github.com/t-moedano/scriptnautas
// @license      GPL-3.0
// @version      1.2.0
// @description  Treina seus pets automaticamente nas escolas de treino do Neopets (com suporte a Codestones e Dubloons no SDB) e exibe frases de maromba dinâmicas durante o treino.
// @author       t-moedano (baseado em Karla's Auto Trainer, alienxp e matt)
// @match        *://*.neopets.com/island/training.phtml*
// @match        *://*.neopets.com/island/fight_training.phtml*
// @match        *://*.neopets.com/pirates/academy.phtml*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=neopets.com
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-bonde-da-maromba/neopets-bonde-da-maromba.user.js
// @downloadURL  https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-bonde-da-maromba/neopets-bonde-da-maromba.user.js
// @supportURL   https://github.com/t-moedano/scriptnautas/issues
// @homepageURL  https://github.com/t-moedano/scriptnautas
// ==/UserScript==
// Créditos:
// - Baseado em "Karla's Auto Trainer" 0.0.2 (GPL-3.0)
// - Modificações originais por alienxp (link/botão tokenizado de pagamento, SDB, compra única e parada em erro)
// - Alterações e criação do tema "Bonde da Maromba" por matt
// - Suporte a Dubloons no SDB, easter egg interativo e manutenção no Scriptnautas por t-moedano

(function () {
  "use strict";

  /* ======================================================================
   * Configuration
   * ==================================================================== */

  const ORIGIN = "https://www.neopets.com";

  const SCHOOLS = {
    pirate: {
      name: "Cap'n Threelegs' Swashbuckling Academy",
      page: "/pirates/academy.phtml",
      process: "/pirates/process_academy.phtml",
      payOnlyFirstItem: true,
    },
    island: {
      name: "Mystery Island Training School",
      page: "/island/training.phtml",
      process: "/island/process_training.phtml",
      payOnlyFirstItem: false,
    },
    ninja: {
      name: "Secret Ninja Training School",
      page: "/island/fight_training.phtml",
      process: "/island/process_fight_training.phtml",
      payOnlyFirstItem: false,
    },
  };

  const statusUrl = (key) => `${ORIGIN}${SCHOOLS[key].page}?type=status`;
  const coursesUrl = (key) => `${ORIGIN}${SCHOOLS[key].page}?type=courses`;

  const STATE = { IDLE: 0, UNPAID: 1, TRAINING: 2, DONE: 3, WATCHING: 4 };
  const STATE_LABELS = {
    [STATE.IDLE]: "Not enrolled",
    [STATE.UNPAID]: "Waiting for payment",
    [STATE.TRAINING]: "Training",
    [STATE.DONE]: "Done",
  };

  const IDLE_POLL_MS = 10000; // how often to look for a pet that needs attention
  const NETWORK_RETRY_MS = 20000; // wait before retrying after a network error
  const MAX_NETWORK_RETRIES = 3; // consecutive failures before a pet is stopped
  const UNKNOWN_TIME_FALLBACK_MS = 60000; // used when the site shows no readable timer
  const PHRASE_ROTATE_MS = 45000; // rotates gym-bro quotes automatically while training

  const PHRASES = {
    training: [
      "Eita Porr@ tá saindo da jaula o monstro!",
      "O segredo é o brócolis!",
      'Aqui "nóis" constrói FIBRA, NÃO É água com músculo!',
      "Um monstro treina como um, come como dois!",
      "É treino e dieta todo santo dia! Aeróbico é o c@ralho, viva a nossa ilha!",
      "Trapézio Descendente! É ele que eu vou buscar!",
      "BIRL! Hora do show, porr@!",
      "Boraaaa! É hora do Show!",
      "É o suco, pai!",
      "Shape não se constrói dormindo!",
      "Hoje é dia de ficar monstrão!",
      "O pai tá estourado!",
      "Projeto monstro não tira férias!",
      "O shape vem, pai!",
      "Pode aumentar a carga!",
      "Não existe tempo ruim pra quem quer ficar gigante!",
      "VEM MONSTRO!",
      "Oi, frango! Já treinou hoje?",
      "Quando você tiver um peitoral desse, aí a gente conversa!",
      "Em busca do shape inexplicável!",
      "Não vai dar não... QUE NÃO VAI DAR O QUÊ, RAPAZ?!",
      "37 anos de curso, 13 de treino, já tô virando mutante!",
      "Chama o médico que eu tô passando mal de tanto ganho!",
      "Natural é a planta, meu parceiro, aqui é à base de Faerie Quest e batata-doce!",
      "Comi 14 omeletes no pré-treino, agora ninguém me segura!",
      "Descansar entre séries? Só quando o servidor do Neopets cair!",
      "Hoje é treino de perna... brincadeira, só peito e bíceps igual todo dia!",
      "Level {lvl} ainda, {pet}? Bora subir esses números que não viemos a passeio!",
      "Já tô com {str} de força e ainda quero mais! Bota carga nisso aí!",
    ],
    unpaid: [
      "Cadê meu pré-treino?! Paga logo esse curso aí, chefia!",
      "Tô travado esperando o pagamento, o pump vai esfriar!",
      "Sem Codestone e sem Dubloon não tem shape — agiliza esse corre!",
      "Ô patrão, libera a ficha na catraca que o monstro quer treinar!",
      "Já aqueci os músculos, só falta pagar o instrutor!",
    ],
    done: [
      "TÁ PAGO! Mais +1 no shape, bora pro próximo!",
      "AUGE! Chama o fotógrafo que esse treino rendeu!",
      "MISSÃO CUMPRIDA! Pode mandar mais carga que o monstro tá pronto!",
      "BIRL! Mais forte que ontem, menor que amanhã!",
    ],
  };

  /* ======================================================================
   * Small helpers
   * ==================================================================== */

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const randomInRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const parseHTML = (html) => new DOMParser().parseFromString(html, "text/html");

  /** Thrown for problems that retrying would not fix (the pet is stopped right away). */
  class FatalError extends Error { }

  function parseTimeToMs(text) {
    const m = text.match(/(\d+)\s*hrs.*?(\d+)\s*minutes.*?(\d+)\s*seconds/i);
    if (!m) return null;
    return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
  }

  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return `${hours} hrs, ${minutes} minutes, ${total % 60} seconds`;
  }

  /* ======================================================================
   * Network
   * ==================================================================== */

  function request(url, { headers, ...options } = {}) {
    const target = url.startsWith("http") ? url : `${ORIGIN}/${url.replace(/^\//, "")}`;
    return fetch(target, {
      mode: "cors",
      credentials: "include",
      referrerPolicy: "strict-origin-when-cross-origin",
      ...options,
      headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", ...headers },
    });
  }

  async function fetchText(url, options) {
    const response = await request(url, options);
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
    return response.text();
  }

  async function fetchJson(url, options) {
    const response = await request(url, options);
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
    return response.json();
  }

  async function postForm(url, fields, referrer) {
    const response = await request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      referrer,
      body: new URLSearchParams(fields).toString(),
    });
    return response.text();
  }

  /** Always fetches a fresh copy of a school's status page. */
  const fetchStatusHtml = (key) => fetchText(statusUrl(key), { referrer: statusUrl(key), cache: "no-store" });

  /* ======================================================================
   * Safety Deposit Box
   * ==================================================================== */

  async function takeFromSDB(itemName, quantity = 1, pin = "") {
    const fail = (message) => ({ success: false, message });
    const pagePath = "/safetydeposit.phtml?obj_name=" + encodeURIComponent(itemName).replace(/%20/g, "+");
    const pageUrl = ORIGIN + pagePath;
    const ajaxHeaders = {
      accept: "*/*",
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    };
    const ajax = (path, payload) =>
      fetchJson(path, {
        method: "POST",
        headers: ajaxHeaders,
        referrer: pageUrl,
        body: JSON.stringify(payload),
      });

    const html = await fetchText(pagePath);
    const match = html.match(/window\.__sdbData\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!match) return fail("__sdbData not found on SDB page");
    const sdbData = new Function("return (" + match[1] + ")")();
    const refCk = sdbData.refCk;
    if (!refCk) return fail("refCk missing in __sdbData");

    await sleep(randomInRange(400, 900));
    const list = await ajax("/np-templates/ajax/safetydeposit/get-items.php", {
      page: 1,
      per_page: 90,
      search: itemName,
      category: "",
      sort: "",
      _ref_ck: refCk,
    });
    if (!list?.success) return fail("SDB get-items request failed");

    const wanted = itemName.trim().toLowerCase();
    const item = (list.data?.items || []).find(
      (it) => String(it.obj_name).replace(/&amp;/g, "&").trim().toLowerCase() === wanted,
    );
    if (!item) return fail(`"${itemName}" not found in SDB`);
    const itemId = Number(item.obj_id ?? item.id);
    const amount = Math.min(quantity, Number(item.amount) || 1);

    await sleep(randomInRange(400, 900));
    let pinRequired = !!sdbData.pinRequired;
    try {
      const status = await ajax("/np-templates/ajax/safetydeposit/pin-status.php", { _ref_ck: refCk });
      const required = status?.pin_required ?? status?.data?.pin_required;
      if (typeof required === "boolean") pinRequired = required;
    } catch { }
    if (pinRequired && !pin) return fail("SDB is PIN-protected - no PIN given");

    await sleep(randomInRange(400, 900));
    const moved = await ajax("/np-templates/ajax/safetydeposit/move-items.php", {
      moves: [{ obj_info_id: itemId, quantity: amount, action: "inventory" }],
      pin: pinRequired ? pin : "",
      _ref_ck: refCk,
    });
    if (!moved?.success) return fail(String(moved?.error || moved?.message || "SDB move-items request failed"));
    return { success: true, message: `Withdrew ${amount} x ${itemName}` };
  }

  /* ======================================================================
   * Shop Wizard + buying
   * ==================================================================== */

  async function searchShopWizard(itemName) {
    const html = await fetchText("/np-templates/ajax/wizard.php", {
      method: "POST",
      headers: {
        accept: "text/html, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
      },
      referrer: ORIGIN + "/shops/wizard.phtml",
      body:
        "type=process_wizard&feedset=0&shopwizard=" +
        encodeURIComponent(itemName) +
        "&table=shop&criteria=exact&min_price=0&max_price=999999",
    });
    const out = { results: [], banned: false, banMinutes: 0, faerieQuest: false };
    const doc = parseHTML(html);

    if (doc.querySelector(".wizard-faeriequest__2020")) {
      out.faerieQuest = true;
      return out;
    }
    if (html.includes("Whoa there, too many searches!")) {
      out.banned = true;
      const text = doc.querySelector(".wizard-char.wizard-char-single.wizard-char-old + p + p")?.textContent || "";
      const minutes = text.match(/in about (\d+) minutes/);
      out.banMinutes = minutes ? Number(minutes[1]) : 10;
      return out;
    }

    for (const row of doc.querySelectorAll(".wizard-results-grid li:not(.wizard-results-grid-header)")) {
      const anchor = row.querySelector("a");
      out.results.push({
        owner: anchor?.textContent.trim() || "",
        link: anchor?.getAttribute("href") || "",
        stock: Number(row.querySelector("p")?.textContent.replace(/[^\d]/g, "") || "1"),
        price: Number(
          row.querySelector(".wizard-results-price")?.textContent.replace(" NP", "").replace(/,/g, "") || "0",
        ),
      });
    }
    out.results.sort((a, b) => a.price - b.price);
    return out;
  }

  /** Buys the featured item of one shop. Resolves to { ok, message }. */
  async function buyFromShop(shopLink) {
    const wizardUrl = ORIGIN + "/shops/wizard.phtml";
    const shopHtml = await fetchText(shopLink, {
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      },
      referrer: wizardUrl,
    });
    const buyUrl = parseHTML(shopHtml).querySelector(".bsp-item--featured .bsp-item__buy")?.dataset.buyUrl;
    if (!buyUrl) return { ok: false, message: "Item is no longer available" };

    const response = await request(`${ORIGIN}${buyUrl}&ajax=1`, {
      headers: { accept: "*/*", "x-requested-with": "XMLHttpRequest" },
      referrer: shopLink,
    });
    const body = await response.text();
    let data = null;
    try {
      data = JSON.parse(body);
    } catch { }
    if (!data) {
      const text = parseHTML(body).body?.textContent.replace(/\s+/g, " ").trim() || "";
      return { ok: false, message: text.slice(0, 160) || `Purchase failed (HTTP ${response.status})` };
    }
    if (!data.success) return { ok: false, message: data.message || "Purchase failed" };
    return { ok: true, message: "Item bought!" };
  }

  /** Searches the Shop Wizard a few times, then buys from the cheapest shop that works. */
  async function buyItem(itemName, onStatus = () => { }) {
    const shops = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { results, banned, banMinutes, faerieQuest } = await searchShopWizard(itemName);
      if (faerieQuest) return false;
      if (banned) {
        if (shops.length > 0) break;
        onStatus(`Shop Wizard cooldown - waiting ${banMinutes + 2} min...`);
        await sleep((banMinutes + 2) * 60 * 1000);
        attempt -= 1;
        continue;
      }
      for (const result of results) {
        if (result.link && !shops.some((s) => s.link === result.link)) shops.push(result);
      }
      await sleep(randomInRange(700, 1200));
    }

    shops.sort((a, b) => a.price - b.price);
    for (const shop of shops) {
      try {
        if ((await buyFromShop(shop.link)).ok) return true;
      } catch (error) {
        console.log("[trainer] purchase attempt failed, trying the next shop:", error);
      }
      await sleep(randomInRange(1200, 1500));
    }
    return false;
  }

  const isTrainingCurrency = (itemName) =>
    itemName.includes("Codestone") || itemName.includes("Dubloon");

  /** Gets one copy of an item: from the SDB first (codestones and dubloons, if enabled), otherwise by buying it. */
  async function acquireItem(itemName, pet) {
    if (globalSettings.sdbFirst !== false && isTrainingCurrency(itemName)) {
      setStatus(pet, `Withdrawing ${itemName} from SDB...`);
      try {
        const result = await takeFromSDB(itemName, 1, globalSettings.pin || "");
        if (result.success) return true;
      } catch (error) {
        console.log("[trainer] SDB withdraw failed, buying instead:", error);
      }
      await sleep(randomInRange(500, 900));
    }
    setStatus(pet, `Buying ${itemName}...`);
    return buyItem(itemName, (message) => setStatus(pet, message));
  }

  /* ======================================================================
   * State
   * ==================================================================== */

  const settings = JSON.parse(GM_getValue("settings") || "{}");
  const globalSettings = JSON.parse(GM_getValue("global_settings") || "{}");
  let startedPets = JSON.parse(GM_getValue("started_pets") || "[]");

  const allPetState = {}; // petName -> { state, timeLeft, cost, payUrl, payForm }
  const petStats = {}; // petName -> { lvl, str, def, mov, hp }
  const busyElsewhere = {}; // petName -> school key where the pet is already training
  const halted = new Map(); // petName -> reason the pet was stopped
  const failures = new Map(); // petName -> consecutive network failures
  let school; // school key of the current page

  const saveStartedPets = () => GM_setValue("started_pets", JSON.stringify(startedPets));
  const saveSettings = () => GM_setValue("settings", JSON.stringify(settings));
  const saveGlobalSettings = () => GM_setValue("global_settings", JSON.stringify(globalSettings));

  function forEachStatusPet(root, callback) {
    root.querySelectorAll('td[colspan="2"]').forEach((header) => {
      const headerText = header.textContent.trim();
      const match = headerText.match(/^(\S+) \(Level \d+\) is /);
      if (!match) return;
      const nextRow = header.closest("tr")?.nextElementSibling;
      if (!nextRow) return;
      const cells = Array.from(nextRow.children).filter((el) => el.tagName === "TD");
      if (cells.length < 2) return;
      callback({ petName: match[1], headerText, statsCell: cells[0], actionCell: cells[1] });
    });
  }

  /** Looks at the other schools' status pages to learn which pets are already training there. */
  async function findPetsBusyElsewhere() {
    const others = Object.keys(SCHOOLS).filter((key) => key !== school);
    await Promise.all(
      others.map(async (key) => {
        try {
          const html = await fetchText(statusUrl(key));
          forEachStatusPet(parseHTML(html), ({ petName, headerText }) => {
            if (!headerText.includes("is not on a course")) busyElsewhere[petName] = key;
          });
        } catch (error) {
          console.log(`[trainer] could not check ${SCHOOLS[key].name}:`, error);
        }
      }),
    );
  }

  /** Reads the status page: pet stats plus what each pet is doing right now. */
  function updateData(html) {
    forEachStatusPet(parseHTML(html), ({ petName, statsCell, actionCell }) => {
      const statsText = statsCell.textContent;
      const read = (label) => Number((statsText.match(new RegExp(`${label}\\s*:\\s*(\\d+)`)) || [])[1] || 0);
      petStats[petName] = {
        lvl: read("Lvl"),
        str: read("Str"),
        def: read("Def"),
        mov: read("Mov"),
        hp: Number((statsText.match(/Hp\s*:\s*(\d+)\s*\/\s*(\d+)/) || [])[2] || 0),
      };

      // the page shows the normal time struck through next to the reduced one: ignore the struck-through
      actionCell.querySelectorAll(".strikethrough").forEach((el) => el.remove());
      const actionText = actionCell.textContent;

      if (actionCell.querySelector('input[value="Complete Course!"]')) {
        allPetState[petName] = { state: STATE.DONE };
      } else if (actionText.includes("Time till course finishes")) {
        allPetState[petName] = { state: STATE.TRAINING, timeLeft: parseTimeToMs(actionText) };
      } else if (
        actionCell.querySelector('input[value="Pay"]') ||
        actionText.includes("This course has not been paid for yet")
      ) {
        allPetState[petName] = {
          state: STATE.UNPAID,
          payUrl: actionCell.querySelector('a[href*="type=pay"]')?.getAttribute("href") || null,
          payForm: extractPayForm(actionCell),
          cost: Array.from(actionCell.querySelectorAll("b"))
            .map((el) => el.textContent.replace(/\s+/g, " ").trim())
            .filter((text) => isTrainingCurrency(text)),
        };
      } else {
        allPetState[petName] = { state: STATE.IDLE };
      }
    });
    renderStatuses();
  }

  /* ======================================================================
   * Gym-bro phrases (shuffled per mood, never the same phrase twice in a row)
   * ==================================================================== */

  const phraseBags = {};
  const lastPhrases = {};

  function nextPhrase(mood = "training") {
    const source = PHRASES[mood] || PHRASES.training;
    let bag = phraseBags[mood];
    if (!bag || bag.length === 0) {
      bag = [...source];
      for (let i = bag.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      // the next phrase is taken from the end: make sure it is not the one we just showed
      if (bag.length > 1 && bag[bag.length - 1] === lastPhrases[mood]) {
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      }
      phraseBags[mood] = bag;
    }
    const chosen = bag.pop();
    lastPhrases[mood] = chosen;
    return chosen;
  }

  function formatPhrase(template, pet) {
    const stats = petStats[pet] || {};
    return template
      .replace(/\{pet\}/g, pet)
      .replace(/\{lvl\}/g, String(stats.lvl ?? "?"))
      .replace(/\{str\}/g, String(stats.str ?? "?"));
  }

  /* ======================================================================
   * Panels (what you see in each pet's cell)
   * ==================================================================== */

  const panels = new Map(); // petName -> { status, phrase, phraseMood, phraseAt (0 = no phrase shown) }

  const STYLES = `
.bm-btn {
  --bm-accent: #f28500;
  --bm-accent-dark: #c96e00;
  appearance: none;
  -webkit-appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1.5px solid var(--bm-accent);
  border-radius: 6px;
  padding: 3px 10px;
  margin: 0;
  font-family: "MuseoSansRounded700", "Cerebri Sans", "Trebuchet MS", "Arial", sans-serif;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--bm-accent);
  background: #fff;
  cursor: pointer;
  user-select: none;
  vertical-align: middle;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.bm-btn:hover:not(:disabled) {
  background: rgba(242, 133, 0, 0.08);
  border-color: var(--bm-accent-dark);
  color: var(--bm-accent-dark);
}
.bm-btn:active:not(:disabled) { background: rgba(242, 133, 0, 0.16); }
.bm-btn:focus-visible { outline: 2px solid var(--bm-accent); outline-offset: 2px; }
.bm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.bm-phrase {
  margin-top: 6px;
  padding: 5px 8px;
  border-left: 3px solid #f28500;
  background: rgba(242, 133, 0, 0.06);
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.35;
  cursor: pointer;
  user-select: none;
}
.bm-phrase:empty { display: none; }
.bm-phrase b { color: #c96e00; }
`;

  function ensureStyles() {
    if (document.getElementById("bm-styles")) return;
    const style = document.createElement("style");
    style.id = "bm-styles";
    style.textContent = STYLES;
    (document.head || document.documentElement).appendChild(style);
  }

  function setStatus(pet, text) {
    const panel = panels.get(pet);
    if (panel) panel.status.textContent = text;
  }

  function showPhrase(pet, mood = "training") {
    const panel = panels.get(pet);
    if (!panel) return;
    const name = document.createElement("b");
    name.textContent = pet;
    const quote = document.createElement("i");
    quote.textContent = formatPhrase(nextPhrase(mood), pet);
    panel.phrase.replaceChildren("💪 ", name, " disse: ", quote);
    panel.phraseMood = mood;
    panel.phraseAt = Date.now();
  }

  function hidePhrase(pet) {
    const panel = panels.get(pet);
    if (!panel) return;
    panel.phrase.replaceChildren();
    panel.phraseMood = null;
    panel.phraseAt = 0;
  }

  function renderStatuses() {
    const moodByState = {
      [STATE.TRAINING]: "training",
      [STATE.WATCHING]: "training",
      [STATE.UNPAID]: "unpaid",
      [STATE.DONE]: "done",
    };
    for (const [pet, info] of Object.entries(allPetState)) {
      const panel = panels.get(pet);
      if (!panel) continue;
      if (halted.has(pet)) {
        panel.status.textContent = halted.get(pet);
        hidePhrase(pet);
        continue;
      }
      if (!(info.state in STATE_LABELS)) continue;
      panel.status.textContent =
        info.state === STATE.TRAINING && info.timeLeft
          ? `Training - ${formatTime(info.timeLeft)}`
          : STATE_LABELS[info.state];
      const mood = moodByState[info.state];
      if (mood) {
        if (!panel.phraseAt || panel.phraseMood !== mood) showPhrase(pet, mood);
      } else {
        hidePhrase(pet);
      }
    }
  }

  function makeButton(label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bm-btn";
    button.textContent = label;
    return button;
  }

  function buildControls(pet) {
    const box = document.createElement("div");
    const entry = startedPets.find((p) => p.petName === pet);

    if (busyElsewhere[pet]) {
      box.textContent = "Training at " + SCHOOLS[busyElsewhere[pet]].name;
      return box;
    }
    if (entry && entry.school !== school) {
      box.textContent = "Training at " + SCHOOLS[entry.school].name;
      return box;
    }

    box.innerHTML = `
<div>-- Auto Train Stats --</div>
  <div style="margin-top: 8px">
  <label><input name="hp" type="checkbox" /> Hp</label>
  <label><input name="str" type="checkbox" /> Str</label>
  <label><input name="def" type="checkbox" /> Def</label>
  <label><input name="mov" type="checkbox" /> Mov</label>
  <div style="margin-top: 4px"><label><input name="hp3x" type="checkbox" /> Hp 3x</label></div>
  <div style="margin-top: 8px"></div>
</div>`;
    const button = makeButton("");
    box.lastElementChild.lastElementChild.appendChild(button);

    const petSettings = settings[pet];
    const field = (name) => box.querySelector(`[name="${name}"]`);
    const statBoxes = ["hp", "str", "def", "mov"].map(field);
    const hp3x = field("hp3x");
    let started = !!entry;

    // Hp 3x replaces the individual stats, so they are locked while it is on
    const syncControls = () => {
      statBoxes.forEach((el) => {
        el.disabled = started || hp3x.checked;
      });
      hp3x.disabled = started;
      button.textContent = started ? "⏹️ Stop" : "▶️ Start";
    };

    for (const input of [...statBoxes, hp3x]) {
      input.checked = !!petSettings[input.name];
      input.addEventListener("change", () => {
        petSettings[input.name] = input.checked;
        if (input === hp3x && hp3x.checked) {
          statBoxes.forEach((el) => {
            el.checked = false;
            petSettings[el.name] = false;
          });
        }
        saveSettings();
        syncControls();
      });
    }

    button.addEventListener("click", () => {
      if (!startedPets.some((p) => p.petName === pet && p.school === school)) {
        halted.delete(pet);
        failures.delete(pet);
        startedPets.push({ petName: pet, school });
        started = true;
        renderStatuses();
      } else {
        startedPets = startedPets.filter((p) => p.petName !== pet);
        started = false;
      }
      syncControls();
      saveStartedPets();
    });

    panels.get(pet).setStarted = (value) => {
      started = value;
      syncControls();
    };
    syncControls();
    return box;
  }

  function setupGlobalPanel() {
    let table = null;
    forEachStatusPet(document, ({ statsCell }) => {
      if (!table) table = statsCell.closest("table");
    });
    if (!table || !table.parentNode) return;

    const box = document.createElement("div");
    box.style.margin = "8px 0";
    box.innerHTML =
      '<label><input type="checkbox" /> Use codestones &amp; dubloons from SDB first (all pets)</label>' +
      ' <label style="margin-left: 12px">SDB PIN <input type="password" maxlength="4" autocomplete="off" style="width: 50px" /></label>';

    const sdbFirst = box.querySelector('input[type="checkbox"]');
    sdbFirst.checked = globalSettings.sdbFirst !== false;
    sdbFirst.addEventListener("change", () => {
      globalSettings.sdbFirst = sdbFirst.checked;
      saveGlobalSettings();
    });

    const pin = box.querySelector('input[type="password"]');
    pin.value = globalSettings.pin || "";
    pin.addEventListener("input", () => {
      globalSettings.pin = pin.value.trim();
      saveGlobalSettings();
    });

    table.parentNode.insertBefore(box, table);
  }

  function setupPanels() {
    ensureStyles();
    forEachStatusPet(document, ({ petName, actionCell }) => {
      if (!settings[petName]) {
        settings[petName] = { hp: false, str: false, def: false, mov: false, hp3x: false };
        saveSettings();
      }
      actionCell.innerHTML = "";

      const box = document.createElement("div");
      box.id = "panel_" + petName;
      const status = document.createElement("div");
      const phrase = document.createElement("div");
      phrase.className = "bm-phrase";
      phrase.title = "Clique para puxar outro grito de treino!";
      phrase.addEventListener("click", () => {
        const panel = panels.get(petName);
        if (panel?.phraseMood) showPhrase(petName, panel.phraseMood);
      });
      box.append(status, phrase);
      actionCell.append(box);
      panels.set(petName, { status, phrase, phraseMood: null, phraseAt: 0, setStarted: () => { } });

      const controls = buildControls(petName);
      controls.style.marginTop = "8px";
      actionCell.append(controls);
    });
  }

  /** Stops a pet for good (until Start is clicked again) and shows why. */
  function haltPet(pet, reason) {
    halted.set(pet, reason);
    watchers.delete(pet);
    startedPets = startedPets.filter((p) => p.petName !== pet);
    saveStartedPets();
    setStatus(pet, reason);
    hidePhrase(pet);
    panels.get(pet)?.setStarted(false);
  }

  /* ======================================================================
   * Countdown (one shared timer for every pet)
   * ==================================================================== */

  const watchers = new Map(); // petName -> timestamp when the course ends
  let ticker = null;
  let refreshing = null;

  function refreshStatus() {
    refreshing ??= fetchStatusHtml(school)
      .then(updateData)
      .catch((error) => console.log("[trainer] status refresh failed:", error))
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  async function tick() {
    const now = Date.now();
    let finished = false;
    for (const [pet, endsAt] of watchers) {
      const left = endsAt - now;
      if (left > 0) {
        setStatus(pet, `Training - ${formatTime(left)}`);
        const panel = panels.get(pet);
        if (panel && (!panel.phraseAt || now - panel.phraseAt >= PHRASE_ROTATE_MS)) {
          showPhrase(pet, "training");
        }
      } else {
        watchers.delete(pet);
        finished = true;
      }
    }
    if (watchers.size === 0) {
      clearInterval(ticker);
      ticker = null;
    }
    if (finished) await refreshStatus();
  }

  function watchCourse(pet, timeLeftMs) {
    watchers.set(pet, Date.now() + (timeLeftMs || UNKNOWN_TIME_FALLBACK_MS));
    ticker ??= setInterval(tick, 1000);
  }

  /* ======================================================================
   * Choosing the course
   * ==================================================================== */

  function pickCourse(stats, options) {
    const { lvl, hp, str, def, mov } = stats;
    const otherAboveDouble = str > lvl * 2 || def > lvl * 2 || mov > lvl * 2;

    // Hp 3x: keep training Endurance until HP reaches 3x the level, then train Level
    if (options.hp3x) return hp >= lvl * 3 || otherAboveDouble ? "Level" : "Endurance";

    // otherwise train whichever ticked stat is the lowest
    let lowest = 9999999;
    let course = "Level";
    const consider = (ticked, value, name) => {
      if (ticked && value < lowest) {
        lowest = value;
        course = name;
      }
    };
    consider(options.hp, hp, "Endurance");
    consider(options.str, str, "Strength");
    consider(options.def, def, "Defence");
    consider(options.mov, mov, "Agility");

    // no stat may run past 2x the level: level up instead
    if (hp > lvl * 2 || otherAboveDouble) course = "Level";
    return course;
  }

  /* ======================================================================
   * Paying for a course
   * ==================================================================== */

  function extractPayForm(cell) {
    try {
      const button = cell.querySelector('input[value="Pay"], button[value="Pay"], input[type="submit"][value*="Pay"]');
      const form = button && (button.form || button.closest("form"));
      if (!form) return null;
      const data = [];
      for (const el of Array.from(form.elements)) {
        if (!el.name || el.disabled) continue;
        const type = (el.type || "").toLowerCase();
        if ((type === "checkbox" || type === "radio") && !el.checked) continue;
        if (["submit", "button", "image"].includes(type) && el !== button) continue;
        data.push([el.name, el.value]);
      }
      return {
        action: form.getAttribute("action") || "",
        method: (form.getAttribute("method") || "GET").toUpperCase(),
        data,
      };
    } catch {
      return null;
    }
  }

  /** Expands entries like "2 x One Dubloon Coin" into individual 1-unit item names. */
  function expandItemQuantities(rawItems) {
    const items = [];
    for (const entry of rawItems) {
      const match = entry.match(/^(\d+)\s*x\s+(.+)$/i);
      if (match) {
        const qty = Number(match[1]);
        const name = match[2].trim();
        for (let i = 0; i < qty; i += 1) items.push(name);
      } else {
        items.push(entry);
      }
    }
    return items;
  }

  /** Pays the way the status page offers it (tokenized link, form button, or the old POST) and returns the fresh status page. */
  async function requestPay(pet) {
    const info = allPetState[pet] || {};
    const base = statusUrl(school);
    let response;
    let url;

    if (info.payUrl) {
      url = new URL(info.payUrl, base).href;
      response = await request(url, { referrer: base });
    } else if (info.payForm) {
      const { action, method, data } = info.payForm;
      url = new URL(action || base, base).href;
      const params = new URLSearchParams(data);
      if (method === "POST") {
        response = await request(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          referrer: base,
          body: params.toString(),
        });
      } else {
        url += (url.includes("?") ? "&" : "?") + params.toString();
        response = await request(url, { referrer: base });
      }
    } else {
      // nothing recognisable on the page: last resort, the pre-update request
      url = ORIGIN + SCHOOLS[school].process;
      response = await request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        referrer: base,
        body: new URLSearchParams({ pet_name: pet, type: "pay" }).toString(),
      });
    }

    const text = await response.text();
    console.log(
      "[trainer] pay request",
      url,
      "HTTP",
      response.status,
      text
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, 600),
    );
    await sleep(randomInRange(1500, 3000));
    return fetchStatusHtml(school);
  }

  async function tryPay(pet) {
    updateData(await requestPay(pet));
    const info = allPetState[pet];
    return !!info && info.state !== STATE.UNPAID;
  }

  /** Pay with what the account already has; if that fails, acquire the cost once and pay once more. */
  async function payForCourse(pet) {
    setStatus(pet, "Paying with items you already own...");
    if (await tryPay(pet)) return;

    let rawItems = allPetState[pet]?.cost || [];
    if (SCHOOLS[school].payOnlyFirstItem) rawItems = rawItems.slice(0, 1);
    const items = expandItemQuantities(rawItems);
    if (items.length === 0) throw new FatalError("Could not read the course cost (see console, F12)");

    for (const item of items) {
      if (!(await acquireItem(item, pet))) throw new FatalError(`Could not get ${item}`);
      await sleep(randomInRange(1500, 3000));
    }

    setStatus(pet, "Paying for course...");
    if (await tryPay(pet)) return;
    throw new FatalError("Payment did not go through - stopped to avoid buying more (see console, F12)");
  }

  /* ======================================================================
   * Training loop (the same for every school)
   * ==================================================================== */

  async function finishCourse(pet) {
    setStatus(pet, "Finishing course...");
    await postForm(SCHOOLS[school].process, { type: "complete", pet_name: pet }, statusUrl(school));
    await sleep(randomInRange(500, 900));
    updateData(await fetchStatusHtml(school));
    if (allPetState[pet]?.state === STATE.DONE) throw new Error("the course could not be completed");
  }

  async function startCourse(pet) {
    const course = pickCourse(petStats[pet], settings[pet]);
    setStatus(pet, `Enrolling in ${course} course...`);
    const html = await postForm(
      SCHOOLS[school].process,
      { type: "start", course_type: course, pet_name: pet },
      coursesUrl(school),
    );
    const error = parseHTML(html).querySelector(".errorMessage");
    if (error) return haltPet(pet, error.textContent.trim());
    updateData(html);
    // still not enrolled: don't keep sending the same request forever
    if (allPetState[pet]?.state === STATE.IDLE) throw new Error("the course did not start");
  }

  async function handlePet(pet) {
    const info = allPetState[pet];
    switch (info.state) {
      case STATE.DONE:
        return finishCourse(pet);
      case STATE.TRAINING:
        info.state = STATE.WATCHING;
        return watchCourse(pet, info.timeLeft);
      case STATE.UNPAID:
        return payForCourse(pet);
      default:
        return startCourse(pet);
    }
  }

  function nextPet() {
    const entry = startedPets.find((p) => {
      const info = allPetState[p.petName];
      return p.school === school && info && info.state !== STATE.WATCHING;
    });
    return entry ? entry.petName : null;
  }

  async function onPetError(pet, error) {
    console.error("[trainer]", pet, error);
    if (error instanceof FatalError) return haltPet(pet, `Stopped: ${error.message}`);

    const count = (failures.get(pet) || 0) + 1;
    failures.set(pet, count);
    if (count >= MAX_NETWORK_RETRIES) {
      return haltPet(pet, `Stopped: ${error.message} (see console, F12)`);
    }
    setStatus(pet, `Error: ${error.message} - trying again in ${NETWORK_RETRY_MS / 1000}s...`);
    await sleep(NETWORK_RETRY_MS);
  }

  async function trainingLoop() {
    for (; ;) {
      const pet = nextPet();
      if (!pet) {
        await sleep(IDLE_POLL_MS);
        continue;
      }
      try {
        await handlePet(pet);
        failures.delete(pet);
      } catch (error) {
        await onPetError(pet, error);
      }
      await sleep(randomInRange(1000, 2000));
    }
  }

  /* ======================================================================
   * Start
   * ==================================================================== */

  (async function main() {
    try {
      const snapshot = document.documentElement.outerHTML;
      school = Object.keys(SCHOOLS).find((key) => location.pathname.startsWith(SCHOOLS[key].page));
      if (!school) return;

      await findPetsBusyElsewhere();
      setupGlobalPanel();
      setupPanels();
      updateData(snapshot);
      trainingLoop();
    } catch (error) {
      console.log(error);
    }
  })();
})();

