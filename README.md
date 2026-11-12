# Pesquisas de Estaca · versión 2.0

Sistema web para organizar sesiones de Pesquisas, registrar asistencia por barrio, gestionar escrituras, capturar puntos en vivo o manualmente, mostrar la clasificación y guardar los datos en MySQL.

## Qué contiene

- `public/index.html`: interfaz web que sirve el servidor.
- `Index.html` / `index.html`: la misma interfaz para prueba local y para la versión heredada de Google Apps Script.
- `server.js`: backend Express, API, autenticación y conexión a MySQL.
- `package.json`: dependencias y comandos de arranque.
- `.env.example`: plantilla de configuración. Cópiala como `.env` y completa tus datos.
- `schema.sql`: comandos iniciales para crear la base de datos y el usuario MySQL.
- `start.bat`: asistente básico para Windows; crea `.env` si hace falta, permite editarlo e inicia la app.
- `Code.gs` y `appsscript.json`: integración heredada con Google Sheets, por si prefieres mantener esa alternativa.

## Funciones añadidas

- Terminar sesión con una pantalla animada de preparación de **20 segundos**.
- Premiación progresiva: tercer lugar, segundo lugar, primer lugar y clasificación completa antes de volver al panel.
- Historial con hora de inicio y finalización y botón para eliminar una sesión, con confirmación.
- Captura manual para agregar o corregir barrios que no alcanzaste a pulsar durante el cronómetro. Permite ajustar los puntos y opcionalmente escribir el tiempo de respuesta.
- Atajos de teclado `1` a `9` para marcar los primeros nueve barrios activos mientras corre la ronda. El orden es el mismo que aparece en la pantalla de asistencia.
- Sonido al llegar al segundo 5 y al terminar el contador. El navegador debe permitir reproducir audio.
- Lista de escrituras en el orden de aparición, botones para mover una escritura arriba o abajo y modo `Escritura 1`, `Escritura 2`, etc. si no quieres mostrar la referencia real en la interfaz.
- Estilo actualizado con colores violeta/índigo, tarjetas, controles y pantalla de podio adaptable a pantallas pequeñas.
- Persistencia del estado completo en MySQL. Cerrar el navegador o reiniciar el servidor no borra las actividades guardadas.

## Requisitos

- Node.js 18 o posterior.
- MySQL 8.0 recomendado (MySQL 5.7.8+ también soporta columnas JSON).
- Navegador moderno, preferiblemente Chrome o Edge.

## Instalación con MySQL

### 1. Crear la base de datos

Instala/inicia MySQL. En una consola de MySQL ejecuta `schema.sql`, o crea una base de datos y un usuario equivalentes. El archivo `schema.sql` usa estos valores de ejemplo:

- Base de datos: `pesquisas_estaca`
- Usuario: `pesquisas_app`
- Contraseña de ejemplo: `cambia_esta_contrasena_mysql`

Cambia la contraseña de ejemplo por una propia antes de usar la aplicación en red. El usuario de la aplicación necesita permisos sobre esa base de datos.

### 2. Configurar las variables

En la carpeta principal del proyecto, crea `.env` copiando `.env.example`. Ajusta `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` y `DB_NAME` para tu instalación.

Cambia `JWT_SECRET` por una clave aleatoria larga. Puedes generar una desde Node.js con:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Cambia también `ADMIN_PASSWORD` antes de iniciar por primera vez, preferiblemente por una clave temporal segura. Si la cuenta `admin` ya se creó en MySQL, cambiar `ADMIN_PASSWORD` en `.env` no modifica la contraseña existente; cámbiala desde **Configuración → Cambiar contraseña**.

### 3. Instalar y arrancar

Desde la carpeta del proyecto:

```bash
npm install
npm start
```

Abre `http://localhost:3000` en Chrome o Edge. El servidor crea las tablas `app_users` y `app_state` si no existen; también crea cinco barrios de ejemplo en el primer arranque para que puedas renombrarlos desde la app.

La primera cuenta usa el usuario definido por `ADMIN_USER` (por defecto `admin`) y la contraseña definida por `ADMIN_PASSWORD`. Si no cambiaste la plantilla, será `admin / admin`; es únicamente una credencial inicial y debe cambiarse antes de una actividad real.

Puedes revisar que la conexión de base de datos funciona abriendo `http://localhost:3000/api/health`. La respuesta esperada es `{"ok":true,"database":"connected"}`.

## Despliegue en otra computadora o en internet

No basta con copiar el HTML: para persistencia compartida, debes ejecutar el servidor Node.js, permitir que se conecte a MySQL y publicar la URL del servidor. Usa HTTPS para acceso fuera de una red local; configura las variables de entorno en el servicio de hosting y no subas `.env` al repositorio.

Para usarla solo dentro de la capilla o de la red local, inicia el servidor en una computadora que permanezca encendida y abre desde los demás equipos la dirección local de esa computadora con el puerto `3000` permitido por el firewall. Todos los dispositivos deben entrar a la misma URL para consultar el mismo estado.

## Persistencia de datos

El estado operativo se guarda como un documento JSON en `app_state.state`. Es un diseño intencionalmente sencillo para mantener sincronizada la app completa: barrios, asistencia, sesiones, escrituras, resultados, puntuaciones y fechas de inicio/cierre. La tabla `app_users` mantiene los hashes bcrypt de las contraseñas; las contraseñas no se guardan en texto plano. Para exportar una copia desde el panel, entra a **Configuración** o **Historial** y pulsa **Exportar respaldo**.

## Modo local y Google Sheets

- Abrir `index.html` directamente desde el explorador de archivos activa el modo de demostración, que guarda datos en `localStorage` de ese navegador.
- El backend MySQL se activa al abrir la aplicación servida por `server.js`.
- Se conserva `Code.gs` para quien prefiera desplegar la versión de Apps Script con Google Sheets. Esa alternativa necesita publicarse desde una cuenta Google y no requiere MySQL.

## Reglas de puntuación predeterminadas

- Cada líder presente: 100 puntos por barrio.
- Hallazgo en los primeros 5 segundos: 200 puntos.
- Hallazgo después del segundo 5 y dentro del límite de 10 segundos: 100 puntos.
- Escritura especial: 500 puntos de forma predeterminada, editable por ronda.
- Un barrio puntúa una sola vez por ronda; los resultados manuales sirven para corregir o completar hallazgos que se pasaron por alto.

## Seguridad y cuidado de datos

No dejes la contraseña inicial `admin/admin` activa. Configura un `JWT_SECRET` privado, cambia las credenciales de MySQL de ejemplo y no expongas MySQL directamente a internet. Publica el servidor con HTTPS si lo usarán desde fuera de la red local. La app registra conteos de asistencia por barrio, no nombres individuales de menores.
