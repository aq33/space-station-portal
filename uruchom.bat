@echo off
rem Uruchamia Space Station Portal na http://127.0.0.1:8615/
cd /d "%~dp0"
python serwer.py %*
pause
