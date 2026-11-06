# 🏚️ Neopets: Rastreador & Temporizador do Sótão Quase Abandonado

Script para Tampermonkey que rastreia, projeta e cronometra os horários de restock do **Sótão Quase Abandonado (*Almost Abandoned Attic - AAA*)** do Neopets diretamente na página oficial, com conversor de fuso horário, alertas sonoros e notificações na aba.

[![Instalar no Tampermonkey](https://img.shields.io/badge/Instalar%20com%201--Clique-Tampermonkey-brightgreen?style=for-the-badge&logo=tampermonkey)](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-attic-tracker/neopets-attic-tracker.user.js)

---

## 🧠 Como Funciona o Sótão Quase Abandonado?

O **Sótão Quase Abandonado** (`https://www.neopets.com/halloween/garage.phtml`) é uma loja especial em Neovia para contas com mais de 36 meses de idade, onde itens raros (r80 a r99) são vendidos a preços muito baixos (limite de 5 compras por dia).

### Regras de Horário e Restock:
* **Ciclo Base:** O sótão tem chance de reestocar a cada **~7 minutos** calculados a partir do *último restock confirmado*.
* **Janela com Derivação (Drift):** A cada ciclo de 7 minutos, soma-se uma pequena margem aleatória de **0 a 15 segundos** (na média, entre 0 e 5 segundos).
  $$\text{Janela do Ciclo } k = \text{Último Restock} + (k \times 7\text{ min}) \text{ até } (k \times 7\text{ min} + k \times 15\text{ seg})$$
* **Ciclos sem Restock:** Se o sótão não reestocar no 1º ciclo (+7m a +7m15s), a próxima tentativa será no 2º ciclo (+14m a +14m30s), depois no 3º ciclo (+21m a +21m45s) e assim sucessivamente.
* **Reset:** Assim que ocorre um restock de fato, o segundo exato é registrado e os ciclos recomeçam a contar do zero a partir daquele momento.

---

## ✨ Funcionalidades do Script

1. **Painel Integrado Exclusivo no Sótão (`/halloween/garage.phtml`)**:
   - Fica posicionado no topo da página do sótão, integrado de forma limpa e moderna sem poluir outras páginas do Neopets.
   - Pode ser minimizado ou expandido a qualquer momento pelo botão **▼ / ▲**.

2. **Temporizador em Tempo Real com Status Coloridos**:
   - 🟢 **Aguardando (> 60s):** contagem regressiva tranquila.
   - 🟡 **Atenção (<= 60s):** alerta de que a janela está próxima.
   - 🟠 **Iminente (<= 10s):** prepare-se para o refresh!
   - 🔴 **JANELA ATIVA / REFRESH NOW!:** destaque visual pulsante indicando a hora exata de atualizar a página (F5) para caçar itens.
   - ⏳ **Prorrogação (Overtime):** tolerância configurável (15s a 60s) para compensar pequenos atrasos do servidor.

3. **Duplo Fuso Horário Simultâneo (NST & Horário Local)**:
   - Exibe o relógio oficial **Neopian Standard Time (NST)** e o seu **Horário Local (Brasília como padrão)** lado a lado.
   - Seletor de fuso com suporte a Horário de Brasília, Manaus, Fernando de Noronha, Acre, Portugal, UTC ou detecção automática do navegador.

4. **Alertas Sonoros Nativos (Web Audio API)**:
   - Toca avisos sonoros sutis aos **30 segundos**, aos **10 segundos** e um arpejo chamativo no **início da janela (0s)**.
   - Gerados diretamente pelo navegador, sem necessidade de baixar arquivos de áudio externos.
   - Controle deslizante de volume, botão para testar som e opções para ligar/desligar cada aviso individualmente.

5. **Countdown no Título da Aba**:
   - Mostra o tempo restante diretamente no título do navegador: `(02:15) Sótão Quase Abandonado | Neopets` e muda para `🔴 REFRESH NOW!` durante a janela, permitindo que você acompanhe mesmo em outra aba.

6. **Detecção Automática de Restock**:
   - Ao atualizar a página e encontrar itens à venda no Sótão, o script detecta o estoque instantaneamente e exibe um banner facilitando registrar aquele momento com 1 clique.

7. **Projeção de Ciclos & Exportação para Discord/Fórum**:
   - Tabela com os próximos 5 ciclos calculados em NST e no seu horário local.
   - Botão **📋 Copiar para Discord**: gera uma mensagem formatada com os horários projetados pronta para colar em comunidades ou Neoboards.

---

## 🚀 Como Usar

### Passo 1: Instalação
1. Certifique-se de que a extensão [Tampermonkey](https://www.tampermonkey.net/) está instalada no seu navegador.
2. Clique no link direto: **[Instalar Script (Raw)](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-attic-tracker/neopets-attic-tracker.user.js)**.
3. O Tampermonkey abrirá a tela de instalação; clique em **Instalar** (ou *Confirmar Instalação*).

### Passo 2: Acessar o Sótão
1. Abra a página do Sótão no Neopets:
   `https://www.neopets.com/halloween/garage.phtml`
2. O painel do temporizador será exibido no topo.

### Passo 3: Iniciar o Rastreamento
* **Se o sótão acabou de reestocar:** clique em **⚡ Restocou Agora!** ou dê refresh na página para acionar a detecção automática.
* **Se você já sabe o horário do último restock (via Discord ou Neoboards):** digite no campo de texto em NST (ex: `14:22:15` ou `2:22 pm`) e clique em **Salvar**.
* **Se passou a janela e não veio nenhum item:** o temporizador avança para o próximo ciclo automaticamente após o tempo de tolerância, ou você pode clicar em **⏩ Não Restocou (+7m)**.

---

## ⚙️ Configurações Disponíveis

Clique no ícone de engrenagem **⚙️** no canto superior direito do painel para abrir os ajustes:
* **Fuso Horário:** selecione seu fuso preferido (Padrão: Horário de Brasília).
* **Volume & Teste de Som:** ajuste a intensidade dos bips e clique em *Testar 🔔*.
* **Tolerância Pós-Janela:** escolha quantos segundos após o fim da janela oficial o timer deve aguardar antes de concluir o ciclo (15s, 30s, 45s ou 60s).
* **Toggles individuais:** ative ou desative bips de 30s, 10s, abertura da janela e o contador no título da aba.

