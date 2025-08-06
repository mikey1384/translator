; NSIS installer override for Translator
; This file overrides the default QuitApp macro to allow installation
; while the application is running, preventing annoying close prompts.

!macro QuitApp
  ; Intentionally left blank to allow installation alongside a running instance.
  ; The installer will proceed without forcing the application to close.
!macroend 