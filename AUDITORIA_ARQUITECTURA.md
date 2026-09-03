# Auditoría de arquitectura y lógica de negocio — PRO Procesos

Fecha del análisis: 2 de septiembre de 2026
Alcance: código y artefactos propios presentes en el workspace. Se excluyen dependencias (`node_modules`), compilados (`.next`, `out`, `build`), archivos temporales y el contenido secreto de `.env`.

Método: revisión estática del árbol, responsabilidades exportadas, dependencias, tamaños, documentación y SQL disponible. No se conectó esta auditoría a la base remota ni se ejecutaron migraciones; por eso distingue siempre entre el estado **declarado en archivos** y el estado real que todavía debe verificarse en Supabase.

## 1. Resumen ejecutivo

El proyecto **no es spaghetti en su estructura general**. La organización principal es reconocible y razonable: Next.js App Router para rutas, `features` para dominios, componentes compartidos, adaptadores de Supabase y una base de datos que protege reglas críticas mediante RLS, RPC transaccionales, triggers, auditoría y revisiones inmutables.

El riesgo de spaghetti sí existe en la implementación interna y se concentra en cuatro puntos:

1. **Archivos “Dios”** que mezclan interfaz, estado, validación, subida de archivos y coordinación del negocio. Los casos más claros son `order-detail-view.tsx` (1,960 líneas), `batches/actions.ts` (1,252), `batches/queries.ts` (908) e `invoice-workspace.tsx` (800).
2. **Contrato frontend–base de datos difícil de desplegar**. El frontend llama RPC creadas en migraciones que, según sus propios encabezados, aún no fueron ejecutadas.
3. **Historial incompleto del esquema**. Este repositorio empieza en la migración `044`; faltan `001–043`, aunque las migraciones actuales dependen de tablas, enums y helpers anteriores. El proyecto no puede reconstruir una base nueva sólo con lo versionado aquí.
4. **Ausencia de una suite automatizada**. Hay QA SQL útil, pero no existe script de pruebas unitarias, integración o end-to-end para los parsers, estados, permisos, Server Actions y flujos críticos.

La recomendación no es reescribir. Conviene estabilizar primero el esquema y sus despliegues, añadir pruebas de caracterización, y luego dividir gradualmente los archivos grandes por caso de uso.

## 2. Vista general de la arquitectura

```text
Navegador
  └─ Next.js App Router (`src/app`)
      ├─ Server Components: cargan contexto y datos
      ├─ Client Components: interacción, modales, calendarios y formularios
      └─ Server Actions / Route Handlers: comandos y descargas/exportaciones
          └─ Supabase (`src/lib/supabase`)
              ├─ Auth y sesión SSR
              ├─ Postgres + RLS
              ├─ RPC SECURITY DEFINER para mutaciones de dominio
              └─ Storage privado con URLs firmadas
                  └─ Migraciones SQL, auditoría, revisiones y triggers
```

### Capas reales

| Capa | Ubicación | Responsabilidad actual |
|---|---|---|
| Enrutamiento | `src/app` | Define URL, layouts, loading/error boundaries y compone pantallas. |
| Dominio/aplicación | `src/features/<dominio>` | Consultas, comandos, tipos, formato y UI de cada módulo. |
| UI transversal | `src/components` | Shell, feedback, animación, tema y documentos reutilizables. |
| Infraestructura | `src/lib` | Entorno, clientes Supabase, sesión proxy y utilidades globales. |
| Persistencia y reglas fuertes | `supabase/migrations` | Modelo, RLS, permisos, RPC, triggers, auditoría e invariantes. |
| Diseño/negocio | `docs` | Especificación, arquitectura, UML, proceso y referencias visuales. |
| Verificación manual | `supabase/qa` | Escenarios SQL reversibles o limpieza puntual. |

Las carpetas vacías `src/services`, `src/hooks`, `src/types`, `src/components/ui` y `src/components/shared` muestran una arquitectura prevista que todavía no se utiliza de forma consistente. Hoy, cada feature accede directamente a Supabase desde `actions.ts` y `queries.ts`.

## 3. Tecnologías y decisiones principales

- **Next.js 16.3.3 y React 19** con App Router, Server Components, Server Actions y route handlers.
- **TypeScript estricto** como control estático.
- **Tailwind CSS 4** para estilos globales y utilitarios.
- **Supabase SSR/Auth/Postgres/Storage** como backend.
- **RLS + permisos por proyecto** como autoridad de lectura; las mutaciones importantes pasan por RPC.
- **ExcelJS** para reportes `.xlsx`.
- **unpdf** para extraer texto embebido de facturas PDF.
- **Schedule-X** para calendario y **Motion** para transiciones.

Importante: `unpdf` **no es OCR**. Sólo recupera la capa de texto del PDF. Una factura escaneada como imagen, con fuentes mal codificadas o sin texto seleccionable no podrá procesarse de forma confiable con el pipeline actual.

## 4. Flujos de negocio encontrados

### 4.1 Sesión, acceso y selección de proyecto

1. `src/proxy.ts` delega la actualización/validación de sesión en `src/lib/supabase/proxy.ts`.
2. Auth permite inicio de sesión, recuperación y cambio de contraseña.
3. `requireActiveProfile()` exige un perfil funcional activo.
4. `getProjectContext()` arma los proyectos disponibles desde membresías de proyecto y compañías administradas.
5. El proyecto activo se conserva en la cookie `pro_active_project`.
6. La UI oculta acciones con permisos, pero la autoridad real sigue en RLS/RPC.
7. `PLATFORM_ADMIN` usa `/platform` como contexto separado y no se convierte automáticamente en rol operativo.

### 4.2 Administración global

1. Platform Admin crea y activa/desactiva compañías.
2. Puede crear o editar proyectos dentro de una compañía activa.
3. Asigna proveedores de la compañía a cada proyecto; la relación histórica se desactiva en vez de borrarse.
4. Puede invitar usuarios o crearlos con contraseña, editar perfil/estado, administrar contraseña, membresías y roles.
5. Los cambios administrativos quedan en `audit_events` cuando el RPC correspondiente lo implementa.

Riesgo: crear un usuario en Supabase Auth y después crear su perfil/auditoría cruza dos sistemas. Si el segundo paso falla, puede quedar un usuario Auth parcial. Hace falta compensación explícita o un proceso de recuperación idempotente.

### 4.3 Programación

