# Continuar pela pasta reorganizada

1. Use esta pasta VoxStage como o projeto daqui em diante.
2. O ZIP Source contém apenas os arquivos publicáveis. Não contém músicas nem chaves.
3. A cópia local em native-app/dev-data preserva a biblioteca e a chave MVSep.
   Ela está no .gitignore; não use git add -f para publicá-la.
4. Os pacotes e runtimes locais ficam em releases e também são ignorados pelo Git.
5. Feche a instância antiga antes de abrir o executável desta pasta: ambas usam 8000.
6. Confira a biblioteca no app e mantenha um backup dela antes de apagar a pasta
   Karaoke antiga. Os dados do WebView em AppData continuam usando o mesmo ID.
7. Para desenvolver, instale as dependências indicadas no README nesta pasta.
   node_modules, SDKs, modelos e caches antigos não fazem parte do código publicável.

Não remova fonts, os arquivos de interface da raiz nem o projeto gen/android:
eles são usados pelo app nativo e pelo controle remoto.
