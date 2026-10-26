# agentes-activos

Mod de Claude Code que muestra los subagentes en ejecución mientras trabajas: un panel con el árbol en vivo, un contador en la barra de estado y el título de la pestaña del terminal.

*A Claude Code mod that shows your running subagents while you work: a live tree in a side panel, a counter in the status bar and the terminal tab title.*

## Qué hace

- **Panel «Agentes»**: árbol en vivo de los subagentes por quién lanzó a quién, con estado, modelo abreviado (`opus 5.5`, `sonnet 3.5`, `haiku`…; también entiende los ids de Bedrock y Vertex), tiempo y descripción. El modelo se toma al lanzarse cada agente, así que no aparece en los que ya corrían cuando se cargó el mod. Los terminados se quedan 5 minutos (como mucho los 10 últimos) en la sección «Terminados»; un agente terminado con algún hijo aún en ejecución sigue en el árbol, atenuado.
  - Se abre solo al lanzar el primer agente si la terminal tiene 144 columnas o más. Si es más estrecha, Claude Code lo deja en espera hasta que la ensanches o lo abras con `/agentes`.
  - En cualquier momento: `/agentes`.
- **Barra de estado**: `🤖 N agentes en ejecución` mientras haya alguno activo.
- **Título de la pestaña** (Warp, iTerm2, Terminal.app…): `🤖 N agentes · nombres`. Al terminar vuelve a «Claude Code».

## Instalación

```sh
claude plugin marketplace add wkielw2/warp-agents-follow-mod
claude plugin install agentes-activos@agentes-activos
```

Para probar una copia local sin instalarla: `claude --plugin-dir .` desde la raíz del repositorio.

Necesita Claude Code 2.1.303 o posterior: es un mod de *function hooks*, una API en acceso anticipado que puede cambiar entre versiones.

## Qué ejecuta y qué datos usa

- **Solo lee la lista de agentes de la sesión** que le da Claude Code. No guarda nada en disco y no hace ninguna llamada de red.
- **Para el título de la pestaña ejecuta dos comandos con argumentos fijos, sin `sh` ni ningún otro shell; los dos se ven en `hooks/register.tsx`:**
  - `ps -A -ww -o pid= -o ppid= -o tty= -o command=`, una vez al empezar la sesión: localiza su propia fila en la lista de procesos y sube por los padres hasta el primer terminal (`/dev/ttys…` o `/dev/pts/…`).
    - **Qué lee:** el pid, el proceso padre, el terminal y la línea de comando completa de todos los procesos del sistema, incluidos los de otros programas y usuarios con sus argumentos.
    - **Por qué la línea de comando:** la API de mods no da el pid del proceso de Claude Code, así que el mod reconoce la fila de su propio `ps` por su línea de comando exacta; el resto de columnas basta para subir por los padres. Con solo el nombre del programa (`ps`) habría ambigüedad cuando hay otro `ps` en marcha.
    - **Qué hace con ello:** lo lee solo en memoria, una vez, para encontrar el terminal; no lo guarda, no lo registra y no lo envía a ningún sitio.
  - `tee /dev/<terminal>`: recibe por la entrada estándar la secuencia OSC 0 (`ESC ]0;` + título + `BEL`) y la escribe en ese terminal. Solo escribe en una ruta `/dev/tty…` o `/dev/pts/…` sacada de la salida de `ps`.
- Sin terminal, si `ps` no está disponible, falla o su salida llega truncada, no escribe ningún título.
- Si una escritura del título falla, se reintenta en el siguiente tick sin afectar al panel.
- Claude Code puede cambiar el título por su cuenta; el mod lo vuelve a escribir cada 10 s mientras hay agentes.
- Los nombres, descripciones y modelos de los agentes se limpian de caracteres de control e invisibles antes de mostrarse o de escribirse en el título.
- El modelo se guarda ya limpio y recortado a 64 caracteres; si no es texto o queda vacío, no se guarda. Cada segundo se descartan los modelos de los agentes que ya no están en el panel ni en la lista, para que el mapa no crezca durante la sesión.

## Eventos que engancha

Todos están en `hooks/register.tsx`. Ninguno cambia lo que pasa por el evento: solo observa y dibuja.

- **`session.start`**: deja que la sesión arranque primero, registra el comando `/agentes`, busca una vez el terminal para el título (el `ps` de arriba) y pone un reloj que cada segundo lee la lista de agentes.
- **`command.run` de `/agentes`**: solo responde a su propio comando; abre el panel y lo actualiza.
- **`agent.spawn`**: deja que Claude Code lance el agente sin tocar su petición ni su resultado y, después, guarda el modelo con el que se lanzó, abre el panel la primera vez y lo actualiza. Si el panel falla, el lanzamiento del agente sigue igual.
- **`session.end`**: si había puesto un título, lo vuelve a dejar en «Claude Code».
- **`ui.render` del panel `agentes`**: dibuja solo su propio panel.

## Notas

- Los agentes de un workflow no aparecen: Claude Code no los incluye en su lista de agentes.

## Desarrollo

Desde la raíz del repositorio:

```sh
claude plugin validate . --profile directory
claude plugin validate . --strict
claude plugin test .
```

- `hooks/agents.ts`: lógica pura (árbol, tiempos, nombre corto del modelo, saneado y poda del modelo, saneado de texto, búsqueda del terminal en la salida de `ps` y secuencia del título). Tests en `tests/agents.test.ts`.
- `hooks/register.tsx`: engancha los eventos y dibuja el panel. Tests en `tests/register.test.tsx`, que simulan el motor con hooks por debajo del plugin (`agent.list`, `ui.open`, `ui.status` y `process.run` para el título).

## Privacidad

El mod no guarda ni envía ningún dato. Detalle en la [política de privacidad · Privacy](PRIVACY.md).

## Licencia

MIT © 2026 Jose Miniñi Diego. Ver [LICENSE](LICENSE).
