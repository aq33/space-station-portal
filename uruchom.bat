@echo off
rem Uruchamia porownywarke sprite'ow na http://127.0.0.1:8615/
cd /d "%~dp0"
python serwer.py %*
pause
