# Privacidad · Privacy

Política de privacidad del mod de Claude Code `agentes-activos`. Se aplica a todas sus versiones publicadas en este repositorio.

*Privacy policy of the `agentes-activos` Claude Code mod: it reads only what it needs to draw the panel and the tab title, keeps it in memory, and sends nothing anywhere.*

## Qué datos lee

- **La lista de agentes de la sesión** que le da Claude Code: nombre, tipo, descripción, estado y tiempos de cada subagente. Sirve para dibujar el panel, el contador de la barra de estado y el título de la pestaña.
- **El modelo de IA con el que se lanza cada subagente** (por ejemplo `claude-opus-5-5`), que Claude Code devuelve al lanzarlo, porque la lista de agentes no lo trae. Solo se muestra en el panel y se descarta cuando Claude Code deja de listar al agente.
- **Los agentes terminados que salen del panel** (más de 5 minutos o fuera de los 10 últimos) pero que Claude Code sigue listando se conservan ocultos en memoria, con los mismos datos, solo para que no reaparezcan; se olvidan cuando Claude Code los suelta o al cerrar la sesión.
- **La lista de procesos del sistema, una vez por sesión**, con `ps -A -ww -o pid= -o ppid= -o tty= -o command=`. Incluye la línea de comando completa de cada proceso, que puede contener datos de otros programas. Solo sirve para encontrar el terminal de la sesión: el mod reconoce la fila de su propio `ps` y sube por los procesos padre hasta el primer terminal.

## Qué hace con ellos

- Todo se queda **en memoria** mientras dura la sesión. El mod no guarda nada en disco, no escribe registros y no usa el almacén persistente de Claude Code.
- **No envía nada a ningún sitio**: no hace llamadas de red, no tiene servidores MCP, no recoge telemetría y no comparte datos con terceros, incluido su autor.
- Lo único que escribe es el **título de la pestaña** en el terminal de la propia sesión, con `tee /dev/<terminal>`. El título solo lleva el número de agentes en ejecución y sus nombres, limpios de caracteres de control.

## Qué código ejecuta

- Solo dos programas del sistema, `ps` y `tee`, con los argumentos fijos de arriba y sin ningún shell.
- No descarga ni ejecuta otro código, no lee variables de entorno ni credenciales, y no cambia permisos ni ajustes de Claude Code.

## Conservación

No conserva datos: al cerrar la sesión no queda nada del mod, salvo el título de la pestaña, que vuelve a «Claude Code».

## Contacto

Dudas o problemas: abre un issue en https://github.com/wkielw2/warp-agents-follow-mod/issues.
