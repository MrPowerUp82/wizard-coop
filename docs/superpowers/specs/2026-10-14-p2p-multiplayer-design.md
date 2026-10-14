# Multiplayer P2P (WebRTC) no lugar do servidor WebSocket

Data: 2026-10-14 · Status: aguardando revisão

## Objetivo

Jogar co-op online (1–4 jogadores) sem nenhum servidor próprio. Quem cria a sala vira o anfitrião e roda a simulação no próprio navegador; os convidados se conectam a ele por WebRTC. O site continua 100% estático no GitHub Pages.

**Critérios de sucesso**
1. Criar sala, entrar por código, lobby, partida, retomada de convidado e fim de partida funcionam sem `server/server.js` e sem a dependência `ws`.
2. A lista de salas abertas continua existindo, alimentada por anúncios P2P.
3. A simulação, o `protocol.js` e `PROTOCOL_VERSION` não mudam (a fixture C++ segue válida).
4. `npm run check` passa e o workflow do GitHub Pages continua igual.

**Decisões já tomadas**
- Topologia em estrela com anfitrião autoritativo (o anfitrião também joga).
- Sinalização com Trystero sobre relays públicos (escolha do usuário). Sem servidor próprio.
- O servidor WebSocket é removido, não mantido como alternativa.

**Fora de escopo**: migração de anfitrião, TURN próprio, chat/voz, co-op online nos portes Switch/Vita, qualquer mudança de gameplay.

## Arquitetura

```
 Convidado (src/net.js) ──transport── Trystero/WebRTC ──transport── Anfitrião
                                                                     │
 Anfitrião jogador (src/net.js) ──loopback (sem rede)──►  server/room-host.js ──► server/game.js
```

Uma sala por anfitrião. `room-host` é o antigo `server.js` sem I/O próprio.

### Unidades

| Unidade | Responsabilidade | Depende de |
|---|---|---|
| `server/room-host.js` | Estado de **uma** sala: lobby, `create/join/resume/leave`, validação, rate limit, tick de 30 Hz, snapshots a 15 Hz, período de carência, bloqueio de personagens. Exporta `createRoomHost(options)`. | `game.js`, `protocol.js`, `meta.js`, `curses.js`, etc. |
| `src/p2p/transport.js` | Contrato de transporte e fábricas: `loopbackPair()`, `guestTransport(code)`, `hostEndpoint(code)`. | Trystero |
| `src/p2p/lobby.js` | Descoberta de salas abertas: `announceRoom(info)` (anfitrião) e `watchRooms(cb)` (menu). | Trystero |
| `src/net.js` | `createSession(transport, entry, handlers)`: predição, interpolação, ping, retomada. Troca `new WebSocket(url)` pelo transporte. | contrato de transporte |
| `src/main.js` / `src/menu.js` | Escolhem o papel (anfitrião ou convidado), montam o transporte, listam salas, mostram avisos. | os acima |

### Contrato de transporte (imita `WebSocket`)

```js
// Transporte: { send(string), close(code?, reason?), readyState, onopen, onmessage({data}), onclose({code, reason}), onerror }
// readyState: 0 conectando, 1 aberto, 2/3 fechando/fechado. Mesmos códigos de fechamento do servidor atual (4001 sala expirou, 4002 partida encerrada, 4003 anfitrião saiu).
```

Assim `net.js` quase não muda: onde hoje usa `ws`, passa a usar o transporte; JSON continua sendo a carga.

### `room-host.js` — interface

```js
const host = createRoomHost({ code, maxPlayers: 4, now, onEmpty, onRoomChange });
const client = host.connect({ send(msg), close(code, reason) });   // devolve { receive(raw), disconnect() }
host.snapshot();  // { code, count, running, host, campaign, curses, visibility } para o lobby público
host.destroy(code, reason);
```

- `connect()` é o equivalente ao `wss.on('connection')`; `receive(raw)` ao `ws.on('message')`; `disconnect()` ao `ws.on('close')`.
- Mesmas regras de hoje: 50 msg/s por cliente, `PROTOCOL_MISMATCH`, `CHARACTER_TAKEN`, `CHARACTER_LOCKED`, `RESUME_FAILED`, sala cheia, fim de partida.
- Remove-se: `rooms` Map, `MAX_ROOMS`, `createCode` global, heartbeat de `ws`, `maxPayload`/`perMessageDeflate`. `listRooms` sai do host (agora é `lobby.js`).
- Mantém-se: `RECONNECT_GRACE_MS` (30 s), `LOBBY_IDLE_MS` (20 min), `ENDED_ROOM_MS` (90 s), TICK 30, SNAPSHOT_EVERY 2.
- Limite de tamanho de mensagem: o host descarta cargas > 4096 caracteres antes de `JSON.parse`.
- Contrapressão: o anfitrião para de enviar snapshots a um convidado com mais de 8 envios pendentes (a API do Trystero não expõe o buffer do canal).

## Fluxo

### Criar sala
1. Gera código de 6 letras (mesmo alfabeto atual) e entra na sala Trystero `arcana:CODE`.
2. Cria `createRoomHost`, conecta o jogador local por `loopbackPair()` e executa o `create` normalmente. (Não há verificação de colisão de código: com 31⁶ ≈ 887 milhões de códigos a chance é desprezível, e sondar atrasaria toda criação de sala.)
3. Quando um convidado diz `hello` no canal de controle, cria um cliente de `host.connect` ligado ao canal Trystero `msg` (JSON em string) e responde `ack`.
4. Se a sala for **aberta**, `announceRooms` a cada 3 s enquanto não estiver cheia; para quando fechar/encher/terminar.

