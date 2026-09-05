import { z } from "zod";

/** Optional so existing v2 tasks and reports continue to parse unchanged. */
export const researchImageSourceSchema = z
  .object({
    id: z.string().min(1).max(240),
    url: z
      .string()
      .url()
      .max(4_096)
      .refine((value) => new URL(value).protocol === "https:", {
        message: "Research image URLs must use HTTPS.",
      }),
    description: z.string().max(500).optional(),
    sourceUrl: z
      .string()
      .url()
      .max(4_096)
      .refine(
        (value) => {
          const protocol = new URL(value).protocol;
          return protocol === "http:" || protocol === "https:";
        },
        { message: "Research image source URLs must use HTTP(S)." },
      )
      .optional(),
    retrievedAt: z.number().finite().nonnegative(),
    researchRunId: z.string().min(1).max(240),
  })
  .strict();
