@echo off
chcp 65001 >nul
title 세계선교교회 행운권 추첨
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js가 필요합니다. 운영 안내 LUCKY-DRAW.md를 확인해 주세요.
  pause
  exit /b 1
)
node "%~dp0site\scripts\serve-lucky-draw.mjs" --open
pause
