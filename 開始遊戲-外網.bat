@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 狼人殺伺服器（外網）
where node >nul 2>nul || (echo 找不到 Node.js，請先到 https://nodejs.org 下載安裝 LTS 版本，再重新執行。 & pause & exit /b)
if not exist node_modules (echo 第一次啟動，正在安裝套件，請稍候... & call npm install)
call npm run online
pause
