# 1.1 — mudanças desde a 1.0.2

A 1.1 reúne os ajustes das snapshots e das candidatas RC-1, RC-2 e RC-3. Os pacotes usam a versão **1.1.0**: Windows x64 portátil e APK **ARM64 único para Android e Google TV**.

## Pontuação de canto

- Retorno da pontuação com análise local dos vocais, mapa de notas em cache e comparação ao microfone. A análise usa YIN em um worker; não depende de SheetSage2 nem de um serviço pago.
- Referência por **Ambos os vocais** (principal e backing), vocal principal, backing ou arquivo vocal local. O modo **3 trilhas** também usa o instrumental nos trechos em que os vocais separados não oferecem referência reconhecida.
- Notas sustentadas agrupam vibrato, pequenas falhas de até 160 ms e erros breves de oitava, preservando pausas e mudanças claras de nota. Isso reduz os pequenos pontos soltos no gráfico.
- Faixa de notas inspirada em jogos de canto: cursor fixo à esquerda, barras vindo pela direita, conexões entre notas e indicador suavizado do microfone. A suavização visual não altera os critérios de acerto.
- Cada nota acertada soma **1.000 pontos**, uma única vez. Erros não retiram pontos; voltar ou repetir um trecho não concede pontos duplicados. O percentual usa o total de notas do mapa.
- Estrelas em **9%, 18%, 27%, 36% e 45%** de notas acertadas. As estrelas conquistadas são **brancas**; as cinco ficam **douradas a partir de 55%**.
- Tolerância de afinação configurável, aceitação opcional de outra oitava, seleção de microfone, filtro de ruído e compensação adicional de latência.
- Começar fecha o painel, volta ao início e inicia a música após preparar o mapa e o microfone. Nova tentativa também reinicia a apresentação. Resultados e histórico ficam salvos localmente.
- Pontuação acompanha velocidade, tom, pausas e buscas. O microfone é liberado ao encerrar ou cancelar; problemas de permissão e desconexão recebem tratamento próprio.

## Velocidade e tom em tempo real

- Velocidade de **0,75× a 1,25×**, com transposição independente de **−4 a +4 semitons** e restauração dos valores originais.
- Processamento local com SoundTouchJS em AudioWorklet, aplicado depois de misturar as faixas. A alteração não reencoda a música inteira.
- Reserva de áudio para evitar lacunas entre blocos e preservação do final da faixa. Na velocidade e no tom originais, o áudio passa diretamente.
- Relógio, letras, censura e pontuação acompanham os ajustes e a latência do processamento. Mudar durante a reprodução retoma na posição atual após preencher o buffer.
- Botão único e compacto de velocidade/tom na linha superior dos controles, ao lado de Pontuar; popup acima da barra, como os controles de volume.

## Android, Google TV e celular como microfone

- Captura nativa de microfone no Android e opção de usar o celular conectado como microfone do PC ou da TV.
- O pareamento usa a sessão autenticada na mesma rede. São transmitidos frequência, confiança, nível e horário da captura; o relay não transmite o áudio bruto do microfone.
- Compensação de relógio e atraso da rede, tratamento de pausa/busca e descarte de amostras antigas ou duplicadas. A desconexão pausa a música e interrompe a avaliação.
- Android vertical com faixa compacta e letra atual/próxima abaixo dela, reaproveitando a letra do palco para evitar duplicação. Na horizontal, a faixa é menor que a do PC.
- No PC, TV e Android horizontal, letras adicionais abaixo da faixa só são habilitadas quando há tempos próprios por palavra, automáticos ou manuais. No Android vertical, tempos por linha também são aceitos.
- Velocidade/tom e Pontuar ficam na mesma linha no celular, inclusive em telas estreitas. O popup acompanha mudanças de orientação, fica acima dos controles e fecha o popup de volume quando necessário.
- TV com barra de controles compacta, faixa de notas proporcional à altura disponível e navegação do popup pelo controle remoto. Voltar fecha o popup e devolve o foco ao botão.
- Menor uso de memória na análise de referência, animação limitada no mobile e interrupção do desenho quando a interface está oculta.

## Importação, YouTube, MVSEP e letras

- Título e artista são preenchidos pelo resultado escolhido no YouTube; a busca serve como alternativa para o título. Campos editados manualmente são preservados.
- Correção de falhas falsas de “artista/álbum não encontrado” no YouTube Music. Os metadados do catálogo não dependem de abrir o vídeo; bloqueios temporários do serviço são apresentados como falhas temporárias.
- Pesquisa de letras ao abrir o menu, com novas tentativas automáticas após HTTP 503. Respostas de buscas anteriores ou canceladas não substituem a seleção atual.
- Reconhecimento de **Instrum only** e **Instrumental only** como instrumental nas saídas do MVSEP, com preferência por essa faixa quando há mais de uma alternativa.
- Botão **Acoplar arquivos** para repetir o encaixe de arquivos recebidos ou processados, aproveitando os arquivos existentes sem nova separação, anexos duplicados ou perda das edições do formulário.
- Silêncio automático preserva o texto e oculta o marcador que pula nas pausas reais. Tempos de letra próximos têm prioridade sobre um stem vocal silencioso, evitando interromper o acompanhamento quando a voz foi parar no instrumental.

## Configurações, identidade e distribuição

- Aba **Sobre** com logo animada, versão e identificação que muda a cada deploy, “feito por kaua0f0m”, GitHub do autor e inspiração no software de FunkyBlackCat com link para seu YouTube.
- Atribuições e licenças em uma área recolhida; links da aba Sobre abrem o navegador pelo mecanismo nativo de cada plataforma.
- Controles duplicados de velocidade/tom e “Configurar microfone e canto” saem de Reprodução e ficam em **Debug**, disponível apenas em builds debug, snapshot, teste ou RC. A versão estável oculta essa aba.
- Atalhos Windows priorizam a versão atual; identificação e verificações do pacote ajudam a distinguir versões e detectar conflitos com servidores antigos.
- Atualizados os recursos empacotados, avisos de dependências, manifesto de fontes e testes de regressão. Compactação dos pacotes Windows ajustada para reduzir o tempo de geração.
- README complementado, preservando o conteúdo e as edições do autor já presentes no GitHub.

## Verificação e limites desta versão

O pacote Windows foi verificado no WebView2 nativo, com biblioteca isolada e microfone simulado sem saída audível. Os testes cobrem detector/mapa de notas, pontos/estrelas, velocidade/tom, importação, letras, configurações, layouts mobile/TV e o relay real de microfone no servidor Python. O APK ARM64 foi compilado para Android e Google TV.

A avaliação de voz real, latência, desempenho e captura em celulares/TV físicos continua pendente. O mapa automático pode perder ou interpretar incorretamente trechos com vozes simultâneas ou separação inadequada; os modos alternativos de referência ajudam nesses casos.

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
