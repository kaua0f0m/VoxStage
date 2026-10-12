# 1.0.2

Primeira versão pública, com pacote portátil Windows x64 e APK ARM64 para Android e Google TV.

- Adicionado botão rápido para sair da apresentação ao lado do controle de ocultar, disponível também quando os controles estão recolhidos. O seletor de censura passa à frente do palco em tela cheia.
- Faixas já existentes na biblioteca entram automaticamente na fila da TV ou do PC. Novos pedidos continuam aguardando aprovação antes de poderem iniciar separações que podem usar créditos.
- Envios de músicas do celular para as bibliotecas do PC e da TV são salvos automaticamente. Se uma faixa pedida estiver apenas no celular, ela é transferida antes de entrar na fila. No Android, há uma tela de envios em andamento para acompanhar o progresso e retornar ao rascunho; uma notificação de serviço em primeiro plano mantém a separação ativa ao alternar de aplicativo.
- Configurações reorganizadas em abas verticais para Reprodução, Processamento local, Nuvem e Visual. Processamento local fica oculto no Android e na TV. A seção “Downloads do YouTube” foi removida das configurações do Android; o download de vídeo do YouTube também fica oculto no app Android.
- O pareamento no celular usa o nome genérico “Conectar ao VoxStage”. Revisados os textos da importação, do onboarding, do pareamento e do controle web; removidas promessas de recursos já disponíveis e instruções que limitavam transferências ao PC.

A revisão corrigiu o botão de sair no Android (incluindo a orientação), a posição dos botões no cabeçalho, mensagens de conclusão que apareciam como falha e a atualização da biblioteca antes de tocar faixas recebidas. As notificações também recebem atualizações do worker nativo, sem depender dos timers da WebView em segundo plano.

Verificação: testes de interface PC/Android/TV em navegador, incluindo censura em fullscreen, e quatro testes do servidor passaram. A migração para TV e as notificações nativas precisam de validação adicional em aparelho físico.

# 1.0.1

- PC: botão para ocultar a interface no palco e ocultamento automático após 5 segundos sem movimento do mouse. Os controles permanecem visíveis enquanto o mouse estiver sobre eles.
- Música completa: reprodução também no PC, um único slider chamado Volume e opção Separar com MVSEP no menu da música salva. A separação local no computador continua disponível nesse menu.
- Android: ajuda Como obter uma chave MVSEP e salvamento da chave mesmo quando a validação online está indisponível. A ajuda abre a página oficial no navegador do aparelho.
- Google TV: a configuração inicial abre Conectar com o celular. A chave MVSEP pode ser enviada pelo controle web ou pelo app Android conectado ao QR da TV, inclusive usando a chave já salva no celular.
- Capas: escolher capa, fundo ou ambos fecha a busca e aplica a opção ao formulário.
- Android: tocar no nome de um arquivo abre um overlay com o nome completo e permite selecionar o texto.
- MVSEP: falhas temporárias na consulta do processamento mantêm a tarefa ativa e repetem a consulta sem reenviar o áudio. O Android também tenta novamente downloads interrompidos e aproveita stems já recebidos. Erros de conexão não exibem a chave da API na URL.
- A separação de uma música salva mantém metadados, letras, favoritos e o arquivo de origem. Edições feitas no formulário durante a separação são preservadas.

## Validação

- `node native-app/tests/release-101.cjs`: interface PC, Android e TV em Edge headless, com biblioteca e comandos nativos fictícios.
- `python native-app/tests/test_mvsep_101.py`: upload de arquivo salvo, recuperação após falha de consulta sem novo upload, proteção da chave nas mensagens e reutilização da tarefa ativa.
- `cargo check --manifest-path native-app/src-tauri/Cargo.toml --offline`: validação do código nativo.

O erro do print corresponde a uma falha de transporte na consulta ao MVSEP. O tratamento dessa falha foi corrigido; a causa específica da conexão no aparelho precisa de uma nova execução nele para ser confirmada.

Guia da chave baseado na [documentação oficial MVSEP](https://mvsep.com/pt/full_api).
