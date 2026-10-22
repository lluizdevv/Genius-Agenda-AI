# Decisões de arquitetura, limitações e melhorias futuras

## 1. Decisões e justificativas

| Decisão | Por quê | Alternativa considerada |
|---|---|---|
| **n8n como orquestrador** (em vez de um serviço Python) | A stack já estava no Docker, o fluxo é visual e auditável (cada execução fica registrada), e o nó *AI Agent* já traz o laço de ferramentas, memória e tratamento de erro. Reduz código próprio e superfície de bugs. | Python + LangChain: mais controle e testes unitários mais naturais, porém mais código de infraestrutura (webhook, agendador, retentativas) para o mesmo resultado no prazo. |
| **Agente com ferramentas (tool calling) sobre o Google Calendar** | O agente **só afirma sucesso com base no retorno da ferramenta**; não há "simulação". As 4 operações (consultar, criar, atualizar, excluir) são ferramentas separadas, o que permite ao modelo consultar antes de alterar/excluir. | Extrair a intenção por regex/JSON e chamar a API fora do agente: mais previsível, porém pouco flexível para linguagem natural. |
| **Gemini (camada gratuita)** | Atende à regra de não exigir serviços pagos. O modelo é trocável: o agente depende da interface de chat do n8n, não de um provedor específico. | OpenAI/Claude: basta trocar o nó *Chat Model*. |
| **WAHA via nós HTTP** (em vez do Community Node) | O corpo das chamadas (`/api/sendText`) fica explícito e versionado no JSON, sem depender do formato interno dos parâmetros do node da comunidade. | Community Node do WAHA: funciona, mas o JSON exportado depende da versão instalada. |
| **Lembretes por varredura (polling) a cada 1 minuto, não por agendamento individual** | É o que torna a **reconciliação** trivial: a cada ciclo o sistema lê a agenda real. Evento alterado => horário novo, chave nova, nada no horário antigo. Evento excluído => some da consulta, sem lembrete. Não há lembretes "órfãos" para cancelar. | Agendar um job por lembrete e cancelar/atualizar a cada mudança: mais frágil (é preciso ouvir todas as mudanças e manter os jobs sincronizados). |
| **Chave de deduplicação `id do evento \| início \| offset`** | Evita duplicados entre ciclos e diferencia automaticamente um evento reagendado. O registro só acontece **depois** do envio bem-sucedido; se falhar, o próximo ciclo tenta de novo. | Marcar antes de enviar: nunca duplica, mas pode perder um lembrete. |
| **Estado em *static data* do n8n** | Zero infraestrutura extra, persiste entre execuções do workflow ativo. Suficiente para o escopo de um usuário. | PostgreSQL/Redis (ver melhorias). |
| **Idempotência do webhook pelo `id` da mensagem** | O WAHA pode reenviar o mesmo webhook; o ID da mensagem é guardado por 6 h e a repetição é descartada. O nó Webhook responde imediatamente (`onReceived`), reduzindo reenvios por timeout. | Chave de idempotência por hash do texto: bloquearia mensagens legítimas repetidas. |
| **Lista de números autorizados (allowlist)** | Privacidade: só o dono aciona o agente e acessa a agenda. Grupos e mensagens do próprio número são ignorados (evita loop). | Aberto a qualquer número: risco de exposição da agenda. |

### Separação de responsabilidades
- **Interface:** WAHA + nó Webhook (entrada) e nós HTTP (saída).
- **Lógica de negócio determinística:** nós Code (filtro, deduplicação, cálculo e registro de lembretes), cobertos por testes automatizados.
- **Agente:** nó AI Agent + prompt de sistema (interpretação, perguntas de esclarecimento, regras de confirmação).
- **Integrações:** nós Google Calendar e HTTP/WAHA.

