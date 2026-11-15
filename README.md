# Edinot

Editor de notas en Markdown con lienzos, tablas y calendario, que funciona **sin conexión y sin cuentas**:
tus notas son tuyas y viven en tu equipo. Si quieres usarlas en varios equipos, las sincronizas con un
servidor **tuyo** (un VPS o un PC siempre encendido). No hay servidores ni cuentas de Edinot de por medio.

*English:* a local-first Markdown notes app (notes, canvases, tables, calendar). Everything works offline with no
account; to use it on several devices you sync through a server of your own. No cloud service in between.

## Qué incluye

- **App de escritorio** (Electron) para Windows, macOS y Linux. Las notas son Markdown plano.
- **Hub local**: un proceso pequeño que guarda tus datos en el equipo. La app, el CLI y los asistentes MCP lo usan
  sin red.
- **Sincronización con tu propio servidor**, cifrada sin necesidad de dominio (certificado propio con huella
  incluida en el enlace de emparejamiento) y con acceso por equipo que se puede revocar.
- **Compartir por vault** con otras personas, en lectura o escritura.
- **CLI** (`edinot`) y **servidor MCP** para usar tus notas desde la terminal o desde asistentes de IA externos.
  Edinot no incluye IA propia.

## Instalar

Descarga el instalador de tu sistema en [Releases](https://github.com/k4ditano/edinot/releases). Los instaladores
**no están firmados**: Windows y macOS mostrarán un aviso la primera vez. La app se actualiza sola desde esas
mismas releases.

## Tu propio servidor

El paquete `edinot-hub-linux.tar.gz` de cada release instala el hub en un servidor Linux con Node.js 20+:

```sh
tar xzf edinot-hub-linux.tar.gz && sudo sh install.sh
```

Imprime un enlace y un QR para emparejar tu primer equipo (en la app: Ajustes > Sincronización).
Más detalles, límites y la guía de seguridad en [`deploy/hub/README.md`](deploy/hub/README.md).

## Desarrollo

```sh
npm ci
npm start          # compila y abre la app
npm test           # pruebas
npm run cli -- help
```

Estructura: `editor*.jsx` y `ui/` (interfaz), `electron/` (proceso principal), `hub/` (hub y servidor),
`cli/` y `mcp/` (terminal y asistentes), `shared/` (código común), `deploy/hub/` (instalación del servidor).

## Licencia

[BSD 3-Clause](LICENSE). Las dependencias conservan sus propias licencias.
