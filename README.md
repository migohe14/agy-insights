# agy-insights

Te muestra qué contexto le estás mandando a **Antigravity** de forma repetida o innecesaria, a partir del historial que Antigravity CLI guarda en tu equipo. Tú decides qué hacer con ello.

- Se ejecuta solo en tu máquina y no envía nada a ningún sitio.
- No cambia nada: te dice qué pegar y dónde, y lo haces tú si quieres.
- Solo propone mecanismos oficiales de Antigravity.
- Funciona con cualquier editor, en Windows, macOS y Linux.

## Por qué

Cada fichero que lee el agente y cada salida de comando entra en el contexto y se reenvía en los turnos siguientes de la conversación. La cuota es una bolsa común, así que cada lectura innecesaria la gasta para todos. Esta herramienta te enseña dónde se va ese contexto: relecturas, carpetas de compilación, salidas de tests enormes y sesiones demasiado largas.

## Requisitos

- **Node.js 20 o superior** (`node --version`). No hace falta `npm install`.
- Haber usado **Antigravity CLI** (`agy`) en este equipo. El historial está en `~/.gemini/antigravity-cli/conversations` (en Windows, `%USERPROFILE%\.gemini\antigravity-cli\conversations`).

## Instalar

No tiene dependencias. Elige una forma:

**Con `npx`, sin instalar nada:**

```sh
npx agy-insights
npx agy-insights --text
```

Para fijar una versión: `npx agy-insights@0.3.0`. En los ejemplos de abajo, cambia `node agy-insights.js` por `npx agy-insights`.

**Instalándolo globalmente:**

```sh
npm install -g agy-insights
agy-insights
```

**Clonando el repositorio:**

```sh
git clone https://github.com/migohe14/agy-insights.git
```

Para actualizar: `git pull` dentro de la carpeta. Opcional, para tener el comando `agy-insights` en cualquier carpeta: `npm install -g .` dentro de ella.

## Usar

```sh
node agy-insights/agy-insights.js
```

Analiza todo tu historial, guarda un informe HTML en la carpeta temporal y lo abre en el navegador.

| Para… | Ejecuta |
|---|---|
| Ver solo un proyecto | `node agy-insights.js --project C:\dev\mi-proyecto` |
| Ver el proyecto de la carpeta actual | `node <ruta>/agy-insights.js --project .` |
| Un resumen en la terminal | `node agy-insights.js --text` |
| El resumen con rutas y exclusiones | `node agy-insights.js --text --paths` |
| Un mapa del proyecto para pegar en `AGENTS.md` (carpetas, ficheros grandes, carpetas generadas; ~20 líneas aunque el repo sea grande) | `node agy-insights.js --map --project <carpeta>` |
| Guardar el informe en otro sitio | `node agy-insights.js --out informe.html --no-open` |
| Ver todas las opciones | `node agy-insights.js --help` |

El informe da dos cifras:

- **Consumo real**: los tokens que Antigravity anota en el registro de cada conversación (`~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl`), subagentes incluidos. Se muestra sin caché y con caché, porque no sabemos si la cuota cuenta igual la caché. Es la cifra que sirve para comparar entre compañeros.
- **«~tokens»**: estimados a partir del tamaño guardado de cada paso. Sirven para comparar qué ficheros, carpetas o comandos pesan más, pero se quedan cortos frente al consumo real, porque cada llamada al modelo vuelve a enviar el contexto acumulado.

## Leer el informe

Arriba están los totales. Debajo, **Qué está pasando** reúne los hallazgos; al final, el detalle por proyecto, tipo de fichero, carpeta, fichero, herramienta y comando. El proyecto de cada fichero se detecta por su carpeta `.git`.

| Hallazgo | Qué significa | Qué hacer |
|---|---|---|
| El agente vuelve a leer lo que ya tenía | Lee otra vez un trozo de fichero que ya estaba en la conversación | Sesiones más cortas, una por tarea, o `/compact`. No excluyas el fichero: lo necesita. |
| Ficheros generados, compilados o de dependencias | Lecturas de `bin/`, `obj/`, `dist/`, `node_modules`, migraciones, lockfiles o logs | Si no hacían falta, exclúyelos (ver abajo) |
| Los mismos ficheros entran en muchas sesiones | Un fichero se lee en varias conversaciones distintas | Si es código central es normal; si es grande, dile al agente qué parte mirar |
| Comandos con salidas muy largas | La salida de tests o builds entra entera | Pide ejecutar solo el test o proyecto afectado |
| Sesiones muy largas | Todo lo acumulado se reenvía en cada turno | Una conversación nueva por tarea |

