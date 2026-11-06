# 📮 Neopets: Rastreador de Selos & Marcador de Lojas

Script para Tampermonkey que rastreia os selos, moedas, conchas e amuletos já colecionados no seu Álbum de Selos do Neopets e destaca automaticamente os itens que você **ainda não tem** nas lojas oficiais e de outros jogadores.

[![Instalar no Tampermonkey](https://img.shields.io/badge/Instalar%20com%201--Clique-Tampermonkey-brightgreen?style=for-the-badge&logo=tampermonkey)](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-stamp-tracker/neopets-stamp-tracker.user.js)

---

## ✨ Funcionalidades

1. **Sincronização em 1 Clique (One-Click Sync)**:
   - Lê todas as 54+ páginas do seu álbum em segundo plano em apenas ~5 segundos, com barra de progresso em tempo real e controle de requisições para evitar sobrecarga.
2. **Sincronização Passiva Contínua**:
   - Sempre que você folhear qualquer página do seu álbum normalmente (`stamps.phtml?type=album&page_id=X`), o script detecta os selos colados e atualiza o banco local automaticamente.
3. **Lojas Oficiais Homologadas**:
   - **Post Office** (Loja #58 - Selos)
   - **Coin Shop** (Loja #68 - Moedas colecionáveis)
   - **Sea Shells** (Loja #86 - Conchas do mar)
   - **Toy Shop** (Loja #3 - Amuletos de Álbum: itens contendo `Collectable Charm` e o `Baelia Charm`)
   - Destaca itens **faltantes** com borda verde brilhante e tag `⭐ FALTANDO`.
   - Marca itens **já colecionados** com opacidade reduzida e tag `✓ Colecionado`.
   - Na Toy Shop, itens normais (brinquedos, pelúcias, etc.) são ignorados e não poluem a tela.
4. **Lojas de Usuários (`browseshop.phtml`)**:
   - **Filtro seguro**: escurece apenas os itens que você **tem certeza que já colecionou** no seu álbum com tag `✓ Colecionado`. Não altera itens não colecionados (evitando falsos positivos com comidas, poções, brinquedos, etc.).
5. **Zero Lag / 0ms de Atraso**:
   - Funciona em modo *Cache-First*: nas lojas, o script nunca faz requisições de rede lentas; a verificação é instantânea na memória do navegador.

---

## 🚀 Como Usar

### Passo 1: Instalação
1. Certifique-se de que a extensão [Tampermonkey](https://www.tampermonkey.net/) está instalada no seu navegador.
2. Clique no link direto: **[Instalar Script (Raw)](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-stamp-tracker/neopets-stamp-tracker.user.js)**.
3. O Tampermonkey abrirá a tela de confirmação; clique em **Instalar** (ou *Confirmar Instalação*).

### Passo 2: Sincronizar seu Álbum de Selos
1. Acesse o seu álbum de selos no Neopets:
   `https://www.neopets.com/stamps.phtml`
2. No topo da página aparecerá o banner do **Scriptnautas: Rastreador de Selos**.
3. Clique no botão **⚡ Sincronizar Álbum Completo**.
4. Uma janela mostrará o progresso enquanto ele varre todas as páginas do seu álbum (leva apenas 4 a 5 segundos).

### Passo 3: Fazer Compras
- Vá para a **Post Office** (`objects.phtml?type=shop&obj_type=58`), **Coin Shop** (`obj_type=68`), **Sea Shells** (`obj_type=86`), **Toy Shop** (`obj_type=3`) ou qualquer loja de usuários.
- Os itens que você ainda não tem estarão realçados em verde `⭐ FALTANDO` para você comprar no restock sem perder tempo pensando se já tem ou não!
- Um distintivo flutuante no canto inferior direito mostrará o status da loja e quantos selos você tem salvos.

---

## 🏪 Lojas Oficiais Homologadas

* **Toy Shop** (Loja #3 - Neopia Central - Amuletos / Collectable Charms e Baelia Charm)
* **Neopian Post Office** (Loja #58 - Neopia Central - Selos)
* **Coin Shop** (Loja #68 - Neopia Central - Moedas)
* **Sea Shells** (Loja #86 - Maraqua - Conchas)
* **Lojas de Usuários** (`browseshop.phtml`)
