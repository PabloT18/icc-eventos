import test from "node:test";
import assert from "node:assert/strict";
import { canManual, csvCell } from "../src/domain/policy";
import { validateQr } from "../src/infrastructure/qr";
test("solo administrador y lector superior pueden registrar manualmente", () => {
  assert.equal(canManual("LECTOR"), false);
  assert.equal(canManual("LECTOR_SUPER"), true);
  assert.equal(canManual("ADMIN"), true);
});
test("CSV neutraliza fórmulas y conserva comillas", () => {
  assert.equal(csvCell("=SUM(A1)"), `"'=SUM(A1)"`);
  assert.equal(csvCell('a"b'), '"a""b"');
});
test("mock QR no se habilita en producción", async () => {
  Object.assign(process.env, {
    NODE_ENV: "production",
    QR_MODE: "mock",
    QR_VALIDATOR_URL: "",
  });
  await assert.rejects(() => validateQr("DEMO-VALID"));
});
