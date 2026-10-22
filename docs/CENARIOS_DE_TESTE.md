# Cenários de teste

Dois níveis de validação:

1. **Automatizados** (`npm test`): executam o código real dos nós do n8n (filtro, deduplicação, lembretes) e validam a estrutura dos workflows. Rodam sem n8n, sem Google e sem WhatsApp.
2. **Manuais** (este documento): validam o agente de IA e as integrações reais. Use um **calendário de teste com dados fictícios** e preencha a coluna *Resultado* após executar.

## A. Cenários do desafio

| # | Cenário | Esperado | Mecanismo | Como verificar | Resultado |
|---|---|---|---|---|---|
| 1 | "Marca uma reunião amanhã à tarde." | Pede o horário exato; **não** cria evento | Regra 3 do prompt | Nenhum evento novo no Google Agenda; resposta pergunta a hora | ☐ |
| 2 | Duas reuniões com o mesmo cliente; "muda a reunião com o cliente para sexta às 10h" | Lista as duas (numeradas, com data/hora) e pergunta qual | Regra 5 do prompt + ferramenta *Consultar* | Nada alterado até o usuário responder | ☐ |
| 3 | Excluir um evento que tinha lembretes pendentes | Pede confirmação, exclui, e **nenhum lembrete** chega depois | Regra 6 + varredura lê a agenda real | Evento some do Google; aguardar os horários dos alertas: nada chega | ☐ |
| 4 | API do Google falha (revogue a credencial ou desconecte a rede e peça algo) | Avisa que **não** foi concluído e que nada foi alterado | Saída de erro do agente -> "Enviar aviso de falha" | Mensagem de falha no WhatsApp; execução com erro na aba *Executions* | ☐ |
| 5 | O mesmo webhook chega duas vezes | Apenas **um** evento criado | Deduplicação por id da mensagem | Reenvie o mesmo JSON ao webhook (ver comando abaixo): 1 execução segue, a outra para no filtro | ☐ (auto: ✅) |
| 6 | "O que tenho neste mês?" | Resumo coerente com os eventos reais | Ferramenta *Consultar* (intervalo do mês) | Compare a resposta com o Google Agenda | ☐ |
| 7 | Evento muda de horário | Alerta usa o horário novo; **nada** no horário antigo | Chave inclui o início; consulta lê a agenda atual | Crie evento para daqui a ~20 min, mova para +90 min, confirme que não chega alerta no horário antigo | ☐ (auto: ✅) |
| 8 | A geração da imagem falha | Lembrete textual continua | Os lembretes são **somente texto** (não há dependência de imagem) | Lembretes chegam normalmente | ☐ (N/A: card visual não implementado) |

**Reenviar o mesmo webhook (cenário 5):** copie o JSON de uma execução do *Webhook WAHA* e envie duas vezes:

```bash
curl -X POST http://localhost:5678/webhook/genius-agenda \
  -H "Content-Type: application/json" \
  -d '{"event":"message","session":"default","payload":{"id":"teste-dup-1","from":"SEU_ID@c.us","fromMe":false,"body":"Marca teste amanhã às 9h"}}'
```

Execute duas vezes com o mesmo `id`: a segunda deve terminar no nó *Filtrar e deduplicar*.

## B. Cenários adicionais

| # | Cenário | Esperado | Resultado |
|---|---|---|---|
| 9 | "Marca uma reunião com o Yuri amanhã às 14h." | Cria o evento, devolve título/data/hora a partir do retorno da API | ☐ |
| 10 | Criar no horário de outro evento | Avisa do conflito e oferece alternativas | ☐ |
| 11 | "Cancela meu compromisso com o fornecedor." | Identifica o evento, pede confirmação, exclui só após "sim" | ☐ |
| 12 | "Me prepara para a reunião que começa em 30 minutos." | Consulta o evento e devolve briefing curto | ☐ |
| 13 | "Próxima terça às 10h" | Data correta em `America/Recife` | ☐ |
| 14 | Mensagem de número não autorizado | Nenhuma resposta | ☐ (auto: ✅) |
| 15 | Evento criado para daqui a 15 min | Recebe o alerta de 15 min uma única vez | ☐ (auto: ✅) |

## C. Cobertura dos testes automatizados

| Área | O que é verificado |
|---|---|
| Webhook | Mensagem válida; ignora `fromMe`, grupos, número não autorizado, evento diferente de `message`, mídia sem texto; **duplicata descartada**; limpeza de ids antigos |
| Lembretes | Disparo em 24 h / 1 h / 15 min; fora da janela; evento criado tarde; **não duplica**; falha no envio **não** marca como enviado; **reagendamento**; evento excluído/cancelado/dia inteiro; classificação por tipo; fuso Recife; limpeza do estado |
| Estrutura | Conexões válidas; erro do agente leva ao aviso de falha; 4 ferramentas ligadas; retentativas nos nós HTTP; regras críticas no prompt |
| Segurança | Sem chaves/tokens nos arquivos; workflows sem credenciais embutidas; `.env` no `.gitignore` |

Execução: `npm test` (Node.js 20+).
