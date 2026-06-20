// Agregator rute — mendaftarkan semua modul ke router (pola modular sesuai
// ROUTES_SEPARATION.md milik Zylora).
import { register as auth } from "./auth.routes.mjs";
import { register as company } from "./company.routes.mjs";
import { register as employees } from "./employees.routes.mjs";
import { register as locations } from "./locations.routes.mjs";
import { register as config } from "./config.routes.mjs";
import { register as attendance } from "./attendance.routes.mjs";
import { register as publicRoutes } from "./public.routes.mjs";
import { register as employeeAuth } from "./employee.routes.mjs";

export function registerAll(router) {
  auth(router);
  company(router);
  employees(router);
  locations(router);
  config(router);
  attendance(router);
  publicRoutes(router);
  employeeAuth(router);
  return router;
}
