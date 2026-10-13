Option Explicit
Dim shell, files, folder, executable
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
executable = files.BuildPath(folder, "releases\V1.0.2\VoxStage-Windows-x64\VoxStage.exe")
If files.FileExists(files.BuildPath(folder, "releases\V1.1.0-test.1\VoxStage-Windows-x64\VoxStage.exe")) Then
  executable = files.BuildPath(folder, "releases\V1.1.0-test.1\VoxStage-Windows-x64\VoxStage.exe")
End If
If files.FileExists(files.BuildPath(folder, "releases\V1.1.0-rc.1\VoxStage-Windows-x64\VoxStage.exe")) Then
  executable = files.BuildPath(folder, "releases\V1.1.0-rc.1\VoxStage-Windows-x64\VoxStage.exe")
End If
If files.FileExists(files.BuildPath(folder, "releases\V1.1.0-rc.2\VoxStage-Windows-x64\VoxStage.exe")) Then
  executable = files.BuildPath(folder, "releases\V1.1.0-rc.2\VoxStage-Windows-x64\VoxStage.exe")
End If
If files.FileExists(files.BuildPath(folder, "releases\V1.1.0-rc.3\VoxStage-Windows-x64\VoxStage.exe")) Then
  executable = files.BuildPath(folder, "releases\V1.1.0-rc.3\VoxStage-Windows-x64\VoxStage.exe")
End If
If files.FileExists(files.BuildPath(folder, "releases\V1.1.0\VoxStage-Windows-x64\VoxStage.exe")) Then
  executable = files.BuildPath(folder, "releases\V1.1.0\VoxStage-Windows-x64\VoxStage.exe")
End If
If Not files.FileExists(executable) Then
  MsgBox "O executavel compilado do VoxStage nao foi encontrado na pasta releases.", 16, "VoxStage"
  WScript.Quit 1
End If
shell.CurrentDirectory = files.GetParentFolderName(executable)
shell.Run Chr(34) & executable & Chr(34), 1, False
