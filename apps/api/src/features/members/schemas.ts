import { z } from "zod";

export const updateMemberSchema = z.object({
  title: z.string().optional(),
  name: z.string().optional(),
  address: z.string().optional(),
  postcode: z.string().optional(),
  dob: z.string().optional(),
  telephone: z.string().optional(),
  emergency_contact_name: z.string().optional(),
  emergency_contact_telephone: z.string().optional(),
});

export type MemberUpdate = z.infer<typeof updateMemberSchema>;
