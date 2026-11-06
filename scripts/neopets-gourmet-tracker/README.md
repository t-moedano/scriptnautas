# 🍽️ Neopets: Rastreador de Comidas Gourmet & Marcador de Lojas

Script para Tampermonkey que rastreia as comidas gourmet (raridade 90 a 100) consumidas pelo seu Neopet no **Gourmet Club**, cruzando dados com a base oficial do **itemDB** para destacar exatamente quais comidas gourmet comprar nas 27 lojas oficiais e em lojas de usuários.

[![Instalar no Tampermonkey](https://img.shields.io/badge/Instalar%20com%201--Clique-Tampermonkey-brightgreen?style=for-the-badge&logo=tampermonkey)](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-gourmet-tracker/neopets-gourmet-tracker.user.js)

---

## ✨ Funcionalidades

1. **Sincronização com o Gourmet Club**:
   - Lê todas as comidas raras consumidas pelo seu pet em `gourmet_club.phtml?pet_name=SEU_PET`.
   - Identifica os itens mesmo que o Neopets só exiba imagens (sem texto) na página do clube.
   - Suporte multi-pet automático (detecta o pet ativo no jogo).

2. **Integração Inteligente com itemDB**:
   - Conecta-se à lista oficial do [itemDB Gourmet Food](https://itemdb.com.br/pt/lists/official/gourmet-food) para obter raridades (r90-r100) e preços de mercado.
   - **Cache local de 7 dias**: não faz requisições repetidas nem deixa seu restock lento. 100% das checagens nas lojas são instantâneas via memória local.

3. **Destaque nas 27 Lojas Oficiais de Comida**:
   - **⭐ GOURMET (NÃO COMIDO)**: Borda dourada pulsante, raridade destacada (ex: `r95`) e preço de mercado estimado para ajudar a decidir rápido durante o restock.
   - **✓ COMIDO**: Comidas gourmet que seu pet já consumiu ficam com opacidade reduzida e marcadas em cinza, evitando gastos desnecessários.
   - **Comida Comum**: Itens que não pontuam no Gourmet Club (r1-r89) permanecem com estilo padrão, evitando poluição visual.

4. **Lojas de Usuários (`browseshop.phtml`)**:
   - Identifica se qualquer comida à venda em feirinhas é gourmet e avisa se falta ou se você já comeu.
   - Compatível com buscas do Shop Wizard e paginação AJAX.

---

## 🚀 Como Usar

### Passo 1: Instalação
1. Tenha a extensão [Tampermonkey](https://www.tampermonkey.net/) instalada no seu navegador.
2. Clique no link: **[Instalar Script (Raw)](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-gourmet-tracker/neopets-gourmet-tracker.user.js)**.
3. Clique em **Instalar** na tela do Tampermonkey.

### Passo 2: Sincronizar o Pet
1. Acesse a página do Gourmet Club do seu pet:
   `https://www.neopets.com/gourmet_club.phtml?pet_name=NOME_DO_SEU_PET`
2. Você verá o banner dourado confirmando a sincronização dos itens comidos e o catálogo do itemDB.

### Passo 3: Compras e Restock
- Acesse qualquer uma das 27 lojas oficiais de comida ou lojas de usuários.
- O script destacará em dourado brilhante somente as comidas que contam pontos para o Gourmet Club e que seu pet ainda não comeu!

---

## 🏪 As 27 Lojas Oficiais de Comida Homologadas

| ID | Nome da Loja | Mundo |
| :---: | :--- | :--- |
| **1** | Neopian Fresh Foods | Neopia Central |
| **14** | Chocolate Factory | Neopia Central |
| **15** | Bakery | Neopia Central |
| **16** | Health Food Shop | Neopia Central |
| **18** | Smoothie Store | Neopia Central |
| **20** | Tropical Food Shop | Mystery Island |
| **22** | Grundo's Cafe | Virtupets Space Station |
| **30** | Spooky Food | Haunted Woods |
| **34** | Tyrannian Cafe | Tyrannia |
| **35** | Slushie Shop | Terror Mountain |
| **37** | Super Happy Icy Fun Snow Shop | Terror Mountain |
| **39** | Faerie Foods | Faerieland |
| **42** | Tyrannian Food | Tyrannia |
| **46** | Hubert's Hot Dogs | Neopia Central |
| **47** | Pizzaroo | Neopia Central |
| **49** | Neopian Health Foods | Neopia Central |
| **56** | Merifoods | Meridell |
| **62** | Jelly Foods | Jelly World |
| **63** | Ice Cream Cart | Happy Valley |
| **66** | Kiko Lake Treats | Kiko Lake |
| **72** | Exotic Foods | Shenkuu |
| **81** | Qasalan Delights | Lost Desert |
| **90** | Roo Island Coffee Shop | Roo Island |
| **95** | Exquisite Ambrosia | Altador |
| **101** | Moltaran Delicacies | Moltara |
| **105** | The Crumpetmonger | Neovia |
| **112** | The Coffee Cave | Roo Island / Art Deco |