### Entrar por código
1. Entra em `arcana:CODE`, envia `hello`; o anfitrião responde `ack`.
2. Sem resposta em 12 s (5 s ao retomar): erro "Sala não encontrada." (ao retomar, fecha com 1006 para o `net.js` tentar de novo). Versão diferente do protocolo: o `room-host` responde `PROTOCOL_MISMATCH` no `create/join/resume`.
3. O transporte abre e `net.js` envia `join` como hoje.

### Lista de salas abertas
- Sala Trystero fixa `arcana-lobby`. O menu entra como par **ativo** só enquanto o painel "Entrar" está aberto (um par `passive` do Trystero nunca anuncia nem descobre ninguém) e sai ao fechar o painel ou iniciar partida/lobby.
- Anúncio: `{ code, count, running, host, campaign, curses }`. O menu mantém um mapa por `code` e expira entradas após 8 s sem anúncio.
- Salas fechadas nunca anunciam. A capacidade "N/M salas" some da UI.
- O botão "Atualizar" reinicia a escuta e aguarda ~2 s antes de mostrar "Nenhuma sala aberta".

### Reconexão e saída
- Convidado: queda do canal ⇒ `net.js` entra no ciclo de `RETRY_DELAYS`, reentra em `arcana:CODE` e envia `resume` com o token. O `peerId` do Trystero muda, então o host associa o cliente pelo token, não pelo peer.
- Se as tentativas esgotam, `onClosed` mostra "O anfitrião saiu." (ou o motivo recebido).
- Anfitrião: ao fechar a aba (`pagehide`/`beforeunload`), tenta enviar `closing` a todos; convidados terminam sem retentar (código 4003). Recarregar a aba do anfitrião **encerra** a sala; `savedSession()` só vale para convidados.
- Anfitrião que deixa o lobby pelo botão sai com `destroy(4002)`.

### Aba oculta
Quando `document.hidden` no anfitrião durante a partida, mostra aviso "Mantenha esta aba visível: os outros jogadores dependem dela". O tick usa `Date.now()` com `dt` limitado a 0,08 s, como hoje, então a simulação desacelera em vez de explodir.

## Configuração e rede
- Estratégia Trystero fixa numa constante (`torrent`), com `appId` `arcana-survivors`. Trocar a estratégia é uma linha.
- STUN público padrão. TURN opcional por `?turn=<url>&turnUser=…&turnCred=…` (não ligado por padrão).
- Pacote: verificar na implementação o nome atual do pacote Trystero (`trystero` com subcaminho de estratégia, ou `@trystero-p2p/torrent`) e fixar a versão.

## Remoções e documentação
- Remove: `server/server.js`, `ws` e `@types/ws`, script `npm run server`, campo "Servidor WebSocket" e `#saveServer` no `index.html`/`menu.js`, `DEFAULT_SERVER`, `?server=`, e as seções de VPS/proxy/variáveis `PORT`, `MAX_ROOMS` etc. do README.
- Atualiza: README (como funciona o P2P, limitações, TURN), `RELEASE_NOTES.md`, `platforms/switch/README.md` (a menção ao WebSocket).
- O texto do `terrain.js` ("never sent over WebSocket") passa a "never sent over the network".

## Riscos e mitigação
| Risco | Mitigação |
|---|---|
| Anfitrião fecha ou perde a aba | Mensagem clara aos convidados; documentado. Sem migração. |
| Aba do anfitrião em segundo plano | Aviso visível; `dt` limitado. |
| NAT simétrico/operadora móvel sem TURN (~10–15%) | TURN opcional por URL; erro de conexão com dica. |
| Relays públicos fora do ar | Estratégia trocável numa linha; mensagem "Não foi possível encontrar a sala" após o timeout. |
| Convidado malicioso | Host valida tudo como hoje: schema, limites numéricos, rate limit, tamanho máximo; nunca confia em estado do cliente. |
| Anfitrião trapaceia | Aceito: sem servidor neutro não há autoridade confiável. Documentado. |
| Peso no anfitrião (celular fraco) | Limite de 4 jogadores mantido; snapshot por cliente já é recortado por proximidade. |

## Testes
- **Unidade (`node --test`)**: reescrever `server.test.js`, `network.test.js` e `characters.test.js` para usar `createRoomHost` com clientes em memória (`loopbackPair`), preservando os cenários atuais: lobby, `create/join`, sala cheia, personagem em uso/bloqueado, `resume` com token, carência, `PROTOCOL_MISMATCH`, rate limit, mensagem grande, snapshot por cliente, fim de partida e destruição de sala.
- Novos testes: `lobby.js` (expiração e deduplicação por `code`) com Trystero injetado por um falso; colisão de código; `closing` do anfitrião.
- **Manual (dois contextos de navegador)**: criar sala aberta, vê-la na lista, entrar, jogar uma fase, derrubar o convidado e retomá-lo, fechar o anfitrião.
- `npm run lint`, `npm run typecheck` e `npm test` verdes; `npm run build` gera o `dist` sem `ws`.

## Ordem sugerida (para o plano)
1. Extrair `room-host.js` mantendo o `server.js` como casca fina e os testes passando.
2. Introduzir o contrato de transporte e adaptar `net.js`, com `loopback` e testes em memória.
3. Camada Trystero (host/guest) e `lobby.js`.
4. Ligar menu/main, avisos de UI e fluxo de saída do anfitrião.
5. Remover `server.js`/`ws`, migrar testes restantes, atualizar documentação.
