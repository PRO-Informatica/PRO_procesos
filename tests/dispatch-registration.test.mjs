import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { getDispatchStartLocalDateTime } from "../src/features/dispatches/registration.ts";

const projectId = "78f495d6-d721-4b65-94f0-fdc94a03b8df";
const programmingId = "28f495d6-d721-4b65-94f0-fdc94a03b8df";
const dispatchId = "38f495d6-d721-4b65-94f0-fdc94a03b8df";
const scheduledAt = "2026-10-31T19:00:00Z";
const savedRegistration = {
  arrival_at: "2026-10-31T19:36:42.123Z",
  received_by_name: "Residente original",
};
const source = await readFile(
  new URL("../src/features/dispatches/actions.ts", import.meta.url), "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Execute the actual Server Actions with only the auth/database boundaries
// stubbed, so forged form values exercise the production validation path.
function actions({ registration = savedRegistration, authorized = true, rpcError = null, catalogData = {} } = {}) {
  const calls = [];
  const queries = [];
  const supabase = {
    from(table) {
      const filters = {};
      const query = {
        select() { return query; },
        eq(key, value) { filters[key] = value; return query; },
        async maybeSingle() {
          queries.push({ table, filters });
          if (filters.project_id !== projectId) return { data: null, error: null };
          if (table === "programming" && filters.id === programmingId) {
            return { data: { scheduled_at: scheduledAt }, error: null };
          }
          if (table === "dispatches" && filters.id === dispatchId) {
            return { data: registration, error: null };
          }
          return { data: null, error: null };
        },
      };
      return query;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: name === "search_project_dispatch_catalog" ? { items: catalogData[args.p_catalog_type] ?? [] } : ["start_dispatch", "register_dispatch_incident"].includes(name) ? dispatchId : 2, error: rpcError };
    },
  };
  const imports = {
    "next/cache": { revalidatePath() {} },
    "@/features/auth/queries": {
      requireActiveProfile: async () => ({ id: projectId, fullName: "Residente actual" }),
    },
    "@/features/projects/queries": {
      getProjectContext: async () => ({
        status: "ready",
        activeProject: { id: projectId, timezone: "America/Guatemala" },
        permissions: authorized ? ["dispatch.view", "dispatch.create", "dispatch.modify", "dispatch.register_incident"] : [],
      }),
    },
    "@/lib/supabase/admin": {},
    "@/lib/supabase/server": { createClient: async () => supabase },
    "./validation": {},
    "./registration": { getDispatchStartLocalDateTime },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require(path) {
      assert.ok(Object.hasOwn(imports, path), `Unexpected import: ${path}`);
      return imports[path];
    },
    Intl, Date,
  });
  return { exports, calls, queries };
}

function form(overrides = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    projectId, programmingId, dispatchId, expectedVersion: "1",
    departureAt: "2026-10-31T16:30", result: "DISPATCHED",
    orderNumber: "P-01", realVolume: "45", realUnitCode: "M3", ...overrides,
  })) data.set(key, value);
  return data;
}

test("la hora automática usa el día programado y el reloj de la zona del proyecto", () => {
  assert.equal(getDispatchStartLocalDateTime(
    "2026-11-01T01:00:00Z", "America/Guatemala", new Date("2026-10-23T05:47:00Z"),
  ), "2026-10-31T23:47");
  assert.equal(getDispatchStartLocalDateTime(
    "2026-11-01T01:00:00Z", "UTC", new Date("2026-10-23T00:04:00Z"),
  ), "2026-11-01T00:04");
});

test("iniciar ignora hora/receptor manipulados y usa programación, reloj y perfil del servidor", async () => {
  const { exports, calls, queries } = actions();
  const before = getDispatchStartLocalDateTime(scheduledAt, "America/Guatemala");
  const state = await exports.startDispatchAction({}, form({
    arrivalAt: "2000-01-01T01:00", receivedByName: "Nombre falsificado",
  }));
  const after = getDispatchStartLocalDateTime(scheduledAt, "America/Guatemala");
  assert.equal(state.status, "success");
  assert.equal(calls[0].name, "start_dispatch");
  assert.equal(calls[0].args.p_received_by_name, "Residente actual");
  const validTimes = [before, after].map((value) => new Date(`${value}:00-06:00`).toISOString());
  assert.ok(validTimes.includes(calls[0].args.p_arrival_at));
  assert.equal(queries[0].filters.project_id, projectId);
});

