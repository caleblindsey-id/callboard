' Launches run-inventory-reorder.ps1 fully hidden (no console flash).
' Window style 0 = hidden; wait = True so Task Scheduler's ExecutionTimeLimit
' and MultipleInstances IgnoreNew still apply to the real PowerShell run.
Dim shell, here
Set shell = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell.exe -ExecutionPolicy Bypass -NoProfile -File """ & here & "\run-inventory-reorder.ps1""", 0, True