## Excluir algo

Despliega **Cómo excluirlo** en una propuesta. Verás el fichero exacto, dónde va el texto y un botón **Copiar**. Hay tres opciones, de más a menos fuerte:

### 1. Denegar la lectura (permiso de Antigravity)

Es lo único que impide de verdad que el agente lea una ruta. Usa los [permisos oficiales](https://antigravity.google/docs/permissions).

1. Abre `~/.gemini/antigravity-cli/settings.json` (en Windows, `%USERPROFILE%\.gemini\antigravity-cli\settings.json`).
2. Pega la regla dentro de `"permissions"` → `"deny"`. Si no existen, créalas; si existen, añade la regla sin borrar nada:

   ```json
   {
     "model": "Gemini 3.8 Flash (Medium)",
     "permissions": {
       "deny": [
         "read_file(C:\\dev\\mi-proyecto\\src\\Infra\\obj)"
       ]
     }
   }
   ```

3. Guarda y reinicia `agy`.

Denegar la lectura de una ruta también impide escribir en ella, y la regla vale para todos tus proyectos. Úsala para carpetas que el agente no deba tocar nunca, como salidas de compilación.

### 2. `.antigravityignore`

Es el fichero de exclusión de Antigravity, en la raíz del proyecto. Su efecto no está documentado: está confirmado que oculta los ficheros del autocompletado con `@`, pero no que impida al agente leerlos.

### 3. Regla en `AGENTS.md`

Una línea en el `AGENTS.md` del proyecto, pidiendo al modelo que no lea algo o que limite una salida. Es una indicación, no un bloqueo. Las reglas se envían en cada petición y también gastan tokens, así que mantenlas cortas. `AGENTS.md` suele estar en el repositorio del equipo: revisa el cambio antes de subirlo.

## Configurar

Copia `agy-insights.example.json` a `~/.agy-insights.json` (o pásalo con `--config`) y ajústalo. Es tu configuración personal:

| Clave | Para qué sirve | Por defecto |
|---|---|---|
| `conversationsDir` | Otra carpeta de historial | la de Antigravity CLI |
| `customKinds` | Tipos de fichero propios: `{ "regex": "etiqueta" }` | ninguno |
| `crossSessionMin` | A partir de cuántas conversaciones avisa de un fichero repetido | 3 |
| `heavyOutputTokens` | A partir de qué tamaño medio avisa de un comando | 2000 |
| `longSessionTokens` | A partir de qué tamaño avisa de una sesión larga | 100000 |

## Privacidad

- Todo se calcula en tu equipo; no se envía nada.
- El historial se lee desde una copia temporal y nunca se modifica.
- No escribe en `~/.gemini`, no instala hooks ni plugins y no toca tu `.gitignore` ni tus proyectos.
- Lo único que escribe es el informe HTML, en la carpeta temporal o donde digas con `--out`.
- El informe contiene rutas de tus proyectos. No lo compartas sin revisarlo.
- **No compartas los ficheros `.db` del historial**: contienen el código que leyó el agente.

## Deshacer

- **Permiso**: borra la línea `read_file(…)` de `"deny"` en `settings.json` y reinicia `agy`.
- **.antigravityignore y AGENTS.md**: borra las líneas que añadiste.

## Problemas frecuentes

**«No hay conversaciones»**. Si usaste `--project`, puede que trabajaras con Antigravity desde otra carpeta: prueba sin `--project`. Si tampoco aparecen, comprueba que existe la carpeta del historial.

**«No se reconoce el formato del historial»**. Probablemente una versión nueva de Antigravity ha cambiado cómo guarda las conversaciones. Haz `git pull`; si sigue igual, abre una incidencia en el repo.

**Uso la app o el IDE de Antigravity, no el CLI**. Por ahora solo se lee el historial del CLI.

**El navegador no se abre**. La ruta del informe aparece en la terminal; ábrela a mano.

## Estado

Versión piloto. El formato del historial de Antigravity no está documentado, así que algunos datos pueden fallar con versiones nuevas. Si ves algo raro, abre una incidencia. Para contribuir, mira [docs/como-funciona.md](docs/como-funciona.md).