### Como cada requisito crítico é atendido
- **Não simular operações:** o texto de sucesso vem do retorno da ferramenta; o prompt proíbe afirmar sucesso sem retorno positivo.
- **Falha do Google/IA:** a saída de erro do agente envia aviso ("nada foi alterado") e a falha fica registrada na aba *Executions*.
- **Datas relativas e fuso:** o prompt injeta o "agora" em `America/Recife` e exige ISO 8601 com offset `-03:00`.
- **Ambiguidade e exclusão:** o prompt exige listar candidatos numerados e confirmação explícita antes de excluir.
- **Logs:** o histórico de execuções do n8n registra entrada, saída e erro de cada nó.

## 2. Limitações conhecidas

1. **Módulo 5 (inteligência visual) parcial.** O tipo do compromisso é classificado por palavras-chave (reunião, estudo, viagem, entrevista) e o lembrete usa emoji; o briefing é gerado sob demanda quando o usuário pede ("me prepara..."). **Não há geração de imagem nem card visual.**
2. **Participantes:** ficam registrados na descrição do evento. O campo *Attendees* do Google Agenda não está mapeado nos nós (pode ser adicionado em *Additional Fields*), portanto convites por e-mail não são enviados automaticamente.
3. **Detecção de conflitos e ambiguidade dependem do LLM.** O prompt manda consultar antes de criar/alterar, mas isso é uma instrução ao modelo, não uma verificação determinística no código. Há risco residual de o modelo não consultar.
4. **Idempotência da criação de eventos é por mensagem**, não por conteúdo: o mesmo webhook não duplica, mas o usuário enviar duas mensagens idênticas e distintas cria dois eventos.
5. **Intervalos dos lembretes** (`[1440, 60, 15]`) são configurados no nó de código, não por comando no chat.
6. **Estado em *static data* do n8n:** não funciona em execuções de teste manual (só no workflow ativo), não é consultável por SQL e é perdido se o volume do n8n for removido.
7. **Precisão dos lembretes de ±1 minuto** (varredura a cada minuto, tolerância de 5 min). Se o n8n ficar fora do ar por mais de 5 minutos, o lembrete daquela janela é perdido (não é enviado com atraso, para evitar avisos tardios e duplicados).
8. **Um usuário por instalação.** O destino dos lembretes e a allowlist são fixos nos nós.
9. **OAuth em modo de teste:** o login do Google expira em 7 dias; é preciso reautenticar a credencial.
10. **Identificadores `@lid`:** versões recentes do WhatsApp/WAHA podem entregar o remetente como `@lid`; o valor real deve ser copiado de uma execução para a allowlist.
11. **Eventos de dia inteiro não geram lembretes** e recorrentes dependem da expansão feita pelo Google (`singleEvents`).
12. **Mensagens de áudio, imagem e figurinha são ignoradas.**
13. **Os testes automatizados cobrem a lógica determinística e a estrutura dos workflows**, não o LLM nem as APIs externas (ver `CENARIOS_DE_TESTE.md` para a validação manual).

## 3. Melhorias futuras

- **Card visual:** gerar a ilustração de fundo com IA generativa e compor título/horário com um template programático (HTML/Canvas -> PNG), mantendo o lembrete textual como *fallback*.
- **Persistência em PostgreSQL:** tabelas de lembretes enviados, mensagens processadas e preferências; auditoria e consultas.
- **Notificações push do Google Calendar (*watch*)** para reconciliar por evento em tempo real e reduzir chamadas de polling.
- **Verificação determinística de conflitos** em um nó Code antes de criar/alterar, em vez de depender do prompt.
- **Idempotência por conteúdo** (hash de título + horário) como segunda barreira contra duplicidade.
- **Preferências por comando** ("me avise 2 horas antes") e por tipo de evento.
- **Participantes:** mapear *Attendees* e enviar convites.
- **Multiusuário:** tabela de usuários com OAuth por pessoa.
- **Transcrição de áudio** para aceitar mensagens de voz.
- **Observabilidade:** workflow global de erro com alerta, métricas de taxa de falha e latência.
- **Publicar o app OAuth** (ou usar Workspace) para eliminar a expiração semanal do token e restringir ao escopo mínimo.
- **Testes de integração** com um calendário de teste dedicado e um simulador do WAHA.