1. Un usuario con permiso crea una programación para un proveedor habilitado en el proyecto.
2. La programación contiene una o varias líneas homogéneas de cantidad y unidad.
3. Recorre estados persistidos como `DRAFT`, `PENDING_CONFIRMATION`, `CONFIRMED`, `IN_EXECUTION`, `COMPLETED` o `CANCELLED`.
4. `EXPIRED` es un estado efectivo derivado cuando la fecha pasó sin iniciar la operación.
5. Las mutaciones de detalle usan versión esperada y guardan snapshots para auditoría.
6. Al crear el primer despacho, la programación puede pasar a `IN_EXECUTION`.
7. Con la migración 071, pasa automáticamente a `COMPLETED` sólo cuando todos sus despachos tienen un pedido activo conciliado (`MATCHED`). Si una guía pendiente se traslada a otro lote, continúa bloqueando el cierre.

### 4.4 Despacho y guía

1. Se selecciona una programación confirmada y disponible.
2. Recepción registra el despacho y su guía: proveedor, número de pedido, productos, cantidades enviadas/recibidas/devueltas, fechas y resultado físico.
3. Se pueden registrar incidencias y documentos privados.
4. Las correcciones usan bloqueo optimista por `version`, crean baseline/revisión y audit event.
5. Una guía facturada o una relación histórica de lote queda bloqueada.
6. La unidad de la guía debe coincidir con la programación.
7. El número de pedido es obligatorio para nuevas guías y es la clave de agrupación posterior.

### 4.5 Lote semanal y pedido

1. Los lotes se delimitan por semana local del proyecto.
2. Las guías activas se agregan al lote manualmente o por reglas del flujo.
3. Las guías se agrupan por número de pedido normalizado, creando `reconciliation_orders`.
4. El pedido es el agregado documental y contable; la guía conserva el movimiento físico.
5. Al cerrar/preparar la semana siguiente, los pedidos `MATCHED` permanecen en el lote histórico y los pendientes pasan al siguiente lote mediante relaciones auditadas.

### 4.6 Factura Mixto Listo y extracción PDF

1. Desde el detalle del pedido se carga sólo un PDF PRODUCT.
2. El servidor valida tipo/tamaño y extrae texto con `unpdf`.
3. `mixto-listo-parser.ts` busca número, fecha, moneda, total, PCA, pedido y líneas mediante reglas específicas del formato Mixto Listo.
4. Se presenta un preview; el usuario puede corregir la extracción con motivo.
5. El PDF se sube a Storage privado mediante URL firmada y primero queda en una tabla de staging.
6. La confirmación valida que el pedido derivado del PCA coincida con el pedido abierto y que el período sea válido.
7. Sólo entonces crea factura, líneas y relaciones. Un intake pendiente puede descartarse como `FAILED`, conservando evidencia.

Este pipeline es determinista y auditable, pero está acoplado al formato textual de un proveedor. Un cambio de plantilla puede romper la extracción. Debe tener fixtures PDF/texto y pruebas del parser; para escaneos hace falta una etapa OCR separada.

### 4.7 Conciliación

1. Las cantidades recibidas/despachadas de las guías se agregan por pedido y unidad.
2. Las facturas PRODUCT confirmadas se agregan por el mismo pedido y unidad.
3. Desde la migración 068, código y descripción quedan como metadatos auditables y no deciden el match.
4. Igualdad de cantidades por unidad produce `MATCHED`; faltantes, excesos o unidades ausentes generan estado pendiente/diferencia/revisión.
5. SERVICE se conserva como documento privado, pero no participa en la comparación de cantidades.
6. Un match actualiza el despacho a `RECONCILED` y puede completar su programación.
7. La refacturación conserva la cadena de reemplazo y evita cerrar mientras exista una diferencia vigente.

### 4.8 Documentos, notificaciones y reportes

- Documentos: metadatos en Postgres, versiones en Storage privado y descarga mediante URL firmada después de autorizar.
- Notificaciones: se derivan del estado actual del dominio; `notification_reads` sólo persiste las marcas de lectura por usuario/proyecto.
- Reportes: consultan programaciones y sus despachos/pedidos, filtran por fechas/proyecto/proveedor/estado y exportan con ExcelJS.

## 5. Qué se está haciendo bien

1. **Seguridad en profundidad**: autenticación SSR, permisos por proyecto, RLS forzada, revocación a `anon` y RPC con `SECURITY DEFINER` controlado.
2. **Reglas críticas dentro de la base**: número de pedido requerido, unidad consistente, relaciones históricas, estados y bloqueos no dependen únicamente de la UI.
3. **Auditabilidad**: `audit_events`, revisiones inmutables, razones de corrección y preservación de documentos/intakes fallidos.
4. **Concurrencia explícita**: versiones esperadas evitan pisar correcciones simultáneas.
5. **Separación macro por dominio**: auth, programación, despachos, lotes, facturas, conciliación, reportes y plataforma son fáciles de localizar.
6. **Separación comando/consulta** dentro de la mayoría de features mediante `actions.ts` y `queries.ts`.
7. **Documentos privados** y URLs firmadas en lugar de hacer público el bucket.
8. **Migraciones defensivas** con precondiciones, comprobaciones de drift, privilegios explícitos y transacciones.
9. **Límites visuales de Next.js**: páginas, layouts, loading y error boundaries existen para los flujos principales.
10. **Tipos y formatters de dominio** reducen parte de la lógica accidental en las vistas.

## 6. Qué debe mejorar

### Crítico — antes de seguir agregando módulos

1. **Completar y automatizar la historia de base de datos.** Incorporar un baseline reproducible (`001–043` o un schema snapshot aprobado), registrar migraciones realmente aplicadas y dejar de depender de ejecución manual sin tabla de control.
2. **Alinear despliegue de código y SQL.** Una funcionalidad no debe llegar al frontend si su RPC/migración no está aplicada en el entorno objetivo.
3. **Añadir pruebas de caracterización.** Prioridad: parser Mixto Listo, conciliación por cantidad/UM, rollover, permisos, correcciones/versiones y finalización automática.
4. **Eliminar el parcheo textual de funciones SQL.** Las migraciones 067/068 modifican `pg_get_functiondef` con `replace`. Los drift guards reducen el peligro, pero sigue siendo frágil. Versionar el cuerpo completo canónico del RPC es más revisable y reproducible.

### Alto — reducción directa de spaghetti

1. Dividir `order-detail-view.tsx` en encabezado, resumen, siguiente paso, tabla de intakes, guías, facturas, conciliación y modales; mover coordinación a hooks/controladores específicos.
2. Separar `batches/actions.ts` por caso de uso: `batch-actions`, `invoice-upload-actions`, `mixto-intake-actions`, `reconciliation-actions`.
3. Separar queries grandes en repositorios/lecturas especializadas y ensambladores. Varias consultas recuperan tablas amplias y reconstruyen joins en TypeScript.
4. Extraer un módulo común de errores Supabase/RPC y validación de `FormData`; actualmente existe lógica repetida en múltiples actions.
5. Centralizar etiquetas, colores y transiciones de estado. Hoy hay formatters repetidos en dashboard, batches, dispatches, programming y `lib/status-labels.ts`.
6. Crear una capa de casos de uso o servicios. Las carpetas `services` y `hooks` están vacías, mientras UI/actions concentran coordinación compleja.

