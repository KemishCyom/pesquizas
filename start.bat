@echo off
setlocal
cd /d "%~dp0"
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Se creo el archivo .env desde la plantilla.
  echo Edita .env con tus datos de MySQL y una JWT_SECRET aleatoria, y vuelve a ejecutar start.bat.
  notepad .env
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Instalando dependencias de la aplicacion...
  call npm install
  if errorlevel 1 (
    echo No se pudieron instalar las dependencias. Revisa Node.js y tu conexion.
    pause
    exit /b 1
  )
)
call npm start
pause
