# Arcana Survivors

![Arte de Arcana Survivors: quatro arcanistas enfrentam hordas diante de um castelo sob a lua](docs/arcana-banner.png)

Survival roguelite cooperativo para a web, de 1 a 4 jogadores. O cliente estático funciona no GitHub Pages, e o servidor WebSocket roda separadamente em Node.js na VPS. A mesma simulação (`server/game.js`) roda no navegador no modo offline e no servidor autoritativo no co-op.

> [!NOTE]
> **Ports para consoles (Nintendo Switch, PS Vita, PSP):** A continuação e evolução dos ports foi transferida para o projeto dedicado em C++20: [wizard-coop-ports](https://github.com/MrPowerUp82/wizard-coop-ports) ([README local](../wizard_coop_cpp/README.md)). O novo projeto substitui o port em JavaScript (nx.js) por uma implementação nativa de alta performance (60 FPS, renderer em lote e zero heap por frame).

## Desenvolvimento

```bash
npm install
npm run dev
```

Em outro terminal:

```bash
npm run server
```

Para conectar ao backend local, abra `http://localhost:5173/?server=ws://localhost:8081` (ou a porta definida em `PORT`). Sem configuração, o menu usa o endereço remoto definido em `src/menu.js`. Em produção, abra **Configurar servidor** ou use `?server=wss://jogo.seudominio.com/ws`.

| Comando | O que faz |
| --- | --- |
| `npm run check` | ESLint, checagem de tipos via JSDoc (`tsc`) e todos os testes |
| `npm test` | Simulação, protocolo, rede e animações (`node --test`) |
| `npm run sim -- 12 1` | Bots jogam campanhas completas e mostram vitórias, duração dos chefes e pico de inimigos (12 partidas, 1 jogador) |
| `npm run build` | Gera o frontend de produção em `dist` |
| `npm run switch:check` | Typecheck do port Switch contra o nx.js e testes do bundle Switch |
| `npm run switch:nro` | Gera `platforms/switch/ArcanaSurvivors.nro` |

O workflow do GitHub Pages executa lint, checagem de tipos e testes antes de publicar.

## Nintendo Switch (homebrew)

> [!IMPORTANT]
> **Aviso de migração dos ports:** A continuação e o desenvolvimento ativo dos ports de console agora acontecem no projeto nativo em C++20: [wizard-coop-ports](https://github.com/MrPowerUp82/wizard-coop-ports) ([README](../wizard_coop_cpp/README.md)). O port nativo resolve as limitações e quedas de FPS do runtime JavaScript (nx.js), suportando Nintendo Switch, PS Vita e PSP.
>
> As instruções abaixo documentam o port inicial experimental em JavaScript (nx.js).

O mesmo jogo roda no Switch como `ArcanaSurvivors.nro` (nx.js 1.0.0-beta.6): solo, desafio diário e o co-op local em
tela dividida, com Joy-Con L como Jogador 1 e Joy-Con R como Jogador 2, cada um na horizontal.

```bash
npm run switch:install
```

```bash
npm run switch:nro
```

O `.nro` sai em `platforms/switch/ArcanaSurvivors.nro`. Instalação, controles, depuração de Joy-Cons e limitações estão
em [platforms/switch/README.md](platforms/switch/README.md). A simulação, o renderer e o co-op local são os mesmos da web
(`src/localCoop.js`); só entrada, menus/HUD, fontes e o backend de áudio são específicos do Switch.

## Instalar e jogar sem internet (PWA)

Abra a versão publicada em HTTPS (ou `localhost`) uma vez com internet e aguarde **Pronto para jogar sem internet** no menu. Os arquivos do jogo, fontes e imagens dos seis reinos ficam salvos no navegador. Depois, é possível fechar e reabrir o jogo sem conexão, pelo mesmo endereço ou pelo aplicativo instalado.

Use **Instalar jogo** quando disponível, a opção de instalação do navegador ou, no iPhone/iPad, **Compartilhar → Adicionar à Tela de Início**. Jogar solo, desafio diário, Grimório e Códex funcionam offline; salas cooperativas precisam do servidor e de internet. O progresso permanente continua salvo neste navegador; partidas em andamento não são salvas ao fechar o aplicativo. Limpar os dados do site também remove o cache e o progresso.

Novas versões exibem **Atualizar jogo** no menu e só recarregam após esse clique. Termine a partida antes de atualizar. Para testar localmente, execute `npm run build` e `npm run preview`, visite o endereço informado, aguarde a preparação e recarregue com a rede desativada. O service worker fica desabilitado em `npm run dev`.

O precache é gerado pelo [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa), com caminhos relativos para publicação em subdiretórios do GitHub Pages.

## Controles

- **WASD / setas**: movimento; ataques são automáticos. No celular, use o controle virtual.
- **Espaço / botão Especial**: com 100% de carga, lança 12 projéteis em todas as direções com o triplo do dano e o efeito da sua cor. Cristais verdes carregam o especial.
- **1, 2, 3**: escolhem um poder. **R** troca as opções quando há cargas do Destino.
- **Esc / botão Ⅱ**: pausa a partida offline. Trocar de janela também pausa.
- **♪**: liga ou desliga os efeitos sonoros e a trilha adaptativa (preferência salva no navegador).
- **Q / E / X ou clique** (só no co-op): sinaliza "venham aqui", "preciso de ajuda", "cuidado" ou "olhem ali" para os aliados, com seta na borda da tela.
- **Ressuscitar**: fique no círculo de um aliado caído, a até 44 unidades, por quatro segundos contínuos. Ele volta com 40% da vida e três segundos de proteção. Se todos caírem, a partida termina.

## Como a partida funciona

### Campanha

| Fase | Inimigos | Chefe |
| --- | --- | --- |
| Bosque Desperto | Cogumelos, besouros que investem e lodos que se dividem | Raiz Ancestral |
| Cripta Glacial | Esqueletos, espectros e olhos gélidos que atiram à distância | Rei do Inverno |
| Abismo de Brasas | Diabretes, escorpiões que investem, morcegos que explodem e golems de magma | Coração da Caldeira |
| Pântano Espectral | Esporos que disparam espinhos, almas velozes, lodos e escorpiões | Matriarca do Brejo |
| Cidadela Astral | Sentinelas que investem, oráculos que atiram, almas e golems | Arconte Solar |
| Eclipse do Vazio | Asas explosivas, escaravelhos que investem, oráculos e almas | Soberano do Eclipse |

Cada horda dura 300 segundos: são seis fases e 30 minutos de hordas, além das lutas contra chefes e transições, tanto offline quanto online. A dificuldade sobe dentro da fase, e cada fase começa num patamar próprio, em vez de herdar o relógio global. Cada inimigo morde no próprio ritmo: um inimigo sozinho fere pouco, mas ser cercado é perigoso. O XP de cada inimigo acompanha a vida dele.

As fases novas usam pisos próprios e variações de cor dos sprites existentes, preservando a identidade visual. Os pisos e as cores são preparados uma vez no cliente; os limites de inimigos, projéteis e áreas simultâneas continuam iguais.

Eventos marcados movimentam a horda: uma onda de abertura, **elites** douradas aos 90, 180 e 270 segundos (deixam **baú** com escolha de poder e **ímã** que puxa todo o XP) e **enxames** que cercam o grupo.

Em cada reino surgem dois encontros opcionais: o **altar** (defenda 15 s) e, aos 60% da horda, um sorteado entre **mercador errante** (20 moedas da partida por um poder, uma compra por arcanista), **santuário amaldiçoado** (poder e moedas para todos, mas inimigos ferem 30% mais até o fim do reino) e **ladrão de relíquias** (uma elite que foge com um baú; derrube-a em 20 s).

### Modos, maldições e desafio diário

- **Rápido** e **Clássico** percorrem os seis reinos. O **Infinito** (desbloqueio do Grimório) volta ao primeiro reino depois do sexto guardião, com inimigos e chefes mais fortes a cada volta.
- **Maldições opcionais** (menu ou sala co-op): Enxame, Frenesi, Fragilidade, Fome, Tirania e Nobreza sombria. Cada uma dificulta a partida e aumenta as moedas ganhas.
- **Desafio diário**: mesma semente, duas maldições e personagem do dia para todos, sem melhorias permanentes e em passo fixo, para que os resultados sejam comparáveis. O melhor resultado do dia fica salvo no navegador.

### Chefes

A vida do chefe é calculada a partir do dano estimado do grupo no momento da invocação, com duração-alvo crescente de 45 a 90 segundos (a duração real depende da build e das esquivas). Com 66% e 33% da vida, o chefe entra em fúria: onda de choque, lacaios e padrões novos (linhas de raízes, anéis de projéteis, meteoros e investidas telegrafadas). Ataques em área mostram o círculo antes de causar dano. Derrotar o guardião cura 35% da vida e dá uma escolha de poder gratuita no início da fase seguinte. A queda do sexto chefe concede a vitória.

- **Matriarca do Brejo**: poças em anel e leques de espinhos; em fúria, também ameaça o centro do anel.
- **Arconte Solar**: explosões em cruz e anéis de raios; na última fúria, cobre também as diagonais.
- **Soberano do Eclipse**: fissuras sequenciais e rajadas de lâminas; ganha fissuras cruzadas e, na última fúria, investidas com aviso.

### Poderes

- **Passivos**: poder arcano, cadência, vitalidade, passos do vento, disparo múltiplo, magnetismo e armadura.
- **Armas secundárias**: orbes arcanos, aura sagrada, corrente de raios, runas explosivas e familiar arcano.
- **Assinaturas** (a partir do nível 4, uma por personagem): estilhaço glacial (azul), chão em chamas (vermelho), ricochete (verde) e lua crescente (roxo).
- **Co-op**: Elo arcano (ataques mais rápidos), Vínculo vital (cura aliados próximos) e Guardião (resgates mais rápidos e com mais vida).
- **Evoluções**: liberadas por combinações de poderes e sempre oferecidas quando disponíveis. Constelação, Santuário, Tempestade, Campo Minado e Pacto ancestral evoluem armas; Avalanche, Inferno, Espinheiro e Lua cheia evoluem as assinaturas; Runas de tempestade (runas + raios) e Coroa solar (orbes + aura) combinam duas armas. A escolha de poder mostra o requisito de cada evolução.

**Combos elementais**: fogo em inimigo desacelerado (choque térmico), raio em inimigo enraizado (condução) e lâmina lunar em inimigo em chamas (eclipse). No co-op, quando um aliado finaliza o efeito que você aplicou, o **combo em equipe** causa 2× de dano e carrega o especial dos dois; dois especiais próximos com até 1,5 s de diferença disparam uma **Convergência** entre os arcanistas.

**Especiais**: cada personagem tem um especial padrão (Nova glacial, Meteoro, Jardim de espinhos, Passo lunar) e, com o desbloqueio *Segundo feitiço*, um alternativo (Tempestade de granizo, Égide flamejante, Florescer, Eclipse), escolhido no menu.

No co-op, a escolha de poder tem 15 segundos; depois disso, a primeira opção é aplicada automaticamente.

| Mago | Ataque automático |
| --- | --- |
| Azul | Raio glacial: desacelera por 1,2 s (40% nos inimigos comuns, 15% nos chefes) |
| Vermelho | Bola de fogo: dano direto e 60% do dano nos inimigos a até 75 unidades |
| Verde | Espinho: atravessa até três inimigos sem atingir o mesmo duas vezes |
| Roxo | Lâmina lunar: colisão mais larga e atravessa até dois inimigos |

### Personagem secreto: O Desenvolvedor

Toque ou clique **sete vezes no título Arcana Survivors** no menu (também funciona com Enter/Espaço ao focar o título). O Desenvolvedor aparece na seleção e o desbloqueio fica salvo neste navegador.

Ele tem 5× de vida, 4× de dano, ataques duas vezes mais rápidos, três projéteis iniciais, +35% de velocidade e 12 de armadura. **Código-fonte** atravessa até seis alvos, desacelera e explode em área. Seu visual combina um mago ciano com sigilos geométricos e a marca `</>`.

**Reescrever realidade** produz uma onda ciano e atinge inimigos em um raio de 600 unidades com 24× o dano, apaga projéteis nesse raio, cura 50% da vida máxima e protege por 3 s. A carga se regenera em 10 s, além dos cristais. Com *Segundo feitiço*, **Restauração do sistema** produz uma varredura magenta e elimina todos os inimigos presentes no mapa no instante da ativação, incluindo elites e chefes, independentemente da distância ou vida. Mantém abates, dano, drops e progressão de fase normais; inimigos que surgirem depois da ativação não são afetados. Também cura aliados vivos em até 600 unidades em 100% e protege por 5 s. Maldições que reduzem cura continuam valendo.

Disponível no solo e cooperativo web, mantendo personagens únicos por sala. O desafio diário continua sorteando apenas os quatro magos originais. O segredo é um desbloqueio local, sem exclusividade de conta de desenvolvedor.

### Recompensa do Clássico: Guardião da Aurora

Vença os seis reinos no modo **Clássico**, solo ou cooperativo, para desbloquear permanentemente o **Guardião da Aurora** neste navegador. O resultado anuncia a recompensa e libera o personagem no menu. Derrotas, abandonos, modo Rápido, Infinito e desafio diário não contam. O desbloqueio segue o mesmo modelo de progresso local do Grimório; vitórias anteriores à inclusão desta recompensa não foram registradas.

O Guardião usa vestes douradas e uma auréola solar. Tem **150 de vida, +35% de dano, +10% de velocidade, 3 de armadura e intervalo de ataque 15% menor**, antes das melhorias permanentes. A **Lança da aurora** atravessa dois alvos. Sua auréola dispara automaticamente um **raio solar** no inimigo mais próximo a até 280 unidades a cada 5 s, causando 2,5× o dano do personagem. **Alvorada** causa 6× de dano em 300 unidades, apaga projéteis nesse raio e protege por 1,5 s. Com *Segundo feitiço*, **Coroa da aurora** dispara 12 lanças radiais com 3× de dano. Seus especiais carregam com cristais normalmente: não há recarga automática nem eliminação global como no Desenvolvedor. O desafio diário continua usando somente os quatro magos padrão.

### Personagem comprável: The God

**The God** custa **60.000 moedas** no Grimório. A compra é permanente no perfil local e não entra na redistribuição de melhorias. Antes da compra, o personagem aparece bloqueado na seleção. Tem **500 de vida, +50% de dano, +20% de velocidade, 12 de armadura (maior valor inicial do elenco) e intervalo de ataque 15% menor**. O **Orbe cósmico** atravessa três inimigos. Sua habilidade passiva mantém **dois planetas orbitais** que ferem inimigos por contato, independentemente dos Orbes arcanos comprados durante a partida. **Big Bang** atinge inimigos em 300 unidades, apaga projéteis próximos e protege por 1,5 s; com *Segundo feitiço*, **Constelação** dispara 12 orbes radiais. O desafio diário continua sorteando apenas os quatro magos originais.

### Drops e Grimório

Inimigos derrotados deixam XP e podem deixar coração (5%), cristal verde (20%) ou moeda (20%). Quando o chão fica cheio, novos cristais de XP se fundem aos próximos, que mudam de cor conforme o valor. Assim nenhum XP é perdido no limite de 220 drops.

As moedas da partida vão para o **Grimório** (menu inicial), que vende melhorias permanentes salvas no navegador (Vigor, Potência, Celeridade, Agilidade, Égide, Alcance, Sabedoria, Ganância, Canalização, Destino, Pacto familiar e Fênix) e desbloqueios: **Arsenal** (escolher a arma inicial), **Segundo feitiço** (especial alternativo), **Ritual infinito** e **The God**. O servidor valida graus, desbloqueios e escolhas antes de aplicá-los.

O **Códex** (menu inicial) registra no navegador cada poder, combo, criatura, guardião e encontro descoberto, com a explicação de como funciona; entradas ainda não descobertas mostram só uma dica.

A tela final mostra nível, abates, dano e resgates de cada arcanista, além do **seu dano por fonte** (feitiço, especial, cada arma, combos e convergências).

## Co-op e rede

- Salas por código, abertas (listadas) ou fechadas. Cada personagem só pode ser usado por um jogador na mesma sala.
- Quem entra numa partida em andamento nasce ao lado de um aliado e recebe XP de recuperação.
- O servidor simula a 30 Hz e envia 15 snapshots por segundo. Cada cliente recebe apenas o que está a até 1.250 unidades do seu personagem, em arrays compactos (`server/protocol.js`) com compressão permessage-deflate. Cada snapshot tem cerca de 3 KB comprimido.
- O cliente desenha os outros jogadores e inimigos interpolados 100 ms no passado e prevê o próprio movimento, corrigindo a posição com base no tempo de ida e volta medido por ping.
- **Reconexão**: se a conexão cair, o personagem continua na partida por 30 segundos e o cliente tenta voltar automaticamente, inclusive após recarregar a página. Sem ninguém conectado, a partida congela até alguém voltar.
- Um heartbeat derruba conexões mortas; salas que nunca começaram expiram em 20 minutos e partidas encerradas liberam a vaga 90 segundos após o fim.

## Publicar o frontend no GitHub Pages

1. Suba o repositório no GitHub.
2. Em **Settings → Pages**, selecione **GitHub Actions**.
3. O workflow incluso valida, compila e publica o diretório `dist`.
4. Defina a URL WebSocket no menu. Ela fica salva no navegador.

## Backend na VPS com aaPanel

1. Instale Node.js 20+ pelo **Node Project Manager** do aaPanel.
2. Envie o projeto e execute `npm ci --omit=dev`.
3. Crie um projeto Node com arquivo inicial `server/server.js` e porta `8080`.
4. Crie um domínio/subdomínio com SSL, por exemplo `jogo.seudominio.com`.
5. No proxy reverso, encaminhe `/ws` para `http://127.0.0.1:8080` com upgrade WebSocket habilitado.
6. No frontend use `wss://jogo.seudominio.com/ws`. O GitHub Pages exige `wss://`, pois a página usa HTTPS.

Exemplo Nginx para o bloco `/ws`:

```nginx
location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 60s;
}
```

Atualize sempre a pasta `server` inteira junto com o frontend e reinicie o processo Node: o protocolo de snapshots mudou, e um backend antigo não conversa com o cliente novo.

### Variáveis de ambiente

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `8081` | Porta do WebSocket |
| `MAX_ROOMS` | `3` | Salas simultâneas (até 4 jogadores cada) |
| `HEARTBEAT_MS` | `15000` | Intervalo do ping que detecta conexões mortas |
| `RECONNECT_GRACE_MS` | `30000` | Tempo que um jogador desconectado mantém o personagem |
| `LOBBY_IDLE_MS` | `1200000` | Expiração de salas que nunca começaram |
| `ENDED_ROOM_MS` | `90000` | Tempo até fechar uma sala encerrada |

`MAX_ROOMS=3` é um ponto de partida conservador para a VPS informada (1 vCPU, 460 MiB de RAM), e não uma capacidade garantida por teste de carga. Nas medições com bots, um tick da simulação custa menos de 0,1 ms e o gargalo é a banda, reduzida pelo protocolo compacto. Meça CPU, memória e latência na própria VPS antes de aumentar o limite. Use apenas uma instância do backend: salas e limites ficam em memória por processo.

## Arquitetura

| Arquivo | Responsabilidade |
| --- | --- |
| `server/balance.js` | Todos os números de balanceamento |
| `server/game.js` | Estado, progressão, drops e o `updateGame` que orquestra os módulos |
| `server/enemies.js` · `bosses.js` · `weapons.js` · `combat.js` | Spawn e comportamentos, chefes, armas e dano |
| `server/powers.js` · `meta.js` | Poderes, evoluções, trocas, melhorias permanentes e desbloqueios |
| `server/curses.js` · `encounters.js` · `objectives.js` | Maldições, semente do desafio diário, encontros e altar |
| `server/spatial.js` | Grid espacial usado nas colisões |
| `server/protocol.js` · `server.js` | Snapshots compactos, salas, heartbeat e reconexão |
| `src/net.js` | Sessão co-op, interpolação, previsão e reconexão no cliente |
| `src/render.js` · `sprites.js` · `terrain.js` · `animation.js` | Desenho, sprites pré-recortados, pisos e efeitos visuais |
| `src/hud.js` · `menu.js` · `audio.js` · `input.js` · `wallet.js` | Interface, menu e loja, sons sintetizados, controles e moedas |
| `src/music.js` · `codex.js` | Trilha generativa adaptativa (menu, horda, chefe, fúria, vitória) e Códex |

Arte: `public/assets/sprites.webp` (magos, inimigos antigos, projéteis e drops), `public/assets/phases.webp` (fases 1 a 3) e `public/assets/phases2.webp` (fases 4 a 6). Prompts e recortes em `public/assets/phases-art.md` e `public/assets/phases2-art.md`. Variações de cor, como a lâmina roxa, o morcego de brasa e o golem de magma, são geradas uma única vez no navegador. A preferência do sistema por movimento reduzido desativa balanços, partículas, rastros, tremor de tela e giros; avisos de perigo e o progresso da ressurreição continuam visíveis.

## Créditos

Ideias e sugestões para o jogo: **Guilherme de Lucca Moraes** e **Luis Paula Alves**.
