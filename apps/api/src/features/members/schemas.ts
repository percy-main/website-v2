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

// Response schemas

export const memberDetailsResponseSchema = z.object({
  member: z
    .object({
      title: z.string().nullable(),
      name: z.string().nullable(),
      address: z.string().nullable(),
      postcode: z.string().nullable(),
      dob: z.string().nullable(),
      telephone: z.string().nullable(),
      email: z.string().nullable(),
      emergency_contact_name: z.string().nullable(),
      emergency_contact_telephone: z.string().nullable(),
    })
    .nullable(),
});

export const membershipResponseSchema = z.object({
  membership: z
    .object({
      id: z.string(),
      type: z.string().nullable(),
      created_at: z.string(),
      paid_until: z.string(),
    })
    .nullable(),
});

export const subscriptionsResponseSchema = z.object({
  subscriptions: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      product: z.object({
        id: z.string(),
        name: z.string(),
      }),
      created: z.string(),
      status: z.string(),
      paidUntil: z.string(),
    }),
  ),
});

export const updateMemberResponseSchema = z.object({
  success: z.literal(true),
});
