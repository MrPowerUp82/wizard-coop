# Arcana Survivors

Survival roguelite cooperativo para a web, de 1 a 4 jogadores. O cliente estático funciona no GitHub Pages, e o servidor WebSocket roda separadamente em Node.js na VPS. A mesma simulação (`server/game.js`) roda no navegador no modo offline e no servidor autoritativo no co-op.

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

O workflow do GitHub Pages executa lint, checagem de tipos e testes antes de publicar.

## Controles

- **WASD / setas**: movimento; ataques são automáticos. No celular, use o controle virtual.
- **Espaço / botão Especial**: com 100% de carga, lança 12 projéteis em todas as direções com o triplo do dano e o efeito da sua cor. Cristais verdes carregam o especial.
- **1, 2, 3**: escolhem um poder. **R** troca as opções quando há cargas do Destino.
- **Esc / botão Ⅱ**: pausa a partida offline. Trocar de janela também pausa.
- **♪**: liga ou desliga os efeitos sonoros (preferência salva no navegador).
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

### Chefes

A vida do chefe é calculada a partir do dano estimado do grupo no momento da invocação, com duração-alvo crescente de 45 a 90 segundos (a duração real depende da build e das esquivas). Com 66% e 33% da vida, o chefe entra em fúria: onda de choque, lacaios e padrões novos (linhas de raízes, anéis de projéteis, meteoros e investidas telegrafadas). Ataques em área mostram o círculo antes de causar dano. Derrotar o guardião cura 35% da vida e dá uma escolha de poder gratuita no início da fase seguinte. A queda do sexto chefe concede a vitória.

- **Matriarca do Brejo**: poças em anel e leques de espinhos; em fúria, também ameaça o centro do anel.
- **Arconte Solar**: explosões em cruz e anéis de raios; na última fúria, cobre também as diagonais.
- **Soberano do Eclipse**: fissuras sequenciais e rajadas de lâminas; ganha fissuras cruzadas e, na última fúria, investidas com aviso.

### Poderes

- **Passivos**: poder arcano, cadência, vitalidade, passos do vento, disparo múltiplo, magnetismo e armadura.
- **Armas secundárias**: orbes arcanos, aura sagrada, corrente de raios e runas explosivas.
- **Assinaturas** (a partir do nível 4, uma por personagem): estilhaço glacial (azul), chão em chamas (vermelho), ricochete (verde) e lua crescente (roxo).
- **Elo arcano** (só no co-op): você e aliados próximos atacam mais rápido.
- **Evoluções**: arma no grau máximo mais um passivo específico liberam Constelação, Santuário, Tempestade ou Campo Minado. Elas sempre aparecem entre as opções quando liberadas.

No co-op, a escolha de poder tem 15 segundos; depois disso, a primeira opção é aplicada automaticamente.

| Mago | Ataque automático |
| --- | --- |
| Azul | Raio glacial: desacelera por 1,2 s (40% nos inimigos comuns, 15% nos chefes) |
| Vermelho | Bola de fogo: dano direto e 60% do dano nos inimigos a até 75 unidades |
| Verde | Espinho: atravessa até três inimigos sem atingir o mesmo duas vezes |
| Roxo | Lâmina lunar: colisão mais larga e atravessa até dois inimigos |

### Drops e Grimório

Inimigos derrotados deixam XP e podem deixar coração (5%), cristal verde (20%) ou moeda (20%). Quando o chão fica cheio, novos cristais de XP se fundem aos próximos, que mudam de cor conforme o valor. Assim nenhum XP é perdido no limite de 220 drops.

As moedas da partida vão para o **Grimório** (menu inicial), que vende melhorias permanentes salvas no navegador: Vigor, Potência, Sabedoria, Ganância, Destino (trocas de opções) e Fênix (renasce uma vez por partida). O servidor valida os graus recebidos antes de aplicá-los.

A tela final mostra nível, abates, dano e resgates de cada arcanista.

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
| `server/powers.js` · `meta.js` | Poderes, evoluções, trocas e melhorias permanentes |
| `server/spatial.js` | Grid espacial usado nas colisões |
| `server/protocol.js` · `server.js` | Snapshots compactos, salas, heartbeat e reconexão |
| `src/net.js` | Sessão co-op, interpolação, previsão e reconexão no cliente |
| `src/render.js` · `sprites.js` · `terrain.js` · `animation.js` | Desenho, sprites pré-recortados, pisos e efeitos visuais |
| `src/hud.js` · `menu.js` · `audio.js` · `input.js` · `wallet.js` | Interface, menu e loja, sons sintetizados, controles e moedas |

Arte: `public/assets/sprites.webp` (magos, inimigos antigos, projéteis e drops) e `public/assets/phases.png` (campanha). Prompt e recortes em `public/assets/phases-art.md`. Variações de cor, como a lâmina roxa, o morcego de brasa e o golem de magma, são geradas uma única vez no navegador. A preferência do sistema por movimento reduzido desativa balanços, partículas, rastros, tremor de tela e giros; avisos de perigo e o progresso da ressurreição continuam visíveis.
