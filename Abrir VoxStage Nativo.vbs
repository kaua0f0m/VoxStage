Option Explicit
Dim shell, files, folder, executable
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
executable = files.BuildPath(folder, "releases\V1.0\VoxStage-Windows-x64\VoxStage.exe")
If Not files.FileExists(executable) Then
  MsgBox "O executavel compilado do VoxStage nao foi encontrado na pasta releases\V1.0.", 16, "VoxStage"
  WScript.Quit 1
End If
shell.CurrentDirectory = files.GetParentFolderName(executable)
shell.Run Chr(34) & executable & Chr(34), 1, False
