-- Fix cost_description column type from numeric to text
alter table benefit_types
  alter column cost_description type text using cost_description::text;
