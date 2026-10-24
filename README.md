# agentes-activos

Mod de Claude Code que muestra los subagentes en ejecución mientras trabajas: un panel con el árbol en vivo, un contador en la barra de estado y el título de la pestaña del terminal.

*A Claude Code mod that shows your running subagents while you work: a live tree in a side panel, a counter in the status bar and the terminal tab title.*

## Qué hace

- **Panel «Agentes»**: árbol en vivo de los subagentes por quién lanzó a quién, con estado, tiempo y descripción. Los terminados se quedan 5 minutos (como mucho los 10 últimos) en la sección «Terminados»; un agente terminado con algún hijo aún en ejecución sigue en el árbol, atenuado.
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
- **Para el título de la pestaña ejecuta dos comandos de `sh`**, ambos visibles en `hooks/register.tsx`:
  - Uno busca el terminal de la sesión subiendo por los procesos padre con `ps -o ppid= -o tty=` hasta encontrar un dispositivo `/dev/tty…`.
  - Otro escribe en ese terminal la secuencia OSC 0 (`printf "\033]0;%s\007"`) con el título.
- Claude Code puede cambiar el título por su cuenta; el mod lo vuelve a escribir cada 10 s mientras hay agentes.
- Los nombres y descripciones de los agentes se limpian de caracteres de control e invisibles antes de mostrarse o de escribirse en el título.

## Notas

- Los agentes de un workflow no aparecen: Claude Code no los incluye en su lista de agentes.

## Desarrollo

Desde la raíz del repositorio:

```sh
claude plugin validate .
claude plugin test .
```

- `hooks/agents.ts`: lógica pura (árbol, tiempos, saneado de texto). Tests en `tests/agents.test.ts`.
- `hooks/register.tsx`: engancha los eventos y dibuja el panel. Tests en `tests/register.test.tsx`, que simulan el motor con hooks por debajo del plugin (`agent.list`, `ui.open`, `ui.status` y `process.run` para el título).

## Licencia

MIT © 2026 Jose Miniñi Diego. Ver [LICENSE](LICENSE).
