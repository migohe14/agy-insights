# Cómo funciona

Documento para quien mantenga o amplíe agy-insights.

## Principios

Cualquier cambio tiene que respetarlos:

1. **Solo lectura.** No se escribe en `~/.gemini` ni en los proyectos del dev. El historial se copia a una carpeta temporal antes de abrirlo, porque `agy` mantiene esas bases de datos abiertas. Lo único que se escribe es el informe.
2. **El dev decide.** La herramienta propone texto para pegar; nunca lo aplica.
3. **Solo mecanismos oficiales de Antigravity** para excluir: permisos (`read_file` en `permissions.deny`), `.antigravityignore` y reglas en `AGENTS.md`. Nada de hooks, plugins, `.gitignore` ni `.ignore`.
4. **Fallar de forma visible.** Si el formato del historial cambia, el informe debe avisar en vez de mostrar datos falsos.
5. **Sin dependencias que instalar.** Solo Node 20 o superior; SQLite va en `vendor/`.

## Estructura

```
agy-insights.js       comando: opciones, configuración, escribe el informe y abre el navegador
lib/history.js        lee el historial y agrega lecturas, comandos, proyectos y sesiones
lib/findings.js       convierte el análisis en hallazgos (los 5 detectores)
lib/fixes.js          construye el texto de cada exclusión; no escribe nada
lib/report.js         informe HTML (estático, solo botones de copiar) y resumen de texto
vendor/sql.js/        SQLite en WebAssembly (versión en VERSION, licencia MIT en LICENSE)
test/fake-history.js  genera historiales falsos con el mismo formato que los reales
test/*.test.js        tests (node --test)
```

## El historial de Antigravity CLI

No está documentado; esto es lo que se ha observado en `agy` 1.4.x.

- Una base de datos SQLite por conversación: `~/.gemini/antigravity-cli/conversations/<uuid>.db`, en modo WAL.
- Tabla `steps`: una fila por paso. `step_payload` es un mensaje protobuf. Las llamadas a herramientas guardan el nombre (`view_file`, `run_command`, `grep_search`…) seguido de sus argumentos en JSON, por ejemplo `{"AbsolutePath":"C:\\dev\\...\\X.cs","StartLine":301,"EndLine":380}`, precedido por un id `call_NNN`.
- Cada llamada ocupa dos pasos con el mismo id: el de la respuesta del modelo que la pide (`step_type` 15) y el del resultado (`step_type` 132), que repite nombre y argumentos y añade el contenido del fichero o la salida del comando. `lib/history.js` cuenta la llamada una vez por id y suma el tamaño de ambos pasos, que aproxima lo que entró en el contexto.
- Tabla `gen_metadata`: configuración de cada llamada al modelo, incluido el nombre del modelo.
- Junto al historial, `../brain/<id>/.system_generated/logs/transcript.jsonl`: una línea JSON por paso. Las de tipo `PLANNER_RESPONSE` son llamadas al modelo y traen `input_tokens`, `cache_read_tokens` y `output_tokens`; los pasos fallidos tienen `status: "ERROR"`. Los subagentes tienen su propia conversación y su propio transcript. `realUsage()` en `lib/history.js` suma esas cifras (solo lee el fichero). El total que imprime `agy -p --output-format json` no incluye los subagentes; este sí.

`lib/history.js` no depende de un esquema protobuf. Recorre el mensaje, recoge todas las cadenas, y considera llamada a herramienta cualquier JSON precedido (a menos de 3 cadenas) por un nombre en `snake_case`. Así aguanta cambios menores de formato. Si hay más de 50 pasos y ninguna llamada reconocida, marca `formatUnrecognized` y el informe lo avisa.

### SQLite

- Con Node 22.13 o superior se usa `node:sqlite`, que lee también el fichero `-wal`.
- Con versiones anteriores se usa `sql.js` desde `vendor/`. No lee el `-wal`, así que pueden faltar los últimos pasos de una conversación abierta.

Para actualizar `sql.js`: copia `dist/sql-wasm.js`, `dist/sql-wasm.wasm` y `LICENSE` de la nueva versión del paquete npm y actualiza `VERSION`.

### Proyectos

El proyecto de cada fichero se detecta subiendo por su ruta hasta encontrar una carpeta con `.git`, si la ruta existe en la máquina. Con `--project` se usa esa carpeta directamente. Las rutas de Windows (`C:\...`) se normalizan a `/` internamente y se devuelven con `\` en las exclusiones, porque `agy` compara las rutas de los permisos literalmente.

## Añadir un tipo de fichero

En `lib/history.js`, función `kind()`. Si es un tipo que casi nunca hace falta leer, añádelo también a `NON_SOURCE`, y sus patrones de `.antigravityignore` a `KIND_PATTERNS` en `lib/findings.js`. Cada dev puede añadir tipos propios sin tocar el código con `customKinds` en su configuración.

## Añadir un detector

En `lib/findings.js`. Un hallazgo es `{ id, level: 'info' | 'warn', title, why, suggestion, tokens, items }`, y cada `item` es `{ label, tokens, detail, fixes }`. Las `fixes` se crean con `lib/fixes.js`. No propongas excluir código fuente: el agente lo necesita.

Añade un caso en `test/fake-history.js` y un test.

## Tests

```sh
npm test
```

Prueban el análisis con un historial falso, los cinco detectores, el formato de las reglas, que nunca se propone excluir código fuente, que el historial no cambia, la detección de proyectos por `.git`, el aviso de formato desconocido, el escapado del HTML y el comando completo. Se ejecutan en CI con Node 20 (sql.js) y Node 22 (node:sqlite).

Para generar un historial de ejemplo y probar el informe a mano:

```sh
node test/fake-history.js test/tmp/history
node agy-insights.js --dir test/tmp/history
```

## Paquete npm

`package.json` define el comando (`bin`) y qué ficheros entran en el paquete (`files`: el comando, `lib/`, `vendor/`, `docs/` y el ejemplo de configuración; los tests no). Está marcado como `private` para que no se publique por error.

- **Desde el repositorio**, sin publicar: `npx --yes git+https://<gitlab>/<grupo>/agy-insights.git`. Al no tener dependencias ni paso de build, npm lo instala directamente desde git.
- **Probar el paquete en local**: `npm pack` y después `npx --yes --package=./agy-insights-<versión>.tgz agy-insights --help`.
- **Publicarlo en el registro de paquetes de GitLab** (opcional, para `npx @<grupo>/agy-insights`): cambiar `name` a `@<grupo>/agy-insights`, quitar `private`, añadir `"publishConfig": { "registry": "https://<gitlab>/api/v4/projects/<id>/packages/npm/" }` y un job de CI que ejecute `npm publish` con `CI_JOB_TOKEN`. Cada dev necesita en su `.npmrc` la línea `@<grupo>:registry=https://<gitlab>/api/v4/packages/npm/` y un token de lectura.


## Pendiente

- Confirmar con `agy` que una regla `deny` de `read_file` impide la lectura.
- Probar con historiales reales de varios devs (Windows y macOS).
- Leer también el historial de la app y del IDE de Antigravity, si guardan el mismo formato.