### Medio — mantenibilidad y operación

1. Actualizar `README.md` y documentos de fases: describen alcances anteriores y no reflejan completamente el sistema actual.
2. Resolver que `/docs` esté ignorado por `.gitignore`; la documentación existe localmente pero no aparece en `git ls-files`.
3. Añadir `.env.example` con nombres de variables, nunca secretos, y un chequeo de configuración por entorno.
4. Añadir CI con `npm run lint`, `npm run typecheck`, build, pruebas y validación/migración de Supabase.
5. Definir observabilidad: errores de extracción/RPC con código técnico, correlation id y mensaje accionable; evitar el genérico “No fue posible completar…”.
6. Revisar accesibilidad y responsive con pruebas e2e para los modales/tablas grandes.
7. Separar la generación Excel del route handler; el handler debe autorizar/orquestar y un servicio debe construir el workbook.

## 7. Plan de refactorización sugerido

### Fase 0 — estabilización

- Congelar cambios de esquema unos días.
- Obtener `supabase db dump` del esquema canónico, comparar con migraciones y registrar qué se aplicó por ambiente.
- Crear una matriz `entorno × migración × fecha × responsable`.
- Añadir fixtures anónimos y pruebas para los flujos actuales antes de mover código.

### Fase 1 — fronteras de aplicación

```text
features/batches/
  application/     casos de uso y DTO
  data/            consultas y adaptadores Supabase
  domain/          reglas puras y estados
  components/      presentación
```

Aplicar primero este patrón sólo a `batches`, el módulo más complejo. No crear capas vacías en todos los dominios.

### Fase 2 — frontend

- Mantener cada pantalla contenedora por debajo de unas 300–400 líneas.
- Extraer componentes por sección con props tipadas, no por fragmentos arbitrarios.
- Mantener reglas puras en funciones testeables; los componentes sólo presentan y disparan casos de uso.

### Fase 3 — base de datos y entrega

- Reemplazar migraciones que parchean texto por definiciones completas.
- Generar tipos Supabase desde el esquema y usarlos en los adaptadores.
- Ejecutar migraciones automáticamente en staging y bloquear deploy si hay drift.
- Mantener QA SQL transaccional como segunda capa, además de las pruebas TypeScript.

## 8. Inventario de carpetas

| Carpeta | Contenido y función |
|---|---|
| `src/app` | Árbol de rutas Next.js; composición server-side, layouts y estados de carga/error. |
| `src/components` | Componentes reutilizables que cruzan varios dominios. |
| `src/features` | Implementación por dominio: UI, acciones, consultas, tipos y formato. |
| `src/lib` | Infraestructura y utilidades globales sin pantalla propia. |
| `src/hooks` | Reservada; hoy sólo contiene `.gitkeep`. |
| `src/services` | Reservada; no existe todavía una capa de servicios. |
| `src/types` | Reservada; los tipos viven principalmente dentro de cada feature. |
| `public` | Activos estáticos públicos. |
| `supabase/migrations` | Evolución SQL canónica disponible, aunque incompleta y mayormente manual. |
| `supabase/proposals` | Borradores/histórico; no se deben ejecutar automáticamente. |
| `supabase/qa` | Scripts manuales de QA y limpieza. |
| `docs` | Especificaciones locales; actualmente ignoradas por Git. |
| `output`, `tmp` | Artefactos generados y diagnósticos, no código fuente. |

## 9. Catálogo de archivos

Las descripciones siguientes documentan **cada archivo propio relevante encontrado**. Los `.gitkeep` sólo conservan directorios vacíos; `.DS_Store`, caches, binarios generados y secretos no se catalogan como arquitectura.

### 9.1 Raíz y configuración

| Archivo | Función |
|---|---|
| `.env` | Variables locales sensibles; su contenido no se inspecciona ni documenta y está ignorado por Git. |
| `.gitignore` | Excluye dependencias, builds, entornos, `docs`, caches y archivos del sistema. |
| `AGENTS.md` | Reglas locales para agentes; exige consultar la documentación instalada de Next.js antes de modificar código Next. |
| `CLAUDE.md` | Contexto/instrucciones auxiliares de desarrollo del repositorio. |
| `README.md` | Introducción, stack y fases; necesita actualización frente al alcance actual. |
| `package.json` | Dependencias y scripts `dev`, `build`, `start`, `lint`, `typecheck`; no define tests. |
| `package-lock.json` | Resolución reproducible de dependencias npm. |
| `next.config.ts` | Configuración de Next.js. |
| `next-env.d.ts` | Tipos generados por Next; está ignorado y no debe editarse manualmente. |
| `eslint.config.mjs` | Reglas estáticas con configuración Next. |
| `postcss.config.mjs` | Integración PostCSS/Tailwind. |
| `tsconfig.json` | Configuración TypeScript y aliases. |
| `tsconfig.tsbuildinfo` | Cache incremental generado; correctamente ignorado. |
| `public/pro-logo.png` | Logo público utilizado por shell/reportes. |
| `supabase/.temp/cli-latest` | Metadata temporal de Supabase CLI, no lógica del sistema. |

### 9.2 Documentación existente

| Archivo | Función |
|---|---|
| `docs/01-functional-spec.md` | Alcance funcional, roles, estados y reglas del producto. |
| `docs/02-database-architecture.md` | Modelo, tablas, dominios, RPC, seguridad, Storage y extracción. |
| `docs/03-erp-architecture.md` | Contexto e integración conceptual con ERP. |
| `docs/04-uml-domain.md` | Modelo UML/relaciones del dominio. |
| `docs/05-business-process.md` | Secuencia operacional completa del negocio. |
| `docs/06-ui-references.md` | Criterios y referencias visuales de interfaz. |

### 9.3 Rutas `src/app`

