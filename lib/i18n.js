// User-facing text in English and Spanish. The language comes from --lang, the "lang" config key, or the
// system locale (Spanish if it starts with "es", else English). Modules read strings through `t`, which
// always points at the current language, so setLang() must run before any report is built.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const en = {
  locale: 'en-US',
  help: (dir) => `Usage: agy-insights [options]   (or npx agy-insights, or node agy-insights.js)

Analyzes your Antigravity CLI history and opens a report in the browser.

Options:
  --project <folder>    Only conversations that touched that project ("." = current folder)
  --text                Summary in the terminal instead of the HTML report
  --paths               With --text, show paths and the proposed exclusions
  --map                 Print a project map (--project, or the current folder) for AGENTS.md
  --out <file>          Where to save the HTML report (default: the temp folder)
  --no-open             Don't open the browser
  --since <YYYY-MM-DD>  Only conversations active since that date
  --days <n>            Only conversations active in the last n days
  --lang <en|es>        Language of the output (default: the system's)
  --debug-models        Per conversation, where each call's model came from (counts only, to report issues)
  --dir <folder>        Another history folder (default the CLI's and the editor's: ${dir})
  --config <file>       Configuration (default ~/.agy-insights.json if it exists)
  --help                This help
`,
  missingValue: (opt) => `Missing value for ${opt}`,
  unknownOption: (opt) => `Unknown option: ${opt}. See --help.`,
  badLang: (v) => `Unsupported language: ${v}. Use en or es.`,
  badDate: (v) => `Invalid date: ${v}. Use YYYY-MM-DD.`,
  badDays: (v) => `Invalid number of days: ${v}.`,
  configNotFound: (f) => `Configuration file not found: ${f}`,
  cannotRead: (f, msg) => `Cannot read ${f}: ${msg}`,
  mapDone: (tokens, file) => `\n~${tokens} tokens on every request. Paste it into ${file} if you like it; agy-insights does not write it.`,
  reportName: 'report',
  debugModels: {
    header: ['conversation', 'calls', 'gen_metadata rows', 'rows with model', 'calls with model in transcript', 'unknown', 'main model', 'unrecognized model ids', 'calls without tokens', 'fields of those calls'],
    total: 'total',
    note: 'Only counts and model names or ids: no paths, prompts or code. Paste it into an issue if models show up as unknown.',
  },
  done: (convs, found, out) => `${plural(convs, 'conversation', 'conversations')} analyzed, ${plural(found, 'finding', 'findings')}.\nReport: ${out}`,

  kinds: {
    agent: "Antigravity's own files (brain, skills)",
    build: 'build output (dist, bin, obj…)', logs: 'logs, maps, minified', generated: 'generated code / migrations', images: 'images',
    other: 'other', code: (ext) => `code ${ext}`,
  },

  fixes: {
    denyTitle: 'Deny reading it in the CLI (Antigravity permission)',
    denyWhere: 'inside "permissions" → "deny"',
    denyNote: 'This is the only thing that actually blocks the read. It applies to all your projects, also blocks writing to that path, and agy must be restarted.',
    denyEditorTitle: 'Deny reading it in the IDE and extensions (Antigravity permission)',
    denyEditorPlace: 'Settings → Permission Grants',
    denyEditorWhere: 'of the Antigravity IDE, app or editor extension, as a deny rule',
    denyEditorNote: 'These have no settings file to edit: rules are added from their Settings. It blocks the read in all your projects (or only in one, as a project-level grant) and also blocks writing to that path.',
    ignoreTitle: 'Add to .antigravityignore',
    ignoreWhere: 'at the end of the file (create it if missing)',
    ignoreNote: 'Hides it from @ completion; it is not documented to stop the agent from reading it.',
    ruleTitle: 'Add a rule to AGENTS.md',
    ruleWhere: 'at the end of the file',
    ruleNote: 'It is an instruction to the model, not a block. It is sent with every request: keep it short. AGENTS.md is usually in the team repo.',
  },

  findings: {
    formatTitle: 'The history format is not recognized',
    formatWhy: (steps) => `There are ${steps} steps but no recognizable tool call. agy has probably changed how it stores conversations.`,
    formatSuggestion: 'The results below are not reliable. Update agy-insights (npx agy-insights@latest) or open an issue on GitHub.',
    rereadsTitle: 'The agent re-reads what it already had',
    rereadsWhy: (n) => `${plural(n, 'read repeats', 'reads repeat')} a chunk already read in the same session. That content enters the context twice.`,
    rereadsSuggestion: 'It usually happens in long sessions or after editing. Shorter sessions, one per task, or /compact reduce it. Do not exclude these files: the agent needs them.',
    rereads: (n) => plural(n, 're-read', 're-reads'),
    reads: (n) => plural(n, 'read', 'reads'),
    ruleFolder: (rel, kind) => `Don't read \`${rel}/\`: it is ${kind}; work with the source code.`,
    kindPattern: (project, kind) => `${project} › everything of type "${kind}"`,
    kindPatternDetail: 'pattern for any folder in the project',
    ruleKind: (kind, patterns) => `Don't read ${kind} (${patterns}) unless the task requires it.`,
    nonSourceTitle: 'Generated, build or dependency files are being read',
    nonSourceWhy: 'Build output, generated code, dependencies, lockfiles and logs are rarely needed to understand or change the code, and they tend to be large.',
    nonSourceSuggestion: 'Check whether any of these reads was necessary. If not, you can block them with an Antigravity permission.',
    crossTitle: 'The same files enter many sessions',
    crossWhy: (n, min) => `${plural(n, 'file was', 'files were')} read in ${min} or more different conversations.`,
    crossSuggestion: 'If they are the core of the project, that is normal. If they are large and the agent only needs part of them, telling it which part to look at saves reads.',
    sessions: (n) => plural(n, 'session', 'sessions'),
    heavyTitle: 'Commands with very long output',
    heavyWhy: 'The full output of each command enters the context and is resent on the following turns.',
    heavySuggestion: "Ask it to run only what is needed (one test, one project) or to filter the output. If it always happens, a rule in the project's AGENTS.md reminds it every session.",
    heavyDetail: (calls, avg) => `${plural(calls, 'time', 'times')} · ~${avg} tokens each`,
    heavyExample: (cmd) => `- When running \`${cmd}\`, limit the output: only the affected test or project, or filter the relevant lines.`,
    longTitle: 'Very long sessions',
    longWhy: (n, min) => `${plural(n, 'conversation exceeds', 'conversations exceed')} ${min} tokens. In a long session, everything accumulated is resent on every turn.`,
    longSuggestion: 'A new conversation per task, or /compact when you change topic.',
    conversation: (id, at, title) => `${title ? `"${title}" (${id})` : `conversation ${id}`}${at ? ` · ${at}` : ''}`,
    steps: (n) => plural(n, 'step', 'steps'),
    longUsage: (calls, cached) => ` · ${plural(calls, 'model call', 'model calls')} · real tokens, ${cached} with cache`,
  },

  map: {
    title: '## Project map',
    intro: '(Generated by agy-insights. To find something, start from the matching folder and search with grep.)',
    files: (n) => (n === 1 ? 'file' : 'files'),
    large: 'Large files: search with grep and read only the range you need, not the whole file.',
    lines: (n) => `~${n} lines`,
    dontRead: (list) => `Don't read (generated or dependencies): ${list}`,
  },

  report: {
    applied: 'already applied',
    in: 'In',
    copy: 'Copy',
    copied: 'Copied',
    howToExclude: 'How to exclude it',
    exampleRule: 'Example rule for AGENTS.md',
    exampleHint: "Add it to the project's AGENTS.md only if this happens often: rules are sent with every request.",
    cols: ['What', '~tokens', '%', 'Times', 'Sessions'],
    modelsTitle: 'Models and effort',
    modelsHint: 'Model and effort level (reasoning) of each model call, as agy records them. Higher effort usually means more tokens per call.',
    modelCols: ['Model', 'Effort', 'Calls', 'Tokens', '%', 'Per call', 'With cache', 'Sessions'],
    unknownModel: 'unknown',
    modelsText: 'Models and effort:',
    modelLine: (model, effort, calls, tokens, pct, perCall) => `${model} · ${effort}  ${plural(calls, 'call', 'calls')}, ${tokens} tokens (${pct}), ~${perCall} per call`,
    sessionModel: 'Model',
    otherModels: (n) => ` +${n} more`,
    modelsUnknown: (n) => `"unknown": ${n} calls for which agy recorded no model, neither in gen_metadata nor as a model change in the transcript. If there are many, run npx agy-insights@latest --debug-models and paste the result into an issue on GitHub (it only contains counts).`,
    efforts: { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', 'extra high': 'Extra high', max: 'Max' },
    sessionsTitle: 'Sessions (real usage)',
    sessionCols: ['Conversation', 'When', 'Origin', 'Model', 'Tokens', '%', 'With cache', 'Calls', 'Errors'],
    origin: { cli: 'CLI', editor: 'IDE and extensions', other: 'Other folder' },
    originsTitle: 'By origin',
    originsHint: 'Where each conversation was held. The Antigravity IDE, the Antigravity app and the editor extensions (such as the VS Code one) keep the same history, so they are counted together.',
    originCols: ['Origin', 'Conversations', 'Calls', 'Tokens', '%', 'Per call', 'With cache'],
    originsText: '  By origin:',
    noConversations: (scope, dir) => `No conversations${scope ? ` for <code>${scope}</code>` : ''} in <code>${dir}</code>.`,
    tileReal: 'real tokens (input + output)',
    tileCache: (calls) => `including cache · ${plural(calls, 'call', 'calls')}`,
    tileContext: '~tokens in context',
    tileTop5: 'in the 5 largest sessions',
    tileReads: 'file reads',
    tileRereads: 're-reads of the same chunk',
    happening: "What's happening",
    happeningHint: 'This page changes nothing. Each proposal tells you which file it goes in and what to paste; you decide.',
    nothing: 'No repeated or unnecessary context detected.',
    details: 'Details',
    byProject: 'By project', outsideGit: 'outside a git repository',
    byKind: 'By file type', byFolder: 'By folder', files: 'Files', tools: 'Tools', commands: 'Commands',
    title: 'Context usage in Antigravity',
    project: 'Project', wholeHistory: 'Whole history',
    convs: (n) => plural(n, 'conversation', 'conversations'),
    generated: (date) => `generated ${date}`,
    filterLabel: 'Period',
    rangeAll: 'All history',
    rangeDays: (n) => `Last ${n} days`,
    rangeWeek: 'This week',
    chartTitleDay: 'Token usage per day',
    chartTitleWeek: 'Token usage per week',
    chartHint: 'Real tokens (input + output) of the model calls. Hover a column for details.',
    chartTable: 'View as table',
    chartModeLabel: 'Show',
    chartModeTotal: 'Total',
    chartModeCall: 'Per call',
    chartHintCall: 'Mean tokens (input + output) per model call. Unlike the total, it doesn\'t depend on how much you used the agent: it drops when each call carries less context (shorter sessions, filtered command output), so it shows whether a change worked.',
    perCallTip: (n) => `${n} tokens per call`,
    noActivity: 'No activity',
    chartCols: ['Day', 'Tokens', 'With cache', 'Calls', 'Per call'],
    chartColsWeek: ['Week of', 'Tokens', 'With cache', 'Calls', 'Per call'],
    chartCalls: (n) => plural(n, 'call', 'calls'),
    weekOf: (d) => `week of ${d}`,
    withCacheShort: 'with cache',
    period: (from, to) => (from === to ? `on ${from}` : `from ${from} to ${to}`),
    since: (date) => `active since ${date}`,
    olderSkipped: (n) => `${plural(n, 'older conversation', 'older conversations')} left out by the date filter`,
    periodLine: (period, since) => `Period: ${period}${since ? ` (filter: ${since})` : ''}`,
    footerReal: (missing) => `Real tokens: the ones Antigravity records in each conversation's log (subagents included)${missing ? `; ${plural(missing, 'conversation has', 'conversations have')} no token counts in its log and ${missing === 1 ? 'is' : 'are'} not counted` : ''}.`,
    footerCache: 'It is unknown whether the quota counts cache the same as new input, so both figures are shown.',
    footerEstimate: '~tokens = stored size of each step / 4: useful to compare files and folders with each other.',
    footerPrivacy: 'The history was read from a copy and was not modified. This page contains paths from your projects: review it before sharing.',
    // Text summary
    history: 'History', projectLower: 'project',
    summary: (convs, steps, tokens) => `${plural(convs, 'conversation', 'conversations')}, ${plural(steps, 'step', 'steps')}, ~${tokens} tokens in context (estimated)`,
    realUsage: (real, input, output, cached, calls) => `Real usage: ${real} tokens (input ${input} + output ${output}), ${cached} including cache, in ${plural(calls, 'model call', 'model calls')}`,
    noLog: (n) => ` (${plural(n, 'conversation', 'conversations')} without a log)`,
    topSessions: (n) => (n === 1 ? '  The session that uses the most:' : `  The ${n} sessions that use the most:`),
    sessionLine: (id, calls, errors, cached, model, at, title) => `${title ? `"${title}" (${id})` : `conversation ${id}`}${at ? ` · ${at}` : ''}${model ? ` (${model})` : ''}  ${plural(calls, 'call', 'calls')}${errors ? `, ${plural(errors, 'error', 'errors')}` : ''}, ${cached} with cache`,
    top5: (pct, reads, rereads, rpct) => `The 5 largest sessions account for ${pct}. Reads: ${reads}, re-reads ${rereads} (${rpct})`,
    pathHidden: '(path hidden, use --paths)',
    byKindText: 'By file type:',
    textFooter: 'Nothing was modified. Real usage = agy log; ~tokens = step size / 4 (estimated).',
  },
};

