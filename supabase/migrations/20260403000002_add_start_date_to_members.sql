-- Migration: add start_date to members
alter table public.members add column start_date date;