| Archivo | Función |
|---|---|
| `src/app/layout.tsx` | Layout raíz, metadata y providers globales. |
| `src/app/globals.css` | Tokens visuales, estilos base y utilidades globales. |
| `src/app/(auth)/layout.tsx` | Marco visual público para autenticación. |
| `src/app/(auth)/login/page.tsx` | Página de inicio de sesión. |
| `src/app/(auth)/forgot-password/page.tsx` | Solicitud de recuperación de contraseña. |
| `src/app/(auth)/reset-password/page.tsx` | Definición de nueva contraseña después del callback. |
| `src/app/auth/confirm/route.ts` | Intercambia/verifica códigos Auth y redirige al flujo correspondiente. |
| `src/app/auth/signout/route.ts` | Cierra sesión desde una petición HTTP. |
| `src/app/(dashboard)/layout.tsx` | Exige sesión/perfil, resuelve contexto de proyecto y monta el shell operacional. |
| `src/app/(dashboard)/page.tsx` | Dashboard del proyecto activo. |
| `src/app/(dashboard)/loading.tsx` | Loading general del dashboard. |
| `src/app/(dashboard)/error.tsx` | Error boundary general del dashboard. |
| `src/app/(dashboard)/programming/page.tsx` | Lista/calendario/Kanban de programaciones. |
| `src/app/(dashboard)/programming/loading.tsx` | Skeleton de programación. |
| `src/app/(dashboard)/programming/error.tsx` | Error boundary de programación. |
| `src/app/(dashboard)/programming/[id]/page.tsx` | Detalle y comandos de una programación. |
| `src/app/(dashboard)/programming/[id]/loading.tsx` | Loading del detalle de programación. |
| `src/app/(dashboard)/programming/[id]/error.tsx` | Error del detalle de programación. |
| `src/app/(dashboard)/dispatches/page.tsx` | Workspace de despachos y registro. |
| `src/app/(dashboard)/dispatches/loading.tsx` | Skeleton de despachos. |
| `src/app/(dashboard)/dispatches/error.tsx` | Error boundary de despachos. |
| `src/app/(dashboard)/dispatches/[id]/page.tsx` | Detalle de despacho/guía. |
| `src/app/(dashboard)/dispatches/[id]/loading.tsx` | Loading del detalle de despacho. |
| `src/app/(dashboard)/dispatches/[id]/error.tsx` | Error del detalle de despacho. |
| `src/app/(dashboard)/batches/page.tsx` | Listado y creación de lotes semanales. |
| `src/app/(dashboard)/batches/loading.tsx` | Loading de lotes. |
| `src/app/(dashboard)/batches/error.tsx` | Error boundary de lotes. |
| `src/app/(dashboard)/batches/[id]/page.tsx` | Detalle del lote, pedidos y guías activas. |
| `src/app/(dashboard)/batches/[id]/loading.tsx` | Loading del lote. |
| `src/app/(dashboard)/batches/[id]/error.tsx` | Error del lote. |
| `src/app/(dashboard)/batches/[id]/orders/[orderId]/page.tsx` | Detalle documental y conciliación de un pedido. |
| `src/app/(dashboard)/batches/[id]/orders/[orderId]/loading.tsx` | Loading del pedido. |
| `src/app/(dashboard)/batches/[id]/orders/[orderId]/error.tsx` | Error del pedido. |
| `src/app/(dashboard)/invoices/page.tsx` | Índice global de facturas del proyecto. |
| `src/app/(dashboard)/reconciliation/page.tsx` | Resumen global de conciliación por pedido. |
| `src/app/(dashboard)/documents/page.tsx` | Índice global de documentos autorizados. |
| `src/app/(dashboard)/notifications/page.tsx` | Centro de notificaciones operativas. |
| `src/app/(dashboard)/reports/page.tsx` | Reportería de programaciones, despachos y pedidos. |
| `src/app/(dashboard)/reports/export/route.ts` | Autoriza consulta y construye/descarga el Excel; mezcla HTTP y presentación del workbook. |
| `src/app/platform/layout.tsx` | Verifica Platform Admin y monta administración global. |
| `src/app/platform/page.tsx` | Resumen administrativo. |
| `src/app/platform/loading.tsx` | Loading global de plataforma. |
| `src/app/platform/companies/page.tsx` | Listado/filtros de compañías. |
| `src/app/platform/companies/loading.tsx` | Loading de compañías. |
| `src/app/platform/companies/error.tsx` | Error boundary de compañías. |
| `src/app/platform/companies/new/page.tsx` | Formulario de nueva compañía. |
| `src/app/platform/companies/new/loading.tsx` | Loading de creación de compañía. |
| `src/app/platform/companies/[id]/page.tsx` | Detalle de compañía, proyectos, proveedores y usuarios. |
| `src/app/platform/companies/[id]/loading.tsx` | Loading del detalle de compañía. |
| `src/app/platform/users/page.tsx` | Listado y alta/invitación de usuarios. |
| `src/app/platform/users/loading.tsx` | Loading de usuarios. |
| `src/app/platform/users/error.tsx` | Error boundary de usuarios. |
| `src/app/platform/users/[id]/page.tsx` | Administración completa de un usuario. |
| `src/app/platform/users/[id]/loading.tsx` | Loading del detalle de usuario. |
| `src/app/platform/audit/page.tsx` | Bitácora global con filtros. |
| `src/app/platform/audit/loading.tsx` | Loading de auditoría. |
| `src/app/platform/audit/error.tsx` | Error boundary de auditoría. |
| `src/app/platform/templates/page.tsx` | Índice de plantillas administrativas. |
| `src/app/platform/templates/dispatch-guide/page.tsx` | Preview de la plantilla fija de guía. |

### 9.4 Componentes transversales

| Archivo | Función |
|---|---|
| `src/components/layout/app-shell.tsx` | Estructura general del área operativa. |
| `src/components/layout/app-sidebar.tsx` | Navegación por módulos según permisos. |
| `src/components/layout/topbar.tsx` | Cabecera, proyecto/usuario y acciones globales. |
| `src/components/layout/.gitkeep` | Conserva la carpeta en Git; ya contiene implementación real. |
| `src/components/documents/document-preview-dialog.tsx` | Acciones comunes para visualizar/descargar documentos privados. |
| `src/components/feedback/app-loader.tsx` | Indicadores de carga de aplicación/página. |
| `src/components/feedback/empty-state.tsx` | Estado vacío reutilizable. |
| `src/components/feedback/error-state.tsx` | Presentación reutilizable de errores y reintento. |
| `src/components/feedback/global-loader-overlay.tsx` | Capa visual de operación global pendiente. |
| `src/components/feedback/global-loading-provider.tsx` | Contexto cliente que coordina pendientes globales. |
| `src/components/feedback/loading-button.tsx` | Botón con estado de envío/carga. |
| `src/components/feedback/section-loader.tsx` | Carga localizada de una sección. |
| `src/components/feedback/skeletons.tsx` | Skeletons genéricos de tarjetas/tablas. |
| `src/components/motion/motion-card.tsx` | Entrada animada de tarjeta. |
| `src/components/motion/motion-list.tsx` | Animación escalonada de listas e ítems. |
| `src/components/motion/motion-page.tsx` | Transición de página. |
| `src/components/motion/motion-section.tsx` | Transición de sección. |
| `src/components/providers/motion-provider.tsx` | Preferencias/contexto global de animación. |
| `src/components/providers/theme-provider.tsx` | Proveedor de tema claro/oscuro. |
| `src/components/shared/scope-switch-link.tsx` | Enlace que cambia entre ámbito operativo y plataforma. |
| `src/components/shared/theme-toggle.tsx` | Control de tema. |
| `src/components/shared/.gitkeep` | Placeholder histórico de carpeta. |
| `src/components/ui/.gitkeep` | Reserva una capa UI base que todavía no existe. |

