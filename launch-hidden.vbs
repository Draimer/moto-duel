' launch-hidden.vbs
' Start a target executable with a hidden-but-valid console window.
'
' Why: Electron spawn with `windowsHide: true` + `stdio: 'ignore'` passes
' CREATE_NO_WINDOW to Windows, so the child gets NO console at all and
' GetConsoleWindow() returns NULL. Any app that relies on Raw Input,
' SetWindowsHookEx, or other HWND-requiring APIs will silently fail.
'
' WScript.Shell.Run with window style 0 creates a console window and
' immediately hides it — HWND is valid, the user never sees the black
' box.
'
' Usage: wscript launch-hidden.vbs <exe-path> [working-directory]

Option Explicit

If WScript.Arguments.Count < 1 Then
  WScript.Quit 1
End If

Dim exePath, workDir, shell, fso
exePath = WScript.Arguments(0)

Set fso = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count >= 2 Then
  workDir = WScript.Arguments(1)
Else
  workDir = fso.GetParentFolderName(exePath)
End If

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = workDir
' 0 = SW_HIDE, False = don't wait — fire and forget.
shell.Run """" & exePath & """", 0, False
