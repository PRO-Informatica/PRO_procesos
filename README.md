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

La Fase 0 contiene únicamente el baseline técnico, clientes Supabase SSR y un app shell mínimo. Auth, contexto de proyecto y módulos funcionales quedan fuera de esta fase.

El build usa Webpack de forma explícita porque Turbopack no puede enlazar el proceso auxiliar de PostCSS en el entorno de ejecución restringido usado para validar este baseline.
