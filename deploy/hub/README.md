# Hub de Edinot en un servidor (VPS o un PC siempre encendido)

No se instala la aplicación de escritorio: solo dos archivos de terminal, sin pantalla
ni interfaz gráfica. Todo se maneja con comandos.

## Lo más sencillo: sin dominio, cifrado de serie

Si el hub escucha fuera del servidor (`0.0.0.0`, que es lo que hace `edinot serve` y el contenedor),
**se cifra solo**: genera un certificado propio (carpeta `tls/` de sus datos) y sirve por TLS. No hace
falta dominio, Caddy ni Tailscale. Solo hay que decirle con qué dirección se llegará a él:

```sh
docker run -d --name edinot-hub --restart unless-stopped \
  -p 17870:17870 -v edinot-hub:/data \
  -e EDINOT_HUB_PUBLIC_URL=https://<ip-o-nombre-del-servidor>:17870 edinot-hub
docker exec -u node edinot-hub node /app/edinot.mjs pair     # código, enlace y QR
```

**Cómo se evita que alguien se haga pasar por el servidor:** el enlace de emparejamiento
(`edinot://pair?u=…&c=…&f=<huella>`) lleva la huella del certificado. El equipo nuevo comprueba que el
servidor presenta justo ese certificado y desde entonces solo acepta ese. Por eso hay que usar el
**enlace o el QR completo**: el código suelto (`ABCDE-FGHJK`) no lleva huella y el equipo se negará a
conectar con un servidor de certificado propio. Si algún día se regenera el certificado
(`edinot serve --new-cert`), los equipos emparejados dejan de fiarse y hay que emparejarlos otra vez.

Para un proxy con HTTPS normal (Caddy, nginx) deja el hub en `127.0.0.1` (o arráncalo con `--no-tls` /
`EDINOT_HUB_TLS=0`, que es lo que hay que poner en el contenedor si va detrás de un proxy) y la sección
siguiente. Tailscale tampoco hace falta, pero sigue funcionando.

## Qué necesitas

- Un servidor Linux con **Node.js 20 o superior**.
- Un dominio apuntando a él, para tener **HTTPS** (Caddy lo da gratis y solo).
- Los dos archivos que salen de `npm run build`: `dist/edinot.mjs` y `dist/hub.mjs`.

## Instalar (en el servidor)

```sh
# desde tu equipo: copia los dos archivos y el instalador
scp dist/edinot.mjs dist/hub.mjs deploy/hub/install.sh usuario@servidor:~/edinot-hub/

# en el servidor
cd ~/edinot-hub
sudo sh install.sh --public-url https://hub.tu-dominio.com
```

El instalador crea el usuario `edinot`, deja los datos en `/var/lib/edinot`, instala el
servicio `edinot-hub` y un comando `edinot` para administrarlo. El hub escucha **solo en
127.0.0.1**: no queda expuesto hasta que pongas HTTPS delante.

## HTTPS con Caddy

```caddy
hub.tu-dominio.com {
    reverse_proxy 127.0.0.1:17870
}
```

Caddy reenvía también los WebSockets, que es lo que usa la sincronización.

## Añadir equipos

```sh
edinot pair          # en el servidor: código de 5 minutos, enlace y QR en la terminal
edinot join ABCDE-FGHJK --server https://hub.tu-dominio.com    # en el equipo nuevo
edinot devices       # quién está emparejado
edinot devices revoke <id>    # cortar un equipo (deja de sincronizar al instante)
```

El código sirve una vez. El equipo nuevo recibe **su propia credencial**: la clave maestra
del hub no sale nunca del servidor, y si alguien la intenta usar a través de la red recibe
un 403.

## Compartir solo algunos vaults (con otra persona)

```sh
edinot share Trabajo --read-only     # código/enlace/QR: acceso SOLO a ese vault, y solo para leer
edinot share Trabajo Proyectos       # lectura y escritura en esos dos vaults
edinot shares                        # accesos compartidos activos
edinot devices revoke <id>           # quitar uno: deja de sincronizar al instante
```

En la app: Ajustes > Sincronización > «Añadir otro equipo» > «Solo algunos vaults».

Cómo funciona y sus límites, sin adornos:

- **La granularidad es el vault.** El texto de las notas vive dentro del documento de su vault, así que no
  se puede dar acceso a una carpeta o a una nota suelta sin rehacer cómo se guardan los datos.
- Quien recibe el acceso no puede leer ni cambiar ningún otro vault ni administrar el servidor
  (emparejar, ver o quitar equipos, importar). Con «solo lectura» el servidor descarta sus cambios; el CLI
  lo avisa en vez de aparentar que se guardaron.
- **Sí ve los nombres de tus demás vaults** (el documento con la lista se le ofrece en solo lectura), no su
  contenido.
- **Revocar corta el acceso futuro, no lo pasado:** lo que ya se sincronizó al equipo de esa persona
  sigue en su disco; Edinot no puede borrarlo.
- Una app de escritorio solo sincroniza con **un** servidor a la vez. Quien se une con un acceso compartido
  recibe esos vaults, pero sus propios vaults dejan de sincronizarse mientras esté unido. Para una persona
  que tiene su propio servidor, lo cómodo es usar el CLI o el MCP para el acceso compartido.

## En un PC tuyo en vez de un VPS

Es el mismo programa: `edinot serve --host 127.0.0.1 --public-url <dirección>`. Para que
otros equipos lleguen sin abrir puertos en el router, lo más sencillo es **Tailscale** (una
dirección privada `http://tu-pc:17870`) o un túnel de Cloudflare.

## Docker

Ver `Dockerfile` en esta carpeta. Probado el 2026-11-15 en un VPS con Docker 28: emparejar,
escribir, leer desde otro equipo y quitar un equipo funcionan. Se construye desde una carpeta que
tenga `dist/edinot.mjs` y `dist/hub.mjs`; el contenedor escucha en el puerto 17870 (publícalo solo
en 127.0.0.1 y pon nginx o Caddy con HTTPS delante, que reenvíe también los WebSockets).

Para generar un código dentro del contenedor: `docker exec -u node edinot-hub node /app/edinot.mjs pair`
(sin `-u node` el comando corre como root, que no es el dueño de los datos).

## Copias de seguridad

Los datos son la carpeta `/var/lib/edinot` (`docs/` y `blobs/`). El hub guarda además una
copia diaria de cada documento que cambia durante 14 días en `backups/`, en el mismo disco:
**haz también una copia fuera del servidor.** Para tener tus notas en Markdown legible sin
Edinot: `edinot export /ruta/destino --attachments`.

## Lo que todavía no hace

- No hay QR para escanear desde el móvil (no hay app móvil); en escritorio se pega el código.
- No hay P2P directo entre equipos; todos sincronizan a través de este servidor.
- `install.sh` (systemd) sigue sin probarse en un servidor real; el contenedor sí está probado.