### 9.5 Infraestructura y proyecto activo

| Archivo | Función |
|---|---|
| `src/proxy.ts` | Entrada del proxy Next y reglas de matching de sesión. |
| `src/lib/env.ts` | Lee/valida variables públicas necesarias. |
| `src/lib/status-labels.ts` | Humaniza códigos/estados internos; debería ser la única fuente común. |
| `src/lib/motion/variants.ts` | Variantes Motion compartidas. |
| `src/lib/supabase/client.ts` | Cliente Supabase para navegador. |
| `src/lib/supabase/server.ts` | Cliente Supabase SSR ligado a cookies. |
| `src/lib/supabase/admin.ts` | Cliente server-only con service role para Auth Admin. |
| `src/lib/supabase/proxy.ts` | Refresca sesión y controla redirecciones en el proxy. |
| `src/features/projects/actions.ts` | Cambia el proyecto activo y actualiza cookie/cache. |
| `src/features/projects/queries.ts` | Resuelve acceso operativo, membresías, roles, permisos y proyecto activo. |
| `src/features/projects/types.ts` | Contratos del contexto y cambio de proyecto. |
| `src/features/projects/project-context.tsx` | Contexto cliente del proyecto y helper de permisos. |
| `src/features/projects/components/project-selector.tsx` | Selector de proyecto accesible. |
| `src/features/projects/components/project-overview.tsx` | Estado sin proyecto/resumen inicial. |
| `src/features/projects/components/permission-guard.tsx` | Oculta UI si falta un permiso; no reemplaza autorización backend. |
| `src/hooks/.gitkeep` | Carpeta de hooks reservada, actualmente vacía. |
| `src/services/.gitkeep` | Carpeta de servicios reservada, actualmente vacía. |
| `src/types/.gitkeep` | Carpeta de tipos globales reservada, actualmente vacía. |
| `src/features/.gitkeep` | Placeholder histórico de la raíz de features. |

### 9.6 Feature `auth`

| Archivo | Función |
|---|---|
| `src/features/auth/actions.ts` | Server Actions de login, reset, actualización de contraseña y logout. |
| `src/features/auth/queries.ts` | Obtiene y exige usuario/perfil activo. |
| `src/features/auth/types.ts` | Estados de formularios y perfil de sesión. |
| `src/features/auth/components/auth-card.tsx` | Contenedor visual de formularios Auth. |
| `src/features/auth/components/auth-message.tsx` | Mensajes de éxito/error de Auth. |
| `src/features/auth/components/login-form.tsx` | Formulario cliente de login. |
| `src/features/auth/components/forgot-password-form.tsx` | Formulario de correo de recuperación. |
| `src/features/auth/components/update-password-form.tsx` | Formulario de contraseña nueva. |

### 9.7 Feature `dashboard`

| Archivo | Función |
|---|---|
| `src/features/dashboard/queries.ts` | Agrega métricas semanales, alertas, lote, facturación, incidencias y actividad. |
| `src/features/dashboard/types.ts` | Modelo de datos completo del dashboard. |
| `src/features/dashboard/formatters.ts` | Fechas, cantidades, estados y actividad visibles. |
| `src/features/dashboard/components/project-dashboard.tsx` | Renderiza el tablero operacional según roles/datos. |
| `src/features/dashboard/components/dashboard-skeleton.tsx` | Skeleton específico del tablero. |

### 9.8 Feature `programming`

| Archivo | Función |
|---|---|
| `src/features/programming/actions.ts` | Crea, muta y carga rangos de programaciones mediante RPC/consultas. |
| `src/features/programming/availability.ts` | Reglas puras de estado efectivo, expiración y elegibilidad para despacho. |
| `src/features/programming/queries.ts` | Consulta rangos, catálogos, permisos, detalle, líneas, revisiones y despachos. |
| `src/features/programming/types.ts` | Estados, DTO de programación, líneas, revisiones, filtros y comandos. |
| `src/features/programming/formatters.ts` | Etiquetas, tonos, cantidades y fechas de programación. |
| `src/features/programming/components/programming-workspace.tsx` | Coordina filtros, vista activa, calendario/Kanban y creación. |
| `src/features/programming/components/programming-calendar.tsx` | Vista temporal Schedule-X. |
| `src/features/programming/components/programming-kanban.tsx` | Vista por estados. |
| `src/features/programming/components/create-programming-dialog.tsx` | Modal de creación y validación de programación. |
| `src/features/programming/components/programming-lines-fields.tsx` | Editor repetible de cantidades/unidad. |
| `src/features/programming/components/programming-preview-drawer.tsx` | Resumen lateral desde calendario/Kanban. |
| `src/features/programming/components/programming-detail-view.tsx` | Detalle, historial y comandos de transición; 627 líneas, candidato a división. |
| `src/features/programming/components/programming-skeleton.tsx` | Skeleton del módulo. |

### 9.9 Feature `dispatches`

| Archivo | Función |
|---|---|
| `src/features/dispatches/actions.ts` | Registro/corrección, incidencias, preparación/finalización de uploads y descargas. |
| `src/features/dispatches/queries.ts` | Arma lista y detalle con programación, guía, líneas, documentos, lote, factura y pedido. |
| `src/features/dispatches/types.ts` | Estados, resultados, DTO y estados de mutación. |
| `src/features/dispatches/formatters.ts` | Etiquetas, tonos, fechas, cantidades e identificadores. |
| `src/features/dispatches/components/dispatches-workspace.tsx` | Lista, filtros y apertura de registro. |
| `src/features/dispatches/components/dispatch-detail-view.tsx` | Presenta operación, guía, pedido, productos, documentos e incidencias. |
| `src/features/dispatches/components/register-dispatch-dialog.tsx` | Formulario extenso para crear despacho/guía. |
| `src/features/dispatches/components/correct-dispatch-guide-dialog.tsx` | Corrección completa auditada de guía. |
| `src/features/dispatches/components/correct-dispatch-order-dialog.tsx` | Corrección limitada al número de pedido. |
| `src/features/dispatches/components/register-incident-dialog.tsx` | Alta de incidencia tipificada. |
| `src/features/dispatches/components/document-uploader.tsx` | Flujo de subida privada con URL firmada. |
| `src/features/dispatches/components/dispatch-badges.tsx` | Badges de estado y resultado físico. |
| `src/features/dispatches/components/dispatches-skeleton.tsx` | Skeleton de lista/detalle. |