const es = {
  locale: 'es-ES',
  help: (dir) => `Uso: agy-insights [opciones]   (o npx agy-insights, o node agy-insights.js)

Analiza tu historial de Antigravity CLI y abre un informe en el navegador.

Opciones:
  --project <carpeta>   Solo conversaciones que tocaron ese proyecto ("." = carpeta actual)
  --text                Resumen en la terminal en vez del informe HTML
  --paths               Con --text, muestra rutas y las exclusiones propuestas
  --map                 Imprime un mapa del proyecto (--project, o la carpeta actual) para AGENTS.md
  --out <fichero>       Dónde guardar el informe HTML (por defecto, en la carpeta temporal)
  --no-open             No abrir el navegador
  --since <AAAA-MM-DD>  Solo conversaciones con actividad desde esa fecha
  --days <n>            Solo conversaciones con actividad en los últimos n días
  --lang <en|es>        Idioma de la salida (por defecto, el del sistema)
  --debug-models        Por conversación, de dónde sale el modelo de cada llamada (solo recuentos, para reportar fallos)
  --dir <carpeta>       Otra carpeta de historial (por defecto, la del CLI y la del editor: ${dir})
  --config <fichero>    Configuración (por defecto ~/.agy-insights.json si existe)
  --help                Esta ayuda
`,
  missingValue: (opt) => `Falta el valor de ${opt}`,
  unknownOption: (opt) => `Opción desconocida: ${opt}. Usa --help.`,
  badLang: (v) => `Idioma no soportado: ${v}. Usa en o es.`,
  badDate: (v) => `Fecha no válida: ${v}. Usa AAAA-MM-DD.`,
  badDays: (v) => `Número de días no válido: ${v}.`,
  configNotFound: (f) => `No existe el fichero de configuración ${f}`,
  cannotRead: (f, msg) => `No se puede leer ${f}: ${msg}`,
  mapDone: (tokens, file) => `\n~${tokens} tokens en cada petición. Pégalo en ${file} si te convence; agy-insights no lo escribe.`,
  reportName: 'informe',
  debugModels: {
    header: ['conversación', 'llamadas', 'filas gen_metadata', 'filas con modelo', 'llamadas con modelo en transcript', 'desconocidas', 'modelo principal', 'ids de modelo no reconocidos', 'llamadas sin tokens', 'campos de esas llamadas'],
    total: 'total',
    note: 'Solo recuentos y nombres o ids de modelo: ni rutas, ni prompts, ni código. Pégalo en una incidencia si salen modelos desconocidos.',
  },
  done: (convs, found, out) => `${plural(convs, 'conversación analizada', 'conversaciones analizadas')}, ${plural(found, 'hallazgo', 'hallazgos')}.\nInforme: ${out}`,

  kinds: {
    agent: 'ficheros propios de Antigravity (brain, skills)',
    build: 'build output (dist, bin, obj…)', logs: 'logs, maps, minificados', generated: 'código generado / migraciones', images: 'imágenes',
    other: 'otros', code: (ext) => `código ${ext}`,
  },

  fixes: {
    denyTitle: 'Denegar la lectura en el CLI (permiso de Antigravity)',
    denyWhere: 'dentro de "permissions" → "deny"',
    denyNote: 'Es lo único que impide la lectura. Afecta a todos tus proyectos, también impide escribir en esa ruta, y hay que reiniciar agy.',
    denyEditorTitle: 'Denegar la lectura en el IDE y extensiones (permiso de Antigravity)',
    denyEditorPlace: 'Settings → Permission Grants',
    denyEditorWhere: 'del IDE, la app o la extensión de Antigravity, como regla de denegación',
    denyEditorNote: 'No tienen un fichero de ajustes que editar: la regla se añade desde sus Settings. Impide la lectura en todos tus proyectos (o solo en uno, como permiso del proyecto) y también impide escribir en esa ruta.',
    ignoreTitle: 'Añadir a .antigravityignore',
    ignoreWhere: 'al final del fichero (créalo si no existe)',
    ignoreNote: 'Lo oculta del autocompletado con @; no está documentado que impida leerlo.',
    ruleTitle: 'Añadir una regla a AGENTS.md',
    ruleWhere: 'al final del fichero',
    ruleNote: 'Es una indicación al modelo, no un bloqueo. Se envía en cada petición: mantenla corta. AGENTS.md suele estar en el repo del equipo.',
  },

  findings: {
    formatTitle: 'No se reconoce el formato del historial',
    formatWhy: (steps) => `Hay ${steps} pasos pero ninguna llamada a herramienta reconocible. Probablemente agy ha cambiado cómo guarda las conversaciones.`,
    formatSuggestion: 'Los resultados de abajo no son fiables. Actualiza agy-insights (npx agy-insights@latest) o abre una incidencia en GitHub.',
    rereadsTitle: 'El agente vuelve a leer lo que ya tenía',
    rereadsWhy: (n) => `${plural(n, 'lectura repite', 'lecturas repiten')} un trozo que ya se había leído en la misma sesión. Ese contenido entra dos veces en el contexto.`,
    rereadsSuggestion: 'Suele pasar en sesiones largas o después de editar. Sesiones más cortas por tarea, o /compact, lo reducen. No conviene excluir estos ficheros: el agente los necesita.',
    rereads: (n) => plural(n, 'relectura', 'relecturas'),
    reads: (n) => plural(n, 'lectura', 'lecturas'),
    ruleFolder: (rel, kind) => `No leas \`${rel}/\`: es ${kind}; trabaja con el código fuente.`,
    kindPattern: (project, kind) => `${project} › todo lo de tipo «${kind}»`,
    kindPatternDetail: 'patrón para cualquier carpeta del proyecto',
    ruleKind: (kind, patterns) => `No leas ${kind} (${patterns}) salvo que la tarea lo pida.`,
    nonSourceTitle: 'Se leen ficheros generados, compilados o de dependencias',
    nonSourceWhy: 'Salidas de build, código generado, dependencias, lockfiles y logs casi nunca hacen falta para entender o cambiar el código, y suelen ser grandes.',
    nonSourceSuggestion: 'Revisa si alguna de estas lecturas era necesaria. Si no, puedes impedirlas con un permiso de Antigravity.',
    crossTitle: 'Los mismos ficheros entran en muchas sesiones',
    crossWhy: (n, min) => `${plural(n, 'fichero se ha leído', 'ficheros se han leído')} en ${min} o más conversaciones distintas.`,
    crossSuggestion: 'Si son el núcleo del proyecto es normal. Si son grandes y el agente solo necesita una parte, decirle qué trozo mirar ahorra lecturas.',
    sessions: (n) => plural(n, 'sesión', 'sesiones'),
    heavyTitle: 'Comandos con salidas muy largas',
    heavyWhy: 'La salida completa de cada comando entra en el contexto y se reenvía en los turnos siguientes.',
    heavySuggestion: 'Pide ejecutar solo lo necesario (un test concreto, un proyecto concreto) o filtrar la salida. Si pasa siempre, una regla en el AGENTS.md del proyecto lo recuerda en cada sesión.',
    heavyDetail: (calls, avg) => `${plural(calls, 'vez', 'veces')} · ~${avg} tokens cada una`,
    heavyExample: (cmd) => `- Al ejecutar \`${cmd}\`, limita la salida: solo el test o proyecto afectado, o filtra las líneas relevantes.`,
    longTitle: 'Sesiones muy largas',
    longWhy: (n, min) => `${plural(n, 'conversación supera', 'conversaciones superan')} ${min} tokens. En una sesión larga, todo lo acumulado se vuelve a enviar en cada turno.`,
    longSuggestion: 'Una conversación nueva por tarea, o /compact cuando cambias de tema.',
    conversation: (id, at, title) => `${title ? `«${title}» (${id})` : `conversación ${id}`}${at ? ` · ${at}` : ''}`,
    steps: (n) => plural(n, 'paso', 'pasos'),
    longUsage: (calls, cached) => ` · ${plural(calls, 'llamada', 'llamadas')} al modelo · tokens reales, ${cached} con caché`,
  },

  map: {
    title: '## Mapa del proyecto',
    intro: '(Generado por agy-insights. Para encontrar algo, empieza por la carpeta que corresponda y busca con grep.)',
    files: (n) => (n === 1 ? 'fichero' : 'ficheros'),
    large: 'Ficheros grandes: busca con grep y lee solo el rango que necesites, no el fichero entero.',
    lines: (n) => `~${n} líneas`,
    dontRead: (list) => `No leas (generado o dependencias): ${list}`,
  },

  report: {
    applied: 'ya aplicado',
    in: 'En',
    copy: 'Copiar',
    copied: 'Copiado',
    howToExclude: 'Cómo excluirlo',
    exampleRule: 'Regla de ejemplo para AGENTS.md',
    exampleHint: 'Ponla en el AGENTS.md del proyecto solo si te pasa a menudo: las reglas se envían en cada petición.',
    cols: ['Qué', '~tokens', '%', 'Veces', 'Sesiones'],
    modelsTitle: 'Modelos y esfuerzo',
    modelsHint: 'Modelo y nivel de esfuerzo (razonamiento) de cada llamada al modelo, tal como los anota agy. Más esfuerzo suele suponer más tokens por llamada.',
    modelCols: ['Modelo', 'Esfuerzo', 'Llamadas', 'Tokens', '%', 'Por llamada', 'Con caché', 'Sesiones'],
    unknownModel: 'desconocido',
    modelsText: 'Modelos y esfuerzo:',
    modelLine: (model, effort, calls, tokens, pct, perCall) => `${model} · ${effort}  ${plural(calls, 'llamada', 'llamadas')}, ${tokens} tokens (${pct}), ~${perCall} por llamada`,
    sessionModel: 'Modelo',
    otherModels: (n) => ` +${n} más`,
    modelsUnknown: (n) => `«desconocido»: ${n} llamadas de las que agy no anotó el modelo, ni en gen_metadata ni como cambio de modelo en el transcript. Si son muchas, ejecuta npx agy-insights@latest --debug-models y pega el resultado en una incidencia de GitHub (solo contiene recuentos).`,
    efforts: { minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', 'extra high': 'Muy alto', max: 'Máximo' },
    sessionsTitle: 'Sesiones (consumo real)',
    sessionCols: ['Conversación', 'Cuándo', 'Origen', 'Modelo', 'Tokens', '%', 'Con caché', 'Llamadas', 'Errores'],
    origin: { cli: 'CLI', editor: 'IDE y extensiones', other: 'Otra carpeta' },
    originsTitle: 'Por origen',
    originsHint: 'Desde dónde se tuvo cada conversación. El IDE de Antigravity, la app de Antigravity y las extensiones de editor (como la de VS Code) guardan el mismo historial, así que se cuentan juntos.',
    originCols: ['Origen', 'Conversaciones', 'Llamadas', 'Tokens', '%', 'Por llamada', 'Con caché'],
    originsText: '  Por origen:',
    noConversations: (scope, dir) => `No hay conversaciones${scope ? ` de <code>${scope}</code>` : ''} en <code>${dir}</code>.`,
    tileReal: 'tokens reales (entrada + salida)',
    tileCache: (calls) => `contando la caché · ${plural(calls, 'llamada', 'llamadas')}`,
    tileContext: '~tokens en contexto',
    tileTop5: 'en las 5 sesiones más grandes',
    tileReads: 'lecturas de ficheros',
    tileRereads: 'relecturas del mismo trozo',
    happening: 'Qué está pasando',
    happeningHint: 'Esta página no cambia nada. Cada propuesta te dice en qué fichero va y qué pegar; decides tú.',
    nothing: 'No se ha detectado contexto repetido ni innecesario.',
    details: 'Detalle',
    byProject: 'Por proyecto', outsideGit: 'fuera de un repositorio git',
    byKind: 'Por tipo de fichero', byFolder: 'Por carpeta', files: 'Ficheros', tools: 'Herramientas', commands: 'Comandos',
    title: 'Uso de contexto en Antigravity',
    project: 'Proyecto', wholeHistory: 'Todo el historial',
    convs: (n) => plural(n, 'conversación', 'conversaciones'),
    generated: (date) => `generado ${date}`,
    filterLabel: 'Periodo',
    rangeAll: 'Todo el historial',
    rangeDays: (n) => `Últimos ${n} días`,
    rangeWeek: 'Esta semana',
    chartTitleDay: 'Consumo de tokens por día',
    chartTitleWeek: 'Consumo de tokens por semana',
    chartHint: 'Tokens reales (entrada + salida) de las llamadas al modelo. Pasa el ratón por una columna para ver el detalle.',
    chartTable: 'Ver como tabla',
    chartModeLabel: 'Mostrar',
    chartModeTotal: 'Total',
    chartModeCall: 'Por llamada',
    chartHintCall: 'Tokens medios (entrada + salida) por llamada al modelo. A diferencia del total, no depende de cuánto hayas usado el agente: baja cuando cada llamada lleva menos contexto (sesiones más cortas, salidas de comandos filtradas), así que muestra si un cambio ha funcionado.',
    perCallTip: (n) => `${n} tokens por llamada`,
    noActivity: 'Sin actividad',
    chartCols: ['Día', 'Tokens', 'Con caché', 'Llamadas', 'Por llamada'],
    chartColsWeek: ['Semana del', 'Tokens', 'Con caché', 'Llamadas', 'Por llamada'],
    chartCalls: (n) => plural(n, 'llamada', 'llamadas'),
    weekOf: (d) => `semana del ${d}`,
    withCacheShort: 'con caché',
    period: (from, to) => (from === to ? `el ${from}` : `del ${from} al ${to}`),
    since: (date) => `con actividad desde el ${date}`,
    olderSkipped: (n) => `${plural(n, 'conversación anterior queda fuera', 'conversaciones anteriores quedan fuera')} por el filtro de fechas`,
    periodLine: (period, since) => `Periodo: ${period}${since ? ` (filtro: ${since})` : ''}`,
    footerReal: (missing) => `Tokens reales: los que Antigravity anota en el registro de cada conversación (incluidos subagentes)${missing ? `; ${missing === 1 ? '1 conversación no tiene tokens en su registro y no cuenta' : `${missing} conversaciones no tienen tokens en su registro y no cuentan`}` : ''}.`,
    footerCache: 'No se sabe si la cuota cuenta la caché igual que la entrada nueva: por eso se muestran las dos cifras.',
    footerEstimate: '~tokens = tamaño guardado de cada paso / 4: sirve para comparar ficheros y carpetas entre sí.',
    footerPrivacy: 'El historial se ha leído desde una copia y no se ha modificado. Esta página contiene rutas de tus proyectos: no la compartas sin revisarla.',
    history: 'Historial', projectLower: 'proyecto',
    summary: (convs, steps, tokens) => `${plural(convs, 'conversación', 'conversaciones')}, ${plural(steps, 'paso', 'pasos')}, ~${tokens} tokens en contexto (estimado)`,
    realUsage: (real, input, output, cached, calls) => `Consumo real: ${real} tokens (entrada ${input} + salida ${output}), ${cached} contando la caché, en ${plural(calls, 'llamada', 'llamadas')} al modelo`,
    noLog: (n) => ` (${plural(n, 'conversación', 'conversaciones')} sin registro)`,
    topSessions: (n) => (n === 1 ? '  La sesión que más gasta:' : `  Las ${n} sesiones que más gastan:`),
    sessionLine: (id, calls, errors, cached, model, at, title) => `${title ? `«${title}» (${id})` : `conversación ${id}`}${at ? ` · ${at}` : ''}${model ? ` (${model})` : ''}  ${plural(calls, 'llamada', 'llamadas')}${errors ? `, ${plural(errors, 'error', 'errores')}` : ''}, ${cached} con caché`,
    top5: (pct, reads, rereads, rpct) => `Las 5 sesiones más grandes suman el ${pct}. Lecturas: ${reads}, relecturas ${rereads} (${rpct})`,
    pathHidden: '(ruta oculta, usa --paths)',
    byKindText: 'Por tipo de fichero:',
    textFooter: 'No se ha modificado nada. Consumo real = registro de agy; ~tokens = tamaño del paso / 4 (estimado).',
  },
};

const LANGS = { en, es };
let current = 'en';

// "es", "es-ES", "es_ES.UTF-8"… → es; anything else → en.
function detect(env = process.env) {
  const sys = env.LC_ALL || env.LC_MESSAGES || env.LANG || env.LANGUAGE || Intl.DateTimeFormat().resolvedOptions().locale || '';
  return /^es\b|^es[-_]/i.test(sys) ? 'es' : 'en';
}

function setLang(lang) {
  if (!LANGS[lang]) return false;
  current = lang;
  return true;
}

const t = new Proxy({}, { get: (_, k) => LANGS[current][k] });
const lang = () => current;
const num = (n) => Math.round(n).toLocaleString(t.locale);
const date = (ms) => new Date(ms).toLocaleDateString(t.locale, { day: 'numeric', month: 'short', year: 'numeric' });
const time = (ms) => new Date(ms).toLocaleTimeString(t.locale, { hour: '2-digit', minute: '2-digit' });

// When a session happened: "29 Oct 2026, 11:16–11:40", or "27 Oct 2026, 09:02 – 29 Oct 2026, 11:40" when it
// spans several days; '' when unknown.
function when(start, end) {
  if (!start || !end) return '';
  if (date(start) !== date(end)) return `${date(start)}, ${time(start)} – ${date(end)}, ${time(end)}`;
  return time(start) === time(end) ? `${date(start)}, ${time(start)}` : `${date(start)}, ${time(start)}–${time(end)}`;
}

// Built-in kinds are stable ids (see history.js kind()); custom kinds from the config are shown as written.
function kindLabel(k) {
  if (k.startsWith('code ')) return t.kinds.code(k.slice(5));
  return t.kinds[k] || k;
}

// "High" / "high" → "High" or "Alto"; levels agy may add later are shown as written.
const effortLabel = (e) => (e ? t.report.efforts[e.toLowerCase()] || e : t.report.unknownModel);

module.exports = { t, setLang, lang, detect, num, date, when, kindLabel, effortLabel, LANGS };
