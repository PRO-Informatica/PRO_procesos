# PRO Procesos

Aplicación empresarial para el control operativo y documental del concreto en proyectos de construcción.

## Requisitos

- Node.js 20.9 o superior
- npm 10 o superior
- Un proyecto existente de Supabase

## Configuración local

1. Copia `.env.example` a `.env.local`.
2. Completa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Instala dependencias con `npm install`.
4. Inicia el entorno local con `npm run dev`.

## Verificación

```bash
npm run lint
npm run typecheck
npm run build
```

## Estado

La Fase 1 incorpora:

- acceso con correo y contraseña mediante Supabase Auth;
- sesión SSR protegida con `getClaims()` y `proxy.ts`;
- validación del estado `profiles.active`;
- recuperación y actualización de contraseña;
- cierre de sesión;
- app shell responsive con sidebar colapsable, topbar y temas light/dark/system.

El registro público no está habilitado. Los módulos operativos quedan fuera de estas fases.

La Fase 2 incorpora contexto global de proyecto, selector persistente, unión de roles activos de empresa/proyecto y navegación condicionada por permisos. El selector es una preferencia de interfaz: RLS continúa siendo la autoridad para cada consulta.

La Fase 3 incorpora el dashboard operacional read-only y aislado por proyecto, con resúmenes de planificación, despachos, incidencias, lote semanal, facturación y actividad. El siguiente módulo de Programación debe ofrecer obligatoriamente dos vistas complementarias sobre los estados reales del dominio: **Calendario** y **Kanban**. El resumen semanal del dashboard no sustituye ninguna de esas vistas.

La fundación de experiencia visual usa Motion para React e incluye variantes centralizadas, reducción de movimiento, loader con identidad PRO, loaders locales, botones con estado de envío, skeletons y estados reutilizables de vacío/error.

El build usa Webpack de forma explícita porque Turbopack no puede enlazar el proceso auxiliar de PostCSS en el entorno de ejecución restringido usado para validar este baseline.