### 9.10 Feature `batches` (lotes, pedidos y facturas)

| Archivo | Función |
|---|---|
| `src/features/batches/actions.ts` | Concentra comandos de lote, upload/finalización de factura, intake Mixto, conciliación, refacturación y cierre; principal hotspot backend. |
| `src/features/batches/queries.ts` | Compone lista/detalle del lote, guías elegibles, pedidos y preview de rollover. |
| `src/features/batches/order-queries.ts` | Consulta el detalle profundo de un pedido y sus contribuciones. |
| `src/features/batches/mixto-listo-extractor.ts` | Extrae texto embebido del PDF con `unpdf`; no hace OCR. |
| `src/features/batches/mixto-listo-parser.ts` | Parser puro y específico de Mixto Listo/PCA/líneas. |
| `src/features/batches/types.ts` | Contratos de lotes, pedidos, documentos, guías, facturas, líneas y permisos. |
| `src/features/batches/formatters.ts` | Estados, tonos, fechas, cantidades y códigos. |
| `src/features/batches/components/batches-workspace.tsx` | Listado/filtros y creación de lotes. |
| `src/features/batches/components/batch-detail-view.tsx` | Secciones de pedidos, guías activas, relaciones removidas y rollover. |
| `src/features/batches/components/batch-dialogs.tsx` | Modal base y diálogos de crear, agregar/quitar guía y rollover. |
| `src/features/batches/components/batch-status-badge.tsx` | Badge de estado de lote. |
| `src/features/batches/components/order-detail-view.tsx` | Pantalla completa de pedido, previews, correcciones, descartes, uploads y conciliación; 1,960 líneas, mayor hotspot. |
| `src/features/batches/components/invoice-workspace.tsx` | UI extensa del flujo de factura/extracción/confirmación. |

### 9.11 Features `invoices`, `reconciliation`, `documents` y `notifications`

| Archivo | Función |
|---|---|
| `src/features/invoices/queries.ts` | Índice global de facturas y contexto de pedido/documento. |
| `src/features/invoices/types.ts` | DTO del índice de facturas. |
| `src/features/invoices/components/invoices-workspace.tsx` | Tabla/filtros/acciones visibles de facturas. |
| `src/features/reconciliation/queries.ts` | Agrega conciliaciones por pedido para el proyecto. |
| `src/features/reconciliation/types.ts` | DTO del resumen global. |
| `src/features/reconciliation/components/reconciliation-workspace.tsx` | Métricas, filtros y tarjetas/tabla de conciliación. |
| `src/features/documents/actions.ts` | Autoriza y crea URL firmada para un documento global. |
| `src/features/documents/queries.ts` | Busca documentos permitidos y arma filtros de proyecto/usuario/contexto. |
| `src/features/documents/types.ts` | Filtros y DTO del índice documental. |
| `src/features/documents/components/documents-workspace.tsx` | Índice visual, filtros y descarga/preview. |
| `src/features/notifications/actions.ts` | Marca una o todas las notificaciones como leídas. |
| `src/features/notifications/queries.ts` | Deriva alertas operativas y combina estado de lectura. |
| `src/features/notifications/types.ts` | Contrato de notificación operacional. |
| `src/features/notifications/components/notifications-center.tsx` | Lista y acciones del centro de notificaciones. |

### 9.12 Feature `reports`

| Archivo | Función |
|---|---|
| `src/features/reports/filters.ts` | Parsea y serializa filtros de reporte. |
| `src/features/reports/queries.ts` | Une programaciones, despachos, guías, pedidos y refacturación para reportar. |
| `src/features/reports/types.ts` | Filtros, filas y agrupaciones del reporte. |
| `src/features/reports/components/guide-report.tsx` | Vista filtrable de programaciones con sus despachos asociados. |

### 9.13 Feature `platform`

| Archivo | Función |
|---|---|
| `src/features/platform/queries.ts` | Verifica la capacidad global `PLATFORM_ADMIN`. |
| `src/features/platform/types.ts` | Datos base del contexto administrativo. |
| `src/features/platform/platform-context.tsx` | Contexto cliente de plataforma. |
| `src/features/platform/components/platform-shell.tsx` | Shell de administración global. |
| `src/features/platform/components/platform-sidebar.tsx` | Navegación administrativa. |
| `src/features/platform/components/platform-topbar.tsx` | Cabecera y retorno a operación. |
| `src/features/platform/components/platform-overview.tsx` | Resumen inicial de administración. |
| `src/features/platform/companies/actions.ts` | Crea/edita proyecto, crea compañía, cambia estado y asigna proveedores. |
| `src/features/platform/companies/queries.ts` | Lista y detalle de compañía con proyectos, proveedores y usuarios. |
| `src/features/platform/companies/types.ts` | DTO y estados de acciones de compañías/proyectos. |
| `src/features/platform/companies/formatters.ts` | Fechas administrativas. |
| `src/features/platform/companies/components/companies-list.tsx` | Listado/filtros de compañías. |
| `src/features/platform/companies/components/company-detail-view.tsx` | Compone overview, proyectos, proveedores y usuarios de la compañía. |
| `src/features/platform/companies/components/company-status-badge.tsx` | Badge ACTIVE/INACTIVE. |
| `src/features/platform/companies/components/company-status-dialog.tsx` | Confirmación de activación/desactivación. |
| `src/features/platform/companies/components/create-company-form.tsx` | Formulario de nueva compañía. |
| `src/features/platform/companies/components/create-project-dialog.tsx` | Alta de proyecto dentro de compañía. |
| `src/features/platform/companies/components/edit-project-dialog.tsx` | Edición administrativa del proyecto. |
| `src/features/platform/companies/components/project-supplier-manager.tsx` | Selección múltiple de proveedores habilitados por proyecto. |
| `src/features/platform/users/actions.ts` | Invitación/creación Auth, perfil, estado, contraseña, memberships y roles. |
| `src/features/platform/users/queries.ts` | Lista/detalle de usuario, Auth Admin, membresías, roles y auditoría. |
| `src/features/platform/users/types.ts` | Modelos de usuario, estado Auth, memberships, roles y acciones. |
| `src/features/platform/users/formatters.ts` | Fechas y etiquetas Auth. |
| `src/features/platform/users/components/users-list.tsx` | Lista/filtros y acceso a alta de usuario. |
| `src/features/platform/users/components/invite-user-dialog.tsx` | Permite invitación por correo o creación con contraseña. |
| `src/features/platform/users/components/user-detail-view.tsx` | Consola de perfil, acceso, roles y actividad del usuario. |
| `src/features/platform/users/components/user-admin-dialogs.tsx` | Diálogos de edición, password, compañía, proyecto, membresía y roles. |
| `src/features/platform/users/components/user-avatar.tsx` | Avatar con iniciales. |
| `src/features/platform/users/components/user-status-badge.tsx` | Badges de perfil y estado Auth. |
| `src/features/platform/users/components/user-status-dialog.tsx` | Confirmación de activación/desactivación. |
| `src/features/platform/audit/queries.ts` | Consulta paginada/filtrada de `audit_events`. |
| `src/features/platform/audit/types.ts` | Filtros, eventos y opciones de auditoría. |
| `src/features/platform/audit/formatters.ts` | Traduce acciones, entidades y fechas de auditoría. |
| `src/features/platform/audit/components/audit-list.tsx` | Tabla/filtros de bitácora global. |
| `src/features/platform/templates/components/templates-list.tsx` | Catálogo de plantillas disponibles. |
| `src/features/platform/templates/components/dispatch-guide-template-preview.tsx` | Representación visual de plantilla de guía. |

