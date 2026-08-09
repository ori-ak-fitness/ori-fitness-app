@echo off
rem Double-click this file to open Ori Fitness App as a standalone window.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launch.ps1"
