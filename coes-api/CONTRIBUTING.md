# Contribuir a coes-api

Repo interno de Mallku. Esta guía es corta a propósito.

## Setup

```bash
git clone git@github.com:enerku/coes-api.git
cd coes-api
npm install
cp .env.example .env
# editar .env con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
npm start
```

## Flujo de trabajo

- `main` es la rama productiva. El workflow de GitHub Actions (ingesta nocturna) corre desde `main`.
- Cambios van en branches `feature/...`, `fix/...`, `refine-cap4-cmg`, etc., y se mergean por PR.
- No hay reviewer obligatorio mientras el equipo sea ≤4 personas, pero sí: 1 PR = 1 cambio lógico, no mezclar.

## Qué cosas necesitan más cuidado

1. **Cambios en `sql/`.** No editar archivos ya aplicados a Supabase. Crear `002_*.sql`, `003_*.sql`, etc. Y dejar nota en el PR de qué hay que correr a mano.
2. **Cambios en `scripts/lib/extractors.js`.** Cada extractor afecta la tabla estructurada correspondiente. Antes de cambiar uno que ya está estable, considerar si conviene un extractor nuevo en paralelo y depreciar el viejo después.
3. **Headers HTTP en `coesClient.js`.** El portal COES bloquea User-Agents vacíos o sospechosos. No "limpiar" esos headers.

## Cómo refinar un extractor del SEIN

Los Excel del SEIN tienen estructura variable. La estrategia es ver datos reales antes de escribir código:

```js
// scripts/inspect-raw.js (ad-hoc, no commitear)
const supa = require('./lib/supabase');
const f = await supa.selectOne('raw_files', { match: { anio: 2024, capitulo: 4 } });
console.log('hojas:', f.sheet_names);
console.log(f.parsed_data['Tabla 4.1'].slice(0, 15));
```

Mirar 2-3 archivos de años distintos antes de generalizar. Después actualizar `scripts/lib/extractors.js`, hacer una corrida manual desde GitHub Actions (`workflow_dispatch`) y verificar `enerku.ingest_runs`.

## Secretos

Nunca commitear `.env`, service role keys, ni tokens. Si se filtra algo: rotar la key en Supabase **antes** de hacer el `git push --force-with-lease` para limpiar el historial.
