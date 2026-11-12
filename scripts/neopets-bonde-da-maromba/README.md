# 💪 Neopets: Bonde da Maromba (Auto Trainer)

Userscript para Tampermonkey que automatiza o treinamento dos seus pets nas três escolas de treino do Neopets, buscando **Codestones e Dubloons** no Cofre (SDB) antes de comprar no Shop Wizard — e com seus pets mandando frases de maromba enquanto treinam!

[![Instalar no Tampermonkey](https://img.shields.io/badge/Instalar%20com%201--Clique-Tampermonkey-brightgreen?style=for-the-badge&logo=tampermonkey)](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-bonde-da-maromba/neopets-bonde-da-maromba.user.js)

---

## 🏫 Escolas Suportadas

* **Cap'n Threelegs' Swashbuckling Academy** (`/pirates/academy.phtml`) — pagamento com *Dubloons*
* **Mystery Island Training School** (`/island/training.phtml`) — pagamento com *Codestones*
* **Secret Ninja Training School** (`/island/fight_training.phtml`) — pagamento com *Red Codestones*

---

## ✨ Funcionalidades

1. **Treino Automático por Atributo ou Modo `Hp 3x`**:
   - Escolha individualmente quais atributos treinar (`Hp`, `Str`, `Def`, `Mov`) — o script prioriza sempre o menor atributo marcado e sobe o `Level` automaticamente quando algum atributo ultrapassar `2 × Level`.
   - Com **`Hp 3x`** marcado, o script treina `Endurance` até atingir `3 × Level` (subindo `Level` quando necessário).

2. **Pagamento Inteligente (Inventário → SDB → Shop Wizard)**:
   - Tenta pagar primeiro com itens que já estão no seu inventário.
   - Se a opção **"Use codestones & dubloons from SDB first (all pets)"** estiver ativada, retira automaticamente **Codestones** ou **Dubloons** do seu **Safety Deposit Box** (com suporte a PIN de 4 dígitos).
   - Caso não encontre no SDB, busca até 5 vezes no **Shop Wizard** e compra na loja mais barata disponível (respeitando cooldown de busca e pausando em *Faerie Quests*).
   - Compra e tenta pagar no máximo uma vez por ciclo, parando o pet em caso de falha para evitar compras repetidas em loop.

3. **Detecção de Escola Cruzada**:
   - Verifica automaticamente se o pet já está matriculado em uma das outras duas escolas e exibe a informação no painel sem conflitos.

4. **Easter Egg: Bonde da Maromba 💪**:
   - Cada estado do pet tem frases próprias: **parado (`idle`)** provocando para clicar em Start, **aguardando pagamento**, **treinando** e **concluído**.
   - Durante o treino, a frase gira automaticamente a cada 45 segundos — e você também pode **clicar na frase** a qualquer momento para puxar outro grito de treino!

---

## 🚀 Como Usar

1. Instale uma extensão de userscripts como o [Tampermonkey](https://www.tampermonkey.net/).
2. Clique no botão **[Instalar no Tampermonkey](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-bonde-da-maromba/neopets-bonde-da-maromba.user.js)** no topo desta página.
3. Acesse uma das escolas de treino do Neopets (ex.: `https://www.neopets.com/island/training.phtml?type=status`).
4. No painel global no topo, informe o **SDB PIN** caso seu cofre seja protegido por senha.
5. Marque os atributos desejados para cada pet e clique em **▶️ Start**.

---

## 🙏 Créditos e Licença

Este script é licenciado sob **GPL-3.0** e é fruto de contribuições da comunidade:

* **Karla's Auto Trainer (v0.0.2)** — base original do auto trainer (GPL-3.0).
* **alienxp** — reescrita e melhorias de fluxo de pagamento tokenizado, integração com SDB, compra única e parada segura em falhas.
* **matt** — alterações no script e criação do easter egg e identidade **"Bonde da Maromba"**.
* **t-moedano (Scriptnautas)** — suporte a **Dubloons** no SDB, ampliação do easter egg interativo por humor/estado e integração ao catálogo Scriptnautas.

