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

// Response schemas

export const addDependentsResponseSchema = z.object({
  dependentIds: z.array(z.string()),
  memberId: z.string(),
  chargeId: z.string(),
});

const parentSchema = z.object({
  name: z.string().nullable(),
  telephone: z.string().nullable(),
  email: z.string(),
});

export const getDependentsResponseSchema = z.object({
  dependents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      sex: z.string(),
      dob: z.string(),
      school_year: z.string().nullable(),
      played_before: z.boolean().nullable(),
      previous_cricket: z.string().nullable(),
      whatsapp_consent: z.boolean().nullable(),
      created_at: z.string(),
      paid_until: z.string().nullable(),
      parent: parentSchema,
    }),
  ),
  currentYearCount: z.number(),
});

export const teamResponseSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    age_group: z.string(),
    sex: z.string(),
    created_at: z.string(),
  }),
);

export const playersResponseSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    sex: z.string(),
    dob: z.string(),
    created_at: z.string(),
    school_year: z.string().nullable(),
    played_before: z.boolean().nullable(),
    medical_info: z.string().nullable(),
    parent_name: z.string().nullable(),
    parent_telephone: z.string().nullable(),
    parent_email: z.string(),
    parent_address: z.string().nullable(),
    parent_postcode: z.string().nullable(),
    emergency_contact_name: z.string().nullable(),
    emergency_contact_telephone: z.string().nullable(),
  }),
);

export const playerDetailResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  sex: z.string(),
  dob: z.string(),
  created_at: z.string(),
  school_year: z.string().nullable(),
  played_before: z.boolean().nullable(),
  previous_cricket: z.string().nullable(),
  whatsapp_consent: z.boolean().nullable(),
  alt_contact_name: z.string().nullable(),
  alt_contact_phone: z.string().nullable(),
  alt_contact_whatsapp_consent: z.boolean().nullable(),
  gp_surgery: z.string().nullable(),
  gp_phone: z.string().nullable(),
  has_disability: z.boolean().nullable(),
  disability_type: z.string().nullable(),
  medical_info: z.string().nullable(),
  emergency_medical_consent: z.boolean().nullable(),
  medical_fitness_declaration: z.boolean().nullable(),
  data_protection_consent: z.boolean().nullable(),
  photo_consent: z.boolean().nullable(),
  parent_name: z.string().nullable(),
  parent_telephone: z.string().nullable(),
  parent_email: z.string(),
  parent_address: z.string().nullable(),
  parent_postcode: z.string().nullable(),
  emergency_contact_name: z.string().nullable(),
  emergency_contact_telephone: z.string().nullable(),
});
