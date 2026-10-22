# Roteiro do vídeo de demonstração (3 a 4 minutos)

Grave a tela do computador com o WhatsApp Web (ou espelhamento do celular) ao lado do Google Agenda e do n8n. Use **dados fictícios** e esconda tokens, chaves e números pessoais.

## Preparação (antes de gravar)
- Containers do n8n e do WAHA no ar; os dois workflows **publicados**.
- Google Agenda de teste aberto em uma aba; n8n em *Executions* em outra.
- Um evento fictício já criado para daqui a ~16 min (para mostrar o lembrete de 15 min).

## Cena 1 - Introdução (0:00 - 0:20)
Mostre o diagrama `docs/arquitetura.svg`. Fale: WhatsApp -> WAHA -> n8n -> agente com ferramentas -> Google Agenda, e um segundo fluxo de lembretes que roda sozinho.

## Cena 2 - Criar evento (0:20 - 1:00)
1. Envie: *"Marca uma reunião amanhã à tarde."* -> o agente **pede o horário exato**.
2. Responda: *"Às 14h com o Yuri."* -> confirmação.
3. Mostre o evento aparecendo no Google Agenda (dados reais, não simulados).

## Cena 3 - Consultar e resumir (1:00 - 1:30)
Envie: *"O que eu tenho de importante nesta semana?"* e compare com o Google Agenda.

## Cena 4 - Alterar com ambiguidade (1:30 - 2:15)
1. Tenha duas reuniões com o mesmo cliente. Envie: *"Muda a reunião com o cliente para sexta às 10h."*
2. O agente **lista as duas e pergunta qual**.
3. Responda e mostre a alteração no Google Agenda.

## Cena 5 - Excluir com confirmação (2:15 - 2:45)
Envie: *"Cancela meu compromisso com o fornecedor."* -> o agente pede confirmação -> responda "sim" -> mostre o evento removido.

## Cena 6 - Lembrete automático (2:45 - 3:20)
Mostre o lembrete de 15 min chegando **sem o usuário ter enviado mensagem**. Abra o workflow 02 e explique a varredura de 1 minuto e a chave de deduplicação.

## Cena 7 - Confiabilidade (3:20 - 3:50)
- Reenvie o mesmo webhook duas vezes (`curl` do cenário 5): só uma execução segue.
- (Opcional) Desconecte a credencial do Google e peça algo: mostre o **aviso de falha** em vez de uma confirmação falsa.

## Encerramento (3:50 - 4:10)
Mostre `npm test` (testes passando) e cite as limitações conhecidas (`docs/DECISOES_E_LIMITACOES.md`), incluindo que o card visual com IA ficou como melhoria futura.
