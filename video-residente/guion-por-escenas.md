# Guion por escenas · Flujo en Obra · De la programación al cierre del despacho

Video 1920×1080 · 30 fps · máx. 2:00 · Voz: Gael - Warm & Conversational (ElevenLabs). pista `assets/locucion-gael.mp3` (1:58.9, texto de `locucion-gael.txt`). Cortes: Inicio 0–11.1 · Programación 11.1–31.1 · Kanban 31.1–46.4 · Despacho 46.4–58.1 · Guías 58.1–86.8 · Control 86.8–96.2 · Incidencias 96.2–1:49 · Cierre 1:49–2:00; cada clic y resaltado sigue `assets/transcript.json`.

| Tiempo | Escena | En pantalla |
|---|---|---|
| 0:00–0:11.8 | Inicio | Tarjeta PRO con los cuatro pasos apareciendo cuando la voz los nombra; luego la sesión de Residente: proyecto activo y clic en Programación (captura real). |
| 0:11.8–0:33.4 | Programación · Carga masiva | Diálogo Cargar programaciones reconstruido con las clases reales (bulk-programming-dialog.tsx): selección del Excel, Vista previa obligatoria: se revisan todos los campos (fecha, hora, proveedor, pedido, volumen); aviso «El Excel admite otra lectura…», corrección de fecha y se elimina la fila 13 (3 → 2 filas) antes de cargar y Cargar programaciones. |
| 0:33.4–0:48.9 | Kanban | Kanban real. Vista previa de la tarjeta (programming-preview-drawer.tsx) → Editar programación (hora 07:00 → 09:00 y motivo) → Guardar cambios; segunda tarjeta → Cancelar programación con motivo; arrastre a En ejecución. |
| 0:48.9–0:59.8 | Inicio del despacho | Despachos real (fila en «Sin iniciar» con Inicio de Registro), filtro por código, diálogo Iniciar despacho (register-dispatch-dialog.tsx) con Hora de llegada y Receptor, botón Iniciar Registro y Detalle de despacho real en ejecución (PRG-8656D09C). |
| 0:59.8–1:24.8 | Guías · escaneo masivo | Dentro del Detalle de despacho (captura real): Agregar guía → Subir PDF → selector de páginas → Escaneo masivo (Leer PDF, Confirmar tipos, Revisar y guardar, guide-bulk-scan.tsx); se aceptan las 4 páginas. Foto real de guía con datos personales pixelados; corrección de cantidad 6 → 6.5 (estimado Q 7,957.04), llenado manual de Observaciones y Elemento a fundir, confirmación y Guardar y escanear otra; «Escaneo terminado. 4 guía(s) y sus evidencias guardadas.» |
| 1:24.8–1:36.0 | Pedido / Control Operación | Capturas reales: Total según guías; Resultado, Número pedido, Volumen Real y Total según guías. |
| 1:36.0–1:48.8 | Incidencias | Panel real + diálogo Registrar incidencia (register-incident-dialog.tsx): Tipo, Responsabilidad, Aplica cobro, Notas; resultado «No despachado» exige al menos una incidencia. |
| 1:48.8–2:00 | Cierre | Hora salida y Evidencias reales; barra de acciones y diálogo ¿Finalizar despacho? reconstruidos; Detalle real en «Despacho completo»; tarjeta final. |

Locución: ver `locucion-gael.txt` (texto que dice la pista).

## Notas
- Los diálogos se reconstruyen con el marcado, las clases de Tailwind y los textos del código de `src/`, y se pintan con el CSS compilado real de PRO (`assets/app/pro-app.css`, tomado del servidor de desarrollo). No se modificó ningún dato.
- Nombre y correo de la cuenta cubiertos con «Residente» en todas las capturas, incluidas las oscurecidas; el receptor real del detalle también se reemplaza.
- Datos de los diálogos: de demostración (se indica arriba a la derecha).