for (const [actionName, rpc] of [
  ["saveDispatchAction", "update_dispatch"],
  ["finalizeDispatchAction", "finalize_dispatch"],
]) {
  test(`${actionName} guarda la llegada corregida y conserva el receptor original`, async () => {
    const { exports, calls, queries } = actions();
    const state = await exports[actionName]({}, form({
      arrivalAt: "2026-10-31T07:00", receivedByName: "Nombre falsificado",
    }));
    assert.equal(state.status, "success");
    assert.equal(calls[0].name, rpc);
    assert.equal(calls[0].args.p_arrival_at, "2026-10-31T13:00:00.000Z");
    assert.equal(calls[0].args.p_received_by_name, savedRegistration.received_by_name);
    assert.equal(calls[0].args.p_departure_at, "2026-10-31T22:30:00.000Z");
    assert.equal(queries[0].filters.project_id, projectId);
    assert.equal(queries[0].filters.id, dispatchId);
  });

  test(`${actionName} funciona sin enviar los campos de solo lectura`, async () => {
    const { exports, calls } = actions();
    const state = await exports[actionName]({}, form());
    assert.equal(state.status, "success");
    assert.equal(calls[0].args.p_arrival_at, savedRegistration.arrival_at);
    assert.equal(calls[0].args.p_received_by_name, savedRegistration.received_by_name);
  });

  test(`${actionName} rechaza llegadas vacías, horas y fechas imposibles`, async () => {
    for (const arrivalAt of ["", "2026-10-31T24:00", "2026-02-30T07:00", "2026-10-31T07:60", "no-fecha"]) {
      const { exports, calls } = actions();
      assert.equal((await exports[actionName]({},form({arrivalAt}))).status,"error");
      assert.equal(calls.length,0);
    }
  });

  test(`${actionName} no inventa datos si el registro original falta o está incompleto`, async () => {
    for (const registration of [null, { ...savedRegistration, arrival_at: null }, { ...savedRegistration, received_by_name: null }]) {
      const { exports, calls } = actions({ registration });
      const state = await exports[actionName]({}, form());
      assert.equal(state.status, "error");
      assert.equal(calls.length, 0);
    }
  });
}

test("las acciones siguen exigiendo permisos y rechazan identificadores fuera del proyecto", async () => {
  for (const action of ["startDispatchAction", "saveDispatchAction", "finalizeDispatchAction"]) {
    const denied = actions({ authorized: false });
    assert.equal((await denied.exports[action]({}, form())).status, "error");
    assert.equal(denied.calls.length, 0);
    assert.equal(denied.queries.length, 0);
    const missing = actions();
    assert.equal((await missing.exports[action]({}, form({
      programmingId: dispatchId, dispatchId: programmingId,
    }))).status, "error");
    assert.equal(missing.calls.length, 0);
  }
});

test("registrar incidencia envía los datos completos al RPC y maneja su resultado", async () => {
  const { exports, calls } = actions();
  const state = await exports.registerIncidentAction({}, form({
    incidentTypeId: programmingId, responsibility: "PROJECT", chargeApplicability: "NO", notes: "Acceso bloqueado",
  }));
  assert.equal(state.status, "success");
  assert.equal(state.incidentId, dispatchId);
  assert.equal(calls[0].name, "register_dispatch_incident");
  assert.equal(calls[0].args.p_incident_type_id, programmingId);
  assert.equal(calls[0].args.p_notes, "Acceso bloqueado");
});

test("un tipo de otra empresa produce un mensaje específico y no una confirmación falsa", async () => {
  const { exports } = actions({ rpcError: { message: "DISPATCH_INCIDENT_TYPE_INVALID" } });
  const state = await exports.registerIncidentAction({}, form({
    incidentTypeId: programmingId, responsibility: "SUPPLIER", chargeApplicability: "YES",
  }));
  assert.equal(state.status, "error");
  assert.match(state.message, /no está activo o no pertenece a la empresa/u);
});

test("la búsqueda combinada consulta ambos catálogos del proyecto y conserva variantes por ID y precio", async () => {
  const f = actions({catalogData:{
    PRODUCT:[{id:projectId,code:'86131064',reference:'CONF4001',price:1224.16}],
    SERVICE:[{id:dispatchId,code:'86180185',description:'Dosis',observations:'Una dosis',price:10.92,unit_code:'M3'},
      {id:programmingId,code:'86180185',description:'Dosis',observations:'Doble dosis',price:21.84,unit_code:'M3'}],
  }});
  const result=await f.exports.searchDispatchCatalogAction(projectId,'ALL','  dosis  ');
  assert.equal(result.status,'success');assert.equal(f.calls.length,2);
  assert.deepEqual(f.calls.map(c=>c.args.p_catalog_type),['PRODUCT','SERVICE']);
  assert.ok(f.calls.every(c=>c.args.p_project_id===projectId&&c.args.p_query==='dosis'));
  assert.equal(result.items[0].type,'PRODUCT');assert.equal(result.items[0].reference,'CONF4001');
  assert.equal(result.items[2].type,'SERVICE');assert.equal(result.items[2].id,programmingId);
  assert.equal(result.items[2].price,21.84);assert.equal(result.items[2].observations,'Doble dosis');
});

test("la búsqueda mantiene permisos, proyecto, tipo, longitud y errores sin resultados parciales", async () => {
  for(const [authorized,id,type] of [[false,projectId,'ALL'],[true,dispatchId,'ALL'],[true,projectId,'UNKNOWN']]) {
    const f=actions({authorized});assert.equal((await f.exports.searchDispatchCatalogAction(id,type,'861')).status,'error');assert.equal(f.calls.length,0);
  }
  const f=actions({rpcError:{message:'PERMISSION_DENIED'}});
  const result=await f.exports.searchDispatchCatalogAction(projectId,'ALL','x'.repeat(150));
  assert.equal(result.status,'error');assert.equal(result.items.length,0);
  assert.ok(f.calls.every(c=>c.args.p_query.length===120));
});
