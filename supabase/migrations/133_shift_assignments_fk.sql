-- Add missing FK constraints on shift_assignments so PostgREST embedded joins resolve
ALTER TABLE shift_assignments
  ADD CONSTRAINT shift_assignments_rota_id_fkey
  FOREIGN KEY (rota_id) REFERENCES rotas(id);

ALTER TABLE shift_assignments
  ADD CONSTRAINT shift_assignments_shift_template_id_fkey
  FOREIGN KEY (shift_template_id) REFERENCES shift_templates(id);

ALTER TABLE shift_assignments
  ADD CONSTRAINT shift_assignments_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES employees(id);

NOTIFY pgrst, 'reload schema';