## 10. Auditoría breve de cada SQL

### 10.1 Migraciones

Estado declarado en el propio archivo al momento de esta auditoría: `044`, `059` y `072` dicen haber sido ejecutadas manualmente; las demás dicen estar listas pero no ejecutadas. El estado real del servidor debe verificarse contra `supabase_migrations.schema_migrations` y el catálogo, porque un comentario no es una fuente operacional confiable.

| SQL | Propósito corto | Observación de auditoría |
|---|---|---|
| `044_platform_admin_user_access_management.sql` | RPC para editar perfiles, memberships de compañía/proyecto y roles desde Platform Admin. | Ejecutada; buen límite entre permisos de plataforma y operación. |
| `045_default_dispatch_guide_template.sql` | Añade líneas repetibles de guía y mantiene columnas agregadas por compatibilidad. | Migración puente razonable; deuda temporal si el rollup viejo nunca se retira. |
| `046_batch_guides_system_removal_constraint.sql` | Distingue remoción HUMAN/SYSTEM y endurece exposición de RPC. | Refuerza evidencia y mínimos privilegios. |
| `047_fix_batch_guides_removed_check_null_semantics.sql` | Corrige semántica `NULL` del check de remoción. | Hotfix pequeño y enfocado; demuestra necesidad de tests SQL de constraints. |
| `048_programming_phase4_access_alignment.sql` | Hace que lectura de programación use `programming.view` y revoca ejecución anónima. | Correcta alineación permiso–RLS. |
| `049_suppliers_programming_read_alignment.sql` | Expone sólo proveedores activos/asignados a proyectos visibles para programación. | Evita que compañía implique disponibilidad automática en todos sus proyectos. |
| `050_units_of_measure_programming_read_access.sql` | Permite leer unidades activas a usuarios operativos autorizados. | Catálogo global con exposición acotada. |
| `051_programming_lines.sql` | Añade líneas repetibles homogéneas y sincroniza rollups legacy. | Bien para evolución gradual; añade doble representación a vigilar. |
| `052_programming_detail_workflow.sql` | Versiona programaciones y agrega comandos transaccionales de edición/transición. | Buena concurrencia/auditoría; RPC grande requiere pruebas por transición. |
| `053_programming_view_rls_alignment.sql` | Exige `programming.view` en todas las lecturas relacionadas. | Reduce filtraciones por simple membresía. |
| `054_dispatch_read_access_alignment.sql` | Exige `dispatch.view`, conserva lectura Platform Admin y deja browser SELECT-only. | Mejora crítica frente a ACL anteriormente amplias. |
| `055_dispatch_registration_physical_quantities.sql` | Modela enviado/recibido/devuelto, valida plantilla y usa recepción física para cierre. | Hace explícita la autoridad física del negocio. |
| `056_dispatch_incidents.sql` | Catálogo de incidencias y RPC transaccional de registro. | Mutación encapsulada y auditada. |
| `057_dispatch_documents_upload.sql` | Upload privado versionado para guía/incidencia mediante preparación/finalización. | Patrón seguro; necesita limpieza de uploads abandonados. |
| `058_dispatch_guide_corrections.sql` | Revisiones inmutables y corrección con optimistic locking. | Diseño sólido; originalmente bloqueó demasiado las guías en lote. |
| `059_dispatch_guide_correction_lock_priority.sql` | Prioriza el error de factura bloqueada antes que lote bloqueado. | Correctivo ejecutado; mejora mensaje sin cambiar regla. |
| `060_weekly_batches_security_hardening.sql` | Endurece grants y exposición RPC de lotes. | Seguridad sin cambio funcional. |
| `061_weekly_batches_workflow.sql` | Semana canónica, asignación/remoción manual y rollover SYSTEM. | Flujo central bien explicitado; documenta correctamente una señal SERVICE faltante. |
| `062_invoice_intake_reconciliation.sql` | Intake privado, asociación 1..N con guías, extracción y conciliación PRODUCT agregada. | Primera base del flujo; posteriormente sustituida parcialmente por pedido. |
| `063_order_level_reconciliation.sql` | Cambia el agregado de conciliación a lote + pedido normalizado. | Decisión de dominio acertada; eleva complejidad y exige backfill/consistencia. |
| `064_programming_dispatch_temporal_availability.sql` | Deriva `EXPIRED` sin añadir otro estado persistido. | Evita reescrituras históricas; frontend y backend deben compartir exactamente la regla. |
| `065_mixto_listo_invoice_extraction_pipeline.sql` | Staging PDF, verificación PCA/pedido y confirmación atómica. | Buen patrón de intake; específico a proveedor/formato. |
| `066_fix_mixto_listo_verification_status_cast.sql` | Corrige cast del enum de verificación en el RPC de confirmación. | Hotfix preciso; debería estar cubierto por test de confirmación. |
| `067_order_completion_without_final_authorization.sql` | PRODUCT reconciliado completa pedido; SERVICE no compara; rollover preserva completados. | Simplifica autoridad, pero parchea una función existente mediante texto. |
| `068_quantity_only_order_reconciliation.sql` | Compara sólo cantidad por UM; código/descripción quedan auditables. | Regla clara, pero usa `pg_get_functiondef` + `replace`, técnica frágil. |
| `069_platform_project_supplier_management.sql` | Administra proveedores por proyecto preservando historia con `active`. | Resuelve correctamente el aislamiento entre proyectos de una compañía. |
| `070_dispatch_order_correction_and_required_order.sql` | Pedido obligatorio y corrección auditada antes de factura/historia. | Cierra el hueco que impedía formar pedido; depende de varios contratos previos. |
| `071_automatic_programming_completion_from_orders.sql` | Sincroniza despacho reconciliado y completa programación cuando todos hacen match. | Regla final coherente; trigger debe probar reaperturas y concurrencia. |
| `072_notification_read_state.sql` | Persiste claves leídas y cursor `__ALL__` por usuario/proyecto. | Ejecutada; mantiene notificaciones derivadas sin duplicar dominio. |
| `073_invoice_documents_operational_read.sql` | Permite leer relación factura–documento a usuarios autorizados. | Sólo metadata; mantiene archivo privado. |
| `074_discard_pending_mixto_listo_invoice_intake.sql` | Descarta intake pendiente como `FAILED` sin borrar evidencia. | Mejor que DELETE físico y correcto para auditoría. |
| `075_platform_company_project_creation.sql` | RPC Platform Admin para crear proyecto activo validado y auditado. | Falta ejecutar según encabezado; el frontend puede fallar hasta aplicarla. |
| `076_platform_company_project_editing.sql` | RPC Platform Admin para editar proyecto con old/new values. | Mismo riesgo de despliegue que 075. |
| `077_relax_project_code_validation.sql` | Permite códigos comerciales con espacios y puntuación, conservando longitud, mayúsculas, unicidad y rechazo de controles. | Define por completo ambos RPC y también repara entornos donde 075/076 no se aplicaron. |

