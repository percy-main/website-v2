import { z } from "zod";

export const dependentSchema = z.object({
  name: z.string().min(1),
  sex: z.enum(["male", "female"]),
  dob: z.string(), // ISO date
  school_year: z.string().optional(),
  played_before: z.boolean().optional(),
  previous_cricket: z.string().optional(),
  whatsapp_consent: z.boolean(),
  alt_contact_name: z.string().optional(),
  alt_contact_phone: z.string().optional(),
  alt_contact_whatsapp_consent: z.boolean().optional(),
  gp_surgery: z.string().optional(),
  gp_phone: z.string().optional(),
  has_disability: z.boolean().optional(),
  disability_type: z.string().optional(),
  medical_info: z.string().optional(),
  emergency_medical_consent: z.boolean(),
  medical_fitness_declaration: z.boolean(),
  data_protection_consent: z.boolean(),
  photo_consent: z.boolean(),
});

export const addDependentsSchema = z.object({
  dependents: z.array(dependentSchema).min(1),
});

export const listPlayersSchema = z.object({
  teamId: z.string(),
});

export const teamIdParamSchema = z.object({
  teamId: z.string(),
});

export const dependentIdParamSchema = z.object({
  dependentId: z.string(),
});

export type DependentInput = z.infer<typeof dependentSchema>;
