Option Explicit
Dim shell, files, folder, executable, version
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
For Each version In Array("1.1.1", "1.1.0", "1.0.2")
  executable = files.BuildPath(folder, "releases\V" & version & "\VoxStage-Windows-x64\VoxStage.exe")
  If files.FileExists(executable) Then Exit For
Next
If Not files.FileExists(executable) Then
  MsgBox "O executavel compilado do VoxStage nao foi encontrado na pasta releases.", 16, "VoxStage"
  WScript.Quit 1
End If
shell.CurrentDirectory = files.GetParentFolderName(executable)
shell.Run Chr(34) & executable & Chr(34), 1, False