### 10.2 Propuestas SQL

| Archivo | Función |
|---|---|
| `supabase/proposals/README.md` | Declara que proposals son borradores/histórico y señala su promoción. |
| `20260827_platform_admin_global_read.sql` | Propuesta obsoleta de lectura global; dice no ejecutar y referencia una migración 043 ausente. |
| `20260828_platform_admin_user_access_management.sql` | Fuente histórica promovida a 044. |
| `20260829_dispatch_guide_lines.sql` | Fuente histórica promovida a 045. |

Mantener propuestas es útil como historia de decisión, pero una vez promovidas deberían moverse a `docs/adr` o marcarse inequívocamente; tener SQL ejecutable duplicado aumenta el riesgo humano.

### 10.3 SQL de QA

| Archivo | Función |
|---|---|
| `supabase/qa/cleanup_order45_20260901.sql` | Limpieza destructiva y puntual del escenario QA Order 45; no es migración. |
| `supabase/qa/qa_reconciliation_transactional_20260901.sql` | Prueba la conciliación quantity-only dentro de una transacción que siempre revierte. |

El QA transaccional es una buena base. Falta convertir escenarios similares en una suite ejecutable por CI y evitar IDs fijos o scripts de limpieza manual como mecanismo principal.

## 11. Riesgos concretos priorizados

| Prioridad | Riesgo | Impacto | Acción recomendada |
|---|---|---|---|
| P0 | Faltan migraciones 001–043/baseline. | No se puede reproducir, auditar ni recuperar completamente la BD. | Exportar esquema canónico, revisar secretos/owners y versionar baseline. |
| P0 | Código usa RPC de SQL marcado no ejecutado. | Errores runtime como “función no existe” y ambientes inconsistentes. | Pipeline de migración antes del deploy y health check de contratos. |
| P0 | Sin pruebas automatizadas. | Regresiones en conciliación, permisos, parser y rollover. | Tests puros + integración DB + e2e de caminos críticos. |
| P1 | Componentes/actions de 700–1,960 líneas. | Cambios lentos, conflictos y efectos laterales. | Dividir por caso de uso y sección, empezando por pedidos. |
| P1 | Mutaciones Auth Admin + DB no atómicas. | Usuarios parciales o estados divergentes. | Idempotencia, compensación y job de reconciliación. |
| P1 | Migraciones que parchean definición por texto. | Drift y fallos difíciles al cambiar espacios/cuerpo previo. | Reemplazar con definición completa canónica. |
| P1 | Parser único para plantilla Mixto Listo sin OCR/tests. | PDFs válidos pueden fallar sin explicación. | Fixtures, diagnóstico por campo y adaptadores por versión/proveedor. |
| P2 | Validación/mapeo de errores duplicados. | Mensajes inconsistentes y mantenimiento repetitivo. | Librería común de schemas, errores y resultados. |
| P2 | Documentación ignorada/desactualizada. | Decisiones no llegan al equipo y onboarding incorrecto. | Versionar docs y adoptar ADR. |
| P2 | Ensamblaje manual de joins en queries grandes. | Mayor latencia, volumen y complejidad. | Views/RPC de lectura o repositorios con selects acotados. |

## 12. Definición de arquitectura objetivo mínima

No hace falta introducir DDD completo. Una meta realista es:

```text
src/features/<feature>/
  domain/         tipos de negocio, estados y reglas puras
  application/    un archivo por caso de uso
  data/           consultas/RPC y mapeo de filas a DTO
  components/     componentes de presentación pequeños
  index.ts         API pública opcional del feature
```

Reglas prácticas:

- Una Server Action autoriza y valida, llama un caso de uso y traduce el resultado para la UI.
- Un caso de uso no importa React.
- Un componente no conoce nombres de tablas ni códigos crudos de errores RPC.
- Una query no devuelve filas Supabase sin mapear si se consumen en varias pantallas.
- Toda transición importante tiene una prueba en TypeScript y otra de integración SQL si depende de RLS/trigger.
- Cada migración aplicada queda registrada automáticamente; ningún comentario manual representa el estado del entorno.

## 13. Conclusión

La base conceptual del sistema es buena: el dominio está identificado, las reglas críticas se están moviendo a la base de datos y existe una preocupación real por permisos, historia y auditoría. El problema no es que “todo esté mezclado”; es que el crecimiento acelerado concentró demasiadas responsabilidades en unos cuantos archivos y dejó el esquema desplegado fuera de sincronía con su historia versionada.

La prioridad correcta es **reproducibilidad + pruebas + contratos de despliegue**, seguida por la división del módulo `batches/order-detail`. Si se hace en ese orden, el sistema puede volverse mantenible sin perder las reglas ya implementadas ni hacer una reescritura riesgosa.
